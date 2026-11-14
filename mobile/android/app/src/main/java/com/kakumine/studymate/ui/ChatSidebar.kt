package com.kakumine.studymate.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.roundToIntRect
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.foundation.layout.requiredSize
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kakumine.studymate.R
import com.kakumine.studymate.data.ChatProjectSummary
import com.kakumine.studymate.data.SessionSummary
import kotlinx.coroutines.launch

/*
 * 侧栏的聊天部分（网页 chat-sidebar.tsx，手机 412×915 下量的值，1dp = 1 CSS px）：
 * - "新聊天"：.sidebar-primary-action，上距 12、高 44、圆角 8、深色、左对齐 16/550。
 * - 列表区左右 8、下 16，可滚动；顺序是 Pinned（有置顶时）→ PROJECTS 标题（右侧 ＋ 40、图标 15）→ 各项目 → CHATS → 没项目的聊天。
 * - 分区小标题 .chat-section-label：内边距 14.4/8/4.8，12 等宽大写灰字、字距 .06em。
 * - 项目行高 44：折叠箭头 13 + 文件夹 15 + 名称 14（间距 6.4，左右 3.2），有共通指示 / 参考笔记时名称后加 ScrollText 12 浅灰；
 *   右侧"在项目里新建聊天"＋ 和"更多"各 40（图标 16，右距 3.2）。项目里的聊天左缩进 12；没有时 12 灰字 "No chats" / "All chats pinned"。
 * - 聊天行高 44、圆角 6.4：拖动把手 28×44（GripVertical 13）、图标区 40（左距 2，图标 15 / 表情）、标题 14/20（右距 8）、
 *   "更多" 40（图标 16）、置顶 40（Pin 14；已置顶时深色字加 .08 灰底）。当前行浅蓝底、字重 550、左侧 3px 蓝条（上下各缩 7.2）。
 * - 拖动：按住把手直接拖（网页触屏上把手也是立刻拖）。目标行上 / 下出现 2px 蓝线；拖到项目标题或 CHATS 标签上整块浅蓝底加 1px 蓝框，
 *   放下即移进去并取消置顶。被拖的行半透明。手指在列表上下边 30 内移动时每次移动滚 12（网页 updateTarget 的 scrollBy，手指不动就不滚）。把手吃掉了这次拖动，所以抽屉的横滑关闭和列表滚动不会同时触发。
 */

private val DropBlue = Color(0xFF2383E2)
private val DropFill = Color(0x1F2383E2) // rgba(35,131,226,.12)
private val ErrorRed = Color(0xFFB91C1C)

/** 拖动时手指下的目标：某一行的前 / 后，或某个项目（null = CHATS，即无项目）。 */
private sealed interface DropTarget {
    data class Row(val id: String, val after: Boolean) : DropTarget
    data class Into(val projectId: String?) : DropTarget
}

/**
 * 拖动状态：被拖的聊天、手指在窗口里的位置、当前目标。行和投放区的位置由各自 onGloballyPositioned 登记，
 * 离开组合（折叠、删除）时由 DisposableEffect 注销，免得命中已经看不见的行。
 */
private class DragState(private val scroll: ScrollState) {
    var dragging by mutableStateOf<String?>(null)
    var pointer by mutableStateOf(Offset.Zero)
    var target by mutableStateOf<DropTarget?>(null)
    /** 列表可见区域（窗口坐标），自动滚动用。 */
    var listBounds = Rect.Zero
    val rows = mutableStateMapOf<String, Rect>()
    /** 投放区：项目 id → 项目行；"" → CHATS 标签。 */
    val zones = mutableStateMapOf<String, Rect>()

    fun update(point: Offset) {
        pointer = point
        val id = dragging ?: return
        val zone = zones.entries.firstOrNull { it.value.contains(point) }
        target = when {
            zone != null -> DropTarget.Into(zone.key.ifEmpty { null })
            else -> rows.entries.firstOrNull { it.key != id && it.value.contains(point) }
                ?.let { DropTarget.Row(it.key, point.y > it.value.center.y) }
        }
    }

    /** 手指移动一次：先找目标，再在列表上下边 30 以内滚 12（网页 updateTarget）。 */
    fun move(point: Offset, density: Density) {
        update(point)
        val edge = with(density) { 30.dp.toPx() }
        val step = with(density) { 12.dp.toPx() }
        val delta = when {
            point.y < listBounds.top + edge -> -step
            point.y > listBounds.bottom - edge -> step
            else -> 0f
        }
        if (delta != 0f) scroll.dispatchRawDelta(delta)
    }

    fun clear() {
        dragging = null
        target = null
    }
}

@Composable
internal fun ChatDrawerBody(
    state: ChatUiState,
    sidebar: SidebarViewModel,
    onNewChat: () -> Unit,
    onOpen: (String) -> Unit,
    onRetry: () -> Unit,
    closeDrawer: () -> Unit,
    modifier: Modifier = Modifier,
    onSearch: () -> Unit = {},
) {
    val side by sidebar.state.collectAsStateWithLifecycle()
    var action by remember { mutableStateOf<ChatAction?>(null) }
    val scope = rememberCoroutineScope()
    val scroll = rememberScrollState()
    val drag = remember(scroll) { DragState(scroll) }
    // 菜单 / 对话框开着时返回键先关它（网页 useBackToClose）。对话框自己的 onDismissRequest 也会处理返回键。
    BackHandler(enabled = action != null) { action = null }

    Column(modifier) {
        Row(
            Modifier.padding(start = 8.dp, end = 8.dp, top = 12.dp, bottom = 4.dp).fillMaxWidth().height(44.dp)
                .shadow(1.dp, RoundedCornerShape(8.dp), ambientColor = Color(0x1F0C1730), spotColor = Color(0x1F0C1730))
                .clip(RoundedCornerShape(8.dp)).background(Sm.Ink).clickable(onClick = onNewChat)
                .padding(horizontal = 11.2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LucideIcon(Lucide.Plus, 16.dp, Color.White)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.new_chat), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight(550))
        }
        // Search 行（Batch 4）：网页侧栏里在"新建"按钮正下方。
        SidebarSearchRow(onSearch)

        Column(
            Modifier.weight(1f).fillMaxWidth()
                .onGloballyPositioned { drag.listBounds = it.boundsInWindow() }
                .verticalScroll(scroll)
                .padding(start = 8.dp, end = 8.dp, bottom = 16.dp),
        ) {
            val groups = SidebarGroups.of(state.sessions, side.projects)
            val rowProps = RowProps(
                activeId = state.activeSessionId, side = side, drag = drag,
                onOpen = onOpen,
                onMenu = { session, anchor -> action = ChatAction.Menu(session, anchor) },
                onPin = sidebar::togglePin,
                onDrop = { id ->
                    when (val target = drag.target) {
                        is DropTarget.Row -> sidebar.reorder(ReorderMove(id, target.id, target.after))
                        is DropTarget.Into -> sidebar.dropIntoProject(id, target.projectId)
                        null -> Unit
                    }
                    drag.clear()
                },
                onDismissError = sidebar::dismissReorderError,
            )

            if (groups.pinned.isNotEmpty()) {
                SectionLabel(stringResource(R.string.sb_pinned))
                groups.pinned.forEach { key(it.id) { SessionRow(it, rowProps) } }
            }

            ProjectsHeading { action = ChatAction.CreateProject }
            if (side.projectsFailed) SmallNote(stringResource(R.string.sb_err_load_projects), ErrorRed)
            side.createError?.let { SmallNote(sidebarErrorText(it), ErrorRed) }
            side.projects.forEach { project -> key(project.id) {
                val collapsed = project.id in side.collapsed
                DisposableEffect(project.id) { onDispose { drag.zones.remove(project.id) } }
                ProjectRow(
                    project = project,
                    collapsed = collapsed,
                    dropActive = drag.target == DropTarget.Into(project.id),
                    onPositioned = { drag.zones[project.id] = it },
                    onToggle = { sidebar.toggleProject(project.id) },
                    onNewChat = {
                        scope.launch { if (sidebar.newChatInProject(project.id)) closeDrawer() }
                    },
                    onMenu = { anchor -> action = ChatAction.ProjectMenu(project, anchor) },
                )
                if (!collapsed) Column(Modifier.padding(start = 12.dp)) {
                    val rows = groups.byProject[project.id].orEmpty()
                    rows.forEach { key(it.id) { SessionRow(it, rowProps) } }
                    if (rows.isEmpty()) {
                        SmallNote(
                            stringResource(if (project.id in groups.allPinned) R.string.sb_all_chats_pinned else R.string.sb_no_chats),
                            Sm.Muted, vertical = 4.dp,
                        )
                    }
                }
            } }

            // CHATS 标签同时是"移出项目"的投放区（网页 data-chat-project-drop=""）。
            SectionLabel(
                stringResource(R.string.chats),
                Modifier.dropZone(drag.target == DropTarget.Into(null)).onGloballyPositioned { drag.zones[""] = it.boundsInWindow() },
            )
            when {
                state.sessionsLoading && state.sessions.isEmpty() -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp), color = Sm.Muted, strokeWidth = 2.dp)
                }
                // 网页没有单独的"列表加载失败"文案，这里只给一个重试按钮（文案用网页已有的 Retry）。
                state.sessionsFailed && state.sessions.isEmpty() -> TextButton(onClick = onRetry) {
                    Text(stringResource(R.string.retry), color = Sm.Blue)
                }
                else -> groups.loose.forEach { key(it.id) { SessionRow(it, rowProps) } }
            }
            if (state.sessions.isEmpty() && !state.sessionsLoading && !state.sessionsFailed) {
                // px-2 py-3 text-xs leading-5 灰字。
                Text(
                    stringResource(R.string.chats_empty), color = Sm.Muted, fontSize = 12.sp, lineHeight = 20.sp,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp),
                )
            }
        }
    }

    // 删掉 / 移走后菜单里的旧对象可能已过时：对话框里显示的标题以打开时为准，和网页一样。
    action?.let { current ->
        ChatActions(
            action = current,
            sidebar = sidebar,
            projects = side.projects,
            onAction = { action = it },
            onClose = { action = null },
        )
    }
}

/** 一行聊天需要的共享参数（避免每层都传十几个参数）。 */
private class RowProps(
    val activeId: String?,
    val side: SidebarUiState,
    val drag: DragState,
    val onOpen: (String) -> Unit,
    val onMenu: (SessionSummary, IntRect) -> Unit,
    val onPin: (SessionSummary) -> Unit,
    val onDrop: (String) -> Unit,
    val onDismissError: () -> Unit,
)

// 投放进项目时的样子：浅蓝底 + 1px 蓝框，圆角 4。
private fun Modifier.dropZone(active: Boolean): Modifier = if (!active) this else drawBehind {
    val r = CornerRadius(4.dp.toPx())
    drawRoundRect(DropFill, cornerRadius = r)
    drawRoundRect(DropBlue, cornerRadius = r, style = Stroke(1.dp.toPx()))
}

@Composable
private fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    val label = text.uppercase()
    Text(label, modifier = modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 14.4.dp, bottom = 4.8.dp), style = roleLabelStyle(label))
}

// .chat-project-heading：与小标题同款，右侧 ＋（40，上下各收 4.8，图标 15）。整体高 49.6。
@Composable
private fun ProjectsHeading(onCreate: () -> Unit) {
    val label = stringResource(R.string.projects).uppercase()
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 14.4.dp, bottom = 4.8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = roleLabelStyle(label))
        val newProject = stringResource(R.string.new_project)
        Box(Modifier.size(40.dp, 30.4.dp), Alignment.Center) {
            Box(
                Modifier.requiredSize(40.dp).clip(RoundedCornerShape(4.8.dp)).clickable(onClick = onCreate)
                    .semantics { contentDescription = newProject; role = Role.Button },
                Alignment.Center,
            ) { LucideIcon(Lucide.Plus, 15.dp, Sm.Muted) }
        }
    }
}

@Composable
private fun SmallNote(text: String, color: Color, vertical: androidx.compose.ui.unit.Dp = 0.dp) =
    Text(text, color = color, fontSize = 12.sp, lineHeight = 16.sp, modifier = Modifier.padding(horizontal = 8.dp, vertical = vertical))

/** 行尾的 40×40 小按钮（.notion-row-action.chat-more-button / chat-pin-button 的手机尺寸），右距 3.2、圆角 4。 */
@Composable
private fun RowAction(
    icon: List<String>,
    iconSize: androidx.compose.ui.unit.Dp,
    description: String,
    onAnchor: ((IntRect) -> Unit)? = null,
    pressed: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    var coords by remember { mutableStateOf<LayoutCoordinates?>(null) }
    Box(
        Modifier.padding(end = 3.2.dp).size(40.dp).clip(RoundedCornerShape(4.dp))
            .background(if (pressed) Sm.Hover else Color.Transparent)
            .onGloballyPositioned { coords = it }
            .clickable(enabled = enabled) {
                onAnchor?.let { anchor -> coords?.let { anchor(it.boundsInWindow().roundToIntRect()) } }
                onClick()
            }
            .semantics { contentDescription = description; role = Role.Button; if (pressed) selected = true },
        Alignment.Center,
    ) { LucideIcon(icon, iconSize, if (pressed) Sm.Text else Sm.Muted) }
}

@Composable
private fun ProjectRow(
    project: ChatProjectSummary,
    collapsed: Boolean,
    dropActive: Boolean,
    onPositioned: (Rect) -> Unit,
    onToggle: () -> Unit,
    onNewChat: () -> Unit,
    onMenu: (IntRect) -> Unit,
) {
    val hint = projectHint(project)
    Row(
        Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(6.4.dp)).dropZone(dropActive)
            .onGloballyPositioned { onPositioned(it.boundsInWindow()) },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).height(44.dp).clickable(onClick = onToggle).padding(horizontal = 3.2.dp)
                .semantics { contentDescription = if (hint.isEmpty()) project.name else "${project.name} ($hint)" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LucideIcon(if (collapsed) Lucide.ChevronRight else Lucide.ChevronDown, 13.dp, Sm.Text)
            Spacer(Modifier.width(6.4.dp))
            LucideIcon(Lucide.Folder, 15.dp, Sm.Text)
            Spacer(Modifier.width(6.4.dp))
            Text(project.name, Modifier.weight(1f, fill = false), color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (hint.isNotEmpty()) {
                Spacer(Modifier.width(6.4.dp))
                LucideIcon(Lucide.ScrollText, 12.dp, Sm.Faint)
            }
        }
        RowAction(Lucide.Plus, 16.dp, stringResource(R.string.sb_new_chat_in_name, project.name), onClick = onNewChat)
        var anchor by remember { mutableStateOf(IntRect.Zero) }
        RowAction(Lucide.MoreHorizontal, 16.dp, stringResource(R.string.sb_actions_for_project, project.name), onAnchor = { anchor = it }) {
            onMenu(anchor)
        }
    }
}

/** 项目行的简短说明（网页 projectHint）：有共通指示和 / 或参考笔记时才有。 */
@Composable
private fun projectHint(project: ChatProjectSummary): String {
    val parts = buildList {
        if (project.hasInstructions) add(stringResource(R.string.sb_hint_instructions))
        if (project.noteCount == 1) add(stringResource(R.string.sb_one_reference_note))
        else if (project.noteCount > 1) add(stringResource(R.string.sb_n_reference_notes, project.noteCount))
    }
    return parts.joinToString(" + ")
}

@Composable
private fun SessionRow(session: SessionSummary, props: RowProps) {
    val active = session.id == props.activeId
    val drag = props.drag
    val target = drag.target as? DropTarget.Row
    val lineBefore = target?.id == session.id && !target.after
    val lineAfter = target?.id == session.id && target.after
    val reorderError = props.side.reorderError?.takeIf { it.first == session.id }?.second
    var handleCoords by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val density = LocalDensity.current
    DisposableEffect(session.id) { onDispose { drag.rows.remove(session.id) } }

    Box {
        Row(
            Modifier.fillMaxWidth().height(44.dp)
                .alpha(if (drag.dragging == session.id) 0.5f else 1f)
                .onGloballyPositioned { drag.rows[session.id] = it.boundsInWindow() }
                .clip(RoundedCornerShape(6.4.dp))
                .background(if (active) Sm.AccentSoft else Color.Transparent)
                .drawWithContent {
                    drawContent()
                    val line = 2.dp.toPx()
                    if (lineBefore) drawRect(DropBlue, size = Size(size.width, line))
                    if (lineAfter) drawRect(DropBlue, topLeft = Offset(0f, size.height - line), size = Size(size.width, line))
                    // 当前行左侧 3px 蓝条（上下各缩 7.2，全圆角）；拖动目标是它时不画，免得和插入线混在一起。
                    if (active && !lineBefore && !lineAfter) {
                        val inset = 7.2.dp.toPx()
                        drawRoundRect(Sm.Blue, topLeft = Offset(0f, inset), size = Size(3.dp.toPx(), size.height - inset * 2),
                            cornerRadius = CornerRadius(1.5.dp.toPx()))
                    }
                },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 拖动把手 28×44（.list-reorder-handle，触屏尺寸），GripVertical 13 灰。
            val reorderLabel = stringResource(R.string.sb_reorder_title, session.title)
            val moveBusy = session.id in props.side.moveBusy
            Box(
                Modifier.size(28.dp, 44.dp).clip(RoundedCornerShape(4.dp))
                    .onGloballyPositioned { handleCoords = it }
                    // 和网页一样只锁正在移动的这一行；别的行照常能拖（排序还没完时由 reorder() 提示等待）。
                    .pointerInput(session.id, moveBusy) {
                        if (moveBusy) return@pointerInput
                        // 手势协程被取消（行离开组合、key 变了）时 detectDragGestures 不会调 onDragCancel，这里自己收尾。
                        try {
                            detectDragGestures(
                                onDragStart = { offset ->
                                    val origin = handleCoords?.localToWindow(offset) ?: return@detectDragGestures
                                    props.onDismissError()
                                    drag.dragging = session.id
                                    drag.update(origin)
                                },
                                onDrag = { change, amount ->
                                    change.consume()
                                    drag.move(drag.pointer + amount, density)
                                },
                                onDragEnd = { props.onDrop(session.id) },
                                onDragCancel = { drag.clear() },
                            )
                        } finally {
                            if (drag.dragging == session.id) drag.clear()
                        }
                    }
                    .semantics { contentDescription = reorderLabel },
                Alignment.Center,
            ) { LucideIcon(Lucide.GripVertical, 13.dp, Sm.Muted) }

            Row(
                Modifier.weight(1f).height(44.dp).clickable { props.onOpen(session.id) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // 图标区 40（左距 2）：表情或 MessageSquareText 15 灰。改图标在网页上是这个按钮，原生版还没有表情选择器，点它等于打开聊天。
                Box(Modifier.padding(start = 2.dp).size(40.dp), Alignment.Center) {
                    if (session.icon != null) Text(session.icon, fontSize = 16.sp) else LucideIcon(Lucide.MessageSquareText, 15.dp, Sm.Muted)
                }
                Text(
                    session.title,
                    modifier = Modifier.weight(1f).padding(end = 8.dp),
                    color = if (active) Sm.Ink else Sm.Text,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    fontWeight = if (active) FontWeight(550) else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            var anchor by remember { mutableStateOf(IntRect.Zero) }
            RowAction(Lucide.MoreHorizontal, 16.dp, stringResource(R.string.sb_actions_for_title, session.title), onAnchor = { anchor = it }) {
                props.onMenu(session, anchor)
            }
            PinButton(session, busy = session.id in props.side.pinBusy, failed = session.id in props.side.pinFailed) { props.onPin(session) }
        }
        if (reorderError != null) ReorderErrorPopup(sidebarErrorText(reorderError), props.onDismissError)
    }
}

// 置顶按钮：aria-label "Pin / Unpin {title}"；保存失败时和网页一样只给读屏一句提示（网页是 sr-only 的 alert + 悬停提示）。
@Composable
private fun PinButton(session: SessionSummary, busy: Boolean, failed: Boolean, onClick: () -> Unit) {
    val label = stringResource(if (session.pinned) R.string.sb_unpin_title else R.string.sb_pin_title, session.title)
    val failure = stringResource(R.string.sb_pin_failed)
    RowAction(Lucide.Pin, 14.dp, if (failed) "$label. $failure" else label, pressed = session.pinned, enabled = !busy, onClick = onClick)
}

// .list-reorder-error：行下方，宽 min(220, 90vw)、内边距 6、白底、1px 细线、12 红字。点一下关闭。
@Composable
private fun ReorderErrorPopup(text: String, onDismiss: () -> Unit) {
    val density = LocalDensity.current
    Popup(offset = IntOffset(0, with(density) { 44.dp.roundToPx() }), onDismissRequest = onDismiss) {
        Text(
            text,
            color = ErrorRed, fontSize = 12.sp, lineHeight = 16.sp,
            modifier = Modifier.widthIn(max = 220.dp).border(1.dp, Sm.Border).background(Color.White).clickable(onClick = onDismiss)
                .padding(6.dp).semantics { liveRegion = LiveRegionMode.Assertive },
        )
    }
}
