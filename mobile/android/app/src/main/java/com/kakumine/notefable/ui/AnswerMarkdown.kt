package com.kakumine.notefable.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mikepenz.markdown.compose.components.markdownComponents
import com.mikepenz.markdown.compose.elements.MarkdownListItems
import com.mikepenz.markdown.compose.elements.listDepth
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.markdownPadding
import com.mikepenz.markdown.model.rememberMarkdownState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.style.TextOverflow as Overflow
import com.mikepenz.markdown.annotator.annotatorSettings
import com.mikepenz.markdown.annotator.buildMarkdownAnnotatedString
import com.mikepenz.markdown.compose.LocalMarkdownInlineContent
import com.mikepenz.markdown.compose.elements.MarkdownCodeBlock
import com.mikepenz.markdown.compose.elements.MarkdownCodeFence
import com.mikepenz.markdown.compose.elements.MarkdownTableBasicText
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMTokenTypes
import androidx.compose.foundation.text.appendInlineContent
import com.hrm.latex.renderer.Latex
import com.hrm.latex.renderer.measure.rememberLatexMeasurer
import com.hrm.latex.renderer.model.LatexConfig
import com.hrm.latex.renderer.model.LatexTheme
import com.kakumine.notefable.data.MathMarkdown
import com.mikepenz.markdown.compose.elements.MarkdownParagraph
import com.mikepenz.markdown.model.MarkdownAnnotator
import com.mikepenz.markdown.model.markdownAnnotator
import com.mikepenz.markdown.model.markdownInlineContent
import org.intellij.markdown.MarkdownTokenTypes

// 回答正文，对照网页 .markdown-body（src/app/globals.css）：
//  - 正文 16 / 行高 1.72；标题 24.8 / 20.8 / 17.28，字重 650、颜色 --nf-ink、行高 1.3、字距 -0.015em；
//  - 相邻块之间 11.2（0.7rem）；列表缩进 24（21.6 + 2.4），实心圆点，列表项间距 1.28；
//  - 引用：左侧 3px 浅灰条，文字灰色，左内边距 14.4；链接蓝色、加粗、下划线；
//  - 行内代码（.markdown-inline-code）：#e2e8f0 底、#0f172a、等宽 0.85em（13.6）；
//  - 代码块：带语言名和复制键的外框与高亮，见 CodeBlock.kt；
//  - 表格：单元格 1px --notion-border-strong 边框、内边距 7.2×11.2、左上对齐、最窄 88（手机），
//    表头 --nf-user-bubble 底、--nf-ink、600；列宽按内容自动分配，放不下时横向滚动（见 [AnswerTable]）。
private val Body get() = TextStyle(fontSize = 16.sp, lineHeight = 27.52.sp, color = Sm.Text, letterSpacing = 0.sp)

private fun heading(size: Float, rtl: Boolean) = TextStyle(
    fontSize = size.sp,
    lineHeight = (size * 1.3f).sp,
    fontWeight = FontWeight.SemiBold,
    letterSpacing = if (rtl) 0.sp else (size * -0.015f).sp,
    color = Sm.Ink,
)

private val Code get() = Body.copy(color = Sm.pick(Color(0xFF111827), Sm.Text), fontFamily = FontFamily.Monospace, fontSize = 15.2.sp, lineHeight = 25.08.sp)
private val InlineCode get() = Body.copy(color = Sm.pick(Color(0xFF0F172A), Color(0xFFF3F4F6)), fontFamily = FontFamily.Monospace, fontSize = 13.6.sp)
private val LinkStyle get() = SpanStyle(color = Sm.Blue, fontWeight = FontWeight.Medium, textDecoration = TextDecoration.Underline)

private val ListIndent = 24.dp // ul/ol 的 padding-left 21.6 + li 的 padding-left 2.4

@Composable
fun AnswerMarkdown(content: String, muted: Boolean = false) {
    // 数学公式（网页用 KaTeX，见 docs/architecture/chat-flow.md）：先把公式换成占位符，Markdown 照常排版，
    // 再在占位符的位置放上排好版的公式。没有公式的回答和原来完全一样。
    val math = remember(content) { MathMarkdown.prepare(content) }
    AnswerBlocks(math.text, math.formulas, muted)
}

/** [text] 是换好占位符的 Markdown（[MathMarkdown.prepare]）；引用块用同一份 [formulas] 递归进来。 */
@Composable
private fun AnswerBlocks(text: String, formulas: List<MathMarkdown.Formula>, muted: Boolean) {
    // 文字样式里写了颜色，会盖过 markdownColor 的 text，所以灰色版本要把颜色直接放进样式。
    val body = if (muted) Body.copy(color = Sm.Muted) else Body
    val colors = markdownColor(
        text = if (muted) Sm.Muted else Sm.Text,
        codeBackground = Sm.CodeBackground,
        inlineCodeBackground = Sm.pick(Color(0xFFE2E8F0), Color(0x1AFFFFFF)),
        dividerColor = Sm.Border,
    )
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val typography = markdownTypography(
        h1 = heading(24.8f, rtl),
        h2 = heading(20.8f, rtl),
        h3 = heading(17.28f, rtl),
        h4 = heading(17.28f, rtl),
        h5 = heading(17.28f, rtl),
        h6 = heading(17.28f, rtl),
        text = body,
        paragraph = body,
        ordered = body,
        bullet = body,
        list = body,
        quote = body,
        code = Code,
        inlineCode = InlineCode,
        textLink = TextLinkStyles(style = LinkStyle),
    )
    val padding = markdownPadding(
        // 库把间距加在每个块的上下两侧，所以取一半：相邻两块之间才是网页的 11.2。
        block = 5.6.dp,
        list = 5.6.dp,
        // 网页 li 的上下外边距 1.28 会折叠成一份，所以每个 li 上下各 0.64。
        listItemTop = 0.64.dp,
        listItemBottom = 0.64.dp,
        listIndent = ListIndent,
    )
    val components = remember(muted, formulas) {
        markdownComponents(
            // 整段只有一个独立公式的，画成居中的公式；其余段落照常。
            paragraph = { model ->
                val formula = MathMarkdown.displayFormula(model.content.substring(model.node.startOffset, model.node.endOffset), formulas)
                if (formula != null) DisplayMath(formula.latex, muted)
                else MarkdownParagraph(model.content, model.node, style = model.typography.paragraph)
            },
            // 围栏代码和缩进代码都用网页的代码块外框（网页 pre 统一换成 MarkdownCodeBlock）。
            codeFence = { model ->
                // ```math 的代码块是独立公式（网页由 rehype-katex 画）。
                MarkdownCodeFence(model.content, model.node, Code) { code, language, _ ->
                    if (language == "math" && code.isNotBlank()) DisplayMath(code.trim(), muted) else CodeBlock(code, language)
                }
            },
            codeBlock = { model ->
                MarkdownCodeBlock(model.content, model.node, Code) { code, language, _ -> CodeBlock(code, language) }
            },
            table = { model -> AnswerTable(model.content, model.node, body) },
            unorderedList = { model ->
                MarkdownListItems(
                    content = model.content,
                    node = model.node,
                    depth = model.listDepth,
                    markerModifier = { Modifier },
                    listModifier = { Modifier },
                ) { _, _, _ ->
                    // 实心圆点：直径 5.6，圆心在缩进 24 的左侧 7 处，垂直居中于第一行。
                    Box(Modifier.width(ListIndent).height(27.52.dp)) {
                        Box(
                            Modifier.align(Alignment.CenterStart).padding(start = 4.2.dp, bottom = 4.dp).size(5.6.dp)
                                .background(if (muted) Sm.Muted else Sm.Text, CircleShape),
                        )
                    }
                }
            },
            orderedList = { model ->
                MarkdownListItems(
                    content = model.content,
                    node = model.node,
                    depth = model.listDepth,
                    markerModifier = { Modifier.alignByBaseline() },
                    listModifier = { Modifier.alignByBaseline() },
                ) { index, startNumber, _ ->
                    // 编号与首行正文共用基线，长编号可向左延伸，不挤压正文或折行。
                    Box(Modifier.width(ListIndent).height(27.52.dp), Alignment.TopEnd) {
                        Text(
                            "${index + startNumber}.",
                            modifier = Modifier.padding(end = 6.dp),
                            style = body,
                            textAlign = TextAlign.End,
                            maxLines = 1,
                            softWrap = false,
                            overflow = TextOverflow.Visible,
                        )
                    }
                }
            },
            blockQuote = { model ->
                // 去掉每行开头的 ">"，用灰色文字重新渲染引用里的内容。
                val quoted = model.content.substring(model.node.startOffset, model.node.endOffset)
                    .lines().joinToString("\n") { it.trimStart().removePrefix(">").removePrefix(" ") }
                Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(Modifier.width(3.dp).fillMaxHeight().background(Sm.BorderStrong))
                    Spacer(Modifier.width(14.4.dp))
                    AnswerBlocks(quoted, formulas, muted = true)
                }
            },
        )
    }

    // 兜底：库里没显式带行高的文字（如列表项内容）也用正文的行高，否则列表会比网页紧。
    // 流式追加时保留上一帧的解析结果，避免每次异步解析都先显示空白加载态。
    val markdownState = rememberMarkdownState(text, retainState = true)
    if (formulas.isEmpty()) {
        ProvideTextStyle(body) {
            Markdown(markdownState = markdownState, colors = colors, typography = typography, padding = padding, components = components)
        }
        return
    }
    val config = mathConfig(muted)
    val measurer = rememberLatexMeasurer(config)
    // 行内公式：先量好大小，按基线嵌进文字。量不出来的（写错、还没写完）不放进表里，占位符的位置显示 LaTeX 源码。
    val inline = remember(formulas, measurer, config) {
        buildMap {
            formulas.forEachIndexed { index, formula ->
                runCatching { measurer.inlineContent(MathMarkdown.typeset(formula.latex), config, false) }.getOrNull()?.let { put(mathKey(index), it) }
            }
        }
    }
    val annotator = remember(formulas) { mathAnnotator(formulas) }
    ProvideTextStyle(body) {
        Markdown(
            markdownState = markdownState, colors = colors, typography = typography, padding = padding, components = components,
            annotator = annotator, inlineContent = markdownInlineContent(inline),
        )
    }
}

/** 网页的 .katex 是正文的 1.21 倍（16 → 19.36）。颜色跟正文（引用里是灰色）。 */
@Composable
private fun mathConfig(muted: Boolean) = remember(muted, Sm.isDark) {
    LatexConfig(fontSize = 19.36.sp, theme = LatexTheme.light(color = if (muted) Sm.Muted else Sm.Text, backgroundColor = Color.Transparent))
}

/** 独立公式（网页 .katex-display）：单独一块，居中，上下 14.4；比屏幕宽时在公式里横向滚动。数学公式始终从左往右排。 */
@Composable
private fun DisplayMath(latex: String, muted: Boolean) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        Box(Modifier.fillMaxWidth().padding(vertical = 8.8.dp).horizontalScroll(rememberScrollState()), Alignment.Center) {
            Latex(remember(latex) { MathMarkdown.typeset(latex) }, Modifier, mathConfig(muted), false)
        }
    }
}

private fun mathKey(index: Int) = "math-$index"

/** 文字里的公式占位符换成行内内容（没量出来的公式，Compose 会显示这里给的替代文字，也就是 LaTeX 源码）。 */
private fun mathAnnotator(formulas: List<MathMarkdown.Formula>): MarkdownAnnotator = markdownAnnotator { content, child ->
    if (child.type != MarkdownTokenTypes.TEXT) return@markdownAnnotator false
    val text = content.substring(child.startOffset, child.endOffset)
    if (MathMarkdown.OPEN !in text) return@markdownAnnotator false
    var last = 0
    for (match in MathMarkdown.PLACEHOLDER.findAll(text)) {
        append(text, last, match.range.first)
        val index = match.groupValues[1].toIntOrNull()
        val formula = index?.let(formulas::getOrNull)
        if (formula != null) appendInlineContent(mathKey(index), formula.latex) else append(match.value)
        last = match.range.last + 1
    }
    append(text, last, text.length)
    true
}

private val CellMinWidth = 88.dp // 手机上 th/td 的 min-width 5.5rem（含内边距和边框）
private val CellPaddingH = 11.2.dp
private val CellPaddingV = 7.2.dp

/** 量好的列宽和行高，画边框和表头底色时用。 */
private class TableGeometry {
    var columns = IntArray(0)
    var rows = IntArray(0)
}

/**
 * GFM 表格（网页 .markdown-body table / th / td）。列宽按浏览器自动表格布局的做法分配：
 * 每列最窄 = max(88, 最长的词)，最宽 = 不折行的宽度；全放得下用最宽，最窄都放不下就用最窄并横向滚动，
 * 中间情况按 (最宽 − 最窄) 的比例分配多出来的宽度。单元格一律左对齐、顶端对齐（网页 CSS 盖过了 GFM 的对齐标记）。
 */
@Composable
private fun AnswerTable(content: String, node: ASTNode, body: TextStyle) {
    val rows = node.children.filter { it.type == GFMElementTypes.HEADER || it.type == GFMElementTypes.ROW }
    if (rows.isEmpty()) return
    val cells = rows.map { row -> row.children.filter { it.type == GFMTokenTypes.CELL } }
    val columnCount = cells.maxOf { it.size }.coerceAtLeast(1)
    val headerStyle = body.copy(color = Sm.Ink, fontWeight = FontWeight.SemiBold)
    // 表头底色：--nf-user-bubble；深色 rgba(255,255,255,.05)（:root[data-theme="dark"] .markdown-body table th）。
    val headerFill = Sm.pick(Sm.UserBubble, Color(0x0DFFFFFF))
    val settings = annotatorSettings()
    val inline = LocalMarkdownInlineContent.current.inlineContent
    val geometry = remember { TableGeometry() }

    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val available = constraints.maxWidth
        Box(Modifier.horizontalScroll(rememberScrollState())) {
            Layout(
                content = {
                    cells.forEachIndexed { rowIndex, row ->
                        val header = rows[rowIndex].type == GFMElementTypes.HEADER
                        repeat(columnCount) { column ->
                            Box(Modifier.padding(horizontal = CellPaddingH, vertical = CellPaddingV)) {
                                val cell = row.getOrNull(column)
                                val style = if (header) headerStyle else body
                                if (cell != null && inline.isEmpty()) {
                                    MarkdownTableBasicText(
                                        content = content,
                                        cell = cell,
                                        style = style,
                                        maxLines = Int.MAX_VALUE,
                                        overflow = Overflow.Clip,
                                        annotatorSettings = settings,
                                    )
                                } else if (cell != null) {
                                    // 库的单元格文字不带行内内容，有公式的回答要自己排，公式才显示得出来。
                                    val text = remember(content, cell, style, settings) { content.buildMarkdownAnnotatedString(cell, style, settings) }
                                    Text(text, style = style, inlineContent = inline)
                                }
                            }
                        }
                    }
                },
                modifier = Modifier.drawBehind {
                    val line = 1.dp.toPx()
                    val width = geometry.columns.sum().toFloat()
                    val height = geometry.rows.sum().toFloat()
                    if (rows.first().type == GFMElementTypes.HEADER && geometry.rows.isNotEmpty()) {
                        drawRect(headerFill, size = Size(width, geometry.rows[0].toFloat()))
                    }
                    var y = 0f
                    for (i in 0..geometry.rows.size) {
                        val at = (y - line / 2).coerceIn(line / 2, height - line / 2)
                        drawLine(Sm.BorderStrong, Offset(0f, at), Offset(width, at), line)
                        if (i < geometry.rows.size) y += geometry.rows[i]
                    }
                    var x = 0f
                    val cols = if (layoutDirection == LayoutDirection.Rtl) geometry.columns.reversedArray() else geometry.columns
                    for (i in 0..cols.size) {
                        val at = (x - line / 2).coerceIn(line / 2, width - line / 2)
                        drawLine(Sm.BorderStrong, Offset(at, 0f), Offset(at, height), line)
                        if (i < cols.size) x += cols[i]
                    }
                },
            ) { measurables, _ ->
                val minCell = CellMinWidth.roundToPx()
                val grid = measurables.chunked(columnCount)
                val minWidths = IntArray(columnCount) { column ->
                    maxOf(minCell, grid.maxOf { it[column].minIntrinsicWidth(Int.MAX_VALUE) })
                }
                val maxWidths = IntArray(columnCount) { column ->
                    maxOf(minWidths[column], grid.maxOf { it[column].maxIntrinsicWidth(Int.MAX_VALUE) })
                }
                val widths = tableColumnWidths(minWidths, maxWidths, available)
                val placeables = grid.map { row -> row.mapIndexed { column, cell -> cell.measure(androidx.compose.ui.unit.Constraints.fixedWidth(widths[column])) } }
                val heights = placeables.map { row -> row.maxOf { it.height } }.toIntArray()
                geometry.columns = widths
                geometry.rows = heights
                layout(widths.sum(), heights.sum()) {
                    var y = 0
                    placeables.forEachIndexed { rowIndex, row ->
                        var x = 0
                        row.forEachIndexed { column, placeable ->
                            placeable.placeRelative(x, y)
                            x += widths[column]
                        }
                        y += heights[rowIndex]
                    }
                }
            }
        }
    }
}

/** 浏览器自动表格布局的列宽分配（单独拿出来便于单元测试）。 */
internal fun tableColumnWidths(minWidths: IntArray, maxWidths: IntArray, available: Int): IntArray {
    val minSum = minWidths.sum()
    val maxSum = maxWidths.sum()
    return when {
        maxSum <= available -> maxWidths.copyOf()
        minSum >= available || maxSum == minSum -> minWidths.copyOf()
        else -> {
            val extra = available - minSum
            val spread = (maxSum - minSum).toDouble()
            val widths = IntArray(minWidths.size) { i -> minWidths[i] + ((maxWidths[i] - minWidths[i]) * extra / spread).toInt() }
            // 取整丢掉的几个像素补给最后一列，总宽正好等于可用宽度。
            widths[widths.lastIndex] += available - widths.sum()
            widths
        }
    }
}
