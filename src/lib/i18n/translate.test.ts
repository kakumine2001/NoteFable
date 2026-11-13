import { describe, expect, it } from "vitest";
import { createTranslator } from "./translate";

describe("translation interpolation", () => {
  it("inserts values once and leaves unresolved rich-text slots intact", () => {
    const t = createTranslator({ "Hello {name}, {count} notes": "{name}，{count} 条笔记" });
    expect(t("Hello {name}, {count} notes", { name: "{count}", count: 2 })).toBe("{count}，2 条笔记");
    expect(t("Use {key} for commands")).toBe("Use {key} for commands");
    expect(t("Missing {name}", { name: "$&" })).toBe("Missing $&");
  });

  it("falls back to the source without using Object prototype properties", () => {
    const t = createTranslator({});
    expect(t("constructor")).toBe("constructor");
    expect(t("toString", {})).toBe("toString");
    expect(t("{constructor}", {})).toBe("{constructor}");
  });
});
