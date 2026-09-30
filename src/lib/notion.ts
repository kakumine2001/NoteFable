import { optionalEnv } from "@/lib/env";
import {
  NOTION_FREE_PLAN_MAX_FILE_BYTES,
  NOTION_MAX_FILE_BYTES,
} from "@/lib/notion-files";

// 既存のページ作成・ブロック追加はこのバージョンのまま動かす。
// 2026-03-11 ではデータベース周りの扱いが変わるため、無条件に移行しない。
const NOTION_API_VERSION = "2022-06-28";
// ファイル転送 API（file_uploads / users/me）はこのバージョンでしか使えないため分けて指定する。
const NOTION_FILE_API_VERSION = "2026-03-11";
const NOTION_TEXT_CHUNK_SIZE = 1900;
const NOTION_BLOCK_BATCH_SIZE = 100;
// Notion が受け付ける filename の上限はバイト数。マルチバイト名でも切れないよう byteLength で見る。
const NOTION_FILENAME_MAX_BYTES = 900;
// ワークスペース上限は頻繁に変わらないので、短時間だけインスタンス内に保持する。
const WORKSPACE_LIMIT_CACHE_MS = 60_000;

type NotionRichText = {
  type: "text";
  text: {
    content: string;
  };
};

type NotionParagraphBlock = {
  object: "block";
  type: "paragraph";
  paragraph: {
    rich_text: NotionRichText[];
  };
};

// Notion へ送るブロック。text は段落、file は画像またはファイルブロックになる。
export type NotionPageBlock =
  | { type: "text"; text: string }
  | { type: "file"; filename: string; fileUploadId: string; blockType: "image" | "file" };

type NotionBlockPayload = Record<string, unknown>;

type NotionCreatePageResponse = {
  id?: string;
  url?: string;
  message?: string;
};

type NotionDatabaseResponse = {
  properties?: Record<string, { type?: string }>;
  message?: string;
};

type NotionSelfResponse = {
  bot?: {
    workspace_limits?: {
      max_file_upload_size_in_bytes?: number;
    };
  };
  message?: string;
};

type NotionFileUploadResponse = {
  id?: string;
  upload_url?: string;
  status?: string;
  message?: string;
};

export class NotionConfigurationError extends Error {
  constructor() {
    super("Notion is not configured.");
  }
}

export class NotionWriteError extends Error {
  constructor(message = "Failed to save to Notion.") {
    super(message);
  }
}

// レスポンスを受け取れず、書き込みが反映されたか判断できない失敗。
// 呼び出し側は同じ処理を無条件にやり直さず、確認を挟んでから続行する。
export class NotionWriteUnknownError extends Error {
  constructor(
    message: string,
    readonly writtenBlocks: number,
  ) {
    super(message);
  }
}

// 途中まで書き込めた状態で失敗したことを伝える。書き込み済み件数まで続きから再開できる。
export class NotionPartialWriteError extends Error {
  constructor(
    message: string,
    readonly writtenBlocks: number,
  ) {
    super(message);
  }
}

let workspaceLimitCache: { value: number; expiresAt: number } | null = null;

function getNotionConfig() {
  const apiKey = optionalEnv("NOTION_API_KEY");
  const databaseId = optionalEnv("NOTION_DATABASE_ID");

  if (!apiKey || !databaseId) {
    throw new NotionConfigurationError();
  }

  return { apiKey, databaseId };
}

function splitText(value: string) {
  const chunks: string[] = [];

  for (let index = 0; index < value.length; ) {
    let end = Math.min(index + NOTION_TEXT_CHUNK_SIZE, value.length);
    const finalCodeUnit = value.charCodeAt(end - 1);
    const nextCodeUnit = value.charCodeAt(end);

    // UTF-16 のサロゲートペアを別々の rich text に切り分けない。
    if (
      end < value.length &&
      finalCodeUnit >= 0xd800 &&
      finalCodeUnit <= 0xdbff &&
      nextCodeUnit >= 0xdc00 &&
      nextCodeUnit <= 0xdfff
    ) {
      end -= 1;
    }

    chunks.push(value.slice(index, end));
    index = end;
  }

  return chunks.length ? chunks : [""];
}

function toRichText(value: string): NotionRichText[] {
  return splitText(value).map((content) => ({
    type: "text",
    text: { content },
  }));
}

export function toParagraphBlocks(content: string): NotionParagraphBlock[] {
  // 空行を段落境界にし、Notion 側で読みやすい単位に分ける。
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.flatMap((paragraph) =>
    splitText(paragraph).map((chunk) => ({
      object: "block" as const,
      type: "paragraph" as const,
      paragraph: {
        // 長い段落も 1 block 1 rich text にし、Notion の配列上限を超えないようにする。
        rich_text: toRichText(chunk),
      },
    })),
  );
}

// 添付は Notion 側のアップロード済みファイルを参照する。
// 画像は image、それ以外は file ブロックにし、保存順序は呼び出し側の配列順のまま保つ。
function toFileBlock(block: Extract<NotionPageBlock, { type: "file" }>): NotionBlockPayload {
  const reference = {
    type: "file_upload" as const,
    file_upload: { id: block.fileUploadId },
  };

  if (block.blockType === "image") {
    return {
      object: "block",
      type: "image",
      image: { ...reference, caption: [] },
    };
  }

  return {
    object: "block",
    type: "file",
    file: { ...reference, caption: [], name: block.filename },
  };
}

export function toNotionBlockPayloads(blocks: NotionPageBlock[]): NotionBlockPayload[] {
  return blocks.flatMap((block) =>
    block.type === "text" ? toParagraphBlocks(block.text) : [toFileBlock(block)],
  );
}

function truncateFilename(filename: string) {
  if (Buffer.byteLength(filename) <= NOTION_FILENAME_MAX_BYTES) {
    return filename;
  }

  // 拡張子は Notion の形式判定に使われるため残し、手前の名前だけを詰める。
  const match = /^(.*)(\.[A-Za-z0-9]+)$/.exec(filename);
  const extension = match?.[2] ?? "";
  const base = match?.[1] ?? filename;
  const allowedBaseBytes = NOTION_FILENAME_MAX_BYTES - Buffer.byteLength(extension);

  return `${Buffer.from(base).subarray(0, Math.max(1, allowedBaseBytes)).toString("utf8")}${extension}`;
}

async function notionRequest<T>(
  apiKey: string,
  path: string,
  init: RequestInit,
  version = NOTION_API_VERSION,
) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": version,
      ...init.headers,
    },
  });

  const data = (await response.json().catch(() => ({}))) as T & { message?: string };

  if (!response.ok) {
    throw new NotionWriteError(data.message);
  }

  return data;
}

async function resolveTitlePropertyName(apiKey: string, databaseId: string) {
  const database = await notionRequest<NotionDatabaseResponse>(apiKey, `/databases/${databaseId}`, {
    method: "GET",
  });
  const titlePropertyName = Object.entries(database.properties ?? {}).find(
    ([, property]) => property.type === "title",
  )?.[0];

  if (!titlePropertyName) {
    throw new NotionWriteError("Notion database title property was not found.");
  }

  return titlePropertyName;
}

export async function createNotionPage(input: { title: string; content: string }) {
  const { apiKey, databaseId } = getNotionConfig();
  const titlePropertyName = await resolveTitlePropertyName(apiKey, databaseId);

  const blocks = toParagraphBlocks(input.content);
  const firstBlocks = blocks.slice(0, NOTION_BLOCK_BATCH_SIZE);
  const remainingBlocks = blocks.slice(NOTION_BLOCK_BATCH_SIZE);

  const page = await notionRequest<NotionCreatePageResponse>(apiKey, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: {
        type: "database_id",
        database_id: databaseId,
      },
      properties: {
        [titlePropertyName]: {
          title: toRichText(input.title.trim().slice(0, 2000)),
        },
      },
      children: firstBlocks,
    }),
  });

  if (!page.id || !page.url) {
    throw new NotionWriteError();
  }

  for (let index = 0; index < remainingBlocks.length; index += NOTION_BLOCK_BATCH_SIZE) {
    await notionRequest(apiKey, `/blocks/${page.id}/children`, {
      method: "PATCH",
      body: JSON.stringify({
        children: remainingBlocks.slice(index, index + NOTION_BLOCK_BATCH_SIZE),
      }),
    });
  }

  return { url: page.url };
}

// ページ本体は既存バージョンで作成し、本文ブロックはファイル API のバージョンで追加する。
// 添付を含むブロックは file_upload 参照を解釈できるバージョンでしか送れないため。
async function appendBlockBatches(
  apiKey: string,
  pageId: string,
  payloads: NotionBlockPayload[],
  startIndex: number,
) {
  let written = startIndex;

  for (let index = startIndex; index < payloads.length; index += NOTION_BLOCK_BATCH_SIZE) {
    const batch = payloads.slice(index, index + NOTION_BLOCK_BATCH_SIZE);

    try {
      await notionRequest(
        apiKey,
        `/blocks/${pageId}/children`,
        {
          method: "PATCH",
          body: JSON.stringify({ children: batch }),
        },
        NOTION_FILE_API_VERSION,
      );
    } catch (error) {
      if (error instanceof NotionWriteError) {
        // HTTP エラーは書き込みが反映されていないと判断できるので、続きから再開できる。
        throw new NotionPartialWriteError(error.message, written);
      }

      // レスポンスがない場合は反映済みか判断できない。再開位置を確定させない。
      throw new NotionWriteUnknownError("Failed to append Notion blocks.", written);
    }

    written = index + batch.length;
  }

  return written;
}

export async function createNotionPageWithBlocks(input: {
  title: string;
  blocks: NotionPageBlock[];
}) {
  const page = await createNotionPageShell(input.title);

  return {
    pageId: page.pageId,
    url: page.url,
    blocksWritten: await appendBlockBatches(
      getNotionConfig().apiKey,
      page.pageId,
      toNotionBlockPayloads(input.blocks),
      0,
    ),
  };
}

// 本文を入れずにページだけ作る。ブロックは後から順序どおり追加する。
// 作成と本文追加を分けることで、本文追加で失敗しても同じページへ続きから書き込める。
export async function createNotionPageShell(title: string) {
  const { apiKey, databaseId } = getNotionConfig();
  const titlePropertyName = await resolveTitlePropertyName(apiKey, databaseId);
  let page: NotionCreatePageResponse;

  try {
    page = await notionRequest<NotionCreatePageResponse>(
      apiKey,
      "/pages",
      {
        method: "POST",
        body: JSON.stringify({
          parent: {
            type: "database_id",
            database_id: databaseId,
          },
          properties: {
            [titlePropertyName]: {
              title: toRichText(title.trim().slice(0, 2000)),
            },
          },
        }),
      },
      // データベースを親にする作成は既存バージョンの挙動を維持する。
      NOTION_API_VERSION,
    );
  } catch (error) {
    if (error instanceof NotionWriteError) {
      throw error;
    }

    // レスポンスがなければページが作られたか判断できない。呼び出し側は確認を挟む。
    throw new NotionWriteUnknownError("Failed to create a Notion page.", 0);
  }

  if (!page.id || !page.url) {
    throw new NotionWriteUnknownError("Failed to create a Notion page.", 0);
  }

  return { pageId: page.id, url: page.url };
}

export async function appendNotionPageBlocks(input: {
  pageId: string;
  blocks: NotionPageBlock[];
  startIndex: number;
}) {
  const { apiKey } = getNotionConfig();
  const payloads = toNotionBlockPayloads(input.blocks);

  return appendBlockBatches(
    apiKey,
    input.pageId,
    payloads,
    Math.min(input.startIndex, payloads.length),
  );
}

// 接続先ワークスペースの 1 ファイル上限。無料は 5 MiB、有料は最大 5 GiB。
export async function getNotionWorkspaceFileLimit() {
  if (workspaceLimitCache && workspaceLimitCache.expiresAt > Date.now()) {
    return workspaceLimitCache.value;
  }

  const { apiKey } = getNotionConfig();
  const self = await notionRequest<NotionSelfResponse>(
    apiKey,
    "/users/me",
    { method: "GET" },
    NOTION_FILE_API_VERSION,
  );
  const reported = self.bot?.workspace_limits?.max_file_upload_size_in_bytes;
  const limit =
    typeof reported === "number" && reported > 0
      ? Math.min(reported, NOTION_MAX_FILE_BYTES)
      : NOTION_FREE_PLAN_MAX_FILE_BYTES;

  workspaceLimitCache = { value: limit, expiresAt: Date.now() + WORKSPACE_LIMIT_CACHE_MS };

  return limit;
}

export async function createNotionFileUpload(input: {
  filename: string;
  contentType: string;
  mode: "single_part" | "multi_part";
  partCount: number;
}) {
  const { apiKey } = getNotionConfig();
  const body: Record<string, unknown> = {
    mode: input.mode,
    filename: truncateFilename(input.filename),
    content_type: input.contentType,
  };

  if (input.mode === "multi_part") {
    body.number_of_parts = input.partCount;
  }

  const upload = await notionRequest<NotionFileUploadResponse>(
    apiKey,
    "/file_uploads",
    { method: "POST", body: JSON.stringify(body) },
    NOTION_FILE_API_VERSION,
  );

  if (!upload.id) {
    throw new NotionWriteError("Failed to start a Notion file upload.");
  }

  return { id: upload.id, uploadUrl: upload.upload_url ?? `/file_uploads/${upload.id}/send` };
}

export async function sendNotionFileUploadPart(input: {
  fileUploadId: string;
  filename: string;
  contentType: string;
  content: Buffer;
  partNumber?: number;
}) {
  const { apiKey } = getNotionConfig();
  const form = new FormData();

  if (input.partNumber !== undefined) {
    form.append("part_number", String(input.partNumber));
  }

  form.append(
    "file",
    new Blob([new Uint8Array(input.content)], { type: input.contentType || "application/octet-stream" }),
    truncateFilename(input.filename),
  );

  // Content-Type は boundary を含める必要があるため、fetch に自動設定させる。
  const response = await fetch(
    `https://api.notion.com/v1/file_uploads/${input.fileUploadId}/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": NOTION_FILE_API_VERSION,
      },
      body: form,
    },
  );
  const data = (await response.json().catch(() => ({}))) as NotionFileUploadResponse;

  if (!response.ok) {
    throw new NotionWriteError(data.message ?? "Failed to send a file to Notion.");
  }

  return { status: data.status ?? "" };
}

export async function completeNotionFileUpload(fileUploadId: string) {
  const { apiKey } = getNotionConfig();

  await notionRequest<NotionFileUploadResponse>(
    apiKey,
    `/file_uploads/${fileUploadId}/complete`,
    { method: "POST", body: JSON.stringify({}) },
    NOTION_FILE_API_VERSION,
  );
}
