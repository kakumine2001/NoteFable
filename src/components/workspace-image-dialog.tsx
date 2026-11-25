"use client";

import { Check, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { GuestLimitPrompt, UpgradePrompt } from "@/components/guest-limit-prompt";
import { useT } from "@/components/i18n-provider";
import { useAccount } from "@/lib/account-store";
import { localizeSystemText } from "@/lib/i18n/translate";
import { nativeCanShowUsageLimit, postToNative } from "@/lib/native-bridge";
import { generatePageImage, PAGE_IMAGE_SIZES, type GenerateImageSize, type PageImage } from "@/lib/page-images";
import type { PageKind } from "@/lib/page-kinds";
import { keepRejectedDraft, savePendingDraft, takePendingDraft, useKeepDraftOnLeave } from "@/lib/pending-draft";
import { useBackToClose } from "@/lib/use-back-to-close";
import { StorageLimitError, UsageLimitError } from "@/lib/usage-plans";

// ワークスペース（ノート・ホワイトボード・スライド）共通の AI 画像生成ダイアログ。
// 生成中・失敗（入力を保持して再試行可能）・成功プレビューからの挿入（または差し替え）までを一貫した UI で扱う。
export function WorkspaceImageDialog({
  pageId,
  pageKind,
  embedded = false,
  mode = "insert",
  defaultSize = "1536x1024",
  onInsert,
  onClose,
}: {
  pageId: string;
  pageKind: PageKind;
  embedded?: boolean;
  mode?: "insert" | "replace";
  defaultSize?: GenerateImageSize;
  onInsert: (image: PageImage) => void;
  onClose: () => void;
}) {
  const t = useT();
  const formId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const insertButtonRef = useRef<HTMLButtonElement>(null);
  const { account } = useAccount();
  const draftScope = `workspace-image:${pageKind}:${pageId}`;
  const [prompt, setPrompt] = useState(() => takePendingDraft(draftScope));
  const [size, setSize] = useState<GenerateImageSize>(defaultSize);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [usageLimit, setUsageLimit] = useState<UsageLimitError | null>(null);
  const [preview, setPreview] = useState<PageImage | null>(null);
  const limitHitRef = useRef(Boolean(prompt));
  const dialogMountedRef = useKeepDraftOnLeave(draftScope, () => (limitHitRef.current ? prompt : null), { persistent: embedded });

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, []);

  useBackToClose(true, () => (busy ? false : onClose()));

  useEffect(() => {
    if (!embedded || !limitHitRef.current) return;
    savePendingDraft(draftScope, prompt, { persistent: true });
  }, [embedded, draftScope, prompt]);

  useEffect(() => {
    if (preview && !busy) {
      insertButtonRef.current?.focus();
    }
  }, [preview, busy]);

  const showGuestPrompt = !embedded && usageLimit?.tier === "guest" && Boolean(account?.configured && !account.user);
  const showUpgradePrompt = !embedded && usageLimit?.tier === "member" && Boolean(account?.billing && account.user);
  const limitFallbackMessage = usageLimit && !showGuestPrompt && !showUpgradePrompt ? usageLimit.message : "";

  async function generate() {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    setUsageLimit(null);
    try {
      const image = await generatePageImage(trimmed, size);
      if (!dialogMountedRef.current) return;
      limitHitRef.current = false;
      savePendingDraft(draftScope, "", { persistent: embedded });
      setPreview(image);
    } catch (caught) {
      if (caught instanceof StorageLimitError) {
        limitHitRef.current = true;
        savePendingDraft(draftScope, prompt, { persistent: embedded });
        onClose();
      } else if (caught instanceof UsageLimitError) {
        limitHitRef.current = true;
        if (!dialogMountedRef.current) {
          keepRejectedDraft(draftScope, trimmed, { persistent: embedded });
          return;
        }
        if (embedded) savePendingDraft(draftScope, prompt, { persistent: true });
        if (embedded) {
          if (nativeCanShowUsageLimit()) {
            postToNative({ type: "usageLimit", tier: caught.tier, kind: "image", pageId });
          }
          setError(caught.message);
        } else {
          setUsageLimit(caught);
        }
      } else {
        setError(caught instanceof Error ? caught.message : t("Could not create the image. Try again."));
      }
    } finally {
      if (dialogMountedRef.current) setBusy(false);
    }
  }

  function confirmInsert() {
    if (!preview || busy) return;
    limitHitRef.current = false;
    savePendingDraft(draftScope, "", { persistent: embedded });
    onInsert(preview);
    onClose();
  }

  const primaryInsertLabel = mode === "replace" ? t("Replace") : t("Insert");

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      aria-label={t("Generate an image")}
      className="notes-dialog ws-image-dialog"
    >
      <form id={formId} onSubmit={(event) => { event.preventDefault(); void generate(); }}>
        <h2 className="text-base font-semibold">{t("Generate an image")}</h2>
        <p className="ws-image-muted">{t("Describe the image. Each image uses one image generation from your plan.")}</p>
        <textarea
          autoFocus={!preview}
          className="notes-dialog-input ws-image-prompt"
          rows={preview ? 3 : 4}
          maxLength={4000}
          value={prompt}
          disabled={busy}
          aria-label={t("Image description")}
          placeholder={t("A watercolor illustration of a lighthouse at dawn")}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void generate();
            }
          }}
        />
        <div className="ws-image-sizes" role="radiogroup" aria-label={t("Shape")}>
          {PAGE_IMAGE_SIZES.map((option) => (
            <label key={option.key} className={`ws-image-size${size === option.key ? " is-selected" : ""}`}>
              <input
                type="radio"
                name={`ws-image-size-${formId}`}
                value={option.key}
                checked={size === option.key}
                disabled={busy}
                onChange={() => setSize(option.key)}
              />
              <span className={`ws-image-ratio is-${option.key}`} aria-hidden="true" />
              <span>{t(option.label)}</span>
            </label>
          ))}
        </div>
      </form>

      {busy && (
        <div className="ws-image-stage is-loading" role="status" aria-live="polite">
          <LoaderCircle size={22} className="animate-spin" aria-hidden="true" />
          <span>{t("Generating…")}</span>
        </div>
      )}

      {!busy && preview && (
        <div className="ws-image-stage is-ready">
          {/* eslint-disable-next-line @next/next/no-img-element -- 自分の note-files へ保存した直後の生成画像プレビュー。 */}
          <img src={preview.url} alt={preview.prompt || t("Generated image")} className="ws-image-preview" />
        </div>
      )}

      {/* メールログインの入力フォームを画像生成フォームに入れ子にしないよう、上限の案内は form の外に出す。 */}
      {showGuestPrompt && <GuestLimitPrompt kind="image" onClose={() => setUsageLimit(null)} onBeforeSignIn={() => savePendingDraft(draftScope, prompt)} />}
      {showUpgradePrompt && <UpgradePrompt kind="image" onClose={() => setUsageLimit(null)} onBeforeUpgrade={() => savePendingDraft(draftScope, prompt)} />}
      {(error || limitFallbackMessage) && (
        <p role="alert" className="ws-image-error">{localizeSystemText(error || limitFallbackMessage, t)}</p>
      )}

      <div className="ws-image-actions">
        <button type="button" className="notion-button" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
        {preview ? (
          <>
            <button
              type="submit"
              form={formId}
              className="notion-button inline-flex items-center gap-1.5"
              disabled={busy || !prompt.trim()}
            >
              {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
              <span>{busy ? t("Generating…") : t("Generate again")}</span>
            </button>
            <button
              ref={insertButtonRef}
              type="button"
              className="notion-button notion-button-primary inline-flex items-center gap-1.5"
              disabled={busy}
              onClick={confirmInsert}
            >
              <Check size={15} aria-hidden="true" />
              <span>{primaryInsertLabel}</span>
            </button>
          </>
        ) : (
          <button
            type="submit"
            form={formId}
            className="notion-button notion-button-primary inline-flex items-center gap-1.5"
            disabled={busy || !prompt.trim()}
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
            <span>{busy ? t("Generating…") : t("Generate")}</span>
          </button>
        )}
      </div>
    </dialog>
  );
}
