import { describe, expect, it } from "vitest";
import { hasMath, normalizeMath } from "./math-markdown";

describe("normalizeMath", () => {
  it("leaves text without math alone", () => {
    expect(hasMath("plain text")).toBe(false);
    expect(normalizeMath("plain *text*")).toBe("plain *text*");
  });

  it("turns \\( … \\) into inline dollars and \\[ … \\] into a display block", () => {
    expect(normalizeMath("Euler: \\( e^{i\\pi} + 1 = 0 \\).")).toBe("Euler: $e^{i\\pi} + 1 = 0$.");
    expect(normalizeMath("Then\n\\[\n  x = \\frac{-b}{2a}\n\\]\ndone")).toBe("Then\n$$\nx = \\frac{-b}{2a}\n$$\ndone");
    expect(normalizeMath("mid \\[ a+b \\] line")).toBe("mid $$a+b$$ line");
  });

  it("keeps the indentation of a display block inside a list", () => {
    expect(normalizeMath("- step\n  \\[\n  a^2 + b^2 = c^2\n  \\]")).toBe("- step\n  $$\n  a^2 + b^2 = c^2\n  $$");
  });

  it("keeps dollar math and escapes dollars that are not math", () => {
    expect(normalizeMath("so $x^2$ and $$y$$")).toBe("so $x^2$ and $$y$$");
    expect(normalizeMath("It costs $5 and $10.")).toBe("It costs \\$5 and \\$10.");
    expect(normalizeMath("between $20,000 and $30,000")).toBe("between \\$20,000 and \\$30,000");
    expect(normalizeMath("price: $ 5")).toBe("price: \\$ 5");
    expect(normalizeMath("already \\$5")).toBe("already \\$5");
    expect(normalizeMath("set $a = \\$5$ here")).toBe("set $a = \\$5$ here");
  });

  it("does not touch code", () => {
    expect(normalizeMath("use `$HOME` and `\\(x\\)`")).toBe("use `$HOME` and `\\(x\\)`");
    const fenced = "```bash\necho $PATH \\( x \\)\n```";
    expect(normalizeMath(fenced)).toBe(fenced);
    expect(normalizeMath("~~~\n$a\n~~~\nthen $b$ and $9")).toBe("~~~\n$a\n~~~\nthen $b$ and \\$9");
    // 閉じていないコードブロック（生成の途中）は最後までコードとして扱う。
    expect(normalizeMath("```\n$1")).toBe("```\n$1");
  });

  it("leaves an unfinished formula as it is while the answer is still arriving", () => {
    expect(normalizeMath("see \\( x + ")).toBe("see \\( x + ");
    expect(normalizeMath("\\[\n a + b")).toBe("\\[\n a + b");
  });
});
