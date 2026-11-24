import { describe, expect, it } from "vitest";
import { fitNoteFileName, noteFileUrl, parseNoteFileUrl } from "@/lib/note-file-keys";

const path = "note-files/user1234/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0.png";

describe("fitNoteFileName", () => {
  it("keeps short names as they are", () => {
    expect(fitNoteFileName(path, "board.png", "file.png")).toBe("board.png");
  });

  it("shortens a long CJK name so the URL still passes the saved-content check, keeping the extension", () => {
    // PDF の取り込みは「ファイル名-ページ番号」。CJK は 1 文字が URL で 9 文字になり、そのままだと 600 文字を超える。
    const long = `${"会議資料".repeat(30)}-12.png`;
    expect(parseNoteFileUrl(noteFileUrl(path, long))).toBeNull();
    const fitted = fitNoteFileName(path, long, "file.png");
    expect(fitted.endsWith(".png")).toBe(true);
    expect(fitted.length).toBeLessThan(long.length);
    expect(parseNoteFileUrl(noteFileUrl(path, fitted))).not.toBeNull();
  });

  it("never splits an emoji (surrogate pair) when it shortens", () => {
    const fitted = fitNoteFileName(path, `${"😀".repeat(80)}.png`, "file.png");
    expect(fitted).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(parseNoteFileUrl(noteFileUrl(path, fitted))).not.toBeNull();
  });

  it("never leaves half an emoji behind (extension or name cut), so the URL can always be built", () => {
    for (const name of [`x.${"😀".repeat(8)}`, `${"a".repeat(119)}😀`, `a${"😀".repeat(60)}`, "bad\uD83D.png"]) {
      const fitted = fitNoteFileName(path, name, "file.png");
      expect(() => noteFileUrl(path, fitted)).not.toThrow();
      expect(fitted).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });
});
