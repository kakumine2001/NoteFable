import { randomBytes } from "node:crypto";
import { ROOT_PARENT, activationFor, buildTree, pathTo, type BranchTree } from "@/lib/chat-branches";
import { databaseSchema, prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

// 会話の全発言の木（版の計算用）。本文は読まない。
export async function loadBranchTree(sessionId: string, db: Db = prisma): Promise<BranchTree> {
  return buildTree(await db.message.findMany({
    where: { sessionId },
    select: { id: true, parentId: true, active: true, role: true, createdAt: true, selectedAt: true },
  }));
}

// 次の発言の親：表示中の枝の末尾の発言。発言が無ければ会話の先頭。木を全部読まずに 1 行だけ読む。
export async function loadActiveLeafId(sessionId: string, db: Db = prisma): Promise<string> {
  const leaf = await db.message.findFirst({
    where: { sessionId, active: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return leaf?.id ?? ROOT_PARENT;
}

// 同じ会話の「版の切り替え・編集・再生成の保存」が重ならないよう、トランザクションの間だけ会話の行を押さえる。
// 会話が無ければ（userId を渡したときは、その利用者のチャットでなければ）false。
export async function lockSession(tx: Prisma.TransactionClient, sessionId: string, userId?: string) {
  const table = Prisma.raw(`"${databaseSchema}"."Session"`);
  const rows = await tx.$queryRaw<{ id: string }[]>(userId
    ? Prisma.sql`SELECT "id" FROM ${table} WHERE "id" = ${sessionId} AND "userId" = ${userId} FOR UPDATE`
    : Prisma.sql`SELECT "id" FROM ${table} WHERE "id" = ${sessionId} FOR UPDATE`);
  return rows.length > 0;
}

// 複製した行に付ける ID。ほかの発言の ID（cuid）と同じ「c + 英小文字と数字」の形にして、ID の形を見る処理がそのまま通るようにする。
function newRowId() {
  const bytes = randomBytes(24);
  let id = "c";
  for (const byte of bytes) id += (byte % 36).toString(36);
  return id;
}

// 表示する版を切り替える。その版までの発言と、その先で最後に選んでいた枝を表示中にし、ほかを隠す。
// 会話が自分のものでない、発言がその会話に無いときは false。
export async function switchMessageVersion(userId: string, sessionId: string, messageId: string) {
  return prisma.$transaction(async (tx) => {
    if (!await lockSession(tx, sessionId, userId)) return false;
    const ids = activationFor(await loadBranchTree(sessionId, tx), messageId);
    if (!ids) return false;
    const active = [...ids];
    await tx.message.updateMany({ where: { sessionId, active: true, id: { notIn: active } }, data: { active: false } });
    await tx.message.updateMany({ where: { sessionId, active: false, id: { in: active } }, data: { active: true } });
    // 選んだ版を覚えておく（上の版を切り替え直したときに、この版へ戻る）。
    await tx.message.updateMany({ where: { sessionId, id: messageId }, data: { selectedAt: new Date() } });
    return true;
  });
}

// 生成中の応答へ「停止」を伝える。応答の側は stopRequestedAt が変わったのを見て止まる。自分の会話でなければ false。
export async function requestStop(userId: string, sessionId: string) {
  const updated = await prisma.session.updateMany({ where: { id: sessionId, userId }, data: { stopRequestedAt: new Date() } });
  return updated.count > 0;
}

// ここまでの会話を新しいチャットに複製する（表示中の枝の、その発言まで）。元の会話は変えない。
// 画像は同じ保存先を指す（会話を消しても画像は消さないので、片方を消してももう片方に残る）。
// プロバイダーの圧縮状態は元の発言 ID に結び付いているので写さない。複製した会話は本文の履歴から続ける。
export async function forkSession(userId: string, sessionId: string, messageId: string, title: string) {
  return prisma.$transaction(async (tx) => {
    const source = await tx.session.findFirst({ where: { id: sessionId, userId }, select: { icon: true, projectId: true, noteId: true } });
    if (!source) return null;
    const tree = await loadBranchTree(sessionId, tx);
    const target = tree.order.find((node) => node.id === messageId);
    if (!target?.active) return null;
    const path = pathTo(tree, messageId);
    const rows = await tx.message.findMany({
      where: { sessionId, id: { in: path }, active: true },
      select: {
        id: true, role: true, content: true, model: true, reasoningEffort: true, activity: true, thinkingMs: true, createdAt: true,
        attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { filename: true, mimeType: true, size: true, extractedText: true, imageStoragePath: true, createdAt: true } },
        notes: { select: { noteId: true, position: true, selectionIds: true } },
      },
    });
    if (!rows.length) return null;
    const session = await tx.session.create({
      // ノートの AI パネルで始めた会話の複製は、同じノートの会話のままにする（パネルの履歴に出て、どのノートの話かも引き継ぐ）。
      data: { userId, title, titleManual: true, icon: source.icon, projectId: source.projectId, noteId: source.noteId },
      select: { id: true, title: true, icon: true, pinned: true, position: true, projectId: true, noteId: true, createdAt: true, updatedAt: true },
    });
    // 木の順（先頭から）に並べ、親を 1 つずつつなぐ。作成時刻は元のまま（日付を保つ）。
    const byId = new Map(rows.map((row) => [row.id, row]));
    // 表示は作成時刻の順なので、同じ時刻の発言が並んでいたら 1 ミリ秒ずつずらして順番を保つ。
    let previousAt = 0;
    const copies = path.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      previousAt = Math.max(row.createdAt.getTime(), previousAt + 1);
      return [{ row, id: newRowId(), createdAt: new Date(previousAt) }];
    });
    await tx.message.createMany({
      data: copies.map(({ row, id, createdAt }, index) => ({
        id, sessionId: session.id, role: row.role, content: row.content, model: row.model, reasoningEffort: row.reasoningEffort,
        activity: row.activity, thinkingMs: row.thinkingMs, createdAt,
        parentId: index === 0 ? ROOT_PARENT : copies[index - 1].id,
      })),
    });
    const attachments = copies.flatMap(({ row, id }) => row.attachments.map((attachment) => ({ ...attachment, id: newRowId(), messageId: id })));
    if (attachments.length) await tx.attachment.createMany({ data: attachments });
    const notes = copies.flatMap(({ row, id }) => row.notes.map((note) => ({ ...note, messageId: id })));
    if (notes.length) await tx.messageNote.createMany({ data: notes });
    return session;
    // 長い会話は添付の抽出テキストも写すので、既定の 5 秒では足りないことがある。
  }, { timeout: 30000, maxWait: 10000 });
}
