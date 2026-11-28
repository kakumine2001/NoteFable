// 原生端的白板提案说明翻译（mobile/android/.../data/WhiteboardProposalText.kt、
// mobile/ios/NoteFable/Core/Chat/WhiteboardProposalText.swift）和网页 src/lib/whiteboard/proposal-text.ts 的对照用例。
// 译文表是记号（每一句包在 ‹›里），不跟着字典变化；期望值由网页的实现算出，写进 Android 单元测试的资源
// （WhiteboardProposalTextTest）和 iOS 的测试夹具（WhiteboardProposalTextTests），两份内容相同。
// 生成：npx tsx scripts/gen-native-whiteboard-proposal-cases.ts
// src/lib/native-whiteboard-proposal-cases.test.ts 会在用例过期（改了规则没重新生成）时让测试失败。
import path from "node:path";
import { createTranslator } from "../src/lib/i18n/translate";
import type { ProposalChange, ProposalOp, ProposalTarget } from "../src/lib/page-ai/types";
import { localizeWhiteboardChange, localizeWhiteboardSummary, WHITEBOARD_PROPOSAL_KEYS } from "../src/lib/whiteboard/proposal-text";

export const NATIVE_WHITEBOARD_PROPOSAL_CASES = path.join(process.cwd(), "mobile/android/app/src/test/resources/whiteboard-proposal-cases.json");
export const IOS_WHITEBOARD_PROPOSAL_CASES = path.join(process.cwd(), "mobile/ios/Tests/NoteFableCoreTests/Fixtures/whiteboard-proposal-cases.json");

const one = (name?: string, count = 1): ProposalTarget => ({ type: "elements", count, ...(name === undefined ? {} : { name }) });
const change = (op: ProposalOp, target: ProposalTarget | undefined, values: { before?: string; after?: string } = {}): ProposalChange =>
  ({ op, block: 0, ...(target ? { target } : {}), ...values });

// 48 文字で切る名前（サロゲートペアをまたがない位置と、全角の空白をまとめる場合）。
const LONG = `${"x".repeat(45)}　  end of a long label that keeps going`;
const LONG_NAME = `${`${"x".repeat(45)} end of a long label that keeps going`.slice(0, 47)}…`;

const CHANGES: ProposalChange[] = [
  change("add", one("Interview users"), { after: "stickynote: Interview users" }),
  change("add", one("rectangle"), { after: "rectangle: (empty)" }),
  change("add", one("(empty)"), { after: "text: (empty)" }),
  change("add", one(LONG_NAME), { after: `stickynote: ${LONG}` }),
  change("add", one("Line one two"), { after: "ellipse: Line one\ntwo" }),
  change("add", one("Next"), { after: 'Frame "Next" (2 elements)' }),
  change("add", one("Next"), { after: 'Frame "Next" (1 element)' }),
  change("add", one('A "B" (3 elements)'), { after: 'Frame "A "B" (3 elements)"' }),
  change("add", one("Frame"), { after: 'Frame "Frame"' }),
  change("add", one("Research -> Decide"), { after: "Research -> Decide" }),
  change("add", one("rectangle -> ellipse"), { after: "rectangle -> ellipse" }),
  change("add", one("a -> b -> arrow"), { after: "a -> b -> arrow" }),
  change("add", one("feeds"), { after: 'text -> diamond ("feeds")' }),
  change("add", one("x: y"), { after: 'text: abc -> x ("x: y")' }),
  change("add", one("text: abc -> def"), { after: "text: abc -> def" }),
  change("add", one("x"), { after: "Something new" }),
  change("update", one(undefined, 2), { after: "Group 2 elements" }),
  change("update", one(undefined, 1), { after: "Group 1 elements" }),
  change("update", one(undefined, 1), { after: "Ungroup 1 elements" }),
  change("update", one(undefined, 3), { after: "Ungroup 3 elements" }),
  change("update", one(undefined, 3), { after: "Regroup 3 elements" }),
  change("update", one("Research · users"), { before: "Research", after: "Research · users · color: Purple · style: dashed" }),
  change("update", one("text"), { before: "(empty)", after: "text" }),
  change("update", one("rectangle"), { before: "Old", after: "(empty)" }),
  change("update", one("color: red"), { after: "color: red" }),
  change("update", one("ellipse"), { after: "color: #D0EBFF" }),
  change("update", one("ellipse"), { after: "color:  Grey  " }),
  change("update", one("ellipse"), { after: "color: " }),
  change("update", one("Goal"), { after: "color: chartreuse" }),
  change("update", one("Goal"), { after: "size: xl" }),
  change("update", one("Goal"), { after: "color: teal · style: dotted · size: small" }),
  change("update", one("Frame"), { before: "(unnamed)", after: "Frame" }),
  change("update", one("arrow"), { after: "style: solid" }),
  // 長い文字と設定の両方を変えた（名前は切られているので、改後の全体とも合う）。長い文字だけの変更。
  change("update", one(LONG_NAME), { before: "Old", after: `${LONG} · color: red · style: dashed · size: large` }),
  change("update", one(LONG_NAME), { before: "Old", after: `${LONG} · size: small` }),
  change("update", one(LONG_NAME), { before: "Old", after: LONG }),
  change("move", one("diamond"), { after: 'Move into frame "Plan"' }),
  change("move", one(undefined, 3), { after: 'Move into frame "A "quoted" name"' }),
  change("move", one("Ship"), { after: "Remove from frame" }),
  change("reorder", one(undefined, 3), { after: "Arrange 3 elements in row" }),
  change("reorder", one(undefined, 1), { after: "Arrange 1 element in column" }),
  change("reorder", one(undefined, 4), { after: 'Arrange 4 elements in grid inside frame "Plan"' }),
  change("reorder", one(undefined, 2), { after: 'Arrange 2 elements in cluster inside frame "Line\nbreak"' }),
  change("reorder", one(undefined, 2), { after: "Arrange 2 elements in spiral" }),
  change("delete", one("arrow"), { before: "arrow" }),
  change("delete", one("Ship it"), { before: "Ship it" }),
  change("delete", one(undefined, 3), { before: "line, Ship it, freedraw" }),
  change("delete", one(undefined, 8), { before: "a, b, c, d, image, stickynote (+2)" }),
  change("delete", one(undefined, 2), { before: "apples, arrow, pears" }),
  // 名前の無い枠（サーバーの "Frame"）：削除、設定の変更、移動、並べ替え、線の端。
  change("delete", one("Frame"), { before: "Frame" }),
  change("delete", one(undefined, 2), { before: "Frame, Ship it" }),
  change("update", one("Frame"), { after: "style: dashed" }),
  change("move", one("Frame"), { after: "Remove from frame" }),
  change("move", one("Ship"), { after: 'Move into frame "Frame"' }),
  change("reorder", one(undefined, 2), { after: 'Arrange 2 elements in row inside frame "Frame"' }),
  change("add", one("Frame -> ellipse"), { after: "Frame -> ellipse" }),
  change("replace", one("rectangle"), { before: "rectangle", after: "(empty)" }),
  change("update", { type: "slide", number: 2 }, { before: "color: red", after: "(empty)" }),
  change("delete", undefined, { before: "rectangle" }),
];

const SUMMARIES = [
  "Diagram (flowchart, 5 elements)",
  "Diagram (graph, 1 element)",
  "Diagram (stateDiagram-v2, 12 elements)",
  "Diagram (mindmap, 40 elements)",
  "Diagram (unknownKind, 2 elements)",
  'Frame "To Do" (1 item)\nFrame "Done" (0 items)\n- text: Notes: later\n- rectangle: Box',
  '- stickynote: Frame "x" (2 items)\n- diamond: \nA line the server never wrote',
  "",
];

export function nativeWhiteboardProposalCases(): string {
  const t = createTranslator(Object.fromEntries(WHITEBOARD_PROPOSAL_KEYS.map((key) => [key, `‹${key}›`])));
  const cases = {
    keys: WHITEBOARD_PROPOSAL_KEYS,
    changes: CHANGES.map((input) => ({ input, expected: localizeWhiteboardChange(input, t) })),
    summaries: SUMMARIES.map((input) => ({ input, expected: localizeWhiteboardSummary(input, t) })),
  };
  return `${JSON.stringify(cases, null, 1)}\n`;
}
