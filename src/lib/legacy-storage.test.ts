import { describe, expect, it } from "vitest";
import { adoptLegacyKey } from "./legacy-storage";

function memoryStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    } as unknown as Storage,
  };
}

describe("adoptLegacyKey", () => {
  it("moves a value saved under the old StudyMate name", () => {
    const { data, storage } = memoryStorage({ "studymate:page-draft:v1:p1": "draft" });
    adoptLegacyKey(storage, "notefable:page-draft:v1:p1");
    expect(Object.fromEntries(data)).toEqual({ "notefable:page-draft:v1:p1": "draft" });
  });

  it("keeps the newer value and drops the old one", () => {
    const { data, storage } = memoryStorage({ "studymate-pending-draft:chat": "old", "notefable-pending-draft:chat": "new" });
    adoptLegacyKey(storage, "notefable-pending-draft:chat");
    expect(Object.fromEntries(data)).toEqual({ "notefable-pending-draft:chat": "new" });
  });

  it("does nothing without an old value", () => {
    const { data, storage } = memoryStorage({ other: "x" });
    adoptLegacyKey(storage, "notefable:model-preference");
    expect(Object.fromEntries(data)).toEqual({ other: "x" });
  });
});
