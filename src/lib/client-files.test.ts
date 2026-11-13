import { describe, expect, it } from "vitest";
import { getClipboardImageFiles, getUploadRequestError, getUploadSelectionError, getUploadValidationError } from "@/lib/client-files";
import { MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_TOTAL_BYTES } from "@/lib/upload-limits";

describe("composer attachment validation", () => {
  const options = { supportsImages: true, claudeImages: false };
  const image = (size = 100) => ({ name: "photo.png", type: "image/png", size });

  it("accepts exactly ten and rejects repeated additions without changing existing attachments", () => {
    const current = Array.from({ length: 9 }, (_, index) => index < 6
      ? image()
      : { name: `notes-${index}.txt`, type: "text/plain", size: 100 });
    expect(getUploadSelectionError(current, [image()], options)).toBe("");
    expect(getUploadSelectionError(current, [image(), image()], options)).toContain("1 more file");
    expect(current).toHaveLength(9);
    expect(getUploadSelectionError([...current, image()], [image()], options)).toContain("Remove a file");
    expect(getUploadSelectionError([], Array.from({ length: 50 }, () => image()), options)).toContain("None of these 50 files were added");
  });

  it("checks byte boundaries and combined existing/new size", () => {
    expect(getUploadSelectionError([], [image(MAX_UPLOAD_FILE_BYTES)], options)).toBe("");
    expect(getUploadSelectionError([], [image(MAX_UPLOAD_FILE_BYTES + 1)], options)).toContain("20 MiB");
    const current = Array.from({ length: 5 }, () => image(MAX_UPLOAD_FILE_BYTES));
    expect(getUploadValidationError(current, options)).toBe("");
    expect(getUploadSelectionError(current, [image(1)], options)).toContain("100 MiB in total");
    expect(current.reduce((sum, file) => sum + file.size, 0)).toBe(MAX_UPLOAD_TOTAL_BYTES);
  });

  it("validates types and changed model constraints before sending", () => {
    expect(getUploadSelectionError([], [{ name: "photo.heic", type: "image/heic", size: 100 }], options)).toContain("not supported");
    expect(getUploadSelectionError([], [{ name: "notes.md", type: "", size: 100 }], options)).toBe("");
    // 拡張子の前の「.」は文字どおりに照合する（"reportpdf" のような名前は通さない）。
    expect(getUploadSelectionError([], [{ name: "reportpdf", type: "", size: 100 }], options)).toContain("not supported");
    expect(getUploadValidationError([image()], { ...options, supportsImages: false })).toContain("cannot read images");
    expect(getUploadValidationError([image(5 * 1024 * 1024)], { ...options, claudeImages: true })).toBe("");
    expect(getUploadValidationError([image(5 * 1024 * 1024 + 1)], { ...options, claudeImages: true })).toBe("");
    expect(getUploadValidationError(Array.from({ length: 5 }, () => image(5 * 1024 * 1024)), { ...options, claudeImages: true })).toBe("");
    expect(getUploadValidationError([image(MAX_UPLOAD_FILE_BYTES)], options)).toBe("");
    expect(getUploadRequestError([image(MAX_UPLOAD_FILE_BYTES)], "hello")).toBe("");
    expect(getUploadRequestError([image(MAX_UPLOAD_FILE_BYTES)], "字".repeat(1500000))).toContain("too large");
  });
});

function clipboardItem({
  kind = "file",
  type,
  file,
}: {
  kind?: string;
  type: string;
  file: File | null;
}) {
  return {
    kind,
    type,
    getAsFile: () => file,
  } as DataTransferItem;
}

describe("clipboard image files", () => {
  it("returns supported clipboard images", () => {
    const png = { name: "image.png", type: "image/png" } as File;
    const webp = { name: "image.webp", type: "image/webp" } as File;

    expect(
      getClipboardImageFiles([
        clipboardItem({ type: "image/png", file: png }),
        clipboardItem({ type: "image/webp", file: webp }),
      ]),
    ).toEqual([png, webp]);
  });

  it("ignores text, unsupported images, and empty file items", () => {
    expect(
      getClipboardImageFiles([
        clipboardItem({ kind: "string", type: "text/plain", file: null }),
        clipboardItem({ type: "image/gif", file: {} as File }),
        clipboardItem({ type: "image/png", file: null }),
      ]),
    ).toEqual([]);
  });
});
