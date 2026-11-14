package com.kakumine.studymate.ui

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

// 回答正文，对照网页 .markdown-body（src/app/globals.css）：
//  - 正文 16 / 行高 1.72；标题 24.8 / 20.8 / 17.28，字重 650、颜色 --sm-ink、行高 1.3、字距 -0.015em；
//  - 相邻块之间 11.2（0.7rem）；列表缩进 24（21.6 + 2.4），实心圆点，列表项间距 1.28；
//  - 引用：左侧 3px 浅灰条，文字灰色，左内边距 14.4；链接蓝色、加粗、下划线；
//  - 行内代码、代码块用 --notes-code-bg 底色。
private val Body = TextStyle(fontSize = 16.sp, lineHeight = 27.52.sp, color = Sm.Text, letterSpacing = 0.sp)

private fun heading(size: Float) = TextStyle(
    fontSize = size.sp,
    lineHeight = (size * 1.3f).sp,
    fontWeight = FontWeight.SemiBold,
    letterSpacing = (size * -0.015f).sp,
    color = Sm.Ink,
)

private val Code = Body.copy(color = Color(0xFF111827), fontFamily = FontFamily.Monospace, fontSize = 15.2.sp, lineHeight = 25.08.sp)
private val LinkStyle = SpanStyle(color = Sm.Blue, fontWeight = FontWeight.Medium, textDecoration = TextDecoration.Underline)

private val ListIndent = 24.dp // ul/ol 的 padding-left 21.6 + li 的 padding-left 2.4

@Composable
fun AnswerMarkdown(content: String, muted: Boolean = false) {
    // 文字样式里写了颜色，会盖过 markdownColor 的 text，所以灰色版本要把颜色直接放进样式。
    val body = if (muted) Body.copy(color = Sm.Muted) else Body
    val colors = markdownColor(
        text = if (muted) Sm.Muted else Sm.Text,
        codeBackground = Sm.CodeBackground,
        inlineCodeBackground = Sm.CodeBackground,
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
        inlineCode = Code,
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
