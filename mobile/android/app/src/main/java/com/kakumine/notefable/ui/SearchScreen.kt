package com.kakumine.notefable.ui

import kotlinx.coroutines.isActive

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ChatProjectSummary
import com.kakumine.notefable.data.SearchBackend
import com.kakumine.notefable.data.SearchFold
import com.kakumine.notefable.data.SearchScope
import kotlinx.coroutines.flow.first
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

// 全屏检索：网页 search-dialog.tsx 在手机宽度（< 640）下的全屏面板（search-dialog.css 的 @media (max-width: 639px)）。
// 以下数值是网页在 412×915 下的实测：
//   输入行 高 60（上下 5.6、左 14.4、右 8，间距 9.6，下边 1px 线）：搜索图标 18 灰、输入框 16sp 高 48、转圈 16、关闭 40（X 18，圆角 6）。
//   工具行（上下 6.4、左右 12，间距 8，下边 1px 线）：标签 高 40、左右 14.4、15sp、圆角 6，选中 --notion-active 底 + 600，其余灰 + 500，间距 4；
//     Chats 标签页且有项目时右侧是项目筛选（高 40、最宽 48%、1px 线、圆角 6、左右 6.4、16sp 灰）。
//   结果区（上 5.6、左右 6.4、下 12）：分组标题 12sp/600 灰（上 8、左右 9.6、下 4）；
//     行 最小高 52、内边距 9.6、圆角 6、间距 10.4，当前行 --notion-hover 底；图标区 22.4（上 0.8，表情 16 / 图标 16 灰）；
//     标题 15sp/500 单行，后面 8 处项目名 12sp 浅灰（最宽 40%）；摘录 13sp 行高 1.4 灰、最多两行，命中词黄色底 rgba(255,207,0,.4)；
//     附件命中时摘录前是 回形针 12 + "in 文件名" 12sp/500 正文色，右距 5.6；日期 12sp 浅灰，上距 2.4。
//   空 / 失败 / 无结果：内边距 20×12.8、间距 6.4，标题 15sp/600 正文色，说明 14sp 行高 21 灰；"检索中"是转圈 16 + 14sp 灰字，间距 8。
//   键盘提示（"Use ↑ ↓ to move…"）在触屏上不显示（@media (hover: none)）。

private val MarkColor = Color(0x66FFCF00)

// CSS 的 ease-out / ease。
private val CssEase = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)

@Composable
fun SearchScreen(
    backend: SearchBackend,
    projects: List<ChatProjectSummary>,
    currentProjectId: String?,
    chatFirst: Boolean,
    onClose: () -> Unit,
    onOpenChat: (id: String, messageId: String?) -> Unit,
    onOpenNote: (id: String, title: String, icon: String?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val vm = remember { SearchViewModel(scope, backend) }
    LaunchedEffect(projects) { vm.setProjects(projects) }
    val state by vm.state.collectAsStateWithLifecycle()
    val view = state.view(projects, currentProjectId, chatFirst)
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    BackHandler(onBack = onClose)

    fun select(hit: SearchHit) {
        // 和网页一样先关检索再跳转。
        onClose()
        when (hit) {
            is SearchHit.Note -> onOpenNote(hit.id, hit.title, hit.icon)
            is SearchHit.Chat -> onOpenChat(hit.id, hit.result.messageId)
        }
    }

    // 打开时整个面板（连同白底）从下方 32 处淡入上移：网页手机版 .search-panel 的 model-sheet-up 200ms ease-out。
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(200, easing = CssEaseOut)) }

    Column(
        // 盖在抽屉和聊天之上：触摸不能穿到下面去。
        Modifier.fillMaxSize()
            .graphicsLayer {
                val t = enter.value
                alpha = t
                translationY = (1f - t) * 32.dp.toPx()
            }
            .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } }
            .background(Sm.Background).statusBarsPadding()
            .windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime)),
    ) {
        // 输入行
        Row(
            Modifier.fillMaxWidth().height(60.dp).bottomLine().padding(start = 14.4.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.6.dp),
        ) {
            LucideIcon(Lucide.Search, 18.dp, Sm.Muted)
            val label = stringResource(R.string.search_chats_and_notes)
            BasicTextField(
                value = state.input,
                onValueChange = vm::setInput,
                singleLine = true,
                modifier = Modifier.weight(1f).height(48.dp).focusRequester(focus).semantics { contentDescription = label },
                textStyle = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, color = Sm.Text),
                cursorBrush = SolidColor(Sm.Ink),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false),
                keyboardActions = KeyboardActions(onSearch = {
                    // 网页的 Enter：结果是当前条件的才打开高亮的那一行。
                    val rows = view.rows
                    if (!view.loading && !view.failed && rows.isNotEmpty()) select(rows[state.active.coerceIn(0, rows.size - 1)])
                }),
                decorationBox = { inner ->
                    Box(Modifier.fillMaxSize(), Alignment.CenterStart) {
                        if (state.input.isEmpty()) Text(label, color = Sm.Faint, fontSize = 16.sp, lineHeight = 24.sp, maxLines = 1)
                        inner()
                    }
                },
            )
            if (view.loading) Spinner()
            val closeLabel = stringResource(R.string.search_close)
            Box(
                Modifier.size(40.dp).clip(RoundedCornerShape(6.dp)).clickable(onClick = onClose)
                    .semantics { contentDescription = closeLabel; role = Role.Button },
                Alignment.Center,
            ) {
                LucideIcon(Lucide.X, 18.dp, Sm.Muted)
            }
        }

        // 工具行：标签 + 项目筛选
        BoxWithConstraints(Modifier.fillMaxWidth().bottomLine().padding(horizontal = 12.dp, vertical = 6.4.dp)) {
            val toolbarWidth = maxWidth
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    SearchTab(stringResource(R.string.search_tab_all), state.scope == SearchScope.All) { vm.setScope(SearchScope.All) }
                    SearchTab(stringResource(R.string.search_tab_chats), state.scope == SearchScope.Chats) { vm.setScope(SearchScope.Chats) }
                    SearchTab(stringResource(R.string.notes), state.scope == SearchScope.Notes) { vm.setScope(SearchScope.Notes) }
                }
                if (state.scope == SearchScope.Chats && view.projectOptions.isNotEmpty()) {
                    Spacer(Modifier.weight(1f).widthIn(min = 8.dp))
                    ProjectFilter(view.projectOptions, view.projectId, Modifier.widthIn(max = toolbarWidth * 0.48f), vm::setProject)
                }
            }
        }

        // 结果区
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                view.idle -> EmptyBlock(stringResource(R.string.search_idle_title), stringResource(R.string.search_idle_body))
                view.failed -> EmptyBlock(stringResource(R.string.search_unavailable_title), stringResource(R.string.search_unavailable_body)) {
                    // .notion-button：最小高 32、左右 12、圆角 4.8、12.8sp/500 正文色。
                    Box(
                        Modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(4.8.dp)).clickable(onClick = vm::retry).padding(horizontal = 12.dp),
                        Alignment.Center,
                    ) { Text(stringResource(R.string.search_try_again), color = Sm.Text, fontSize = 12.8.sp, fontWeight = FontWeight.Medium) }
                }
                view.loading && view.rows.isEmpty() -> Row(
                    Modifier.padding(start = 6.4.dp, end = 6.4.dp, top = 5.6.dp).padding(horizontal = 12.8.dp, vertical = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Spinner()
                    Text(stringResource(R.string.search_searching), color = Sm.Muted, fontSize = 14.sp, lineHeight = 21.sp)
                }
                view.rows.isEmpty() -> EmptyBlock(
                    stringResource(R.string.search_no_results, view.data?.query ?: view.query),
                    stringResource(R.string.search_no_results_body),
                )
                else -> ResultList(view, state.active, onSelect = { index, hit -> vm.setActive(index); select(hit) })
            }
        }
    }
}

private fun Modifier.bottomLine() = drawBehind {
    val stroke = 0.8.dp.toPx()
    drawRect(Sm.Border, topLeft = Offset(0f, size.height - stroke), size = androidx.compose.ui.geometry.Size(size.width, stroke))
}

@Composable
private fun Spinner() {
    val transition = rememberInfiniteTransition(label = "search-spin")
    val angle by transition.animateFloat(0f, 360f, infiniteRepeatable(tween(800, easing = LinearEasing), RepeatMode.Restart), label = "angle")
    LucideIcon(Lucide.Loader2, 16.dp, Sm.Muted, Modifier.rotate(angle))
}

@Composable
private fun SearchTab(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.height(40.dp).clip(RoundedCornerShape(6.dp)).background(if (selected) Sm.Active else Color.Transparent)
            .clickable(onClick = onClick).semantics { role = Role.Tab }.padding(horizontal = 14.4.dp),
        Alignment.Center,
    ) {
        Text(
            label, fontSize = 15.sp, lineHeight = 22.5.sp, maxLines = 1,
            color = if (selected) Sm.Text else Sm.Muted,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}

@Composable
private fun ProjectFilter(options: List<ChatProjectSummary>, selected: String, modifier: Modifier, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val allLabel = stringResource(R.string.search_all_projects)
    val shape = RoundedCornerShape(6.dp)
    val projectLabel = stringResource(R.string.search_project)
    // 网页是原生 <select>：宽度按最长的选项定（再受 48% 限制），选哪一项都不变宽变窄。
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val names = listOf(allLabel) + options.map { it.name }
    val widest = remember(names, density) {
        with(density) { names.maxOf { measurer.measure(it, TextStyle(fontSize = 16.sp), maxLines = 1).size.width }.toDp() }
    }
    // 左右内边距 6.4 + 文字 + 间距 4 + 箭头 14 + 1px 边框两侧。
    val triggerWidth = widest + 6.4.dp * 2 + 4.dp + 14.dp + 2.dp
    Box(modifier) {
        Box(
            Modifier.width(triggerWidth).height(40.dp).clip(shape).border(1.dp, Sm.Border, shape).clickable { open = true }
                .semantics { contentDescription = projectLabel }.padding(horizontal = 6.4.dp),
            Alignment.CenterStart,
        ) {
            // 箭头靠右（<select> 的箭头在右端），文字在剩下的宽度里，放不下时省略。
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    options.firstOrNull { it.id == selected }?.name ?: allLabel,
                    color = Sm.Muted, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(4.dp))
                LucideIcon(Lucide.ChevronDown, 14.dp, Sm.Muted)
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Sm.Surface) {
            (listOf("" to allLabel) + options.map { it.id to it.name }).forEach { (id, name) ->
                DropdownMenuItem(
                    text = { Text(name, color = Sm.Text, fontSize = 16.sp, fontWeight = if (id == selected) FontWeight.SemiBold else FontWeight.Normal) },
                    onClick = { open = false; onSelect(id) },
                )
            }
        }
    }
}

@Composable
private fun EmptyBlock(title: String, body: String, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().padding(start = 6.4.dp, end = 6.4.dp, top = 5.6.dp).padding(horizontal = 12.8.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(6.4.dp),
    ) {
        Text(title, color = Sm.Text, fontSize = 15.sp, lineHeight = 22.5.sp, fontWeight = FontWeight.SemiBold)
        Text(body, color = Sm.Muted, fontSize = 14.sp, lineHeight = 21.sp)
        action?.invoke()
    }
}

@Composable
private fun ResultList(view: SearchView, active: Int, onSelect: (Int, SearchHit) -> Unit) {
    val names = view.projectNames
    val rowsCount = view.rows.size
    val activeIndex = active.coerceIn(0, (rowsCount - 1).coerceAtLeast(0))
    val label = stringResource(R.string.search_results)
    // 检索中的旧结果淡到 0.5：.search-list.is-stale 的 transition 只写在 is-stale 上，所以变淡用 120ms ease，恢复是立即的。
    val stale = remember { Animatable(1f) }
    LaunchedEffect(view.loading) {
        if (view.loading) stale.animateTo(0.5f, tween(120, easing = CssEase)) else stale.snapTo(1f)
    }
    LazyColumn(
        Modifier.fillMaxSize().graphicsLayer { alpha = stale.value }.semantics { contentDescription = label },
        contentPadding = PaddingValues(start = 6.4.dp, end = 6.4.dp, top = 5.6.dp, bottom = 12.dp),
    ) {
        var base = 0
        view.groups.forEach { group ->
            val offset = base
            item(key = "group:${group.isChats}") {
                Text(
                    stringResource(if (group.isChats) R.string.search_tab_chats else R.string.notes),
                    Modifier.fillMaxWidth().padding(start = 9.6.dp, end = 9.6.dp, top = 8.dp, bottom = 4.dp),
                    color = Sm.Muted, fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold,
                )
            }
            itemsIndexed(group.results, key = { _, hit -> (if (hit is SearchHit.Note) "note:" else "chat:") + hit.id }) { index, hit ->
                val rowIndex = offset + index
                val projectName = (hit as? SearchHit.Chat)?.result?.projectId?.let { names[it] }
                ResultRow(hit, view.terms, projectName, rowIndex == activeIndex) { onSelect(rowIndex, hit) }
            }
            base += group.results.size
        }
    }
}

@Composable
private fun ResultRow(hit: SearchHit, terms: List<String>, projectName: String?, active: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(6.dp))
            .background(if (active) Sm.Hover else Color.Transparent).clickable(onClick = onClick).padding(9.6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.4.dp),
    ) {
        Box(Modifier.padding(top = 0.8.dp).size(22.4.dp), Alignment.Center) {
            val icon = hit.icon
            when {
                icon != null -> Text(icon, fontSize = 16.sp, lineHeight = 16.sp)
                hit is SearchHit.Note -> LucideIcon(Lucide.FileText, 16.dp, Sm.Muted)
                else -> LucideIcon(Lucide.MessageSquareText, 16.dp, Sm.Muted)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.4.dp)) {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val headWidth = maxWidth
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        highlighted(hit.title, terms), modifier = Modifier.weight(1f, fill = false),
                        color = Sm.Text, fontSize = 15.sp, lineHeight = 22.5.sp, fontWeight = FontWeight.Medium,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    if (projectName != null) {
                        Spacer(Modifier.width(8.dp))
                        Text(
                            projectName, modifier = Modifier.widthIn(max = headWidth * 0.4f).padding(bottom = 2.dp),
                            color = Sm.Faint, fontSize = 12.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            if (hit.snippet.isNotEmpty()) Snippet(hit, terms)
        }
        Text(
            formatSearchDate(hit.updatedAt, Locale.forLanguageTag(stringResource(R.string.ui_locale))),
            modifier = Modifier.padding(top = 2.4.dp), color = Sm.Faint, fontSize = 12.sp, lineHeight = 18.sp, maxLines = 1, softWrap = false,
        )
    }
}

@Composable
private fun Snippet(hit: SearchHit, terms: List<String>) {
    val chat = (hit as? SearchHit.Chat)?.result
    val fileName = chat?.attachmentName
    // 命中附件正文时显示文件名，不显示说话人。
    val speaker = when {
        chat == null || fileName != null || chat.role == null -> ""
        chat.role == "USER" -> stringResource(R.string.search_speaker_you)
        else -> stringResource(R.string.search_speaker_notefable)
    }
    val fileLabel = fileName?.let { stringResource(R.string.search_in_file, it) }
    val text = buildAnnotatedString {
        if (fileLabel != null) {
            withStyle(SpanStyle(color = Sm.Text, fontSize = 12.sp, fontWeight = FontWeight.Medium)) {
                appendInlineContent("clip", "📎")
                append(" ")
                append(fileLabel)
            }
            appendInlineContent("gap", " ")
        }
        append(speaker)
        append(highlighted(hit.snippet, terms))
    }
    val inline = mapOf(
        "clip" to InlineTextContent(Placeholder(12.sp, 12.sp, PlaceholderVerticalAlign.Center)) { LucideIcon(Lucide.Paperclip, 12.dp, Sm.Text) },
        "gap" to InlineTextContent(Placeholder(5.6.sp, 12.sp, PlaceholderVerticalAlign.Center)) { },
    )
    Text(
        text, inlineContent = inline, color = Sm.Muted, fontSize = 13.sp, lineHeight = 18.2.sp,
        maxLines = 2, overflow = TextOverflow.Ellipsis,
    )
}

/** 命中词加黄色底（网页 <mark>：rgba(255,207,0,.4)）。 */
private fun highlighted(text: String, terms: List<String>): AnnotatedString = buildAnnotatedString {
    SearchFold.splitHighlight(text, terms).forEach { (part, match) ->
        if (match) withStyle(SpanStyle(background = MarkColor)) { append(part) } else append(part)
    }
}

/** 网页 formatDate：今年的只写月日（"Nov 14" / "11月14日"），往年的加年份。读不懂的日期不显示。 */
internal fun formatSearchDate(value: String, locale: Locale): String {
    val instant = runCatching { Instant.parse(value) }.getOrNull() ?: return ""
    val zone = ZoneId.systemDefault()
    val date = instant.atZone(zone)
    val sameYear = date.year == java.time.LocalDate.now(zone).year
    val format = android.icu.text.DateFormat.getInstanceForSkeleton(if (sameYear) "MMMd" else "yMMMd", locale)
    format.timeZone = android.icu.util.TimeZone.getTimeZone(zone.id)
    return format.format(java.util.Date.from(instant))
}

// ---------------------------------------------------------------------------------------------
// 定位到消息（网页 src/lib/search-reveal.ts 的 revealChatMessage）：消息读完后滚到它、放在可视区中间，
// 然后闪 2 秒（search-dialog.css 的 .search-reveal-flash：圆角 6，黄色底 rgba(255,207,0,.42) 保持到 60%，
// 再连同 3px 的外圈 rgba(255,207,0,.5) 一起淡出）。消息已不存在（删了）就和平常一样停在最底部。

/** 正在闪的消息：[startMs] 是开始闪的那一帧的时间（帧时钟），条目滚出屏幕再回来时按它接着闪，不从头重放。 */
internal data class RevealFlash(val messageId: String, val token: Long, val startMs: Long)

/**
 * 定位请求的处理结果交给 MessageList：[found] 时它停止"跟随底部"（否则马上被拉回底部），
 * 没找到时恢复跟随，和平常一样停在最底部。
 */
@Composable
internal fun revealMessage(
    state: ChatUiState,
    listState: androidx.compose.foundation.lazy.LazyListState,
    onRevealed: (found: Boolean) -> Unit,
    onRevealDone: (Long) -> Unit,
): RevealFlash? {
    var flash by remember { mutableStateOf<RevealFlash?>(null) }
    val reveal = state.reveal
    LaunchedEffect(reveal?.token, state.activeSessionId, state.messagesLoading, state.messagesFailed, state.messages.size) {
        val request = reveal ?: return@LaunchedEffect
        if (state.activeSessionId != request.sessionId || state.messagesLoading) return@LaunchedEffect
        val messages = state.messages
        val index = if (state.messagesFailed) -1 else revealIndex(messages, request.messageId)
        if (index < 0) {
            onRevealed(false)
            onRevealDone(request.token)
            return@LaunchedEffect
        }
        // listState 和上一段聊天共用：列表在读消息期间不在界面上，layoutInfo 还是上一段聊天的。
        // 等这段聊天的列表真正量好（可见项的 key 都属于当前消息）再判断目标在不在屏幕上。
        val ids = messages.mapTo(HashSet()) { it.id }
        androidx.compose.runtime.snapshotFlow {
            val info = listState.layoutInfo
            layoutIsCurrent(info.totalItemsCount, info.visibleItemsInfo.map { it.key }, messages.size, ids)
        }.first { it }
        // 不在屏幕上时先跳过去，再平滑地移到中间。用户在这期间拖动列表会打断滚动（只取消滚动本身，
        // 这个 effect 还活着）：这时就算定位结束，清掉请求，免得它一直挂着、挡住贴底。
        try {
            if (listState.layoutInfo.visibleItemsInfo.none { it.index == index }) {
                listState.scrollToItem(index)
                androidx.compose.runtime.withFrameNanos { }
            }
            val info = listState.layoutInfo
            info.visibleItemsInfo.firstOrNull { it.index == index }?.let { item ->
                val viewportCenter = (info.viewportStartOffset + info.viewportEndOffset) / 2f
                val itemCenter = item.offset + item.size / 2f
                listState.animateScrollBy(itemCenter - viewportCenter)
            }
        } catch (interrupted: kotlinx.coroutines.CancellationException) {
            if (!kotlinx.coroutines.currentCoroutineContext().isActive) throw interrupted
            onRevealDone(request.token)
            return@LaunchedEffect
        }
        val start = androidx.compose.runtime.withFrameMillis { it }
        flash = RevealFlash(request.messageId, request.token, start)
        onRevealed(true)
        onRevealDone(request.token)
    }
    // 闪完就作废（网页 clearFlash 在 2 秒后去掉 class）：从侧栏重开这段聊天时不再闪。
    // 单独一个 effect：上面那个在 onRevealDone 清掉 reveal 后会重启，不能在里面等。
    val flashing = flash
    LaunchedEffect(flashing) {
        if (flashing == null) return@LaunchedEffect
        kotlinx.coroutines.delay(RevealFlashMs)
        androidx.compose.runtime.withFrameNanos { }
        if (flash == flashing) flash = null
    }
    return flash
}

/** 目标消息在列表里的位置（列表是正常顺序，最新的在最后）；没有就是 -1。 */
internal fun revealIndex(messages: List<UiMessage>, messageId: String): Int = messages.indexOfFirst { it.id == messageId }

/** 列表的这次布局是不是当前这段聊天的：项数对得上，且可见项的 key 都是当前消息的 id（消息 id 跨聊天唯一）。 */
internal fun layoutIsCurrent(totalItems: Int, visibleKeys: List<Any>, messageCount: Int, ids: Set<String>): Boolean =
    totalItems == messageCount && visibleKeys.isNotEmpty() && visibleKeys.all { it in ids }

private const val RevealFlashMs = 2000L
private const val RevealHoldMs = 1200L

/** 开始闪之后 [elapsedMs] 时的强度：1.2 秒保持 1，之后 0.8 秒 ease-out 淡到 0。 */
internal fun revealFlashLevel(elapsedMs: Long): Float = when {
    elapsedMs < 0 -> 1f
    elapsedMs < RevealHoldMs -> 1f
    elapsedMs >= RevealFlashMs -> 0f
    else -> 1f - androidx.compose.animation.core.EaseOut.transform((elapsedMs - RevealHoldMs) / (RevealFlashMs - RevealHoldMs).toFloat())
}

private val FlashColor = Color(0xFFFFCF00)

/**
 * [flash] 非空时闪。强度按开始时间算：条目滚出屏幕（被回收）再回来时接着当前进度，不从头再闪；过了 2 秒就不画。
 */
@Composable
internal fun Modifier.revealFlash(flash: RevealFlash?): Modifier {
    var level by remember { mutableStateOf(0f) }
    LaunchedEffect(flash) {
        if (flash == null) {
            level = 0f
            return@LaunchedEffect
        }
        while (true) {
            val now = androidx.compose.runtime.withFrameMillis { it }
            level = revealFlashLevel(now - flash.startMs)
            if (level <= 0f) break
        }
    }
    return drawBehind {
        val p = level
        if (p <= 0f) return@drawBehind
        val ring = 3.dp.toPx()
        val radius = androidx.compose.ui.geometry.CornerRadius(6.dp.toPx())
        drawRoundRect(FlashColor.copy(alpha = 0.42f * p), cornerRadius = radius)
        drawRoundRect(
            FlashColor.copy(alpha = 0.5f * p),
            topLeft = Offset(-ring / 2, -ring / 2),
            size = androidx.compose.ui.geometry.Size(size.width + ring, size.height + ring),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(6.dp.toPx() + ring / 2),
            style = androidx.compose.ui.graphics.drawscope.Stroke(ring),
        )
    }
}

/**
 * 侧栏的 Search 行（网页 .notion-sidebar-action，手机）：紧接在"新建"按钮下面，左右 8（容器 px-2）、高 44、圆角 4.8、
 * 左右内边距 8、搜索图标 16 + 间距 8.8 + 16sp/500 正文色。右侧的 Ctrl K 提示在触屏上不显示。
 */
@Composable
internal fun SidebarSearchRow(onClick: () -> Unit) {
    Row(
        Modifier.padding(horizontal = 8.dp).fillMaxWidth().height(44.dp).clip(RoundedCornerShape(4.8.dp))
            .clickable(onClick = onClick).semantics { role = Role.Button }.padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.8.dp),
    ) {
        LucideIcon(Lucide.Search, 16.dp, Sm.Text)
        Text(stringResource(R.string.search), color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * 打开聊天链接（笔记里的链接、检索结果、外部 VIEW intent）：和网页一样先切到聊天；ID 形式不对时回到新聊天并提示读不到。
 * 笔记存不上、留在笔记里时不动聊天（不停掉后台在生成的回答、不换会话）。
 */
internal fun openChatLink(link: com.kakumine.notefable.data.ChatLink, chat: ChatViewModel, notes: NotesViewModel) {
    notes.setWorkspace(Workspace.Chat) {
        when (link) {
            is com.kakumine.notefable.data.ChatLink.Open -> chat.openSessionAt(link.chatId, link.messageId)
            com.kakumine.notefable.data.ChatLink.Invalid -> chat.showLinkFailed()
        }
    }
}
