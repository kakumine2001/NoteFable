import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readStoredImage: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  readStoredImage: mocks.readStoredImage,
}));

import { buildHistoryInput, type HistoryMessage } from "./chat-history";

function textAttachment(filename: string, extractedText: string) {
  return {
    filename,
    mimeType: "text/plain",
    size: extractedText.length,
    extractedText,
    imageStoragePath: null,
  };
}

function imageAttachment(filename: string, storagePath: string, size = 3) {
  return {
    filename,
    mimeType: "image/png",
    size,
    extractedText: null,
    imageStoragePath: storagePath,
  };
}

describe("buildHistoryInput", () => {
  it("excludes broken assistant tool markup without changing user text", async () => {
    const markup = '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="search">';
    const input = await buildHistoryInput([
      { id: "bad", role: "ASSISTANT", content: markup, attachments: [] },
      { id: "good", role: "ASSISTANT", content: "Normal answer", attachments: [] },
      { id: "user", role: "USER", content: markup, attachments: [] },
    ], false);
    expect(input).toEqual([
      { role: "user", content: markup },
      { role: "assistant", content: "Normal answer" },
    ]);
  });
  beforeEach(() => {
    mocks.readStoredImage.mockReset();
  });

  it("restores recent text attachments within the shared character budget", async () => {
    const messages: HistoryMessage[] = [
      {
        id: "newer",
        role: "USER",
        content: "Continue with the newer file",
        attachments: [textAttachment("newer.txt", "n".repeat(100_000))],
      },
      {
        id: "older",
        role: "USER",
        content: "Read the older file",
        attachments: [textAttachment("older.txt", "o".repeat(100_000))],
      },
    ];

    const input = await buildHistoryInput(messages, false);
    const olderContent = input[0].content as { type: string; text: string }[];
    const newerContent = input[1].content as { type: string; text: string }[];

    expect(input.map((item) => item.role)).toEqual(["user", "user"]);
    expect(olderContent[0].text).toContain("o".repeat(20_000));
    expect(olderContent[0].text).not.toContain("o".repeat(20_001));
    expect(newerContent[0].text).toContain("n".repeat(100_000));

    // Claude can retain stored attachment text beyond the shared 120k-character budget.
    const fullInput = await buildHistoryInput(messages, false, undefined, Infinity);
    const fullOlderContent = fullInput[0].content as { type: string; text: string }[];
    expect(fullOlderContent[0].text).toContain("o".repeat(100_000));
  });

  it("restores stored images only for image-capable models and skips missing files", async () => {
    mocks.readStoredImage
      .mockResolvedValueOnce(Buffer.from("new"))
      .mockRejectedValueOnce(new Error("missing"));
    const messages: HistoryMessage[] = [
      {
        id: "user",
        role: "USER",
        content: "Compare these images",
        attachments: [
          imageAttachment("available.png", "images/available.png"),
          imageAttachment("missing.png", "images/missing.png"),
        ],
      },
    ];

    const input = await buildHistoryInput(messages, true);
    const content = input[0].content as { type: string; text?: string; image_url?: string }[];

    expect(content).toEqual([
      { type: "input_text", text: "Compare these images" },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${Buffer.from("new").toString("base64")}`,
      },
    ]);

    mocks.readStoredImage.mockClear();
    const textOnlyInput = await buildHistoryInput(messages, false);
    expect(textOnlyInput[0].content).toBe("Compare these images");
    expect(mocks.readStoredImage).not.toHaveBeenCalled();
  });

  it("keeps assistant messages as plain text", async () => {
    const input = await buildHistoryInput(
      [
        {
          id: "assistant",
          role: "ASSISTANT",
          content: "Previous answer",
          attachments: [textAttachment("ignored.txt", "ignored")],
        },
      ],
      true,
    );

    expect(input).toEqual([{ role: "assistant", content: "Previous answer" }]);
    expect(mocks.readStoredImage).not.toHaveBeenCalled();
  });

  it("skips historical images beyond the selected provider's per-image limit", async () => {
    const input = await buildHistoryInput([{ id: "user", role: "USER", content: "previous image", attachments: [imageAttachment("large.png", "images/large.png", 6 * 1024 * 1024)] }], true, 5 * 1024 * 1024);
    expect(input).toEqual([{ role: "user", content: "previous image" }]);
    expect(mocks.readStoredImage).not.toHaveBeenCalled();
  });
});
