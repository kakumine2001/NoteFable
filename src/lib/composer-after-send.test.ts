import { describe, expect, it } from "vitest";
import { remainingComposerText, withoutSent } from "./composer-after-send";

describe("remainingComposerText", () => {
  it("clears exactly the sent text", () => {
    expect(remainingComposerText("hello", "hello")).toBe("");
  });

  it("keeps what was typed after the sent text", () => {
    expect(remainingComposerText("hello\n\nmore", "hello")).toBe("more");
  });

  it("keeps a different draft untouched", () => {
    expect(remainingComposerText("another chat's draft", "hello")).toBe("another chat's draft");
    expect(remainingComposerText("", "hello")).toBe("");
  });
});

describe("withoutSent", () => {
  it("removes only the sent items and keeps ones added meanwhile", () => {
    const sent = [{ id: "a" }, { id: "b" }];
    const added = { id: "c" };
    expect(withoutSent([...sent, added], sent, (item) => item.id)).toEqual([added]);
    expect(withoutSent([added], sent, (item) => item.id)).toEqual([added]);
    expect(withoutSent([], sent, (item) => item.id)).toEqual([]);
  });
});
