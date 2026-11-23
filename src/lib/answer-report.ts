import { LEGAL_CONTACT_EMAIL } from "@/components/legal-page";
import { sendEmail } from "@/lib/email-login";
import { prisma } from "@/lib/prisma";

// AI の回答の通報（Google Play の AI 生成コンテンツのポリシー：アプリ内で不快な AI 出力を開発者に知らせられること）。
// 通報は開発者のメールに送るだけで、データベースには残さない。
export const MAX_REPORT_REASON = 1000;
const MAX_ANSWER_CHARS = 20_000;
const MAX_PROMPT_CHARS = 4_000;

// 回答（messageId）か、スライドの AI で作った画像（pageId + elementId）のどちらか。
export type ReportInput = { messageId: string; reason: string } | { pageId: string; elementId: string; reason: string };

const validId = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

export function parseReport(body: unknown): { ok: true; data: ReportInput } | { ok: false } {
  if (!body || typeof body !== "object") return { ok: false };
  const { messageId, pageId, elementId, reason } = body as Record<string, unknown>;
  if (reason !== undefined && typeof reason !== "string") return { ok: false };
  const text = (reason ?? "").trim();
  if (text.length > MAX_REPORT_REASON) return { ok: false };
  if (messageId !== undefined) return validId(messageId, 100) ? { ok: true, data: { messageId, reason: text } } : { ok: false };
  if (validId(pageId, 64) && validId(elementId, 120)) return { ok: true, data: { pageId, elementId, reason: text } };
  return { ok: false };
}


const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n…(${text.length - max} more characters)` : text);

// 通報メールの本文。回答の全文（長すぎれば切る）と、その直前の利用者の発言を付ける。
export function reportEmail(report: {
  userId: string; signedIn: boolean; sessionId: string; messageId: string; model: string | null; createdAt: Date;
  answer: string; prompt: string | null; reason: string; images?: { id: string; filename: string; path: string }[];
}) {
  const lines = [
    `Reason: ${report.reason || "(none given)"}`,
    "",
    `User: ${report.userId} (${report.signedIn ? "signed in" : "anonymous"})`,
    `Chat: ${report.sessionId}`,
    `Message: ${report.messageId}`,
    `Model: ${report.model ?? "unknown"}`,
    `Answered at: ${report.createdAt.toISOString()}`,
    "",
    "--- User message ---",
    report.prompt === null ? "(none)" : clip(report.prompt, MAX_PROMPT_CHARS),
    "",
    "--- Reported answer ---",
    report.answer.trim() ? clip(report.answer, MAX_ANSWER_CHARS) : "(no text)",
    // 生成した画像は保存先のパス（Vercel Blob）で示す。運営者はストレージから直接見られる。
    ...(report.images?.length ? ["", "--- Images in the answer (storage paths) ---", ...report.images.map((image) => `${image.filename}: ${image.path} (attachment ${image.id})`)] : []),
  ];
  return { subject: `[NoteFable] Reported answer ${report.messageId}`, text: lines.join("\n") };
}

// スライドの AI で作った画像の報告メール。作るときの説明（プロンプト）と保存先のパスを付ける。
export function slideImageReportEmail(report: { userId: string; signedIn: boolean; pageId: string; elementId: string; prompt: string; path: string; reason: string }) {
  const lines = [
    `Reason: ${report.reason || "(none given)"}`,
    "",
    `User: ${report.userId} (${report.signedIn ? "signed in" : "anonymous"})`,
    `Slide deck: ${report.pageId}`,
    `Image element: ${report.elementId}`,
    "",
    "--- Image prompt ---",
    clip(report.prompt, MAX_PROMPT_CHARS),
    "",
    "--- Image (storage path) ---",
    report.path,
  ];
  const plain = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, " ");
  return { subject: `[NoteFable] Reported slide image ${plain(report.pageId)}/${plain(report.elementId)}`, text: lines.join("\n") };
}

// 自分のチャットの AI の回答だけを通報できる。見つからなければ null。
export async function findReportedAnswer(userId: string, messageId: string) {
  const answer = await prisma.message.findFirst({
    where: { id: messageId, role: "ASSISTANT", session: { userId } },
    select: {
      id: true, sessionId: true, content: true, model: true, createdAt: true, parentId: true,
      attachments: { where: { imageStoragePath: { not: null } }, select: { id: true, filename: true, imageStoragePath: true } },
    },
  });
  if (!answer) return null;
  // 回答が答えた発言。親の記録があればそれ、無い行（古い行）は作成順で直前の自分の発言。
  const prompt = await prisma.message.findFirst({
    where: answer.parentId
      ? { id: answer.parentId, sessionId: answer.sessionId, role: "USER" }
      : { sessionId: answer.sessionId, role: "USER", active: true, createdAt: { lte: answer.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });
  const { attachments, ...rest } = answer;
  return { ...rest, prompt: prompt?.content ?? null, images: attachments.map((image) => ({ id: image.id, filename: image.filename, path: image.imageStoragePath! })) };
}

export async function sendReport(email: { subject: string; text: string }) {
  const sent = await sendEmail({ to: LEGAL_CONTACT_EMAIL, subject: email.subject, text: email.text });
  if (!sent) console.info(`[answer-report] ${email.subject}\n${email.text}`);
}
