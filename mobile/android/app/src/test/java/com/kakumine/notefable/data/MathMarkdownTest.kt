package com.kakumine.notefable.data

import com.kakumine.notefable.data.MathMarkdown.Formula
import com.kakumine.notefable.data.MathMarkdown.Prepared
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 和网页 `src/lib/math-markdown.test.ts` 对应：同样的输入认出同样的公式。 */
class MathMarkdownTest {
    private fun p(index: Int) = MathMarkdown.placeholder(index)
    private fun inline(latex: String) = Formula(latex, display = false)
    private fun block(latex: String) = Formula(latex, display = true)
    private fun same(text: String) = assertEquals(Prepared(text, emptyList()), MathMarkdown.prepare(text))

    @Test
    fun leavesTextWithoutMathAlone() {
        same("plain *text*")
        // 金额和 shell 变量不是公式，也不转义。
        same("It costs \$5 and \$10.")
        same("```bash\necho \$PATH\n```")
        same("use `\$HOME`")
    }

    @Test
    fun readsParenthesesAndBrackets() {
        assertEquals(
            Prepared("Euler: ${p(0)}.", listOf(inline("e^{i\\pi} + 1 = 0"))),
            MathMarkdown.prepare("Euler: \\( e^{i\\pi} + 1 = 0 \\)."),
        )
        assertEquals(
            Prepared("Then\n\n${p(0)}\n\ndone", listOf(block("x = \\frac{-b}{2a}"))),
            MathMarkdown.prepare("Then\n\\[\n  x = \\frac{-b}{2a}\n\\]\ndone"),
        )
        assertEquals(Prepared("mid ${p(0)} line", listOf(inline("a+b"))), MathMarkdown.prepare("mid \\[ a+b \\] line"))
    }

    @Test
    fun putsEveryDisplayFormulaInItsOwnParagraph() {
        assertEquals(
            Prepared("${p(0)}\n\nNext paragraph", listOf(block("\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}"))),
            MathMarkdown.prepare("\$\$\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\$\$\n\nNext paragraph"),
        )
        assertEquals(
            Prepared("Formula:\n\n${p(0)}\n\nwhere", listOf(block("E = mc^2"))),
            MathMarkdown.prepare("Formula:\n\n\$\$E = mc^2\$\$\n\nwhere"),
        )
        assertEquals(Prepared("so ${p(0)} here", listOf(inline("y"))), MathMarkdown.prepare("so \$\$y\$\$ here"))
    }

    @Test
    fun keepsIndentationAndQuoteMarkersOfADisplayFormula() {
        assertEquals(
            Prepared("- step\n  \n  ${p(0)}", listOf(block("a^2 + b^2 = c^2"))),
            MathMarkdown.prepare("- step\n  \\[\n  a^2 + b^2 = c^2\n  \\]"),
        )
        assertEquals(
            Prepared("> Note:\n> \n> ${p(0)}", listOf(block("x = 1"))),
            MathMarkdown.prepare("> Note:\n> \\[\n> x = 1\n> \\]"),
        )
    }

    @Test
    fun doesNotStackBlankLinesAroundADisplayFormula() {
        // 列表项里前后已经有空行的公式：再加空行会让列表项在这里断开。
        assertEquals(
            Prepared("1. Start:\n   \n   ${p(0)}\n   \n   Done.\n\n2. Next", listOf(block("x = 1"))),
            MathMarkdown.prepare("1. Start:\n   \n   \$\$\n   x = 1\n   \$\$\n   \n   Done.\n\n2. Next"),
        )
        assertEquals("- a\n  \n  ${p(0)}\n\n  b", MathMarkdown.prepare("- a\n  \$\$x\$\$\n  b").text)
    }

    @Test
    fun escapesDollarsThatAreNotMathOnceThereIsMath() {
        assertEquals(
            Prepared("so ${p(0)} costs \\\$5 and \\\$10.", listOf(inline("x^2"))),
            MathMarkdown.prepare("so \$x^2\$ costs \$5 and \$10."),
        )
        assertEquals(
            Prepared("${p(0)}, price: \\\$ 5, already \\\$5", listOf(inline("a"))),
            MathMarkdown.prepare("\$a\$, price: \$ 5, already \\\$5"),
        )
    }

    @Test
    fun keepsAFormulaThatContainsDollarSignsWhole() {
        assertEquals(
            Prepared("total ${p(0)} ok", listOf(inline("\\\$100 \\times 1.05 = \\\$105"))),
            MathMarkdown.prepare("total \$\\\$100 \\times 1.05 = \\\$105\$ ok"),
        )
    }

    @Test
    fun doesNotTouchCode() {
        assertEquals("${p(0)} use `\$HOME` and `\\(x\\)`", MathMarkdown.prepare("\$a\$ use `\$HOME` and `\\(x\\)`").text)
        assertEquals("${p(0)}\n```bash\necho \$PATH \\( x \\)\n```", MathMarkdown.prepare("\$a\$\n```bash\necho \$PATH \\( x \\)\n```").text)
        assertEquals("~~~\n\$a\n~~~\nthen ${p(0)} and \\\$9", MathMarkdown.prepare("~~~\n\$a\n~~~\nthen \$b\$ and \$9").text)
        // 没写完的代码块（生成途中）一直当代码。
        assertEquals("${p(0)}\n```\n\$1", MathMarkdown.prepare("\$a\$\n```\n\$1").text)
        // 行首的行内代码不是代码块的开头。
        assertEquals("```code``` is inline, ${p(0)} costs \\\$5", MathMarkdown.prepare("```code``` is inline, \$x\$ costs \$5").text)
        // 反引号不会跨段落配对。
        assertEquals("a ` b\n\n${p(0)} and \\\$7\n\nc ` d", MathMarkdown.prepare("a ` b\n\n\$x\$ and \$7\n\nc ` d").text)
    }

    @Test
    fun doesNotTouchIndentedCodeBlocks() {
        assertEquals(
            "Run:\n\n    echo \$HOME\n\n    echo \$x\$\n\nthen ${p(0)} and \\\$5",
            MathMarkdown.prepare("Run:\n\n    echo \$HOME\n\n    echo \$x\$\n\nthen \$x\$ and \$5").text,
        )
        assertEquals("```\na\n```\n    echo \$1\n${p(0)}", MathMarkdown.prepare("```\na\n```\n    echo \$1\n\$x\$").text)
        // 段落的续行和列表里更深的缩进不是代码。
        assertEquals("text\n    still ${p(0)} and \\\$5", MathMarkdown.prepare("text\n    still \$x\$ and \$5").text)
        assertEquals("- step\n\n    ${p(0)} costs \\\$5", MathMarkdown.prepare("- step\n\n    \$x\$ costs \$5").text)
    }

    @Test
    fun keepsAGreaterThanSignAtTheStartOfALineOfAQuotedFormula() {
        assertEquals(listOf(block("a\n> b")), MathMarkdown.prepare("> \$\$\n> a\n> > b\n> \$\$").formulas)
        assertEquals(listOf(block("a\n> b")), MathMarkdown.prepare("\$\$\na\n> b\n\$\$").formulas)
    }

    @Test
    fun doesNotTouchLinkDestinationsAndUrls() {
        val rest = " [Mercury](https://en.wikipedia.org/wiki/Mercury_\\(planet\\)) and <https://example.com/?a=\$b> and https://example.com/pay?amount=\$5"
        assertEquals(Prepared(p(0) + rest, listOf(inline("a"))), MathMarkdown.prepare("\$a\$$rest"))
    }

    @Test
    fun readsEscapedBracketsAfterAWordAsText() {
        val rest = " [\\[1\\]](https://example.com/a) arr\\[i\\] f\\(x\\) \\\\(not math\\\\)"
        assertEquals(Prepared(p(0) + rest, listOf(inline("a"))), MathMarkdown.prepare("\$a\$$rest"))
        assertEquals("${p(0)}\n- \\[x\\] done\n- \\[ \\] todo", MathMarkdown.prepare("\$a\$\n- \\[x\\] done\n- \\[ \\] todo").text)
    }

    @Test
    fun leavesAnUnfinishedFormulaAsItIs() {
        same("see \\( x + ")
        same("\\[\n a + b")
        same("\$\$\n a + b")
    }

    @Test
    fun typesetsMinusSigns() {
        val minus = "−"
        // 减法（两边有间距）和负号（没有间距）。
        assertEquals(
            "x=\\frac{${minus}b\\pm\\sqrt{b^2\\minus 4ac}}{2a}",
            MathMarkdown.typeset("x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"),
        )
        assertEquals("a \\minus  ${minus}b", MathMarkdown.typeset("a - -b"))
        assertEquals("(${minus}1) \\cdot ${minus}2", MathMarkdown.typeset("(-1) \\cdot -2"))
        assertEquals("2\\pi \\minus  1", MathMarkdown.typeset("2\\pi - 1"))
        assertEquals("\\left|x\\right|\\minus 1", MathMarkdown.typeset("\\left|x\\right|-1"))
        // 上下标里不加间距。
        assertEquals("e^{${minus}x} + x_{n${minus}1} + 10^{${minus}3}\\minus 1", MathMarkdown.typeset("e^{-x} + x_{n-1} + 10^{-3}-1"))
        // 文字、环境名、长度里的 - 不动。
        assertEquals("\\text{well-known} \\minus  1", MathMarkdown.typeset("\\text{well-known} - 1"))
        assertEquals("a\\\\[-2pt]b\\kern-2pt c\\hspace{-1em}d", MathMarkdown.typeset("a\\\\[-2pt]b\\kern-2pt c\\hspace{-1em}d"))
        assertEquals("\\begin{align-x}a\\end{align-x}", MathMarkdown.typeset("\\begin{align-x}a\\end{align-x}"))
        assertEquals("a+b", MathMarkdown.typeset("a+b"))
    }

    @Test
    fun findsTheDisplayFormulaOfAParagraph() {
        val formulas = listOf(inline("a"), block("b"))
        assertEquals(block("b"), MathMarkdown.displayFormula("  ${p(1)}\n", formulas))
        // 行内公式、和别的文字在一起的、序号不存在的，都不是独立公式。
        assertNull(MathMarkdown.displayFormula(p(0), formulas))
        assertNull(MathMarkdown.displayFormula("see ${p(1)}", formulas))
        assertNull(MathMarkdown.displayFormula(p(7), formulas))
        assertNull(MathMarkdown.displayFormula("${MathMarkdown.OPEN}99999999999999999999${MathMarkdown.CLOSE}", formulas))
    }
}
