"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText } from "@/lib/i18n/translate";
import { useBackToClose } from "@/lib/use-back-to-close";

// ホワイトボード上の AI 生成画像を報告するダイアログ（スライドの ReportImageDialog と同じ UI パターン）。
// 既定では { pageId, elementId, reason } を POST /api/reports へ送る。
// 挿入直後で自動保存がまだサーバーに届いていない場合（404）のみ、手元にある署名付き reportToken で再送する。
export function WhiteboardReportImageDialog({
  pageId,
  elementId,
  fallbackReportToken,
  onClose,
}: {
  pageId: string;
  elementId: string;
  fallbackReportToken?: string;
  onClose: () => void;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, []);

  useBackToClose(true, () => (state === "sending" ? false : onClose()));

  async function postReport(payload: Record<string, string>) {
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null) as { error?: string } | null;
    return { response, data };
  }

  async function submit() {
    if (state === "sending") return;
    setState("sending");
    setError("");
    const trimmedReason = reason.trim();
    try {
      let result = await postReport({ pageId, elementId, reason: trimmedReason });
      if (result.response.status === 404 && fallbackReportToken) {
        result = await postReport({ pageId, reportToken: fallbackReportToken, reason: trimmedReason });
      }
      if (!result.response.ok) {
        throw new Error(result.data?.error || t("Could not send the report."));
      }
      setState("sent");
    } catch (caught) {
      setState("idle");
      setError(caught instanceof Error ? caught.message : t("Could not send the report."));
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (state !== "sending") onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") event.stopPropagation();
      }}
      aria-label={t("Report image")}
      className="notes-dialog"
    >
      {state === "sent" ? (
        <>
          <h2 className="text-base font-semibold">{t("Report sent")}</h2>
          <p className="ws-image-muted">{t("Thanks. We’ll review this image.")}</p>
          <div className="mt-5 flex justify-end">
            <button type="button" autoFocus className="notion-button notion-button-primary" onClick={onClose}>
              {t("Done")}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <h2 className="text-base font-semibold">{t("Report image")}</h2>
          <p className="ws-image-muted">{t("Tell us what’s wrong with this AI-generated image (optional).")}</p>
          <textarea
            autoFocus
            className="notes-dialog-input"
            rows={4}
            maxLength={1000}
            value={reason}
            aria-label={t("Reason")}
            onChange={(event) => setReason(event.target.value)}
          />
          {error && <p role="alert" className="ws-image-error">{localizeSystemText(error, t)}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="notion-button" disabled={state === "sending"} onClick={onClose}>
              {t("Cancel")}
            </button>
            <button type="submit" className="notion-button notion-button-primary" disabled={state === "sending"}>
              {t("Send report")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
