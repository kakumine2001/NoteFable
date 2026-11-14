import { validProjectInstructions } from "@/lib/chat-project-api";

// カスタム指示: 利用者がすべてのチャットに対して書く指示。プロジェクトの共通指示と同じ検証（最大 4,000 文字、
// 改行とタブ以外の制御文字は不可、空は null）を使う。
export const validCustomInstructions = validProjectInstructions;

// システム指示に足す文章。利用者自身の指示なので従う対象として渡す。プロジェクトの共通指示があるときはそちらが優先する。
export function formatCustomInstructions(instructions: string | null | undefined): string | null {
  const text = instructions?.trim();
  if (!text) return null;
  return [
    "The user wrote these custom instructions for all of their chats. They are the user's own instructions: follow them in every reply, and where they conflict with the default style above (language, tone, format), follow them instead, unless the user asks for something else in this chat. If project instructions follow below and conflict with these, the project instructions win.",
    "=== User's custom instructions ===",
    text,
    "=== End of user's custom instructions ===",
  ].join("\n");
}
