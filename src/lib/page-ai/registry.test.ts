import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {}, databaseSchema: "notefable" }));
import { PAGE_KIND_FEATURES, PAGE_KINDS } from "@/lib/page-kinds";
import { storedToolText, toAnthropicToolContent, toResponsesToolOutput } from "@/lib/chat-tools";
import { PAGE_ADAPTERS } from "./registry";
import { pageToolDefinitions } from "./tools";

describe("page adapters", () => {
  it("has one adapter per page kind, and the client's aiEdit flag matches whether the adapter can edit", () => {
    for (const kind of PAGE_KINDS) {
      expect(PAGE_ADAPTERS[kind].kind).toBe(kind);
      // 画面（AI パネルの「自動適用」・メニュー）は aiEdit を見る。アダプターに操作を足したら、表も一緒に変える。
      expect(PAGE_KIND_FEATURES[kind].aiEdit).toBe(Boolean(PAGE_ADAPTERS[kind].edit));
    }
  });

  it("keeps the tool names that are stored in conversation history", () => {
    expect(PAGE_ADAPTERS.note.edit?.tool.name).toBe("propose_note_edit");
    expect(PAGE_ADAPTERS.note.create?.tool.name).toBe("propose_note_create");
    expect(PAGE_ADAPTERS.whiteboard.edit?.tool.name).toBe("propose_whiteboard_edit");
    expect(PAGE_ADAPTERS.whiteboard.create?.tool.name).toBe("propose_whiteboard_create");
    // ノート・ホワイトボードの新規作成は、確認してから作る（「自動適用」のときだけすぐ作る）。
    expect(PAGE_ADAPTERS.note.create?.direct).toBeFalsy();
    expect(PAGE_ADAPTERS.whiteboard.create?.direct).toBeFalsy();
  });

  it("gives every tool a unique name (a duplicate would be rejected by the providers and send calls to the wrong adapter)", () => {
    const names = pageToolDefinitions({ vision: true }).map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("tool results with preview images", () => {
  const run = { content: "Preview of “Deck”.", label: "Previewed", images: [{ mimeType: "image/png" as const, base64: "AAAA" }] };

  it("sends images next to the text to every provider, and keeps plain text when there are none", () => {
    expect(toResponsesToolOutput(run)).toEqual([{ type: "input_text", text: run.content }, { type: "input_image", image_url: "data:image/png;base64,AAAA" }]);
    expect(toAnthropicToolContent(run)).toEqual([{ type: "text", text: run.content }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }]);
    expect(toResponsesToolOutput({ content: "x", label: "y" })).toBe("x");
    expect(toAnthropicToolContent({ content: "x", label: "y" })).toBe("x");
  });

  it("does not keep the images in the stored conversation context", () => {
    expect(storedToolText(run)).toBe("Preview of “Deck”.\n\n[The preview image is not kept in the conversation history.]");
    expect(storedToolText({ content: "x", label: "y" })).toBe("x");
  });
});
