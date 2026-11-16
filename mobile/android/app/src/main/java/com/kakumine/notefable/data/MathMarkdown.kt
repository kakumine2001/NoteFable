package com.kakumine.notefable.data

/**
 * 回答里的数学公式（LaTeX）。规则和网页 `src/lib/math-markdown.ts` 的 `prepareMath` 相同，改规则时两边一起改：
 * 认 `\( … \)`、`\[ … \]`、`$ … $`、`$$ … $$`；`$ … $` 按 Pandoc 的规则判断（开头的 `$` 后面、结尾的 `$` 前面不是空白，
 * 结尾的 `$` 后面不是数字），所以"$5 和 $10"不是公式；代码（围栏和行内）、链接地址和网址里的内容不动；
 * 紧跟在英文字母、数字或 `[` 后面的 `\[`、`\(` 是 Markdown 对括号的转义，不是公式。
 *
 * 和网页不同的是结果的形式：网页把公式整理成 `$` 写法交给 remark-math，这里把每个公式换成一个占位符，
 * 由回答的渲染（`ui/AnswerMarkdown.kt`）在占位符的位置放上排好版的公式。
 */
object MathMarkdown {
    /** 一个公式：LaTeX 源码，以及是不是独占一行的独立公式（居中、可横向滚动）。 */
    data class Formula(val latex: String, val display: Boolean)

    /** [text] 是换好占位符的 Markdown；没有公式时就是原文，[formulas] 为空。 */
    data class Prepared(val text: String, val formulas: List<Formula>)

    // 占位符：私用区字符夹着公式的序号。Markdown 解析器把它当普通文字，不会拆开也不会当成语法。
    const val OPEN = '\uE000'
    const val CLOSE = '\uE001'
    val PLACEHOLDER = Regex("$OPEN(\\d+)$CLOSE")

    fun placeholder(index: Int) = "$OPEN$index$CLOSE"

    // 参数是文字、名字或长度的命令：里面的 - 不是减号。
    private val VERBATIM_ARGUMENT = setOf(
        "text", "textbf", "textit", "textrm", "textsf", "texttt", "textnormal", "mbox", "hbox", "operatorname",
        "begin", "end", "label", "tag", "ce", "pu", "hspace", "vspace", "color", "textcolor", "href", "url", "raisebox", "rule",
    )

    // 后面直接跟长度的命令（\kern-2pt）。
    private val DIMENSION = setOf("kern", "mkern", "hskip", "mskip")

    // 运算符、关系符、函数名、括号的修饰：跟在它们后面的 - 是负号，不是减法。
    private val BEFORE_SIGN = setOf(
        "cdot", "times", "div", "pm", "mp", "le", "leq", "ge", "geq", "ne", "neq", "lt", "gt", "ll", "gg", "approx", "equiv", "sim",
        "simeq", "cong", "propto", "to", "rightarrow", "leftarrow", "Rightarrow", "Leftarrow", "leftrightarrow", "Leftrightarrow",
        "mapsto", "iff", "implies", "in", "notin", "subset", "subseteq", "supset", "supseteq", "cup", "cap", "land", "lor", "wedge",
        "vee", "oplus", "otimes", "circ", "mid", "colon", "left", "big", "Big", "bigg", "Bigg", "bigl", "Bigl", "biggl", "Biggl",
        "quad", "qquad", "sum", "prod", "int", "lim", "max", "min", "sup", "inf", "log", "ln", "lg", "exp", "sin", "cos", "tan",
        "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "det", "gcd", "sqrt", "frac", "dfrac", "tfrac",
        "displaystyle", "textstyle", "langle", "lbrace", "lvert", "lVert",
    )

    /**
     * 交给公式排版库之前的整理：把 - 换成真正的减号。库把 - 画成短横线（连字符），和网页的 KaTeX 不一样。
     * 跟在数字、字母、右括号后面的是减法（`\minus`，两边有间距）；其余的是负号（U+2212，不加间距）；
     * 上下标里和 TeX 一样不加间距。文字、环境名、长度里的 - 不动。
     */
    fun typeset(latex: String): String {
        if ('-' !in latex) return latex
        val out = StringBuilder(latex.length + 16)
        val scripts = ArrayDeque<Boolean>() // 每层花括号：是不是在上下标里
        var operand = false // 前一个记号是不是可以被减的东西
        var script = false // 刚写了 ^ 或 _
        var i = 0
        val end = latex.length
        fun copyGroup() {
            while (i < end && latex[i].isWhitespace()) out.append(latex[i++])
            if (i >= end || latex[i] != '{') return
            var depth = 0
            while (i < end) {
                val c = latex[i]
                if (c == '\\' && i + 1 < end) { out.append(c).append(latex[i + 1]); i += 2; continue }
                out.append(c); i++
                if (c == '{') depth++ else if (c == '}' && --depth == 0) break
            }
        }
        while (i < end) {
            val c = latex[i]
            if (c == '\\') {
                var j = i + 1
                while (j < end && latex[j].isLetter()) j++
                if (j == i + 1) {
                    // 符号命令：\\、\{、\, 等。
                    j = minOf(i + 2, end)
                    val symbol = latex.substring(i, j)
                    out.append(symbol)
                    i = j
                    when (symbol) {
                        "\\\\" -> {
                            operand = false
                            // 换行后面可以带行距：\\[-2pt]。
                            val close = if (i < end && latex[i] == '[') latex.indexOf(']', i) else -1
                            if (close > 0) { out.append(latex, i, close + 1); i = close + 1 }
                        }
                        "\\,", "\\;", "\\:", "\\!", "\\ " -> Unit
                        "\\{", "\\(", "\\[", "\\|" -> operand = false
                        else -> operand = true
                    }
                    script = false
                    continue
                }
                val name = latex.substring(i + 1, j)
                out.append(latex, i, j)
                i = j
                when {
                    name in VERBATIM_ARGUMENT -> { copyGroup(); operand = true }
                    name in DIMENSION -> {
                        while (i < end && latex[i].isWhitespace()) out.append(latex[i++])
                        if (i < end && latex[i] == '-') out.append(latex[i++])
                        operand = false
                    }
                    // \right 后面的定界符（\right|、\right)）是式子的结尾。
                    name == "right" -> {
                        while (i < end && latex[i].isWhitespace()) out.append(latex[i++])
                        if (i < end && latex[i] != '\\') out.append(latex[i++])
                        operand = true
                    }
                    else -> operand = name !in BEFORE_SIGN
                }
                script = false
                continue
            }
            when {
                c == '{' -> { scripts.addLast(script || scripts.lastOrNull() == true); operand = false; script = false }
                c == '}' -> { scripts.removeLastOrNull(); operand = true; script = false }
                c == '^' || c == '_' -> { script = true; operand = false }
                c == '-' -> {
                    out.append(if (operand && !script && scripts.lastOrNull() != true) "\\minus " else "−")
                    operand = false
                    script = false
                    i++
                    continue
                }
                c.isWhitespace() -> Unit
                else -> { operand = c.isLetterOrDigit() || c in ")]'!."; script = false }
            }
            out.append(c)
            i++
        }
        return out.toString()
    }

    /** [text] 整段只有一个独立公式的占位符时，返回那个公式。 */
    fun displayFormula(text: String, formulas: List<Formula>): Formula? {
        val match = PLACEHOLDER.matchEntire(text.trim()) ?: return null
        return match.groupValues[1].toIntOrNull()?.let(formulas::getOrNull)?.takeIf { it.display }
    }

    // 不跨空行的一段（公式和行内代码都不会跨段落）。
    private const val NO_BLANK_LINE = """(?:(?!\n[ \t>]*\n)[\s\S])*?"""

    // 从左到右切，靠前的优先：1 转义的反斜杠、2 行内代码（3 是反引号）、4 链接地址和网址、5 \[…\]、6 \(…\)、7 $$…$$、
    // 8 \$、9 $…$、10 剩下的 $。
    private val TOKENS = Regex(
        listOf(
            """(\\\\)""",
            """((?<!`)(`+)(?!`)$NO_BLANK_LINE(?<!`)\3(?!`))""",
            """(\]\((?:\\.|[^()\\\s]|\((?:\\.|[^()\\\s])*\))*(?:[ \t]+"[^"\n]*")?\)|<https?:[^>\s]+>|https?://[^\s<>]+)""",
            """(?<![A-Za-z0-9\[])\\\[($NO_BLANK_LINE)\\\]""",
            """(?<![A-Za-z0-9])\\\(($NO_BLANK_LINE)\\\)""",
            """\$\$($NO_BLANK_LINE)\$\$""",
            """(\\\$)""",
            """\$(?!\s)((?:\\[\s\S]|[^$\\\n])+?)(?<!\s)\$(?!\d)""",
            """(\$)""",
        ).joinToString("|"),
    )

    private val FENCE_OPEN = Regex("""^ {0,3}(`{3,}|~{3,})(.*)$""")
    private val QUICK = Regex("""\$|\\\(|\\\[""")

    fun prepare(markdown: String): Prepared {
        if (!QUICK.containsMatchIn(markdown)) return Prepared(markdown, emptyList())
        val formulas = mutableListOf<Formula>()
        val output = mutableListOf<String>()
        val pending = mutableListOf<String>()
        var fenceChar = ' '
        var fenceLength = 0
        fun flush() {
            if (pending.isNotEmpty()) output += prepareText(pending.joinToString("\n"), formulas)
            pending.clear()
        }
        for (line in markdown.split("\n")) {
            if (fenceLength > 0) {
                output += line
                val closing = line.trim()
                if (closing.length >= fenceLength && closing.all { it == fenceChar }) fenceLength = 0
                continue
            }
            val open = FENCE_OPEN.find(line)
            // ``` 后面同一行还有 ` 的是行内代码，不是代码块的开头。
            if (open != null && !(open.groupValues[1][0] == '`' && '`' in open.groupValues[2])) {
                flush()
                fenceChar = open.groupValues[1][0]
                fenceLength = open.groupValues[1].length
                output += line
                continue
            }
            pending += line
        }
        flush()
        // 没有公式就原样返回（不成对的 $ 也不用转义）。
        return if (formulas.isEmpty()) Prepared(markdown, emptyList()) else Prepared(output.joinToString("\n"), formulas)
    }

    private fun prepareText(text: String, formulas: MutableList<Formula>): String =
        TOKENS.replace(text) { match ->
            val groups = match.groups
            fun add(latex: String, display: Boolean): String {
                formulas += Formula(latex, display)
                return placeholder(formulas.lastIndex)
            }
            // 结果按字面放回去：Kotlin 的 replace 不解释 lambda 返回值里的 $ 和 \。
            when {
                groups[1] != null || groups[2] != null || groups[4] != null || groups[8] != null -> match.value
                groups[5] != null -> {
                    val body = groups[5]!!.value
                    // \[ \]、\[x\] 是转义写法的任务列表方框，不是公式。
                    if (Regex("^[ xX]?$").matches(body)) match.value else display(text, match, body, formulas) ?: match.value
                }
                groups[6] != null -> {
                    val body = groups[6]!!.value.replace(Regex("""\s*\n\s*"""), " ").trim()
                    if (body.isEmpty()) match.value else add(body, false)
                }
                groups[7] != null -> display(text, match, groups[7]!!.value, formulas) ?: match.value
                groups[9] != null -> add(groups[9]!!.value, false)
                // 不成对的 $ 当普通字符。
                groups[10] != null -> "\\$"
                else -> match.value
            }
        }

    /**
     * 独立公式。从行首（只有缩进和引用的 >）开始、到行尾结束的，单独占一个段落：前后各空一行，保留缩进和 >，
     * 所以列表和引用里的公式留在原处；夹在句子中间的当行内公式。
     */
    private fun display(text: String, match: MatchResult, rawBody: String, formulas: MutableList<Formula>): String? {
        val offset = match.range.first
        val lineStart = text.lastIndexOf('\n', offset - 1) + 1
        val prefix = text.substring(lineStart, offset)
        val rest = text.substring(match.range.last + 1)
        val ownLines = prefix.all { it == ' ' || it == '\t' || it == '>' } && Regex("""^[ \t]*(?:\n|$)""").containsMatchIn(rest)
        val strip = if ('>' in prefix) Regex("""^[ \t>]+""") else Regex("""^[ \t]+""")
        val lines = rawBody.split("\n").map { it.replace(strip, "").trimEnd() }.filter { it.isNotEmpty() }
        if (lines.isEmpty()) return null
        formulas += Formula(lines.joinToString(if (ownLines) "\n" else " "), ownLines)
        if (!ownLines) return placeholder(formulas.lastIndex)
        // 前后已经是空行（或文字的开头、结尾）的不再加：连着两个空行会让解析器把列表项在这里截断。
        fun blank(line: String) = line.all { it == ' ' || it == '\t' || it == '>' }
        val before = lineStart == 0 || blank(text.substring(text.lastIndexOf('\n', lineStart - 2) + 1, lineStart - 1))
        val nextLine = rest.indexOf('\n').let { if (it < 0) null else rest.substring(it + 1).substringBefore('\n') }
        val after = nextLine == null || blank(nextLine)
        // 匹配的前面已经有这一行的前缀：要加空行时先换行（留下只有前缀的"空行"），再写前缀和占位符。
        return (if (before) "" else "\n$prefix") + placeholder(formulas.lastIndex) + (if (after) "" else "\n${prefix.trimEnd()}")
    }
}
