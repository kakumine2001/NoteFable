"use client";

import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  cancelNotionSave,
  fetchNotionFileLimit,
  NotionSaveError,
  runNotionSave,
  type NotionSaveProgress,
} from "@/lib/notion-client";
import {
  appendFiles,
  buildNotionSaveRequest,
  createTextBlock,
  getDraftFileCount,
  hasDraftContent,
  insertFilesAtCaret,
  moveBlock,
  removeBlock,
  type NotionDraftBlock,
} from "@/lib/notion-draft";
import {
  formatByteSize,
  getNotionFileValidationError,
  NOTION_MAX_FILE_BYTES,
} from "@/lib/notion-files";
import type { NotionSavePlanFile } from "@/types/notion";

export type NotionDraftState = {
  title: string;
  blocks: NotionDraftBlock[];
  // 途中まで進んだ保存。再試行時はここから再開する。
  resume: { saveId: string; plan: NotionSavePlanFile[] } | null;
};

type NotionDrawerProps = {
  draft: NotionDraftState;
  sessionId: string | null;
  onDraftChange: (draft: NotionDraftState) => void;
  onClose: () => void;
  onSaved: () => void;
};

const PHASE_LABEL: Record<NotionSaveProgress["phase"], string> = {
  preparing: "Preparing...",
  uploading: "Uploading from this device...",
  transferring: "Sending to Notion...",
  saving: "Creating the page...",
  done: "Saved",
};

// 入力に合わせて高さを変える本文ブロック。長文でも内部スクロールにしない。
function DraftTextarea({
  block,
  disabled,
  onTextChange,
  onCaretChange,
}: {
  block: Extract<NotionDraftBlock, { type: "text" }>;
  disabled: boolean;
  onTextChange: (text: string) => void;
  onCaretChange: (blockId: string, offset: number) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [block.text]);

  function syncCaret(element: HTMLTextAreaElement) {
    // どの文章ブロックの何文字目にいるかを親へ伝え、その位置にファイルを差し込めるようにする。
    onCaretChange(block.id, element.selectionStart ?? 0);
  }

  return (
    <textarea
      ref={ref}
      value={block.text}
      rows={1}
      disabled={disabled}
      aria-label="Content block"
      placeholder="Write something..."
      onChange={(event) => {
        syncCaret(event.currentTarget);
        onTextChange(event.target.value);
      }}
      onClick={(event) => syncCaret(event.currentTarget)}
      onKeyUp={(event) => syncCaret(event.currentTarget)}
      onSelect={(event) => syncCaret(event.currentTarget)}
      className="notion-block-textarea"
    />
  );
}

export function NotionDrawer({
  draft,
  sessionId,
  onDraftChange,
  onClose,
  onSaved,
}: NotionDrawerProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [confirmationKind, setConfirmationKind] = useState<"page" | "append" | null>(null);
  const [progress, setProgress] = useState<NotionSaveProgress | null>(null);
  const [dragActive, setDragActive] = useState(false);
  // 接続先ワークスペースの上限。取得できるまでは null にして、実際の値を推測しない。
  const [maxFileUploadBytes, setMaxFileUploadBytes] = useState<number | null>(null);
  // ファイルを差し込む位置。直前まで編集していた文章ブロックとカーソル位置を覚える。
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [caretOffset, setCaretOffset] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 実行中の保存処理 ID。中断時にサーバー側の一時保管を解放するために持つ。
  const activeSaveIdRef = useRef<string | null>(null);
  // state の反映を待たずに連打されても、同じ保存を二重に始めない。
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void fetchNotionFileLimit().then((limit) => {
      if (!cancelled && limit) {
        setMaxFileUploadBytes(limit);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // パネルを閉じた後に転送が続かないよう、進行中のリクエストを中断する。
    return () => abortRef.current?.abort();
  }, []);

  // 途中まで進んだ保存があるうちは下書きの編集を止める。
  // 内容を変えて再開すると、転送済みのファイルと本文の対応が崩れるため。
  const editingLocked = saving || draft.resume !== null;
  const fileCount = getDraftFileCount(draft.blocks);
  // 再試行は編集不可でも押せる必要があるので、保存可否は saving だけで判断する。
  const canSave = !saving && draft.title.trim().length > 0 && hasDraftContent(draft.blocks);
  // 上限が取れていない間は Notion 自体の上限で事前チェックし、最終判断はサーバーに任せる。
  const limit = maxFileUploadBytes ?? NOTION_MAX_FILE_BYTES;

  function update(patch: Partial<NotionDraftState>) {
    onDraftChange({ ...draft, ...patch });
  }

  function updateBlockText(blockId: string, text: string) {
    update({
      blocks: draft.blocks.map((block) =>
        block.id === blockId && block.type === "text" ? { ...block, text } : block,
      ),
    });
  }

  // 選ばれたファイルを、直前のカーソル位置で文章を分けて差し込む。
  function addFiles(files: File[]) {
    if (!files.length) return;

    const valid: File[] = [];

    for (const file of files) {
      const validationError = getNotionFileValidationError(
        { filename: file.name, size: file.size },
        limit,
      );

      if (validationError) {
        setError(validationError);
        continue;
      }

      valid.push(file);
    }

    if (!valid.length) return;

    setError("");
    update({
      blocks: activeBlockId
        ? insertFilesAtCaret(draft.blocks, activeBlockId, caretOffset, valid)
        : appendFiles(draft.blocks, valid),
    });
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);

    if (editingLocked) return;

    addFiles(Array.from(event.dataTransfer.files ?? []));
  }

  async function handleSave(confirmUnknownWrite: "page" | "append" | null = null) {
    if (savingRef.current) return;

    const request = buildNotionSaveRequest(draft.title, draft.blocks, limit);

    if (!request.ok) {
      setError(request.error);
      return;
    }

    savingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setSaving(true);
    setError("");
    setUrl("");
    setConfirmationKind(null);

    try {
      const result = await runNotionSave({
        title: request.title,
        sessionId: sessionId ?? undefined,
        blocks: request.blocks,
        files: request.files,
        resume: draft.resume ?? undefined,
        confirmPageCreation: confirmUnknownWrite === "page",
        confirmAppendRetry: confirmUnknownWrite === "append",
        onProgress: setProgress,
        onSaveCreated: (id) => {
          activeSaveIdRef.current = id;
        },
        signal: controller.signal,
      });

      setUrl(result.url);
      update({ resume: null });
      onSaved();
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }

      if (caught instanceof NotionSaveError) {
        // 作成済みの保存処理を覚えておき、再試行はその続きから始める。
        setError(caught.message);
        setConfirmationKind(caught.needsConfirmation ? caught.confirmationKind : null);
        update({ resume: caught.resume });
        return;
      }

      setError("Failed to save to Notion.");
    } finally {
      abortRef.current = null;
      activeSaveIdRef.current = null;
      savingRef.current = false;
      setSaving(false);
      setProgress(null);
    }
  }

  // 送信中の中断と、失敗した保存の破棄を同じ処理で扱う。
  // どちらもサーバー側の一時保管を解放し、下書きの編集を再び許可する。
  async function discardSave() {
    // 実行中ならその保存処理、失敗後なら覚えている保存処理を解放する。
    const saveId = activeSaveIdRef.current ?? draft.resume?.saveId;
    abortRef.current?.abort();
    activeSaveIdRef.current = null;
    savingRef.current = false;
    setSaving(false);
    setProgress(null);
    setError("");
    setConfirmationKind(null);

    if (saveId) {
      const savedUrl = await cancelNotionSave(saveId);
      if (savedUrl) {
        // ページ作成まで進んでいた場合は、そのページを開けるようにしておく。
        setUrl(savedUrl);
      }
    }

    update({ resume: null });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/15">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        disabled={saving}
        aria-label="Close Notion draft"
      />
      <aside className="notion-drawer motion-drawer-enter">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--notion-border)] px-4">
          <div className="text-sm font-medium text-[var(--notion-text)]">Save to Notion</div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="notion-icon-button grid"
            aria-label="Close Notion draft"
          >
            <X size={17} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6 sm:px-7">
          <p className="text-sm leading-6 text-[var(--notion-muted)]">
            Compose the page, then save it to Notion. Add text or files in the order you want them
            to appear.
          </p>

          <label className="grid gap-1.5">
            <span className="notion-field-label">Page title</span>
            <input
              value={draft.title}
              onChange={(event) => update({ title: event.target.value })}
              disabled={editingLocked}
              className="notion-field h-9"
              placeholder="Untitled"
            />
          </label>

          <div className="grid min-h-0 flex-1 gap-1.5">
            <span className="notion-field-label">Content</span>
            <div
              // 下書き全体をドロップ領域にし、ファイルを本文の好きな位置へ入れられるようにする。
              className={`notion-block-editor ${dragActive && !editingLocked ? "is-drop-active" : ""}`}
              onDragOver={(event) => {
                if (editingLocked) return;
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              {!draft.blocks.length && (
                <div className="notion-block-empty" aria-hidden="true">
                  <Paperclip size={18} />
                  <span>Start with text or drop a file here</span>
                  <small>Files will keep the order you place them in.</small>
                </div>
              )}
              {draft.blocks.map((block, index) => {
                if (block.type === "text") {
                  return (
                    <DraftTextarea
                      key={block.id}
                      block={block}
                      disabled={editingLocked}
                      onTextChange={(text) => updateBlockText(block.id, text)}
                      onCaretChange={(blockId, offset) => {
                        setActiveBlockId(blockId);
                        setCaretOffset(offset);
                      }}
                    />
                  );
                }

                return (
                  <div key={block.id} className="notion-block-file">
                    <div className="notion-block-file-preview">
                      {block.entry.previewUrl ? (
                        <Image
                          src={block.entry.previewUrl}
                          alt={block.entry.file.name}
                          width={48}
                          height={48}
                          unoptimized
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <FileText size={18} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-[var(--notion-text)]">
                        {block.entry.file.name}
                      </div>
                      <div className="text-[11px] text-[var(--notion-faint)]">
                        {formatByteSize(block.entry.file.size)}
                        {block.entry.file.type.startsWith("image/") ? " · image" : " · file"}
                      </div>
                    </div>
                    <div className="notion-block-actions">
                      <button
                        type="button"
                        onClick={() => update({ blocks: moveBlock(draft.blocks, block.id, -1) })}
                        disabled={editingLocked || index === 0}
                        className="notion-icon-button grid"
                        aria-label="Move file up"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => update({ blocks: moveBlock(draft.blocks, block.id, 1) })}
                        disabled={editingLocked || index === draft.blocks.length - 1}
                        className="notion-icon-button grid"
                        aria-label="Move file down"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => update({ blocks: removeBlock(draft.blocks, block.id) })}
                        disabled={editingLocked}
                        className="notion-icon-button grid"
                        aria-label="Remove file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={editingLocked}
                className="notion-button notion-button-quiet"
              >
                <Paperclip size={14} />
                Add file
              </button>
              <button
                type="button"
                onClick={() => update({ blocks: [...draft.blocks, createTextBlock()] })}
                disabled={editingLocked}
                className="notion-button notion-button-quiet"
              >
                <Plus size={14} />
                Add text
              </button>
              <span className="text-[11px] text-[var(--notion-faint)]">
                {maxFileUploadBytes
                  ? `Up to ${formatByteSize(maxFileUploadBytes)} per file · drop files to insert`
                  : "Drop files to insert"}
              </span>
            </div>

            {!!fileCount && (
              <p className="text-[11px] text-[var(--notion-faint)]">
                Keep this tab open while files are transferred to Notion.
              </p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </div>

          {progress && (
            <div className="notion-progress">
              <div className="text-[11px] font-medium text-[var(--notion-muted)]">
                {PHASE_LABEL[progress.phase]}
              </div>
              {progress.files.map((file) => {
                // 一時保管が終わるまでは端末からの送信量、その後は Notion への転送量を出す。
                const transferring = progress.phase === "transferring";
                const loaded = transferring ? file.transferredBytes : file.stagedBytes;
                const percent = file.size ? Math.min(100, Math.round((loaded / file.size) * 100)) : 0;

                return (
                  <div key={file.fileId} className="grid gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="truncate text-[var(--notion-text)]">{file.filename}</span>
                      <span className="shrink-0 text-[var(--notion-faint)]">
                        {transferring ? "To Notion" : "From device"} · {percent}%
                      </span>
                    </div>
                    <div className="notion-progress-track">
                      <div className="notion-progress-bar" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && (
            <div className="notion-error" role="alert">
              {error}
            </div>
          )}

          {confirmationKind && (
            <div className="notion-warning" role="alert">
              <p>
                {confirmationKind === "page"
                  ? "The previous attempt did not return a result, so the page may already exist. Check Notion first, and create it again only if it is missing."
                  : "The previous append did not return a result. Check the saved page in Notion before retrying; retrying may duplicate its last blocks."}
              </p>
              <button
                type="button"
                onClick={() => void handleSave(confirmationKind)}
                disabled={saving}
                className="notion-button notion-button-quiet"
              >
                {confirmationKind === "page" ? "Create the page anyway" : "Append the blocks anyway"}
              </button>
            </div>
          )}

          {draft.resume && !saving && (
            <div className="notion-warning">
              <p>
                An earlier attempt is unfinished. Retry it, or discard it to edit the draft again.
              </p>
              <button
                type="button"
                onClick={() => void discardSave()}
                className="notion-button notion-button-quiet"
              >
                Discard this attempt
              </button>
            </div>
          )}

          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="notion-success">
              Open saved page <ExternalLink size={14} />
            </a>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--notion-border)] px-4 py-3">
          {saving ? (
            <button type="button" onClick={() => void discardSave()} className="notion-button">
              Cancel transfer
            </button>
          ) : (
            <button type="button" onClick={onClose} className="notion-button">
              Close
            </button>
          )}
          {!url && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
              className="notion-button notion-button-primary"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {draft.resume ? "Retry save" : "Save"}
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
