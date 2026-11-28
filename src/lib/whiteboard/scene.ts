import { parseNoteFileUrl } from "@/lib/note-file-keys";
import { FORMULA_DATA_KEY, formulaDataOf } from "@/lib/whiteboard/formula";

// ホワイトボードの本体（NoteCanvas.data）と Excalidraw の scene の行き来（docs/architecture/whiteboard.md）。
// 保存する形は Excalidraw の scene と同じ並び：{ elements, files?, appState? }。
// - elements: 消した要素（isDeleted）は入れない（取り消しの履歴は開いている画面のメモリにだけある）。座標は小数 2 桁に丸める。
// - files: 生きている画像要素が使うファイルだけ。dataURL はアップロード済みの note-files の URL（/api/pages/files?key=…）で、
//   data: の埋め込みは入れない（サーバーが断る）。まだアップロードが終わっていない画像の要素は、終わるまで保存に入れない。
// - appState: 背景色・グリッド・吸着だけ（表示位置や選択は保存しない。表示位置は端末ごとに localStorage）。
// このファイルは Excalidraw の本体を読み込まない（サーバー・テストからも使う）。型だけを使う。

export type WhiteboardElement = { id: string; type: string; isDeleted?: boolean; [key: string]: unknown };

// ホワイトボードに置ける要素の種類（NoteFable の道具で作れるもの）。Excalidraw の埋め込み（embeddable・iframe）と
// AI の枠（magicframe）は入れない：公開リンクの見る画面で外部のページや任意の HTML を表示させないため。
// 保存（sceneToStored）・読み込み（storedToScene）・サーバーの検証（canvas-document.ts）が同じ表を使う。
export const WHITEBOARD_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame", "stickynote",
]);
export type WhiteboardFile = { id: string; mimeType: string; dataURL: string; created?: number; [key: string]: unknown };
export type WhiteboardFiles = Record<string, WhiteboardFile>;
export type WhiteboardAppState = {
  viewBackgroundColor?: string;
  gridModeEnabled?: boolean;
  gridSize?: number;
  gridStep?: number;
  objectsSnapModeEnabled?: boolean;
};
export type StoredWhiteboard = { elements: WhiteboardElement[]; files?: WhiteboardFiles; appState?: WhiteboardAppState };

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// 保存する appState の項目と、それぞれの値の形。
const APP_STATE_FIELDS: { [K in keyof WhiteboardAppState]-?: (value: unknown) => value is WhiteboardAppState[K] } = {
  viewBackgroundColor: (value): value is string => typeof value === "string" && value.length > 0 && value.length <= 64,
  gridModeEnabled: (value): value is boolean => typeof value === "boolean",
  gridSize: (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 1000,
  gridStep: (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100,
  objectsSnapModeEnabled: (value): value is boolean => typeof value === "boolean",
};

export function pickWhiteboardAppState(appState: unknown): WhiteboardAppState {
  if (!object(appState)) return {};
  const picked: Record<string, unknown> = {};
  for (const [key, valid] of Object.entries(APP_STATE_FIELDS)) {
    if (valid(appState[key])) picked[key] = appState[key];
  }
  return picked as WhiteboardAppState;
}

// 座標の丸め。表示には影響しない（0.005 px 未満）が、JSON が短くなる。
const round = (value: unknown, digits = 2) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const roundPoints = (points: unknown, digits = 2) => Array.isArray(points)
  ? points.map((point) => Array.isArray(point) ? point.map((value) => round(value, digits)) : point)
  : points;

const POSITION_KEYS = ["x", "y", "width", "height"] as const;
export const MAX_GENERATED_IMAGE_PROMPT = 4_000;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const DISALLOWED_PROMPT_PREFIX = /^\s*(?:data:[a-z]+\/[a-z0-9.+-]+[;,]|\/api\/pages\/files\?)/i;

export type WhiteboardGeneratedImageData = { prompt: string };

function sanitizeGeneratedPrompt(value: string): string {
  let cleaned = value.replace(/\u0000/g, "").replace(LONE_SURROGATE, "").trim();
  // 保存時の埋め込み data: URL / ファイル参照チェック（canvas-document.ts）を誤発火させない。
  if (DISALLOWED_PROMPT_PREFIX.test(cleaned)) cleaned = `prompt: ${cleaned}`;
  if (cleaned.length <= MAX_GENERATED_IMAGE_PROMPT) return cleaned;
  const end = (cleaned.charCodeAt(MAX_GENERATED_IMAGE_PROMPT - 1) & 0xfc00) === 0xd800
    ? MAX_GENERATED_IMAGE_PROMPT - 1
    : MAX_GENERATED_IMAGE_PROMPT;
  return cleaned.slice(0, end);
}

// AI で生成したホワイトボード画像の印（customData.generated）。報告のためにプロンプトを安全に保持し、公開共有では public.ts が落とす。
export function generatedImageDataOf(customData: unknown): WhiteboardGeneratedImageData | null {
  if (!object(customData)) return null;
  const generated = customData.generated;
  if (!object(generated) || typeof generated.prompt !== "string") return null;
  const prompt = sanitizeGeneratedPrompt(generated.prompt);
  return prompt ? { prompt } : null;
}

function sanitizeCustomData(element: WhiteboardElement): Record<string, unknown> | undefined {
  if (!object(element.customData)) return undefined;
  const hasGenerated = "generated" in element.customData;
  const hasFormula = FORMULA_DATA_KEY in element.customData;
  if (!hasGenerated && !hasFormula) return element.customData;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(element.customData)) {
    if (key === "generated" || key === FORMULA_DATA_KEY) continue;
    next[key] = value;
  }
  if (hasGenerated) {
    const valid = element.type === "image" ? generatedImageDataOf(element.customData) : null;
    if (valid) next.generated = valid;
  }
  if (hasFormula) {
    const valid = element.type === "image" ? formulaDataOf(element.customData) : null;
    if (valid) next[FORMULA_DATA_KEY] = valid;
  }
  return Object.keys(next).length ? next : undefined;
}

function compactElement(element: WhiteboardElement): WhiteboardElement {
  const next: WhiteboardElement = { ...element };
  for (const key of POSITION_KEYS) if (key in next) next[key] = round(next[key]);
  if (typeof next.angle === "number") next.angle = round(next.angle, 5);
  if (Array.isArray(next.points)) next.points = roundPoints(next.points);
  if (Array.isArray(next.pressures)) next.pressures = (next.pressures as unknown[]).map((value) => round(value, 3));
  if ("customData" in next && object(next.customData)) {
    const sanitized = sanitizeCustomData(next);
    if (sanitized) next.customData = sanitized;
    else delete next.customData;
  }
  return next;
}

// まだアップロードしていない（data: の）ファイルか。
export const isEmbeddedDataUrl = (value: unknown) => typeof value === "string" && /^\s*data:/i.test(value);

// 保存してよいファイルの URL（自分のサービスの note-files）。持ち主はサーバーが確かめる。
export function isStoredFileUrl(value: unknown): value is string {
  const parsed = parseNoteFileUrl(value);
  return parsed !== null && parsed !== "empty";
}

export type SceneSnapshot = {
  elements: readonly WhiteboardElement[];
  files: Readonly<Record<string, { id: string; mimeType: string; dataURL: string; created?: number }>>;
  appState: unknown;
  // アップロードが終わったファイルの URL（Excalidraw の中の dataURL は data: のまま。開き直すとこの URL で読む）。
  uploaded?: ReadonlyMap<string, { url: string; mimeType: string }>;
  // まだ入れてはいけないファイル（貼り付けた note-files の URL で、自分のファイルか確かめている途中）。その画像要素は保存に入れない。
  blocked?: ReadonlySet<string>;
};

// 開いている scene から、保存する本体を作る。pending は、ファイルのアップロードが終わっていないため保存に入れなかった画像要素の数。
export function sceneToStored({ elements, files, appState, uploaded, blocked }: SceneSnapshot): { data: StoredWhiteboard; pending: number } {
  const storedFiles: WhiteboardFiles = {};
  const kept: WhiteboardElement[] = [];
  const live = elements.filter((element) => element.isDeleted !== true && WHITEBOARD_ELEMENT_TYPES.has(element.type));
  const liveIds = new Set(live.map((element) => element.id));
  // 画像要素が保存に入らないとき、その画像に付いた文字（containerId）も入れない（付け先のない文字にしない）。
  const skipped = new Set<string>();
  for (const element of live) {
    if (element.type !== "image") continue;
    const fileId = typeof element.fileId === "string" ? element.fileId : null;
    if (!fileId) continue;
    const file = files[fileId];
    const upload = uploaded?.get(fileId);
    if (!upload && blocked?.has(fileId)) { skipped.add(element.id); continue; }
    const url = upload?.url ?? (file && isStoredFileUrl(file.dataURL) ? file.dataURL : null);
    if (!url) { skipped.add(element.id); continue; }
    if (!storedFiles[fileId]) {
      storedFiles[fileId] = {
        id: fileId,
        mimeType: upload?.mimeType ?? file?.mimeType ?? "image/png",
        dataURL: url,
        ...(typeof file?.created === "number" ? { created: file.created } : {}),
      };
    }
  }
  for (const element of live) {
    if (skipped.has(element.id)) continue;
    if (typeof element.containerId === "string" && skipped.has(element.containerId)) continue;
    kept.push(compactElement(element));
  }
  // 消した要素への参照（boundElements・containerId・frameId）は残っていても Excalidraw が読み込み時に直すので、ここでは触らない。
  void liveIds;
  const pickedAppState = pickWhiteboardAppState(appState);
  const data: StoredWhiteboard = { elements: kept };
  if (Object.keys(storedFiles).length) data.files = storedFiles;
  if (Object.keys(pickedAppState).length) data.appState = pickedAppState;
  return { data, pending: skipped.size };
}

// 保存された本体を、Excalidraw に渡せる形にする（要素の修復は Excalidraw の restore が読み込み時に行う）。
// 壊れた要素・置けない種類の要素・ファイルは捨てる。ファイルは生きている画像要素が使うものだけ（公開リンクで読めるのもこれだけ）。
// ファイルの dataURL は note-files の URL のまま（<img> で読める）。
export function storedToScene(data: unknown): { elements: WhiteboardElement[]; files: WhiteboardFiles; appState: WhiteboardAppState } {
  if (!object(data)) return { elements: [], files: {}, appState: {} };
  const elements = Array.isArray(data.elements)
    ? data.elements.filter((element): element is WhiteboardElement => object(element) && typeof element.id === "string" && typeof element.type === "string"
      && WHITEBOARD_ELEMENT_TYPES.has(element.type) && element.isDeleted !== true)
    : [];
  const used = new Set(elements.filter((element) => element.type === "image" && typeof element.fileId === "string").map((element) => element.fileId as string));
  const files: WhiteboardFiles = {};
  if (object(data.files)) {
    for (const [id, file] of Object.entries(data.files)) {
      if (!object(file) || !used.has(id)) continue;
      const url = isStoredFileUrl(file.dataURL) ? file.dataURL : isStoredFileUrl(file.url) ? file.url : null;
      if (!url) continue;
      files[id] = { ...file, id, mimeType: typeof file.mimeType === "string" ? file.mimeType : "image/png", dataURL: url };
    }
  }
  return { elements, files, appState: pickWhiteboardAppState(data.appState) };
}

// 本体の大きさ（UTF-8 の JSON のバイト数）。
export function storedSize(data: StoredWhiteboard) {
  return new TextEncoder().encode(JSON.stringify(data)).byteLength;
}

// ---- 手書きの線の間引き ----
// 本体が上限（2 MB）に近づいたときだけ使う。ふだんは点をそのまま残す（速さから太さを決める線の見た目を変えないため）。

type Point = readonly [number, number];

function perpendicularDistance(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  return Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / length;
}

// Ramer–Douglas–Peucker。残す点の位置（添字）を返す。再帰を使わない。
export function simplifyIndexes(points: readonly Point[], tolerance: number): number[] {
  if (points.length <= 2) return points.map((_, index) => index);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let distance = tolerance;
    for (let index = first + 1; index < last; index++) {
      const current = perpendicularDistance(points[index], points[first], points[last]);
      if (current > distance) { distance = current; farthest = index; }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  const indexes: number[] = [];
  keep.forEach((value, index) => { if (value) indexes.push(index); });
  return indexes;
}

const isPoint = (value: unknown): value is Point => Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";

// 手書きの線（freedraw）の点を間引く。筆圧の配列も同じ位置を残す。
export function simplifyFreedraw(element: WhiteboardElement, tolerance: number): WhiteboardElement {
  if (element.type !== "freedraw" || !Array.isArray(element.points) || !element.points.every(isPoint)) return element;
  const points = element.points as Point[];
  const indexes = simplifyIndexes(points, tolerance);
  if (indexes.length === points.length) return element;
  const pressures = Array.isArray(element.pressures) && element.pressures.length === points.length ? element.pressures as number[] : null;
  return {
    ...element,
    points: indexes.map((index) => points[index]),
    ...(pressures ? { pressures: indexes.map((index) => pressures[index]) } : {}),
  };
}

// 本体が budget（バイト）を超えるときだけ、線の点を段階的に間引く。間引いても超えるなら、いちばん小さくできたものを返す。
export function fitStoredWhiteboard(data: StoredWhiteboard, budget: number): { data: StoredWhiteboard; size: number; simplified: boolean } {
  let size = storedSize(data);
  if (size <= budget || !data.elements.some((element) => element.type === "freedraw")) return { data, size, simplified: false };
  let current = data;
  for (const tolerance of [0.35, 0.75, 1.5]) {
    current = { ...current, elements: current.elements.map((element) => simplifyFreedraw(element, tolerance)) };
    size = storedSize(current);
    if (size <= budget) break;
  }
  return { data: current, size, simplified: true };
}
