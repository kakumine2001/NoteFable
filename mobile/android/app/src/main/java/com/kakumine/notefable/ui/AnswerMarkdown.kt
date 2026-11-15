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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
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
import com.mikepenz.markdown.compose.elements.MarkdownCodeBlock
import com.mikepenz.markdown.compose.elements.MarkdownCodeFence
import com.mikepenz.markdown.compose.elements.MarkdownTableBasicText
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMTokenTypes

// 回答正文，对照网页 .markdown-body（src/app/globals.css）：
//  - 正文 16 / 行高 1.72；标题 24.8 / 20.8 / 17.28，字重 650、颜色 --sm-ink、行高 1.3、字距 -0.015em；
//  - 相邻块之间 11.2（0.7rem）；列表缩进 24（21.6 + 2.4），实心圆点，列表项间距 1.28；
//  - 引用：左侧 3px 浅灰条，文字灰色，左内边距 14.4；链接蓝色、加粗、下划线；
//  - 行内代码（.markdown-inline-code）：#e2e8f0 底、#0f172a、等宽 0.85em（13.6）；
//  - 代码块：带语言名和复制键的外框与高亮，见 CodeBlock.kt；
//  - 表格：单元格 1px --notion-border-strong 边框、内边距 7.2×11.2、左上对齐、最窄 88（手机），
//    表头 --sm-user-bubble 底、--sm-ink、600；列宽按内容自动分配，放不下时横向滚动（见 [AnswerTable]）。
private val Body = TextStyle(fontSize = 16.sp, lineHeight = 27.52.sp, color = Sm.Text, letterSpacing = 0.sp)

private fun heading(size: Float) = TextStyle(
    fontSize = size.sp,
    lineHeight = (size * 1.3f).sp,
    fontWeight = FontWeight.SemiBold,
    letterSpacing = (size * -0.015f).sp,
    color = Sm.Ink,
)

private val Code = Body.copy(color = Color(0xFF111827), fontFamily = FontFamily.Monospace, fontSize = 15.2.sp, lineHeight = 25.08.sp)
private val InlineCode = Body.copy(color = Color(0xFF0F172A), fontFamily = FontFamily.Monospace, fontSize = 13.6.sp)
private val LinkStyle = SpanStyle(color = Sm.Blue, fontWeight = FontWeight.Medium, textDecoration = TextDecoration.Underline)

private val ListIndent = 24.dp // ul/ol 的 padding-left 21.6 + li 的 padding-left 2.4

@Composable
fun AnswerMarkdown(content: String, muted: Boolean = false) {
    // 文字样式里写了颜色，会盖过 markdownColor 的 text，所以灰色版本要把颜色直接放进样式。
    val body = if (muted) Body.copy(color = Sm.Muted) else Body
    val colors = markdownColor(
        text = if (muted) Sm.Muted else Sm.Text,
        codeBackground = Sm.CodeBackground,
        inlineCodeBackground = Color(0xFFE2E8F0),
        dividerColor = Sm.Border,
    )
    val typography = markdownTypography(
        h1 = heading(24.8f),
        h2 = heading(20.8f),
        h3 = heading(17.28f),
        h4 = heading(17.28f),
        h5 = heading(17.28f),
        h6 = heading(17.28f),
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
    val components = remember(muted) {
        markdownComponents(
            // 围栏代码和缩进代码都用网页的代码块外框（网页 pre 统一换成 MarkdownCodeBlock）。
            codeFence = { model ->
                MarkdownCodeFence(model.content, model.node, Code) { code, language, _ -> CodeBlock(code, language) }
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
                    AnswerMarkdown(quoted, muted = true)
                }
            },
        )
    }

    // 兜底：库里没显式带行高的文字（如列表项内容）也用正文的行高，否则列表会比网页紧。
    // 流式追加时保留上一帧的解析结果，避免每次异步解析都先显示空白加载态。
    val markdownState = rememberMarkdownState(content, retainState = true)
    ProvideTextStyle(body) {
        Markdown(markdownState = markdownState, colors = colors, typography = typography, padding = padding, components = components)
    }
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
    val settings = annotatorSettings()
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
                                if (cell != null) {
                                    MarkdownTableBasicText(
                                        content = content,
                                        cell = cell,
                                        style = if (header) headerStyle else body,
                                        maxLines = Int.MAX_VALUE,
                                        overflow = Overflow.Clip,
                                        annotatorSettings = settings,
                                    )
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
                        drawRect(Sm.UserBubble, size = Size(width, geometry.rows[0].toFloat()))
                    }
                    var y = 0f
                    for (i in 0..geometry.rows.size) {
                        val at = (y - line / 2).coerceIn(line / 2, height - line / 2)
                        drawLine(Sm.BorderStrong, Offset(0f, at), Offset(width, at), line)
                        if (i < geometry.rows.size) y += geometry.rows[i]
                    }
                    var x = 0f
                    for (i in 0..geometry.columns.size) {
                        val at = (x - line / 2).coerceIn(line / 2, width - line / 2)
                        drawLine(Sm.BorderStrong, Offset(at, 0f), Offset(at, height), line)
                        if (i < geometry.columns.size) x += geometry.columns[i]
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
                            placeable.place(x, y)
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
