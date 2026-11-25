import { LEGAL_CONTACT_EMAIL } from "@/components/legal-page";
import { canvasReadableText, parseCanvasSegments } from "@/lib/canvas-document";
import { sendEmail } from "@/lib/email-login";
import { blocksToMarkdown } from "@/lib/note-markdown";
import { isCanvasKind, pageKindOf } from "@/lib/page-kinds";
import { prisma } from "@/lib/prisma";

// AI が作った内容の通報（Google Play の AI 生成コンテンツのポリシー：アプリ内で不快な AI 出力を開発者に知らせられること）。
// 対象は 4 つ：チャットの回答（messageId）、AI の提案カード（proposalId：ページの編集・新規の案）、AI が書いたページ（pageId）、
// スライドの AI で作った画像（pageId + elementId）。
// 通報は開発者のメールに送るだけで、データベースには残さない。
export const MAX_REPORT_REASON = 1000;
const MAX_ANSWER_CHARS = 20_000;
const MAX_PROMPT_CHARS = 4_000;
const MAX_PAGE_PROPOSALS = 20;

export type ReportTarget =
  | { kind: "answer"; id: string }
  | { kind: "proposal"; id: string }
  | { kind: "page"; id: string }
  | { kind: "slideImage"; pageId: string; elementId: string };
export type ReportInput = { target: ReportTarget; reason: string };

const validId = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

// 本文の形。通報する対象（messageId・proposalId・pageId のどれか 1 つ。pageId に elementId を添えるとスライドの画像）と、任意の理由。
export function parseReport(body: unknown): { ok: true; data: ReportInput } | { ok: false } {
  if (!body || typeof body !== "object") return { ok: false };
  const { messageId, proposalId, pageId, elementId, reason } = body as Record<string, unknown>;
  const targets = ([["answer", messageId], ["proposal", proposalId], ["page", pageId]] as const).filter(([, id]) => id !== undefined);
  if (targets.length !== 1) return { ok: false };
  const [kind, id] = targets[0];
  if (reason !== undefined && typeof reason !== "string") return { ok: false };
  const text = (reason ?? "").trim();
  if (text.length > MAX_REPORT_REASON) return { ok: false };
  if (elementId !== undefined) {
    // 画像の要素はスライドのページと一緒にだけ。
    if (kind !== "page" || !validId(id, 64) || !validId(elementId, 120)) return { ok: false };
    return { ok: true, data: { target: { kind: "slideImage", pageId: id, elementId }, reason: text } };
  }
  if (!validId(id, 100)) return { ok: false };
  return { ok: true, data: { target: { kind, id }, reason: text } };
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

type ReportedChange = { op?: unknown; block?: unknown; before?: unknown; after?: unknown };

// AI の提案（ページの編集・新規の案）の通報メール。カードに出ていた改前・改後の文字を付ける（縮小画像は提案の中にあり、ID で引ける）。
export function proposalReportEmail(report: {
  userId: string; signedIn: boolean; proposal: NonNullable<Awaited<ReturnType<typeof findReportedProposal>>>; reason: string;
}) {
  const { proposal } = report;
  const payload = (proposal.payload ?? {}) as { pageId?: unknown; pageTitle?: unknown; title?: unknown; content?: unknown; changes?: unknown; parentId?: unknown };
  const changes = Array.isArray(payload.changes) ? payload.changes as ReportedChange[] : [];
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const body = proposal.kind === "CREATE"
    ? [`New page: ${text(payload.title) || "(untitled)"}`, "", text(payload.content).trim() ? clip(text(payload.content), MAX_ANSWER_CHARS) : "(no text)"]
    : [
        `Page: ${text(payload.pageTitle)} (${text(payload.pageId)})`,
        ...(payload.title && typeof payload.title === "object" ? [`Rename: ${text((payload.title as { before?: unknown }).before)} -> ${text((payload.title as { after?: unknown }).after)}`] : []),
        ...changes.flatMap((change, index) => [
          "", `[${index + 1}] ${text(change.op)}${typeof change.block === "number" && change.block ? ` block ${change.block}` : ""}`,
          ...(text(change.before) ? ["--- before ---", clip(text(change.before), MAX_PROMPT_CHARS)] : []),
          ...(text(change.after) ? ["--- after ---", clip(text(change.after), MAX_PROMPT_CHARS)] : []),
        ]),
      ];
  const lines = [
    `Reason: ${report.reason || "(none given)"}`,
    "",
    `User: ${report.userId} (${report.signedIn ? "signed in" : "anonymous"})`,
    `Chat: ${proposal.sessionId}`,
    `Message: ${proposal.messageId ?? "(not saved)"}`,
    `Proposal: ${proposal.id} (${proposal.kind === "CREATE" ? "new page" : "edit"}, ${proposal.pageKind}, ${proposal.status.toLowerCase()}${proposal.autoApplied ? ", applied automatically" : ""})`,
    `Model: ${proposal.model ?? "unknown"}`,
    `Proposed at: ${proposal.createdAt.toISOString()}`,
    "",
    "--- Reported AI content ---",
    ...body,
  ];
  return { subject: `[NoteFable] Reported AI page change ${proposal.id}`, text: lines.join("\n") };
}

// AI が書いたページの通報メール。いまの内容（ノートは Markdown、ほかは読める文字）と、そのページに当てた AI の提案の一覧を付ける。
export function pageReportEmail(report: {
  userId: string; signedIn: boolean; page: NonNullable<Awaited<ReturnType<typeof findReportedPage>>>; reason: string;
}) {
  const { page } = report;
  const lines = [
    `Reason: ${report.reason || "(none given)"}`,
    "",
    `User: ${report.userId} (${report.signedIn ? "signed in" : "anonymous"})`,
    `Page: ${page.id} (${page.kind})`,
    `Title: ${page.title}`,
    `AI last wrote it at: ${page.aiUpdatedAt?.toISOString() ?? "unknown"}`,
    "",
    "--- AI changes applied to this page (newest first) ---",
    ...(page.proposals.length
      ? page.proposals.map((proposal) => `${proposal.id}: ${proposal.kind === "CREATE" ? "created" : "edited"}, chat ${proposal.sessionId}, message ${proposal.messageId ?? "(not saved)"}, ${proposal.status.toLowerCase()}${proposal.autoApplied ? " (automatically)" : ""}, ${proposal.createdAt.toISOString()}`)
      : ["(none recorded: the page may come from Create page or Draw as diagram)"]),
    "",
    "--- Current page content ---",
    page.text.trim() ? clip(page.text, MAX_ANSWER_CHARS) : "(no text)",
  ];
  return { subject: `[NoteFable] Reported AI page ${page.id}`, text: lines.join("\n") };
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

// 自分の AI の提案だけを通報できる。提案を出した回答のモデルも付ける。見つからなければ null。
export async function findReportedProposal(userId: string, proposalId: string) {
  const proposal = await prisma.noteProposal.findFirst({
    where: { id: proposalId, userId },
    select: { id: true, sessionId: true, messageId: true, kind: true, status: true, pageKind: true, autoApplied: true, payload: true, createdAt: true },
  });
  if (!proposal) return null;
  const message = proposal.messageId
    ? await prisma.message.findFirst({ where: { id: proposal.messageId, sessionId: proposal.sessionId }, select: { model: true } })
    : null;
  return { ...proposal, model: message?.model ?? null };
}

// AI が書いた自分のページ（ゴミ箱のものを除く）だけを通報できる。いまの内容と、そのページに当てた AI の提案を付ける。
export async function findReportedPage(userId: string, pageId: string) {
  const page = await prisma.notePage.findFirst({
    where: { id: pageId, userId, deletedAt: null, aiUpdatedAt: { not: null } },
    select: { id: true, kind: true, title: true, blocks: true, aiUpdatedAt: true, canvas: { select: { segments: true } } },
  });
  if (!page) return null;
  const proposals = await prisma.noteProposal.findMany({
    where: { userId, appliedPageId: pageId, status: { in: ["APPLIED", "UNDONE"] } },
    orderBy: { createdAt: "desc" },
    take: MAX_PAGE_PROPOSALS,
    select: { id: true, sessionId: true, messageId: true, kind: true, status: true, autoApplied: true, createdAt: true },
  });
  const kind = pageKindOf(page);
  const text = isCanvasKind(kind) ? canvasReadableText(kind, parseCanvasSegments(page.canvas?.segments)) : blocksToMarkdown(page.blocks);
  return { id: page.id, kind, title: page.title, aiUpdatedAt: page.aiUpdatedAt, text, proposals };
}

export async function sendReport(email: { subject: string; text: string }) {
  const sent = await sendEmail({ to: LEGAL_CONTACT_EMAIL, subject: email.subject, text: email.text });
  if (!sent) console.info(`[answer-report] ${email.subject}\n${email.text}`);
}
