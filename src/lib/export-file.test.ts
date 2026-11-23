import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelNativeExports, FILE_CHUNK_BYTES, getNativeExportEpoch, MAX_APP_FILE_BYTES, saveExportFile, sendFileToNative } from "@/lib/export-file";
import type { NativeMessage } from "@/lib/native-bridge";

describe("sendFileToNative", () => {
  it("sends start, ordered base64 chunks and end", async () => {
    const sent: NativeMessage[] = [];
    const post = vi.fn((message: NativeMessage) => { sent.push(message); return true; });
    const bytes = new Uint8Array(FILE_CHUNK_BYTES + 3).map((_, index) => index % 251);
    expect(await sendFileToNative(new Blob([bytes], { type: "application/pdf" }), "Board.pdf", post)).toBe(true);
    expect(sent[0]).toMatchObject({ type: "fileStart", name: "Board.pdf", mime: "application/pdf", size: FILE_CHUNK_BYTES + 3 });
    const id = (sent[0] as { id: string }).id;
    const chunks = sent.filter((message) => message.type === "fileChunk") as Extract<NativeMessage, { type: "fileChunk" }>[];
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1]);
    expect(chunks.every((chunk) => chunk.id === id)).toBe(true);
    const decoded = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data, "base64")));
    expect(decoded.equals(Buffer.from(bytes))).toBe(true);
    expect(sent.at(-1)).toEqual({ type: "fileEnd", id });
  });

  it("aborts when a chunk cannot be sent", async () => {
    const types: string[] = [];
    let calls = 0;
    const post = vi.fn((message: NativeMessage) => { types.push(message.type); calls++; return calls !== 2; });
    expect(await sendFileToNative(new Blob([new Uint8Array(10)]), "a.png", post)).toBe(false);
    expect(types).toEqual(["fileStart", "fileChunk", "fileAbort"]);
  });

  it("does not start when the app is gone", async () => {
    expect(await sendFileToNative(new Blob(["x"]), "a.svg", () => false)).toBe(false);
  });
});

describe("saveExportFile in the app", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubApp(canSaveFile: boolean) {
    const messages: string[] = [];
    vi.stubGlobal("window", { NoteFableNative: { postMessage: (json: string) => { messages.push(JSON.parse(json).type); }, canSaveFile: () => canSaveFile } });
    return messages;
  }

  it("hands the file to an app that can save files", async () => {
    const messages = stubApp(true);
    expect(await saveExportFile(new Blob(["x"], { type: "image/png" }), "a.png")).toBe("app");
    expect(messages).toEqual(["fileStart", "fileChunk", "fileEnd"]);
  });

  it("does not send to an old app", async () => {
    const messages = stubApp(false);
    expect(await saveExportFile(new Blob(["x"], { type: "image/png" }), "a.png")).toBe("unsupported");
    expect(messages).toEqual([]);
  });

  it("stops before sending a file the app would refuse", async () => {
    const messages = stubApp(true);
    const big = { size: MAX_APP_FILE_BYTES + 1, type: "application/pdf" } as Blob;
    expect(await saveExportFile(big, "a.pdf")).toBe("tooLarge");
    expect(messages).toEqual([]);
  });

  it("cancels a delayed export after the editor switches pages", async () => {
    const messages = stubApp(true);
    const startedEpoch = getNativeExportEpoch();
    cancelNativeExports();
    expect(await saveExportFile(new Blob(["x"], { type: "image/png" }), "old-board.png", startedEpoch)).toBe("cancelled");
    expect(messages).toEqual([]);
  });
});
