import type { CanvasData, CanvasSegment } from "@/lib/canvas-document";
import type { CanvasKind } from "@/lib/page-kinds";
import type { AdapterPage, PageAdapter } from "@/lib/page-ai/adapter";
import { canvasStorage } from "@/lib/page-ai/storage";

// ホワイトボード・スライドのアダプター（読むだけ）。エディター（#152・#149）の要素の形が決まるまで、AI は保存時に取り出した文字
// （NoteCanvas.segments）だけを、要素・スライドの ID 付きで読む。操作（edit / create）と予覧（preview）は #153・#150 で足す。
// 適用（validate / write / createPage / snapshot）は保存と同じ検証で、元に戻す・テストの偽アダプターでも使う。

const KIND_NAMES: Record<CanvasKind, string> = { whiteboard: "a whiteboard", slides: "a slide deck" };

const text = (segment: CanvasSegment | undefined) => segment?.text.trim() || "";

// ホワイトボード：文字のある要素ごとに 1 行（図形に付いた文字は図形の ID、枠は名前）。
function readWhiteboard(page: AdapterPage) {
  const lines = (page.segments ?? []).filter((segment) => text(segment)).map((segment) => `- (id: ${segment.id}) ${text(segment)}`);
  return lines.join("\n");
}

// スライド：本体の並び順で、文字の無いスライドも番号に数える（番号が実際のスライドと合うように）。
function readSlides(page: AdapterPage) {
  const byId = new Map((page.segments ?? []).map((segment) => [segment.id, segment]));
  const slides = slideOrder(page.data);
  // 本体が読めない（古い保存など）ときは、文字のあるスライドだけを並べる。
  const entries = slides.length ? slides : (page.segments ?? []).map((segment) => ({ id: segment.id, hidden: false }));
  return entries.map((slide, index) => `Slide ${index + 1} (id: ${slide.id})${slide.hidden ? " [hidden]" : ""}: ${text(byId.get(slide.id)) || "(no text)"}`).join("\n");
}

function slideOrder(data: CanvasData | null | undefined): { id: string; hidden: boolean }[] {
  const slides = data && Array.isArray(data.slides) ? data.slides : [];
  return slides.flatMap((slide) => {
    const item = slide as Record<string, unknown> | null;
    return item && typeof item.id === "string" && item.id ? [{ id: item.id, hidden: item.hidden === true }] : [];
  });
}

export function canvasTextAdapter(kind: CanvasKind): PageAdapter {
  return {
    kind,
    // スライドは並び順（と非表示）を本体から読む。ホワイトボードは取り出した文字だけで足りる。
    needsData: kind === "slides",
    ...canvasStorage(kind),
    read(page) {
      const body = kind === "whiteboard" ? readWhiteboard(page) : readSlides(page);
      return `# ${page.title}\n\n${body || "(This page has no text.)"}`;
    },
    readNote() {
      return `This page is ${KIND_NAMES[kind]}, not a note. You can read only the text on it (with the IDs of its ${kind === "whiteboard" ? "elements" : "slides"}); the tools cannot change it yet, so tell the user it can't be edited from chat yet.`;
    },
  };
}
