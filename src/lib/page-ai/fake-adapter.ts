import type { CanvasData } from "@/lib/canvas-document";
import type { ToolImage } from "@/lib/chat-tools";
import { AdapterError, type AdapterPage, type PageAdapter } from "@/lib/page-ai/adapter";
import { canvasStorage } from "@/lib/page-ai/storage";
import type { ProposalChange } from "@/lib/page-ai/types";

// テスト用の偽アダプター（AI 操控底座の枠組みのテストだけで使う。本番のどこからも読み込まない）。
// スライド（slides）の形を借りて、操作（スライドの題名を変える・足す・消す）・新規作成（確認なしに作る）・予覧・縮小画像を持つ。
// 本物のホワイトボード・スライドのアダプター（#153・#150）も、この形で作る：read / edit / create / validate・write（適用）/ preview。

type Slide = { id: string; elements: { id: string; type: string; text: string }[] };

// 1×1 の PNG（予覧と縮小画像の代わり）。
export const FAKE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const image = (): ToolImage => ({ mimeType: "image/png", base64: FAKE_PNG_BASE64 });

function slidesOf(data: CanvasData | null | undefined): Slide[] {
  return (Array.isArray(data?.slides) ? data!.slides : []) as Slide[];
}

const titleOf = (slide: Slide | undefined) => slide?.elements[0]?.text ?? "";
const slide = (id: string, text: string): Slide => ({ id, elements: [{ id: `${id}-title`, type: "text", text }] });

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function fakeSlidesAdapter(): PageAdapter {
  return {
    kind: "slides",
    needsData: true,
    ...canvasStorage("slides"),
    read(page: AdapterPage) {
      return slidesOf(page.data).map((item, index) => `Slide ${index + 1} (id: ${item.id}): ${titleOf(item) || "(no text)"}`).join("\n");
    },
    edit: {
      tool: {
        name: "propose_fake_slides_edit",
        description: "Test only.",
        parameters: { type: "object", properties: { noteId: { type: "string" }, version: { type: "integer" }, ops: { type: "array" } }, required: ["noteId", "version", "ops"], additionalProperties: false },
      },
      async propose(_ctx, page, args) {
        const ops = object(args).ops;
        if (!Array.isArray(ops) || !ops.length) throw new AdapterError("ops must be a non-empty array.");
        const slides = slidesOf(page.data).map((item) => ({ ...item, elements: item.elements.map((element) => ({ ...element })) }));
        const changes: ProposalChange[] = [];
        for (const raw of ops) {
          const op = object(raw);
          if (op.op === "set_title") {
            const index = slides.findIndex((item) => item.id === op.slideId);
            if (index < 0) throw new AdapterError(`Slide ${String(op.slideId)} not found.`);
            const before = titleOf(slides[index]);
            slides[index] = slide(slides[index].id, String(op.text ?? ""));
            changes.push({ op: "update", block: 0, target: { type: "slide", number: index + 1 }, before, after: String(op.text ?? "") });
          } else if (op.op === "add_slide") {
            slides.push(slide(`s${slides.length + 1}-${Date.now().toString(36)}`, String(op.text ?? "")));
            changes.push({ op: "add", block: 0, target: { type: "slide", number: slides.length }, after: String(op.text ?? "") });
          } else if (op.op === "delete_slide") {
            const index = slides.findIndex((item) => item.id === op.slideId);
            if (index < 0) throw new AdapterError(`Slide ${String(op.slideId)} not found.`);
            changes.push({ op: "delete", block: 0, target: { type: "slide", number: index + 1 }, before: titleOf(slides[index]) });
            slides.splice(index, 1);
          } else {
            throw new AdapterError("Unknown op.");
          }
        }
        return {
          changes,
          proposed: { title: page.title, data: { slides } },
          images: changes.map((_, index) => ({ change: index, side: "after" as const, ...image() })),
        };
      },
    },
    create: {
      direct: true,
      tool: {
        name: "propose_fake_slides_create",
        description: "Test only.",
        parameters: { type: "object", properties: { title: { type: "string" }, slides: { type: "array" } }, required: ["title", "slides"], additionalProperties: false },
      },
      async propose(_ctx, args) {
        const value = object(args);
        const title = typeof value.title === "string" ? value.title.trim() : "";
        if (!title) throw new AdapterError("title must be a non-empty string.");
        const texts = Array.isArray(value.slides) ? value.slides.map(String) : [];
        const slides = texts.map((text, index) => slide(`n${index + 1}`, text));
        return { title, icon: null, content: texts.map((text, index) => `Slide ${index + 1}: ${text}`).join("\n"), proposed: { title, icon: null, data: { slides } } };
      },
    },
    async preview(page, target) {
      if (target.slideId && !slidesOf(page.data).some((item) => item.id === target.slideId)) return null;
      return image();
    },
  };
}
