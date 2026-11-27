import { msg, type Translate, type TranslateVars } from "@/lib/i18n/translate";
import type { ProposalChange, ProposalTarget } from "@/lib/page-ai/types";

// 白板の AI 提案の説明（改前・改後、対象の名前、新しい白板の概要）は、サーバー（whiteboard/ai-edit.ts と
// page-ai/whiteboard-adapter.ts）が決まった形の英語で作り、提案と一緒に保存する。表示するときにだけ、この形に当てはまる所を訳す
// （保存済みの履歴の提案も同じ形）。保存した内容は変えない。モデルへの結果と適用は、この説明を使わない。
// 要素の文字・枠の名前は利用者の内容なので訳さない。形に当てはまらない文は、そのまま出す。
// Android（data/WhiteboardProposalText.kt）と iOS（Core/Chat/WhiteboardProposalText.swift）にも同じ規則があり、
// scripts/native-whiteboard-proposal-cases.ts の対照用例でそろえる。ai-edit.ts の文の形を変えたら 3 つとも直す
// （保存済みの古い形も訳せるように残す）。

// 要素の種類（Excalidraw の type）の名前。文字の無い要素は、サーバーが種類をそのまま名前にする。
const ELEMENT_TYPES: Record<string, string> = {
  rectangle: msg("Rectangle"), ellipse: msg("Ellipse"), diamond: msg("Diamond"), stickynote: msg("Sticky note"),
  text: msg("Text"), arrow: msg("Arrow"), line: msg("Line"), freedraw: msg("Pen"), image: msg("Image"),
  // 名前の無い枠は、サーバー（getElementLabel）が "Frame" を名前にする。
  Frame: msg("Frame"),
};
// AI が足せる種類（ai-edit.ts の AI_SHAPE_TYPES）。
const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond", "stickynote", "text"]);
const COLOR_NAMES: Record<string, string> = {
  default: msg("Default"), neutral: msg("Default"), yellow: msg("Yellow"), blue: msg("Blue"), green: msg("Green"),
  orange: msg("Orange"), red: msg("Red"), purple: msg("Purple"), teal: msg("Teal"), pink: msg("Pink"), gray: msg("Gray"), grey: msg("Gray"),
};
const STROKE_STYLES: Record<string, string> = { solid: msg("Solid"), dashed: msg("Dashed"), dotted: msg("Dotted") };
const TEXT_SIZES: Record<string, string> = { small: msg("Small"), medium: msg("Medium"), large: msg("Large"), xl: msg("Extra large") };
const LAYOUTS: Record<string, string> = { row: msg("in a row"), column: msg("in a column"), grid: msg("in a grid"), cluster: msg("in a cluster") };
// Mermaid の図の種類（whiteboard/diagram.ts の DIAGRAM_KINDS）。
const DIAGRAM_KINDS: Record<string, string> = {
  flowchart: msg("flowchart"), graph: msg("flowchart"), sequenceDiagram: msg("sequence diagram"), stateDiagram: msg("state diagram"),
  "stateDiagram-v2": msg("state diagram"), classDiagram: msg("class diagram"), erDiagram: msg("ER diagram"), timeline: msg("timeline"),
  gantt: msg("Gantt chart"), quadrantChart: msg("quadrant chart"), mindmap: msg("mind map"),
};
const TEXT = {
  diagramOne: msg("Diagram ({kind}, 1 element)"),
  diagram: msg("Diagram ({kind}, {count} elements)"),
  frameItemOne: msg("Frame “{name}” (1 item)"),
  frameItems: msg("Frame “{name}” ({count} items)"),
  frame: msg("Frame “{name}”"),
  frameElementOne: msg("Frame “{name}” (1 element)"),
  frameElements: msg("Frame “{name}” ({count} elements)"),
  moveIntoFrame: msg("Move into frame “{name}”"),
  removeFromFrame: msg("Remove from frame"),
  arrangeOne: msg("Arrange 1 element {layout}"),
  arrange: msg("Arrange {count} elements {layout}"),
  arrangeInFrameOne: msg("Arrange 1 element {layout} inside frame “{name}”"),
  arrangeInFrame: msg("Arrange {count} elements {layout} inside frame “{name}”"),
  groupOne: msg("Group 1 element"),
  group: msg("Group {count} elements"),
  ungroupOne: msg("Ungroup 1 element"),
  ungroup: msg("Ungroup {count} elements"),
  labelled: msg("{type}: {text}"),
  empty: msg("(empty)"),
  unnamed: msg("(unnamed)"),
  color: msg("Color: {color}"),
  strokeStyle: msg("Line style: {style}"),
  textSize: msg("Text size: {size}"),
};

// ここで使う訳の英語の文（原生アプリの system-text.json に入れる）。
export const WHITEBOARD_PROPOSAL_KEYS: readonly string[] = [...new Set([
  ...Object.values(ELEMENT_TYPES), ...Object.values(COLOR_NAMES), ...Object.values(STROKE_STYLES), ...Object.values(TEXT_SIZES),
  ...Object.values(LAYOUTS), ...Object.values(DIAGRAM_KINDS), ...Object.values(TEXT),
])];

type ElementsTarget = Extract<ProposalTarget, { type: "elements" }>;

const lookup = (table: Record<string, string>, key: string) => (Object.hasOwn(table, key) ? table[key] : undefined);

// 名前が種類そのもの（文字の無い要素）なら、種類の名前にする。
// 限界：保存した提案は、文字の無い要素の名前と、文字が種類の英語名そのもの（"image"、"line" など）の要素を区別しない。
// 足す・文字を変える以外の説明（設定だけの変更、移動、削除、線の両端）では、後者も種類の名前になる。
// 同じく、利用者が "Frame" と名づけた枠（や文字が "Frame" の要素）は、名前の無い枠と区別できないので訳す。
function typeName(name: string, t: Translate) {
  const key = lookup(ELEMENT_TYPES, name);
  return key ? t(key) : name;
}

// ai-edit.ts の shortLabel と同じ（1 行にして 48 文字まで）。対象の名前と本文の突き合わせに使う。
function shortLabel(text: string, fallback: string) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return fallback;
  return oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine;
}

function counted(count: string, one: string, many: string, t: Translate, vars: TranslateVars = {}) {
  return Number(count) === 1 ? t(one, vars) : t(many, { ...vars, count });
}

const placeholder = (text: string, t: Translate) => (text === "(empty)" ? t(TEXT.empty) : text === "(unnamed)" ? t(TEXT.unnamed) : text);

// 説明の中の枠の名前。名前の無い枠のときだけ訳す。
const frameName = (name: string, t: Translate) => (name === "Frame" ? typeName(name, t) : name);

// 矢印の両端（"A -> B"）。区切りが 1 つのときだけ、文字の無い端を種類の名前にする。
function endpoints(pair: string, t: Translate) {
  const ends = pair.split(" -> ");
  return ends.length === 2 ? ends.map((end) => typeName(end, t)).join(" -> ") : pair;
}

// 足した：枠、要素（"種類: 文字"）、線（"A -> B" か 'A -> B ("ラベル")'）。
function added(change: ProposalChange, target: ElementsTarget, t: Translate): ProposalChange {
  const { after } = change;
  const { name } = target;
  if (after === undefined || name === undefined) return change;
  const quoted = `Frame "${name}"`;
  if (after === quoted) return { ...change, after: t(TEXT.frame, { name }) };
  if (after.startsWith(`${quoted} (`)) {
    const members = /^ \(([0-9]+) elements?\)$/.exec(after.slice(quoted.length));
    if (members) return { ...change, after: counted(members[1], TEXT.frameElementOne, TEXT.frameElements, t, { name }) };
  }
  const colon = after.indexOf(": ");
  const type = after.slice(0, Math.max(0, colon));
  if (SHAPE_TYPES.has(type)) {
    const text = after.slice(colon + 2);
    // 名前は文字の先頭。文字が無ければ名前は種類で、後ろは "(empty)"。
    const empty = text === "(empty)" && name === type;
    if (empty || name === shortLabel(text, type)) {
      return {
        ...change,
        ...(empty ? { target: { ...target, name: typeName(type, t) } } : {}),
        after: t(TEXT.labelled, { type: typeName(type, t), text: empty ? t(TEXT.empty) : text }),
      };
    }
  }
  if (after === name && after.includes(" -> ")) {
    const pair = endpoints(after, t);
    return { ...change, target: { ...target, name: pair }, after: pair };
  }
  const label = ` ("${name}")`;
  if (after.endsWith(label) && after.slice(0, -label.length).includes(" -> ")) {
    return { ...change, after: `${endpoints(after.slice(0, -label.length), t)}${label}` };
  }
  return change;
}

// 要素の変更の要約（"文字 · color: x · style: y · size: z"。変わったものだけが、この順に並ぶ）。
function updateSummary(after: string, t: Translate) {
  const parts = after.split(" · ");
  const settings: string[] = [];
  const last = () => parts[parts.length - 1] ?? "";
  const size = /^size: (small|medium|large|xl)$/.exec(last());
  if (size) { parts.pop(); settings.unshift(t(TEXT.textSize, { size: t(TEXT_SIZES[size[1]]) })); }
  const style = /^style: (solid|dashed|dotted)$/.exec(last());
  if (style) { parts.pop(); settings.unshift(t(TEXT.strokeStyle, { style: t(STROKE_STYLES[style[1]]) })); }
  const color = /^color: (.*)$/.exec(last());
  if (color) {
    const value = color[1].trim().toLowerCase();
    const key = value ? lookup(COLOR_NAMES, value) : COLOR_NAMES.default;
    if (key || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(value)) {
      parts.pop();
      settings.unshift(t(TEXT.color, { color: key ? t(key) : color[1] }));
    }
  }
  const text = parts.length ? parts.join(" · ") : undefined;
  return { text, summary: [...(text === undefined ? [] : [placeholder(text, t)]), ...settings].join(" · ") };
}

function updated(change: ProposalChange, target: ElementsTarget, t: Translate): ProposalChange {
  const { name } = target;
  const next: ProposalChange = { ...change };
  if (change.before !== undefined) next.before = placeholder(change.before, t);
  let written: string | undefined;
  // 対象の名前が、この文字から作られたものか。
  const named = (text: string | undefined) => text !== undefined && text !== "(empty)" && name === shortLabel(text, "");
  if (change.after !== undefined) {
    const { text, summary } = updateSummary(change.after, t);
    // 名前が改後の全体と合うなら、改後は書いた文字そのもの（文字だけを変えた）。ただし末尾の設定を外した文字も合うなら、
    // 文字と設定の両方を変えた（長い文字は名前が切られているので、全体とも合う）。
    if (named(change.after) && !(text !== change.after && named(text))) written = change.after;
    else {
      written = text;
      next.after = summary;
    }
  }
  // 書いた文字と同じ名前は利用者の文字。それ以外で種類と同じ名前は、文字の無い要素。
  if (name !== undefined && !named(written)) next.target = { ...target, name: typeName(name, t) };
  return next;
}

function grouped(change: ProposalChange, t: Translate): ProposalChange {
  const group = /^(Group|Ungroup) ([0-9]+) elements?$/.exec(change.after ?? "");
  if (!group) return change;
  const [one, many] = group[1] === "Group" ? [TEXT.groupOne, TEXT.group] : [TEXT.ungroupOne, TEXT.ungroup];
  return { ...change, after: counted(group[2], one, many, t) };
}

function moved(change: ProposalChange, target: ElementsTarget, t: Translate): ProposalChange {
  const into = /^Move into frame "([\s\S]*)"$/.exec(change.after ?? "");
  const after = into ? t(TEXT.moveIntoFrame, { name: frameName(into[1], t) }) : change.after === "Remove from frame" ? t(TEXT.removeFromFrame) : change.after;
  return { ...change, after, ...(target.name === undefined ? {} : { target: { ...target, name: typeName(target.name, t) } }) };
}

function arranged(change: ProposalChange, t: Translate): ProposalChange {
  const match = /^Arrange ([0-9]+) elements? in (row|column|grid|cluster)(?: inside frame "([\s\S]*)")?$/.exec(change.after ?? "");
  if (!match) return change;
  const [, count, layout, frame] = match;
  const vars = { layout: t(LAYOUTS[layout]) };
  const after = frame === undefined
    ? counted(count, TEXT.arrangeOne, TEXT.arrange, t, vars)
    : counted(count, TEXT.arrangeInFrameOne, TEXT.arrangeInFrame, t, { ...vars, name: frameName(frame, t) });
  return { ...change, after };
}

function deleted(change: ProposalChange, target: ElementsTarget, t: Translate): ProposalChange {
  if (target.name !== undefined) {
    // 1 つ：改前も同じ名前。
    const name = typeName(target.name, t);
    return { ...change, target: { ...target, name }, ...(change.before === target.name ? { before: name } : {}) };
  }
  // 複数："名前, 名前, …"（6 つまで、残りは " (+N)"）。名前の中に ", " があると切れ目が分からないので、数が合うときだけ。
  const list = /^([\s\S]*?)( \(\+[0-9]+\))?$/.exec(change.before ?? "");
  const names = list?.[1].split(", ");
  if (!list || !names || names.length !== Math.min(target.count, 6)) return change;
  return { ...change, before: names.map((name) => typeName(name, t)).join(", ") + (list[2] ?? "") };
}

// 白板の提案の変更 1 つを表示用に訳す（pageKind が whiteboard の提案にだけ使う）。
export function localizeWhiteboardChange(change: ProposalChange, t: Translate): ProposalChange {
  const { target } = change;
  if (target?.type !== "elements") return change;
  switch (change.op) {
    case "add": return added(change, target, t);
    case "update": return target.name === undefined ? grouped(change, t) : updated(change, target, t);
    case "move": return moved(change, target, t);
    case "reorder": return arranged(change, t);
    case "delete": return deleted(change, target, t);
    default: return change;
  }
}

// 新しい白板の提案の概要（Mermaid の図、または枠と要素の一覧）を表示用に訳す。
export function localizeWhiteboardSummary(content: string, t: Translate): string {
  const diagram = /^Diagram \(([A-Za-z0-9-]+), ([0-9]+) elements?\)$/.exec(content);
  const kind = diagram ? lookup(DIAGRAM_KINDS, diagram[1]) : undefined;
  if (diagram && kind) return counted(diagram[2], TEXT.diagramOne, TEXT.diagram, t, { kind: t(kind) });
  return content.split("\n").map((line) => {
    const frame = /^Frame "([^\n]*)" \(([0-9]+) items?\)$/.exec(line);
    if (frame) return counted(frame[2], TEXT.frameItemOne, TEXT.frameItems, t, { name: frame[1] });
    const item = /^- (rectangle|ellipse|diamond|stickynote|text): ([^\n]*)$/.exec(line);
    if (item) return `- ${t(TEXT.labelled, { type: typeName(item[1], t), text: item[2] })}`;
    return line;
  }).join("\n");
}
