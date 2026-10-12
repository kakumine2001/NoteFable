import { NextRequest, NextResponse } from "next/server";
import { optionalEnv } from "@/lib/env";
import { collectUnusedCovers } from "@/lib/note-covers";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel Cron から日次で呼ばれる。CRON_SECRET が無い場合は何もせず拒否する。
export async function GET(request: NextRequest) {
  const secret = optionalEnv("CRON_SECRET");

  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // 7 日以上どのページにも使われていない Pages のカバー画像を回収する。
  let covers: Awaited<ReturnType<typeof collectUnusedCovers>> | { error: string };
  try { covers = await collectUnusedCovers(); } catch (error) {
    console.error("Failed to collect unused page covers", error);
    covers = { error: "Cover cleanup failed." };
  }

  return NextResponse.json({ covers });
}
