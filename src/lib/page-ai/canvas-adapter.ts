import type { CanvasSegment } from "@/lib/canvas-document";
import type { CanvasKind } from "@/lib/page-kinds";
import { MAX_READ_CHARS, type AdapterPage, type PageAdapter } from "@/lib/page-ai/adapter";
import { canvasStorage } from "@/lib/page-ai/storage";
import { normalizeDeck, slideRows, type SlideElement } from "@/lib/slides/model";
import type { RichBlock, RichDoc, RichInline } from "@/lib/slides/rich-text";
import { pageCardOf } from "@/lib/whiteboard/links";

// ホワイトボード・スライドのアダプター（構造化して読む）。編集（edit / create）と予覧（preview）は #153・#150 の後続 PR で足す。
// 適用（validate / write / createPage / snapshot）は保存と同じ検証で、元に戻す・テストの偽アダプターでも使う。

const KIND_NAMES: Record<CanvasKind, string> = { whiteboard: "a whiteboard", slides: "a slide deck" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const segmentText = (segment: CanvasSegment | undefined) => segment?.text.trim() || "";

const inlineLine = (value: string) => value.trim().replace(/\r?\n/g, " / ");

// 1 行・1 ブロックが予算を超えるときだけ安全に切る。
function clipToBudget(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (text.length <= budget) return text;
  if (budget <= 1) return "…";
  return `${text.slice(0, budget - 1)}…`;
}

// ---- ホワイトボード ----

type RawElement = Record<string, unknown> & { id: string; type: string };

function elementOwnText(element: RawElement): string {
  if (element.type !== "text" && element.type !== "stickynote") return "";
  const raw = typeof element.originalText === "string" && element.originalText.trim()
    ? element.originalText
    : typeof element.text === "string"
      ? element.text
      : "";
  return inlineLine(raw);
}

function bindingTarget(binding: unknown): string | null {
  if (!isRecord(binding)) return null;
  return typeof binding.elementId === "string" && binding.elementId.trim() ? binding.elementId.trim() : null;
}

function groupList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim() && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function formatWhiteboardElement(element: RawElement, boundTexts: string[]): string {
  const parts: string[] = [];
  const own = elementOwnText(element);
  if (own) parts.push(own);
  for (const bound of boundTexts) {
    if (bound && !parts.includes(bound)) parts.push(bound);
  }
  const combinedText = parts.join(" / ");
  const groups = groupList(element.groupIds);
  const card = pageCardOf(element.customData);

  let line = `- ${element.type} (id: ${element.id})`;
  if (groups.length) line += ` [${groups.length === 1 ? "group" : "groups"}: ${groups.join(", ")}]`;
  if (card) line += ` [page link: ${card.kind} ${card.id}]`;

  if (element.type === "arrow" || element.type === "line") {
    const start = bindingTarget(element.startBinding);
    const end = bindingTarget(element.endBinding);
    if (start || end) {
      line += `: ${start ?? "?"} -> ${end ?? "?"}`;
      if (combinedText) line += ` "${combinedText}"`;
    } else if (combinedText) {
      line += `: "${combinedText}"`;
    }
    return line;
  }

  if (element.type === "image") {
    line += ": [Image]";
    if (combinedText) line += ` "${combinedText}"`;
    return line;
  }

  if (combinedText) line += `: "${combinedText}"`;
  return line;
}

type WhiteboardSection = {
  heading?: string;
  isFrame: boolean;
  lines: string[];
};

function focusIdSet(focusIds?: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const id of focusIds ?? []) {
    if (typeof id === "string" && id.trim()) set.add(id.trim());
  }
  return set;
}

function readWhiteboardSegments(segments: CanvasSegment[], budget: number, focusIds?: readonly string[]): string {
  const entries = segments
    .map((segment) => ({ id: segment.id, text: segmentText(segment) }))
    .filter((segment) => segment.text)
    .map((segment) => ({ id: segment.id, line: `- (id: ${segment.id}) ${inlineLine(segment.text)}` }));
  if (!entries.length) return "";
  const fullLength = entries.reduce((sum, entry, index) => sum + entry.line.length + (index ? 1 : 0), 0);
  const focus = focusIdSet(focusIds);
  const ordered = fullLength > budget && focus.size > 0
    ? [...entries.filter((entry) => focus.has(entry.id)), ...entries.filter((entry) => !focus.has(entry.id))]
    : entries;
  const lines = ordered.map((entry) => entry.line);
  const noticeReserve = 120;
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const candidate = lines[i];
    const sep = out.length ? 1 : 0;
    const isLast = i === lines.length - 1;
    const limit = isLast ? budget : Math.max(0, budget - noticeReserve);
    if (used + sep + candidate.length <= limit) {
      out.push(candidate);
      used += sep + candidate.length;
    } else {
      if (!out.length) {
        const clipped = clipToBudget(candidate, Math.max(0, budget - noticeReserve));
        if (clipped) out.push(clipped);
        const omitted = lines.length - 1;
        if (omitted > 0) {
          return `${out.join("\n")}\n\n[Truncated: ${omitted} more element${omitted === 1 ? "" : "s"} omitted (limit: ${MAX_READ_CHARS} characters).]`;
        }
        return `${out.join("\n")}\n\n[Truncated: content exceeds ${MAX_READ_CHARS} characters.]`;
      }
      const omitted = lines.length - i;
      return `${out.join("\n")}\n\n[Truncated: ${omitted} more element${omitted === 1 ? "" : "s"} omitted (limit: ${MAX_READ_CHARS} characters).]`;
    }
  }
  return out.join("\n");
}

function renderWhiteboardSections(sections: WhiteboardSection[], budget: number): { text: string; truncated: boolean } {
  const noticeReserve = 140;
  const output: string[] = [];
  let used = 0;

  const remainingCounts = (sectionIdx: number, lineIdx: number, includeCurrentFrame: boolean) => {
    let omittedElements = 0;
    let omittedFrames = 0;
    for (let s = sectionIdx; s < sections.length; s++) {
      const sec = sections[s];
      if (s === sectionIdx) {
        if (includeCurrentFrame && sec.isFrame) omittedFrames++;
        omittedElements += Math.max(0, sec.lines.length - lineIdx);
      } else {
        if (sec.isFrame) omittedFrames++;
        omittedElements += sec.lines.length;
      }
    }
    return { omittedElements, omittedFrames };
  };

  const formatNotice = (omittedElements: number, omittedFrames: number) => {
    const pieces: string[] = [];
    if (omittedElements > 0) pieces.push(`${omittedElements} more element${omittedElements === 1 ? "" : "s"}`);
    if (omittedFrames > 0) pieces.push(`${omittedFrames} more frame${omittedFrames === 1 ? "" : "s"}`);
    if (!pieces.length) return `\n\n[Truncated: content exceeds ${MAX_READ_CHARS} characters.]`;
    return `\n\n[Truncated: ${pieces.join(" and ")} omitted (limit: ${MAX_READ_CHARS} characters).]`;
  };

  const appendBlock = (block: string, isAbsoluteLast: boolean): boolean => {
    const sep = output.length ? "\n" : "";
    const limit = isAbsoluteLast ? budget : Math.max(0, budget - noticeReserve);
    if (used + sep.length + block.length > limit) return false;
    output.push(block);
    used += sep.length + block.length;
    return true;
  };

  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    const hasMoreAfterSection = s < sections.length - 1;
    const sectionSep = output.length && section.heading ? "\n" : "";

    if (section.heading) {
      const headingBlock = `${sectionSep}${section.heading}`;
      const isLastBlock = !hasMoreAfterSection && section.lines.length === 0;
      if (!appendBlock(headingBlock, isLastBlock)) {
        const { omittedElements, omittedFrames } = remainingCounts(s, 0, true);
        if (!output.length) {
          output.push(clipToBudget(section.heading, Math.max(0, budget - noticeReserve)));
          const after = remainingCounts(s, 0, false);
          return { text: `${output.join("\n")}${formatNotice(after.omittedElements, after.omittedFrames)}`, truncated: true };
        }
        return { text: `${output.join("\n")}${formatNotice(omittedElements, omittedFrames)}`, truncated: true };
      }
      if (section.lines.length === 0) {
        appendBlock("- (empty)", !hasMoreAfterSection);
      }
    }

    for (let l = 0; l < section.lines.length; l++) {
      const line = section.lines[l];
      const isLast = !hasMoreAfterSection && l === section.lines.length - 1;
      if (!appendBlock(line, isLast)) {
        // 直前に枠見出しだけ積んで 1 件目も入らなかった場合（かつ前に別コンテンツがある）は、空見出しを戻して枠境界で切る。
        if (l === 0 && section.heading && output.length > 1) {
          output.pop();
          const { omittedElements, omittedFrames } = remainingCounts(s, 0, true);
          return { text: `${output.join("\n")}${formatNotice(omittedElements, omittedFrames)}`, truncated: true };
        }
        if (!output.length || (output.length === 1 && section.heading)) {
          const remainingBudget = Math.max(0, budget - used - (output.length ? 1 : 0) - noticeReserve);
          const clipped = clipToBudget(line, remainingBudget);
          if (clipped) output.push(clipped);
          const { omittedElements, omittedFrames } = remainingCounts(s, l + 1, false);
          return { text: `${output.join("\n")}${formatNotice(omittedElements, omittedFrames)}`, truncated: true };
        }
        const { omittedElements, omittedFrames } = remainingCounts(s, l, false);
        return { text: `${output.join("\n")}${formatNotice(omittedElements, omittedFrames)}`, truncated: true };
      }
    }
  }

  return { text: output.join("\n"), truncated: false };
}

function readWhiteboard(page: AdapterPage, budget: number): string {
  if (!isRecord(page.data) || !Array.isArray(page.data.elements)) {
    return readWhiteboardSegments(page.segments ?? [], budget, page.focusIds);
  }

  const live: RawElement[] = [];
  for (const raw of page.data.elements) {
    if (!isRecord(raw) || raw.isDeleted === true) continue;
    if (typeof raw.id !== "string" || !raw.id || typeof raw.type !== "string" || !raw.type) continue;
    live.push(raw as RawElement);
  }
  if (!live.length) return "";

  const liveById = new Map(live.map((element) => [element.id, element]));
  const boundTextIds = new Set<string>();
  const boundContainerOf = new Map<string, string>();
  const boundTextByContainer = new Map<string, string[]>();
  for (const element of live) {
    if (element.type !== "text" || typeof element.containerId !== "string" || !element.containerId) continue;
    const container = liveById.get(element.containerId);
    if (!container || container.type === "frame") continue;
    boundTextIds.add(element.id);
    boundContainerOf.set(element.id, container.id);
    const label = elementOwnText(element);
    if (!label) continue;
    const list = boundTextByContainer.get(container.id) ?? [];
    list.push(label);
    boundTextByContainer.set(container.id, list);
  }

  const frames = live.filter((element) => element.type === "frame");
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const frameNameOf = (frame: RawElement) => (typeof frame.name === "string" && frame.name.trim() ? inlineLine(frame.name) : "(unnamed)");
  const frameChildren = new Map<string, RawElement[]>(frames.map((frame) => [frame.id, []]));
  const unframed: RawElement[] = [];

  for (const element of live) {
    if (element.type === "frame" || boundTextIds.has(element.id)) continue;
    const frameId = typeof element.frameId === "string" ? element.frameId : null;
    if (frameId && frameById.has(frameId)) {
      frameChildren.get(frameId)!.push(element);
    } else {
      unframed.push(element);
    }
  }

  const sections: WhiteboardSection[] = [];
  for (const frame of frames) {
    const children = frameChildren.get(frame.id) ?? [];
    sections.push({
      heading: `## Frame: ${frameNameOf(frame)} (id: ${frame.id})`,
      isFrame: true,
      lines: children.map((child) => formatWhiteboardElement(child, boundTextByContainer.get(child.id) ?? [])),
    });
  }
  if (unframed.length) {
    sections.push({
      heading: frames.length ? "## Unframed" : undefined,
      isFrame: false,
      lines: unframed.map((element) => formatWhiteboardElement(element, boundTextByContainer.get(element.id) ?? [])),
    });
  }

  const normal = renderWhiteboardSections(sections, budget);
  const focus = focusIdSet(page.focusIds);
  if (!normal.truncated || !focus.size) return normal.text;

  // 大きなボードで出力上限に引っかかるときは、選んだ要素（枠の中身・矢印の接続先を含む）を先頭に載せて読み落とさないようにする。
  const normalizedFocus = new Set<string>();
  for (const id of focus) {
    normalizedFocus.add(boundContainerOf.get(id) ?? id);
  }
  const selectedIds = new Set<string>();
  const selectedElements: RawElement[] = [];
  const selectedEmptyFrames: RawElement[] = [];
  for (const frame of frames) {
    const frameSelected = normalizedFocus.has(frame.id);
    const children = frameChildren.get(frame.id) ?? [];
    if (frameSelected && children.length === 0) selectedEmptyFrames.push(frame);
    for (const child of children) {
      if (frameSelected || normalizedFocus.has(child.id)) {
        if (!selectedIds.has(child.id)) {
          selectedIds.add(child.id);
          selectedElements.push(child);
        }
      }
    }
  }
  for (const element of unframed) {
    if (normalizedFocus.has(element.id) && !selectedIds.has(element.id)) {
      selectedIds.add(element.id);
      selectedElements.push(element);
    }
  }
  if (!selectedElements.length && !selectedEmptyFrames.length) return normal.text;

  // 選んだ矢印・線が指す先の要素も添え、ラベルのない矢印でも両端の意味が分かるようにする。
  const endpointIds = new Set<string>();
  for (const element of selectedElements) {
    if (element.type !== "arrow" && element.type !== "line") continue;
    for (const target of [bindingTarget(element.startBinding), bindingTarget(element.endBinding)]) {
      if (!target) continue;
      const canonical = boundContainerOf.get(target) ?? target;
      const resolved = liveById.get(canonical);
      if (resolved && resolved.type !== "frame" && !selectedIds.has(resolved.id)) {
        endpointIds.add(resolved.id);
      }
    }
  }
  const endpointElements: RawElement[] = [];
  for (const element of live) {
    if (endpointIds.has(element.id)) endpointElements.push(element);
  }

  const formatFocusedLine = (element: RawElement) => {
    const base = formatWhiteboardElement(element, boundTextByContainer.get(element.id) ?? []);
    const frameId = typeof element.frameId === "string" ? element.frameId : null;
    const frame = frameId ? frameById.get(frameId) : undefined;
    return frame ? `${base} [in frame: ${frameNameOf(frame)} (${frame.id})]` : base;
  };

  const emittedIds = new Set<string>([...selectedIds, ...endpointIds]);
  const emittedEmptyFrameIds = new Set<string>(selectedEmptyFrames.map((frame) => frame.id));
  const prioritized: WhiteboardSection[] = [
    {
      heading: "## Selected",
      isFrame: false,
      lines: [
        ...selectedElements.map(formatFocusedLine),
        ...selectedEmptyFrames.map((frame) => `- frame (id: ${frame.id}): "${frameNameOf(frame)}" (empty)`),
      ],
    },
  ];
  if (endpointElements.length) {
    prioritized.push({
      heading: "## Connected to selected",
      isFrame: false,
      lines: endpointElements.map(formatFocusedLine),
    });
  }
  for (const frame of frames) {
    if (emittedEmptyFrameIds.has(frame.id)) continue;
    const remainingChildren = (frameChildren.get(frame.id) ?? []).filter((child) => !emittedIds.has(child.id));
    if (!remainingChildren.length && (frameChildren.get(frame.id) ?? []).length > 0) continue;
    prioritized.push({
      heading: `## Frame: ${frameNameOf(frame)} (id: ${frame.id})`,
      isFrame: true,
      lines: remainingChildren.map((child) => formatWhiteboardElement(child, boundTextByContainer.get(child.id) ?? [])),
    });
  }
  const remainingUnframed = unframed.filter((element) => !emittedIds.has(element.id));
  if (remainingUnframed.length) {
    prioritized.push({
      heading: "## Unframed",
      isFrame: false,
      lines: remainingUnframed.map((element) => formatWhiteboardElement(element, boundTextByContainer.get(element.id) ?? [])),
    });
  }

  return renderWhiteboardSections(prioritized, budget).text;
}

// ---- スライド ----

function formatRichInline(content: RichInline[] | undefined): string {
  return (content ?? [])
    .map((node) => (node.type === "text" ? node.text : node.type === "hard_break" ? "\n" : `$${node.attrs.latex}$`))
    .join("");
}

function formatRichBlocks(blocks: RichBlock[], indent = ""): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const text = formatRichInline(block.content).trim();
      if (text) lines.push(`${indent}${text.replace(/\r?\n/g, `\n${indent}`)}`);
    } else if (block.type === "code_block") {
      const code = (block.content?.[0]?.text ?? "").replace(/\s+$/, "");
      if (code) lines.push(`${indent}\`\`\`\n${code.split(/\r?\n/).map((line) => `${indent}${line}`).join("\n")}\n${indent}\`\`\``);
    } else if (block.type === "math_block") {
      const latex = block.attrs.latex.trim();
      if (latex) lines.push(`${indent}$$${latex}$$`);
    } else if (block.type === "bullet_list") {
      for (const item of block.content) {
        const inner = formatRichBlocks(item.content, `${indent}  `);
        if (inner.length) {
          lines.push(`${indent}- ${inner[0].trimStart()}`);
          lines.push(...inner.slice(1));
        }
      }
    } else if (block.type === "ordered_list") {
      block.content.forEach((item, index) => {
        const inner = formatRichBlocks(item.content, `${indent}   `);
        if (inner.length) {
          lines.push(`${indent}${index + 1}. ${inner[0].trimStart()}`);
          lines.push(...inner.slice(1));
        }
      });
    }
  }
  return lines;
}

function formatSlideRichDoc(doc: RichDoc): string {
  const lines = formatRichBlocks(doc.content);
  if (!lines.length) return "";
  if (lines.length === 1 && !lines[0].includes("\n")) return lines[0];
  return `\n${lines.map((line) => `  ${line.replace(/\n/g, "\n  ")}`).join("\n")}`;
}

function formatSlideElement(element: SlideElement): string {
  const role = element.role ? ` [role: ${element.role}]` : "";
  switch (element.type) {
    case "text": {
      const content = formatSlideRichDoc(element.doc);
      return `- text (id: ${element.id})${role}${content ? (content.startsWith("\n") ? `:${content}` : `: ${content}`) : ""}`;
    }
    case "shape": {
      const content = formatSlideRichDoc(element.doc);
      return `- shape/${element.shape} (id: ${element.id})${role}${content ? (content.startsWith("\n") ? `:${content}` : `: ${content}`) : ""}`;
    }
    case "table": {
      const rows = element.rows.map((row) => `  ${row.cells.map((cell) => cell.text.replace(/\r?\n/g, " ").trim()).join(" | ")}`);
      return `- table (id: ${element.id})${role}:\n${rows.join("\n")}`;
    }
    case "image":
      // NoteCanvas の画像ファイルパス（src）は出さず、説明文だけを渡す。
      return `- image (id: ${element.id})${role}: [Image: ${element.alt.trim() || "image"}]`;
    case "whiteboard":
      return `- whiteboard (id: ${element.id})${role}: [Whiteboard frame: ${element.frameName.trim() || "whiteboard"}]`;
    case "line":
      return `- line (id: ${element.id})${role}`;
  }
}

function readSlidesSegments(segments: CanvasSegment[], budget: number, focusIds?: readonly string[]): string {
  const entries = segments.map(
    (segment, index) => ({ id: segment.id, block: `Slide ${index + 1} (id: ${segment.id}): ${segmentText(segment) || "(no text)"}` }),
  );
  if (!entries.length) return "";
  const fullLength = entries.reduce((sum, entry, index) => sum + entry.block.length + (index ? 1 : 0), 0);
  const focus = focusIdSet(focusIds);
  const ordered = fullLength > budget && focus.size > 0
    ? [...entries.filter((entry) => focus.has(entry.id)), ...entries.filter((entry) => !focus.has(entry.id))]
    : entries;
  const blocks = ordered.map((entry) => entry.block);
  const noticeReserve = 110;
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const sep = out.length ? 1 : 0;
    const isLast = i === blocks.length - 1;
    const limit = isLast ? budget : Math.max(0, budget - noticeReserve);
    if (used + sep + block.length <= limit) {
      out.push(block);
      used += sep + block.length;
    } else {
      if (!out.length) {
        const clipped = clipToBudget(block, Math.max(0, budget - noticeReserve));
        if (clipped) out.push(clipped);
        const omitted = blocks.length - 1;
        return omitted > 0
          ? `${out.join("\n")}\n\n[Truncated: ${omitted} more slide${omitted === 1 ? "" : "s"} omitted (limit: ${MAX_READ_CHARS} characters).]`
          : `${out.join("\n")}\n\n[Truncated: content exceeds ${MAX_READ_CHARS} characters.]`;
      }
      const omitted = blocks.length - i;
      return `${out.join("\n")}\n\n[Truncated: ${omitted} more slide${omitted === 1 ? "" : "s"} omitted (limit: ${MAX_READ_CHARS} characters).]`;
    }
  }
  return out.join("\n");
}

function readSlides(page: AdapterPage, budget: number): string {
  if (!isRecord(page.data) || !Array.isArray(page.data.slides)) {
    return readSlidesSegments(page.segments ?? [], budget, page.focusIds);
  }

  const deck = normalizeDeck(page.data);
  if (!deck.slides.length) {
    return readSlidesSegments(page.segments ?? [], budget, page.focusIds);
  }

  const segmentById = new Map((page.segments ?? []).map((segment) => [segment.id, segmentText(segment)]));
  const rows = slideRows(deck.slides);
  const sectionOf = new Map<string, string>();
  rows.forEach((row) => row.slides.forEach((slide) => {
    if (row.title.trim()) sectionOf.set(slide.id, row.title.trim());
  }));
  const namedSections = rows.map((row) => row.title.trim()).filter(Boolean);

  const noticeReserve = 120;
  const metaLines = [`Theme: ${deck.theme.id} (${deck.theme.mode})`];
  if (namedSections.length) {
    const sectionsLine = clipToBudget(`Sections: ${namedSections.join(" | ")}`, Math.min(1000, Math.max(0, budget - metaLines[0].length - noticeReserve - 1)));
    if (sectionsLine) metaLines.push(sectionsLine);
  }
  const metaHeader = clipToBudget(metaLines.join("\n"), Math.max(0, budget - noticeReserve));
  const focus = focusIdSet(page.focusIds);

  const formatSlideBlock = (slide: (typeof deck.slides)[number], index: number, prioritizeElements: boolean) => {
    const section = sectionOf.get(slide.id);
    const meta = [`id: ${slide.id}`, `layout: ${slide.layout}`, ...(section ? [`section: ${section}`] : [])].join(", ");
    const lines = [`## Slide ${index + 1} (${meta})${slide.hidden ? " [hidden]" : ""}`];

    if (slide.elements.length) {
      const elements = prioritizeElements && focus.size > 0
        ? [...slide.elements.filter((element) => focus.has(element.id)), ...slide.elements.filter((element) => !focus.has(element.id))]
        : slide.elements;
      for (const element of elements) {
        lines.push(formatSlideElement(element));
      }
    } else {
      const fallback = segmentById.get(slide.id);
      if (fallback) lines.push(`- ${inlineLine(fallback)}`);
      else if (!slide.notes?.trim()) lines.push("(no text)");
    }

    if (slide.notes?.trim()) {
      lines.push(`Notes: ${slide.notes.trim()}`);
    }
    return lines.join("\n");
  };

  const slideEntries = deck.slides.map((slide, index) => ({
    slide,
    index,
    focused: focus.size > 0 && (focus.has(slide.id) || slide.elements.some((element) => focus.has(element.id))),
    block: formatSlideBlock(slide, index, false),
  }));

  const fullLength = metaHeader.length + slideEntries.reduce((sum, entry) => sum + 2 + entry.block.length, 0);
  const focusedEntries = slideEntries.filter((entry) => entry.focused);
  const unfocusedEntries = slideEntries.filter((entry) => !entry.focused);
  // 複数枚が選ばれているときは、先頭の 1 枚（長い発表者ノートなど）が枠を使い切らないよう各選択スライドに均等枠を確保してから残りを未選択に回す。
  const orderedBlocks: string[] = (() => {
    if (fullLength <= budget || !focusedEntries.length) {
      return slideEntries.map((entry) => entry.block);
    }
    const availableForFocused = Math.max(0, budget - metaHeader.length - noticeReserve);
    const perFocusedBudget = Math.max(0, Math.floor(availableForFocused / focusedEntries.length) - 2);
    const preparedFocused = focusedEntries.map((entry) => {
      if (entry.block.length <= perFocusedBudget) return entry.block;
      const compact = formatSlideBlock(entry.slide, entry.index, true);
      if (compact.length <= perFocusedBudget) return compact;
      return clipToBudget(compact, perFocusedBudget) || compact.slice(0, perFocusedBudget);
    });
    return [...preparedFocused, ...unfocusedEntries.map((entry) => entry.block)];
  })();

  const out: string[] = metaHeader ? [metaHeader] : [];
  let used = metaHeader.length;

  for (let i = 0; i < orderedBlocks.length; i++) {
    const block = orderedBlocks[i];
    const sep = 2; // "\n\n"
    const isLast = i === orderedBlocks.length - 1;
    const limit = isLast ? budget : Math.max(0, budget - noticeReserve);
    if (used + sep + block.length <= limit) {
      out.push(block);
      used += sep + block.length;
    } else {
      if (i === 0) {
        const remaining = Math.max(0, budget - used - sep - noticeReserve);
        const clipped = clipToBudget(block, remaining);
        if (clipped) out.push(clipped);
        const omitted = orderedBlocks.length - 1;
        return omitted > 0
          ? `${out.join("\n\n")}\n\n[Truncated: ${omitted} more slide${omitted === 1 ? "" : "s"} omitted (limit: ${MAX_READ_CHARS} characters).]`
          : `${out.join("\n\n")}\n\n[Truncated: content exceeds ${MAX_READ_CHARS} characters.]`;
      }
      const omitted = orderedBlocks.length - i;
      return `${out.join("\n\n")}\n\n[Truncated: ${omitted} more slide${omitted === 1 ? "" : "s"} omitted (limit: ${MAX_READ_CHARS} characters).]`;
    }
  }

  return out.join("\n\n");
}

export function canvasTextAdapter(kind: CanvasKind): PageAdapter {
  return {
    kind,
    needsData: true,
    ...canvasStorage(kind),
    read(page) {
      const header = `# ${page.title}\n\n`;
      const budget = Math.max(0, MAX_READ_CHARS - header.length);
      const body = kind === "whiteboard" ? readWhiteboard(page, budget) : readSlides(page, budget);
      return `${header}${body || "(This page has no text.)"}`;
    },
    readNote() {
      return kind === "whiteboard"
        ? `This page is ${KIND_NAMES[kind]}, not a note. You can read its structured frames, elements (with IDs, types, text, groups and page links) and arrow/line connections; the tools cannot change it yet, so tell the user it can't be edited from chat yet.`
        : `This page is ${KIND_NAMES[kind]}, not a note. You can read its theme, sections, slides (with stable slide IDs and layouts), elements (with IDs, roles, rich text, tables and image descriptions) and speaker notes; the tools cannot change it yet, so tell the user it can't be edited from chat yet.`;
    },
  };
}
