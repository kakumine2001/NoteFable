import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { getNotionStagingChunkPath, getStagingChunkSize } from "@/lib/notion-files";
import { loadOwnedNotionSave } from "@/lib/notion-saves";

export const runtime = "nodejs";

type UploadClientPayload = {
  saveId: string;
  fileId: string;
  chunkIndex: number;
};

function parseClientPayload(value: string | null): UploadClientPayload | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<UploadClientPayload>;

    if (
      typeof parsed.saveId !== "string" ||
      typeof parsed.fileId !== "string" ||
      !Number.isSafeInteger(parsed.chunkIndex)
    ) {
      return null;
    }

    return {
      saveId: parsed.saveId,
      fileId: parsed.fileId,
      chunkIndex: parsed.chunkIndex as number,
    };
  } catch {
    return null;
  }
}

// ブラウザから Private Blob へ直接アップロードするための一時トークンを発行する。
// トークンは「その下書きの、そのファイルの、そのチャンク 1 つ」だけに絞る。
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = parseClientPayload(clientPayload);

        if (!payload) {
          throw new Error("Invalid upload request.");
        }

        // 所有者が一致しない下書きのパスにはトークンを出さない。
        const save = await loadOwnedNotionSave(payload.saveId);
        const file = save?.files.find((item) => item.id === payload.fileId);

        if (!save || !file) {
          throw new Error("File not found.");
        }

        if (file.status !== "PENDING") {
          throw new Error("This file has already been uploaded.");
        }

        if (payload.chunkIndex < 0 || payload.chunkIndex >= file.stagingChunkCount) {
          throw new Error("Invalid chunk index.");
        }

        // トークンの対象パスを、このファイルのこのチャンクだけに固定する。
        if (pathname !== getNotionStagingChunkPath(payload.saveId, payload.fileId, payload.chunkIndex)) {
          throw new Error("Invalid upload path.");
        }

        return {
          allowedContentTypes: [...new Set([file.mimeType, "application/octet-stream"])],
          // 容量も 1 チャンク分に限定する。
          maximumSizeInBytes: getStagingChunkSize(Number(file.size), payload.chunkIndex),
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
