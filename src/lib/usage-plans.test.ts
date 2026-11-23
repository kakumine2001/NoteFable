import { describe, expect, it } from "vitest";
import { MAX_STORED_FILE_BYTES, STORAGE_LIMITS, StorageLimitError, UsageLimitError, formatStorageSize, storageLimitErrorFrom, usageLimitErrorFrom } from "./usage-plans";
import { MAX_COVER_BYTES } from "./note-document";
import { MAX_NOTE_FILE_BYTES } from "./note-file-keys";

describe("usageLimitErrorFrom", () => {
  it("recognizes the daily limit response", () => {
    const error = usageLimitErrorFrom(429, { error: "limit", code: "usage_limit", tier: "guest", kind: "image" });
    expect(error).toBeInstanceOf(UsageLimitError);
    expect(error).toMatchObject({ message: "limit", tier: "guest", kind: "image" });
    expect(usageLimitErrorFrom(429, { error: "limit", code: "usage_limit", tier: "member" })?.kind).toBe("chat");
  });

  it("ignores other errors", () => {
    expect(usageLimitErrorFrom(500, { error: "x", code: "usage_limit", tier: "guest" })).toBeNull();
    expect(usageLimitErrorFrom(429, { error: "x" })).toBeNull();
    expect(usageLimitErrorFrom(429, { error: "x", code: "usage_limit", tier: "admin" })).toBeNull();
    expect(usageLimitErrorFrom(429, null)).toBeNull();
  });
});

describe("storage limits", () => {
  it("are set in one place: 100 MB for guests, 500 MB signed in, 10 GB with Pro, 4 MB per file", () => {
    expect(STORAGE_LIMITS).toEqual({ guest: 100 * 1024 ** 2, member: 500 * 1024 ** 2, pro: 10 * 1024 ** 3 });
    expect(MAX_STORED_FILE_BYTES).toBe(4 * 1024 ** 2);
    expect(MAX_NOTE_FILE_BYTES).toBe(MAX_STORED_FILE_BYTES);
    expect(MAX_COVER_BYTES).toBe(MAX_STORED_FILE_BYTES);
  });

  it("recognizes the storage limit response", () => {
    const error = storageLimitErrorFrom(413, { error: "full", code: "storage_limit", tier: "member", used: 10, limit: 20 });
    expect(error).toBeInstanceOf(StorageLimitError);
    expect(error).toMatchObject({ message: "full", tier: "member", used: 10, limit: 20 });
    expect(storageLimitErrorFrom(413, { error: "too big" })).toBeNull();
    expect(storageLimitErrorFrom(429, { error: "full", code: "storage_limit", tier: "member", used: 10, limit: 20 })).toBeNull();
    expect(storageLimitErrorFrom(413, { error: "full", code: "storage_limit", tier: "member", used: -1, limit: 20 })).toBeNull();
    expect(storageLimitErrorFrom(413, { error: "full", code: "storage_limit", tier: "owner", used: 1, limit: 20 })).toBeNull();
  });

  it("formats sizes like the per-file limit (1024-based, MB and GB) without rounding usage up", () => {
    expect(formatStorageSize(0)).toBe("0 KB");
    expect(formatStorageSize(1536)).toBe("1 KB");
    expect(formatStorageSize(STORAGE_LIMITS.guest)).toBe("100 MB");
    expect(formatStorageSize(STORAGE_LIMITS.member - 1)).toBe("499 MB");
    expect(formatStorageSize(2.56 * 1024 ** 2)).toBe("2.5 MB");
    expect(formatStorageSize(STORAGE_LIMITS.pro)).toBe("10 GB");
    expect(formatStorageSize(1.25 * 1024 ** 3)).toBe("1.2 GB");
    expect(formatStorageSize(2.5 * 1024 ** 2, "de")).toBe("2,5 MB");
  });
});
