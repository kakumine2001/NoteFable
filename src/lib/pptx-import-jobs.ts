import { msg } from "@/lib/i18n/translate";
import { postToNative } from "@/lib/native-bridge";
import { importPptxFile, PptxImportError, type PptxImportProgress, type PptxImportResult } from "@/lib/slides/pptx-import";
import type { StorageLimitDetail } from "@/lib/storage-limit-client";
import { StorageLimitError } from "@/lib/usage-plans";

// PowerPoint（.pptx）取り込みの窓の状態管理（docs/architecture/slides.md の「PPTX 导入」）。
// SlidesWizardHost と同じく、画面に 1 つだけ PptxImportHost を置き、新規作成・サイドバー・ホーム・スライドのメニュー・アプリから開く。

export type PptxImportPlacement = {
  groupId?: string | null;
  parentId?: string | null;
};

export type PptxImportView = {
  key: number;
  groupId: string | null;
  parentId: string | null;
  phase: "pick" | "working" | "done" | "error";
  fileName: string;
  progress: PptxImportProgress;
  result: PptxImportResult | null;
  error: { message: string; storageLimit?: StorageLimitDetail } | null;
};

export const PPTX_IMPORT_FAILED = msg("Could not import this PowerPoint file. Try again.");

let seq = 0;
let generation = 0;
let state: PptxImportView | null = null;
let activeController: AbortController | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribePptxImport(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getPptxImport(): PptxImportView | null {
  return state;
}

export function openPptxImport(placement: PptxImportPlacement = {}) {
  // 前の実行が残っていたら中止して片付けてから開く。
  activeController?.abort();
  activeController = null;
  seq += 1;
  state = {
    key: seq,
    groupId: placement.groupId ?? null,
    parentId: placement.parentId ?? null,
    phase: "pick",
    fileName: "",
    progress: { stage: "parsing", done: 0, total: 1 },
    result: null,
    error: null,
  };
  emit();
}

export function closePptxImport(): boolean {
  if (!state) return false;
  activeController?.abort();
  activeController = null;
  state = null;
  emit();
  return true;
}

export function hidePptxImport(): boolean {
  return closePptxImport();
}

export function pptxImportBack(): boolean {
  return closePptxImport();
}

export function cancelPptxImport() {
  if (!state || state.phase !== "working") return;
  activeController?.abort();
  activeController = null;
  state = {
    ...state,
    phase: "pick",
    fileName: "",
    progress: { stage: "parsing", done: 0, total: 1 },
    error: null,
  };
  emit();
}

export function clearPptxImportError() {
  if (!state || state.phase !== "error") return;
  state = {
    ...state,
    phase: "pick",
    fileName: "",
    error: null,
  };
  emit();
}

export async function startPptxImport(file: File, selectedGroupId?: string | null) {
  if (!state || state.phase === "working") return;
  const runGeneration = generation;
  const runKey = state.key;
  const groupId = state.parentId ? null : (selectedGroupId !== undefined ? selectedGroupId : state.groupId);
  const parentId = state.parentId;
  const controller = new AbortController();
  activeController = controller;

  state = {
    ...state,
    groupId,
    phase: "working",
    fileName: file.name,
    progress: { stage: "parsing", done: 0, total: 1 },
    result: null,
    error: null,
  };
  emit();

  const live = () => runGeneration === generation && state?.key === runKey && activeController === controller;

  try {
    const result = await importPptxFile(file, {
      groupId,
      parentId,
      signal: controller.signal,
      onProgress: (progress) => {
        if (!live() || !state) return;
        state = { ...state, progress };
        emit();
      },
    });
    if (!live() || !state) return;
    activeController = null;
    state = {
      ...state,
      phase: "done",
      result,
      error: null,
    };
    emit();
    window.dispatchEvent(new CustomEvent("notefable:page-created", { detail: result.page }));
    postToNative({ type: "pagesChanged" });
  } catch (caught) {
    if (!live() || !state) return;
    activeController = null;
    if (caught instanceof PptxImportError && caught.code === "aborted") {
      state = { ...state, phase: "pick", fileName: "", error: null };
      emit();
      return;
    }
    if (caught instanceof StorageLimitError) {
      state = {
        ...state,
        phase: "error",
        error: {
          message: caught.message,
          storageLimit: { tier: caught.tier, used: caught.used, limit: caught.limit },
        },
      };
      emit();
      return;
    }
    const message = caught instanceof Error && caught.message ? caught.message : PPTX_IMPORT_FAILED;
    state = {
      ...state,
      phase: "error",
      error: { message },
    };
    emit();
  }
}

export function resetPptxImport() {
  generation += 1;
  activeController?.abort();
  activeController = null;
  state = null;
  emit();
}
