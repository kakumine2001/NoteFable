import { createHash } from "node:crypto";
import { buildTranscript, MAX_TRANSCRIPT_MESSAGES } from "@/lib/chat-page";
import { clip, pageContextText } from "@/lib/chat-project-context";
import { delimitPageContent } from "@/lib/page-ai/delimit";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";

// AI の 1 回きりの生成（画成図、スライド生成。今後の出題も同じ）の共通部分（docs/architecture/chat-flow.md の「画成図」）：
// - 材料の読み方：回答は表示中の枝（active: true）の USER / ASSISTANT の本文だけ（SYSTEM や providerContext は読まない）。
//   ノートは本人の、ゴミ箱にないノートを毎回読み直し、上限で切り、推測できない区切り（delimitPageContent）で囲む（私的なデータで、指示ではない）。
// - 二重の作成の防ぎ方：クライアントは操作ごとに clientRequestId を作り、送り直しでも同じものを使う。作るページの ID を
//   （利用者・用途・clientRequestId）から決めるので、同じ要求の再送は既にあるページを返し、数え直さず、2 つ目のページも作らない
//   （表を増やさない。同時に届いた 2 つ目は ID の重複で作成に失敗し、使った回数を戻して先のページを返す）。

export const MAX_MATERIAL_CHARS = 20_000;
export const MAX_QUESTION_CHARS = 4_000;

export { isClientRequestId, isRecordId } from "@/lib/page-ai/ids";

// 要求から決まるページの ID。cuid と同じ形（c + 英小文字・数字 24 文字）で、他人の ID や手で作ったページの ID とは重ならない。
export function aiRequestPageId(userId: string, purpose: string, clientRequestId: string) {
  const digest = createHash("sha256").update(`notefable:ai-request-page:v1\n${purpose}\n${userId}\n${clientRequestId}`).digest("hex");
  let value = BigInt(`0x${digest}`);
  let id = "";
  for (let index = 0; index < 24; index++) {
    id += (value % BigInt(36)).toString(36);
    value /= BigInt(36);
  }
  return `c${id}`;
}

// 同じ要求で作ったページ（本人のもの）。ゴミ箱に入れたものも返す（deletedAt で見分ける）。
export async function findRequestedPage(userId: string, pageId: string) {
  return prisma.notePage.findFirst({ where: { id: pageId, userId }, select: { ...PAGE_SUMMARY_SELECT, deletedAt: true } });
}

// 作成の主キーの重複（同じ要求が同時に 2 回届いた）。
export function isDuplicateCreate(error: unknown) {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

// 材料の区切りタグを本文が閉じたり開いたりできないよう、そのような並びだけ無害な文字に替える。
function neutralizeTags(text: string) {
  return text.replace(/<(\/?)(material|question|answer)\b/gi, "‹$1$2");
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export type Material = {
  // 題名の候補（モデルが題名を書かなかったとき）。
  title: string;
  // モデルに渡す材料（<material> で囲んだもの）。
  text: string;
  // 上限で切った。
  truncated: boolean;
};

// チャットの回答（とその直前の質問）。本人の会話の、表示中の枝にある回答だけ。無ければ null、本文が空なら text が空。
export async function readAnswerMaterial(userId: string, messageId: string): Promise<Material | null> {
  const answer = await prisma.message.findFirst({
    where: { id: messageId, role: "ASSISTANT", active: true, session: { userId } },
    select: { id: true, sessionId: true, content: true, parentId: true, createdAt: true, session: { select: { title: true } } },
  });
  if (!answer) return null;
  // 直前の質問。parentId の無い古い行は、作った順で直前の発言。
  const question = answer.parentId && answer.parentId !== "root"
    ? await prisma.message.findFirst({ where: { id: answer.parentId, sessionId: answer.sessionId, role: "USER", active: true }, select: { content: true } })
    : answer.parentId === null
      ? await prisma.message.findFirst({
        where: { sessionId: answer.sessionId, role: "USER", active: true, createdAt: { lt: answer.createdAt } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { content: true },
      })
      : null;
  const body = clip(answer.content.replace(/\r\n?/g, "\n").trim(), MAX_MATERIAL_CHARS);
  const asked = question ? clip(question.content.replace(/\r\n?/g, "\n").trim(), MAX_QUESTION_CHARS) : null;
  const title = oneLine(answer.session.title) || "Untitled";
  if (!body.text) return { title, text: "", truncated: false };
  const parts = [`Chat title: ${neutralizeTags(title)}`];
  if (asked?.text) parts.push(`<question>\n${neutralizeTags(asked.text)}\n</question>`);
  parts.push(`<answer>\n${neutralizeTags(body.text)}\n</answer>`);
  if (body.truncated) parts.push("(The end of the answer was left out because of the size limit.)");
  return {
    title,
    text: `<material>\nThe material is an answer from a chat, with the question it answered.\n${parts.join("\n")}\n</material>`,
    truncated: body.truncated || !!asked?.truncated,
  };
}

// ノート（ノートの種類だけ）。本人の、ゴミ箱にないものを読み直す。無ければ null、本文が空なら text が空。
export async function readNoteMaterial(userId: string, pageId: string): Promise<Material | null> {
  const page = await prisma.notePage.findFirst({
    where: { id: pageId, userId, deletedAt: null, kind: "note" },
    select: { id: true, kind: true, title: true, blocks: true },
  });
  if (!page) return null;
  const title = oneLine(page.title) || "Untitled";
  const body = clip(pageContextText(page).trim(), MAX_MATERIAL_CHARS);
  if (!body.text) return { title, text: "", truncated: false };
  return {
    title,
    text: `<material>\nThe material is the user's note titled ${JSON.stringify(neutralizeTags(title).slice(0, 200))}.${body.truncated ? " Its end was left out because of the size limit." : ""}\n${delimitPageContent(neutralizeTags(body.text))}\n</material>`,
    truncated: body.truncated,
  };
}

// ---- スライド生成の材料（テーマ、複数のノート、会話） ----

// 1 つのノートから使う上限と、全ノートの合計。
export const MAX_SLIDES_NOTE_CHARS = MAX_MATERIAL_CHARS;
export const MAX_SLIDES_NOTES_CHARS = 60_000;

// スライド生成の区切り（topic / conversation / settings / outline）も本文から作れないようにする。
const neutralizeSlidesTags = (text: string) => text.replace(/<(\/?)(material|question|answer|topic|conversation|settings|outline)\b/gi, "‹$1$2");
// 会話は buildTranscript の <conversation> / <user> / <assistant> を残すので、外側の区切りだけを無害にする。
const neutralizeAroundTranscript = (text: string) => text.replace(/<(\/?)(material|topic|settings|outline)\b/gi, "‹$1$2");

export function readTopicMaterial(topic: string): Material {
  const value = oneLine(topic);
  return {
    title: value,
    text: value ? `<material>\nThe material is a topic the user typed.\n<topic>\n${neutralizeSlidesTags(value)}\n</topic>\n</material>` : "",
    truncated: false,
  };
}

// ノートを 1 つ以上（渡した順）。本人の、ゴミ箱にないノートの種類だけを読み直す。1 つでも無ければ null。
// 本文がどれも空なら text が空。ノートごとと合計の上限で切る（切った・入らなかったときは truncated）。
export async function readNotesMaterial(userId: string, pageIds: readonly string[]): Promise<Material | null> {
  const rows = await prisma.notePage.findMany({
    where: { id: { in: [...pageIds] }, userId, deletedAt: null, kind: "note" },
    select: { id: true, kind: true, title: true, blocks: true },
  });
  const pages = pageIds.map((id) => rows.find((row) => row.id === id)).filter((page) => page !== undefined);
  if (!pages.length || pages.length !== pageIds.length) return null;
  let remaining = MAX_SLIDES_NOTES_CHARS;
  let truncated = false;
  const parts: string[] = [];
  for (const page of pages) {
    const content = pageContextText(page).trim();
    if (!content) continue;
    const body = clip(content, Math.min(MAX_SLIDES_NOTE_CHARS, remaining));
    truncated ||= body.truncated;
    if (!body.text) continue;
    remaining -= body.text.length;
    const title = JSON.stringify(neutralizeSlidesTags(oneLine(page.title) || "Untitled").slice(0, 200));
    const cutNote = body.truncated ? " Its end was left out because of the size limit." : "";
    parts.push(`A note titled ${title}.${cutNote}\n${delimitPageContent(neutralizeSlidesTags(body.text))}`);
  }
  return {
    title: oneLine(pages[0].title) || "Untitled",
    text: parts.length ? `<material>\nThe material is the user's notes.\n${parts.join("\n")}\n</material>` : "",
    truncated,
  };
}

// 会話。本人の会話の、表示中の枝（active: true）の USER / ASSISTANT の本文と添付のファイル名だけ（Create page と同じ読み方）。
// SYSTEM と providerContext は読まない。会話が無ければ null、使える発言が無ければ text が空。
export async function readChatMaterial(userId: string, sessionId: string): Promise<Material | null> {
  const session = await prisma.session.findFirst({ where: { id: sessionId, userId }, select: { title: true } });
  if (!session) return null;
  const newest = await prisma.message.findMany({
    where: { sessionId, active: true, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_TRANSCRIPT_MESSAGES + 1,
    select: { role: true, content: true, attachments: { select: { filename: true } } },
  });
  const earlierLeftOut = newest.length > MAX_TRANSCRIPT_MESSAGES;
  const transcript = buildTranscript(session.title, newest.slice(0, MAX_TRANSCRIPT_MESSAGES).reverse(), earlierLeftOut);
  const title = oneLine(session.title) || "Untitled";
  if (!transcript) return { title, text: "", truncated: false };
  return {
    title,
    text: `<material>\nThe material is a chat conversation.\n${neutralizeAroundTranscript(transcript.text)}\n</material>`,
    truncated: transcript.omitted,
  };
}
