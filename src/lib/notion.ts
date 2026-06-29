import { optionalEnv } from "@/lib/env";

const NOTION_API_VERSION = "2022-06-28";
const NOTION_TEXT_CHUNK_SIZE = 1900;
const NOTION_BLOCK_BATCH_SIZE = 100;

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

type NotionCreatePageResponse = {
  id?: string;
  url?: string;
  message?: string;
};

type NotionDatabaseResponse = {
  properties?: Record<string, { type?: string }>;
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

  for (let index = 0; index < value.length; index += NOTION_TEXT_CHUNK_SIZE) {
    chunks.push(value.slice(index, index + NOTION_TEXT_CHUNK_SIZE));
  }

  return chunks.length ? chunks : [""];
}

function toRichText(value: string): NotionRichText[] {
  return splitText(value).map((content) => ({
    type: "text",
    text: { content },
  }));
}

function toParagraphBlocks(content: string): NotionParagraphBlock[] {
  // 空行を段落境界にし、Notion 側で読みやすい単位に分ける。
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.map((paragraph) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: toRichText(paragraph),
    },
  }));
}

async function notionRequest<T>(
  apiKey: string,
  path: string,
  init: RequestInit,
) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
      ...init.headers,
    },
  });

  const data = (await response.json().catch(() => ({}))) as T & { message?: string };

  if (!response.ok) {
    throw new NotionWriteError(data.message);
  }

  return data;
}

export async function createNotionPage(input: { title: string; content: string }) {
  const { apiKey, databaseId } = getNotionConfig();
  const database = await notionRequest<NotionDatabaseResponse>(apiKey, `/databases/${databaseId}`, {
    method: "GET",
  });
  const titlePropertyName = Object.entries(database.properties ?? {}).find(
    ([, property]) => property.type === "title",
  )?.[0];

  if (!titlePropertyName) {
    throw new NotionWriteError("Notion database title property was not found.");
  }

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
