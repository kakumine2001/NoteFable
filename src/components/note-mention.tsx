"use client";

import { createReactInlineContentSpec } from "@blocknote/react";
import { CalendarDays, FileText } from "lucide-react";
import { createContext, useContext, useRef } from "react";
import { useI18n } from "@/components/i18n-provider";
import { isNoteDate } from "@/lib/note-mention";

// Notion の「@」メンション: ページへのリンク（いまのタイトルとアイコンを表示し、押すとそのページを開く）と日付。
export type MentionPage = { id: string; title: string; icon: string | null };

export type NoteMentionContextValue = {
  // 自分のページの一覧。まだ読んでいない間は null（/note-embed では「@」を初めて打った時に読む）。
  pages: MentionPage[] | null;
  loadPages: () => void;
  openPage: (id: string) => void;
};

export const NoteMentionContext = createContext<NoteMentionContextValue>({ pages: null, loadPages: () => {}, openPage: () => {} });

export function formatNoteDate(date: string, locale: string) {
  if (!isNoteDate(date)) return date;
  const [year, month, day] = date.split("-").map(Number);
  try {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
  } catch { return date; }
}

export const createMentionSpec = createReactInlineContentSpec(
  {
    type: "mention",
    // kind が page のときは pageId と title（作った時のタイトル。ページが見つからない時に出す）、date のときは date（YYYY-MM-DD）。
    propSchema: { kind: { default: "page" }, pageId: { default: "" }, title: { default: "" }, date: { default: "" } },
    content: "none",
  },
  {
    render: function Mention({ inlineContent, updateInlineContent, editor }) {
      const { t, locale } = useI18n();
      const { pages, openPage } = useContext(NoteMentionContext);
      const dateInput = useRef<HTMLInputElement>(null);
      const { kind, pageId, title, date } = inlineContent.props;
      if (kind === "date") {
        return <span className="note-mention note-mention-date" contentEditable={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const input = dateInput.current;
            if (!input || !editor.isEditable) return;
            try { input.showPicker(); } catch { input.focus(); }
          }}>
          <span className="note-mention-at">@</span>{formatNoteDate(date, locale)}
          <input ref={dateInput} type="date" className="note-mention-date-input" tabIndex={-1} aria-label={t("Change date")} value={isNoteDate(date) ? date : ""}
            onChange={(event) => { if (isNoteDate(event.target.value)) updateInlineContent({ type: "mention", props: { ...inlineContent.props, date: event.target.value } }); }} />
        </span>;
      }
      const page = pages?.find((entry) => entry.id === pageId);
      // 一覧にない（ゴミ箱・削除済み・他の人のページ）ときは、作った時のタイトルを薄く出す。
      const missing = pages !== null && !page;
      const label = page?.title || title || t("Untitled");
      return <a className={`note-mention note-mention-page${missing ? " is-missing" : ""}`} contentEditable={false} href={`/app?view=pages&page=${encodeURIComponent(pageId)}`}
        title={missing ? t("This page is not available") : label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => { event.preventDefault(); if (!missing) openPage(pageId); }}>
        <span className="note-mention-icon" aria-hidden>{page?.icon ?? <FileText size={14} strokeWidth={1.8} />}</span>
        <span className="note-mention-title">{label}</span>
      </a>;
    },
  },
);

export const MentionDateIcon = () => <CalendarDays size={18} />;
