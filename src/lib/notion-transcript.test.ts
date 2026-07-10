import { describe, expect, it } from "vitest";
import type { Message } from "@/types/chat";
import { formatTranscriptForNotion } from "./notion-transcript";

describe("formatTranscriptForNotion", () => {
  it("does not include generated image binary data", () => {
    const base64 = "data:image/png;base64,very-large-binary-payload";
    const messages: Message[] = [
      {
        id: "assistant-1",
        role: "ASSISTANT",
        content: "",
        generatedImages: [{ id: "image-1", mimeType: "image/png", dataUrl: base64 }],
      },
    ];

    const transcript = formatTranscriptForNotion(messages);

    expect(transcript).toBe("Assistant:\nGenerated image: image/png");
    expect(transcript).not.toContain(base64);
    expect(transcript).not.toContain("base64");
  });

  it("includes attachment metadata without attachment URLs", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "USER",
        content: "Review this",
        attachments: [
          {
            id: "attachment-1",
            filename: "notes.pdf",
            mimeType: "application/pdf",
            size: 128,
            dataUrl: "data:application/pdf;base64,secret",
          },
        ],
      },
    ];

    const transcript = formatTranscriptForNotion(messages);

    expect(transcript).toBe("User:\nReview this\nAttachment: notes.pdf (application/pdf)");
    expect(transcript).not.toContain("secret");
  });

  it("filters messages without text or media", () => {
    const messages: Message[] = [
      { id: "empty-user", role: "USER", content: "   " },
      { id: "assistant-1", role: "ASSISTANT", content: "Answer" },
      { id: "empty-assistant", role: "ASSISTANT", content: "\n" },
    ];

    expect(formatTranscriptForNotion(messages)).toBe("Assistant:\nAnswer");
  });
});
