import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeDiagramDialog, diagramErrorMessage, diagramKey, dismissDiagramJob, drawAnswerDiagram, drawNoteDiagram, getDiagramDialog, getDiagramJob,
  resetDiagramJobs, retryDiagramJob, startDiagramJob, subscribeDiagramJobs, UNSAVED_NOTE,
} from "./draw-diagram-jobs";

const PAGE = {
  id: "cwhiteboard000000000000001", kind: "whiteboard", position: 0, title: "Flow", icon: null, version: 1, groupId: "cgroup",
  parentId: null, favoritedAt: null, fullWidth: false, smallText: false, font: "default", locked: false, shareEnabled: false,
  shareExpiresAt: null, aiUpdatedAt: "2026-11-25T00:00:00.000Z", createdAt: "2026-11-25T00:00:00.000Z", updatedAt: "2026-11-25T00:00:00.000Z",
};
const ANSWER = { type: "answer", sessionId: "csession00000000000000001", messageId: "cmessage00000000000000001" } as const;
const ANSWER_KEY = `answer:${ANSWER.sessionId}\n${ANSWER.messageId}`;
const NOTE_ID = "cnote000000000000000000001";

type Deferred = { resolve: (response: Response) => void; reject: (error: unknown) => void };
let pending: Deferred[] = [];
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>((resolve, reject) => { pending.push({ resolve, reject }); }));
const dispatchEvent = vi.fn();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function sentBodies() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}
// 届いた応答を処理し終えるまで待つ（json() の読み込みを含む）。
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetDiagramJobs();
  pending = [];
  fetchMock.mockClear();
  dispatchEvent.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { dispatchEvent });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("draw as diagram request", () => {
  it("keys jobs by source", () => {
    expect(diagramKey(ANSWER)).toBe(ANSWER_KEY);
    expect(diagramKey({ type: "note", pageId: NOTE_ID })).toBe(`note:${NOTE_ID}`);
  });

  it("posts the answer or note with the model and a request id", async () => {
    drawAnswerDiagram(ANSWER.sessionId, ANSWER.messageId, "luna");
    startDiagramJob({ type: "note", pageId: NOTE_ID }, "claude-haiku");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pages/diagram");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    const [answer, note] = sentBodies();
    expect(answer).toEqual({ source: "answer", messageId: ANSWER.messageId, model: "luna", clientRequestId: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
    expect(note).toEqual({ source: "note", pageId: NOTE_ID, model: "claude-haiku", clientRequestId: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
    expect(answer.clientRequestId).not.toBe(note.clientRequestId);
    // 回答の「…」から選ぶと、その要求の窓が開く。
    expect(getDiagramDialog()).toEqual({ key: ANSWER_KEY });
    expect(getDiagramJob(ANSWER_KEY)).toEqual({ status: "working" });
  });

  it("runs one job per source and reopens it instead of starting another", async () => {
    drawAnswerDiagram(ANSWER.sessionId, ANSWER.messageId, "luna");
    closeDiagramDialog();
    drawAnswerDiagram(ANSWER.sessionId, ANSWER.messageId, "other-model");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getDiagramDialog()).toEqual({ key: ANSWER_KEY });
    // 閉じても進行中の要求は残り、結果は後から開いた窓で見られる。
    closeDiagramDialog();
    dismissDiagramJob(ANSWER_KEY);
    pending[0].resolve(json(201, { page: PAGE, partial: true }));
    await settle();
    expect(getDiagramJob(ANSWER_KEY)).toEqual({ status: "done", page: PAGE, partial: true });
    drawAnswerDiagram(ANSWER.sessionId, ANSWER.messageId, "luna");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getDiagramDialog()).toEqual({ key: ANSWER_KEY });
  });

  it("tells the page list about the new whiteboard", async () => {
    startDiagramJob(ANSWER, "luna");
    pending[0].resolve(json(201, { page: PAGE }));
    await settle();
    expect(getDiagramJob(ANSWER_KEY)).toEqual({ status: "done", page: PAGE, partial: false });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("notefable:page-created");
    expect(event.detail).toEqual(PAGE);
  });

  it("retries a failed job with the same request id and model", async () => {
    startDiagramJob(ANSWER, "luna");
    pending[0].resolve(json(502, { error: "Could not draw a diagram. Try again." }));
    await settle();
    expect(getDiagramJob(ANSWER_KEY)).toEqual({ status: "error", message: "Could not draw a diagram. Try again.", source: null });
    retryDiagramJob(ANSWER_KEY);
    expect(getDiagramJob(ANSWER_KEY)).toEqual({ status: "working" });
    // 応答だけが失われていた：サーバーは同じ要求として作ってあるページを返す（200）。
    pending[1].resolve(json(200, { page: PAGE }));
    await settle();
    const [first, second] = sentBodies();
    expect(second).toEqual(first);
    expect(getDiagramJob(ANSWER_KEY)).toMatchObject({ status: "done", page: { id: PAGE.id } });
    // 終わった要求は送り直さない。
    retryDiagramJob(ANSWER_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a network failure like a server failure", async () => {
    startDiagramJob(ANSWER, "luna");
    pending[0].reject(new TypeError("Failed to fetch"));
    await settle();
    expect(getDiagramJob(ANSWER_KEY)).toEqual({ status: "error", message: "Could not draw a diagram. Try again.", source: null });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("keeps the Mermaid source when the diagram could not be converted", async () => {
    startDiagramJob(ANSWER, "luna");
    pending[0].resolve(json(422, { error: "Could not turn this into an editable diagram.", code: "diagram_invalid", source: "flowchart TD\nA-->B" }));
    await settle();
    expect(getDiagramJob(ANSWER_KEY)).toEqual({ status: "error", message: "Could not turn this into an editable diagram.", source: "flowchart TD\nA-->B" });
  });

  it("shows the server's reason only for request, missing, size, conversion and limit errors", () => {
    for (const status of [400, 404, 413, 422, 429]) expect(diagramErrorMessage(status, { error: "Reason." })).toBe("Reason.");
    for (const status of [401, 500, 502, 503, 504]) expect(diagramErrorMessage(status, { error: "Internal detail" })).toBe("Could not draw a diagram. Try again.");
    expect(diagramErrorMessage(429, {})).toBe("Could not draw a diagram. Try again.");
    expect(diagramErrorMessage(404, { error: "" })).toBe("Could not draw a diagram. Try again.");
  });

  it("forgets a finished job when its window closes, so the next click is a new request", async () => {
    startDiagramJob(ANSWER, "luna");
    // 進行中は忘れない。
    dismissDiagramJob(ANSWER_KEY);
    expect(getDiagramJob(ANSWER_KEY)).toEqual({ status: "working" });
    pending[0].resolve(json(201, { page: PAGE }));
    await settle();
    dismissDiagramJob(ANSWER_KEY);
    expect(getDiagramJob(ANSWER_KEY)).toBeNull();
    startDiagramJob(ANSWER, "luna");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = sentBodies();
    expect(second.clientRequestId).not.toBe(first.clientRequestId);
  });

  it("drops results that arrive after the account changed", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDiagramJobs(listener);
    drawAnswerDiagram(ANSWER.sessionId, ANSWER.messageId, "luna");
    resetDiagramJobs();
    expect(getDiagramJob(ANSWER_KEY)).toBeNull();
    expect(getDiagramDialog()).toBeNull();
    listener.mockClear();
    pending[0].resolve(json(201, { page: PAGE }));
    await settle();
    expect(getDiagramJob(ANSWER_KEY)).toBeNull();
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    // 替わった後に同じ元から始めた要求は、前の結果に上書きされない。
    startDiagramJob(ANSWER, "luna");
    pending[1].resolve(json(502, {}));
    await settle();
    expect(getDiagramJob(ANSWER_KEY)).toMatchObject({ status: "error" });
    unsubscribe();
  });
});

describe("drawing a note", () => {
  const NOTE_KEY = `note:${NOTE_ID}`;

  it("saves the note first, then starts", async () => {
    const order: string[] = [];
    const flush = vi.fn(async () => { order.push("flush"); return true; });
    fetchMock.mockImplementationOnce(() => { order.push("fetch"); return new Promise<Response>((resolve, reject) => { pending.push({ resolve, reject }); }); });
    await expect(drawNoteDiagram(NOTE_ID, "luna", flush)).resolves.toBe("started");
    expect(order).toEqual(["flush", "fetch"]);
    expect(sentBodies()[0]).toMatchObject({ source: "note", pageId: NOTE_ID, model: "luna" });
    expect(getDiagramDialog()).toEqual({ key: NOTE_KEY });
  });

  it("does not start when the note could not be saved", async () => {
    await expect(drawNoteDiagram(NOTE_ID, "luna", async () => false)).resolves.toBe("unsaved");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDiagramJob(NOTE_KEY)).toBeNull();
    expect(getDiagramDialog()).toEqual({ key: NOTE_KEY, notice: UNSAVED_NOTE });
    await expect(drawNoteDiagram(NOTE_ID, "luna", async () => { throw new Error("offline"); })).resolves.toBe("unsaved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reopens a running job without saving again, and ignores a second click while saving", async () => {
    let finishFlush: (saved: boolean) => void = () => {};
    const flush = vi.fn(() => new Promise<boolean>((resolve) => { finishFlush = resolve; }));
    const first = drawNoteDiagram(NOTE_ID, "luna", flush);
    await expect(drawNoteDiagram(NOTE_ID, "luna", flush)).resolves.toBe("ignored");
    finishFlush(true);
    await expect(first).resolves.toBe("started");
    closeDiagramDialog();
    const again = vi.fn(async () => true);
    await expect(drawNoteDiagram(NOTE_ID, "luna", again)).resolves.toBe("reopened");
    expect(flush).toHaveBeenCalledTimes(1);
    expect(again).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getDiagramDialog()).toEqual({ key: NOTE_KEY });
  });

  it("does not start a note's job when the account changed while saving", async () => {
    let finishFlush: (saved: boolean) => void = () => {};
    const result = drawNoteDiagram(NOTE_ID, "luna", () => new Promise<boolean>((resolve) => { finishFlush = resolve; }));
    resetDiagramJobs();
    finishFlush(true);
    await expect(result).resolves.toBe("ignored");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDiagramDialog()).toBeNull();
  });
});
