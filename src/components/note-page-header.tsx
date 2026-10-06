"use client";

import { ImageIcon, Shuffle, Smile } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { NOTE_COVERS, type NoteCover } from "@/lib/note-document";
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

// 外側クリックと Esc で閉じる小さなポップオーバー。
function Popover({ className, onClose, children }: { className: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(event: MouseEvent) { if (!ref.current?.contains(event.target as Node)) onClose(); }
    function onKey(event: globalThis.KeyboardEvent) { if (event.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
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
  const cover = content.cover && content.cover in NOTE_COVERS ? NOTE_COVERS[content.cover as NoteCover] : null;
  const update = onPatch;
  const close = () => setPicker(null);

  return (
    <div className={`notes-page-header ${cover ? "has-cover" : ""} ${content.icon ? "has-icon" : ""}`}>
      {cover && (
        <div className="notes-cover" style={{ background: cover }}>
          {editable && (
            <div className="notes-cover-actions">
              <button type="button" onClick={() => setPicker(picker === "cover" ? null : "cover")}>Change cover</button>
              <button type="button" onClick={() => update({ cover: null })}>Remove</button>
            </div>
          )}
          {picker === "cover" && (
            <Popover className="notes-cover-picker" onClose={close}>
              <CoverGrid current={content.cover} onPick={(key) => { update({ cover: key }); close(); }} />
            </Popover>
          )}
        </div>
      )}
      <div className="notes-column notes-header-inner">
        {content.icon && (
          <div className="notes-icon-wrap">
            <button type="button" className="notes-icon" disabled={!editable} aria-label="Change icon"
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
            {!content.cover && (
              <button type="button" onClick={() => update({ cover: randomOf(COVER_KEYS) })}><ImageIcon size={15} />Add cover</button>
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

function CoverGrid({ current, onPick }: { current: string | null; onPick: (key: NoteCover) => void }) {
  return (
    <>
      <div className="notes-picker-bar"><span>Gallery</span></div>
      <div className="notes-cover-grid">
        {COVER_KEYS.map((key) => (
          <button key={key} type="button" title={COVER_LABELS[key]} aria-label={COVER_LABELS[key]}
            className={key === current ? "is-active" : ""} style={{ background: NOTE_COVERS[key] }} onClick={() => onPick(key)} />
        ))}
      </div>
    </>
  );
}
