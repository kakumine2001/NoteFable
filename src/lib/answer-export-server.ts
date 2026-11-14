import { NoteValidationError } from "@/lib/note-document";
import { msg } from "@/lib/i18n/translate";

// Android App の「回答をノートに保存」「会話をダウンロード」をサーバー側で組み立てるための補助。
// 変換そのものはブラウザと同じ answer-export.ts を使う。

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// 端末の日付（YYYY-MM-DD）。出典の「… on YYYY-MM-DD」を、サーバーのタイムゾーンではなく使った人の日付にするため。
// 形式が違う・実在しない日付なら、いまの日時を使う。formatDate はローカルの年月日を読むので、正午で作れば同じ日付になる。
export function savedAtFrom(value: unknown, now = new Date()) {
  if (typeof value !== "string") return now;
  const match = DATE_ONLY.exec(value);
  if (!match) return now;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : now;
}

// /api/sessions/... の ID と同じ形。
export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{1,64}$/.test(value);
}

export type FromAnswerRequest = { markdown: string; sessionId: string; messageId: string | null; savedOn: unknown };

// POST /api/pages/from-answer の本文を検証する。
export function readFromAnswer(body: unknown): FromAnswerRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new NoteValidationError(msg("Invalid JSON request."));
  const value = body as Record<string, unknown>;
  if (typeof value.markdown !== "string" || !value.markdown.trim()) throw new NoteValidationError(msg("Invalid JSON request."));
  if (!isSessionId(value.sessionId)) throw new NoteValidationError(msg("Invalid JSON request."));
  if (value.messageId != null && typeof value.messageId !== "string") throw new NoteValidationError(msg("Invalid JSON request."));
  return { markdown: value.markdown, sessionId: value.sessionId, messageId: (value.messageId as string | null | undefined) ?? null, savedOn: value.savedOn };
}

type StoredAttachment = { id: string; filename: string; imageStoragePath: string | null };
type StoredMessage = { role: string; content: string; attachments: StoredAttachment[] };

// GET /api/sessions/:id/messages と同じ見せ方にする（アシスタントの保存画像は生成画像、それ以外は添付）。
// 画像の URL は所有者確認を経由する添付画像 API。保存位置そのものは出さない。
export function toConversationMessages(messages: readonly StoredMessage[]) {
  return messages.map((message) => {
    const image = (attachment: StoredAttachment) => `/api/attachments/${attachment.id}/image`;
    const assistant = message.role === "ASSISTANT";
    return {
      role: message.role,
      content: message.content,
      attachments: message.attachments
        .filter((attachment) => !assistant || !attachment.imageStoragePath)
        .map((attachment) => ({ filename: attachment.filename, dataUrl: attachment.imageStoragePath ? image(attachment) : undefined })),
      generatedImages: assistant
        ? message.attachments.filter((attachment) => attachment.imageStoragePath).map((attachment) => ({ id: attachment.id, dataUrl: image(attachment) }))
        : [],
    };
  });
}
