import { isLocale, type Locale } from "@/lib/i18n/locale";
import { isClientRequestId, isRecordId } from "@/lib/page-ai/ids";
import { cleanText, MAX_TOPIC_CHARS } from "@/lib/slides/ai-wizard";
import { MAX_MESSAGE_NOTES } from "@/types/chat";

// ワークスペースの統合「AI で生成」（ノート / ホワイトボード / スライド）の共有型・上限・検証。
// prisma と DOM を使わない純粋なモジュール。画面の順序は新順序（ノート → ホワイトボード → スライド）。

export const AI_GENERATE_KINDS = ["note", "whiteboard", "slides"] as const;
export type AiGenerateKind = (typeof AI_GENERATE_KINDS)[number];

export const AI_DIRECT_GENERATE_KINDS = ["note", "whiteboard"] as const;
export type AiDirectGenerateKind = (typeof AI_DIRECT_GENERATE_KINDS)[number];

export const NOTE_GENERATE_STYLES = ["auto", "study-guide", "outline", "summary", "checklist"] as const;
export type NoteGenerateStyle = (typeof NOTE_GENERATE_STYLES)[number];

export const WHITEBOARD_GENERATE_STRUCTURES = ["auto", "mindmap", "flowchart", "sequence", "timeline", "board"] as const;
export type WhiteboardGenerateStructure = (typeof WHITEBOARD_GENERATE_STRUCTURES)[number];

export const MAX_AI_PROMPT_CHARS = MAX_TOPIC_CHARS;
export const MAX_AI_SOURCE_NOTES = MAX_MESSAGE_NOTES;

export type NoteGenerateOptions = {
  style: NoteGenerateStyle;
  language: "auto" | Locale;
};

export type WhiteboardGenerateOptions = {
  structure: WhiteboardGenerateStructure;
  language: "auto" | Locale;
};

export const DEFAULT_NOTE_GENERATE_OPTIONS: NoteGenerateOptions = {
  style: "auto",
  language: "auto",
};

export const DEFAULT_WHITEBOARD_GENERATE_OPTIONS: WhiteboardGenerateOptions = {
  structure: "auto",
  language: "auto",
};

export type AiGenerateRequest = {
  kind: AiDirectGenerateKind;
  prompt: string;
  noteIds: string[];
  language: "auto" | Locale;
  noteStyle: NoteGenerateStyle;
  whiteboardStructure: WhiteboardGenerateStructure;
  groupId: string | null;
  parentId: string | null;
  model: string | null;
  clientRequestId: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function cleanPromptText(value: string): string {
  return cleanText(value).replace(/\r\n?/g, "\n").trim();
}

export function isAiGenerateKind(value: unknown): value is AiGenerateKind {
  return typeof value === "string" && (AI_GENERATE_KINDS as readonly string[]).includes(value);
}

export function parseNoteGenerateOptions(value: unknown): NoteGenerateOptions | null {
  if (value === undefined) return { ...DEFAULT_NOTE_GENERATE_OPTIONS };
  if (!isObject(value)) return null;
  const style = value.style ?? DEFAULT_NOTE_GENERATE_OPTIONS.style;
  const language = value.language ?? DEFAULT_NOTE_GENERATE_OPTIONS.language;
  if (!(NOTE_GENERATE_STYLES as readonly string[]).includes(style as string)) return null;
  if (language !== "auto" && !isLocale(language)) return null;
  return { style: style as NoteGenerateStyle, language };
}

export function parseWhiteboardGenerateOptions(value: unknown): WhiteboardGenerateOptions | null {
  if (value === undefined) return { ...DEFAULT_WHITEBOARD_GENERATE_OPTIONS };
  if (!isObject(value)) return null;
  const structure = value.structure ?? DEFAULT_WHITEBOARD_GENERATE_OPTIONS.structure;
  const language = value.language ?? DEFAULT_WHITEBOARD_GENERATE_OPTIONS.language;
  if (!(WHITEBOARD_GENERATE_STRUCTURES as readonly string[]).includes(structure as string)) return null;
  if (language !== "auto" && !isLocale(language)) return null;
  return { structure: structure as WhiteboardGenerateStructure, language };
}

function parsePlacement(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return isRecordId(value) ? value : undefined;
}

export function parseAiGenerateRequest(value: unknown): AiGenerateRequest | null {
  if (!isObject(value)) return null;
  if (value.kind !== "note" && value.kind !== "whiteboard") return null;
  if (!isClientRequestId(value.clientRequestId)) return null;

  let prompt = "";
  if (value.prompt !== undefined) {
    if (typeof value.prompt !== "string") return null;
    prompt = cleanPromptText(value.prompt);
    if (prompt.length > MAX_AI_PROMPT_CHARS) return null;
  }

  let noteIds: string[] = [];
  if (value.noteIds !== undefined) {
    if (!Array.isArray(value.noteIds) || value.noteIds.length > MAX_AI_SOURCE_NOTES) return null;
    if (!value.noteIds.every(isRecordId) || new Set(value.noteIds).size !== value.noteIds.length) return null;
    noteIds = [...value.noteIds];
  }

  // 指示か参考ノートのどちらか一方は必須。
  if (!prompt && !noteIds.length) return null;

  const language = value.language ?? "auto";
  if (language !== "auto" && !isLocale(language)) return null;

  const noteStyle = value.noteStyle ?? DEFAULT_NOTE_GENERATE_OPTIONS.style;
  if (!(NOTE_GENERATE_STYLES as readonly string[]).includes(noteStyle as string)) return null;

  const whiteboardStructure = value.whiteboardStructure ?? DEFAULT_WHITEBOARD_GENERATE_OPTIONS.structure;
  if (!(WHITEBOARD_GENERATE_STRUCTURES as readonly string[]).includes(whiteboardStructure as string)) return null;

  const groupId = parsePlacement(value.groupId);
  const parentId = parsePlacement(value.parentId);
  if (groupId === undefined || parentId === undefined) return null;

  const model = typeof value.model === "string" ? value.model : null;

  return {
    kind: value.kind,
    prompt,
    noteIds,
    language,
    noteStyle: noteStyle as NoteGenerateStyle,
    whiteboardStructure: whiteboardStructure as WhiteboardGenerateStructure,
    groupId,
    parentId,
    model,
    clientRequestId: value.clientRequestId,
  };
}
