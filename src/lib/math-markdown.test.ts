import { describe, expect, it } from "vitest";
import { hasMath, normalizeMath, prepareMath } from "./math-markdown";

describe("normalizeMath", () => {
  it("leaves text without math alone, and does not ask for the math library", () => {
    expect(prepareMath("plain *text*")).toEqual({ text: "plain *text*", hasMath: false });
    // 金額やシェルの変数だけでは数式とみなさない（エスケープもしない）。
    expect(prepareMath("It costs $5 and $10.")).toEqual({ text: "It costs $5 and $10.", hasMath: false });
    expect(prepareMath("```bash\necho $PATH\n```")).toEqual({ text: "```bash\necho $PATH\n```", hasMath: false });
    expect(hasMath("use `$HOME`")).toBe(false);
  });

  it("turns \\( … \\) into inline dollars and \\[ … \\] into a display block", () => {
    expect(normalizeMath("Euler: \\( e^{i\\pi} + 1 = 0 \\).")).toBe("Euler: $e^{i\\pi} + 1 = 0$.");
    expect(normalizeMath("Then\n\\[\n  x = \\frac{-b}{2a}\n\\]\ndone")).toBe("Then\n$$\nx = \\frac{-b}{2a}\n$$\ndone");
    expect(normalizeMath("mid \\[ a+b \\] line")).toBe("mid $$a+b$$ line");
  });

  it("puts every display formula between fences that sit alone on their lines", () => {
    // remark-math は、$$ だけの行で囲まれていないブロックを閉じられず、後ろの本文まで数式にしてしまう。
    expect(normalizeMath("$$\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}$$\n\nNext paragraph"))
      .toBe("$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\n\nNext paragraph");
    expect(normalizeMath("Formula:\n\n$$E = mc^2$$\n\nwhere")).toBe("Formula:\n\n$$\nE = mc^2\n$$\n\nwhere");
    expect(normalizeMath("$$ x = 1\n$$")).toBe("$$\nx = 1\n$$");
    expect(normalizeMath("so $$y$$ here")).toBe("so $$y$$ here");
  });

  it("keeps the indentation and quote markers of a display block", () => {
    expect(normalizeMath("- step\n  \\[\n  a^2 + b^2 = c^2\n  \\]")).toBe("- step\n  $$\n  a^2 + b^2 = c^2\n  $$");
    expect(normalizeMath("> Note:\n> \\[\n> x = 1\n> \\]")).toBe("> Note:\n> $$\n> x = 1\n> $$");
  });

  it("escapes dollars that are not math once there is math in the answer", () => {
    expect(normalizeMath("so $x^2$ costs $5 and $10.")).toBe("so $x^2$ costs \\$5 and \\$10.");
    expect(normalizeMath("$a$ between $20,000 and $30,000")).toBe("$a$ between \\$20,000 and \\$30,000");
    expect(normalizeMath("$a$, price: $ 5, already \\$5")).toBe("$a$, price: \\$ 5, already \\$5");
  });

  it("wraps a formula that contains a dollar sign in double dollars, so it does not end early", () => {
    expect(normalizeMath("total $\\$100 \\times 1.05 = \\$105$ ok")).toBe("total $$\\$100 \\times 1.05 = \\$105$$ ok");
    expect(normalizeMath("so \\( \\$5 \\times 3 = \\$15 \\)")).toBe("so $$\\$5 \\times 3 = \\$15$$");
  });

  it("does not touch code", () => {
    expect(normalizeMath("$a$ use `$HOME` and `\\(x\\)`")).toBe("$a$ use `$HOME` and `\\(x\\)`");
    const fenced = "$a$\n```bash\necho $PATH \\( x \\)\n```";
    expect(normalizeMath(fenced)).toBe(fenced);
    expect(normalizeMath("~~~\n$a\n~~~\nthen $b$ and $9")).toBe("~~~\n$a\n~~~\nthen $b$ and \\$9");
    // 閉じていないコードブロック（生成の途中）は最後までコードとして扱う。
    expect(normalizeMath("$a$\n```\n$1")).toBe("$a$\n```\n$1");
    // 行頭のインラインコードはコードブロックの始まりではない。
    expect(normalizeMath("```code``` is inline, $x$ costs $5")).toBe("```code``` is inline, $x$ costs \\$5");
    // バッククォートが段落をまたいで対になることはない。
    expect(normalizeMath("a ` b\n\n$x$ and $7\n\nc ` d")).toBe("a ` b\n\n$x$ and \\$7\n\nc ` d");
  });

  it("does not touch indented code blocks", () => {
    expect(normalizeMath("Run:\n\n    echo $HOME\n\n    echo $x$\n\nthen $x$ and $5")).toBe("Run:\n\n    echo $HOME\n\n    echo $x$\n\nthen $x$ and \\$5");
    expect(normalizeMath("```\na\n```\n    echo $1\n$x$")).toBe("```\na\n```\n    echo $1\n$x$");
    // 段落の続きやリストの中の深い字下げは、コードではない。
    expect(normalizeMath("text\n    still $x$ and $5")).toBe("text\n    still $x$ and \\$5");
    expect(normalizeMath("- step\n\n    $x$ costs $5")).toBe("- step\n\n    $x$ costs \\$5");
  });

  it("keeps a greater-than sign at the start of a line of a quoted formula", () => {
    const quoted = "> $$\n> a\n> > b\n> $$";
    expect(normalizeMath(quoted)).toBe(quoted);
    expect(normalizeMath("$$\na\n> b\n$$")).toBe("$$\na\n> b\n$$");
  });

  it("does not touch link destinations and URLs", () => {
    const link = "$a$ [Mercury](https://en.wikipedia.org/wiki/Mercury_\\(planet\\)) and <https://example.com/?a=$b> and https://example.com/pay?amount=$5";
    expect(normalizeMath(link)).toBe(link);
  });

  it("reads \\[ and \\( after a word or an opening bracket as escaped characters, not math", () => {
    const text = "$a$ [\\[1\\]](https://example.com/a) arr\\[i\\] f\\(x\\) \\\\(not math\\\\)";
    expect(normalizeMath(text)).toBe(text);
    expect(normalizeMath("$a$\n- \\[x\\] done\n- \\[ \\] todo")).toBe("$a$\n- \\[x\\] done\n- \\[ \\] todo");
  });

  it("treats a math code fence as math", () => {
    expect(prepareMath("```math\nx^2\n```")).toEqual({ text: "```math\nx^2\n```", hasMath: true });
  });

  it("leaves an unfinished formula as it is while the answer is still arriving", () => {
    expect(prepareMath("see \\( x + ")).toEqual({ text: "see \\( x + ", hasMath: false });
    expect(prepareMath("\\[\n a + b")).toEqual({ text: "\\[\n a + b", hasMath: false });
    expect(prepareMath("$$\n a + b")).toEqual({ text: "$$\n a + b", hasMath: false });
  });
});
