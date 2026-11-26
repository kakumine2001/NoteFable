import { msg } from "@/lib/i18n/translate";
import { dispatchPageUpdated, postToNative } from "@/lib/native-bridge";
import { applyGeneratedSlideImage, pendingSlideImageTasks, type PendingSlideImageTask } from "@/lib/slides/ai-build";
import { normalizeDeck, type Deck } from "@/lib/slides/model";
import { storageLimitErrorFrom, usageLimitErrorFrom, type UsageTier } from "@/lib/usage-plans";
import type { NotePage } from "@/types/notes";

// AI スライド生成時の逐页配図（POST /api/pages/images → PATCH /api/pages/:id）を pageId ごとに管理する。
// ウィザード（SlidesWizardHost）とスライドエディター（SlidesEditor）が同じ状態を共有し、
// 生成中にスライドを開いても進捗・停止・再開・上限表示がつながり、409 競合や二重課金を防ぐ。

export type SlideImageJobStatus = "working" | "stopped" | "done" | "error";

export type SlideImageJob = {
  pageId: string;
  status: SlideImageJobStatus;
  total: number;
  completed: number;
  remaining: number;
  currentSlideTitle: string | null;
  // 停止ボタンが押され、進行中の 1 枚の保存完了を待って停止する途中。
  stopping?: boolean;
  error?: string;
  usageLimit?: { tier: UsageTier; kind: "image"; message: string };
  storageLimit?: { tier: UsageTier; used: number; limit: number; message: string };
};

export type SlideImageEditorHandle = {
  getDeck: () => Deck;
  applyImage: (input: { slideId: string; elementId: string; url: string; name?: string; prompt: string }) => boolean;
};

type ActiveRun = {
  controller: AbortController;
  // 利用者の「停止」要求。進行中の 1 枚（既に課金済み）は中断せず保存まで終えてから止める。
  stopRequested: boolean;
  // resetSlideImageJobs や開始前の中断による即時停止。
  aborted: boolean;
  // まだ画像生成リクエストを出していない初期取得（resumeSlideImageJob の待機）か。
  preFlight?: boolean;
  generation: number;
};

const IMAGE_FAILED = msg("Could not create the image. Try again.");
const SAVE_FAILED = msg("Could not save the generated image. Try again.");
const MAX_PATCH_RETRIES = 3;

const jobs = new Map<string, SlideImageJob>();
const runs = new Map<string, ActiveRun>();
const editors = new Map<string, SlideImageEditorHandle>();
const listeners = new Set<() => void>();
let generation = 0;

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeSlideImageJobs(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSlideImageJob(pageId: string | null | undefined): SlideImageJob | null {
  return pageId ? jobs.get(pageId) ?? null : null;
}

export function isSlideImageJobWorking(pageId: string | null | undefined): boolean {
  return Boolean(pageId && jobs.get(pageId)?.status === "working");
}

export function isAnySlideImageJobWorking(): boolean {
  for (const job of jobs.values()) {
    if (job.status === "working") return true;
  }
  return false;
}

export function registerSlideImageEditor(pageId: string, handle: SlideImageEditorHandle) {
  editors.set(pageId, handle);
  return () => {
    if (editors.get(pageId) === handle) editors.delete(pageId);
  };
}

export function parseSlideImageTasks(value: unknown): PendingSlideImageTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: PendingSlideImageTask[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.slideId !== "string" || !candidate.slideId) continue;
    if (typeof candidate.elementId !== "string" || !candidate.elementId) continue;
    if (typeof candidate.prompt !== "string" || !candidate.prompt.trim()) continue;
    tasks.push({
      slideId: candidate.slideId,
      elementId: candidate.elementId,
      slideTitle: typeof candidate.slideTitle === "string" ? candidate.slideTitle : "",
      prompt: candidate.prompt.trim(),
    });
  }
  return tasks;
}

function setJob(pageId: string, job: SlideImageJob) {
  jobs.set(pageId, job);
  emit();
}

export function dismissSlideImageJob(pageId: string) {
  if (runs.has(pageId)) return;
  if (jobs.delete(pageId)) emit();
}

export function stopSlideImageJob(pageId: string) {
  const run = runs.get(pageId);
  const current = jobs.get(pageId);
  if (!run || !current || current.status !== "working") return;
  run.stopRequested = true;
  if (run.preFlight) {
    run.aborted = true;
    runs.delete(pageId);
    run.controller.abort();
    setJob(pageId, {
      ...current,
      status: "stopped",
      stopping: false,
      currentSlideTitle: null,
    });
    return;
  }
  // 進行中の /api/pages/images は既にサーバー側で課金されるため abort せず、この 1 枚を保存してから止める。
  setJob(pageId, {
    ...current,
    stopping: true,
  });
}

export function resetSlideImageJobs() {
  generation += 1;
  for (const run of runs.values()) {
    run.stopRequested = true;
    run.aborted = true;
    run.controller.abort();
  }
  runs.clear();
  jobs.clear();
  emit();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function hasPendingSlot(deck: Deck, task: PendingSlideImageTask): boolean {
  const slide = deck.slides.find((entry) => entry.id === task.slideId);
  if (!slide) return false;
  const element = slide.elements.find((entry) => entry.id === task.elementId && entry.type === "image");
  return Boolean(element && element.type === "image" && !element.src && element.pendingImagePrompt?.trim());
}

async function fetchLivePage(pageId: string, signal: AbortSignal): Promise<{ page: NotePage; deck: Deck } | { status: number; error: string }> {
  const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}`, { cache: "no-store", signal });
  const data = await response.json().catch(() => null) as { page?: NotePage; error?: string } | null;
  if (!response.ok || !data?.page) {
    return { status: response.status, error: typeof data?.error === "string" && data.error ? data.error : SAVE_FAILED };
  }
  return { page: data.page, deck: normalizeDeck(data.page.data) };
}

async function persistGeneratedImage(
  pageId: string,
  task: PendingSlideImageTask,
  image: { url: string; name?: string; prompt: string },
  signal: AbortSignal,
  initialPage?: NotePage,
): Promise<{ ok: true; applied: boolean } | { ok: false; status: number; error: string }> {
  const liveEditor = editors.get(pageId);
  if (liveEditor) {
    const applied = liveEditor.applyImage({
      slideId: task.slideId,
      elementId: task.elementId,
      url: image.url,
      name: image.name,
      prompt: image.prompt,
    });
    return { ok: true, applied };
  }

  let currentPage = initialPage;
  for (let attempt = 0; attempt < MAX_PATCH_RETRIES; attempt++) {
    if (!currentPage) {
      const loaded = await fetchLivePage(pageId, signal);
      if (!("page" in loaded)) return { ok: false, status: loaded.status, error: loaded.error };
      currentPage = loaded.page;
    }
    const deck = normalizeDeck(currentPage.data);
    const { deck: nextDeck, applied } = applyGeneratedSlideImage(deck, {
      slideId: task.slideId,
      elementId: task.elementId,
      url: image.url,
      name: image.name,
      prompt: image.prompt,
    });
    if (!applied) return { ok: true, applied: false };

    const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: currentPage.title,
        icon: currentPage.icon,
        data: nextDeck,
        version: currentPage.version,
      }),
      signal,
    });
    const body = await response.json().catch(() => null) as { version?: number; page?: Partial<NotePage>; error?: string } | null;
    if (response.status === 409) {
      // 別タブやエディターが先に保存した：最新版を読み直して、その変更を消さずに画像だけ入れ直す。
      currentPage = undefined;
      continue;
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: typeof body?.error === "string" && body.error ? body.error : SAVE_FAILED };
    }
    const nextVersion = typeof body?.version === "number" ? body.version : body?.page?.version ?? currentPage.version + 1;
    const updatedPage: NotePage = {
      ...currentPage,
      ...(body?.page ?? {}),
      version: nextVersion,
      blocks: [],
      cover: null,
      coverPosition: null,
      data: nextDeck as unknown as NotePage["data"],
    };
    dispatchPageUpdated(updatedPage);
    postToNative({ type: "pagesChanged" });
    return { ok: true, applied: true };
  }
  return { ok: false, status: 409, error: SAVE_FAILED };
}

async function runTasks(pageId: string, tasks: PendingSlideImageTask[], priorCompleted: number) {
  if (runs.has(pageId)) return;
  if (!tasks.length) {
    setJob(pageId, {
      pageId,
      status: "done",
      total: priorCompleted,
      completed: priorCompleted,
      remaining: 0,
      currentSlideTitle: null,
    });
    return;
  }

  const controller = new AbortController();
  const run: ActiveRun = { controller, stopRequested: false, aborted: false, generation };
  runs.set(pageId, run);
  const isAlive = () => !run.aborted && run.generation === generation && runs.get(pageId) === run;

  let completed = priorCompleted;
  let total = priorCompleted + tasks.length;
  let remaining = tasks.length;

  const finishStopped = () => {
    if (!isAlive()) return;
    runs.delete(pageId);
    setJob(pageId, {
      pageId,
      status: remaining > 0 ? "stopped" : "done",
      stopping: false,
      total,
      completed,
      remaining,
      currentSlideTitle: null,
    });
  };

  setJob(pageId, {
    pageId,
    status: "working",
    total,
    completed,
    remaining,
    currentSlideTitle: tasks[0].slideTitle || null,
  });

  try {
    for (let index = 0; index < tasks.length; index++) {
      if (!isAlive()) return;
      if (run.stopRequested) {
        finishStopped();
        return;
      }
      const task = tasks[index];
      setJob(pageId, {
        pageId,
        status: "working",
        stopping: run.stopRequested,
        total,
        completed,
        remaining,
        currentSlideTitle: task.slideTitle || null,
      });

      // 生成前に最新の Deck を確認：既に画像が入った・削除された・取り消されたスライドは再生成（二重課金）しない。
      let cachedPage: NotePage | undefined;
      const liveEditor = editors.get(pageId);
      if (liveEditor) {
        if (!hasPendingSlot(liveEditor.getDeck(), task)) {
          remaining = Math.max(0, remaining - 1);
          total = Math.max(completed, total - 1);
          continue;
        }
      } else {
        const loaded = await fetchLivePage(pageId, controller.signal);
        if (!isAlive()) return;
        if (run.stopRequested) {
          finishStopped();
          return;
        }
        if (!("page" in loaded)) {
          runs.delete(pageId);
          setJob(pageId, {
            pageId,
            status: "error",
            total,
            completed,
            remaining: loaded.status === 404 ? 0 : remaining,
            currentSlideTitle: null,
            error: loaded.error,
          });
          return;
        }
        if (!hasPendingSlot(loaded.deck, task)) {
          remaining = Math.max(0, remaining - 1);
          total = Math.max(completed, total - 1);
          continue;
        }
        cachedPage = loaded.page;
      }

      const response = await fetch("/api/pages/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: task.prompt, size: "1024x1024" }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null) as { url?: string; name?: string; prompt?: string; error?: string } | null;
      if (!isAlive()) return;

      const usageLimit = usageLimitErrorFrom(response.status, data);
      if (usageLimit) {
        runs.delete(pageId);
        setJob(pageId, {
          pageId,
          status: "error",
          total,
          completed,
          remaining,
          currentSlideTitle: null,
          error: usageLimit.message,
          usageLimit: { tier: usageLimit.tier, kind: "image", message: usageLimit.message },
        });
        return;
      }

      const storageLimit = storageLimitErrorFrom(response.status, data);
      if (storageLimit) {
        runs.delete(pageId);
        setJob(pageId, {
          pageId,
          status: "error",
          total,
          completed,
          remaining,
          currentSlideTitle: null,
          error: storageLimit.message,
          storageLimit: { tier: storageLimit.tier, used: storageLimit.used, limit: storageLimit.limit, message: storageLimit.message },
        });
        return;
      }

      if (!response.ok || !data?.url) {
        runs.delete(pageId);
        setJob(pageId, {
          pageId,
          status: "error",
          total,
          completed,
          remaining,
          currentSlideTitle: null,
          error: typeof data?.error === "string" && data.error ? data.error : IMAGE_FAILED,
        });
        return;
      }

      const saved = await persistGeneratedImage(
        pageId,
        task,
        { url: data.url, name: data.name, prompt: data.prompt ?? task.prompt },
        controller.signal,
        cachedPage,
      );
      if (!isAlive()) return;
      if (!saved.ok) {
        runs.delete(pageId);
        setJob(pageId, {
          pageId,
          status: "error",
          total,
          completed,
          remaining,
          currentSlideTitle: null,
          error: saved.error,
        });
        return;
      }

      if (saved.applied) {
        completed += 1;
      } else {
        total = Math.max(completed, total - 1);
      }
      remaining = Math.max(0, remaining - 1);
      if (run.stopRequested) {
        finishStopped();
        return;
      }
      setJob(pageId, {
        pageId,
        status: remaining > 0 ? "working" : "done",
        total,
        completed,
        remaining,
        currentSlideTitle: tasks[index + 1]?.slideTitle ?? null,
      });
    }

    if (!isAlive()) return;
    runs.delete(pageId);
    setJob(pageId, {
      pageId,
      status: "done",
      total,
      completed,
      remaining: 0,
      currentSlideTitle: null,
    });
  } catch (error) {
    if (!isAlive()) return;
    runs.delete(pageId);
    if (isAbortError(error)) {
      setJob(pageId, {
        pageId,
        status: "stopped",
        total,
        completed,
        remaining,
        currentSlideTitle: null,
      });
      return;
    }
    setJob(pageId, {
      pageId,
      status: "error",
      total,
      completed,
      remaining,
      currentSlideTitle: null,
      error: error instanceof Error && error.message ? error.message : IMAGE_FAILED,
    });
  }
}

export function startSlideImageJob(pageId: string, tasks: PendingSlideImageTask[]) {
  if (!tasks.length || runs.has(pageId)) return;
  void runTasks(pageId, tasks, 0);
}

// 停止・上限・エラー後やエディター再オープン時の再開：常に最新の Deck から未生成のスロットだけを取り出して続行する（二重課金しない）。
export async function resumeSlideImageJob(pageId: string) {
  if (runs.has(pageId)) return;
  const started = generation;
  const previous = jobs.get(pageId);
  const priorCompleted = previous?.completed ?? 0;

  const liveEditor = editors.get(pageId);
  if (liveEditor) {
    const tasks = pendingSlideImageTasks(liveEditor.getDeck());
    await runTasks(pageId, tasks, priorCompleted);
    return;
  }

  // 取得中の二重クリックを防ぐため、仮の working を立てる。
  const controller = new AbortController();
  const placeholderRun: ActiveRun = { controller, stopRequested: false, aborted: false, preFlight: true, generation: started };
  runs.set(pageId, placeholderRun);
  setJob(pageId, {
    pageId,
    status: "working",
    total: previous?.total ?? priorCompleted,
    completed: priorCompleted,
    remaining: previous?.remaining ?? 0,
    currentSlideTitle: null,
  });

  try {
    const loaded = await fetchLivePage(pageId, controller.signal);
    if (placeholderRun.aborted || placeholderRun.stopRequested || started !== generation || runs.get(pageId) !== placeholderRun) return;
    runs.delete(pageId);
    if (!("page" in loaded)) {
      setJob(pageId, {
        pageId,
        status: "error",
        total: previous?.total ?? priorCompleted,
        completed: priorCompleted,
        remaining: loaded.status === 404 ? 0 : (previous?.remaining ?? 0),
        currentSlideTitle: null,
        error: loaded.error,
      });
      return;
    }
    const tasks = pendingSlideImageTasks(loaded.deck);
    await runTasks(pageId, tasks, priorCompleted);
  } catch (error) {
    if (placeholderRun.aborted || placeholderRun.stopRequested || started !== generation || runs.get(pageId) !== placeholderRun) return;
    runs.delete(pageId);
    setJob(pageId, {
      pageId,
      status: isAbortError(error) ? "stopped" : "error",
      total: previous?.total ?? priorCompleted,
      completed: priorCompleted,
      remaining: previous?.remaining ?? 0,
      currentSlideTitle: null,
      ...(isAbortError(error) ? {} : { error: IMAGE_FAILED }),
    });
  }
}
