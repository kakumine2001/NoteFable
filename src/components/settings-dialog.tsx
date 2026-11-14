"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "@/components/chat-project-settings.css";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { useBackToClose } from "@/lib/use-back-to-close";
import { MAX_CUSTOM_INSTRUCTIONS } from "@/types/chat";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}
const errorOf = (data: Record<string, unknown>, fallback: string) => typeof data.error === "string" && data.error ? data.error : fallback;

// ログインした利用者の設定。いまはカスタム指示（すべてのチャットに渡す自分の指示）だけを持つ。
// 見た目はプロジェクト設定のダイアログと同じ部品を使う。
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const titleId = useId();
  const helpId = useId();
  const [attempt, setAttempt] = useState(0);
  // 読み込んだ時点の指示（null は読み込み前）。変えていなければ保存を送らない。
  const [initial, setInitial] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useBackToClose(true, onClose);
  useEffect(() => { ref.current?.showModal(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/custom-instructions", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorOf(data, msg("Could not load your custom instructions.")));
      const text = typeof data.instructions === "string" ? data.instructions : "";
      setInitial(text);
      setInstructions(text);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setLoadError(reason instanceof Error && reason.message ? reason.message : msg("Could not load your custom instructions."));
    });
    return () => controller.abort();
  }, [attempt]);

  async function save() {
    if (initial === null || locked.current) return;
    const text = instructions.trim();
    if (text === initial) { onClose(); return; }
    locked.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/custom-instructions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instructions: text }) });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorOf(data, msg("Could not save your custom instructions. Please try again.")));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : msg("Could not save your custom instructions. Please try again."));
    } finally { locked.current = false; setBusy(false); }
  }

  // サイドバーは幅によって隠れる（デスクトップ用と抽屉用の 2 つがある）ので、その外（body）に出す。
  return createPortal(<dialog ref={ref} aria-labelledby={titleId} className="notes-dialog chat-project-settings"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <form className="project-settings-shell" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="project-settings-header">
        <h2 id={titleId}>{t("Settings")}</h2>
      </div>
      <div className="project-settings-body">
        {initial === null && !loadError && <p className="project-settings-empty" role="status"><LoaderCircle size={14} className="mr-1 inline animate-spin" aria-hidden="true" />{t("Loading…")}</p>}
        {loadError && <>
          <p role="alert" className="project-settings-error">{localizeSystemText(loadError, t)}</p>
          <button type="button" className="notion-button mt-2" onClick={() => { setLoadError(""); setAttempt((count) => count + 1); }}>{t("Try again")}</button>
        </>}
        {initial !== null && <section className="project-settings-section">
          <label htmlFor={`${titleId}-instructions`} className="project-settings-label">
            {t("Custom instructions")}
            <span className="project-settings-count" aria-live="polite">{instructions.length}/{MAX_CUSTOM_INSTRUCTIONS}</span>
          </label>
          <p id={helpId} className="project-settings-help">
            {t("Applied to all your chats from the next message. Tell StudyMate about yourself and how you want it to answer. A project’s instructions take priority inside that project.")}
          </p>
          <textarea id={`${titleId}-instructions`} autoFocus className="project-settings-textarea" value={instructions} disabled={busy}
            maxLength={MAX_CUSTOM_INSTRUCTIONS} aria-describedby={helpId}
            placeholder={t("Example: I’m preparing for the JLPT N1. Explain grammar with short examples, and keep answers brief.")}
            onChange={(event) => setInstructions(event.target.value)} />
        </section>}
        {error && <p role="alert" className="project-settings-error">{localizeSystemText(error, t)}</p>}
      </div>
      <div className="project-settings-footer">
        <button type="button" disabled={busy} className="notion-button" onClick={onClose}>{t("Cancel")}</button>
        <button type="submit" disabled={busy || initial === null} className="notion-button notion-button-primary">{busy ? t("Saving…") : t("Save")}</button>
      </div>
    </form>
  </dialog>, document.body);
}
