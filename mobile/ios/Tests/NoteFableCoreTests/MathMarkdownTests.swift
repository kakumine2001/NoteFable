import XCTest
@testable import NoteFableCore

/// 和网页 `src/lib/math-markdown.test.ts`、Android 的 `MathMarkdownTest` 对应：同样的输入认出同样的公式。
final class MathMarkdownTests: XCTestCase {
    private typealias Formula = MathMarkdown.Formula
    private typealias Prepared = MathMarkdown.Prepared

    private func p(_ index: Int) -> String { MathMarkdown.placeholder(index) }
    private func inline(_ latex: String) -> Formula { Formula(latex: latex, display: false) }
    private func block(_ latex: String) -> Formula { Formula(latex: latex, display: true) }
    private func same(_ text: String, line: UInt = #line) {
        XCTAssertEqual(MathMarkdown.prepare(text), Prepared(text: text, formulas: []), line: line)
    }

    func testPatternsCompile() {
        XCTAssertTrue(MathMarkdown.patternsAreValid)
    }

    func testLeavesTextWithoutMathAlone() {
        same("plain *text*")
        // 金额和 shell 变量不是公式，也不转义。
        same("It costs $5 and $10.")
        same("```bash\necho $PATH\n```")
        same("use `$HOME`")
    }

    func testReadsParenthesesAndBrackets() {
        XCTAssertEqual(
            MathMarkdown.prepare("Euler: \\( e^{i\\pi} + 1 = 0 \\)."),
            Prepared(text: "Euler: \(p(0)).", formulas: [inline("e^{i\\pi} + 1 = 0")])
        )
        XCTAssertEqual(
            MathMarkdown.prepare("Then\n\\[\n  x = \\frac{-b}{2a}\n\\]\ndone"),
            Prepared(text: "Then\n\n\(p(0))\n\ndone", formulas: [block("x = \\frac{-b}{2a}")])
        )
        XCTAssertEqual(MathMarkdown.prepare("mid \\[ a+b \\] line"), Prepared(text: "mid \(p(0)) line", formulas: [inline("a+b")]))
    }

    func testPutsEveryDisplayFormulaInItsOwnParagraph() {
        XCTAssertEqual(
            MathMarkdown.prepare("$$\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}$$\n\nNext paragraph"),
            Prepared(text: "\(p(0))\n\nNext paragraph", formulas: [block("\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}")])
        )
        XCTAssertEqual(
            MathMarkdown.prepare("Formula:\n\n$$E = mc^2$$\n\nwhere"),
            Prepared(text: "Formula:\n\n\(p(0))\n\nwhere", formulas: [block("E = mc^2")])
        )
        XCTAssertEqual(MathMarkdown.prepare("so $$y$$ here"), Prepared(text: "so \(p(0)) here", formulas: [inline("y")]))
    }

    func testKeepsIndentationAndQuoteMarkersOfADisplayFormula() {
        XCTAssertEqual(
            MathMarkdown.prepare("- step\n  \\[\n  a^2 + b^2 = c^2\n  \\]"),
            Prepared(text: "- step\n  \n  \(p(0))", formulas: [block("a^2 + b^2 = c^2")])
        )
        XCTAssertEqual(
            MathMarkdown.prepare("> Note:\n> \\[\n> x = 1\n> \\]"),
            Prepared(text: "> Note:\n> \n> \(p(0))", formulas: [block("x = 1")])
        )
    }

    func testDoesNotStackBlankLinesAroundADisplayFormula() {
        // 列表项里前后已经有空行的公式：再加空行会让列表项在这里断开。
        XCTAssertEqual(
            MathMarkdown.prepare("1. Start:\n   \n   $$\n   x = 1\n   $$\n   \n   Done.\n\n2. Next"),
            Prepared(text: "1. Start:\n   \n   \(p(0))\n   \n   Done.\n\n2. Next", formulas: [block("x = 1")])
        )
        XCTAssertEqual(MathMarkdown.prepare("- a\n  $$x$$\n  b").text, "- a\n  \n  \(p(0))\n\n  b")
    }

    func testEscapesDollarsThatAreNotMathOnceThereIsMath() {
        XCTAssertEqual(
            MathMarkdown.prepare("so $x^2$ costs $5 and $10."),
            Prepared(text: "so \(p(0)) costs \\$5 and \\$10.", formulas: [inline("x^2")])
        )
        XCTAssertEqual(
            MathMarkdown.prepare("$a$, price: $ 5, already \\$5"),
            Prepared(text: "\(p(0)), price: \\$ 5, already \\$5", formulas: [inline("a")])
        )
    }

    func testKeepsAFormulaThatContainsDollarSignsWhole() {
        XCTAssertEqual(
            MathMarkdown.prepare("total $\\$100 \\times 1.05 = \\$105$ ok"),
            Prepared(text: "total \(p(0)) ok", formulas: [inline("\\$100 \\times 1.05 = \\$105")])
        )
    }

    func testDoesNotTouchCode() {
        XCTAssertEqual(MathMarkdown.prepare("$a$ use `$HOME` and `\\(x\\)`").text, "\(p(0)) use `$HOME` and `\\(x\\)`")
        XCTAssertEqual(MathMarkdown.prepare("$a$\n```bash\necho $PATH \\( x \\)\n```").text, "\(p(0))\n```bash\necho $PATH \\( x \\)\n```")
        XCTAssertEqual(MathMarkdown.prepare("~~~\n$a\n~~~\nthen $b$ and $9").text, "~~~\n$a\n~~~\nthen \(p(0)) and \\$9")
        // 没写完的代码块（生成途中）一直当代码。
        XCTAssertEqual(MathMarkdown.prepare("$a$\n```\n$1").text, "\(p(0))\n```\n$1")
        // 行首的行内代码不是代码块的开头。
        XCTAssertEqual(MathMarkdown.prepare("```code``` is inline, $x$ costs $5").text, "```code``` is inline, \(p(0)) costs \\$5")
        // 反引号不会跨段落配对。
        XCTAssertEqual(MathMarkdown.prepare("a ` b\n\n$x$ and $7\n\nc ` d").text, "a ` b\n\n\(p(0)) and \\$7\n\nc ` d")
    }

    func testDoesNotTouchIndentedCodeBlocks() {
        XCTAssertEqual(
            MathMarkdown.prepare("Run:\n\n    echo $HOME\n\n    echo $x$\n\nthen $x$ and $5").text,
            "Run:\n\n    echo $HOME\n\n    echo $x$\n\nthen \(p(0)) and \\$5"
        )
        XCTAssertEqual(MathMarkdown.prepare("```\na\n```\n    echo $1\n$x$").text, "```\na\n```\n    echo $1\n\(p(0))")
        // 段落的续行和列表里更深的缩进不是代码。
        XCTAssertEqual(MathMarkdown.prepare("text\n    still $x$ and $5").text, "text\n    still \(p(0)) and \\$5")
        XCTAssertEqual(MathMarkdown.prepare("- step\n\n    $x$ costs $5").text, "- step\n\n    \(p(0)) costs \\$5")
    }

    func testKeepsAGreaterThanSignAtTheStartOfALineOfAQuotedFormula() {
        XCTAssertEqual(MathMarkdown.prepare("> $$\n> a\n> > b\n> $$").formulas, [block("a\n> b")])
        XCTAssertEqual(MathMarkdown.prepare("$$\na\n> b\n$$").formulas, [block("a\n> b")])
    }

    func testDoesNotTouchLinkDestinationsAndUrls() {
        let rest = " [Mercury](https://en.wikipedia.org/wiki/Mercury_\\(planet\\)) and <https://example.com/?a=$b> and https://example.com/pay?amount=$5"
        XCTAssertEqual(MathMarkdown.prepare("$a$" + rest), Prepared(text: p(0) + rest, formulas: [inline("a")]))
    }

    func testReadsEscapedBracketsAfterAWordAsText() {
        let rest = " [\\[1\\]](https://example.com/a) arr\\[i\\] f\\(x\\) \\\\(not math\\\\)"
        XCTAssertEqual(MathMarkdown.prepare("$a$" + rest), Prepared(text: p(0) + rest, formulas: [inline("a")]))
        XCTAssertEqual(MathMarkdown.prepare("$a$\n- \\[x\\] done\n- \\[ \\] todo").text, "\(p(0))\n- \\[x\\] done\n- \\[ \\] todo")
    }

    func testLeavesAnUnfinishedFormulaAsItIs() {
        same("see \\( x + ")
        same("\\[\n a + b")
        same("$$\n a + b")
    }

    func testKeepsTextOutsideTheBasicPlaneIntact() {
        // 位置按 UTF-16 算：前面有表情（代理对）时公式和其余文字也不能错位。
        XCTAssertEqual(
            MathMarkdown.prepare("😀 so $x^2$ costs $5 🎉"),
            Prepared(text: "😀 so \(p(0)) costs \\$5 🎉", formulas: [inline("x^2")])
        )
        XCTAssertEqual(MathMarkdown.prepare("数式 \\( a \\) です").formulas, [inline("a")])
    }

    func testTypesetsMinusSigns() {
        let minus = "\u{2212}"
        // 减法（两边有间距）和负号（没有间距）。
        XCTAssertEqual(
            MathMarkdown.typeset("x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"),
            "x=\\frac{\(minus)b\\pm\\sqrt{b^2\\minus 4ac}}{2a}"
        )
        XCTAssertEqual(MathMarkdown.typeset("a - -b"), "a \\minus  \(minus)b")
        XCTAssertEqual(MathMarkdown.typeset("(-1) \\cdot -2"), "(\(minus)1) \\cdot \(minus)2")
        XCTAssertEqual(MathMarkdown.typeset("2\\pi - 1"), "2\\pi \\minus  1")
        XCTAssertEqual(MathMarkdown.typeset("\\left|x\\right|-1"), "\\left|x\\right|\\minus 1")
        // 上下标里不加间距。
        XCTAssertEqual(
            MathMarkdown.typeset("e^{-x} + x_{n-1} + 10^{-3}-1"),
            "e^{\(minus)x} + x_{n\(minus)1} + 10^{\(minus)3}\\minus 1"
        )
        // 文字、环境名、长度里的 - 不动。
        XCTAssertEqual(MathMarkdown.typeset("\\text{well-known} - 1"), "\\text{well-known} \\minus  1")
        XCTAssertEqual(MathMarkdown.typeset("a\\\\[-2pt]b\\kern-2pt c\\hspace{-1em}d"), "a\\\\[-2pt]b\\kern-2pt c\\hspace{-1em}d")
        XCTAssertEqual(MathMarkdown.typeset("\\begin{align-x}a\\end{align-x}"), "\\begin{align-x}a\\end{align-x}")
        XCTAssertEqual(MathMarkdown.typeset("a+b"), "a+b")
    }

    func testFindsTheDisplayFormulaOfAParagraph() {
        let formulas = [inline("a"), block("b")]
        XCTAssertEqual(MathMarkdown.displayFormula("  \(p(1))\n", formulas), block("b"))
        // 行内公式、和别的文字在一起的、序号不存在的，都不是独立公式。
        XCTAssertNil(MathMarkdown.displayFormula(p(0), formulas))
        XCTAssertNil(MathMarkdown.displayFormula("see \(p(1))", formulas))
        XCTAssertNil(MathMarkdown.displayFormula(p(7), formulas))
        XCTAssertNil(MathMarkdown.displayFormula("\u{E000}99999999999999999999\u{E001}", formulas))
    }

    func testSplitsTextAtPlaceholders() {
        let formulas = [inline("a"), block("b")]
        XCTAssertEqual(
            MathMarkdown.segments("x \(p(0)) y \(p(1))", formulas),
            [.text("x "), .formula(inline("a")), .text(" y "), .formula(block("b"))]
        )
        // 序号不存在的占位符原样留着。
        XCTAssertEqual(MathMarkdown.segments("x \(p(9))", formulas), [.text("x \(p(9))")])
        XCTAssertEqual(MathMarkdown.segments("plain", formulas), [.text("plain")])
        XCTAssertEqual(MathMarkdown.segments("", formulas), [])
        XCTAssertEqual(MathMarkdown.restore("x \(p(0)) y \(p(1))", formulas), "x $a$ y $$b$$")
    }
}
