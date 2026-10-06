"use client";

import { ImageIcon, Shuffle, Smile, Upload } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import { MAX_COVER_BYTES, NOTE_COVERS, isPresetCover, uploadedCoverPath, type NoteCover } from "@/lib/note-document";
import type { NoteContent } from "@/types/notes";

// よく使う絵文字だけを並べる。Notion の「Emoji」タブの簡易版。
const EMOJIS = [
  "📄", "📝", "📒", "📓", "📔", "📕", "📗", "📘", "📙", "📚", "🗂️", "📁", "📌", "📎", "🔖", "🏷️",
  "✏️", "🖊️", "🖋️", "✒️", "📐", "📏", "🧮", "🧪", "🔬", "🔭", "💡", "🧠", "🎯", "🚀", "⭐", "🌟",
  "✅", "☑️", "❗", "❓", "⚠️", "🔥", "💯", "🎉", "🏆", "🥇", "📈", "📊", "🗓️", "⏰", "⌛", "🕒",
  "💻", "🖥️", "⌨️", "🖱️", "📱", "🔧", "🛠️", "⚙️", "🧩", "🔑", "🔒", "🌐", "📡", "🤖", "👾", "🐛",
  "🗾", "🏯", "🗼", "⛩️", "🍣", "🍜", "🍵", "☕", "🍙", "🍱", "🍎", "🍊",
  "🌸", "🌱", "🌿", "🍀", "🌳", "🌊", "⛰️", "🌙", "☀️", "🌈", "❄️", "⚡", "🎵", "🎨", "🎬", "📷",
  "😀", "😄", "😊", "🙂", "😎", "🤔", "😴", "🥳", "😭", "😤", "🙏", "👍", "👀", "💪", "❤️", "💬",
  "🐱", "🐶", "🐼", "🦊", "🐧", "🐢", "🦄", "🐝",
];

const COVER_LABELS: Record<NoteCover, string> = {
  "gradient-sunset": "Sunset", "gradient-peach": "Peach", "gradient-mint": "Mint", "gradient-ocean": "Ocean",
  "gradient-lavender": "Lavender", "gradient-night": "Night", "solid-red": "Red", "solid-yellow": "Yellow",
  "solid-green": "Green", "solid-blue": "Blue", "solid-purple": "Purple", "solid-beige": "Beige",
};
const COVER_KEYS = Object.keys(NOTE_COVERS) as NoteCover[];

function randomOf<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export function coverImageUrl(cover: string | null) {
  const upload = uploadedCoverPath(cover);
  return upload ? `/api/pages/covers?key=${encodeURIComponent(upload.path)}` : null;
}

// 外側クリックと Esc で閉じる小さなポップオーバー。開閉ボタン自身のクリックは外側扱いにしない。
function Popover({ className, onClose, children }: { className: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    function onDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest("[data-popover-trigger]")) closeRef.current();
    }
    function onKey(event: globalThis.KeyboardEvent) { if (event.key === "Escape") closeRef.current(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);
  return <div ref={ref} className={`notes-popover ${className}`} role="dialog">{children}</div>;
}

export function NotePageHeader({ content, editable, titleRef, onPatch, onTitleKeyDown }: {
  content: NoteContent;
  editable: boolean;
  titleRef: Ref<HTMLTextAreaElement>;
  // 連続操作でも古い内容で上書きしないよう、変更分だけを渡す。
  onPatch: (patch: Partial<NoteContent>) => void;
  onTitleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const [picker, setPicker] = useState<"icon" | "cover" | null>(null);
  // 位置調整中だけ値を持つ。保存するまでページ本文には反映しない。
  const [reposition, setReposition] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startPosition: number; height: number } | null>(null);
  const preset = isPresetCover(content.cover) ? NOTE_COVERS[content.cover] : null;
  const imageUrl = coverImageUrl(content.cover);
  const hasCover = !!(preset || imageUrl);
  const position = reposition ?? content.coverPosition ?? 50;
  const update = onPatch;
  const close = () => setPicker(null);

  function onCoverPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (reposition === null || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startPosition: reposition, height: event.currentTarget.clientHeight };
  }
  function onCoverPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    // 下へドラッグすると画像の上側が見えるよう、位置の割合を減らす。
    const delta = ((event.clientY - drag.current.startY) / drag.current.height) * 100;
    setReposition(Math.round(Math.min(100, Math.max(0, drag.current.startPosition - delta))));
  }

  return (
    <div className={`notes-page-header ${hasCover ? "has-cover" : ""} ${content.icon ? "has-icon" : ""}`}>
      {hasCover && (
        <div className={`notes-cover ${reposition !== null ? "is-repositioning" : ""}`} style={preset ? { background: preset } : undefined}
          onPointerDown={onCoverPointerDown} onPointerMove={onCoverPointerMove} onPointerUp={() => { drag.current = null; }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 所有者確認付き API から返す private 画像のため next/image の最適化は使わない */}
          {imageUrl && <img src={imageUrl} alt="" draggable={false} className="notes-cover-image" style={{ objectPosition: `center ${position}%` }} />}
          {reposition !== null && <div className="notes-cover-hint">Drag image to reposition</div>}
          {editable && (
            <div className="notes-cover-actions">
              {reposition !== null ? <>
                <button type="button" onClick={() => { update({ coverPosition: reposition }); setReposition(null); }}>Save position</button>
                <button type="button" onClick={() => setReposition(null)}>Cancel</button>
              </> : <>
                <button type="button" data-popover-trigger onClick={() => setPicker(picker === "cover" ? null : "cover")}>Change cover</button>
                {imageUrl && <button type="button" onClick={() => { close(); setReposition(content.coverPosition ?? 50); }}>Reposition</button>}
                <button type="button" onClick={() => { close(); update({ cover: null, coverPosition: null }); }}>Remove</button>
              </>}
            </div>
          )}
          {picker === "cover" && (
            <Popover className="notes-cover-picker" onClose={close}>
              <CoverPicker current={content.cover}
                onPick={(cover) => { update({ cover, coverPosition: isPresetCover(cover) ? null : 50 }); close(); }} />
            </Popover>
          )}
        </div>
      )}
      <div className="notes-column notes-header-inner">
        {content.icon && (
          <div className="notes-icon-wrap">
            <button type="button" className="notes-icon" disabled={!editable} aria-label="Change icon" data-popover-trigger
              onClick={() => setPicker(picker === "icon" ? null : "icon")}>{content.icon}</button>
            {picker === "icon" && (
              <Popover className="notes-icon-picker" onClose={close}>
                <div className="notes-picker-bar">
                  <span>Emoji</span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => update({ icon: randomOf(EMOJIS) })}><Shuffle size={13} />Random</button>
                    <button type="button" onClick={() => { update({ icon: null }); close(); }}>Remove</button>
                  </div>
                </div>
                <div className="notes-emoji-grid">
                  {EMOJIS.map((emoji) => (
                    <button key={emoji} type="button" className={emoji === content.icon ? "is-active" : ""}
                      onClick={() => { update({ icon: emoji }); close(); }}>{emoji}</button>
                  ))}
                </div>
              </Popover>
            )}
          </div>
        )}
        {editable && (
          <div className="notes-header-controls">
            {!content.icon && (
              <button type="button" onClick={() => update({ icon: randomOf(EMOJIS) })}><Smile size={15} />Add icon</button>
            )}
            {!hasCover && (
              <button type="button" onClick={() => update({ cover: randomOf(COVER_KEYS), coverPosition: null })}><ImageIcon size={15} />Add cover</button>
            )}
          </div>
        )}
        <textarea ref={titleRef} rows={1} className="notes-title" aria-label="Page title" maxLength={200} placeholder="Untitled"
          value={content.title === "Untitled" ? "" : content.title} disabled={!editable}
          onChange={(event) => update({ title: event.target.value.replace(/\r?\n/g, " ") })}
          onKeyDown={onTitleKeyDown} />
      </div>
    </div>
  );
}

// Notion と同じく「Gallery / Upload」の 2 タブ。アップロードは保存後のキーだけを返す。
function CoverPicker({ current, onPick }: { current: string | null; onPick: (cover: string) => void }) {
  const [tab, setTab] = useState<"gallery" | "upload">("gallery");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // 選択画面を閉じた・別のカバーを選んだ後に届いたアップロード結果で、新しい選択を上書きしない。
  const uploadRef = useRef<AbortController | null>(null);
  useEffect(() => () => uploadRef.current?.abort(), []);

  async function upload(file: File) {
    setError("");
    if (file.size > MAX_COVER_BYTES) { setError("Cover images must be 4 MB or smaller."); return; }
    uploadRef.current?.abort();
    const controller = new AbortController();
    uploadRef.current = controller;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/pages/covers", { method: "POST", body, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.cover !== "string") throw new Error(data.error || "Upload failed. Try again.");
      if (!controller.signal.aborted) onPick(data.cover);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Upload failed. Try again.");
    } finally { if (uploadRef.current === controller) { uploadRef.current = null; setUploading(false); } }
  }

  return (
    <>
      <div className="notes-picker-tabs" role="tablist">
        {(["gallery", "upload"] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>
            {key === "gallery" ? "Gallery" : "Upload"}
          </button>
        ))}
      </div>
      {tab === "gallery" ? (
        <div className="notes-cover-grid">
          {COVER_KEYS.map((key) => (
            <button key={key} type="button" title={COVER_LABELS[key]} aria-label={COVER_LABELS[key]}
              className={key === current ? "is-active" : ""} style={{ background: NOTE_COVERS[key] }}
              onClick={() => { uploadRef.current?.abort(); onPick(key); }} />
          ))}
        </div>
      ) : (
        <div className="notes-cover-upload">
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Upload size={14} />{uploading ? "Uploading…" : "Upload file"}
          </button>
          <p>Images wider than 1500 pixels work best. JPEG, PNG, WebP or GIF, up to 4 MB.</p>
          {error && <p className="notes-cover-error" role="alert">{error}</p>}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
        </div>
      )}
    </>
  );
}
