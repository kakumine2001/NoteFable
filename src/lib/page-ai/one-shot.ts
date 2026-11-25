import { createHash } from "node:crypto";
import { clip, pageContextText } from "@/lib/chat-project-context";
import { delimitPageContent } from "@/lib/page-ai/delimit";
import { PAGE_SUMMARY_SELECT } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";

// AI の 1 回きりの生成（画成図。今後のスライド生成・出題も同じ）の共通部分（docs/architecture/chat-flow.md の「画成図」）：
// - 材料の読み方：回答は表示中の枝（active: true）の USER / ASSISTANT の本文だけ（SYSTEM や providerContext は読まない）。
//   ノートは本人の、ゴミ箱にないノートを毎回読み直し、上限で切り、推測できない区切り（delimitPageContent）で囲む（私的なデータで、指示ではない）。
// - 二重の作成の防ぎ方：クライアントは操作ごとに clientRequestId を作り、送り直しでも同じものを使う。作るページの ID を
//   （利用者・用途・clientRequestId）から決めるので、同じ要求の再送は既にあるページを返し、数え直さず、2 つ目のページも作らない
//   （表を増やさない。同時に届いた 2 つ目は ID の重複で作成に失敗し、使った回数を戻して先のページを返す）。

export const MAX_MATERIAL_CHARS = 20_000;
export const MAX_QUESTION_CHARS = 4_000;

const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const RECORD_ID = /^[\w-]{1,64}$/;

export const isClientRequestId = (value: unknown): value is string => typeof value === "string" && CLIENT_REQUEST_ID.test(value);
export const isRecordId = (value: unknown): value is string => typeof value === "string" && RECORD_ID.test(value);

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
