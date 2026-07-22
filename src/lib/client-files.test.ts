import { describe, expect, it } from "vitest";
import { getClipboardImageFiles } from "@/lib/client-files";

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
