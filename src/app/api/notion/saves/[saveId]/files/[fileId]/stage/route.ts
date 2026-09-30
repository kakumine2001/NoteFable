import { NextRequest, NextResponse } from "next/server";
import { getNotionStagingChunkPath, getStagingChunkSize } from "@/lib/notion-files";
import { loadOwnedNotionSave, serializeNotionSaveFile } from "@/lib/notion-saves";
import { headNotionStagingChunk } from "@/lib/notion-staging";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ saveId: string; fileId: string }>;
};

// ブラウザから Private Blob への一時保管が終わったファイルを検証して確定する。
// 実際に置かれたチャンクのサイズまで見て、欠けがあれば転送へ進めない。
export async function POST(_request: NextRequest, context: RouteContext) {
  const { saveId, fileId } = await context.params;
  const save = await loadOwnedNotionSave(saveId);
  const file = save?.files.find((item) => item.id === fileId);

  if (!save || !file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  if (file.status !== "PENDING") {
    return NextResponse.json({ file: serializeNotionSaveFile(file) });
  }

  const size = Number(file.size);

  for (let index = 0; index < file.stagingChunkCount; index += 1) {
    const head = await headNotionStagingChunk(getNotionStagingChunkPath(saveId, fileId, index));
    const expectedSize = getStagingChunkSize(size, index);

    if (!head || head.size !== expectedSize) {
      return NextResponse.json(
        { error: "The uploaded file is incomplete. Upload it again." },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.notionSaveFile.update({
    where: { id: fileId },
    data: { status: "STAGED", errorMessage: null },
  });

  await prisma.notionSave.update({
    where: { id: saveId },
    data: { status: "TRANSFERRING", errorMessage: null },
  });

  return NextResponse.json({ file: serializeNotionSaveFile(updated) });
}
