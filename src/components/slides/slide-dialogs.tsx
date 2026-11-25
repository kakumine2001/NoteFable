"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { GuestLimitPrompt, UpgradePrompt } from "@/components/guest-limit-prompt";
import { useT } from "@/components/i18n-provider";
import { useAccount } from "@/lib/account-store";
import { localizeSystemText } from "@/lib/i18n/translate";
import { nativeCanShowUsageLimit, postToNative } from "@/lib/native-bridge";
import { keepRejectedDraft, savePendingDraft, takePendingDraft, useKeepDraftOnLeave } from "@/lib/pending-draft";
import { useBackToClose } from "@/lib/use-back-to-close";
import { copyChatImage, generateSlideImage, type GenerateSize, type SlideImage } from "@/lib/slides/images";
import { StorageLimitError, UsageLimitError } from "@/lib/usage-plans";

// スライドのエディターのダイアログ：チャットの画像から選ぶ・AI で画像を作る・AI の画像を報告する。

// busy の間は閉じない（「戻る」・Esc も）。
function Modal({ label, onClose, children, className = "", busy = false }: { label: string; onClose: () => void; children: ReactNode; className?: string; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  // スマホのブラウザの「戻る」で閉じる（AGENTS.md：戻るキーが要るパネルは履歴を積む）。
  useBackToClose(true, () => (busy ? false : onClose()));
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-label={label} className={`notes-dialog slides-dialog ${className}`}>{children}</dialog>;
}

type ChatImage = { id: string; filename: string; sessionTitle: string; createdAt: string };

// チャットで送った・作った画像の一覧（新しい順）から選んで、スライドに置く。
export function ChatImagesDialog({ onPicked, onClose }: { onPicked: (image: SlideImage) => void; onClose: () => void }) {
  const t = useT();
  const [images, setImages] = useState<ChatImage[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // 閉じたあとに写し終えた画像は置かない。
  const open = useRef(true);
  useEffect(() => () => { open.current = false; }, []);
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
    try { const image = await copyChatImage(id); if (!open.current) return; onPicked(image); onClose(); }
    catch (caught) { if (!(caught instanceof StorageLimitError)) setError(caught instanceof Error ? caught.message : t("Could not add the image.")); else onClose(); }
    finally { setBusy(null); }
  }
  return <Modal label={t("Images from chats")} onClose={onClose} className="slides-chat-images" busy={!!busy}>
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
export function GenerateImageDialog({ pageId, embedded = false, onGenerated, onClose }: { pageId: string; embedded?: boolean; onGenerated: (image: SlideImage) => void; onClose: () => void }) {
  const t = useT();
  const formId = useId();
  const { account } = useAccount();
  const draftScope = `slides-image:${pageId}`;
  const [prompt, setPrompt] = useState(() => takePendingDraft(draftScope));
  const [size, setSize] = useState<GenerateSize>("1536x1024");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [usageLimit, setUsageLimit] = useState<UsageLimitError | null>(null);
  const limitHitRef = useRef(Boolean(prompt));
  const dialogMountedRef = useKeepDraftOnLeave(draftScope, () => (limitHitRef.current ? prompt : null), { persistent: embedded });
  useEffect(() => {
    if (!embedded || !limitHitRef.current) return;
    savePendingDraft(draftScope, prompt, { persistent: true });
  }, [embedded, draftScope, prompt]);

  const showGuestPrompt = !embedded && usageLimit?.tier === "guest" && Boolean(account?.configured && !account.user);
  const showUpgradePrompt = !embedded && usageLimit?.tier === "member" && Boolean(account?.billing && account.user);
  const limitFallbackMessage = usageLimit && !showGuestPrompt && !showUpgradePrompt ? usageLimit.message : "";

  async function submit() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    setUsageLimit(null);
    try {
      onGenerated(await generateSlideImage(prompt.trim(), size));
      limitHitRef.current = false;
      savePendingDraft(draftScope, "", { persistent: embedded });
      onClose();
    } catch (caught) {
      if (caught instanceof StorageLimitError) {
        limitHitRef.current = true;
        savePendingDraft(draftScope, prompt, { persistent: embedded });
        onClose();
      } else if (caught instanceof UsageLimitError) {
        limitHitRef.current = true;
        if (!dialogMountedRef.current) {
          keepRejectedDraft(draftScope, prompt.trim(), { persistent: embedded });
          return;
        }
        if (embedded) savePendingDraft(draftScope, prompt, { persistent: true });
        if (embedded) {
          if (nativeCanShowUsageLimit()) {
            postToNative({ type: "usageLimit", tier: caught.tier, kind: "image", pageId });
          }
          // 入力途中のプロンプトを残したまま、ダイアログ内にも理由を示す（新アプリはネイティブの案内も上部に出る）。
          setError(caught.message);
        } else {
          setUsageLimit(caught);
        }
      } else {
        setError(caught instanceof Error ? caught.message : t("Could not create the image. Try again."));
      }
    } finally {
      setBusy(false);
    }
  }
  return <Modal label={t("Generate an image")} onClose={() => { if (!busy) onClose(); }} busy={busy}>
    <form id={formId} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
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
    </form>
    {/* メールログインの入力フォームを画像生成フォームに入れ子にしないよう、上限の案内は form の外に出す。 */}
    {showGuestPrompt && <GuestLimitPrompt kind="image" onClose={() => setUsageLimit(null)} onBeforeSignIn={() => savePendingDraft(draftScope, prompt)} />}
    {showUpgradePrompt && <UpgradePrompt kind="image" onClose={() => setUsageLimit(null)} onBeforeUpgrade={() => savePendingDraft(draftScope, prompt)} />}
    {(error || limitFallbackMessage) && <p role="alert" className="slides-dialog-error">{localizeSystemText(error || limitFallbackMessage, t)}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="notion-button" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
      <button type="submit" form={formId} className="notion-button notion-button-primary inline-flex items-center gap-2" disabled={busy || !prompt.trim()}>
        {busy && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}{busy ? t("Generating…") : t("Generate")}
      </button>
    </div>
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
