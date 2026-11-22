import { describe, expect, it } from "vitest";
import { validateNoteContent } from "@/lib/note-document";
import { isUploadedNoteIcon, noteIconImageUrl, noteIconText } from "@/lib/note-icon";

const key = "upload:page-covers/user1/0e111e3a-9e25-4944-ade7-b460580fa921.png";
const save = (icon: unknown) => validateNoteContent({ title: "T", icon, cover: null, blocks: [] });

describe("note icons", () => {
  it("accepts an emoji or an uploaded image, nothing else", () => {
    expect(save("🏋️").icon).toBe("🏋️");
    expect(save(key).icon).toBe(key);
    expect(() => save("https://example.com/a.png")).toThrow();
    expect(() => save("upload:page-covers/user1/../x.png")).toThrow();
    expect(() => save("ab")).toThrow();
  });

  it("builds the owner-checked image URL and plain-text fallbacks", () => {
    expect(isUploadedNoteIcon(key)).toBe(true);
    expect(noteIconImageUrl(key)).toBe("/api/pages/covers?key=page-covers%2Fuser1%2F0e111e3a-9e25-4944-ade7-b460580fa921.png");
    expect(noteIconImageUrl(key, "/s/t/cover?page=p&kind=icon")).toBe("/s/t/cover?page=p&kind=icon");
    expect(noteIconImageUrl("📄")).toBeNull();
    expect(noteIconText(key)).toBe("");
    expect(noteIconText("📄")).toBe("📄");
  });
});
