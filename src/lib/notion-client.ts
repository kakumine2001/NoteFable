import { upload } from "@vercel/blob/client";
import {
  getNotionStagingChunkPath,
  getNotionTransferredBytes,
  NOTION_TRANSFER_CHUNK_BYTES,
} from "@/lib/notion-files";
import type { NotionSaveBlockInput, NotionSavePlanFile } from "@/types/notion";

// 保存処理の失敗。needsConfirmation は、Notion への書き込み結果が不明なまま終わり、
// 利用者の確認なしに作り直してはいけない状態を表す。
export class NotionSaveError extends Error {
  // 途中まで進んだ保存の続き。再試行時はここから再開し、最初からやり直さない。
  resume: { saveId: string; plan: NotionSavePlanFile[] } | null = null;

  constructor(
    message: string,
    readonly needsConfirmation = false,
    readonly confirmationKind: "page" | "append" = "page",
  ) {
    super(message);
  }
}

export type NotionFileProgress = {
  fileId: string;
  filename: string;
  size: number;
  // ブラウザから一時保管先へ送れた量。
  stagedBytes: number;
  // Notion へ転送できた量。
  transferredBytes: number;
};

export type NotionSaveProgress = {
  phase: "preparing" | "uploading" | "transferring" | "saving" | "done";
  files: NotionFileProgress[];
};

export type NotionSaveRunInput = {
  title: string;
  sessionId?: string;
  blocks: NotionSaveBlockInput[];
  // blocks 内の file ブロックと同じ順序の File 一覧。
  files: File[];
  // 再試行時は前回の続きから始める。最初から作り直さない。
  resume?: { saveId: string; plan: NotionSavePlanFile[] };
  // 書き込み結果が不明なまま失敗した後、重複を承知で作り直す意思表示。
  confirmPageCreation?: boolean;
  confirmAppendRetry?: boolean;
  onProgress: (progress: NotionSaveProgress) => void;
  // 保存処理が作られた時点で呼ばれる。途中で中断しても一時保管を解放できるようにする。
  onSaveCreated?: (saveId: string) => void;
  signal?: AbortSignal;
};

export type NotionSaveRunResult = {
  saveId: string;
  url: string;
  plan: NotionSavePlanFile[];
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("The save was cancelled.", "AbortError");
  }
}

async function readErrorMessage(response: Response, fallback: string) {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  return typeof data.error === "string" && data.error ? data.error : fallback;
}

async function readJson(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function isPlanFileList(value: unknown): value is NotionSavePlanFile[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as NotionSavePlanFile).fileId === "string" &&
        typeof (item as NotionSavePlanFile).chunkCount === "number",
    )
  );
}

// 保存先ワークスペースの 1 ファイル上限を取得する。取得できない場合は null を返し、
// 呼び出し側は Notion の一般的な上限で画面を出す。
export async function fetchNotionFileLimit() {
  try {
    const response = await fetch("/api/notion/limits", { cache: "no-store" });
    if (!response.ok) return null;

    const data = await readJson(response);

    return typeof data.maxFileUploadBytes === "number" ? data.maxFileUploadBytes : null;
  } catch {
    return null;
  }
}

export async function cancelNotionSave(saveId: string) {
  try {
    const response = await fetch(`/api/notion/saves/${saveId}`, { method: "DELETE" });
    if (!response.ok) return "";

    const data = await readJson(response);

    return typeof data.url === "string" ? data.url : "";
  } catch {
    return "";
  }
}

// ブラウザから Private Blob への一時保管を、チャンク単位で直接行う。
async function stageFile(
  saveId: string,
  planned: NotionSavePlanFile,
  file: File,
  onStagedBytes: (bytes: number) => void,
  signal?: AbortSignal,
) {
  // すでに確定済みならアップロードをやり直さない。
  const alreadyStaged = await fetch(
    `/api/notion/saves/${saveId}/files/${planned.fileId}/stage`,
    { method: "POST", signal },
  );

  if (alreadyStaged.ok) {
    onStagedBytes(planned.size);
    return;
  }

  if (alreadyStaged.status !== 409) {
    throw new NotionSaveError(
      await readErrorMessage(alreadyStaged, "Failed to prepare the file."),
    );
  }

  for (let index = 0; index < planned.chunkCount; index += 1) {
    throwIfAborted(signal);

    const start = index * NOTION_TRANSFER_CHUNK_BYTES;
    const end = Math.min(start + NOTION_TRANSFER_CHUNK_BYTES, planned.size);

    // slice で切り出した範囲だけを送る。ファイル全体はメモリに載せない。
    await upload(getNotionStagingChunkPath(saveId, planned.fileId, index), file.slice(start, end), {
      access: "private",
      contentType: planned.mimeType || "application/octet-stream",
      handleUploadUrl: "/api/notion/uploads",
      clientPayload: JSON.stringify({ saveId, fileId: planned.fileId, chunkIndex: index }),
      abortSignal: signal,
    });

    onStagedBytes(end);
  }

  const confirmed = await fetch(`/api/notion/saves/${saveId}/files/${planned.fileId}/stage`, {
    method: "POST",
    signal,
  });

  if (!confirmed.ok) {
    throw new NotionSaveError(await readErrorMessage(confirmed, "Failed to prepare the file."));
  }

  onStagedBytes(planned.size);
}

// Notion への転送は 1 回のリクエストで 1 パートだけ進める。
async function transferFile(
  saveId: string,
  planned: NotionSavePlanFile,
  onTransferredBytes: (bytes: number) => void,
  signal?: AbortSignal,
) {
  // 想定外に終わらないループを避けるため、パート数 + 1 回で打ち切る。
  const maxSteps = planned.chunkCount + 2;

  for (let step = 0; step < maxSteps; step += 1) {
    throwIfAborted(signal);

    const response = await fetch(
      `/api/notion/saves/${saveId}/files/${planned.fileId}/upload`,
      { method: "POST", signal },
    );
    const data = await readJson(response);

    if (!response.ok) {
      throw new NotionSaveError(
        typeof data.error === "string" && data.error
          ? data.error
          : "Failed to send the file to Notion.",
      );
    }

    const uploadedParts =
      typeof (data.file as { uploadedParts?: unknown } | undefined)?.uploadedParts === "number"
        ? (data.file as { uploadedParts: number }).uploadedParts
        : 0;

    onTransferredBytes(getNotionTransferredBytes(planned.size, uploadedParts));

    if (data.done === true) {
      onTransferredBytes(planned.size);
      return;
    }
  }

  throw new NotionSaveError("Failed to send the file to Notion.");
}

export async function runNotionSave(input: NotionSaveRunInput): Promise<NotionSaveRunResult> {
  const progressFiles = new Map<string, NotionFileProgress>();

  const publish = (phase: NotionSaveProgress["phase"]) => {
    input.onProgress({ phase, files: [...progressFiles.values()].map((file) => ({ ...file })) });
  };

  const trackPlan = (plan: NotionSavePlanFile[]) => {
    for (const file of plan) {
      progressFiles.set(file.fileId, {
        fileId: file.fileId,
        filename: file.filename,
        size: file.size,
        stagedBytes: 0,
        transferredBytes: 0,
      });
    }
  };

  publish("preparing");

  let saveId = input.resume?.saveId ?? "";
  let plan = input.resume?.plan ?? [];

  if (saveId) {
    trackPlan(plan);
  } else {
    const response = await fetch("/api/notion/saves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        sessionId: input.sessionId,
        blocks: input.blocks,
      }),
      signal: input.signal,
    });

    if (!response.ok) {
      throw new NotionSaveError(await readErrorMessage(response, "Failed to save to Notion."));
    }

    const data = await readJson(response);

    if (typeof data.saveId !== "string" || !isPlanFileList(data.files)) {
      throw new NotionSaveError("Failed to save to Notion.");
    }

    saveId = data.saveId;
    plan = data.files;
    trackPlan(plan);
    publish("preparing");
  }

  input.onSaveCreated?.(saveId);

  // ここから先の失敗は、作成済みの saveId を添えて返し、続きから再試行できるようにする。
  try {
    for (let index = 0; index < plan.length; index += 1) {
      publish("uploading");
      const planned = plan[index];
      await stageFile(
        saveId,
        planned,
        input.files[index],
        (bytes) => {
          const entry = progressFiles.get(planned.fileId);
          if (entry) entry.stagedBytes = bytes;
          publish("uploading");
        },
        input.signal,
      );
    }

    for (const planned of plan) {
      publish("transferring");
      await transferFile(
        saveId,
        planned,
        (bytes) => {
          const entry = progressFiles.get(planned.fileId);
          if (entry) entry.transferredBytes = bytes;
          publish("transferring");
        },
        input.signal,
      );
    }

    publish("saving");

    const finalizeResponse = await fetch(`/api/notion/saves/${saveId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmPageCreation: input.confirmPageCreation === true,
        confirmAppendRetry: input.confirmAppendRetry === true,
      }),
      signal: input.signal,
    });

    if (!finalizeResponse.ok) {
      const data = await readJson(finalizeResponse);

      throw new NotionSaveError(
        typeof data.error === "string" && data.error ? data.error : "Failed to save to Notion.",
        data.needsConfirmation === true,
        data.code === "APPEND_WRITE_UNKNOWN" ? "append" : "page",
      );
    }

    const finalized = await readJson(finalizeResponse);
    publish("done");

    return {
      saveId,
      url: typeof finalized.url === "string" ? finalized.url : "",
      plan,
    };
  } catch (error) {
    if (error instanceof NotionSaveError) {
      error.resume = { saveId, plan };
    }

    throw error;
  }
}
