import { ArrowUpRight, Check, ChevronRight, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/components/i18n-provider";
import type { NoteSaveQueue } from "@/lib/note-save-queue";
import { CHAT_RECENT_COUNT } from "@/types/notes";
import { recentPages } from "@/lib/notes-home-text";
import { MAX_MESSAGE_NOTES, type AttachedPage } from "@/types/chat";
import { NoteIcon } from "@/components/note-icon";

type RecentNote = AttachedPage & { updatedAt: string };

export function ChatRecentNotes({ selected, disabled, lastEditor, onToggle, onOpen, onViewAll }: {
  selected: AttachedPage[];
  disabled: boolean;
  lastEditor?: NoteSaveQueue;
  onToggle: (page: AttachedPage) => void;
  onOpen: (id: string) => void;
  onViewAll: () => void;
}) {
  const t = useT();
  const [pages, setPages] = useState<RecentNote[]>([]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const invalidate = () => setRevision((value) => value + 1);
    window.addEventListener("notefable:page-created", invalidate);
    window.addEventListener("notefable:page-updated", invalidate);
    return () => {
      window.removeEventListener("notefable:page-created", invalidate);
      window.removeEventListener("notefable:page-updated", invalidate);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      // Leaving the editor can start a save. Fetch after it so the edited note ranks first.
      if (lastEditor) await lastEditor.flush();
      if (controller.signal.aborted) return;
      const response = await fetch("/api/pages?recent=1", { cache: "no-store", signal: controller.signal });
      if (!response.ok) return;
      const data = await response.json();
      if (!controller.signal.aborted && Array.isArray(data.pages)) setPages(recentPages<RecentNote>(data.pages, CHAT_RECENT_COUNT));
    }
    void load().catch(() => { /* The optional shortcuts stay hidden when notes are unavailable. */ });
    return () => controller.abort();
  }, [lastEditor, revision]);

  if (!pages.length) return null;
  return <section translate="no" className="chat-recent notion-page-column" aria-labelledby="chat-recent-title">
    <header>
      <h2 id="chat-recent-title">{t("Recently edited")}</h2>
      <button type="button" className="chat-recent-all" onClick={onViewAll}>{t("All notes")}<ChevronRight size={14} className="rtl-mirror" aria-hidden="true" /></button>
    </header>
    <ul>{pages.map(({ id, title, icon }) => {
      const attached = selected.some((page) => page.id === id);
      const name = title || t("Untitled");
      return <li key={id}>
        <button type="button" className="notes-recent-card" aria-pressed={attached}
          disabled={disabled || (!attached && selected.length >= MAX_MESSAGE_NOTES)}
          onClick={() => onToggle({ id, title, icon })}>
          <span aria-hidden="true" className="chat-recent-icon"><NoteIcon icon={icon} fallback={<FileText size={18} />} /></span>
          <span className="chat-recent-title">{name}</span>
          <span className="chat-recent-action">{attached && <Check size={12} aria-hidden="true" />}<span>{attached ? t("Attached") : t("Attach")}</span></span>
        </button>
        <button type="button" className="chat-recent-open" aria-label={t("Open {title}", { title: name })} onClick={() => onOpen(id)}>
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </li>;
    })}</ul>
  </section>;
}
