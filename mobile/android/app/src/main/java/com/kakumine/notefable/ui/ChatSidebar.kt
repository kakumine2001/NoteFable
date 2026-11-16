package com.kakumine.notefable.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.roundToIntRect
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.requiredSize
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ChatProjectSummary
import com.kakumine.notefable.data.SessionSummary
import kotlinx.coroutines.launch

/*
 * 侧栏的聊天部分（网页 chat-sidebar.tsx，手机 412×915 下量的值，1dp = 1 CSS px）：
 * - "新聊天"：.sidebar-primary-action，上距 12、高 44、圆角 8、深色、左对齐 16/550。
 * - 列表区左右 8、下 16，可滚动；顺序是 Pinned（有置顶时）→ PROJECTS 标题（右侧 ＋ 40、图标 15）→ 各项目 → CHATS → 没项目的聊天。
 * - 分区小标题 .chat-section-label：内边距 14.4/8/4.8，12 等宽大写灰字、字距 .06em。
 * - 项目行高 44：折叠箭头 13 + 文件夹 15 + 名称 14（间距 6.4，左右 3.2），有共通指示 / 参考笔记时名称后加 ScrollText 12 浅灰；
 *   右侧"在项目里新建聊天"＋ 和"更多"各 40（图标 16，右距 3.2）。项目里的聊天左缩进 12；没有时 12 灰字 "No chats" / "All chats pinned"。
 * - 聊天行高 44、圆角 6.4：没有拖动把手（长按标题区后拖）；图标区 40（左距 2，图标 15 / 表情）、标题 14/20（右距 8）、
 *   "更多" 40（图标 16）、置顶 40（Pin 14；已置顶时深色字加 .08 灰底）。当前行浅蓝底、字重 550、左侧 3px 蓝条（上下各缩 7.2）。
 * - 拖动：长按标题区后拖（网页触屏也是长按）。目标行上 / 下出现 2px 蓝线；拖到项目标题或 CHATS 标签上整块浅蓝底加 1px 蓝框，
 *   放下即移进去并取消置顶。被拖的行半透明。手指在列表上下边 30 内移动时每次移动滚 12（网页 updateTarget 的 scrollBy，手指不动就不滚）。长按之前的滑动照常滚动列表；长按开始后拖动被吃掉，抽屉的横滑关闭和列表滚动不会同时触发。
 */

private val ErrorRed = Color(0xFFB91C1C)

@Composable
internal fun ChatDrawerBody(
    state: ChatUiState,
    sidebar: SidebarViewModel,
    onNewChat: () -> Unit,
    onOpen: (String) -> Unit,
    onRetry: () -> Unit,
    closeDrawer: () -> Unit,
    /** 行首图标改表情（网页 chat-sidebar.tsx 的 .chat-row-icon-button）。 */
    onChangeIcon: (sessionId: String, icon: String?) -> Unit,
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
                onChangeIcon = onChangeIcon,
                onMenu = { session, anchor -> action = ChatAction.Menu(session, anchor) },
                onPin = sidebar::togglePin,
                onDrop = { id ->
                    when (val target = drag.target) {
                        is DropTarget.Row -> sidebar.reorder(ReorderMove(id, target.id, target.after))
                        is DropTarget.Into -> sidebar.dropIntoProject(id, target.containerId)
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
    val onChangeIcon: (String, String?) -> Unit,
    val onMenu: (SessionSummary, IntRect) -> Unit,
    val onPin: (SessionSummary) -> Unit,
    val onDrop: (String) -> Unit,
    val onDismissError: () -> Unit,
)

// 投放进项目时的样子：浅蓝底 + 1px 蓝框，圆角 4。
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
            val moveBusy = session.id in props.side.moveBusy
            // 图标按钮 40×40（左距 2、圆角 4）：表情（.notes-row-icon 15、行高 1）或 MessageSquareText 15 灰，点开表情选择器（aria-label "Change icon of {title}"）。
            EmojiTriggerButton(
                current = session.icon,
                onChange = { icon -> props.onChangeIcon(session.id, icon) },
                description = stringResource(R.string.em_change_icon_of, session.title),
                modifier = Modifier.padding(start = 2.dp).size(40.dp),
            ) {
                if (session.icon != null) Text(session.icon, fontSize = 15.sp, lineHeight = 15.sp) else LucideIcon(Lucide.MessageSquareText, 15.dp, Sm.Muted)
            }
            Row(
                // 标题区就是拖动处：长按后拖（网页整行拖动）。和网页一样只锁正在移动的这一行；别的行照常能拖（排序还没完时由 reorder() 提示等待）。
                Modifier.weight(1f).height(44.dp)
                    // reorderDrag 放在 clickable 里层：先收到抬起并吃掉它，长按后原地松手不会再打开这一行。
                    .clickable { props.onOpen(session.id) }
                    .reorderDrag(session.id, drag, locked = moveBusy, onStart = props.onDismissError, onDrop = { props.onDrop(session.id) }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
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

