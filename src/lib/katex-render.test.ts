import katex from "katex";
import { describe, expect, it } from "vitest";
import { renderKatex, type KatexApi } from "./katex-render";

describe("renderKatex", () => {
  it("renders inline and display math", () => {
    const inline = renderKatex(katex, "x^2", false);
    expect(inline.error).toBeNull();
    expect(inline.html).toContain('class="katex"');
    expect(inline.html).not.toContain("katex-display");
    expect(renderKatex(katex, " \\sum_i i ", true).html).toContain('class="katex-display"');
  });

  it("renders nothing for an empty equation", () => {
    expect(renderKatex(katex, " \n ", true)).toEqual({ html: "", error: null });
  });

  it("shows a parse error in the text color and reports the message", () => {
    const result = renderKatex(katex, "\\frac{1}{", false);
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/^KaTeX parse error/i);
    expect(result.html).toContain('class="katex-error"');
    expect(result.html).toContain("color:currentColor");
  });

  it("returns no HTML when KaTeX cannot render the source at all", () => {
    const failing: KatexApi = { renderToString: () => { throw new RangeError("Maximum call stack size exceeded"); } };
    expect(renderKatex(failing, "x", true)).toEqual({ html: "", error: "Maximum call stack size exceeded" });
  });

  it("never trusts commands that could add links or HTML attributes", () => {
    // 公開ページはサーバーで描いた HTML をそのまま出すので、\href や \htmlClass は文字として出るだけにする（trust: false）。
    const html = renderKatex(katex, "\\href{javascript:alert(1)}{x} \\htmlClass{evil}{y} \\htmlData{x=1}{z}", false).html;
    expect(html).not.toContain("href=");
    expect(html).not.toMatch(/class="[^"]*\bevil\b/);
    expect(html).not.toContain("data-x=");
  });
});
