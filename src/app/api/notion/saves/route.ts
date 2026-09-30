import { NextRequest, NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import {
  getNotionWorkspaceFileLimit,
  NotionConfigurationError,
  NotionWriteError,
} from "@/lib/notion";
import { getNotionStagingPrefix, getStagingChunkCount } from "@/lib/notion-files";
import {
  MAX_NOTION_DRAFT_TITLE_CHARS,
  parseNotionSaveBlocks,
  type StoredNotionSaveBlock,
} from "@/lib/notion-saves";
import { prisma } from "@/lib/prisma";
import type { NotionSavePlanFile } from "@/types/notion";

export const runtime = "nodejs";

type CreateSaveRequest = {
  title?: unknown;
  sessionId?: unknown;
  blocks?: unknown;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as CreateSaveRequest;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  if (title.length > MAX_NOTION_DRAFT_TITLE_CHARS) {
    return NextResponse.json({ error: "Title is too long." }, { status: 400 });
  }

  let maxFileUploadBytes: number;

  try {
    // 添付を受け取る前に、接続先ワークスペースの上限を確認して同じ基準で検証する。
    maxFileUploadBytes = await getNotionWorkspaceFileLimit();
  } catch (error) {
    if (error instanceof NotionConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (error instanceof NotionWriteError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    return NextResponse.json({ error: "Failed to save to Notion." }, { status: 502 });
  }

  const parsed = parseNotionSaveBlocks(body.blocks, maxFileUploadBytes);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const user = await getOrCreateAnonymousUser();

  if (sessionId) {
    // sessionId がある時だけ所有者確認する。手動メモはセッションなしでも保存できる。
    const session = await prisma.session.findFirst({
      where: { id: sessionId, userId: user.id },
      select: { id: true },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
  }

  const { blocks: draftBlocks, files: draftFiles } = parsed.parsed;

  const { saveId, files } = await prisma.$transaction(async (tx) => {
    const save = await tx.notionSave.create({
      data: {
        userId: user.id,
        sessionId: sessionId || null,
        title,
        // 保存ボタンから作られる時点で転送は始まっている。受け入れ準備の状態にする。
        status: "STAGING",
        // ファイル ID が決まるまで blocks は空にし、作成後に確定させて上書きする。
        blocks: [],
      },
    });

    const createdFiles: Array<{ id: string; chunkCount: number }> = [];

    for (const file of draftFiles) {
      const record = await tx.notionSaveFile.create({
        data: {
          saveId: save.id,
          filename: file.filename,
          mimeType: file.mimeType,
          size: BigInt(file.size),
          blockType: file.blockType,
          stagingPrefix: getNotionStagingPrefix(save.id),
          stagingChunkCount: getStagingChunkCount(file.size),
        },
      });

      createdFiles.push({ id: record.id, chunkCount: record.stagingChunkCount });
    }

    const blocks: StoredNotionSaveBlock[] = draftBlocks.map((block) =>
      block.type === "text"
        ? { type: "text", text: block.text }
        : { type: "file", fileId: createdFiles[block.fileIndex].id },
    );

    await tx.notionSave.update({
      where: { id: save.id },
      data: { blocks },
    });

    return { saveId: save.id, files: createdFiles };
  });

  return NextResponse.json({
    saveId,
    maxFileUploadBytes,
    files: draftFiles.map((file, index): NotionSavePlanFile => ({
      fileId: files[index].id,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      blockType: file.blockType,
      chunkCount: files[index].chunkCount,
      status: "PENDING",
      partCount: 0,
      uploadedParts: 0,
    })),
  });
}
