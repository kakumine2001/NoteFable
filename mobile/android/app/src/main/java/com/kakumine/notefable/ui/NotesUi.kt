package com.kakumine.notefable.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AppLanguage
import com.kakumine.notefable.data.NoteGroupSummary
import com.kakumine.notefable.data.NoteImport
import com.kakumine.notefable.data.NotePageSummary
import com.kakumine.notefable.data.NoteTrashItem
import com.kakumine.notefable.data.TRASH_RETENTION_DAYS
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// 网页笔记界面（notes-sidebar / notes-home / note-group-dialogs / note-trash-dialog）的复刻。
// 数值来自网页在 412x915 手机视口下的实测，对照表见 docs/architecture/android-native.md。

private val Faint: Color get() = Sm.Faint
private val DangerText: Color get() = Sm.Danger          // .notes-delete
private val PanelShadow = Color(0x1F0F0F0F)          // --notion-shadow 0 4px 14px rgba(15,15,15,.12)
private val PanelRing: Color get() = Sm.Ring            // --notion-shadow 0 0 0 1px rgba(15,15,15,.05)

// ---------------------------------------------------------------------------------------------
// Chat / Workspace 切换（.notion-segmented）：高 48、底色 --notion-active、圆角 8、内边距 2、两键间距 2；
// 每键高 44、圆角 6.4、16/500（抽屉里 14/500，与网页宽 240 的侧栏相同）、图标 16 + 间距 6.4、左右内距 4；
// 选中白底、墨色字、蓝色图标、1px 细环 + 浅阴影。两键平时各占一半，名字比一半宽时那一侧按名字宽度变宽（segmentWidths，
// 网页 minmax(max-content, 1fr)）：日文「ワークスペース」在宽 240 的抽屉里放不下一半。

@Composable
fun WorkspaceSwitch(workspace: Workspace, onChange: (Workspace) -> Unit, modifier: Modifier = Modifier, inDrawer: Boolean = false) {
    val label = stringResource(R.string.workspace_mode)
    val fontSize = if (inDrawer) 14.sp else 16.sp
    Layout(
        content = {
            Segment(stringResource(R.string.chat_mode), Lucide.MessageSquareText, workspace == Workspace.Chat, fontSize) { onChange(Workspace.Chat) }
            Segment(stringResource(R.string.note_mode), Lucide.FileText, workspace == Workspace.Notes, fontSize) { onChange(Workspace.Notes) }
        },
        modifier = modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(8.dp)).background(Sm.Active).padding(2.dp)
            .semantics { contentDescription = label },
    ) { measurables, constraints ->
        val gap = 2.dp.roundToPx()
        val height = constraints.maxHeight
        val (first, second) = segmentWidths(
            constraints.maxWidth - gap,
            measurables[0].maxIntrinsicWidth(height),
            measurables[1].maxIntrinsicWidth(height),
        )
        val chat = measurables[0].measure(Constraints.fixed(first, height))
        val notes = measurables[1].measure(Constraints.fixed(second, height))
        layout(constraints.maxWidth, height) {
            chat.placeRelative(0, 0)
            notes.placeRelative(first + gap, 0)
        }
    }
}

@Composable
private fun Segment(text: String, icon: List<String>, active: Boolean, fontSize: TextUnit, onClick: () -> Unit) {
    val shape = RoundedCornerShape(6.4.dp)
    Row(
        Modifier.height(44.dp)
            .then(if (active) Modifier.shadow(1.dp, shape, ambientColor = Color(0x140F0F0F), spotColor = Color(0x140F0F0F)) else Modifier)
            .clip(shape)
            .then(if (active) Modifier.background(Sm.Surface).border(1.dp, Sm.pick(Color(0x1A0F0F0F), Sm.Border), shape) else Modifier)
            .clickable(onClick = onClick)
            .semantics { role = Role.Button }
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        LucideIcon(icon, 16.dp, if (active) Sm.Blue else Sm.Muted)
        Spacer(Modifier.width(6.4.dp))
        Text(
            text, color = if (active) Sm.Ink else Sm.Muted, fontSize = fontSize, fontWeight = FontWeight.Medium,
            maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
        )
    }
}

// ---------------------------------------------------------------------------------------------
// 侧栏的笔记部分（网页 NotesSidebar，手机尺寸）。头部和底部（品牌、账号）由 NoteFableRoot 放。

/** 拖动排序的回调（NotesViewModel.reorder / dropIntoGroup / dismissReorderError）。 */
class NoteReorder(
    val onReorder: (ReorderMove) -> Unit,
    val onDropInto: (pageId: String, groupId: String?) -> Unit,
    val onDismissError: () -> Unit,
) {
    /**
     * 最近一次拖动是从哪个列表开始的（侧栏或首页）。两个列表同时在组合里（抽屉盖在首页上），
     * 失败提示只显示在发起拖动的那个列表里，不然弹层会在两处各出一个。
     */
    var surface by mutableStateOf<NoteListSurface?>(null)

    companion object {
        val None = NoteReorder({}, { _, _ -> }, {})
    }
}

/** 松手：放到行前 / 后是排序，放到项目标题或 Notes 标签上是移进去。 */
private fun DragState.drop(id: String, reorder: NoteReorder) {
    when (val target = target) {
        is DropTarget.Row -> reorder.onReorder(ReorderMove(id, target.id, target.after))
        is DropTarget.Into -> reorder.onDropInto(id, target.containerId)
        null -> Unit
    }
    clear()
}

enum class NoteListSurface { Drawer, Home }

/** 一行笔记拖动相关的状态和回调，侧栏和首页共用。 */
private class NoteRowDrag(val drag: DragState, val state: NotesUiState, val busy: Boolean, val reorder: NoteReorder, val surface: NoteListSurface) {
    /** 这一篇的拖动失败提示（只在发起拖动的列表里显示）。 */
    fun errorFor(id: String): ReorderFailure? =
        state.reorderError?.takeIf { it.id == id && reorder.surface == surface }
}

@Composable
fun NotesDrawerBody(
    state: NotesUiState,
    onCreate: () -> Unit,
    onOpen: (String) -> Unit,
    onToggleGroup: (String) -> Unit,
    onMove: (NotePageSummary) -> Unit,
    onTrash: (NotePageSummary) -> Unit,
    onNewGroup: () -> Unit,
    onRenameGroup: (NoteGroupSummary) -> Unit,
    onDeleteGroup: (NoteGroupSummary) -> Unit,
    onOpenTrash: () -> Unit,
    /** 行首图标改表情（网页 notes-sidebar.tsx 的 .chat-row-icon-button；打开着的笔记在编辑器里改）。 */
    onChangeIcon: (NotePageSummary, String?) -> Unit,
    modifier: Modifier = Modifier,
    onSearch: () -> Unit = {},
    reorder: NoteReorder = NoteReorder.None,
    /** 子页面的树：展开 / 收起、在这一篇里新建（网页 notes-sidebar 的箭头和"+"）。 */
    onToggleExpanded: (String) -> Unit = {},
    onCreateInside: (NotePageSummary) -> Unit = {},
    /** Favorites 行右侧的"从收藏中移除"。 */
    onUnfavorite: (NotePageSummary) -> Unit = {},
    /** 回收站上面的 "Import Markdown"（网页 notes-sidebar：打开文件选择器）。 */
    onImport: () -> Unit = {},
) {
    val busy = state.busy || state.loading
    val scroll = rememberScrollState()
    val drag = remember(scroll) { DragState(scroll) }
    val rowDrag = NoteRowDrag(drag, state, busy, reorder, NoteListSurface.Drawer)
    val tree = NoteTreeActions(state, onOpen, onMove, onTrash, onChangeIcon, onToggleExpanded, onCreateInside)
    Column(modifier) {
        // "新笔记"（.sidebar-primary-action，手机）：上距 12、高 44、圆角 8、深色底，左对齐图标 16 + 间距 8 + 16/550 白字。
        Row(
            Modifier.padding(start = 8.dp, end = 8.dp, top = 12.dp, bottom = 4.dp).fillMaxWidth().height(44.dp)
                .shadow(1.dp, RoundedCornerShape(8.dp), ambientColor = Color(0x1F0C1730), spotColor = Color(0x1F0C1730))
                .clip(RoundedCornerShape(8.dp)).background(if (busy) Sm.Ink.copy(alpha = 0.6f) else Sm.Ink)
                .clickable(enabled = !busy, onClick = onCreate)
                .padding(horizontal = 11.2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LucideIcon(Lucide.Plus, 16.dp, Sm.OnInk)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.new_note), color = Sm.OnInk, fontSize = 16.sp, fontWeight = FontWeight(550))
        }
        // Search 行（Batch 4）：网页侧栏里在"新建"按钮正下方。
        SidebarSearchRow(onSearch)

        Column(
            Modifier.weight(1f).fillMaxWidth()
                .onGloballyPositioned { drag.listBounds = it.boundsInWindow() }
                .verticalScroll(scroll).padding(start = 8.dp, end = 8.dp, bottom = 16.dp),
        ) {
            // FAVORITES（网页 .chat-section-label，在 Projects 上面）：收藏的页面，平铺、不能拖，右侧"从收藏中移除"。
            val favorites = state.favorites
            if (favorites.isNotEmpty()) {
                val label = stringResource(R.string.pg_favorites).uppercase()
                Text(label, style = roleLabelStyle(label), modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 14.4.dp, bottom = 4.8.dp))
                favorites.forEach { page -> key("fav-" + page.id) { FavoriteRow(page, state.open?.id == page.id, busy, onOpen, onUnfavorite) } }
            }
            // "PROJECTS" 小标题 + 右侧 40 的"新项目"按钮（上下 -4.8，整行高 49.6）。
            Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 9.6.dp), verticalAlignment = Alignment.CenterVertically) {
                val heading = stringResource(R.string.projects).uppercase()
                Text(heading, style = roleLabelStyle(heading), modifier = Modifier.weight(1f))
                IconSquare(Lucide.Plus, 15.dp, 40.dp, stringResource(R.string.new_project), Sm.Muted, onClick = onNewGroup)
            }
            state.groups.forEach { group ->
                val members = state.members(group.id)
                val open = group.id !in state.collapsed
                // 项目行同时是"移进这个项目"的投放区（网页 data-note-group-drop={group.id}）。
                DisposableEffect(group.id) { onDispose { drag.zones.remove(group.id) } }
                GroupRow(
                    group, state.memberCount(group.id), open, onToggle = { onToggleGroup(group.id) }, onRename = { onRenameGroup(group) }, onDelete = { onDeleteGroup(group) },
                    modifier = Modifier.dropZone(drag.target == DropTarget.Into(group.id)).onGloballyPositioned { drag.zones[group.id] = it.boundsInWindow() },
                )
                if (open) {
                    // .notes-group-members：左距 12、1px 竖线、内左距 4。
                    Column(
                        Modifier.padding(start = 12.dp).fillMaxWidth()
                            .drawBehind {
                                val lineW = 1.dp.toPx()
                                val lineX = if (layoutDirection == LayoutDirection.Rtl) size.width - lineW else 0f
                                drawRect(Sm.Border, topLeft = Offset(lineX, 0f), size = Size(lineW, size.height))
                            }
                            .padding(start = 5.dp),
                    ) {
                        if (members.isEmpty()) {
                            Text(stringResource(R.string.no_notes_in_project), color = Faint, fontSize = 12.sp, lineHeight = 16.sp,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp))
                        }
                        members.forEach { page -> key(page.id) { NoteTree(page, busy, rowDrag, tree) } }
                    }
                }
            }
            // 网页：改图标失败的提示在 NOTES 标签上方，px-2、12 红字。
            if (state.iconError) {
                Text(stringResource(R.string.em_note_icon_failed), color = Sm.Danger, fontSize = 12.sp, lineHeight = 16.sp,
                    modifier = Modifier.padding(horizontal = 8.dp).semantics { liveRegion = androidx.compose.ui.semantics.LiveRegionMode.Assertive })
            }
            val notesLabel = stringResource(R.string.notes).uppercase()
            // NOTES 标签同时是"移出项目"的投放区（网页 data-note-group-drop=""）。
            Text(
                notesLabel, style = roleLabelStyle(notesLabel),
                modifier = Modifier.fillMaxWidth().dropZone(drag.target == DropTarget.Into(null))
                    .onGloballyPositioned { drag.zones[""] = it.boundsInWindow() }
                    .padding(start = 8.dp, end = 8.dp, top = 14.4.dp, bottom = 4.8.dp),
            )
            state.loosePages.forEach { page -> key(page.id) { NoteTree(page, busy, rowDrag, tree) } }
            if (state.pages.isEmpty() && state.loaded) {
                Text(stringResource(R.string.notes_list_empty), color = Sm.Muted, fontSize = 12.sp, lineHeight = 20.sp,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp))
            }
        }

        // 导入 Markdown、回收站（.notion-sidebar-action，手机）：高 44、左右 8、图标 16 + 间距 8.8、16/500；两行紧挨着，最下面留 4。
        // 导入在新建 / 读取期间不能点（网页 disabled={busy}）。
        SidebarAction(Lucide.Upload, stringResource(R.string.import_markdown), enabled = !busy, onClick = onImport)
        SidebarAction(Lucide.Trash2, stringResource(R.string.trash), onClick = onOpenTrash, modifier = Modifier.padding(bottom = 4.dp))
    }
}

@Composable
private fun SidebarAction(icon: List<String>, text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Row(
        modifier.padding(horizontal = 8.dp).fillMaxWidth().height(44.dp).clip(RoundedCornerShape(4.8.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LucideIcon(icon, 16.dp, Sm.Text)
        Spacer(Modifier.width(8.8.dp))
        Text(text, color = Sm.Text, fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// 项目行（.notion-session-row + .chat-project-toggle）：高 44；展开箭头 14、文件夹 15、名称 14/500、数量 12 浅灰；
// 右侧重命名（铅笔 13）和删除（垃圾桶 14）两个 25.6 的小按钮，触屏上常显。
@Composable
private fun GroupRow(
    group: NoteGroupSummary, count: Int, open: Boolean, onToggle: () -> Unit, onRename: () -> Unit, onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.4.dp)), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.weight(1f).clickable(onClick = onToggle).padding(horizontal = 3.2.dp, vertical = 6.4.dp)
                .semantics { role = Role.Button },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.4.dp),
        ) {
            LucideIcon(if (open) Lucide.ChevronDown else Lucide.ChevronRight, 14.dp, Sm.Text)
            LucideIcon(Lucide.Folder, 15.dp, Sm.Text)
            Text(group.name, color = Sm.Text, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Text(count.toString(), color = Faint, fontSize = 12.sp, lineHeight = 16.sp)
        }
        RowAction(Lucide.Pencil, 13.dp, stringResource(R.string.rename_name, group.name), onRename)
        RowAction(Lucide.Trash2, 14.dp, stringResource(R.string.delete_project_name, group.name), onDelete)
    }
}

// 笔记行：高 44、圆角 6.4；没有拖动把手，长按行主体后拖；图标按钮区 40（左距 2，内含 20 的图标：表情 15 或文件图标 15 灰）；标题 14；
// 右侧"移到项目"和"移到回收站"两个 25.6 的小按钮（图标 14 灰，右距 3.2）。当前打开的行浅蓝底加左侧蓝条。
// 拖动中被拖的行半透明，目标行上 / 下 2px 蓝线（这时不画左侧蓝条）。
/** 侧栏子页面的树用到的状态和回调。打开着的笔记的祖先总是展开（网页 notes-sidebar 的 activeAncestors）。 */
private class NoteTreeActions(
    val state: NotesUiState,
    val onOpen: (String) -> Unit,
    val onMove: (NotePageSummary) -> Unit,
    val onTrash: (NotePageSummary) -> Unit,
    val onChangeIcon: (NotePageSummary, String?) -> Unit,
    val onToggle: (String) -> Unit,
    val onCreateInside: (NotePageSummary) -> Unit,
) {
    val openAncestors: Set<String> = state.open?.let { open -> state.ancestors(open.id).mapTo(HashSet()) { it.id } } ?: emptySet()
    fun isOpen(id: String, hasChildren: Boolean) = id in state.expanded || (hasChildren && id in openAncestors)
}

// 子页面（网页 .notes-subpages = .notes-group-members）：展开时在父页面下，左距 12、1px 竖线、内左距 4；
// 没有子页面时是"No pages inside"（13 浅灰，内边距 6×8）。
@Composable
private fun NoteTree(page: NotePageSummary, busy: Boolean, rowDrag: NoteRowDrag, tree: NoteTreeActions) {
    val kids = tree.state.children(page.id)
    val open = tree.isOpen(page.id, kids.isNotEmpty())
    NoteRow(page, tree.state.open?.id == page.id, busy, rowDrag, tree.onOpen, tree.onMove, tree.onTrash, tree.onChangeIcon,
        open = open, onToggle = { tree.onToggle(page.id) }, onCreateInside = { tree.onCreateInside(page) })
    if (open) {
        Column(
            Modifier.padding(start = 12.dp).fillMaxWidth()
                .drawBehind {
                    val lineW = 1.dp.toPx()
                    val lineX = if (layoutDirection == LayoutDirection.Rtl) size.width - lineW else 0f
                    drawRect(Sm.Border, topLeft = Offset(lineX, 0f), size = Size(lineW, size.height))
                }
                .padding(start = 5.dp),
        ) {
            if (kids.isEmpty()) {
                Text(stringResource(R.string.pg_no_pages_inside), color = Faint, fontSize = 13.sp, lineHeight = 19.5.sp,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp))
            }
            kids.forEach { child -> key(child.id) { NoteTree(child, busy, rowDrag, tree) } }
        }
    }
}

// Favorites 的行（网页 notes-sidebar 的收藏行）：高 44；图标区 28（左距 4，表情 / 文件图标 15 灰，不能点）；标题 14；
// 右侧"从收藏中移除"25.6 的小按钮（StarOff 14）。当前打开的行浅蓝底。
@Composable
private fun FavoriteRow(page: NotePageSummary, active: Boolean, busy: Boolean, onOpen: (String) -> Unit, onUnfavorite: (NotePageSummary) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.4.dp))
            .background(if (active) Sm.AccentSoft else Color.Transparent)
            .clickable(enabled = !busy) { onOpen(page.id) },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.padding(start = 4.dp).size(28.dp), Alignment.Center) { NoteIcon(page.icon, 15.sp, 15.dp, Sm.Muted) }
        Text(page.title, modifier = Modifier.weight(1f).padding(start = 4.dp, end = 8.dp), color = if (active) Sm.Ink else Sm.Text,
            fontSize = 14.sp, lineHeight = 20.sp, fontWeight = if (active) FontWeight(550) else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
        RowAction(Lucide.StarOff, 14.dp, stringResource(R.string.pg_remove_title_from_favorites, page.title), enabled = !busy) { onUnfavorite(page) }
    }
}

@Composable
private fun NoteRow(
    page: NotePageSummary,
    active: Boolean,
    busy: Boolean,
    rowDrag: NoteRowDrag,
    onOpen: (String) -> Unit,
    onMove: (NotePageSummary) -> Unit,
    onTrash: (NotePageSummary) -> Unit,
    onChangeIcon: (NotePageSummary, String?) -> Unit,
    open: Boolean = false,
    onToggle: () -> Unit = {},
    onCreateInside: () -> Unit = {},
) {
    val drag = rowDrag.drag
    val target = drag.target as? DropTarget.Row
    val lineBefore = target?.id == page.id && !target.after
    val lineAfter = target?.id == page.id && target.after
    val reorderError = rowDrag.errorFor(page.id)
    DisposableEffect(page.id) { onDispose { drag.rows.remove(page.id) } }
    Box {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp)
                .alpha(if (drag.dragging == page.id) 0.5f else 1f)
                .onGloballyPositioned { drag.rows[page.id] = it.boundsInWindow() }
                .clip(RoundedCornerShape(6.4.dp))
                .background(if (active) Sm.AccentSoft else Color.Transparent)
                .drawBehind {
                    if (active && !lineBefore && !lineAfter) {
                        val inset = 7.2.dp.toPx()
                        val barW = 3.dp.toPx()
                        val barX = if (layoutDirection == LayoutDirection.Rtl) size.width - barW else 0f
                        drawRoundRect(Sm.Blue, topLeft = Offset(barX, inset), size = Size(barW, size.height - inset * 2),
                            cornerRadius = CornerRadius(1.5.dp.toPx()))
                    }
                }
                .dropLine(lineBefore, lineAfter),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 展开箭头（.notes-row-toggle）：20×28、左距 2、圆角 4，Chevron 14 浅灰。
            val toggleLabel = if (open) collapseLabel(page.title) else expandLabel(page.title)
            Box(
                Modifier.padding(start = 2.dp).size(20.dp, 28.dp).clip(RoundedCornerShape(4.dp)).clickable(onClick = onToggle)
                    .semantics { contentDescription = toggleLabel; role = Role.Button },
                Alignment.Center,
            ) { LucideIcon(if (open) Lucide.ChevronDown else Lucide.ChevronRight, 14.dp, Faint) }
            Row(
                Modifier.weight(1f).heightIn(min = 44.dp).clickable(enabled = !busy) { onOpen(page.id) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (active || page.locked) {
                    // 打开着的笔记：图标由编辑器保存（网页走自动保存），这里只显示，点它和点行一样。
                    // 锁定的页面也不能在这里改图标（网页 disabled={page.locked}）。
                    Box(Modifier.size(40.dp), Alignment.Center) { NoteIcon(page.icon, 15.sp, 15.dp, Sm.Muted) }
                } else {
                    // 图标按钮 40×40（左距 2、圆角 4），点开表情选择器（aria-label "Change icon of {title}"）；忙时禁用。
                    EmojiTriggerButton(
                        current = page.icon,
                        onChange = { icon -> onChangeIcon(page, icon) },
                        description = stringResource(R.string.em_change_icon_of, page.title),
                        modifier = Modifier.size(40.dp),
                        enabled = !busy,
                    ) { NoteIcon(page.icon, 15.sp, 15.dp, Sm.Muted) }
                }
                Text(
                    page.title,
                    // 拖动处只是标题区（网页的拖动元是标题按钮，图标按钮在它外面），撑满行高；放在行的 clickable 里层，长按后原地松手不会打开。
                    modifier = Modifier.weight(1f).heightIn(min = 44.dp).noteReorderDrag(page, rowDrag).wrapContentHeight()
                        .padding(start = 4.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                    color = if (active) Sm.Ink else Sm.Text,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    fontWeight = if (active) FontWeight(550) else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                RowAction(Lucide.Plus, 14.dp, stringResource(R.string.pg_add_page_inside_title, page.title), enabled = !busy) { onCreateInside() }
                RowAction(Lucide.FolderInput, 14.dp, stringResource(R.string.move_title_to_project, page.title), enabled = !busy) { onMove(page) }
                RowAction(Lucide.Trash2, 14.dp, stringResource(R.string.move_title_to_trash, page.title), enabled = !busy) { onTrash(page) }
            }
        }
        if (reorderError != null) ReorderErrorPopup(reorderFailureText(reorderError), rowDrag.reorder.onDismissError)
    }
}

@Composable
private fun collapseLabel(title: String) = stringResource(R.string.pg_collapse_title, title)

@Composable
private fun expandLabel(title: String) = stringResource(R.string.pg_expand_title, title)

/** 笔记行主体的长按拖动（网页 ReorderRowButton，disabled={busy}；正在移动的这一篇也不能拖）。 */
private fun Modifier.noteReorderDrag(page: NotePageSummary, rowDrag: NoteRowDrag): Modifier = reorderDrag(
    id = page.id,
    drag = rowDrag.drag,
    locked = rowDrag.busy || page.id in rowDrag.state.moveBusy,
    onStart = {
        rowDrag.reorder.surface = rowDrag.surface
        rowDrag.reorder.onDismissError()
    },
    onDrop = { rowDrag.drag.drop(page.id, rowDrag.reorder) },
)

@Composable
private fun reorderFailureText(failure: ReorderFailure): String = when {
    failure.wait -> stringResource(R.string.sb_err_wait_move)
    failure.detail != null -> rememberSystemText().localize(failure.detail)
    else -> stringResource(R.string.sb_err_move_item)
}

@Composable
private fun RowAction(icon: List<String>, iconSize: Dp, description: String, onClick: () -> Unit) =
    RowAction(icon, iconSize, description, enabled = true, onClick = onClick)

@Composable
private fun RowAction(icon: List<String>, iconSize: Dp, description: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.padding(end = 3.2.dp).size(25.6.dp).clip(RoundedCornerShape(4.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .semantics { contentDescription = description; role = Role.Button },
        Alignment.Center,
    ) { LucideIcon(icon, iconSize, Sm.Muted) }
}

@Composable
private fun IconSquare(icon: List<String>, iconSize: Dp, box: Dp, description: String, tint: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.size(box).clip(RoundedCornerShape(4.8.dp)).clickable(onClick = onClick)
            .semantics { contentDescription = description; role = Role.Button },
        Alignment.Center,
    ) { LucideIcon(icon, iconSize, tint) }
}

/** 笔记图标：设置了表情就显示表情，否则是 lucide 的 FileText。 */
@Composable
fun NoteIcon(icon: String?, emojiSize: androidx.compose.ui.unit.TextUnit, iconSize: Dp, tint: Color) {
    // 上传的图片图标：和表情一样大（1em 四方、圆角 3），带登录 Cookie 读（Coil 共用 App 的 OkHttp）。
    val image = com.kakumine.notefable.data.NoteIcons.imagePath(icon)
    if (image != null) {
        val side = with(androidx.compose.ui.platform.LocalDensity.current) { emojiSize.toDp() }
        coil3.compose.AsyncImage(
            model = com.kakumine.notefable.BuildConfig.BASE_URL.trimEnd('/') + image,
            contentDescription = null,
            contentScale = androidx.compose.ui.layout.ContentScale.Crop,
            modifier = Modifier.size(side).clip(androidx.compose.foundation.shape.RoundedCornerShape(3.dp)),
        )
    } else if (icon != null) Text(icon, fontSize = emojiSize, lineHeight = emojiSize)
    else LucideIcon(Lucide.FileText, iconSize, tint)
}

// ---------------------------------------------------------------------------------------------
// 笔记首页（网页 NotesHome，手机）：没有打开笔记时显示。左右 24、下 96；顶部切换（上距 4）；
// "Notes" 32/750、行高 48、字距 −0.04em，上 8 下 12；项目小标题 13/600 灰 + 数量 13 浅灰，外边距 20/4/4；
// 每行最小高 56、下边 1px 线；图标区 28（表情 20 / 文件图标 20 浅灰）、间距 13.6、标题 17/500、日期 13 灰；
// 右侧 44×48 的"移到项目"（图标 18 浅灰）。下面"新笔记"（高 40、圆角 8、深色）和"新项目"（高 40 文字按钮）。

@Composable
fun NotesHome(
    state: NotesUiState,
    onSwitch: (Workspace) -> Unit,
    onOpen: (String) -> Unit,
    onCreate: () -> Unit,
    onMove: (NotePageSummary) -> Unit,
    onNewGroup: () -> Unit,
    onRetry: () -> Unit,
    reorder: NoteReorder = NoteReorder.None,
    onToggleExpanded: (String) -> Unit = {},
    /** "Import Markdown"（列表下面的按钮、空状态的按钮）：打开文件选择器。 */
    onImport: () -> Unit = {},
) {
    val busy = state.busy || state.loading
    val scroll = rememberScrollState()
    val drag = remember(scroll) { DragState(scroll) }
    val rowDrag = NoteRowDrag(drag, state, busy, reorder, NoteListSurface.Home)
    Column(
        Modifier.fillMaxSize().onGloballyPositioned { drag.listBounds = it.boundsInWindow() }
            .verticalScroll(scroll).padding(start = 24.dp, end = 24.dp, bottom = 96.dp),
    ) {
        WorkspaceSwitch(Workspace.Notes, onSwitch, Modifier.padding(top = 4.dp))
        state.error?.let { ErrorBar(notesErrorText(it), onRetry, Modifier.padding(top = 24.dp)) }
        when {
            state.loading && state.pages.isEmpty() && state.groups.isEmpty() ->
                Text(stringResource(R.string.loading_notes), color = Sm.Muted, fontSize = 14.sp,
                    modifier = Modifier.padding(top = 96.dp, bottom = 16.dp))
            state.pages.isEmpty() && state.groups.isEmpty() -> if (state.error == null && state.loaded) NotesEmpty(busy, onCreate, onImport)
            else -> NotesHomeList(state, busy, rowDrag, onOpen, onCreate, onMove, onNewGroup, onToggleExpanded, onImport)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NotesHomeList(
    state: NotesUiState,
    busy: Boolean,
    rowDrag: NoteRowDrag,
    onOpen: (String) -> Unit,
    onCreate: () -> Unit,
    onMove: (NotePageSummary) -> Unit,
    onNewGroup: () -> Unit,
    onToggleExpanded: (String) -> Unit,
    onImport: () -> Unit,
) {
    val drag = rowDrag.drag
    // 子页面的树（网页 notes-home）：最上层的页面按项目分组，子页面在展开的父页面下缩进 24。
    @Composable
    fun Tree(page: NotePageSummary) {
        val kids = state.children(page.id)
        val open = page.id in state.expanded
        HomeItem(page, busy, rowDrag, onOpen, onMove, open = open, onToggle = { onToggleExpanded(page.id) })
        if (open) {
            if (kids.isEmpty()) Text(stringResource(R.string.pg_no_pages_inside), color = Faint, fontSize = 14.sp, modifier = Modifier.padding(start = 28.dp, top = 4.dp, bottom = 4.dp, end = 4.dp))
            else Column(Modifier.padding(start = 24.dp)) { kids.forEach { key(it.id) { Tree(it) } } }
        }
    }
    // 标题 "Workspace" 和 "No project" 小标题是"移出项目"的投放区，项目小标题是"移进项目"的（网页 data-note-group-drop）。
    fun Modifier.zone(key: String): Modifier =
        dropZone(drag.target is DropTarget.Into && drag.targetZone == key).onGloballyPositioned { drag.zones[key] = it.boundsInWindow() }
    DisposableEffect(Unit) { onDispose { drag.zones.clear() } }
    val hasLooseHeading = state.groups.isNotEmpty() && state.loosePages.isNotEmpty()
    DisposableEffect(hasLooseHeading) { onDispose { drag.zones.remove(" ") } }
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Text(
        stringResource(R.string.workspace),
        modifier = Modifier.padding(top = 8.dp, bottom = 12.dp).fillMaxWidth().zone(""),
        color = Sm.Ink, fontSize = 32.sp, lineHeight = 48.sp, fontWeight = FontWeight(750), letterSpacing = if (rtl) 0.sp else (-1.28).sp,
    )
    // Favorites（网页 notes-home 的收藏）：小标题 + 平铺的行（不能拖，没有日期和移动键）。
    val favorites = state.favorites
    if (favorites.isNotEmpty()) {
        GroupHeading(stringResource(R.string.pg_favorites), favorites.size)
        Column(Modifier.padding(bottom = 16.dp)) { favorites.forEach { page -> key("fav-" + page.id) { FavoriteHomeItem(page, busy, onOpen) } } }
    }
    state.groups.forEach { group ->
        val members = state.members(group.id)
        key(group.id) {
            DisposableEffect(group.id) { onDispose { drag.zones.remove(group.id) } }
            GroupHeading(group.name, state.memberCount(group.id), Modifier.zone(group.id))
        }
        if (members.isEmpty()) {
            Text(stringResource(R.string.no_notes_in_project), color = Faint, fontSize = 14.sp, modifier = Modifier.padding(4.dp))
        } else {
            Column(Modifier.padding(bottom = 16.dp)) { members.forEach { key(it.id) { Tree(it) } } }
        }
    }
    val loose = state.loosePages
    // "No project" 小标题的键是 " "（空白键都表示无项目），和标题 "Notes" 的 "" 分开登记、分开高亮。
    if (state.groups.isNotEmpty() && loose.isNotEmpty()) GroupHeading(stringResource(R.string.no_project), state.looseCount, Modifier.zone(" "))
    if (loose.isNotEmpty()) Column(Modifier.padding(bottom = 16.dp)) { loose.forEach { key(it.id) { Tree(it) } } }
    // .notes-home-actions：上距 8、间距 8、放不下就换行（三个按钮在窄屏或长文案时会换）。
    FlowRow(
        Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        InkButton(stringResource(R.string.new_note), 40.dp, enabled = !busy, onClick = onCreate)
        HomeTextButton(Lucide.FolderPlus, stringResource(R.string.new_project), enabled = !busy, onClick = onNewGroup)
        HomeTextButton(Lucide.Upload, stringResource(R.string.import_markdown), enabled = !busy, onClick = onImport)
    }
}

// .notion-button.notes-home-new-group：高 40、圆角 4.8、左右 12、图标 16 + 间距 6.4、12.8/500。"新项目"和"导入 Markdown"用。
@Composable
private fun HomeTextButton(icon: List<String>, text: String, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.height(40.dp).clip(RoundedCornerShape(4.8.dp)).clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LucideIcon(icon, 16.dp, Sm.Text)
        Spacer(Modifier.width(6.4.dp))
        Text(text, color = Sm.Text, fontSize = 12.8.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

@Composable
private fun GroupHeading(name: String, count: Int, modifier: Modifier = Modifier) {
    // 外边距 20/4/4 放在投放区外面：高亮框只包住这一行（网页 h2 的 margin 不在背景里）。
    Row(Modifier.padding(start = 4.dp, end = 4.dp, top = 20.dp, bottom = 4.dp).then(modifier), verticalAlignment = Alignment.CenterVertically) {
        Text(name, color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.5.sp, fontWeight = FontWeight.SemiBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Spacer(Modifier.width(8.dp))
        Text(count.toString(), color = Faint, fontSize = 13.sp, lineHeight = 19.5.sp)
    }
}

// 收藏的行（网页 .notes-home-item > .notes-home-row）：最小高 56、下边 1px 线；图标区 28、间距 13.6、标题 17/500。
@Composable
private fun FavoriteHomeItem(page: NotePageSummary, busy: Boolean, onOpen: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 57.dp)
            .drawBehind { drawRect(Sm.Border, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = Size(size.width, 1.dp.toPx())) }
            .clickable(enabled = !busy) { onOpen(page.id) }.padding(horizontal = 4.dp, vertical = 6.4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(28.dp), Alignment.Center) { NoteIcon(page.icon, 20.sp, 20.dp, Faint) }
        Spacer(Modifier.width(13.6.dp))
        Text(page.title, modifier = Modifier.weight(1f), color = Sm.Text, fontSize = 17.sp, lineHeight = 25.5.sp,
            fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun HomeItem(
    page: NotePageSummary, busy: Boolean, rowDrag: NoteRowDrag, onOpen: (String) -> Unit, onMove: (NotePageSummary) -> Unit,
    open: Boolean = false, onToggle: () -> Unit = {},
) {
    val moveLabel = stringResource(R.string.move_title_to_project, page.title)
    val drag = rowDrag.drag
    val target = drag.target as? DropTarget.Row
    val reorderError = rowDrag.errorFor(page.id)
    DisposableEffect(page.id) { onDispose { drag.rows.remove(page.id) } }
    Box {
    Row(
        Modifier.fillMaxWidth()
            .alpha(if (drag.dragging == page.id) 0.5f else 1f)
            .onGloballyPositioned { drag.rows[page.id] = it.boundsInWindow() }
            .drawBehind { drawRect(Sm.Border, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = Size(size.width, 1.dp.toPx())) }
            .dropLine(target?.id == page.id && !target.after, target?.id == page.id && target.after)
            .padding(bottom = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 展开箭头（.notes-home-toggle）：28×48，Chevron 18 浅灰。
        val toggleLabel = if (open) collapseLabel(page.title) else expandLabel(page.title)
        Box(
            Modifier.size(28.dp, 48.dp).clickable(onClick = onToggle)
                .semantics { contentDescription = toggleLabel; role = Role.Button },
            Alignment.Center,
        ) { LucideIcon(if (open) Lucide.ChevronDown else Lucide.ChevronRight, 18.dp, Faint) }
        Row(
            Modifier.weight(1f).heightIn(min = 56.dp).clickable(enabled = !busy) { onOpen(page.id) }.noteReorderDrag(page, rowDrag).padding(horizontal = 4.dp, vertical = 6.4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(28.dp), Alignment.Center) { NoteIcon(page.icon, 20.sp, 20.dp, Faint) }
            Spacer(Modifier.width(13.6.dp))
            Text(page.title, modifier = Modifier.weight(1f), color = Sm.Text, fontSize = 17.sp, lineHeight = 25.5.sp,
                fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.width(13.6.dp))
            Text(shortDate(page.updatedAt), color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.5.sp)
        }
        Box(
            Modifier.size(width = 44.dp, height = 48.dp).clickable(enabled = !busy) { onMove(page) }
                .semantics { contentDescription = moveLabel; role = Role.Button },
            Alignment.Center,
        ) { LucideIcon(Lucide.FolderInput, 18.dp, Faint) }
    }
    if (reorderError != null) ReorderErrorPopup(reorderFailureText(reorderError), rowDrag.reorder.onDismissError, rowHeight = 57.dp)
    }
}

/**
 * 网页 `toLocaleDateString(tag, { month: "short", day: "numeric" })`：英文 "Nov 14"、中日文 "11月14日"。
 * tag 是界面语言（`ui_locale`）对应的网页 LOCALE_TAGS，不是系统语言（系统是德语等时界面落到英文，日期也用英文）。
 */
@Composable
private fun shortDate(iso: String): String {
    val locale = Locale.forLanguageTag(AppLanguage.acceptLanguage(stringResource(R.string.ui_locale)))
    return remember(iso, locale) {
        runCatching {
            val pattern = android.text.format.DateFormat.getBestDateTimePattern(locale, "MMMd")
            DateTimeFormatter.ofPattern(pattern, locale).format(Instant.parse(iso).atZone(ZoneId.systemDefault()))
        }.getOrDefault("")
    }
}

// 一篇笔记都没有（网页 NotesWorkspace 的空状态，手机）：上距 120；文件图标 28（线宽 1.4，浅灰）；
// "Workspace" 40/750、行高 1.25、字距 −0.04em，上距 16；说明 15/24 灰（"/"是等宽小键帽），上距 8；
// 按钮行上距 24、间距 10、放不下换行、整行水平居中（网页 mt-6 flex flex-wrap items-center justify-center gap-2.5）：
// "新笔记"高 32、圆角 8，旁边"导入 Markdown"（高 40 的文字按钮）；最下面 12/20 浅灰的存储说明，上距 40、最宽 384。
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NotesEmpty(busy: Boolean, onCreate: () -> Unit, onImport: () -> Unit) {
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Column(Modifier.padding(top = 120.dp)) {
        LucideIcon(Lucide.FileText, 28.dp, Faint, strokeWidth = 1.4f)
        Text(stringResource(R.string.workspace), modifier = Modifier.padding(top = 16.dp), color = Sm.Ink, fontSize = 40.sp,
            lineHeight = 50.sp, fontWeight = FontWeight(750), letterSpacing = if (rtl) 0.sp else (-1.6).sp)
        val intro = stringResource(R.string.notes_intro).split("%1\$s")
        Text(
            buildAnnotatedString {
                intro.forEachIndexed { index, part ->
                    if (index > 0) withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, background = Sm.CodeBackground)) { append(" / ") }
                    append(part)
                }
            },
            modifier = Modifier.padding(top = 8.dp), color = Sm.Muted, fontSize = 15.sp, lineHeight = 24.sp,
        )
        FlowRow(
            Modifier.padding(top = 24.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            InkButton(stringResource(R.string.new_note), 32.dp, enabled = !busy, onClick = onCreate)
            HomeTextButton(Lucide.Upload, stringResource(R.string.import_markdown), enabled = !busy, onClick = onImport)
        }
        Text(stringResource(R.string.notes_storage_hint), modifier = Modifier.padding(top = 40.dp).widthIn(max = 384.dp),
            color = Faint, fontSize = 12.sp, lineHeight = 20.sp)
    }
}

// .notes-empty-new：圆角 8、深色底、左右 12、图标 16 + 间距 6、14/550 白字。
@Composable
private fun InkButton(text: String, height: Dp, enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.height(height).clip(RoundedCornerShape(8.dp)).background(Sm.Ink).clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LucideIcon(Lucide.Plus, 16.dp, Sm.OnInk)
        Spacer(Modifier.width(6.dp))
        Text(text, color = Sm.OnInk, fontSize = 14.sp, fontWeight = FontWeight(550))
    }
}

// .notion-error：浅红底、#933b34、圆角 4.8、内边距 8.8×10.4、12.8 字；右边"重试"按钮。
@Composable
fun ErrorBar(text: String, onRetry: (() -> Unit)?, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(4.8.dp)).background(Sm.ErrorBg).padding(horizontal = 10.4.dp, vertical = 8.8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = Sm.ErrorText, fontSize = 12.8.sp, modifier = Modifier.weight(1f))
        if (onRetry != null) NotionButton(stringResource(R.string.retry), onClick = onRetry, modifier = Modifier.padding(start = 12.dp))
    }
}

@Composable
fun notesErrorText(error: NotesError): String = error.detail?.let { rememberSystemText().localize(it) }
    // 这一句带个数（网页 "You can import up to {max} files at once."）。
    ?: if (error.kind == NotesError.Kind.ImportTooMany) stringResource(R.string.note_import_too_many, NoteImport.MAX_FILES) else stringResource(
    when (error.kind) {
        NotesError.Kind.Load -> R.string.err_load_notes
        NotesError.Kind.Create -> R.string.err_create_note
        NotesError.Kind.Trash -> R.string.err_trash_note
        NotesError.Kind.TrashUnsaved -> R.string.err_trash_unsaved
        NotesError.Kind.Group -> R.string.err_group
        NotesError.Kind.TrashLoad -> R.string.err_trash_load
        NotesError.Kind.TrashAction -> R.string.err_trash_request
        NotesError.Kind.UnsavedDraft -> R.string.err_save_draft
        NotesError.Kind.Export -> R.string.note_export_failed
        NotesError.Kind.ExportUnsaved -> R.string.note_export_unsaved
        NotesError.Kind.Import, NotesError.Kind.ImportTooMany -> R.string.note_import_failed
        NotesError.Kind.ImportBadType -> R.string.note_import_bad_type
        NotesError.Kind.ImportFileTooLarge -> R.string.note_import_file_too_large
        NotesError.Kind.ImportTooLarge -> R.string.note_import_too_large
    },
)

// ---------------------------------------------------------------------------------------------
// 按钮：.notion-button 最小高 32、左右 12、圆角 4.8、12.8/500；回收站窗口里放大到 44 / 左右 16 / 15。
// danger 是红字（.notes-delete），primary 是深色底白字（.notion-button-primary）。

@Composable
fun NotionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    danger: Boolean = false,
    primary: Boolean = false,
    large: Boolean = false,
    /** 文字右边的图标（网页 inline-flex gap-1：间距 4，图标 15）。 */
    trailingIcon: List<String>? = null,
) {
    val fade = if (enabled) 1f else if (primary) 0.45f else 0.6f
    Box(
        modifier.heightIn(min = if (large) 44.dp else 32.dp).clip(RoundedCornerShape(4.8.dp))
            .then(if (primary) Modifier.background(Sm.Ink.copy(alpha = fade)) else Modifier)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = if (large) 16.dp else 12.dp),
        Alignment.Center,
    ) {
        val color = when {
            primary -> Sm.OnInk
            danger -> DangerText
            else -> Sm.Text
        }
        val shown = if (primary) color else color.copy(alpha = color.alpha * fade)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text,
                color = shown,
                fontSize = if (large) 15.sp else 12.8.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
            if (trailingIcon != null) LucideIcon(trailingIcon, 15.dp, shown)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 对话框（.notes-dialog）：宽 min(100% − 48, 400)、内边距 24、圆角 8、白底、--notion-shadow；遮罩 rgba(15,15,15,.2)。
// 标题 16/600；说明 14 灰、上距 8；错误 14 红、上距 8；按钮行上距 20、间距 8、靠右。

@Composable
fun NotesDialog(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        LaunchedEffect(window, Sm.isDark) { window?.setDimAmount(dialogDim()) }
        Box(
            // 高度上限同浏览器 <dialog> 的默认 max-height（视口减 2em + 6px）。
            Modifier.padding(horizontal = 24.dp).widthIn(max = 400.dp).fillMaxWidth()
                .heightIn(max = (LocalConfiguration.current.screenHeightDp - 38).coerceAtLeast(200).dp)
                .shadow(14.dp, RoundedCornerShape(8.dp), ambientColor = PanelShadow, spotColor = PanelShadow)
                .border(1.dp, PanelRing, RoundedCornerShape(8.dp))
                .clip(RoundedCornerShape(8.dp)).background(Sm.Surface).padding(24.dp),
        ) {
            // 网页的 <dialog> 高度不超过视口，内容多（项目多）时整个对话框滚动。这里同样：对话框窗口限住高度，内容可滚动。
            Column(Modifier.verticalScroll(rememberScrollState())) { content() }
        }
    }
}

@Composable
private fun DialogTitle(text: String) = Text(text, color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)

@Composable
private fun DialogError(error: NotesError?) {
    if (error != null) Text(notesErrorText(error), color = DangerText, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 8.dp))
}

// .notes-dialog-input：上距 12、1px 深描边、圆角 6、内边距 8.8×11.2、16 字；聚焦时 2px 蓝框。
@Composable
private fun DialogInput(value: String, onChange: (String) -> Unit, placeholder: String, onDone: () -> Unit, autoFocus: Boolean = true, maxLength: Int = 60) {
    var focused by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    // 页面筛选框不自动聚焦（网页的输入框没有 autoFocus），名字输入框照旧。
    LaunchedEffect(Unit) { if (autoFocus) focus.requestFocus() }
    BasicTextField(
        value = value,
        onValueChange = { onChange(it.take(maxLength)) },
        singleLine = true,
        textStyle = TextStyle(color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp),
        cursorBrush = SolidColor(Sm.Text),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier = Modifier.padding(top = 12.dp).fillMaxWidth().focusRequester(focus).onFocusChanged { focused = it.isFocused }
            .semantics { contentDescription = placeholder },
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxWidth().border(if (focused) 2.dp else 1.dp, if (focused) Sm.Blue else Sm.BorderStrong, RoundedCornerShape(6.dp))
                    .padding(horizontal = 11.2.dp, vertical = 8.8.dp),
            ) {
                if (value.isEmpty()) Text(placeholder, color = Faint, fontSize = 16.sp, lineHeight = 24.sp)
                inner()
            }
        },
    )
}

@Composable
private fun DialogButtons(content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) { content() }
}

/** 新建 / 重命名项目（网页 GroupNameDialog）。[onSubmit] 成功返回 true 时关闭。 */
@Composable
fun GroupNameDialog(
    title: String,
    initial: String,
    submitLabel: String,
    error: NotesError?,
    onSubmit: suspend (String) -> Boolean,
    onClose: () -> Unit,
) {
    var name by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun submit() {
        if (busy || name.isBlank()) return
        busy = true
        tried = true
        scope.launch {
            val ok = onSubmit(name)
            busy = false
            if (ok) onClose()
        }
    }
    NotesDialog(onClose) {
        DialogTitle(title)
        DialogInput(name, { name = it }, stringResource(R.string.project_name), ::submit)
        if (tried) DialogError(error)
        DialogButtons {
            NotionButton(stringResource(R.string.cancel), onClick = onClose)
            NotionButton(submitLabel, onClick = ::submit, enabled = !busy && name.isNotBlank(), primary = true)
        }
    }
}

/** 确认框（网页 ConfirmDialog 和"移到回收站？"）：取消 + 红字确认。 */
@Composable
fun ConfirmDialog(
    title: String,
    body: String,
    confirmLabel: String,
    error: NotesError?,
    onConfirm: suspend () -> Boolean,
    onClose: () -> Unit,
) {
    var busy by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    NotesDialog(onClose) {
        DialogTitle(title)
        Text(body, color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 8.dp))
        if (tried) DialogError(error)
        DialogButtons {
            NotionButton(stringResource(R.string.cancel), onClick = onClose)
            NotionButton(confirmLabel, enabled = !busy, danger = true, onClick = {
                busy = true
                tried = true
                scope.launch {
                    val ok = onConfirm()
                    busy = false
                    if (ok) onClose()
                }
            })
        }
    }
}

/**
 * 选择 Markdown 文件导入到哪里（网页 ImportTargetDialog）：只在至少有一个项目时出现。"No project" 在最前，后面是各个项目；
 * 点一项就开始导入，"Cancel" 关掉不导入。样子和 [MoveNoteDialog] 的项目列表一样，没有打勾的当前项。
 */
@Composable
fun ImportTargetDialog(groups: List<NoteGroupSummary>, onChoose: (String?) -> Unit, onClose: () -> Unit) {
    NotesDialog(onClose) {
        DialogTitle(stringResource(R.string.import_to))
        // .notes-import-targets：最高 50dvh，项目多时列表自己滚动。
        Column(
            Modifier.padding(top = 12.dp).heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.5f).dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            val options = listOf<Pair<String?, String>>(null to stringResource(R.string.no_project)) + groups.map { it.id to it.name }
            options.forEach { (id, label) -> key(id) { DialogOption(label, checked = false, enabled = true, role = Role.Button) { onChoose(id) } } }
        }
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.End) {
            NotionButton(stringResource(R.string.cancel), onClick = onClose)
        }
    }
}

/** 选择移到哪个项目（网页 MoveNoteDialog）：未分组、已有项目，或当场新建一个再移进去。 */
@Composable
fun MoveNoteDialog(
    page: NotePageSummary,
    groups: List<NoteGroupSummary>,
    error: NotesError?,
    onMove: suspend (String, String?) -> Boolean,
    onCreateGroup: suspend (String) -> NoteGroupSummary?,
    onClose: () -> Unit,
    /** 页面树（网页 Move to 的 Pages）：移到另一页面之下。自己和自己的子孙不列出。 */
    state: NotesUiState? = null,
    onMoveToPage: (suspend (String, String) -> Boolean)? = null,
) {
    var creating by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var tried by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun move(groupId: String?) {
        busy = true
        tried = true
        scope.launch {
            val ok = onMove(page.id, groupId)
            busy = false
            if (ok) onClose()
        }
    }
    fun createAndMove() {
        if (busy || name.isBlank()) return
        busy = true
        tried = true
        scope.launch {
            val group = onCreateGroup(name)
            busy = false
            if (group != null) move(group.id)
        }
    }
    NotesDialog(onClose) {
        DialogTitle(stringResource(R.string.move_note_to, page.title))
        Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            val options = listOf<Pair<String?, String>>(null to stringResource(R.string.no_project)) + groups.map { it.id to it.name }
            // 子页面不在任何项目的最上层，所以项目都不打勾（网页 !page.parentId）。
            options.forEach { (id, label) -> DialogOption(label, checked = page.parentId == null && page.groupId == id, enabled = !busy) { move(id) } }
        }
        if (creating) {
            DialogInput(name, { name = it }, stringResource(R.string.new_project_name), ::createAndMove)
            NotionButton(stringResource(R.string.create_and_move), onClick = ::createAndMove, enabled = !busy && name.isNotBlank(),
                primary = true, modifier = Modifier.padding(top = 8.dp))
        } else {
            Row(
                Modifier.padding(top = 4.dp).fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(6.dp))
                    .clickable(enabled = !busy) { creating = true }.padding(horizontal = 9.6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LucideIcon(Lucide.FolderPlus, 16.dp, Sm.Text)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.new_project_ellipsis), color = Sm.Text, fontSize = 15.sp)
            }
        }
        if (state != null && onMoveToPage != null) {
            // 按树的顺序（父页面后紧跟子页面）；筛选时只平铺列出匹配的页面。
            val blocked = state.descendants(page.id) + page.id
            val targets = ArrayList<Pair<NotePageSummary, Int>>()
            fun walk(list: List<NotePageSummary>, depth: Int) {
                for (entry in list) {
                    if (entry.id in blocked) continue
                    targets += entry to depth
                    walk(state.children(entry.id), depth + 1)
                }
            }
            walk(state.roots, 0)
            if (targets.isNotEmpty()) {
                // .notes-dialog-subtitle：上 16、13/600 灰。
                Text(stringResource(R.string.pg_pages), color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.5.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 16.dp))
                DialogInput(filter, { filter = it }, stringResource(R.string.pg_search_pages), {}, autoFocus = false, maxLength = 200)
                val query = filter.trim().lowercase()
                val shown = if (query.isEmpty()) targets else targets.filter { it.first.title.lowercase().contains(query) }.map { it.first to 0 }
                // .notes-move-pages：最高 40dvh（412×915 上约 366）。
                Column(Modifier.padding(top = 8.dp).heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.4f).dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    shown.forEach { (target, depth) ->
                        key(target.id) {
                            val checked = page.parentId == target.id
                            Row(
                                Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(6.dp))
                                    .background(if (checked) Sm.Hover else Color.Transparent)
                                    .clickable(enabled = !busy) {
                                        busy = true
                                        tried = true
                                        scope.launch {
                                            val ok = onMoveToPage(page.id, target.id)
                                            busy = false
                                            if (ok) onClose()
                                        }
                                    }
                                    .padding(start = (12 + depth * 16).dp, end = 9.6.dp)
                                    .semantics { role = Role.RadioButton },
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(Modifier.width(20.dp), Alignment.Center) { NoteIcon(target.icon, 15.sp, 15.dp, Sm.Muted) }
                                Spacer(Modifier.width(8.dp))
                                Text(target.title, modifier = Modifier.weight(1f), color = Sm.Text, fontSize = 15.sp,
                                    fontWeight = if (checked) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                if (checked) LucideIcon(Lucide.Check, 16.dp, Sm.Text)
                            }
                        }
                    }
                    if (shown.isEmpty()) Text(stringResource(R.string.pg_no_matching_pages), color = Sm.Muted, fontSize = 14.sp,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                }
            }
        }
        if (tried) DialogError(error)
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.End) {
            NotionButton(stringResource(R.string.close), onClick = onClose)
        }
    }
}

// .notes-dialog-option：最小高 40、圆角 6、左右 9.6、15 字；当前所在项目灰底、600、右边 ✓ 16。
@Composable
private fun DialogOption(label: String, checked: Boolean, enabled: Boolean, role: Role = Role.RadioButton, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(6.dp))
            .background(if (checked) Sm.Hover else Color.Transparent)
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 9.6.dp)
            .semantics { this.role = role },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.weight(1f), color = Sm.Text, fontSize = 15.sp,
            fontWeight = if (checked) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (checked) LucideIcon(Lucide.Check, 16.dp, Sm.Text)
    }
}

// ---------------------------------------------------------------------------------------------
// 回收站（网页 NoteTrashDialog，手机是从下方出来的全宽面板）：顶部圆角 16；
// 头部内边距 12/12/12/16、下边 1px 线：垃圾桶 16 灰 + "回收站"16/600，"清空回收站"红字按钮，40 的关闭键（✕ 16）；
// 说明 13/18.85 灰（上 9.6、左右 16）；列表外边距 8；每行内边距 6.4×8、圆角 6：图标 24（表情 17）、
// 标题 15/500、时间 12 灰；按钮（高 44、15/500）在下一行靠右。

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun TrashSheet(
    trash: TrashUiState,
    onClose: () -> Unit,
    onRetry: () -> Unit,
    onConfirmAll: (Boolean) -> Unit,
    onEmpty: () -> Unit,
    onRestore: (String) -> Unit,
    onConfirmOne: (String?) -> Unit,
    onDeleteForever: (String) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = sheetState,
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        containerColor = Sm.Surface,
        scrimColor = Sm.scrim(Color(0x330F0F0F)),
        dragHandle = null,
        tonalElevation = 0.dp,
    ) {
        val items = trash.items
        Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
            Row(
                Modifier.fillMaxWidth().drawBehind { drawRect(Sm.Border, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = Size(size.width, 1.dp.toPx())) }
                    .padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LucideIcon(Lucide.Trash2, 16.dp, Sm.Muted)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.trash), modifier = Modifier.weight(1f), color = Sm.Text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                NotionButton(stringResource(R.string.empty_trash), onClick = { onConfirmAll(true) }, danger = true, large = true,
                    enabled = !trash.busy && !items.isNullOrEmpty())
                Spacer(Modifier.width(8.dp))
                IconSquare(Lucide.X, 16.dp, 40.dp, stringResource(R.string.close_trash), Sm.Muted, onClick = onClose)
            }
            Text(
                stringResource(R.string.trash_hint, TRASH_RETENTION_DAYS),
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 9.6.dp),
                color = Sm.Muted, fontSize = 13.sp, lineHeight = 18.85.sp,
            )
            if (trash.confirmAll) {
                // .note-th-confirm：外边距 9.6/16/0、内边距 9.6×12、1px 浅红框、圆角 6、13 字。
                FlowRow(
                    Modifier.padding(start = 16.dp, end = 16.dp, top = 9.6.dp).fillMaxWidth()
                        .border(1.dp, Color(0x40B91C1C), RoundedCornerShape(6.dp)).padding(horizontal = 12.dp, vertical = 9.6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val count = items?.size ?: 0
                    Text(
                        if (count == 1) stringResource(R.string.empty_trash_one) else stringResource(R.string.empty_trash_all, count),
                        color = Sm.Text, fontSize = 13.sp, lineHeight = 18.2.sp, modifier = Modifier.widthIn(min = 192.dp).align(Alignment.CenterVertically),
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.6.dp, Alignment.End)) {
                        NotionButton(stringResource(R.string.cancel), onClick = { onConfirmAll(false) }, enabled = !trash.busy, large = true)
                        NotionButton(stringResource(R.string.empty_trash), onClick = onEmpty, enabled = !trash.busy, danger = true, large = true)
                    }
                }
            }
            trash.error?.let {
                Text(notesErrorText(it), color = DangerText, fontSize = 13.sp, lineHeight = 18.2.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp))
            }
            Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(8.dp)) {
                when {
                    trash.loadError != null -> Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        TrashStatus(notesErrorText(trash.loadError))
                        NotionButton(stringResource(R.string.try_again), onClick = onRetry, modifier = Modifier.padding(top = 8.dp), large = true)
                    }
                    items == null -> Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 24.dp), Alignment.Center) {
                        TrashStatus(stringResource(R.string.loading_trash))
                    }
                    items.isEmpty() -> Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 24.dp), Alignment.Center) {
                        TrashStatus(stringResource(R.string.trash_is_empty))
                    }
                    else -> items.forEach { item ->
                        TrashRow(item, confirming = trash.confirmId == item.id, busy = trash.busy, onRestore, onConfirmOne, onDeleteForever)
                    }
                }
            }
        }
    }
}

@Composable
private fun TrashStatus(text: String) = Text(text, color = Sm.Muted, fontSize = 14.sp, lineHeight = 21.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)

@Composable
private fun TrashRow(
    item: NoteTrashItem,
    confirming: Boolean,
    busy: Boolean,
    onRestore: (String) -> Unit,
    onConfirmOne: (String?) -> Unit,
    onDeleteForever: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 6.4.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 39.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(24.dp), Alignment.Center) { NoteIcon(item.icon, 17.sp, 16.dp, Sm.Muted) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.6.dp)) {
                Text(item.title, color = Sm.Text, fontSize = 15.sp, lineHeight = 22.5.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(trashTimeLabel(item), color = Sm.Muted, fontSize = 12.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Row(Modifier.padding(top = 6.4.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.6.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            if (confirming) {
                Text(stringResource(R.string.delete_forever_q), color = DangerText, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                NotionButton(stringResource(R.string.cancel), onClick = { onConfirmOne(null) }, enabled = !busy, large = true)
                NotionButton(stringResource(R.string.delete_forever), onClick = { onDeleteForever(item.id) }, enabled = !busy, danger = true, large = true)
            } else {
                NotionButton(stringResource(R.string.restore), onClick = { onRestore(item.id) }, enabled = !busy, large = true)
                NotionButton(stringResource(R.string.delete_forever), onClick = { onConfirmOne(item.id) }, enabled = !busy, danger = true, large = true)
            }
        }
    }
}

private const val DAY_MS = 24L * 60 * 60 * 1000

/** "Deleted 3 days ago · 27 days left"（网页 trashTimeLabel）：经过天数向下取整，剩余天数向上取整。 */
@Composable
private fun trashTimeLabel(item: NoteTrashItem): String {
    val now = System.currentTimeMillis()
    val deletedAt = runCatching { Instant.parse(item.deletedAt).toEpochMilli() }.getOrDefault(now)
    val purgeAt = runCatching { Instant.parse(item.purgeAt).toEpochMilli() }.getOrDefault(now)
    val ago = maxOf(0L, (now - deletedAt) / DAY_MS).toInt()
    val leftMs = purgeAt - now
    val left = Math.ceil(leftMs.toDouble() / DAY_MS).toInt()
    val deleted = when (ago) {
        0 -> stringResource(R.string.deleted_today)
        1 -> stringResource(R.string.deleted_one_day)
        else -> stringResource(R.string.deleted_days, ago)
    }
    val remaining = when {
        left <= 0 -> stringResource(R.string.removing_soon)
        left == 1 -> stringResource(R.string.one_day_left)
        else -> stringResource(R.string.days_left, left)
    }
    return "$deleted · $remaining"
}
