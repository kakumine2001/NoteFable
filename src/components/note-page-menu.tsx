"use client";

import { Copy, Ellipsis, FilePlus2, FolderInput, Lock, Star, StarOff, Trash2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { AnswerMenu } from "@/components/answer-actions";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { pageSettingsOf, type NotePageFont, type NotePageSettings, type NotePageSummary } from "@/types/notes";

const FONTS: { key: NotePageFont; label: string }[] = [
  { key: "default", label: msg("Default") }, { key: "serif", label: msg("Serif") }, { key: "mono", label: msg("Mono") },
];

// 切り替え（小さな文字・全幅・ロック）。Notion と同じく右端にスイッチを出す。
function ToggleItem({ icon, label, checked, onToggle }: { icon?: ReactNode; label: string; checked: boolean; onToggle: () => void }) {
  return <button type="button" role="menuitemcheckbox" aria-checked={checked} className="chat-menu-item notes-menu-toggle" onClick={onToggle}>
    {icon}<span className="flex-1">{label}</span><span className="notes-menu-switch" data-on={checked} aria-hidden="true" />
  </button>;
}

// ノートの上部バーの「…」（Notion のページメニュー）。表示設定・ロック・お気に入り・複製・サブページ・移動・ゴミ箱。
export function NotePageMenu({ page, busy, error, onSettings, onFavorite, onDuplicate, onAddSubpage, onMove, onTrash }: {
  page: NotePageSummary;
  busy: boolean;
  error: string;
  onSettings: (settings: Partial<NotePageSettings>) => void;
  onFavorite: (favorite: boolean) => void;
  onDuplicate: () => void;
  onAddSubpage: () => void;
  onMove: () => void;
  onTrash: () => void;
}) {
  const t = useT();
  const id = useId();
  const [menu, setMenu] = useState<{ anchor: DOMRect; trigger: HTMLButtonElement; focusLast: boolean } | null>(null);
  const settings = pageSettingsOf(page);
  const close = () => setMenu(null);
  // 操作を選んだらメニューを閉じてから実行する（ダイアログ・画面遷移と重ならないように）。
  const run = (action: () => void) => () => { close(); action(); };
  return <>
    <button type="button" className="notion-icon-button grid" disabled={busy} aria-label={t("Page options")} title={t("Page options")}
      aria-haspopup="menu" aria-expanded={!!menu} aria-controls={id}
      onClick={(event) => setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: false })}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        setMenu({ anchor: event.currentTarget.getBoundingClientRect(), trigger: event.currentTarget, focusLast: event.key === "ArrowUp" });
      }}>
      <Ellipsis size={20} />
    </button>
    {menu && <AnswerMenu id={id} label={t("Page options")} className="notes-page-menu" anchor={menu.anchor} trigger={menu.trigger} focusLast={menu.focusLast} onClose={close}>
      <div className="notes-menu-label">{t("Style")}</div>
      <div className="notes-menu-fonts">
        {FONTS.map((font) => <button key={font.key} type="button" role="menuitemradio" aria-checked={settings.font === font.key}
          className={`notes-menu-font font-${font.key}`} onClick={() => onSettings({ font: font.key })}>
          <span className="notes-menu-font-sample" aria-hidden="true">Ag</span>{t(font.label)}
        </button>)}
      </div>
      <hr className="chat-menu-divider" />
      <ToggleItem label={t("Small text")} checked={settings.smallText} onToggle={() => onSettings({ smallText: !settings.smallText })} />
      <ToggleItem label={t("Full width")} checked={settings.fullWidth} onToggle={() => onSettings({ fullWidth: !settings.fullWidth })} />
      <ToggleItem icon={<Lock size={16} aria-hidden="true" />} label={t("Lock page")} checked={settings.locked} onToggle={() => onSettings({ locked: !settings.locked })} />
      <hr className="chat-menu-divider" />
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(() => onFavorite(!page.favoritedAt))}>
        {page.favoritedAt ? <StarOff size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" />}
        {page.favoritedAt ? t("Remove from Favorites") : t("Add to Favorites")}
      </button>
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(onDuplicate)}><Copy size={16} aria-hidden="true" />{t("Duplicate")}</button>
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(onAddSubpage)}><FilePlus2 size={16} aria-hidden="true" />{t("Add a page inside")}</button>
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(onMove)}><FolderInput size={16} aria-hidden="true" />{t("Move to")}</button>
      <hr className="chat-menu-divider" />
      <button type="button" role="menuitem" className="chat-menu-item is-danger" onClick={run(onTrash)}><Trash2 size={16} aria-hidden="true" />{t("Move to Trash")}</button>
      {error && <p role="alert" className="answer-menu-error">{localizeSystemText(error, t)}</p>}
    </AnswerMenu>}
  </>;
}
