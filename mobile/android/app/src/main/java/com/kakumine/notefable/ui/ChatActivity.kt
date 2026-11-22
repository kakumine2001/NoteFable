package com.kakumine.notefable.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.Activity
import com.kakumine.notefable.data.ActivityStep
import com.kakumine.notefable.data.ActivitySummary
import com.kakumine.notefable.data.SystemTextTranslator
import com.kakumine.notefable.data.WebAction
import kotlinx.coroutines.delay
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.URLDecoder
import kotlin.math.roundToInt

// 回答上方的过程面板（网页 chat-activity.tsx + globals.css 的 .chat-activity*，412x915 实测）：
//  - 整体 13.12 / 行高 20.336、灰色，下距 10.4；
//  - 标题行：左移 5.6、内边距 5.6×2.4、圆角 4、间距 4.8、500 字重，单行省略；箭头 14（描边 2），展开时转 90°；
//    等待中文字上有流动的高光（chat-activity-shimmer，1.8 秒一轮）；
//  - 步骤列表：上 5.6、左 3.2，1px 左线（.18），左内边距 13.6、上下 1.6，最高 352 可滚动，等待中跟到最新一步；
//  - 每步：上下 4.8、间距 8；图标 13（描边 1.9）浅灰，放在高 20.8 的格子里；标题 500 正文色，正文灰色上距 2.4；
//  - 来源标签：上距 6.4、间距 4.8；全圆角、1px .09 描边、#F7F7F5 底、12 / 18.6 灰字、内边距 7.2×0.8、最宽 224、地球 11。

private val ActivityText get() = TextStyle(fontSize = 13.12.sp, lineHeight = 20.336.sp, color = Sm.Muted, letterSpacing = 0.sp)
private val ChipText get() = TextStyle(fontSize = 12.sp, lineHeight = 18.6.sp, color = Sm.Muted, letterSpacing = 0.sp)
private const val VISIBLE_SOURCES = 6

/** 等待中的秒数（网页 thinkingSeconds：最少 1 秒，每秒更新）。[startedAt] 为 null 时从第一次显示开始算。 */
@Composable
internal fun rememberWaitingSeconds(startedAt: Long?): Int {
    val start = remember(startedAt) { startedAt ?: System.currentTimeMillis() }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(start) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000 - (now - start) % 1000)
        }
    }
    return maxOf(1, ((now - start) / 1000.0).roundToInt())
}

/**
 * [steps] 是进度步骤（不含提案和失败位置）。[thinking] 为 true 时还没收到正文：显示"当前一步 · N 秒"并自动展开；
 * 否则显示"已思考 N 秒 · 统计"并收起。[seconds] 为 null 时显示"思考过程"。
 */
@Composable
internal fun ChatActivity(
    steps: List<ActivityStep>,
    thinking: Boolean,
    seconds: Int?,
    onOpenNote: (String) -> Unit,
) {
    val systemText = rememberSystemText()
    // null 表示用户还没点过：等待中展开，正文来了自动收起。
    var manualOpen by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val open = steps.isNotEmpty() && (manualOpen ?: thinking)
    val time = seconds?.let { "${it}s" }
    val label = if (thinking) {
        listOfNotNull(describeCurrent(steps, systemText), time).joinToString(" · ")
    } else {
        (listOf(time?.let { stringResource(R.string.activity_thought_for, it) } ?: stringResource(R.string.activity_thought_process)) +
            summaryParts(ActivitySummary.of(steps))).joinToString(" · ")
    }

    Column(Modifier.fillMaxWidth().padding(bottom = 10.4.dp)) {
        Row(
            Modifier.offset(x = (-5.6).dp).clip(RoundedCornerShape(4.dp))
                .then(if (steps.isNotEmpty()) Modifier.clickable(role = Role.Button) { manualOpen = !open } else Modifier)
                .padding(horizontal = 5.6.dp, vertical = 2.4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.8.dp),
        ) {
            Text(
                label,
                style = ActivityText.copy(fontWeight = FontWeight.Medium).let { if (thinking) it.copy(brush = shimmerBrush()) else it },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (steps.isNotEmpty()) {
                val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
                Box(Modifier.size(14.dp).rotate(if (open) (if (rtl) -90f else 90f) else 0f)) {
                    LucideIcon(Lucide.ChevronRight, 14.dp, Sm.Muted, strokeWidth = 2f)
                }
            }
        }
        if (open) {
            val scroll = rememberScrollState()
            // 等待中列表有高度上限，跟到最新一步。
            LaunchedEffect(thinking, steps) { if (thinking) scroll.scrollTo(scroll.maxValue) }
            Column(
                Modifier.padding(start = 3.2.dp, top = 5.6.dp).heightIn(max = 352.dp)
                    .drawBehind {
                        val lineW = 1.dp.toPx()
                        val lineX = if (layoutDirection == LayoutDirection.Rtl) size.width - lineW else 0f
                        drawRect(Sm.BorderStrong, topLeft = Offset(lineX, 0f), size = size.copy(width = lineW))
                    }
                    .verticalScroll(scroll)
                    .padding(start = 13.6.dp, top = 1.6.dp, bottom = 1.6.dp),
            ) {
                steps.forEach { step -> StepRow(step, systemText, onOpenNote) }
            }
        }
    }
}

// 等待中的流动高光：灰 → 浅灰 → 灰，背景宽 250%，1.8 秒从右移到左（网页 chat-activity-shimmer）。
@Composable
private fun shimmerBrush(): Brush {
    val transition = rememberInfiniteTransition(label = "activity-shimmer")
    val progress by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "shimmer")
    val width = 600f
    val x = width * (1f - progress * 2.5f) + width * 0.5f
    return Brush.linearGradient(
        0f to Sm.Muted, 0.4f to Sm.Muted, 0.5f to Sm.Faint, 0.6f to Sm.Muted, 1f to Sm.Muted,
        start = Offset(x - width, 0f), end = Offset(x + width * 1.5f, 0f), tileMode = TileMode.Clamp,
    )
}

// 标题行的"现在在做什么"：最后一步的一句话（网页 describeCurrent）。
@Composable
private fun describeCurrent(steps: List<ActivityStep>, systemText: SystemTextTranslator): String {
    val thinking = stringResource(R.string.activity_thinking)
    return when (val last = steps.lastOrNull()) {
        null -> thinking
        is ActivityStep.Thought -> Activity.splitThought(last.text).first.ifEmpty { thinking }
        is ActivityStep.Tool -> if (last.done && last.label != null) systemText.localize(last.label) else toolRunningLabel(last.name)
        is ActivityStep.Context -> stringResource(R.string.activity_using_project, last.info.projectName)
        is ActivityStep.Web -> {
            val action = last.action
            when {
                !last.done || action == null -> stringResource(R.string.activity_searching_web)
                action is WebAction.Search -> action.queries.firstOrNull()?.let { stringResource(R.string.activity_searching_query, it) }
                    ?: stringResource(R.string.activity_searching_web)
                action is WebAction.OpenPage -> stringResource(R.string.activity_reading_host, Activity.hostOf(action.url))
                action is WebAction.FindInPage -> stringResource(R.string.activity_scanning_host, Activity.hostOf(action.url))
                else -> stringResource(R.string.activity_searching_web)
            }
        }
        else -> thinking
    }
}

@Composable
private fun toolRunningLabel(name: String): String =
    stringResource(if (name == "search_notes") R.string.activity_searching_notes else R.string.activity_reading_note)

// 完成后的统计（网页 summarize）：搜索次数、来源数、笔记查询、项目笔记 / 项目指示。
@Composable
private fun summaryParts(summary: ActivitySummary): List<String> = listOfNotNull(
    when (summary.searches) {
        0 -> null
        1 -> stringResource(R.string.activity_one_search)
        else -> stringResource(R.string.activity_searches, summary.searches.toString())
    },
    when (summary.sources) {
        0 -> null
        1 -> stringResource(R.string.activity_one_source)
        else -> stringResource(R.string.activity_sources, summary.sources.toString())
    },
    when (summary.noteLookups) {
        0 -> null
        1 -> stringResource(R.string.activity_one_note_lookup)
        else -> stringResource(R.string.activity_note_lookups, summary.noteLookups.toString())
    },
    when {
        summary.projectNotes == 1 -> stringResource(R.string.activity_one_project_note)
        summary.projectNotes > 1 -> stringResource(R.string.activity_project_notes, summary.projectNotes.toString())
        summary.projectInstructions -> stringResource(R.string.activity_project_instructions)
        else -> null
    },
)

@Composable
private fun StepRow(step: ActivityStep, systemText: SystemTextTranslator, onOpenNote: (String) -> Unit) {
    val uriHandler = LocalUriHandler.current
    val openUrl: (String) -> Unit = { url -> runCatching { uriHandler.openUri(url) } }
    when (step) {
        is ActivityStep.Thought -> {
            val (title, body) = Activity.splitThought(step.text)
            StepShell(Lucide.Lightbulb) {
                if (title.isNotEmpty()) StepTitle(title)
                if (body.isNotEmpty()) Text(body, style = ActivityText, modifier = Modifier.padding(top = 2.4.dp))
            }
        }
        is ActivityStep.Context -> {
            val info = step.info
            val used = listOfNotNull(
                if (info.hasInstructions) stringResource(R.string.activity_instructions) else null,
                when (info.notes.size) {
                    0 -> null
                    1 -> stringResource(R.string.activity_one_reference_note)
                    else -> stringResource(R.string.activity_reference_notes, info.notes.size.toString())
                },
            )
            StepShell(Lucide.FolderOpen) {
                StepTitle(stringResource(R.string.activity_used_project, info.projectName, used.joinToString(" + ")))
                if (info.notes.isNotEmpty()) {
                    Chips {
                        info.notes.forEach { note ->
                            Chip(Lucide.NotebookText, note.title, onClick = { onOpenNote(note.id) }) {
                                if (note.truncated) {
                                    Text(stringResource(R.string.activity_partial), style = ChipText.copy(fontSize = 11.sp, color = Sm.Faint), maxLines = 1)
                                }
                            }
                        }
                    }
                }
            }
        }
        is ActivityStep.Tool -> {
            val icon = when {
                !step.done -> Lucide.LoaderCircle
                step.name == "search_notes" -> Lucide.FileSearch
                else -> Lucide.NotebookText
            }
            StepShell(icon, spinning = !step.done) {
                StepTitle(if (step.done && step.label != null) systemText.localize(step.label) else toolRunningLabel(step.name) + "…")
            }
        }
        is ActivityStep.Web -> {
            val action = step.action
            when {
                !step.done || action == null -> StepShell(Lucide.LoaderCircle, spinning = true) {
                    StepTitle(stringResource(R.string.activity_searching_web_running))
                }
                action is WebAction.Search -> StepShell(Lucide.Search) {
                    StepTitle(stringResource(R.string.activity_searched))
                    Column(Modifier.padding(top = 3.2.dp)) {
                        val queries = action.queries.ifEmpty { listOf(stringResource(R.string.activity_the_web)) }
                        queries.forEach { Text("“$it”", style = ActivityText) }
                    }
                    SourceChips(action.sources, openUrl)
                }
                else -> {
                    val (url, find) = when (action) {
                        is WebAction.FindInPage -> action.url to action
                        is WebAction.OpenPage -> action.url to null
                        else -> return
                    }
                    StepShell(if (find != null) Lucide.TextSearch else Lucide.FileText) {
                        val lead = if (find != null) stringResource(R.string.activity_looked_for, find.pattern) else stringResource(R.string.activity_read)
                        // 标题 500 正文色，后面的地址是灰色、400、带浅色下划线的链接。
                        Text(
                            buildAnnotatedString {
                                append(lead)
                                append(" ")
                                withStyle(SpanStyle(color = Sm.Muted, fontWeight = FontWeight.Normal, textDecoration = TextDecoration.Underline)) {
                                    append(shortUrl(url))
                                }
                            },
                            style = ActivityText.copy(color = Sm.Text, fontWeight = FontWeight.Medium),
                            modifier = Modifier.clickable(role = Role.Button) { openUrl(url) },
                        )
                    }
                }
            }
        }
        else -> Unit
    }
}

@Composable
private fun StepShell(icon: List<String>, spinning: Boolean = false, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.8.dp)) {
        Box(Modifier.width(13.dp).heightIn(min = 20.8.dp), Alignment.Center) {
            if (spinning) Spinner(13.dp, Sm.Faint) else LucideIcon(icon, 13.dp, Sm.Faint, strokeWidth = 1.9f)
        }
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) { content() }
    }
}

@Composable
private fun StepTitle(text: String) {
    Text(text, style = ActivityText.copy(color = Sm.Text, fontWeight = FontWeight.Medium))
}

@Composable
private fun Chips(content: @Composable () -> Unit) {
    FlowRow(
        Modifier.padding(top = 6.4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.8.dp),
        verticalArrangement = Arrangement.spacedBy(4.8.dp),
    ) { content() }
}

@Composable
private fun Chip(icon: List<String>?, text: String, onClick: () -> Unit, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier.widthIn(max = 224.dp).clip(RoundedCornerShape(999.dp))
            .background(Sm.Sidebar).border(1.dp, Sm.Border, RoundedCornerShape(999.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 7.2.dp, vertical = 0.8.dp)
            .semantics { role = Role.Button },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) LucideIcon(icon, 11.dp, Sm.Muted, strokeWidth = 2f)
        Text(text, style = ChipText, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        trailing()
    }
}

// 一次搜索可能带回近 20 个来源，先显示 6 个，其余收在"+N"里（网页 SourceChips）。
@Composable
private fun SourceChips(urls: List<String>, openUrl: (String) -> Unit) {
    if (urls.isEmpty()) return
    var showAll by rememberSaveable { mutableStateOf(false) }
    val hidden = if (showAll) 0 else maxOf(0, urls.size - VISIBLE_SOURCES)
    Chips {
        urls.take(urls.size - hidden).forEach { url -> Chip(Lucide.Globe, sourceLabel(url), onClick = { openUrl(url) }) }
        if (hidden > 0) Chip(null, stringResource(R.string.activity_more, hidden.toString()), onClick = { showAll = true })
    }
}

// 标签上同时写站点和页面名，同一站点的几条结果也能分开（网页 sourceLabel）。
internal fun sourceLabel(url: String): String {
    val parsed = url.toHttpUrlOrNull() ?: return url
    // pathSegments 已经解码（网页 decodeURIComponent）。
    val segment = parsed.pathSegments.lastOrNull { it.isNotEmpty() }
    return if (segment != null) "${Activity.hostOf(url)} › $segment" else Activity.hostOf(url)
}

// 主机名 + 路径（网页 shortUrl）。
internal fun shortUrl(url: String): String {
    val parsed = url.toHttpUrlOrNull() ?: return url
    val path = parsed.encodedPath.let { if (it == "/") "" else decode(it) }
    return Activity.hostOf(url) + path
}

private fun decode(value: String): String = runCatching { URLDecoder.decode(value.replace("+", "%2B"), "UTF-8") }.getOrDefault(value)

/** 转圈的 LoaderCircle（网页 lucide LoaderCircle + animate-spin：1 秒一圈、匀速）。 */
@Composable
internal fun Spinner(size: androidx.compose.ui.unit.Dp, color: androidx.compose.ui.graphics.Color, strokeWidth: Float = 1.9f) {
    val transition = rememberInfiniteTransition(label = "spin")
    val angle by transition.animateFloat(0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "spin-angle")
    Box(Modifier.size(size).rotate(angle)) { LucideIcon(Lucide.LoaderCircle, size, color, strokeWidth = strokeWidth) }
}
