import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proposal: vi.fn(), message: vi.fn(), page: vi.fn(), proposals: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  databaseSchema: "notefable",
  prisma: { noteProposal: { findFirst: mocks.proposal, findMany: mocks.proposals }, message: { findFirst: mocks.message }, notePage: { findFirst: mocks.page } },
}));
vi.mock("@/lib/email-login", () => ({ sendEmail: vi.fn() }));
vi.mock("@/components/legal-page", () => ({ LEGAL_CONTACT_EMAIL: "owner@example.com" }));
import { findReportedPage, findReportedProposal, parseReport } from "./answer-report";

describe("reporting AI content", () => {
  beforeEach(() => vi.clearAllMocks());

  it("takes exactly one target", () => {
    expect(parseReport({ proposalId: "p1", reason: " x " })).toEqual({ ok: true, data: { target: { kind: "proposal", id: "p1" }, reason: "x" } });
    expect(parseReport({ pageId: "pg" })).toEqual({ ok: true, data: { target: { kind: "page", id: "pg" }, reason: "" } });
    expect(parseReport({ pageId: "pg", proposalId: "p1" })).toEqual({ ok: false });
    expect(parseReport({ pageId: "" })).toEqual({ ok: false });
    expect(parseReport({})).toEqual({ ok: false });
  });

  it("reads a slide image target: a slide deck with one of its elements", () => {
    expect(parseReport({ pageId: "pg", elementId: "img1", reason: " ugly " })).toEqual({ ok: true, data: { target: { kind: "slideImage", pageId: "pg", elementId: "img1" }, reason: "ugly" } });
    // 要素はスライドのページと一緒にだけ。長さの上限は回答・ページと別（ページ 64、要素 120）。
    expect(parseReport({ messageId: "m1", elementId: "img1" })).toEqual({ ok: false });
    expect(parseReport({ proposalId: "p1", elementId: "img1" })).toEqual({ ok: false });
    expect(parseReport({ pageId: "pg", elementId: "" })).toEqual({ ok: false });
    expect(parseReport({ pageId: "pg", elementId: 3 })).toEqual({ ok: false });
    expect(parseReport({ pageId: "x".repeat(65), elementId: "img1" })).toEqual({ ok: false });
    expect(parseReport({ pageId: "pg", elementId: "e".repeat(121) })).toEqual({ ok: false });
    expect(parseReport({ pageId: "pg", elementId: "e".repeat(120) })).toMatchObject({ ok: true });
  });

  it("finds only the user's own proposal, with the model of its answer", async () => {
    mocks.proposal.mockResolvedValue({ id: "p1", sessionId: "s1", messageId: "m1", kind: "EDIT", status: "APPLIED", pageKind: "note", autoApplied: false, payload: {}, createdAt: new Date() });
    mocks.message.mockResolvedValue({ model: "luna" });
    expect(await findReportedProposal("u1", "p1")).toMatchObject({ id: "p1", model: "luna" });
    expect(mocks.proposal.mock.calls[0][0].where).toEqual({ id: "p1", userId: "u1" });
    expect(mocks.message.mock.calls[0][0].where).toEqual({ id: "m1", sessionId: "s1" });
    mocks.proposal.mockResolvedValue(null);
    expect(await findReportedProposal("u2", "p1")).toBeNull();
  });

  it("finds only a live page of the user that the AI wrote, with its text and the AI changes applied to it", async () => {
    mocks.page.mockResolvedValue({ id: "pg", kind: "slides", title: "Deck", blocks: [], aiUpdatedAt: new Date(), canvas: { segments: [{ id: "a", text: "Intro", index: 0 }, { id: "c", text: "End", index: 2 }] } });
    mocks.proposals.mockResolvedValue([{ id: "p1" }]);
    const page = await findReportedPage("u1", "pg");
    expect(mocks.page.mock.calls[0][0].where).toEqual({ id: "pg", userId: "u1", deletedAt: null, aiUpdatedAt: { not: null } });
    expect(mocks.proposals.mock.calls[0][0].where).toEqual({ userId: "u1", appliedPageId: "pg", status: { in: ["APPLIED", "UNDONE"] } });
    expect(page).toMatchObject({ kind: "slides", text: "Slide 1: Intro\nSlide 3: End", proposals: [{ id: "p1" }] });
    mocks.page.mockResolvedValue(null);
    expect(await findReportedPage("u1", "pg")).toBeNull();
  });
});
