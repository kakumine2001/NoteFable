import { mkdtemp, mkdir, readdir, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/env", () => ({ optionalEnv: (key: string) => (key === "NOTEFABLE_STORAGE_DIR" ? env.root : undefined) }));
import { StoredImageNotFoundError, deleteStoredPrefix, readStoredImage } from "./storage";

describe("deleteStoredPrefix (local storage)", () => {
  afterEach(() => { env.root = ""; });

  it("removes only that user's folder", async () => {
    env.root = await mkdtemp(path.join(os.tmpdir(), "notefable-storage-"));
    await mkdir(path.join(env.root, "note-files", "u1"), { recursive: true });
    await mkdir(path.join(env.root, "note-files", "u10"), { recursive: true });
    await writeFile(path.join(env.root, "note-files", "u1", "a.pdf"), "a");
    await writeFile(path.join(env.root, "note-files", "u10", "b.pdf"), "b");
    await deleteStoredPrefix("note-files/u1/");
    expect(await readdir(path.join(env.root, "note-files"))).toEqual(["u10"]);
  });

  it("refuses prefixes that are not a per-user folder", async () => {
    env.root = await mkdtemp(path.join(os.tmpdir(), "notefable-storage-"));
    await expect(deleteStoredPrefix("note-files/")).rejects.toThrow("Invalid storage prefix.");
    await expect(deleteStoredPrefix("note-files/u1")).rejects.toThrow("Invalid storage prefix.");
    await expect(deleteStoredPrefix("../note-files/u1/")).rejects.toThrow();
  });
});

describe("readStoredImage (local storage)", () => {
  afterEach(() => { env.root = ""; });

  it("tells a missing file apart from other read failures", async () => {
    env.root = await mkdtemp(path.join(os.tmpdir(), "notefable-storage-"));
    await mkdir(path.join(env.root, "app-icons", "u1"), { recursive: true });
    await writeFile(path.join(env.root, "app-icons", "u1", "a.png"), "png");
    expect((await readStoredImage("app-icons/u1/a.png")).toString()).toBe("png");
    await expect(readStoredImage("app-icons/u1/gone.png")).rejects.toBeInstanceOf(StoredImageNotFoundError);
    // フォルダを読もうとした（ENOENT 以外）は「無い」ではない。
    await expect(readStoredImage("app-icons/u1")).rejects.not.toBeInstanceOf(StoredImageNotFoundError);
  });
});
