import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  proposals: [] as Record<string, unknown>[], pages: [] as Record<string, unknown>[], revisions: [] as Record<string, unknown>[], next: 1,
  beforeClaim: undefined as (() => void) | undefined,
  // 別のリクエストが、ノートの書き込みの直前に割り込む。
  beforePageWrite: undefined as (() => void) | undefined,
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
    noteProposal: table(() => db.proposals, "prop", { status: "PENDING", messageId: null, appliedPageId: null }),
    notePage: table(() => db.pages, "page", { version: 0, deletedAt: null }),
    // 履歴: createdAt の新しい順は、作った順（seq）の新しい順で代用する。
    noteRevision: {
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `rev${db.next++}`, seq: db.next, ...data }; db.revisions.push(row); return row; },
      findMany: async ({ where, skip = 0 }: { where: Record<string, unknown>; skip?: number }) => db.revisions.filter((row) => matches(row, where)).sort((a, b) => (b.seq as number) - (a.seq as number)).slice(skip),
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => { const found = db.revisions.filter((row) => matches(row, where)); db.revisions.splice(0, db.revisions.length, ...db.revisions.filter((row) => !found.includes(row))); return { count: found.length }; },
    },
    $transaction: async (fn: (tx: unknown) => unknown) => {
      const snapshot = JSON.stringify({ p: db.proposals, g: db.pages, r: db.revisions });
      try { return await fn(prisma); } catch (error) {
        const restored = JSON.parse(snapshot);
        db.proposals.splice(0, db.proposals.length, ...restored.p);
        db.pages.splice(0, db.pages.length, ...restored.g);
        db.revisions.splice(0, db.revisions.length, ...restored.r);
        throw error;
      }
    },
  };
  return { prisma, databaseSchema: "notefable" };
});
import { applyProposal, attachProposals, discardProposal, proposalsByMessage, saveProposal } from "./note-proposals";

const para = (text: string) => ({ id: text, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const edit = (pageId: string, baseVersion: number) => ({
  kind: "EDIT" as const,
  payload: { pageId, pageTitle: "Notes", baseVersion, changes: [{ op: "replace" as const, block: 1, before: "a", after: "b" }], proposed: { title: "Renamed", blocks: [para("b")] } },
});
const create = () => ({
  kind: "CREATE" as const,
  payload: { title: "New", icon: "📚", content: "hello", proposed: { title: "New", icon: "📚", blocks: [para("hello")] } },
});

describe("note proposals", () => {
  beforeEach(() => { db.proposals.length = 0; db.pages.length = 0; db.revisions.length = 0; db.next = 1; db.beforeClaim = undefined; db.beforePageWrite = undefined; });
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
    const bad = await saveProposal("u1", "s1", { kind: "EDIT", payload: { pageTitle: "x", changes: [], proposed: { title: "t", blocks: [] } } as never });
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
    const view = await saveProposal("u1", "s1", { ...create(), payload: { ...create().payload, proposed: { title: "x".repeat(300), icon: null, blocks: [] } } });
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
  beforeEach(() => { db.proposals.length = 0; db.pages.length = 0; db.revisions.length = 0; db.next = 1; db.beforeClaim = undefined; db.beforePageWrite = undefined; });
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
