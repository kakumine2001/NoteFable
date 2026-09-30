import { NextRequest, NextResponse } from "next/server";
import {
  appendNotionPageBlocks,
  createNotionPageShell,
  type NotionPageBlock,
  NotionConfigurationError,
  NotionPartialWriteError,
  NotionWriteError,
  NotionWriteUnknownError,
} from "@/lib/notion";
import {
  buildOrderedNotionBlocks,
  loadOwnedNotionSave,
  parseStoredBlocks,
  releaseNotionStaging,
} from "@/lib/notion-saves";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ saveId: string }>;
};

type FinalizeRequest = {
  // 直前の書き込み結果が不明な時に、利用者が重複を承知で作り直す意思を示すフラグ。
  confirmPageCreation?: unknown;
  confirmAppendRetry?: unknown;
};

function buildBlocks(save: Awaited<ReturnType<typeof loadOwnedNotionSave>>) {
  if (!save) return [];

  return buildOrderedNotionBlocks(
    parseStoredBlocks(save.blocks),
    new Map(
      save.files.map((file) => [
        file.id,
        {
          filename: file.filename,
          blockType: file.blockType,
          notionFileUploadId: file.notionFileUploadId,
        },
      ]),
    ),
  );
}

// 本文ブロックを Notion ページへ書き出す。
// ページ作成と本文追加を分けて記録し、失敗しても同じページの続きから再開する。
export async function POST(request: NextRequest, context: RouteContext) {
  const { saveId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as FinalizeRequest;
  const confirmPageCreation = body.confirmPageCreation === true;
  const confirmAppendRetry = body.confirmAppendRetry === true;
  const save = await loadOwnedNotionSave(saveId);

  if (!save) {
    return NextResponse.json({ error: "Save not found." }, { status: 404 });
  }

  if (save.status === "COMPLETED") {
    return NextResponse.json({ url: save.notionPageUrl ?? "", pageId: save.notionPageId });
  }

  if (save.status === "CANCELLED" || save.status === "EXPIRED") {
    return NextResponse.json({ error: "This save can no longer be resumed." }, { status: 409 });
  }

  if (save.files.some((file) => file.status !== "COMPLETE")) {
    return NextResponse.json(
      { error: "Not all attachments have been transferred yet." },
      { status: 409 },
    );
  }

  if (!save.notionPageId && save.pageCreationUnknown && !confirmPageCreation) {
    // 前回の作成結果が不明なまま。無条件に作り直すと重複ページができるため確認を求める。
    return NextResponse.json(
      {
        error:
          "The previous page creation did not return a result. Check Notion before creating another page.",
        code: "PAGE_CREATE_UNKNOWN",
        needsConfirmation: true,
      },
      { status: 409 },
    );
  }

  if (save.appendResultUnknown && !confirmAppendRetry) {
    return NextResponse.json(
      {
        error: "The previous append may have succeeded. Check the Notion page before retrying.",
        code: "APPEND_WRITE_UNKNOWN",
        needsConfirmation: true,
      },
      { status: 409 },
    );
  }

  const blocks: NotionPageBlock[] = buildBlocks(save);
  let pageId = save.notionPageId;

  try {
    if (save.notionPageId) {
      // ページは作成済み。書き込み済みの位置から続きだけを追加する。
      const written = await appendNotionPageBlocks({
        pageId: save.notionPageId,
        blocks,
        startIndex: save.notionBlocksWritten,
      });

      await prisma.notionSave.update({
        where: { id: saveId },
        data: {
          status: "COMPLETED",
          notionBlocksWritten: written,
          pageCreationUnknown: false,
          appendResultUnknown: false,
          errorMessage: null,
        },
      });

      await releaseNotionStaging(saveId);

      return NextResponse.json({ url: save.notionPageUrl ?? "", pageId: save.notionPageId });
    }

    const page = await createNotionPageShell(save.title);

    // ページ ID は本文追加の前に必ず残す。以降の失敗は同じページへの続行で復旧できる。
    await prisma.notionSave.update({
      where: { id: saveId },
      data: {
        notionPageId: page.pageId,
        notionPageUrl: page.url,
        notionBlocksWritten: 0,
        pageCreationUnknown: false,
        appendResultUnknown: false,
      },
    });
    pageId = page.pageId;

    const written = await appendNotionPageBlocks({
      pageId: page.pageId,
      blocks,
      startIndex: 0,
    });

    await prisma.notionSave.update({
      where: { id: saveId },
      data: { status: "COMPLETED", notionBlocksWritten: written, appendResultUnknown: false, errorMessage: null },
    });

    await releaseNotionStaging(saveId);

    return NextResponse.json({ url: page.url, pageId: page.pageId });
  } catch (error) {
    if (error instanceof NotionPartialWriteError) {
      // 書き込み済みの位置を保存し、次回はその続きから再開する。
      await prisma.notionSave.update({
        where: { id: saveId },
        data: {
          status: "TRANSFERRING",
          notionBlocksWritten: error.writtenBlocks,
          errorMessage: error.message,
        },
      });

      return NextResponse.json(
        { error: error.message, resumable: true },
        { status: 502 },
      );
    }

    if (error instanceof NotionWriteUnknownError) {
      const appendUnknown = Boolean(pageId);
      await prisma.notionSave.update({
        where: { id: saveId },
        data: {
          status: "TRANSFERRING",
          // ページ作成と本文追加のどちらが不明かを分けて記録する。
          pageCreationUnknown: !appendUnknown,
          appendResultUnknown: appendUnknown,
          ...(appendUnknown ? { notionBlocksWritten: error.writtenBlocks } : {}),
          errorMessage: error.message,
        },
      });

      return NextResponse.json(
        {
          error: error.message,
          code: appendUnknown ? "APPEND_WRITE_UNKNOWN" : "PAGE_CREATE_UNKNOWN",
          needsConfirmation: true,
        },
        { status: 502 },
      );
    }

    if (error instanceof NotionWriteError) {
      await prisma.notionSave.update({
        where: { id: saveId },
        data: { status: "TRANSFERRING", errorMessage: error.message },
      });

      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    if (error instanceof NotionConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Failed to save to Notion." }, { status: 502 });
  }
}
