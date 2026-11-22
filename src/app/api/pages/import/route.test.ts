import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findGroup: vi.fn(),
  createPage: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getOrCreateUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/note-embeddings", () => ({ scheduleNoteEmbeddingSync: mocks.schedule }));
vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    noteGroup: { findFirst: mocks.findGroup },
    notePage: { create: mocks.createPage },
  };
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  return { prisma };
});

import { POST } from "./route";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/pages/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pages/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findGroup.mockResolvedValue({ id: "g1" });
    mocks.createPage.mockImplementation(async ({ data }: { data: { title: string; groupId: string | null } }) => ({
      id: `page-${data.title}`,
      title: data.title,
      groupId: data.groupId,
      parentId: null,
      icon: null,
      position: 0,
      version: 0,
      favoritedAt: null,
      fullWidth: false,
      smallText: false,
      font: "default",
      locked: false,
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
    }));
  });

  it("imports one or more Markdown files into notes", async () => {
    const response = await POST(jsonRequest({
      files: [
        { name: "ideas.md", markdown: "# Great Ideas\n\n- Build split view\n" },
        { name: "todo.txt", markdown: "- [ ] Test dark mode" },
      ],
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.pages.map((p: { title: string }) => p.title)).toEqual(["Great Ideas", "todo"]);
    expect(mocks.createPage).toHaveBeenCalledTimes(2);
    // 取り込んだノートも意味検索に出るよう、索引の作成を頼む。
    expect(mocks.schedule).toHaveBeenCalledWith("user-1", ["page-Great Ideas", "page-todo"]);
  });

  it("rejects empty file lists, too many files, and non-markdown extensions", async () => {
    expect((await POST(jsonRequest({ files: [] }))).status).toBe(400);
    expect((await POST(jsonRequest({ files: Array.from({ length: 21 }, (_, i) => ({ name: `${i}.md`, markdown: "hi" })) }))).status).toBe(400);
    expect((await POST(jsonRequest({ files: [{ name: "malware.html", markdown: "<script>" }] }))).status).toBe(400);
    expect(mocks.createPage).not.toHaveBeenCalled();
  });

  it("rejects a file that does not fit in one note instead of dropping its end", async () => {
    const response = await POST(jsonRequest({
      files: [
        { name: "short.md", markdown: "ok" },
        { name: "long.md", markdown: Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n\n") },
      ],
    }));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe("File is too long for one note: long.md");
    // 1 件でも収まらなければ、どのノートも作らない。
    expect(mocks.createPage).not.toHaveBeenCalled();
  });

  it("checks group ownership when groupId is provided", async () => {
    mocks.findGroup.mockResolvedValue(null);
    const response = await POST(jsonRequest({
      groupId: "other-users-group",
      files: [{ name: "a.md", markdown: "hello" }],
    }));
    expect(response.status).toBe(404);
    expect(mocks.createPage).not.toHaveBeenCalled();
  });
});
