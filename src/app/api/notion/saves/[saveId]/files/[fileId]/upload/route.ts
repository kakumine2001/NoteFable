import { NextRequest, NextResponse } from "next/server";
import {
  completeNotionFileUpload,
  createNotionFileUpload,
  NotionWriteError,
  sendNotionFileUploadPart,
} from "@/lib/notion";
import {
  getNotionPartChunkIndexes,
  getNotionStagingChunkPath,
  getNotionUploadPlan,
} from "@/lib/notion-files";
import { loadOwnedNotionSave, serializeNotionSaveFile } from "@/lib/notion-saves";
import { readNotionStagingChunk } from "@/lib/notion-staging";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
// 1 リクエストで 10 MiB のパートを組み立てて送るため、既定より長めに確保する。
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ saveId: string; fileId: string }>;
};

// Notion への転送を 1 ステップだけ進める。
// 分割転送を短いリクエストに分け、進捗を DB に残すことで途中失敗から再開できるようにする。
export async function POST(_request: NextRequest, context: RouteContext) {
  const { saveId, fileId } = await context.params;
  const save = await loadOwnedNotionSave(saveId);
  const file = save?.files.find((item) => item.id === fileId);

  if (!save || !file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  if (file.status === "COMPLETE") {
    return NextResponse.json({ file: serializeNotionSaveFile(file), done: true });
  }

  if (file.status === "PENDING") {
    return NextResponse.json({ error: "Upload the file first." }, { status: 409 });
  }

  const size = Number(file.size);
  const plan = getNotionUploadPlan(size);

  try {
    if (!file.notionFileUploadId) {
      const upload = await createNotionFileUpload({
        filename: file.filename,
        contentType: file.mimeType,
        mode: plan.mode,
        partCount: plan.partCount,
      });

      const created = await prisma.notionSaveFile.update({
        where: { id: fileId },
        data: {
          notionFileUploadId: upload.id,
          partCount: plan.partCount,
          uploadedParts: 0,
          status: "UPLOADING",
          errorMessage: null,
        },
      });

      return NextResponse.json({ file: serializeNotionSaveFile(created), done: false });
    }

    if (file.uploadedParts >= plan.partCount) {
      // 送信済みのパート数が上限に達しているのに完了していない場合は、完了状態に寄せる。
      const completed = await prisma.notionSaveFile.update({
        where: { id: fileId },
        data: { status: "COMPLETE", errorMessage: null },
      });

      return NextResponse.json({ file: serializeNotionSaveFile(completed), done: true });
    }

    const partNumber = file.uploadedParts + 1;
    const chunks: Buffer[] = [];

    for (const chunkIndex of getNotionPartChunkIndexes(size, partNumber)) {
      chunks.push(await readNotionStagingChunk(getNotionStagingChunkPath(saveId, fileId, chunkIndex)));
    }

    await sendNotionFileUploadPart({
      fileUploadId: file.notionFileUploadId,
      filename: file.filename,
      contentType: file.mimeType,
      content: Buffer.concat(chunks),
      // 単一転送では part_number を付けない。
      partNumber: plan.mode === "multi_part" ? partNumber : undefined,
    });

    const isLastPart = partNumber >= plan.partCount;

    if (isLastPart && plan.mode === "multi_part") {
      await completeNotionFileUpload(file.notionFileUploadId);
    }

    const updated = await prisma.notionSaveFile.update({
      where: { id: fileId },
      data: {
        uploadedParts: partNumber,
        status: isLastPart ? "COMPLETE" : "UPLOADING",
        errorMessage: null,
      },
    });

    return NextResponse.json({ file: serializeNotionSaveFile(updated), done: isLastPart });
  } catch (error) {
    const message =
      error instanceof NotionWriteError ? error.message : "Failed to send the file to Notion.";

    // 失敗しても下書きと一時保管は残し、同じファイルから再試行できるようにする。
    await prisma.notionSaveFile.update({
      where: { id: fileId },
      data: { errorMessage: message },
    });

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
