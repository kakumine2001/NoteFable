import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  append: vi.fn(),
  createPage: vi.fn(),
  update: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/lib/notion", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/notion")>();
  return {
    ...original,
    appendNotionPageBlocks: mocks.append,
    createNotionPageShell: mocks.createPage,
  };
});
vi.mock("@/lib/notion-saves", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/notion-saves")>();
  return {
    ...original,
    loadOwnedNotionSave: mocks.load,
    releaseNotionStaging: mocks.release,
  };
});
vi.mock("@/lib/auth", () => ({ getOrCreateAnonymousUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { notionSave: { update: mocks.update } } }));

import { NextRequest } from "next/server";
import { NotionWriteUnknownError } from "@/lib/notion";
import { POST } from "./route";

function request(body = {}) {
  return new NextRequest("http://localhost/api/notion/saves/save/finalize", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ saveId: "save" }) };

function save(overrides: Record<string, unknown> = {}) {
  return {
    id: "save",
    status: "TRANSFERRING",
    title: "Title",
    blocks: [{ type: "text", text: "Body" }],
    files: [],
    notionPageId: "page",
    notionPageUrl: "https://notion.so/page",
    notionBlocksWritten: 0,
    pageCreationUnknown: false,
    appendResultUnknown: false,
    ...overrides,
  };
}

describe("Notion finalize unknown append", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
    mocks.release.mockResolvedValue(undefined);
    mocks.createPage.mockResolvedValue({ pageId: "page", url: "https://notion.so/page" });
  });

  it("records an uncertain append and requires confirmation before another write", async () => {
    mocks.load.mockResolvedValueOnce(save());
    mocks.append.mockRejectedValueOnce(new NotionWriteUnknownError("Unknown", 100));

    const first = await POST(request(), context);
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ code: "APPEND_WRITE_UNKNOWN", needsConfirmation: true });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ appendResultUnknown: true, pageCreationUnknown: false, notionBlocksWritten: 100 }),
    }));

    mocks.load.mockResolvedValueOnce(save({ appendResultUnknown: true }));
    const retry = await POST(request(), context);
    expect(retry.status).toBe(409);
    expect(mocks.append).toHaveBeenCalledTimes(1);
  });

  it("resumes from confirmed progress only after explicit append confirmation", async () => {
    mocks.load.mockResolvedValueOnce(save({ appendResultUnknown: true, notionBlocksWritten: 100 }));
    mocks.append.mockResolvedValueOnce(101);
    const response = await POST(request({ confirmAppendRetry: true }), context);
    expect(response.status).toBe(200);
    expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({ startIndex: 100 }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ appendResultUnknown: false, status: "COMPLETED" }),
    }));
  });

  it("identifies an unknown append after creating a page", async () => {
    mocks.load.mockResolvedValueOnce(save({ notionPageId: null, notionPageUrl: null }));
    mocks.append.mockRejectedValueOnce(new NotionWriteUnknownError("Unknown", 0));

    const response = await POST(request(), context);
    expect(await response.json()).toMatchObject({ code: "APPEND_WRITE_UNKNOWN" });
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ appendResultUnknown: true, pageCreationUnknown: false }),
    }));
  });

  it("does not finalize a cancelled save", async () => {
    mocks.load.mockResolvedValueOnce(save({ status: "CANCELLED" }));
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(mocks.append).not.toHaveBeenCalled();
  });
});
