"use client";

import { BookOpenCheck, Copy, Download, Ellipsis, FilePlus2, Flag, FolderInput, LoaderCircle, Lock, Presentation, Star, StarOff, Trash2, Workflow } from "lucide-react";
import { useCallback, useId, useState, type ReactNode } from "react";
import { AnswerMenu, ReportDialog } from "@/components/answer-actions";
import { useDiagramJob } from "@/components/draw-diagram-dialog";
import { diagramKey } from "@/lib/draw-diagram-jobs";
import { useSlidesJobState } from "@/components/slides-wizard";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg } from "@/lib/i18n/translate";
import { pageKindFeatures, pageKindOf } from "@/lib/page-kinds";
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

// ノートの上部バーの「…」（Notion のページメニュー）。表示設定・ロック・お気に入り・複製・サブページ・移動・書き出し・ゴミ箱。
// ページの種類で出す項目を変える：書体・小さい文字・全幅・Markdown の書き出しはノートだけ（PAGE_KIND_FEATURES）。
// AI が内容を書いたページ（aiUpdatedAt あり）には「AI の内容を報告」を出す（Google Play の AI 生成コンテンツのポリシー）。
// 「画成図」はノートだけ（ホワイトボード・スライドには出さない）。押したらノートを保存してから始める（onDrawDiagram）。
// 「Generate slides」もノートだけ。このノートを材料にした AI のスライド生成の窓を開く（onGenerateSlides）。
export function NotePageMenu({ page, busy, error, onSettings, onPresent, onFavorite, onDuplicate, onAddSubpage, onDrawDiagram, onGenerateSlides, onReviewQuiz, onMove, onExport, onTrash }: {
  page: NotePageSummary;
  busy: boolean;
  error: string;
  onSettings: (settings: Partial<NotePageSettings>) => void;
  onPresent?: () => void;
  onFavorite: (favorite: boolean) => void;
  onDuplicate: () => void;
  onAddSubpage: () => void;
  onDrawDiagram?: () => void;
  onGenerateSlides?: () => void;
  onReviewQuiz?: () => void;
  onMove: () => void;
  onExport?: () => void;
  onTrash: () => void;
}) {
  const t = useT();
  const id = useId();
  const [menu, setMenu] = useState<{ anchor: DOMRect; trigger: HTMLButtonElement; focusLast: boolean } | null>(null);
  const [reporting, setReporting] = useState(false);
  const settings = pageSettingsOf(page);
  const kind = pageKindOf(page);
  const features = pageKindFeatures(kind);
  const canDraw = !!onDrawDiagram && kind === "note";
  const diagram = useDiagramJob(canDraw ? diagramKey({ type: "note", pageId: page.id }) : null);
  const canGenerate = !!onGenerateSlides && kind === "note";
  const generating = useSlidesJobState(canGenerate ? `note:${page.id}` : null) === "working";
  const canQuiz = !!onReviewQuiz && (kind === "note" || kind === "slides");
  const close = useCallback(() => setMenu(null), []);
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
      {features.typography && <>
        <div className="notes-menu-label">{t("Style")}</div>
        <div className="notes-menu-fonts">
          {FONTS.map((font) => <button key={font.key} type="button" role="menuitemradio" aria-checked={settings.font === font.key}
            className={`notes-menu-font notes-font-${font.key}`} onClick={() => onSettings({ font: font.key })}>
            <span className="notes-menu-font-sample" aria-hidden="true">Ag</span>{t(font.label)}
          </button>)}
        </div>
        <hr className="chat-menu-divider" />
        <ToggleItem label={t("Small text")} checked={settings.smallText} onToggle={() => onSettings({ smallText: !settings.smallText })} />
        <ToggleItem label={t("Full width")} checked={settings.fullWidth} onToggle={() => onSettings({ fullWidth: !settings.fullWidth })} />
      </>}
      <ToggleItem icon={<Lock size={16} aria-hidden="true" />} label={t("Lock page")} checked={settings.locked} onToggle={() => onSettings({ locked: !settings.locked })} />
      <hr className="chat-menu-divider" />
      {onPresent && kind === "note" && (
        <button type="button" role="menuitem" className="chat-menu-item" onClick={run(onPresent)}>
          <Presentation size={16} aria-hidden="true" />{t("Present")}
        </button>
      )}
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(() => onFavorite(!page.favoritedAt))}>
        {page.favoritedAt ? <StarOff size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" />}
        {page.favoritedAt ? t("Remove from Favorites") : t("Add to Favorites")}
      </button>
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(onDuplicate)}><Copy size={16} aria-hidden="true" />{t("Duplicate")}</button>
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(onAddSubpage)}><FilePlus2 size={16} aria-hidden="true" />{t("Add a page inside")}</button>
      {canDraw && onDrawDiagram && <button type="button" role="menuitem" className="chat-menu-item" aria-busy={diagram?.status === "working"} onClick={run(onDrawDiagram)}>
        {diagram?.status === "working" ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Workflow size={16} aria-hidden="true" />}
        {diagram?.status === "working" ? t("Drawing a diagram…") : t("Draw as diagram")}
      </button>}
      {canGenerate && onGenerateSlides && <button type="button" role="menuitem" className="chat-menu-item" aria-haspopup="dialog" aria-busy={generating} onClick={run(onGenerateSlides)}>
        {generating ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Presentation size={16} aria-hidden="true" />}
        {generating ? t("Generating slides…") : t("Generate slides")}
      </button>}
      {canQuiz && onReviewQuiz && <button type="button" role="menuitem" className="chat-menu-item" aria-haspopup="dialog" onClick={run(onReviewQuiz)}>
        <BookOpenCheck size={16} aria-hidden="true" />{t("Review & quiz")}
      </button>}
      <button type="button" role="menuitem" className="chat-menu-item" onClick={run(onMove)}><FolderInput size={16} aria-hidden="true" />{t("Move to")}</button>
      {onExport && features.markdownExport && <button type="button" role="menuitem" className="chat-menu-item" onClick={run(onExport)}><Download size={16} aria-hidden="true" />{t("Export Markdown")}</button>}
      {page.aiUpdatedAt && <button type="button" role="menuitem" className="chat-menu-item" onClick={run(() => setReporting(true))}><Flag size={16} aria-hidden="true" />{t("Report AI content")}</button>}
      <hr className="chat-menu-divider" />
      <button type="button" role="menuitem" className="chat-menu-item is-danger" onClick={run(onTrash)}><Trash2 size={16} aria-hidden="true" />{t("Move to Trash")}</button>
      {error && <p role="alert" className="answer-menu-error">{localizeSystemText(error, t)}</p>}
    </AnswerMenu>}
    {reporting && <ReportDialog target={{ pageId: page.id }} onClose={() => setReporting(false)} />}
  </>;
}
