"use client";

import { ExternalLink, Loader2, X } from "lucide-react";

type NotionDrawerProps = {
  title: string;
  content: string;
  saving: boolean;
  error: string;
  url: string;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export function NotionDrawer({
  title,
  content,
  saving,
  error,
  url,
  onTitleChange,
  onContentChange,
  onClose,
  onSave,
}: NotionDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/15">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close Notion draft" />
      <aside className="notion-drawer motion-drawer-enter">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--notion-border)] px-4">
          <div className="text-sm font-medium text-[var(--notion-text)]">Save to Notion</div>
          <button type="button" onClick={onClose} className="notion-icon-button grid" aria-label="Close Notion draft">
            <X size={17} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6 sm:px-7">
          <p className="text-sm leading-6 text-[var(--notion-muted)]">Edit the page title and transcript before saving.</p>
          <label className="grid gap-1.5">
            <span className="notion-field-label">Page title</span>
            <input value={title} onChange={(event) => onTitleChange(event.target.value)} className="notion-field h-9" placeholder="Untitled" />
          </label>
          <label className="grid min-h-0 flex-1 gap-1.5">
            <span className="notion-field-label">Content</span>
            <textarea value={content} onChange={(event) => onContentChange(event.target.value)} className="notion-field min-h-[22rem] flex-1 resize-none py-2.5 leading-6" placeholder="Add content..." />
          </label>
          {error && <div className="notion-error" role="alert">{error}</div>}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="notion-success">
              Open saved page <ExternalLink size={14} />
            </a>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--notion-border)] px-4 py-3">
          <button type="button" onClick={onClose} className="notion-button">Cancel</button>
          <button type="button" onClick={onSave} disabled={saving || !title.trim() || !content.trim()} className="notion-button notion-button-primary">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </footer>
      </aside>
    </div>
  );
}
