import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoteHistoryDialog, previewMarkdown, REVISION_REASON_LABELS, relativeTime } from "./note-history-dialog";
import { NoteTrashDialog, trashTimeLabel } from "./note-trash-dialog";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 15, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

describe("trash row label", () => {
  it("shows whole days since deletion and the days left", () => {
    expect(trashTimeLabel({ deletedAt: iso(now - 3 * DAY - 1000), purgeAt: iso(now + 27 * DAY - 1000) }, now)).toBe("Deleted 3 days ago · 27 days left");
    expect(trashTimeLabel({ deletedAt: iso(now - DAY), purgeAt: iso(now + 29 * DAY) }, now)).toBe("Deleted 1 day ago · 29 days left");
  });

  it("says today for a fresh deletion, rounds days left up, and never claims zero days left", () => {
    expect(trashTimeLabel({ deletedAt: iso(now - 5000), purgeAt: iso(now + 30 * DAY - 5000) }, now)).toBe("Deleted today · 30 days left");
    expect(trashTimeLabel({ deletedAt: iso(now - 29 * DAY - 3_600_000), purgeAt: iso(now + DAY - 3_600_000) }, now)).toBe("Deleted 29 days ago · 1 day left");
    expect(trashTimeLabel({ deletedAt: iso(now - 29 * DAY - 1000), purgeAt: iso(now + 1000) }, now)).toContain("1 day left");
    expect(trashTimeLabel({ deletedAt: iso(now - 31 * DAY), purgeAt: iso(now - DAY) }, now)).toBe("Deleted 31 days ago · removing soon");
  });
});

describe("history labels", () => {
  it("describes how long ago a version was saved", () => {
    expect(relativeTime(iso(now - 10_000), now)).toBe("Just now");
    expect(relativeTime(iso(now - 5 * 60_000), now)).toBe("5 min ago");
    expect(relativeTime(iso(now - 59 * 60_000 - 30_000), now)).toBe("59 min ago");
    expect(relativeTime(iso(now - 60 * 60_000), now)).toBe("1 hour ago");
    expect(relativeTime(iso(now - 3 * 3_600_000), now)).toBe("3 hours ago");
    expect(relativeTime(iso(now - 30 * 3_600_000), now)).toBe("Yesterday");
    expect(relativeTime(iso(now - 3 * DAY), now)).toBe("3 days ago");
    expect(relativeTime(iso(now + 5000), now)).toBe("Just now");
    expect(relativeTime("not a date", now)).toBe("");
  });

  it("labels every reason", () => {
    expect(REVISION_REASON_LABELS).toEqual({ AUTO: "Auto-saved", AI_EDIT: "Before AI edit", RESTORE: "Before restore" });
  });
});

const text = (value: string) => ({ type: "text", text: value, styles: {} });
const block = (type: string, value: string, props = {}, children: unknown[] = []) => ({ id: value, type, props, content: [text(value)], children });

describe("history preview markdown", () => {
  it("separates paragraphs but keeps bullet items together", () => {
    expect(previewMarkdown([block("heading", "Title", { level: 1 }), block("paragraph", "one"), block("paragraph", "two"), block("bulletListItem", "a"), block("bulletListItem", "b"), block("paragraph", "after")]))
      .toBe("# Title\n\none\n\ntwo\n\n- a\n- b\n\nafter");
  });

  it("does not turn an indented paragraph into a code block, and leaves fenced code untouched", () => {
    const nested = block("bulletListItem", "parent", {}, [block("paragraph", "child", {}, [block("paragraph", "grandchild")])]);
    expect(previewMarkdown([nested])).toBe("- parent\n\nchild\n\ngrandchild");
    const code = { id: "c", type: "codeBlock", props: { language: "python" }, content: [text("x = 1\n\ny = 2")], children: [] };
    expect(previewMarkdown([block("paragraph", "before"), code, block("paragraph", "after")])).toBe("before\n\n```python\nx = 1\n\ny = 2\n```\n\nafter");
  });

  it("is empty for an empty note", () => {
    expect(previewMarkdown([])).toBe("");
    expect(previewMarkdown(null)).toBe("");
  });
});

describe("dialogs first render", () => {
  it("renders the trash dialog loading state with the retention period", () => {
    const html = renderToStaticMarkup(<NoteTrashDialog onClose={() => {}} />);
    expect(html).toContain('aria-labelledby="note-trash-title"');
    expect(html).toContain("Loading trash");
    expect(html).toContain("restored for 30 days");
    expect(html).toContain("Empty trash");
  });

  it("renders the history dialog loading state with a labelled close button", () => {
    const html = renderToStaticMarkup(<NoteHistoryDialog noteId="n1" getVersion={() => 1} flush={async () => true} onRestored={() => {}} onClose={() => {}} />);
    expect(html).toContain("Version history");
    expect(html).toContain("Loading history");
    expect(html).toContain('aria-label="Close version history"');
  });
});
