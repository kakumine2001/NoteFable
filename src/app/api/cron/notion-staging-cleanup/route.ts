import { NextRequest, NextResponse } from "next/server";
import { optionalEnv } from "@/lib/env";
import { releaseNotionStaging } from "@/lib/notion-saves";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

// 放置された一時保管データの寿命。これを過ぎたら日次処理で回収する。
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;
// 1 回の実行で処理する下書き数。実行時間を読みやすく保つための上限。
const CLEANUP_BATCH_SIZE = 200;

// Vercel Cron から日次で呼ばれる。CRON_SECRET が無い場合は何もせず拒否する。
export async function GET(request: NextRequest) {
  const secret = optionalEnv("CRON_SECRET");

  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STAGING_TTL_MS);
  // 進行が止まったまま 24 時間を過ぎ、まだ一時保管が残っている下書きを対象にする。
  const saves = await prisma.notionSave.findMany({
    where: {
      updatedAt: { lt: cutoff },
      files: { some: { stagingPrefix: { not: null } } },
    },
    select: { id: true },
    take: CLEANUP_BATCH_SIZE,
  });

  let released = 0;

  for (const save of saves) {
    try {
      await releaseNotionStaging(save.id);
      // 保存が完了・取消済みのものは状態を変えず、保管データの解放だけを行う。
      await prisma.notionSave.updateMany({
        where: { id: save.id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        data: { status: "EXPIRED", errorMessage: null },
      });
      released += 1;
    } catch {
      // 1 件の失敗で残りの回収を止めない。次回の実行で再度対象になる。
    }
  }

  return NextResponse.json({ examined: saves.length, released });
}
