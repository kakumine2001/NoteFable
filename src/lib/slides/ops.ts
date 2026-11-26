import { createSlide } from "@/lib/slides/layouts";
import { isColorRef, newId, normalizeElement, slideRows, slidesFromRows, type ColorRef, type Deck, type LayoutId, type Slide, type SlideElement, type SlideTransition } from "@/lib/slides/model";
import { MAX_SLIDE_ELEMENTS, MAX_SLIDES } from "@/lib/canvas-document";

// スライドの本体を変える純粋な関数（元のオブジェクトは書き換えず、新しいものを返す。取り消し・やり直しは前の値を持つだけ）。

export function updateSlide(deck: Deck, slideId: string, update: (slide: Slide) => Slide): Deck {
  return { ...deck, slides: deck.slides.map((slide) => (slide.id === slideId ? update(slide) : slide)) };
}

// 1 枚を、新しい枚か「最新の枚から新しい枚を作る関数」で置き換える。何も変わらなければ同じ本体を返す（取り消しの段を増やさない）。
export function replaceSlide(deck: Deck, slideId: string, next: Slide | ((latest: Slide) => Slide)): Deck {
  let changed = false;
  const slides = deck.slides.map((slide) => {
    if (slide.id !== slideId) return slide;
    const updated = typeof next === "function" ? next(slide) : next;
    if (updated !== slide) changed = true;
    return updated;
  });
  return changed ? { ...deck, slides } : deck;
}

export function updateElements(slide: Slide, ids: Set<string>, update: (element: SlideElement) => SlideElement): Slide {
  return { ...slide, elements: slide.elements.map((element) => (ids.has(element.id) ? update(element) : element)) };
}

export function insertSlides(deck: Deck, index: number, slides: Slide[]): Deck {
  const room = Math.max(0, MAX_SLIDES - deck.slides.length);
  const added = slides.slice(0, room);
  const at = Math.max(0, Math.min(index, deck.slides.length));
  return { ...deck, slides: [...deck.slides.slice(0, at), ...added, ...deck.slides.slice(at)] };
}

// 新しい 1 枚を index の位置に入れる（行の途中なら同じ行に入る）。
export function addSlide(deck: Deck, index: number, layout: LayoutId): { deck: Deck; slideId: string | null } {
  if (deck.slides.length >= MAX_SLIDES) return { deck, slideId: null };
  const slide = createSlide(layout);
  return { deck: insertSlides(deck, index, [slide]), slideId: slide.id };
}

// 要素を写す（ID とグループを付け直す。同じグループだった要素は同じ新しいグループになる）。
export function cloneElements(elements: SlideElement[], offset = 0): SlideElement[] {
  const groups = new Map<string, string>();
  return elements.map((element) => {
    const copy = normalizeElement(JSON.parse(JSON.stringify(element)), newId()) ?? element;
    const group = element.group ? groups.get(element.group) ?? newId() : undefined;
    if (element.group && group) groups.set(element.group, group);
    return { ...copy, x: copy.x + offset, y: copy.y + offset, ...(group ? { group } : {}) };
  });
}

export function cloneSlide(slide: Slide): Slide {
  return { ...slide, id: newId(), elements: cloneElements(slide.elements) };
}

// 選んだ枚を写して、それぞれのすぐ後ろに入れる。新しい枚の ID を返す。
export function duplicateSlides(deck: Deck, ids: Set<string>): { deck: Deck; created: string[] } {
  const created: string[] = [];
  const slides: Slide[] = [];
  let room = MAX_SLIDES - deck.slides.length;
  for (const slide of deck.slides) {
    slides.push(slide);
    if (ids.has(slide.id) && room > 0) {
      const { section: _section, ...rest } = cloneSlide(slide);
      void _section;
      slides.push(rest);
      created.push(rest.id);
      room--;
    }
  }
  return { deck: { ...deck, slides }, created };
}

// 消す。行の先頭の枚を消したら、行の名前は次の枚が引き継ぐ。
export function deleteSlides(deck: Deck, ids: Set<string>): Deck {
  const rows = slideRows(deck.slides).map((row) => ({ title: row.title, slides: row.slides.filter((slide) => !ids.has(slide.id)) }));
  return { ...deck, slides: slidesFromRows(rows) };
}

export function setHidden(deck: Deck, ids: Set<string>, hidden: boolean): Deck {
  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      if (!ids.has(slide.id)) return slide;
      if (hidden) return { ...slide, hidden: true };
      const { hidden: _hidden, ...rest } = slide;
      void _hidden;
      return rest;
    }),
  };
}

export function setTransition(deck: Deck, ids: Set<string>, transition: SlideTransition): Deck {
  let changed = false;
  const slides = deck.slides.map((slide) => {
    if (!ids.has(slide.id)) return slide;
    const current = slide.transition ?? "none";
    if (current === transition) return slide;
    changed = true;
    if (transition === "fade" || transition === "slide") return { ...slide, transition };
    const { transition: _transition, ...rest } = slide;
    void _transition;
    return rest;
  });
  return changed ? { ...deck, slides } : deck;
}

// 選んだ枚を、並びの index（動かす前の並びでの位置）の前へ移す。行の名前は行の先頭に付け直す。
// targetRow を渡すと（総覧の行へ落とした）、その行に入れる。
export function moveSlides(deck: Deck, ids: Set<string>, index: number): Deck {
  if (!ids.size) return deck;
  const rows = slideRows(deck.slides).map((row) => ({ title: row.title, slides: [...row.slides] }));
  // index の位置にある枚（その前に入れる）と、それが属する行。末尾なら最後の行の後ろ。
  const target = deck.slides[index];
  const moving = deck.slides.filter((slide) => ids.has(slide.id));
  for (const row of rows) row.slides = row.slides.filter((slide) => !ids.has(slide.id));
  if (target && !ids.has(target.id)) {
    const row = rows.find((entry) => entry.slides.some((slide) => slide.id === target.id))!;
    row.slides.splice(row.slides.findIndex((slide) => slide.id === target.id), 0, ...moving);
  } else if (target) {
    // 目標が動かす枚自身：その枚がいた行の、同じ位置に入れる（自分の上に落としても行が変わらない・章が消えない）。
    const original = slideRows(deck.slides);
    const rowIndex = original.findIndex((row) => row.slides.some((slide) => slide.id === target.id));
    const inRow = original[rowIndex].slides;
    const position = inRow.slice(0, inRow.findIndex((slide) => slide.id === target.id)).filter((slide) => !ids.has(slide.id)).length;
    rows[rowIndex].slides.splice(position, 0, ...moving);
  } else {
    // 末尾：最後の行の末尾。
    {
      const last = [...rows].reverse().find((row) => row.slides.length) ?? rows[0];
      if (last) last.slides.push(...moving);
      else rows.push({ title: "", slides: moving });
    }
  }
  return { ...deck, slides: slidesFromRows(rows) };
}

// 総覧の行の位置に入れる：rowIndex 行目の position 番目（その行の中の位置）。rowIndex が行の数と同じなら新しい行を作る。
export function moveSlidesToRow(deck: Deck, ids: Set<string>, rowIndex: number, position: number): Deck {
  const rows = slideRows(deck.slides).map((row) => ({ title: row.title, slides: [...row.slides] }));
  const moving = deck.slides.filter((slide) => ids.has(slide.id));
  if (!moving.length) return deck;
  // 位置は動かす前の行で数えるので、同じ行で前にある動かす枚の分だけ詰める。
  const targetRow = rows[rowIndex];
  const before = targetRow ? targetRow.slides.slice(0, position).filter((slide) => ids.has(slide.id)).length : 0;
  for (const row of rows) row.slides = row.slides.filter((slide) => !ids.has(slide.id));
  if (targetRow) targetRow.slides.splice(Math.max(0, position - before), 0, ...moving);
  else rows.push({ title: "", slides: moving });
  return { ...deck, slides: slidesFromRows(rows) };
}

// 行（章）を分ける：この枚から新しい行を始める。
export function startRowAt(deck: Deck, slideId: string, title = ""): Deck {
  return updateSlide(deck, slideId, (slide) => ({ ...slide, section: slide.section ?? title }));
}
// 行の区切りを外す（前の行につなげる）。先頭の行の名前は消す。
export function joinRowAt(deck: Deck, slideId: string): Deck {
  return updateSlide(deck, slideId, (slide) => {
    const { section: _section, ...rest } = slide;
    void _section;
    return rest;
  });
}
export function renameRow(deck: Deck, slideId: string, title: string): Deck {
  return updateSlide(deck, slideId, (slide) => ({ ...slide, section: title.slice(0, 200) }));
}

// ---- 要素 ----

export function addElements(slide: Slide, elements: SlideElement[]): Slide {
  const room = Math.max(0, MAX_SLIDE_ELEMENTS - slide.elements.length);
  return { ...slide, elements: [...slide.elements, ...elements.slice(0, room)] };
}

export function deleteElements(slide: Slide, ids: Set<string>): Slide {
  return { ...slide, elements: slide.elements.filter((element) => !ids.has(element.id)) };
}

export type ZOrder = "front" | "back" | "forward" | "backward";
// 重なり順（配列の後ろほど手前）。選んだ要素の並びは保つ。
export function reorderElements(slide: Slide, ids: Set<string>, order: ZOrder): Slide {
  const elements = [...slide.elements];
  const picked = elements.filter((element) => ids.has(element.id));
  if (!picked.length) return slide;
  const rest = elements.filter((element) => !ids.has(element.id));
  if (order === "front") return { ...slide, elements: [...rest, ...picked] };
  if (order === "back") return { ...slide, elements: [...picked, ...rest] };
  if (order === "forward") {
    for (let index = elements.length - 2; index >= 0; index--) {
      if (ids.has(elements[index].id) && !ids.has(elements[index + 1].id)) [elements[index], elements[index + 1]] = [elements[index + 1], elements[index]];
    }
  } else {
    for (let index = 1; index < elements.length; index++) {
      if (ids.has(elements[index].id) && !ids.has(elements[index - 1].id)) [elements[index], elements[index - 1]] = [elements[index - 1], elements[index]];
    }
  }
  return { ...slide, elements };
}

// 組み合わせる（2 つ以上）。前からのグループは新しいグループにまとめる。重なり順は一番手前の要素の位置にそろえる。
export function groupElements(slide: Slide, ids: Set<string>): { slide: Slide; group: string | null } {
  const picked = slide.elements.filter((element) => ids.has(element.id));
  if (picked.length < 2) return { slide, group: null };
  const group = newId();
  const lastIndex = Math.max(...picked.map((element) => slide.elements.indexOf(element)));
  const rest = slide.elements.filter((element) => !ids.has(element.id));
  const insertAt = slide.elements.slice(0, lastIndex + 1).filter((element) => !ids.has(element.id)).length;
  const grouped = picked.map((element) => ({ ...element, group }));
  return { slide: { ...slide, elements: [...rest.slice(0, insertAt), ...grouped, ...rest.slice(insertAt)] }, group };
}

export function ungroupElements(slide: Slide, ids: Set<string>): Slide {
  return updateElements(slide, ids, (element) => {
    const { group: _group, ...rest } = element;
    void _group;
    return rest as SlideElement;
  });
}

// ---- クリップボード ----

export const CLIPBOARD_MIME = "application/x-notefable-slides";
export type SlidesClipboard = { notefableSlides: 1; elements?: SlideElement[]; slides?: Slide[] };

export function clipboardPayload(content: { elements?: SlideElement[]; slides?: Slide[] }): string {
  return JSON.stringify({ notefableSlides: 1, ...content } satisfies SlidesClipboard);
}

// 貼り付けた文字がこのエディターの要素・枚なら読む（壊れた値は落とす。ID は貼る時に付け直す）。
export function parseClipboard(text: string): { elements: SlideElement[]; slides: Slide[] } | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== "object" || (value as { notefableSlides?: unknown }).notefableSlides !== 1) return null;
  const payload = value as { elements?: unknown; slides?: unknown };
  // グループも付け直す（写した元と同じグループのままだと、貼った要素と元の要素が一緒に選ばれて動く）。
  const elements = cloneElements((Array.isArray(payload.elements) ? payload.elements : []).slice(0, MAX_SLIDE_ELEMENTS)
    .map((element) => normalizeElement(element, newId())).filter((element): element is SlideElement => element !== null));
  const slides = (Array.isArray(payload.slides) ? payload.slides : []).slice(0, MAX_SLIDES).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const source = raw as { elements?: unknown; background?: unknown; hidden?: unknown; transition?: unknown };
    const slideElements = (Array.isArray(source.elements) ? source.elements : []).slice(0, MAX_SLIDE_ELEMENTS).map((element) => normalizeElement(element, newId())).filter((element): element is SlideElement => element !== null);
    const layout = (raw as { layout?: unknown }).layout;
    const notes = (raw as { notes?: unknown }).notes;
    const slide: Slide = { ...createSlide("blank"), elements: cloneElements(slideElements) };
    if (typeof layout === "string") slide.layout = (["title", "section", "bullets", "twoColumn", "imageText", "quote", "fullImage", "blank"].includes(layout) ? layout : "blank") as LayoutId;
    if (typeof notes === "string" && notes) slide.notes = notes.slice(0, 20_000);
    if (source.hidden === true) slide.hidden = true;
    if (source.background === null || isColorRef(source.background)) slide.background = source.background as ColorRef | null;
    if (source.transition === "fade" || source.transition === "slide") slide.transition = source.transition;
    return [slide];
  });
  return { elements: cloneElements(elements), slides };
}
