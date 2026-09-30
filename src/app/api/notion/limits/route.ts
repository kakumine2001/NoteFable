import { NextResponse } from "next/server";
import {
  getNotionWorkspaceFileLimit,
  NotionConfigurationError,
  NotionWriteError,
} from "@/lib/notion";
import { NOTION_MAX_FILE_BYTES } from "@/lib/notion-files";

export const runtime = "nodejs";

// 接続先ワークスペースの 1 ファイル上限を返す。
// 画面の表示と、保存開始時のサーバー検証が同じ値を使えるようにする。
export async function GET() {
  try {
    const maxFileUploadBytes = await getNotionWorkspaceFileLimit();

    return NextResponse.json({
      maxFileUploadBytes,
      // Notion 自体の上限。ワークスペース上限と合わせて画面側の説明に使う。
      notionMaxFileBytes: NOTION_MAX_FILE_BYTES,
    });
  } catch (error) {
    if (error instanceof NotionConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (error instanceof NotionWriteError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    return NextResponse.json({ error: "Failed to read the Notion limit." }, { status: 502 });
  }
}
