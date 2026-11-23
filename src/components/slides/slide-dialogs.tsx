"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText } from "@/lib/i18n/translate";
import { copyChatImage, generateSlideImage, type GenerateSize, type SlideImage } from "@/lib/slides/images";
import { StorageLimitError } from "@/lib/usage-plans";

// スライドのエディターのダイアログ：チャットの画像から選ぶ・AI で画像を作る・AI の画像を報告する。

function Modal({ label, onClose, children, className = "" }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-label={label} className={`notes-dialog slides-dialog ${className}`}>{children}</dialog>;
}

type ChatImage = { id: string; filename: string; sessionTitle: string; createdAt: string };

// チャットで送った・作った画像の一覧（新しい順）から選んで、スライドに置く。
export function ChatImagesDialog({ onPicked, onClose }: { onPicked: (image: SlideImage) => void; onClose: () => void }) {
  const t = useT();
  const [images, setImages] = useState<ChatImage[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pages/chat-images", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { images?: ChatImage[]; error?: string } | null;
        if (!response.ok) throw new Error(data?.error || t("Could not load images."));
        if (!cancelled) setImages(data?.images ?? []);
      })
      .catch((caught) => { if (!cancelled) { setError(caught instanceof Error ? caught.message : t("Could not load images.")); setImages([]); } });
    return () => { cancelled = true; };
  }, [t]);
  async function pick(id: string) {
    setBusy(id);
    setError("");
    try { onPicked(await copyChatImage(id)); onClose(); }
    catch (caught) { if (!(caught instanceof StorageLimitError)) setError(caught instanceof Error ? caught.message : t("Could not add the image.")); else onClose(); }
    finally { setBusy(null); }
  }
  return <Modal label={t("Images from chats")} onClose={onClose} className="slides-chat-images">
    <h2 className="text-base font-semibold">{t("Images from chats")}</h2>
    {error && <p role="alert" className="slides-dialog-error">{localizeSystemText(error, t)}</p>}
    {images === null ? <p className="slides-dialog-muted"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> {t("Loading…")}</p>
      : !images.length ? <p className="slides-dialog-muted">{t("No images in your chats yet.")}</p>
      : <ul className="slides-chat-image-grid">
        {images.map((image) => <li key={image.id}>
          <button type="button" disabled={!!busy} onClick={() => void pick(image.id)} title={`${image.sessionTitle} · ${image.filename}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- 自分のチャットの画像（所有者を確かめて返す API）。 */}
            <img src={`/api/attachments/${encodeURIComponent(image.id)}/image`} alt={image.filename} loading="lazy" />
            {busy === image.id && <span className="slides-chat-image-busy"><LoaderCircle size={20} className="animate-spin" aria-hidden="true" /></span>}
            <span className="slides-chat-image-title">{image.sessionTitle}</span>
          </button>
        </li>)}
      </ul>}
    <div className="mt-5 flex justify-end gap-2"><button type="button" className="notion-button" onClick={onClose}>{t("Close")}</button></div>
  </Modal>;
}

const SIZES: { key: GenerateSize; label: string }[] = [
  { key: "1536x1024", label: "Landscape" }, { key: "1024x1024", label: "Square" }, { key: "1024x1536", label: "Portrait" },
];

// AI で画像を作る（生成の回数を 1 回使う。作った画像は note-files に保存され、スライドに置かれる）。
export function GenerateImageDialog({ onGenerated, onClose }: { onGenerated: (image: SlideImage) => void; onClose: () => void }) {
  const t = useT();
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<GenerateSize>("1536x1024");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    try { onGenerated(await generateSlideImage(prompt.trim(), size)); onClose(); }
    catch (caught) { if (caught instanceof StorageLimitError) onClose(); else setError(caught instanceof Error ? caught.message : t("Could not create the image. Try again.")); }
    finally { setBusy(false); }
  }
  return <Modal label={t("Generate an image")} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 className="text-base font-semibold">{t("Generate an image")}</h2>
      <p className="slides-dialog-muted">{t("Describe the image. Each image uses one image generation from your plan.")}</p>
      <textarea autoFocus className="notes-dialog-input slides-prompt" rows={4} maxLength={4000} value={prompt} disabled={busy}
        aria-label={t("Image description")} placeholder={t("A watercolor illustration of a lighthouse at dawn")} onChange={(event) => setPrompt(event.target.value)} />
      <div className="slides-size-choice" role="radiogroup" aria-label={t("Shape")}>
        {SIZES.map((option) => <label key={option.key}>
          <input type="radio" name="slides-image-size" value={option.key} checked={size === option.key} disabled={busy} onChange={() => setSize(option.key)} />
          {option.key === "1536x1024" ? t("Landscape") : option.key === "1024x1024" ? t("Square") : t("Portrait")}
        </label>)}
      </div>
      {error && <p role="alert" className="slides-dialog-error">{localizeSystemText(error, t)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="notion-button" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
        <button type="submit" className="notion-button notion-button-primary inline-flex items-center gap-2" disabled={busy || !prompt.trim()}>
          {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}{busy ? t("Generating…") : t("Generate")}
        </button>
      </div>
    </form>
  </Modal>;
}

// AI で作った画像を開発者へ報告する（Google Play の AI 生成コンテンツの方針）。
export function ReportImageDialog({ pageId, elementId, onClose }: { pageId: string; elementId: string; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  async function submit() {
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId, elementId, reason: reason.trim() }) });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || t("Could not send the report."));
      setState("sent");
    } catch (caught) {
      setState("idle");
      setError(caught instanceof Error ? caught.message : t("Could not send the report."));
    }
  }
  return <Modal label={t("Report image")} onClose={onClose}>
    {state === "sent" ? <>
      <h2 className="text-base font-semibold">{t("Report sent")}</h2>
      <p className="slides-dialog-muted">{t("Thanks. We’ll review this image.")}</p>
      <div className="mt-5 flex justify-end"><button type="button" autoFocus className="notion-button notion-button-primary" onClick={onClose}>{t("Done")}</button></div>
    </> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 className="text-base font-semibold">{t("Report image")}</h2>
      <p className="slides-dialog-muted">{t("Tell us what’s wrong with this AI-generated image (optional).")}</p>
      <textarea className="notes-dialog-input" rows={4} maxLength={1000} value={reason} aria-label={t("Reason")} onChange={(event) => setReason(event.target.value)} />
      {error && <p role="alert" className="slides-dialog-error">{localizeSystemText(error, t)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="notion-button" onClick={onClose}>{t("Cancel")}</button>
        <button type="submit" className="notion-button notion-button-primary" disabled={state === "sending"}>{t("Send report")}</button>
      </div>
    </form>}
  </Modal>;
}
