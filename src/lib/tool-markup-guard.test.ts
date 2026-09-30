import { describe, expect, it } from "vitest";
import { ToolMarkupGuard } from "./tool-markup-guard";

describe("ToolMarkupGuard", () => {
  it.each([
    '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="search">query</｜｜DSML｜｜ invoke>',
    "<｜DSML｜tool_calls>",
    "<|DSML|tool_calls>",
    "</||DSML||invoke>",
    '<tool_result>{"results":[]}</｜｜DSML｜｜ parameter>',
  ])("blocks tool output at every possible stream boundary: %s", (text) => {
    for (let cut = 0; cut <= text.length; cut += 1) {
      const guard = new ToolMarkupGuard();
      let forwarded = "";
      expect(() => {
        forwarded += guard.push(text.slice(0, cut));
        forwarded += guard.push(text.slice(cut));
        forwarded += guard.finish();
      }).toThrow("invalid tool response");
      expect(forwarded).toBe("");
    }
  });

  it("preserves normal Markdown, comparisons, Unicode and HTML across single-character deltas", () => {
    const text = "日本語🙂 **answer**\n```html\n<div>ok</div>\n```\na < b, <T>, DSML, x <";
    const guard = new ToolMarkupGuard();
    expect([...text].map((c) => guard.push(c)).join("") + guard.finish()).toBe(text);
  });

  it("stops a partial marker at the end rather than flushing it", () => {
    const guard = new ToolMarkupGuard();
    expect(guard.push("Answer <｜｜DS")).toBe("Answer ");
    expect(() => guard.finish()).toThrow("incomplete tool response");
  });
});
