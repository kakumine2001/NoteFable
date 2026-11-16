import { randomBytes } from "node:crypto";
import { activationFor, buildTree, pathTo, type BranchTree } from "@/lib/chat-branches";
import { databaseSchema, prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

// 会話の全発言の木（版の計算用）。本文は読まない。
export async function loadBranchTree(sessionId: string, db: Db = prisma): Promise<BranchTree> {
  return buildTree(await db.message.findMany({
    where: { sessionId },
    select: { id: true, parentId: true, active: true, role: true, createdAt: true },
  }));
}

// 複製した行に付ける ID。ほかの発言の ID（cuid）と同じ「c + 英小文字と数字」の形にして、ID の形を見る処理がそのまま通るようにする。
function newRowId() {
  const bytes = randomBytes(24);
  let id = "c";
  for (const byte of bytes) id += (byte % 36).toString(36);
  return id;
}

// 表示する版を切り替える。その版までの発言と、その先のいちばん新しい枝を表示中にし、ほかを隠す。
// 会話が自分のものでない、発言がその会話に無いときは false。
export async function switchMessageVersion(userId: string, sessionId: string, messageId: string) {
  return prisma.$transaction(async (tx) => {
    // 同じ会話の切り替え・送信と重ならないよう、会話の行を押さえる。
    const owned = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${databaseSchema}"."Session"`)} WHERE "id" = ${sessionId} AND "userId" = ${userId} AND "noteId" IS NULL FOR UPDATE`);
    if (!owned.length) return false;
    const ids = activationFor(await loadBranchTree(sessionId, tx), messageId);
    if (!ids) return false;
    const active = [...ids];
    await tx.message.updateMany({ where: { sessionId, active: true, id: { notIn: active } }, data: { active: false } });
    await tx.message.updateMany({ where: { sessionId, active: false, id: { in: active } }, data: { active: true } });
    return true;
  });
}

// ここまでの会話を新しいチャットに複製する（表示中の枝の、その発言まで）。元の会話は変えない。
// 画像は同じ保存先を指す（会話を消しても画像は消さないので、片方を消してももう片方に残る）。
// プロバイダーの圧縮状態は元の発言 ID に結び付いているので写さない。複製した会話は本文の履歴から続ける。
export async function forkSession(userId: string, sessionId: string, messageId: string, title: string) {
  return prisma.$transaction(async (tx) => {
    const source = await tx.session.findFirst({ where: { id: sessionId, userId, noteId: null }, select: { icon: true, projectId: true } });
    if (!source) return null;
    const tree = await loadBranchTree(sessionId, tx);
    const target = tree.order.find((node) => node.id === messageId);
    if (!target?.active) return null;
    const path = pathTo(tree, messageId);
    const rows = await tx.message.findMany({
      where: { sessionId, id: { in: path }, active: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true, role: true, content: true, model: true, reasoningEffort: true, activity: true, thinkingMs: true, createdAt: true,
        attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { filename: true, mimeType: true, size: true, extractedText: true, imageStoragePath: true, createdAt: true } },
        notes: { select: { noteId: true, position: true } },
      },
    });
    if (!rows.length) return null;
    const session = await tx.session.create({
      data: { userId, title, titleManual: true, icon: source.icon, projectId: source.projectId },
      select: { id: true, title: true, icon: true, pinned: true, position: true, projectId: true, createdAt: true, updatedAt: true },
    });
    // 作成時刻は元のまま（表示の順番と日付を保つ）。親は記録せず、作成順のつながりに任せる。
    const copies = rows.map((row) => ({ row, id: newRowId() }));
    await tx.message.createMany({
      data: copies.map(({ row, id }) => ({
        id, sessionId: session.id, role: row.role, content: row.content, model: row.model, reasoningEffort: row.reasoningEffort,
        activity: row.activity, thinkingMs: row.thinkingMs, createdAt: row.createdAt,
      })),
    });
    const attachments = copies.flatMap(({ row, id }) => row.attachments.map((attachment) => ({ ...attachment, id: newRowId(), messageId: id })));
    if (attachments.length) await tx.attachment.createMany({ data: attachments });
    const notes = copies.flatMap(({ row, id }) => row.notes.map((note) => ({ ...note, messageId: id })));
    if (notes.length) await tx.messageNote.createMany({ data: notes });
    return session;
  });
}
