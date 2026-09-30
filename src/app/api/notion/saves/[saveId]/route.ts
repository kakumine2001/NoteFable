import { NextRequest, NextResponse } from "next/server";
import { loadOwnedNotionSave, releaseNotionStaging } from "@/lib/notion-saves";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ saveId: string }>;
};

// 下書きの取り消し。転送中でも呼べるようにし、一時保管をすぐ解放する。
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { saveId } = await context.params;
  // 所有者が一致しない下書きは見つからない扱いにする。
  const save = await loadOwnedNotionSave(saveId);

  if (!save) {
    return NextResponse.json({ error: "Save not found." }, { status: 404 });
  }

  await releaseNotionStaging(saveId);
  await prisma.notionSave.update({
    where: { id: saveId },
    data: { status: "CANCELLED", errorMessage: null },
  });

  // ページ作成まで進んでいた場合は、取消後もそのページを開けるように URL を返す。
  return NextResponse.json({ ok: true, url: save.notionPageUrl ?? "" });
}
