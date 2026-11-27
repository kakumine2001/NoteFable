"use client";

import { Sigma } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { renderKatex, type KatexApi } from "@/lib/katex-render";
import { StorageLimitError } from "@/lib/usage-plans";
import { useBackToClose } from "@/lib/use-back-to-close";
import { MAX_WHITEBOARD_FORMULA_LATEX, sanitizeFormulaLatex } from "@/lib/whiteboard/formula";
import { getLoadedKatex, loadWhiteboardKatex, renderFormulaToPng } from "@/lib/whiteboard/formula-render";
import { uploadImageBlob } from "@/lib/whiteboard/upload";

export type WhiteboardFormulaResult = {
  latex: string;
  url: string;
  mimeType: string;
  displayWidth: number;
  displayHeight: number;
};

// ホワイトボードの数式ラベル挿入・編集ダイアログ。
// TeX をリアルタイムで KaTeX プレビューし、確定時に PNG 化して既存の note-files 経路へ保存する。
export function WhiteboardFormulaDialog({
  mode,
  initialLatex = "",
  onSubmit,
  onClose,
}: {
  mode: "insert" | "edit";
  initialLatex?: string;
  onSubmit: (result: WhiteboardFormulaResult) => void;
  onClose: () => void;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [latex, setLatex] = useState(initialLatex);
  const [katex, setKatex] = useState<KatexApi | null>(() => getLoadedKatex());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const mounted = useRef(true);

  useBackToClose(true, () => { if (!submitting) onClose(); });

  useEffect(() => {
    mounted.current = true;
    dialogRef.current?.showModal();
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    if (!katex) {
      loadWhiteboardKatex()
        .then((loaded) => { if (mounted.current) setKatex(loaded); })
        .catch(() => undefined);
    }
    return () => { mounted.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時に 1 回だけ初期化する。
  }, []);

  const cleaned = useMemo(() => sanitizeFormulaLatex(latex), [latex]);
  const preview = useMemo(() => {
    if (!katex || !cleaned) return null;
    return renderKatex(katex, cleaned, true);
  }, [katex, cleaned]);

  const canSubmit = Boolean(cleaned) && !preview?.error && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const rendered = await renderFormulaToPng(cleaned);
      const uploaded = await uploadImageBlob(rendered.blob, "formula");
      if (!mounted.current) return;
      onSubmit({
        latex: rendered.latex,
        url: uploaded.url,
        mimeType: uploaded.mimeType,
        displayWidth: rendered.displayWidth,
        displayHeight: rendered.displayHeight,
      });
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof StorageLimitError) {
        onClose();
        return;
      }
      setSubmitError(error instanceof Error && error.message ? error.message : msg("Could not render the equation."));
      setSubmitting(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (!submitting) onClose();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  const title = mode === "edit" ? t("Edit equation") : t("Insert equation");

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) onClose();
      }}
      aria-label={title}
      className="notes-dialog whiteboard-formula-dialog"
    >
      <div className="flex items-center gap-2">
        <Sigma size={18} aria-hidden="true" className="text-[var(--notion-muted)]" />
        <h2 className="text-base font-semibold">{title}</h2>
      </div>

      <div className="whiteboard-formula-preview" dir="ltr" aria-label={t("Formula preview")}>
        {!cleaned ? (
          <span className="whiteboard-formula-placeholder">{t("Formula preview")}</span>
        ) : preview?.html ? (
          <div className="whiteboard-formula-card" dangerouslySetInnerHTML={{ __html: preview.html }} />
        ) : (
          <code className="whiteboard-formula-fallback">{cleaned}</code>
        )}
      </div>

      <label className="notes-dialog-subtitle block" htmlFor="whiteboard-formula-input">
        {t("TeX source")}
      </label>
      <textarea
        id="whiteboard-formula-input"
        ref={inputRef}
        dir="ltr"
        rows={3}
        maxLength={MAX_WHITEBOARD_FORMULA_LATEX}
        className="notes-dialog-input whiteboard-formula-input"
        value={latex}
        placeholder={t("Enter a TeX equation…")}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        disabled={submitting}
        onChange={(event) => {
          setLatex(event.target.value);
          setSubmitError(null);
        }}
        onKeyDown={onKeyDown}
      />

      {(preview?.error || submitError) && (
        <p role="alert" className="whiteboard-formula-error">
          {preview?.error ?? localizeSystemText(submitError!, t)}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="notion-button" disabled={submitting} onClick={onClose}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          className="notion-button notion-button-primary"
          disabled={!canSubmit}
          onClick={() => { void handleSubmit(); }}
        >
          {mode === "edit" ? t("Save") : t("Insert")}
        </button>
      </div>
    </dialog>
  );
}
