import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  proposals: [] as Record<string, unknown>[], pages: [] as Record<string, unknown>[], revisions: [] as Record<string, unknown>[], canvases: [] as Record<string, unknown>[], next: 1,
  beforeClaim: undefined as (() => void) | undefined,
  // 別のリクエストが、ノートの書き込みの直前に割り込む。
  beforePageWrite: undefined as (() => void) | undefined,
  // 子ページの再帰問い合わせ（descendantIds）で、この ID の子を返す。
  childrenOf: undefined as string | undefined,
}));

// 条件に合う行だけを更新する、最小限のインメモリ DB。$transaction は例外が出たら変更を巻き戻す。
function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in (value as object)) return ((value as { in: unknown[] }).in).includes(row[key]);
    if (value && typeof value === "object" && "not" in (value as object)) return row[key] !== (value as { not: unknown }).not;
    return row[key] === value;
  });
}
function table(rows: () => Record<string, unknown>[], prefix: string, defaults: Record<string, unknown>) {
  return {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => rows().find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => rows().filter((row) => matches(row, where)),
    create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `${prefix}${db.next++}`, ...defaults, ...data }; rows().push(row); return row; },
    findUnique: async ({ where }: { where: Record<string, unknown> }) => rows().find((row) => matches(row, where)) ?? null,
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => Object.assign(rows().find((row) => matches(row, where))!, data),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      // 競合の再現用: 適用の権利を取る直前に、別のリクエストが割り込む。
      if (prefix === "prop" && where.status === "PENDING" && db.beforeClaim) { const hook = db.beforeClaim; db.beforeClaim = undefined; hook(); }
      if (prefix === "page" && db.beforePageWrite) { const hook = db.beforePageWrite; db.beforePageWrite = undefined; hook(); }
      const found = rows().filter((row) => matches(row, where));
      for (const row of found) for (const [key, value] of Object.entries(data)) {
        row[key] = value && typeof value === "object" && "increment" in (value as object) ? (row[key] as number) + (value as { increment: number }).increment : value;
      }
      return { count: found.length };
    },
  };
}
vi.mock("@/lib/prisma", () => {
  const prisma = {
    noteProposal: table(() => db.proposals, "prop", { status: "PENDING", messageId: null, appliedPageId: null, pageKind: "note", autoApplied: false, appliedVersion: null, revisionId: null }),
    notePage: table(() => db.pages, "page", { kind: "note", version: 0, deletedAt: null }),
    // ホワイトボード・スライドの本体。readCanvasData の条件（note: { userId, deletedAt }）はページの表で確かめる。
    noteCanvas: {
      findUnique: async ({ where }: { where: { noteId: string } }) => db.canvases.find((row) => row.noteId === where.noteId) ?? null,
      findFirst: async ({ where }: { where: { noteId: string; note: { userId: string } } }) => {
        const page = db.pages.find((row) => row.id === where.noteId && row.userId === where.note.userId && row.deletedAt === null);
        return page ? db.canvases.find((row) => row.noteId === where.noteId) ?? null : null;
      },
      upsert: async ({ where, create, update }: { where: { noteId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const found = db.canvases.find((row) => row.noteId === where.noteId);
        if (found) return Object.assign(found, update);
        db.canvases.push({ ...create });
        return create;
      },
    },
    storedFile: { updateMany: async () => ({ count: 0 }) },
    // lockNoteOrder（アドバイザリーロック）と descendantIds（子ページの再帰問い合わせ）。
    $executeRaw: async () => 0,
    $queryRaw: async () => db.pages.filter((row) => row.parentId === db.childrenOf).map((row) => ({ id: row.id })),
    // 履歴: createdAt の新しい順は、作った順（seq）の新しい順で代用する。
    noteRevision: {
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `rev${db.next++}`, seq: db.next, ...data }; db.revisions.push(row); return row; },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => db.revisions.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where, skip = 0 }: { where: Record<string, unknown>; skip?: number }) => db.revisions.filter((row) => matches(row, where)).sort((a, b) => (b.seq as number) - (a.seq as number)).slice(skip),
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => { const found = db.revisions.filter((row) => matches(row, where)); db.revisions.splice(0, db.revisions.length, ...db.revisions.filter((row) => !found.includes(row))); return { count: found.length }; },
    },
    $transaction: async (fn: (tx: unknown) => unknown) => {
      const snapshot = JSON.stringify({ p: db.proposals, g: db.pages, r: db.revisions, c: db.canvases });
      try { return await fn(prisma); } catch (error) {
        const restored = JSON.parse(snapshot);
        db.proposals.splice(0, db.proposals.length, ...restored.p);
        db.pages.splice(0, db.pages.length, ...restored.g);
        db.revisions.splice(0, db.revisions.length, ...restored.r);
        db.canvases.splice(0, db.canvases.length, ...restored.c);
        throw error;
      }
    },
  };
  return { prisma, databaseSchema: "notefable" };
});
// ホワイトボード・スライドの枠組みは、テスト用の偽アダプター（スライド）で確かめる。ノートは本物のアダプター。
vi.mock("@/lib/page-ai/registry", async () => {
  const { noteAdapter } = await import("./note-adapter");
  const { fakeSlidesAdapter } = await import("./fake-adapter");
  const adapters = { note: noteAdapter, whiteboard: noteAdapter, slides: fakeSlidesAdapter() };
  return { PAGE_ADAPTERS: adapters, adapterFor: (kind: keyof typeof adapters) => adapters[kind], allAdapters: () => Object.values(adapters) };
});
import { applyProposal, attachProposals, discardProposal, proposalImage, proposalsByMessage, saveProposal, undoProposal, type SaveInput } from "./proposals";
import { FAKE_PNG_BASE64 } from "./fake-adapter";

const para = (text: string) => ({ id: text, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const edit = (pageId: string, baseVersion: number): SaveInput => ({
  kind: "EDIT", pageKind: "note", page: { id: pageId, title: "Notes", version: baseVersion },
  draft: { changes: [{ op: "replace", block: 1, before: "a", after: "b" }], proposed: { title: "Renamed", blocks: [para("b")] } },
});
const create = (): Extract<SaveInput, { kind: "CREATE" }> => ({
  kind: "CREATE", pageKind: "note",
  draft: { title: "New", icon: "📚", content: "hello", proposed: { title: "New", icon: "📚", blocks: [para("hello")] } },
});
const reset = () => {
  db.proposals.length = 0; db.pages.length = 0; db.revisions.length = 0; db.canvases.length = 0; db.next = 1;
  db.beforeClaim = undefined; db.beforePageWrite = undefined; db.childrenOf = undefined;
};

describe("note proposals", () => {
  beforeEach(reset);
  const seedPage = (userId = "u1", version = 3) => { db.pages.push({ kind: "note", id: "pg", userId, title: "Notes", icon: "📚", blocks: [para("a")], version, deletedAt: null }); return "pg"; };

  it("saves a pending proposal and returns it in the card shape", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    expect(view).toMatchObject({ kind: "proposal", status: "pending", pageId: "pg", baseVersion: 3, appliedPageId: null });
    expect(db.proposals[0]).toMatchObject({ userId: "u1", sessionId: "s1", kind: "EDIT", status: "PENDING" });
  });

  it("keeps the full blocks out of what is sent to the browser but stores them", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    expect(view.proposed.blocks).toEqual([]);
    expect((db.proposals[0].payload as { proposed: { blocks: unknown[] } }).proposed.blocks).toHaveLength(1);
  });

  it("does not report success when another request discarded the proposal just before the claim", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    db.beforeClaim = () => { db.proposals[0].status = "DISCARDED"; };
    const result = await applyProposal("u1", view.id);
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(db.pages[0].version).toBe(3);
    expect(db.pages[0].title).toBe("Notes");
  });

  it("returns the winner's result when another request applied the edit just before the claim", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    db.beforeClaim = () => { db.proposals[0].status = "APPLIED"; db.pages[0].version = 4; db.pages[0].title = "Renamed"; };
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: true, kind: "edit", page: { version: 4 } });
    expect(db.pages[0].version).toBe(4);
  });

  it("returns the same created note to a request that lost the claim", async () => {
    const view = await saveProposal("u1", "s1", create());
    db.beforeClaim = () => { db.pages.push({ kind: "note", id: "winner", userId: "u1", title: "New", blocks: [], version: 0, deletedAt: null }); db.proposals[0].status = "APPLIED"; db.proposals[0].appliedPageId = "winner"; };
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: true, kind: "create", page: { id: "winner" } });
    expect(db.pages).toHaveLength(1);
  });

  it("refuses a stored proposal whose data is malformed instead of writing with missing filters", async () => {
    const bad = await saveProposal("u1", "s1", create());
    db.proposals[0] = { ...db.proposals[0], kind: "EDIT", payload: { pageTitle: "x", changes: [], proposed: { title: "t", blocks: [] } } };
    seedPage();
    expect(await applyProposal("u1", bad.id)).toMatchObject({ ok: false, httpStatus: 409 });
    expect(db.pages[0].version).toBe(3);
    expect(db.proposals[0].status).toBe("PENDING");
  });

  it("applies an edit once with a version bump, and a retry returns the same result without writing again", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    const first = await applyProposal("u1", view.id);
    expect(first).toMatchObject({ ok: true, status: "applied", kind: "edit", page: { title: "Renamed", version: 4 } });
    const second = await applyProposal("u1", view.id);
    expect(second).toMatchObject({ ok: true, page: { version: 4 } });
    expect(db.pages[0].version).toBe(4);
    expect(db.proposals[0].status).toBe("APPLIED");
  });

  it("rejects an edit when the note changed since the proposal and leaves the proposal pending", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage("u1", 5), 3));
    const result = await applyProposal("u1", view.id);
    expect(result).toMatchObject({ ok: false, httpStatus: 409, error: expect.stringContaining("changed after the proposal") });
    expect(db.proposals[0].status).toBe("PENDING");
    expect(db.pages[0].version).toBe(5);
  });

  it("reports a deleted note as 404", async () => {
    const view = await saveProposal("u1", "s1", edit("gone", 0));
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.proposals[0].status).toBe("PENDING");
  });

  it("creates a note once even if apply is sent twice, then returns the same note", async () => {
    const view = await saveProposal("u1", "s1", create());
    const first = await applyProposal("u1", view.id);
    const second = await applyProposal("u1", view.id);
    expect(first).toMatchObject({ ok: true, kind: "create", page: { title: "New", icon: "📚", userId: "u1" } });
    expect(db.pages).toHaveLength(1);
    expect(second).toMatchObject({ ok: true, page: { id: db.pages[0].id } });
    expect((first as { page: { id: string } }).page.id).toBe((second as { page: { id: string } }).page.id);
    expect(db.proposals[0]).toMatchObject({ status: "APPLIED", appliedPageId: db.pages[0].id });
  });

  it("applies concurrent requests only once", async () => {
    const view = await saveProposal("u1", "s1", create());
    await Promise.all([applyProposal("u1", view.id), applyProposal("u1", view.id), applyProposal("u1", view.id)]);
    expect(db.pages).toHaveLength(1);
  });

  it("does not let another user read, apply or discard a proposal", async () => {
    const view = await saveProposal("u1", "s1", create());
    expect(await applyProposal("u2", view.id)).toMatchObject({ ok: false, httpStatus: 404 });
    expect(await discardProposal("u2", view.id)).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.pages).toHaveLength(0);
    expect(db.proposals[0].status).toBe("PENDING");
    expect((await proposalsByMessage("u2", "s1")).size).toBe(0);
  });

  it("discards a pending proposal and refuses to apply it afterwards", async () => {
    const view = await saveProposal("u1", "s1", create());
    expect(await discardProposal("u1", view.id)).toEqual({ ok: true, status: "discarded" });
    expect(await discardProposal("u1", view.id)).toEqual({ ok: true, status: "discarded" });
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 409 });
    expect(db.pages).toHaveLength(0);
  });

  it("cannot discard what was already applied", async () => {
    const view = await saveProposal("u1", "s1", create());
    await applyProposal("u1", view.id);
    expect(await discardProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 409 });
  });

  it("re-validates stored content before writing it", async () => {
    const view = await saveProposal("u1", "s1", { ...create(), draft: { ...create().draft, proposed: { title: "x".repeat(300), icon: null, blocks: [] } } });
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.pages).toHaveLength(0);
    expect(db.proposals[0].status).toBe("PENDING");
  });

  it("groups saved proposals by the answer they were attached to, with their state", async () => {
    const a = await saveProposal("u1", "s1", create());
    const b = await saveProposal("u1", "s1", edit(seedPage(), 3));
    await saveProposal("u1", "s1", create()); // 紐付かなかった提案は履歴に出さない
    await attachProposals("u1", [a.id, b.id], "m1");
    await applyProposal("u1", a.id);
    const grouped = await proposalsByMessage("u1", "s1");
    expect([...grouped.keys()]).toEqual(["m1"]);
    expect(grouped.get("m1")!.map((view) => [view.kind, view.status])).toEqual([["create_proposal", "applied"], ["proposal", "pending"]]);
  });
});

describe("note proposals and the trash / edit history", () => {
  beforeEach(reset);
  const seedPage = (extra: Record<string, unknown> = {}) => { db.pages.push({ kind: "note", id: "pg", userId: "u1", title: "Notes", icon: "📚", blocks: [para("a")], version: 3, deletedAt: null, ...extra }); return "pg"; };

  it("keeps the state it overwrites as an AI_EDIT revision when an edit is applied", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    const result = await applyProposal("u1", view.id);
    expect(result).toMatchObject({ ok: true, kind: "edit", page: { title: "Renamed", version: 4 } });
    expect(db.revisions).toHaveLength(1);
    expect(db.revisions[0]).toMatchObject({ noteId: "pg", userId: "u1", reason: "AI_EDIT", title: "Notes", icon: "📚", version: 3, blocks: [para("a")] });
  });

  it("adds no second revision when the same apply is sent again or sent concurrently", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    await Promise.all([applyProposal("u1", view.id), applyProposal("u1", view.id), applyProposal("u1", view.id)]);
    await applyProposal("u1", view.id);
    expect(db.revisions).toHaveLength(1);
    expect(db.pages[0].version).toBe(4);
  });

  it("never applies a note edit to a whiteboard or slide deck: 409, nothing written, the proposal stays pending", async () => {
    for (const [kind, error] of [["whiteboard", "This page is a whiteboard, not a note."], ["slides", "This page is a slide deck, not a note."]] as const) {
      db.pages.length = 0; db.proposals.length = 0;
      const view = await saveProposal("u1", "s1", edit(seedPage({ kind, blocks: [] }), 3));
      expect(await applyProposal("u1", view.id)).toEqual({ ok: false, httpStatus: 409, error });
      expect(db.pages[0]).toMatchObject({ title: "Notes", version: 3, blocks: [] });
      expect(db.revisions).toHaveLength(0);
      expect(db.proposals[0].status).toBe("PENDING");
    }
  });

  it("rolls the revision back together with the apply when the write loses a race", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    // 履歴を残した直後、書き込みの前に別のタブが保存して版が進む。
    db.beforePageWrite = () => { db.pages[0].version = 4; };
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 409, error: expect.stringContaining("changed after the proposal") });
    expect(db.revisions).toHaveLength(0);
    expect(db.proposals[0].status).toBe("PENDING");
    // 他のタブの保存は、このインメモリ DB では同じトランザクション内の変更として巻き戻る。編集が書かれていないことだけを確かめる。
    expect(db.pages[0].title).toBe("Notes");
  });

  it("does not create a revision when the note changed since the proposal", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage({ version: 5 }), 3));
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 409 });
    expect(db.revisions).toHaveLength(0);
  });

  it("never edits a trashed note: 404, the proposal stays pending, no revision", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage({ deletedAt: new Date() }), 3));
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.proposals[0].status).toBe("PENDING");
    expect(db.pages[0]).toMatchObject({ title: "Notes", version: 3 });
    expect(db.revisions).toHaveLength(0);
  });

  it("treats a note trashed after the edit was applied as gone when the apply is retried", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    await applyProposal("u1", view.id);
    db.pages[0].deletedAt = new Date();
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it("keeps only the newest 20 AI-edit revisions of a note, without touching auto-saves", async () => {
    seedPage();
    db.revisions.push({ id: "auto1", seq: 0, noteId: "pg", userId: "u1", reason: "AUTO", title: "Earlier", icon: null, blocks: [], version: 1, createdAt: new Date() });
    for (let version = 3; version < 3 + 52; version += 1) {
      db.pages[0].version = version;
      const view = await saveProposal("u1", "s1", edit("pg", version));
      await applyProposal("u1", view.id);
    }
    const marked = db.revisions.filter((row) => row.reason === "AI_EDIT");
    expect(marked).toHaveLength(20);
    const versions = marked.map((row) => row.version as number);
    expect(Math.min(...versions)).toBe(35);
    expect(Math.max(...versions)).toBe(54);
    expect(db.revisions.some((row) => row.id === "auto1")).toBe(true);
  });
});

describe("auto-apply and undo", () => {
  beforeEach(reset);
  const seedPage = (extra: Record<string, unknown> = {}) => { db.pages.push({ kind: "note", id: "pg", userId: "u1", title: "Notes", icon: "📚", blocks: [para("a")], version: 3, deletedAt: null, ...extra }); return "pg"; };

  it("marks an auto-applied proposal, offers undo, and marks the page as written by the AI", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    expect(await applyProposal("u1", view.id, { auto: true })).toMatchObject({ ok: true });
    expect(db.proposals[0]).toMatchObject({ status: "APPLIED", autoApplied: true, appliedPageId: "pg", appliedVersion: 4, revisionId: db.revisions[0].id });
    expect(db.pages[0].aiUpdatedAt).toBeInstanceOf(Date);
    await attachProposals("u1", [view.id], "m1");
    const [shown] = (await proposalsByMessage("u1", "s1")).get("m1")!;
    expect(shown).toMatchObject({ status: "applied", autoApplied: true, undoable: true, pageKind: "note" });
  });

  it("undoes an applied edit by restoring the state before it, keeping the AI version in the history", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    await applyProposal("u1", view.id);
    const aiStamp = db.pages[0].aiUpdatedAt;
    const undone = await undoProposal("u1", view.id);
    expect(undone).toMatchObject({ ok: true, status: "undone", kind: "edit", page: { title: "Notes", version: 5, blocks: [para("a")] } });
    expect(db.revisions.map((row) => [row.reason, row.title, row.version])).toEqual([["AI_EDIT", "Notes", 3], ["RESTORE", "Renamed", 4]]);
    expect(db.proposals[0].status).toBe("UNDONE");
    // 元に戻すのは AI の書き込みではない（AI が書いた目印はそのまま）。
    expect(db.pages[0].aiUpdatedAt).toBe(aiStamp);
    // もう一度押しても同じ結果で、二重に戻さない。
    expect(await undoProposal("u1", view.id)).toMatchObject({ ok: true, status: "undone", page: { version: 5 } });
    expect(db.revisions).toHaveLength(2);
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 409 });
  });

  it("refuses to undo when the page changed after the AI edit, a pending proposal, or an old proposal without the applied version", async () => {
    const view = await saveProposal("u1", "s1", edit(seedPage(), 3));
    expect(await undoProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 409 });
    await applyProposal("u1", view.id);
    db.pages[0].version = 5;
    expect(await undoProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 409, error: expect.stringContaining("page history") });
    expect(db.proposals[0].status).toBe("APPLIED");
    expect(db.pages[0]).toMatchObject({ title: "Renamed", version: 5 });
    db.proposals[0].appliedVersion = null;
    expect(await undoProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 409, error: expect.stringContaining("be undone here") });
    expect(await undoProposal("u2", view.id)).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it("undoes a created page by moving it and its sub-pages to the trash", async () => {
    const view = await saveProposal("u1", "s1", create());
    await applyProposal("u1", view.id, { auto: true });
    const pageId = db.pages[0].id as string;
    expect(db.pages[0].aiUpdatedAt).toBeInstanceOf(Date);
    db.pages.push({ kind: "note", id: "child", userId: "u1", title: "Child", blocks: [], version: 0, deletedAt: null, parentId: pageId });
    db.childrenOf = pageId;
    const undone = await undoProposal("u1", view.id);
    expect(undone).toEqual({ ok: true, status: "undone", kind: "create", trashedIds: [pageId, "child"] });
    expect(db.pages.every((row) => row.deletedAt instanceof Date)).toBe(true);
    expect(db.proposals[0].status).toBe("UNDONE");
  });

  it("creates a sub-page inside the requested parent", async () => {
    db.pages.push({ kind: "note", id: "parent", userId: "u1", title: "Parent", blocks: [], version: 0, deletedAt: null, groupId: "g1" });
    const view = await saveProposal("u1", "s1", { ...create(), draft: { ...create().draft, parentId: "parent" }, parentTitle: "Parent" });
    expect(view).toMatchObject({ parentId: "parent", parentTitle: "Parent" });
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: true, page: { parentId: "parent", groupId: "g1" } });
  });
});

describe("proposals for other page kinds (fake slides adapter)", () => {
  beforeEach(reset);
  const deck = (texts: string[]) => ({ slides: texts.map((text, index) => ({ id: `s${index + 1}`, elements: [{ id: `s${index + 1}-title`, type: "text", text }] })) });
  const seedDeck = () => {
    db.pages.push({ kind: "slides", id: "deck", userId: "u1", title: "Deck", icon: null, blocks: [], version: 2, deletedAt: null });
    db.canvases.push({ noteId: "deck", data: deck(["Intro", "End"]), segments: [], hash: "h", size: 10 });
  };
  const slidesEdit = (data = deck(["Welcome", "End"])): SaveInput => ({
    kind: "EDIT", pageKind: "slides", page: { id: "deck", title: "Deck", version: 2 },
    draft: {
      changes: [{ op: "update", block: 0, target: { type: "slide", number: 1 }, before: "Intro", after: "Welcome" }],
      proposed: { title: "Deck", data },
      images: [{ change: 0, side: "after", mimeType: "image/png", base64: FAKE_PNG_BASE64 }],
    },
  });

  it("keeps the canvas data and thumbnails on the server and gives the card image URLs", async () => {
    seedDeck();
    const view = await saveProposal("u1", "s1", slidesEdit());
    expect(view).toMatchObject({ kind: "proposal", pageKind: "slides", proposed: { title: "Deck", blocks: [] } });
    expect(JSON.stringify(view)).not.toContain(FAKE_PNG_BASE64);
    expect(JSON.stringify(view)).not.toContain("s1-title");
    const [change] = (view as { changes: Record<string, unknown>[] }).changes;
    expect(change).toMatchObject({ target: { type: "slide", number: 1 }, afterImage: `/api/proposals/${view.id}/image?change=0&side=after` });
    expect(change).not.toHaveProperty("beforeImage");
    expect(await proposalImage("u1", view.id, 0, "after")).toMatchObject({ mimeType: "image/png" });
    expect(await proposalImage("u2", view.id, 0, "after")).toBeNull();
    expect(await proposalImage("u1", view.id, 0, "before")).toBeNull();
  });

  it("applies a slides edit with the same checks as a save, keeps the old deck as an AI_EDIT revision, and undoes it", async () => {
    seedDeck();
    const view = await saveProposal("u1", "s1", slidesEdit());
    const applied = await applyProposal("u1", view.id);
    expect(applied).toMatchObject({ ok: true, kind: "edit", page: { id: "deck", version: 3, data: deck(["Welcome", "End"]) } });
    expect(db.canvases[0]).toMatchObject({ data: deck(["Welcome", "End"]), segments: [{ id: "s1", text: "Welcome" }, { id: "s2", text: "End" }] });
    expect(db.revisions[0]).toMatchObject({ reason: "AI_EDIT", version: 2, blocks: [], data: deck(["Intro", "End"]) });
    expect(await undoProposal("u1", view.id)).toMatchObject({ ok: true, page: { version: 4, data: deck(["Intro", "End"]) } });
    expect(db.revisions[1]).toMatchObject({ reason: "RESTORE", version: 3, data: deck(["Welcome", "End"]) });
  });

  it("never writes a slides edit into a note, nor invalid canvas data", async () => {
    seedDeck();
    db.pages[0].kind = "note";
    const view = await saveProposal("u1", "s1", slidesEdit());
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 409 });
    expect(db.revisions).toHaveLength(0);
    reset();
    seedDeck();
    const bad = await saveProposal("u1", "s1", slidesEdit({ slides: [{ id: "a" }, { id: "a" }] } as never));
    expect(await applyProposal("u1", bad.id)).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.canvases[0].data).toEqual(deck(["Intro", "End"]));
  });

  it("creates a slide deck with its canvas data", async () => {
    const view = await saveProposal("u1", "s1", { kind: "CREATE", pageKind: "slides", draft: { title: "Plan", icon: null, content: "Slide 1: A", proposed: { title: "Plan", icon: null, data: deck(["A"]) } } });
    const applied = await applyProposal("u1", view.id, { auto: true });
    expect(applied).toMatchObject({ ok: true, kind: "create", page: { kind: "slides", title: "Plan", blocks: [], data: deck(["A"]) } });
    expect(db.canvases).toHaveLength(1);
  });
});

describe("payload checks", () => {
  beforeEach(reset);

  it("does not create a sub-page under a parent that went to the Trash, and keeps the proposal pending", async () => {
    db.pages.push({ kind: "note", id: "parent", userId: "u1", title: "Parent", blocks: [], version: 0, deletedAt: new Date() });
    const view = await saveProposal("u1", "s1", { ...create(), draft: { ...create().draft, parentId: "parent" } });
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.pages).toHaveLength(1);
    expect(db.proposals[0].status).toBe("PENDING");
  });

  it("refuses content of the wrong shape for the page kind instead of writing an empty page", async () => {
    db.pages.push({ kind: "slides", id: "deck", userId: "u1", title: "Deck", icon: null, blocks: [], version: 2, deletedAt: null });
    const view = await saveProposal("u1", "s1", { kind: "EDIT", pageKind: "slides", page: { id: "deck", title: "Deck", version: 2 }, draft: { changes: [], proposed: { title: "Deck", blocks: [] } } });
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 409 });
    expect(db.pages[0].version).toBe(2);
  });

  it("checks the icon of a new slide deck like a save does", async () => {
    const view = await saveProposal("u1", "s1", { kind: "CREATE", pageKind: "slides", draft: { title: "Plan", icon: "not an emoji", content: "", proposed: { title: "Plan", icon: "not an emoji", data: { slides: [] } } } });
    expect(await applyProposal("u1", view.id)).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.pages).toHaveLength(0);
  });
});
