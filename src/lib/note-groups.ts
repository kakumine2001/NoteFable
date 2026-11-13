import { NoteValidationError } from "@/lib/note-document";
import { msg } from "@/lib/i18n/translate";

export const MAX_NOTE_GROUPS = 50;
export const MAX_GROUP_NAME = 60;

// グループ名を整える。前後の空白を落とし、連続する空白は 1 つにし、空・制御文字・長すぎる名前は受け付けない。
export function validGroupName(value: unknown) {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!name) throw new NoteValidationError(msg("Enter a group name."));
  if (name.length > MAX_GROUP_NAME) throw new NoteValidationError(`Group names can have at most ${MAX_GROUP_NAME} characters.`);
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new NoteValidationError(msg("Group names cannot contain control characters."));
  return name;
}

// 小さな JSON 本文を読む。大きすぎる・壊れている場合は 400 / 413 の検証エラーにする。
export async function readSmallJson(request: Request, limit = 4096): Promise<Record<string, unknown>> {
  const text = await request.text().catch(() => "");
  if (text.length > limit) throw new NoteValidationError(msg("Request is too large."), 413);
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* 下の検証エラーにまとめる。 */ }
  throw new NoteValidationError(msg("Invalid JSON request."));
}
