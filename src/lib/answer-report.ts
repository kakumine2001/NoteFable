import { Prisma } from "@/generated/prisma/client";
import { LEGAL_CONTACT_EMAIL } from "@/components/legal-page";
import { sendEmail } from "@/lib/email-login";
import { databaseSchema, prisma } from "@/lib/prisma";
import { usageDay } from "@/lib/usage-limits";

// AI の回答の通報（Google Play の AI 生成コンテンツのポリシー：アプリ内で不快な AI 出力を開発者に知らせられること）。
// 通報は開発者のメールに送るだけで、データベースには残さない。
export const MAX_REPORT_REASON = 1000;
// 1 人の利用者が 1 日に送れる通報の数（日付は使用量と同じ日本時間）。メールを大量に送らせないため。
export const DAILY_REPORT_LIMIT = 10;
const MAX_ANSWER_CHARS = 20_000;
const MAX_PROMPT_CHARS = 4_000;

export type ReportInput = { messageId: string; reason: string };

export function parseReport(body: unknown): { ok: true; data: ReportInput } | { ok: false } {
  if (!body || typeof body !== "object") return { ok: false };
  const { messageId, reason } = body as Record<string, unknown>;
  if (typeof messageId !== "string" || !messageId || messageId.length > 100) return { ok: false };
  if (reason !== undefined && typeof reason !== "string") return { ok: false };
  const text = (reason ?? "").trim();
  if (text.length > MAX_REPORT_REASON) return { ok: false };
  return { ok: true, data: { messageId, reason: text } };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n…(${text.length - max} more characters)` : text);

// 通報メールの本文。回答の全文（長すぎれば切る）と、その直前の利用者の発言を付ける。
export function reportEmail(report: {
  userId: string; signedIn: boolean; sessionId: string; messageId: string; model: string | null; createdAt: Date;
  answer: string; prompt: string | null; reason: string;
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
    clip(report.answer, MAX_ANSWER_CHARS),
  ];
  return { subject: `[NoteFable] Reported answer ${report.messageId}`, text: lines.join("\n") };
}

// その日の通報を 1 つ数える。上限に達していたら false（数えない）。
export async function consumeReport(userId: string) {
  const table = Prisma.raw(`"${databaseSchema}"."UsageCounter"`);
  const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
    INSERT INTO ${table} AS c ("key", "kind", "day", "count", "updatedAt")
    VALUES (${`user:${userId}`}, 'report', ${usageDay()}::date, 1, now())
    ON CONFLICT ("key", "kind", "day") DO UPDATE SET "count" = c."count" + 1, "updatedAt" = now()
    WHERE c."count" < ${DAILY_REPORT_LIMIT}
    RETURNING c."count"
  `);
  return rows.length > 0;
}

// 自分のチャットの AI の回答だけを通報できる。見つからなければ null。
export async function findReportedAnswer(userId: string, messageId: string) {
  const answer = await prisma.message.findFirst({
    where: { id: messageId, role: "ASSISTANT", session: { userId } },
    select: { id: true, sessionId: true, content: true, model: true, createdAt: true },
  });
  if (!answer) return null;
  const prompt = await prisma.message.findFirst({
    where: { sessionId: answer.sessionId, role: "USER", createdAt: { lte: answer.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });
  return { ...answer, prompt: prompt?.content ?? null };
}

export async function sendReport(email: { subject: string; text: string }) {
  const sent = await sendEmail({ to: LEGAL_CONTACT_EMAIL, subject: email.subject, text: email.text });
  if (!sent) console.info(`[answer-report] ${email.subject}\n${email.text}`);
}
