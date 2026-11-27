import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { databaseSchema, prisma } from "@/lib/prisma";
import { usageDay } from "@/lib/usage-limits";

// ページを作らない 1 回きりの生成（スライドの大綱）で、同じ要求の送り直しを 2 回数えないための印（docs/architecture/database.md の「UsageCounter」）。
// 表は増やさず UsageCounter に 1 行置く：key は "user:<利用者 ID>"（アカウント削除で一緒に消える）、
// kind は "req:<用途>:<clientRequestId>:<入力の指紋>"。同じ ID でも入力が違えば別の要求として数える（ID を使い回しても無料にはならない）。
// count は 0 = 生成中、1 以上 = 返せた（1 + 数えずにやり直した回数）。古い行は usage-limits.ts が時々消す。

export type UsageRequestPurpose = "slides-outline" | "page-quiz";

type Marker = { key: string; kind: string };
// new: この呼び出しが数える。resume: 数えた処理が途中で消えたので、数えずに続ける。
// replay: 返したあとの送り直しなので、数えずに作り直す。busy: 同じ要求がまだ動いている。
export type UsageRequestClaim = ({ state: "new" | "resume" | "replay" } & Marker) | { state: "busy" };
type ClaimedRequest = Extract<UsageRequestClaim, Marker>;

// 返したあと、数えずに作り直せる回数。応答が届かなかったときの送り直しのためで、使い切ったらもう一度数える。
export const FREE_REPLAYS = 3;
// これより長く「生成中」のままの印は、処理が消えたとみなす（ルートの maxDuration）。
const STALE_SECONDS = 300;

const table = () => Prisma.raw(`"${databaseSchema}"."UsageCounter"`);

// キーの順に依らない JSON。
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function usageRequestKind(purpose: UsageRequestPurpose, clientRequestId: string, input: unknown) {
  const fingerprint = createHash("sha256").update(canonical(input)).digest("hex").slice(0, 16);
  return `req:${purpose}:${clientRequestId}:${fingerprint}`;
}

// 同じ要求の印を取る。印ごとのロックを持つ 1 つのトランザクションで行うので、同時に届いても数えるのは 1 回だけ。
export async function claimUsageRequest(userId: string, purpose: UsageRequestPurpose, clientRequestId: string, input: unknown): Promise<UsageRequestClaim> {
  const key = `user:${userId}`;
  const kind = usageRequestKind(purpose, clientRequestId, input);
  const day = usageDay();
  const state = await prisma.$transaction(async (tx) => {
    // 日付の変わり目に同時に届くと日ごとの主キーが分かれるので、先に印の名前で順番に並べる。
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${key}:${kind}`}))`);
    const changed = async (query: Prisma.Sql) => (await tx.$queryRaw<{ count: number }[]>(query)).length > 0;
    const inserted = await changed(Prisma.sql`
      INSERT INTO ${table()} ("key", "kind", "day", "count", "updatedAt")
      SELECT ${key}, ${kind}, ${day}::date, 0, now()
      WHERE NOT EXISTS (SELECT 1 FROM ${table()} WHERE "key" = ${key} AND "kind" = ${kind})
      ON CONFLICT DO NOTHING
      RETURNING "count"`);
    if (inserted) return "new";
    const replayed = await changed(Prisma.sql`
      UPDATE ${table()} SET "count" = "count" + 1, "updatedAt" = now()
      WHERE "key" = ${key} AND "kind" = ${kind} AND "count" BETWEEN 1 AND ${FREE_REPLAYS}
      RETURNING "count"`);
    if (replayed) return "replay";
    const resumed = await changed(Prisma.sql`
      UPDATE ${table()} SET "updatedAt" = now()
      WHERE "key" = ${key} AND "kind" = ${kind} AND "count" = 0 AND "updatedAt" < now() - make_interval(secs => ${STALE_SECONDS})
      RETURNING "count"`);
    if (resumed) return "resume";
    // 無料の作り直しを使い切った：もう一度数える。
    const reopened = await changed(Prisma.sql`
      UPDATE ${table()} SET "count" = 0, "updatedAt" = now()
      WHERE "key" = ${key} AND "kind" = ${kind} AND "count" > ${FREE_REPLAYS}
      RETURNING "count"`);
    return reopened ? "new" : "busy";
  });
  return state === "busy" ? { state } : { state, key, kind };
}

// 印の更新に失敗しても、利用者への応答は止めない。
async function write(query: Prisma.Sql) {
  try {
    await prisma.$executeRaw(query);
  } catch (error) {
    console.warn("Failed to update a usage request marker", error instanceof Error ? error.message : error);
  }
}

// 結果を返せた。
export async function completeUsageRequest({ key, kind }: ClaimedRequest) {
  await write(Prisma.sql`UPDATE ${table()} SET "count" = 1, "updatedAt" = now() WHERE "key" = ${key} AND "kind" = ${kind} AND "count" = 0`);
}

// 数えた呼び出しが失敗した（呼び出し側が回数を戻す）。印を消し、送り直しは改めて数える。
export async function releaseUsageRequest({ key, kind }: ClaimedRequest) {
  await write(Prisma.sql`DELETE FROM ${table()} WHERE "key" = ${key} AND "kind" = ${kind}`);
}

// 数えずに続けた呼び出し（resume）が失敗した。次の送り直しもすぐ続けられるように、古い時刻にする。
export async function abandonUsageRequest({ key, kind }: ClaimedRequest) {
  await write(Prisma.sql`UPDATE ${table()} SET "updatedAt" = 'epoch' WHERE "key" = ${key} AND "kind" = ${kind} AND "count" = 0`);
}
