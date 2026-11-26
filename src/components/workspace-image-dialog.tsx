"use client";

import { Check, Flag, ImagePlus, LoaderCircle, RefreshCw } from "lucide-react";
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
// 生成中・失敗（入力を保持して再試行可能）・成功プレビューからの挿入（または差し替え）・不適切な生成画像の通報までを一貫した UI で扱う。
export function WorkspaceImageDialog({
  pageId,
  pageKind,
  embedded = false,
  mode = "insert",
  defaultSize = "1536x1024",
  referenceImage,
  onInsert,
  onClose,
}: {
  pageId: string;
  pageKind: PageKind;
  embedded?: boolean;
  mode?: "insert" | "replace";
  defaultSize?: GenerateImageSize;
  referenceImage?: { blob: Blob; previewUrl: string };
  onInsert: (image: PageImage) => void;
  onClose: () => void;
}) {
  const t = useT();
  const formId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const insertButtonRef = useRef<HTMLButtonElement>(null);
  const { account } = useAccount();
  const isSketch = Boolean(referenceImage);
  const draftScope = `${isSketch ? "workspace-sketch-image" : "workspace-image"}:${pageKind}:${pageId}`;
  const [prompt, setPrompt] = useState(() => takePendingDraft(draftScope));
  const [size, setSize] = useState<GenerateImageSize>(defaultSize);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [usageLimit, setUsageLimit] = useState<UsageLimitError | null>(null);
  const [preview, setPreview] = useState<PageImage | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportState, setReportState] = useState<"idle" | "sending" | "sent">("idle");
  const [reportError, setReportError] = useState("");
  const limitHitRef = useRef(Boolean(prompt));
  const previewRef = useRef<PageImage | null>(preview);
  const dialogMountedRef = useKeepDraftOnLeave(draftScope, () => (limitHitRef.current ? prompt : null), { persistent: embedded });

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

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
    if ((!trimmed && !isSketch) || busy) return;
    setBusy(true);
    setError("");
    setUsageLimit(null);
    setReportOpen(false);
    setReportError("");
    try {
      const image = referenceImage
        ? await generatePageImage(trimmed, size, { referenceImage: referenceImage.blob })
        : await generatePageImage(trimmed, size);
      if (!dialogMountedRef.current) return;
      limitHitRef.current = false;
      savePendingDraft(draftScope, "", { persistent: embedded });
      previewRef.current = image;
      setPreview(image);
      setReportState("idle");
      setReportReason("");
    } catch (caught) {
      if (caught instanceof StorageLimitError) {
        limitHitRef.current = true;
        savePendingDraft(draftScope, prompt, { persistent: embedded });
        // すでに生成済みのプレビューがあるなら閉じずに残し、そのまま挿入できるようにする。
        if (previewRef.current) {
          setError(caught.message);
        } else {
          onClose();
        }
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

  async function submitReport() {
    if (!preview?.reportToken || reportState === "sending") return;
    const targetUrl = preview.url;
    setReportState("sending");
    setReportError("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId,
          reportToken: preview.reportToken,
          reason: reportReason.trim(),
        }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || t("Could not send the report."));
      // 再生成で別のプレビューに切り替わった後に届いた旧応答は無視する。
      if (dialogMountedRef.current && previewRef.current?.url === targetUrl) setReportState("sent");
    } catch (caught) {
      if (dialogMountedRef.current && previewRef.current?.url === targetUrl) {
        setReportState("idle");
        setReportError(caught instanceof Error ? caught.message : t("Could not send the report."));
      }
    }
  }

  function confirmInsert() {
    if (!preview || busy) return;
    // 再生成で上限に達した未生成プロンプトがある場合は、前のプレビューを挿入しても下書きを消さず保持する。
    if (!limitHitRef.current) {
      savePendingDraft(draftScope, "", { persistent: embedded });
    }
    onInsert(preview);
    onClose();
  }

  const primaryInsertLabel = mode === "replace" ? t("Replace") : t("Insert");
  const canGenerate = !busy && (isSketch || Boolean(prompt.trim()));
  const dialogHeading = isSketch ? t("Turn sketch into image") : t("Generate an image");

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => {
        // ダイアログ内の Delete や矢印キーなどが背後のスライド・ノートエディターのショートカットへ伝播しないように止める。
        if (event.key !== "Escape") event.stopPropagation();
      }}
      aria-label={dialogHeading}
      className="notes-dialog ws-image-dialog"
    >
      <form id={formId} onSubmit={(event) => { event.preventDefault(); void generate(); }}>
        <h2 className="text-base font-semibold">{dialogHeading}</h2>
        <p className="ws-image-muted">
          {isSketch
            ? t("Add an optional description or style. Each image uses one image generation from your plan.")
            : t("Describe the image. Each image uses one image generation from your plan.")}
        </p>
        {referenceImage && (
          <div className="ws-image-reference">
            <span className="ws-image-reference-label">{t("Selected sketch")}</span>
            {/* eslint-disable-next-line @next/next/no-img-element -- 選択したホワイトボード要素を書き出したローカル PNG プレビュー。 */}
            <img src={referenceImage.previewUrl} alt={t("Selected sketch")} className="ws-image-reference-img" />
          </div>
        )}
        <textarea
          autoFocus={!preview}
          className="notes-dialog-input ws-image-prompt"
          rows={preview || isSketch ? 3 : 4}
          maxLength={4000}
          value={prompt}
          disabled={busy}
          aria-label={t("Image description")}
          placeholder={isSketch
            ? t("Optional: watercolor illustration, clean 3D render, architectural diagram…")
            : t("A watercolor illustration of a lighthouse at dawn")}
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
        <>
          <div className="ws-image-stage is-ready">
            {/* eslint-disable-next-line @next/next/no-img-element -- 自分の note-files へ保存した直後の生成画像プレビュー。 */}
            <img src={preview.url} alt={preview.prompt || t("Generated image")} className="ws-image-preview" />
          </div>
          {preview.reportToken && <div className="ws-image-preview-meta">
            {reportState === "sent" ? (
              <span className="ws-image-report-sent" role="status">{t("Report sent")} · {t("Thanks. We’ll review this image.")}</span>
            ) : (
              <button
                type="button"
                className="ws-image-report-link"
                aria-expanded={reportOpen}
                onClick={() => { setReportOpen((open) => !open); setReportError(""); }}
              >
                <Flag size={13} aria-hidden="true" />
                <span>{t("Report image")}</span>
              </button>
            )}
          </div>}
          {reportOpen && reportState !== "sent" && (
            <form
              className="ws-image-report-box"
              onSubmit={(event) => { event.preventDefault(); void submitReport(); }}
            >
              <p className="ws-image-report-hint">{t("Tell us what’s wrong with this AI-generated image (optional).")}</p>
              <textarea
                className="notes-dialog-input ws-image-report-input"
                rows={2}
                maxLength={1000}
                value={reportReason}
                aria-label={t("Reason")}
                onChange={(event) => setReportReason(event.target.value)}
              />
              {reportError && <p role="alert" className="ws-image-error">{localizeSystemText(reportError, t)}</p>}
              <div className="ws-image-report-actions">
                <button type="button" className="notion-button" disabled={reportState === "sending"} onClick={() => setReportOpen(false)}>{t("Cancel")}</button>
                <button type="submit" className="notion-button notion-button-primary" disabled={reportState === "sending"}>{t("Send report")}</button>
              </div>
            </form>
          )}
        </>
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
              disabled={!canGenerate}
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
            disabled={!canGenerate}
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
            <span>{busy ? t("Generating…") : t("Generate")}</span>
          </button>
        )}
      </div>
    </dialog>
  );
}
