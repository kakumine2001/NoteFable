import { noteContentOf } from "@/lib/note-document";
import type { NoteContent, NotePage, NoteSaveStatus } from "@/types/notes";
import { msg } from "@/lib/i18n/translate";

export class NoteSaveError extends Error {
  constructor(message: string, public status: number, public latest?: NotePage) { super(message); }
}

export type NoteDraft = NoteContent & { version: number };

export class NoteSaveQueue {
  content: NoteContent;
  version: number;
  status: NoteSaveStatus = "saved";
  error = "";
  latest?: NotePage;
  // 最後の保存が 404（別の端末でゴミ箱に入れた・完全に削除した）で失敗した。再送しても通らない。
  gone = false;
  private revision = 0;
  private savedRevision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private flight?: Promise<boolean>;

  constructor(
    public page: NotePage,
    private save: (content: NoteContent, version: number) => Promise<NotePage>,
    private changed: () => void,
    draft?: NoteDraft,
  ) {
    this.content = noteContentOf(page);
    this.version = page.version;
    if (draft) {
      this.content = noteContentOf(draft);
      this.revision = 1;
      this.status = draft.version === page.version ? "pending" : "conflict";
      if (this.status === "conflict") {
        this.latest = page;
        this.error = msg("A recovered draft differs from the latest note. Save a copy or load the latest version.");
      }
    }
  }

  get dirty() { return this.revision !== this.savedRevision; }
  get draft(): NoteDraft { return { ...this.content, version: this.version }; }

  edit(content: NoteContent) {
    this.content = content;
    this.revision++;
    if (this.status !== "conflict") { this.status = "pending"; this.error = ""; this.schedule(); }
    this.changed();
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.dirty && this.status !== "conflict") this.timer = setTimeout(() => { void this.flush(); }, 1000);
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.flight) return this.flight;
    if (!this.dirty) return Promise.resolve(true);
    if (this.status === "conflict") return Promise.resolve(false);
    this.flight = this.run().finally(() => { this.flight = undefined; });
    return this.flight;
  }

  private async run() {
    // 保存中に入力された次の版も、直前の応答を待ってから送る。
    while (this.dirty) {
      const revision = this.revision;
      const content = this.content;
      this.status = "saving";
      this.error = "";
      this.changed();
      try {
        const page = await this.save(content, this.version);
        this.page = page;
        this.version = page.version;
        this.savedRevision = revision;
        this.gone = false;
        if (!this.dirty) this.content = noteContentOf(page);
      } catch (error) {
        this.status = error instanceof NoteSaveError && error.status === 409 ? "conflict" : "error";
        this.latest = error instanceof NoteSaveError ? error.latest : undefined;
        this.gone = error instanceof NoteSaveError && error.status === 404;
        this.error = error instanceof Error ? error.message : msg("Failed to save. Your draft has been kept.");
        this.changed();
        return false;
      }
    }
    this.status = "saved";
    this.changed();
    return true;
  }

  loadLatest(page: NotePage) {
    clearTimeout(this.timer);
    this.page = page;
    this.version = page.version;
    this.content = noteContentOf(page);
    this.savedRevision = ++this.revision;
    this.status = "saved";
    this.error = "";
    this.latest = undefined;
    this.changed();
  }
}
