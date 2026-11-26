package com.kakumine.notefable.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
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
import androidx.compose.ui.semantics.selected
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
import androidx.compose.ui.unit.IntRect
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
import com.kakumine.notefable.data.PageKind
import com.kakumine.notefable.data.TRASH_RETENTION_DAYS
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

// 网页笔记界面（notes-sidebar / notes-home / note-group-dialogs / note-trash-dialog）的复刻。
// 数值来自网页在 412x915 手机视口下的实测，对照表见 docs/architecture/android-native.md。

private val Faint: Color get() = Sm.Faint
private val DangerText: Color get() = Sm.Danger          // .notes-delete
private val PanelShadow = Color(0x1F0F0F0F)          // --notion-shadow 0 4px 14px rgba(15,15,15,.12)
private val PanelRing: Color get() = Sm.Ring            // --notion-shadow 0 0 0 1px rgba(15,15,15,.05)

// ---------------------------------------------------------------------------------------------
// 页面类型的语义色（与网页 globals.css 的 --kind-* 变量同步）：笔记=蓝、幻灯片=琥珀、白板=紫。

internal fun pageKindColor(kind: PageKind): Color = when (kind) {
    PageKind.Note -> Sm.KindNote
    PageKind.Slides -> Sm.KindSlides
    PageKind.Whiteboard -> Sm.KindWhiteboard
}

internal fun pageKindTextColor(kind: PageKind): Color = when (kind) {
    PageKind.Note -> Sm.KindNote
    PageKind.Slides -> Sm.KindSlidesText
    PageKind.Whiteboard -> Sm.KindWhiteboard
}

internal fun pageKindSoft(kind: PageKind): Color = when (kind) {
    PageKind.Note -> Sm.KindNoteSoft
    PageKind.Slides -> Sm.KindSlidesSoft
    PageKind.Whiteboard -> Sm.KindWhiteboardSoft
}

internal fun pageKindBorder(kind: PageKind): Color = when (kind) {
    PageKind.Note -> Sm.KindNoteBorder
    PageKind.Slides -> Sm.KindSlidesBorder
    PageKind.Whiteboard -> Sm.KindWhiteboardBorder
}

// ---------------------------------------------------------------------------------------------
// Chat / Workspace 切换（.notion-segmented）：高 48、微沉轨道（Sm.Hover + 1dp 细框）、圆角 10、内边距 3、两键间距 2；
// 每键高 40、圆角 7.2、15/550（抽屉里 13.5/550）、图标 16 + 间距 6、左右内距 5；
// 选中白底（深色 Sm.Surface）、墨色字、蓝色图标、1px 细环 + 浅阴影。两键平时各占一半，名字比一半宽时那一侧按名字宽度变宽。

@Composable
fun WorkspaceSwitch(workspace: Workspace, onChange: (Workspace) -> Unit, modifier: Modifier = Modifier, inDrawer: Boolean = false) {
    val label = stringResource(R.string.workspace_mode)
    val fontSize = if (inDrawer) 13.5.sp else 15.sp
    val trackShape = RoundedCornerShape(10.dp)
    val trackBg = Sm.pick(Color(0x111C202A), Color(0x0FFFFFFF))
    Layout(
        content = {
            Segment(stringResource(R.string.chat_mode), Lucide.MessageSquareText, workspace == Workspace.Chat, fontSize) { onChange(Workspace.Chat) }
            Segment(stringResource(R.string.note_mode), Lucide.LayoutGrid, workspace == Workspace.Notes, fontSize) { onChange(Workspace.Notes) }
        },
        modifier = modifier.fillMaxWidth().height(46.dp).clip(trackShape).background(trackBg).border(1.dp, Sm.Border, trackShape).padding(3.dp)
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
    val shape = RoundedCornerShape(7.2.dp)
    val segShadow = Sm.pick(Color(0x170F172A), Color(0x59000000))
    Row(
        Modifier.height(40.dp)
            .then(if (active) Modifier.shadow(1.5.dp, shape, ambientColor = segShadow, spotColor = segShadow) else Modifier)
            .clip(shape)
            .then(if (active) Modifier.background(Sm.Surface).border(1.dp, Sm.Border, shape) else Modifier)
            .clickable(onClick = onClick)
            .semantics { role = Role.Button }
            .padding(horizontal = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        LucideIcon(icon, 15.dp, if (active) Sm.Blue else Sm.TabMuted)
        Spacer(Modifier.width(6.dp))
        Text(
            text, color = if (active) Sm.Ink else Sm.TabMuted, fontSize = fontSize,
            fontWeight = if (active) FontWeight(620) else FontWeight(560),
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

// ---------------------------------------------------------------------------------------------
// 工作区的分区与新建（网页 notes-sidebar / notes-home / new-page-button，#168）。能新建的类型（[NotesUiState.kinds]）只有笔记时，
// 新建按钮和"+"和以前一样一点就建笔记；两种以上时点了开类型菜单（笔记 / 幻灯片 / 白板，与聊天的"…"菜单同一外框 [ActionsMenu]）。

/** 分区的投放区的键（[DragState.zoneContainers] 里登记为无项目，[DragState.zoneAccepts] 只接受同一分区的页面）。 */
private fun sectionZone(kind: PageKind) = "section:" + kind.wire

/** 分区的名字（网页 PAGE_KIND_SECTION_LABELS）。 */
@StringRes
private fun sectionLabel(kind: PageKind): Int = when (kind) {
    PageKind.Note -> R.string.notes
    PageKind.Slides -> R.string.page_kind_slides
    PageKind.Whiteboard -> R.string.ws_section_whiteboards
}

/** 一次建这个类型的按钮（网页 PAGE_KIND_NEW_LABELS）：分区的"+"、首页和空状态的新建按钮。 */
@StringRes
private fun newPageLabel(kind: PageKind): Int = when (kind) {
    PageKind.Note -> R.string.new_note
    PageKind.Slides -> R.string.ws_new_slides
    PageKind.Whiteboard -> R.string.ws_new_whiteboard
}

/**
 * 新建按钮外面的一层（网页 NewPageButton）：[kinds] 只有一种时 [content] 的点击直接建它，两种以上时在按钮下方开类型菜单。
 * 能建幻灯片、给了 [onGenerate] 时菜单末尾还有「用 AI 生成」（只有幻灯片一种时也开菜单，项目名是「新建幻灯片」）。
 * [label] 是菜单的读屏名字。
 */
@Composable
private fun NewPageMenuAnchor(
    kinds: List<PageKind>, label: String, onCreate: (PageKind) -> Unit, modifier: Modifier = Modifier,
    onGenerate: (() -> Unit)? = null,
    content: @Composable (onClick: () -> Unit) -> Unit,
) {
    val generate = onGenerate?.takeIf { PageKind.Slides in kinds }
    var anchor by remember { mutableStateOf<IntRect?>(null) }
    var open by remember { mutableStateOf(false) }
    Box(modifier.onGloballyPositioned { coords ->
        val b = coords.boundsInWindow()
        anchor = IntRect(b.left.roundToInt(), b.top.roundToInt(), b.right.roundToInt(), b.bottom.roundToInt())
    }) {
        content { if (kinds.size > 1 || generate != null) open = true else onCreate(kinds.firstOrNull() ?: PageKind.Note) }
    }
    val at = anchor
    if (open && at != null) {
        val close = { open = false }
        ActionsMenu(at, label, close) {
            kinds.forEach { kind ->
                val name = if (kinds.size > 1) pageKindLabel(kind) else newPageLabel(kind)
                MenuItem(stringResource(name), pageKindIcon(kind)) { close(); onCreate(kind) }
            }
            if (generate != null) {
                Box(Modifier.padding(horizontal = 8.dp, vertical = 4.8.dp).fillMaxWidth().height(1.dp).background(Sm.Border))
                MenuItem(stringResource(R.string.slides_generate_with_ai), Lucide.Presentation, leading = { AppIcon(16.dp) }) { close(); generate() }
            }
        }
    }
}

@Composable
fun NotesDrawerBody(
    state: NotesUiState,
    /** 新建 [kind] 的页面：[groupId] 是项目的"+"（null 是那个类型的分区）。 */
    onCreate: (kind: PageKind, groupId: String?) -> Unit,
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
    /** 子页面的树：展开 / 收起、在这一篇里新建（网页 notes-sidebar 的箭头和"+"，能建几种类型时先选类型）。 */
    onToggleExpanded: (String) -> Unit = {},
    onCreateInside: (NotePageSummary, PageKind) -> Unit = { _, _ -> },
    /** 折叠 / 展开分区（笔记 / 幻灯片 / 白板）。 */
    onToggleSection: (PageKind) -> Unit = {},
    /** Favorites 行右侧的"从收藏中移除"。 */
    onUnfavorite: (NotePageSummary) -> Unit = {},
    /** 侧栏 / 收藏行改页面标题。 */
    onRenamePage: (NotePageSummary) -> Unit = {},
    /** 侧栏 "..." 菜单里的收藏 / 取消收藏。 */
    onToggleFavorite: (NotePageSummary) -> Unit = {},
    /** 回收站上面的 "Import Markdown"（网页 notes-sidebar：打开文件选择器）。 */
    onImport: () -> Unit = {},
    /** 新建处的「用 AI 生成」（幻灯片向导）：项目的"+"带 groupId，页面行的"+"带 parentId；null 是没有这个入口。 */
    onGenerateSlides: ((groupId: String?, parentId: String?) -> Unit)? = null,
) {
    val busy = state.busy || state.loading
    val scroll = rememberScrollState()
    val drag = remember(scroll) { DragState(scroll) }
    val rowDrag = NoteRowDrag(drag, state, busy, reorder, NoteListSurface.Drawer)
    val tree = NoteTreeActions(state, onOpen, onMove, onTrash, onChangeIcon, onToggleExpanded, onCreateInside, onRenamePage, onToggleFavorite, onGenerateSlides)
    val kinds = state.kinds
    val sections = state.sections
    // 分区里最上层的行只接受同一分区的页面放在前后（网页 data-drop-kind）；别处的行什么都接受。
    SideEffect {
        drag.rowAccepts.clear()
        sections.forEach { section -> section.roots.forEach { drag.rowAccepts[it.id] = section.kind.wire } }
    }
    Column(modifier) {
        // 顶部固定操作区（.sidebar-top-actions）：新建 + 搜索，下方 1dp 细线分隔可滚动列表。
        Column(
            Modifier.fillMaxWidth()
                .drawBehind { drawRect(Sm.Border, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = Size(size.width, 1.dp.toPx())) }
                .padding(bottom = 10.dp),
        ) {
            // "新建"（.sidebar-primary-action，手机）：上距 10、高 42、圆角 9、墨色底，左对齐图标 16 + 间距 8 + 15/560 字；多种类型时右侧下拉箭头。
            NewPageMenuAnchor(kinds, stringResource(R.string.ws_new_page), { kind -> onCreate(kind, null) },
                Modifier.padding(start = 10.dp, end = 10.dp, top = 10.dp, bottom = 6.dp).fillMaxWidth(),
                onGenerate = onGenerateSlides?.let { { it(null, null) } }) { open ->
                Row(
                    Modifier.fillMaxWidth().height(42.dp)
                        .shadow(1.dp, RoundedCornerShape(9.dp), ambientColor = Color(0x1F0F172A), spotColor = Color(0x1F0F172A))
                        .clip(RoundedCornerShape(9.dp)).background(if (busy) Sm.Ink.copy(alpha = 0.6f) else Sm.Ink)
                        .clickable(enabled = !busy, onClick = open)
                        .padding(horizontal = 11.2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    LucideIcon(Lucide.Plus, 16.dp, Sm.OnInk)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(if (kinds.size > 1) R.string.ws_new else R.string.new_note), color = Sm.OnInk, fontSize = 15.sp, fontWeight = FontWeight(560), modifier = Modifier.weight(1f))
                    if (kinds.size > 1) LucideIcon(Lucide.ChevronDown, 14.dp, Sm.OnInk.copy(alpha = 0.65f))
                }
            }
            // Search 行（Batch 4）：网页侧栏里在"新建"按钮正下方。
            SidebarSearchRow(onSearch)
        }

        Column(
            Modifier.weight(1f).fillMaxWidth()
                .onGloballyPositioned { drag.listBounds = it.boundsInWindow() }
                .verticalScroll(scroll).padding(start = 10.dp, end = 10.dp, bottom = 16.dp),
        ) {
            // Favorites（高对比标题 + 琥珀星标徽章 + 数量胶囊）：收藏的页面，平铺、不能拖，右侧"从收藏中移除"。
            val favorites = state.favorites
            if (favorites.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, top = 12.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    SidebarSectionBadge(Lucide.Star, Sm.KindFavSoft, Sm.KindFav)
                    Spacer(Modifier.width(7.dp))
                    Text(stringResource(R.string.pg_favorites), color = Sm.SectionTitle, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight(650), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    Spacer(Modifier.width(6.dp))
                    CountPill(favorites.size)
                }
                favorites.forEach { page -> key("fav-" + page.id) { FavoriteRow(page, state.open?.id == page.id, busy, onOpen, onUnfavorite, onRenamePage) } }
            }
            // "Projects" 分区标题（徽章 + 高对比标题 + 数量胶囊 + 右侧 40 的"新项目"按钮）。
            Column(Modifier.fillMaxWidth().sidebarSectionTopDivider(favorites.isNotEmpty())) {
                Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 2.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                        SidebarSectionBadge(Lucide.Folder, Sm.CountBg, Sm.SectionTitle)
                        Spacer(Modifier.width(7.dp))
                        Text(stringResource(R.string.projects), color = Sm.SectionTitle, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight(650), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        if (state.groups.isNotEmpty()) {
                            Spacer(Modifier.width(6.dp))
                            CountPill(state.groups.size)
                        }
                    }
                    IconSquare(Lucide.Plus, 15.dp, 40.dp, stringResource(R.string.new_project), Sm.TabMuted, onClick = onNewGroup)
                }
            }
            state.groups.forEach { group ->
                val members = state.members(group.id)
                val open = group.id !in state.collapsed
                // 项目行同时是"移进这个项目"的投放区（网页 data-note-group-drop={group.id}）。
                DisposableEffect(group.id) { onDispose { drag.zones.remove(group.id) } }
                GroupRow(
                    group, state.memberCount(group.id), open, onToggle = { onToggleGroup(group.id) }, onRename = { onRenameGroup(group) }, onDelete = { onDeleteGroup(group) },
                    modifier = Modifier.dropZone(drag.target == DropTarget.Into(group.id)).onGloballyPositioned { drag.zones[group.id] = it.boundsInWindow() },
                    kinds = kinds, busy = busy, onCreate = { kind -> onCreate(kind, group.id) },
                    onGenerate = onGenerateSlides?.let { { it(group.id, null) } },
                )
                if (open) {
                    // .notes-group-members：左距 10、1px 竖线、内左距 4。
                    Column(
                        Modifier.padding(start = 10.dp).fillMaxWidth()
                            .drawBehind {
                                val lineW = 1.dp.toPx()
                                val lineX = if (layoutDirection == LayoutDirection.Rtl) size.width - lineW else 0f
                                drawRect(Sm.Border, topLeft = Offset(lineX, 0f), size = Size(lineW, size.height))
                            }
                            .padding(start = 4.dp),
                    ) {
                        if (members.isEmpty()) {
                            Text(stringResource(R.string.no_notes_in_project), color = Faint, fontSize = 12.sp, lineHeight = 16.sp,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp))
                        }
                        members.forEach { page -> key(page.id) { NoteTree(page, busy, rowDrag, tree) } }
                    }
                }
            }
            // 网页：改图标失败的提示在 Notes 标签上方，px-2、12 红字。
            if (state.iconError) {
                Text(stringResource(R.string.em_note_icon_failed), color = Sm.Danger, fontSize = 12.sp, lineHeight = 16.sp,
                    modifier = Modifier.padding(horizontal = 8.dp).semantics { liveRegion = androidx.compose.ui.semantics.LiveRegionMode.Assertive })
            }
            // 分区（网页 notes-sidebar 的分区）：不在项目里的最上层页面按类型分开。语义色点 + 分区名 + 数量 + 折叠箭头 + "+"。
            sections.forEach { section ->
                val zone = sectionZone(section.kind)
                val open = section.kind !in state.collapsedSections
                key(zone) {
                    DisposableEffect(zone) {
                        drag.zoneContainers[zone] = null
                        drag.zoneAccepts[zone] = section.kind.wire
                        onDispose { drag.zones.remove(zone); drag.zoneContainers.remove(zone); drag.zoneAccepts.remove(zone) }
                    }
                    SectionHeading(
                        section.kind, section.count, open, busy, onToggle = { onToggleSection(section.kind) }, onCreate = { onCreate(section.kind, null) },
                        modifier = Modifier.dropZone(drag.targetZone == zone).onGloballyPositioned { drag.zones[zone] = it.boundsInWindow() },
                        onGenerate = onGenerateSlides?.takeIf { section.kind == PageKind.Slides }?.let { { it(null, null) } },
                    )
                }
                if (open) {
                    section.roots.forEach { page -> key(page.id) { NoteTree(page, busy, rowDrag, tree) } }
                    if (section.kind == PageKind.Note && state.pages.isEmpty() && state.loaded) {
                        Text(stringResource(R.string.notes_list_empty), color = Sm.Muted, fontSize = 12.sp, lineHeight = 20.sp,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp))
                    }
                }
            }
        }

        // 工具区（.sidebar-utility-footer）：上方 1dp 细线，静谧灰字（Import Markdown / Trash）。
        Column(
            Modifier.fillMaxWidth()
                .drawBehind { drawRect(Sm.Border, size = Size(size.width, 1.dp.toPx())) }
                .padding(vertical = 4.dp),
        ) {
            SidebarAction(Lucide.Upload, stringResource(R.string.import_markdown), enabled = !busy, onClick = onImport)
            SidebarAction(Lucide.Trash2, stringResource(R.string.trash), onClick = onOpenTrash)
        }
    }
}

@Composable
private fun SidebarAction(icon: List<String>, text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Row(
        modifier.padding(horizontal = 10.dp).fillMaxWidth().height(40.dp).clip(RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LucideIcon(icon, 15.dp, Sm.TabMuted)
        Spacer(Modifier.width(8.8.dp))
        Text(text, color = Sm.TabMuted, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// 项目行（.notion-session-row + .chat-project-toggle）：高 42；展开箭头 14、文件夹 15、名称 14/500、胶囊数量；
// 右侧新建、重命名、删除三个小按钮。
@Composable
private fun GroupRow(
    group: NoteGroupSummary, count: Int, open: Boolean, onToggle: () -> Unit, onRename: () -> Unit, onDelete: () -> Unit,
    modifier: Modifier = Modifier,
    /** 项目的"+"（网页项目行的 NewPageButton）：在这个项目的最上层新建，能建几种类型时先选类型。 */
    kinds: List<PageKind> = listOf(PageKind.Note), busy: Boolean = false, onCreate: (PageKind) -> Unit = {},
    onGenerate: (() -> Unit)? = null,
) {
    Row(modifier.fillMaxWidth().heightIn(min = 42.dp).clip(RoundedCornerShape(8.dp)), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.weight(1f).clickable(onClick = onToggle).padding(horizontal = 4.dp, vertical = 6.dp)
                .semantics { role = Role.Button },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            LucideIcon(if (open) Lucide.ChevronDown else Lucide.ChevronRight, 13.5.dp, Sm.Faint)
            LucideIcon(Lucide.Folder, 14.5.dp, Sm.Text)
            Text(group.name, color = Sm.Text, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            CountPill(count)
        }
        val newLabel = stringResource(R.string.ws_new_page_in, group.name)
        NewPageMenuAnchor(kinds, newLabel, onCreate, onGenerate = onGenerate) { open -> RowAction(Lucide.Plus, 14.dp, newLabel, enabled = !busy, onClick = open) }
        RowAction(Lucide.Pencil, 13.dp, stringResource(R.string.rename_name, group.name), onRename)
        RowAction(Lucide.Trash2, 14.dp, stringResource(R.string.delete_project_name, group.name), onDelete)
    }
}

/** 侧栏分区标题左侧的 20×20 圆角语义图标徽章（网页 .sidebar-section-badge）。 */
@Composable
internal fun SidebarSectionBadge(icon: List<String>, background: Color, iconTint: Color, border: Color? = null) {
    val shape = RoundedCornerShape(6.dp)
    Box(
        Modifier.size(20.dp).clip(shape).background(background)
            .then(if (border != null) Modifier.border(1.dp, border, shape) else Modifier),
        Alignment.Center,
    ) {
        LucideIcon(icon, 12.dp, iconTint)
    }
}

/** 侧栏分区之间的顶部分隔线（网页 .sidebar-group + .sidebar-group）。第一个分区传 false 只留上边距。 */
internal fun Modifier.sidebarSectionTopDivider(show: Boolean): Modifier =
    if (!show) padding(top = 12.dp)
    else padding(top = 8.dp)
        .drawBehind { drawRect(Sm.Border, size = Size(size.width, 1.dp.toPx())) }
        .padding(top = 10.dp)

/** 侧栏选中行的卡片质感与行头 3dp 语义指示条（网页 .notion-session-row.is-active + ::before）。 */
@Composable
internal fun Modifier.sidebarActiveRow(active: Boolean, accentColor: Color, shape: RoundedCornerShape): Modifier {
    if (!active) return clip(shape)
    val rowShadow = Sm.pick(Color(0x160F172A), Color(0x59000000))
    val activeBg = Sm.ActiveRow
    val activeBorder = Sm.BorderStrong
    return shadow(1.5.dp, shape, ambientColor = rowShadow, spotColor = rowShadow)
        .clip(shape)
        .background(activeBg)
        .border(1.dp, activeBorder, shape)
        .drawWithContent {
            drawContent()
            val pillW = 3.dp.toPx()
            val pillH = 18.dp.toPx().coerceAtMost((size.height - 8.dp.toPx()).coerceAtLeast(8.dp.toPx()))
            val inset = 2.dp.toPx()
            val x = if (layoutDirection == LayoutDirection.Rtl) size.width - inset - pillW else inset
            val y = (size.height - pillH) / 2f
            drawRoundRect(accentColor, topLeft = Offset(x, y), size = Size(pillW, pillH), cornerRadius = CornerRadius(pillW / 2f))
        }
}

@Composable
internal fun CountPill(count: Int) {
    Box(
        Modifier.widthIn(min = 20.dp).heightIn(min = 18.dp).clip(CircleShape).background(Sm.CountBg).padding(horizontal = 6.dp, vertical = 1.5.dp),
        Alignment.Center,
    ) {
        Text(
            count.toString(),
            color = Sm.CountText,
            fontSize = 11.sp,
            lineHeight = 14.sp,
            fontWeight = FontWeight(620),
            style = TextStyle(fontFeatureSettings = "tnum"),
        )
    }
}

// 分区标题（网页 .notes-section-heading）：顶部分隔线 + 语义图标徽章 + 高对比标题 + 数量胶囊 + 折叠箭头 + "+"。
// "+" 一点就建这个类型；幻灯片分区给了 onGenerate 时开菜单（新建幻灯片 / 用 AI 生成）。
@Composable
private fun SectionHeading(
    kind: PageKind, count: Int, open: Boolean, busy: Boolean, onToggle: () -> Unit, onCreate: () -> Unit, modifier: Modifier = Modifier,
    onGenerate: (() -> Unit)? = null,
) {
    val name = stringResource(sectionLabel(kind))
    val toggleLabel = if (open) collapseLabel(name) else expandLabel(name)
    Column(Modifier.fillMaxWidth().sidebarSectionTopDivider(true)) {
        Row(modifier.fillMaxWidth().padding(start = 6.dp, end = 2.dp, bottom = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.weight(1f).heightIn(min = 38.dp).clip(RoundedCornerShape(7.dp)).clickable(onClick = onToggle)
                    .semantics { contentDescription = toggleLabel; role = Role.Button },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SidebarSectionBadge(pageKindIcon(kind), pageKindSoft(kind), pageKindColor(kind), border = pageKindBorder(kind))
                Spacer(Modifier.width(7.dp))
                Text(name, color = Sm.SectionTitle, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight(650), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (count > 0) {
                    Spacer(Modifier.width(6.dp))
                    CountPill(count)
                }
                Spacer(Modifier.width(5.dp))
                LucideIcon(if (open) Lucide.ChevronDown else Lucide.ChevronRight, 13.dp, Sm.Muted)
            }
            val createLabel = stringResource(newPageLabel(kind))
            NewPageMenuAnchor(listOf(kind), createLabel, { onCreate() }, onGenerate = onGenerate) { openMenu ->
                IconSquare(Lucide.Plus, 15.dp, 40.dp, createLabel, Sm.TabMuted) { if (!busy) openMenu() }
            }
        }
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
    val onCreateInside: (NotePageSummary, PageKind) -> Unit,
    val onRename: (NotePageSummary) -> Unit,
    val onToggleFavorite: (NotePageSummary) -> Unit,
    val onGenerateSlides: ((groupId: String?, parentId: String?) -> Unit)? = null,
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
        open = open, onToggle = { tree.onToggle(page.id) }, onCreateInside = { kind -> tree.onCreateInside(page, kind) },
        onRename = tree.onRename, onToggleFavorite = tree.onToggleFavorite,
        onGenerateInside = tree.onGenerateSlides?.let { { it(null, page.id) } })
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

// Favorites 的行（网页 notes-sidebar 的收藏行）：高 42；图标区 28（左距 4，语义色页面类型图标 15）；标题 14；
// 非锁定时右侧重命名按钮（Pencil 13），最右"从收藏中移除"小按钮（StarOff 14）。当前打开的行浮起圆角卡。
@Composable
private fun FavoriteRow(
    page: NotePageSummary,
    active: Boolean,
    busy: Boolean,
    onOpen: (String) -> Unit,
    onUnfavorite: (NotePageSummary) -> Unit,
    onRename: (NotePageSummary) -> Unit,
) {
    val shape = RoundedCornerShape(8.dp)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 42.dp)
            .sidebarActiveRow(active, pageKindColor(page.kind), shape)
            .clickable(enabled = !busy) { onOpen(page.id) }
            .padding(start = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.padding(start = 4.dp).size(28.dp), Alignment.Center) { NoteIcon(page.icon, 15.sp, 15.dp, pageKindColor(page.kind), page.kind) }
        Text(page.title, modifier = Modifier.weight(1f).padding(start = 4.dp, end = 8.dp), color = if (active) Sm.Ink else Sm.Text,
            fontSize = 14.sp, lineHeight = 20.sp, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (!page.locked) {
            RowAction(Lucide.Pencil, 13.dp, stringResource(R.string.rename_name, page.title), enabled = !busy) { onRename(page) }
        }
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
    onCreateInside: (PageKind) -> Unit = {},
    onRename: (NotePageSummary) -> Unit = {},
    onToggleFavorite: (NotePageSummary) -> Unit = {},
    onGenerateInside: (() -> Unit)? = null,
) {
    val drag = rowDrag.drag
    val target = drag.target as? DropTarget.Row
    val lineBefore = target?.id == page.id && !target.after
    val lineAfter = target?.id == page.id && target.after
    val reorderError = rowDrag.errorFor(page.id)
    val rowShape = RoundedCornerShape(8.dp)
    val iconTint = pageKindColor(page.kind)
    var moreBounds by remember { mutableStateOf<IntRect?>(null) }
    var menuAnchor by remember { mutableStateOf<IntRect?>(null) }
    DisposableEffect(page.id) { onDispose { drag.rows.remove(page.id) } }
    Box {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 42.dp)
                .alpha(if (drag.dragging == page.id) 0.5f else 1f)
                .onGloballyPositioned { drag.rows[page.id] = it.boundsInWindow() }
                .sidebarActiveRow(active, iconTint, rowShape)
                .dropLine(lineBefore, lineAfter)
                .padding(start = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 展开箭头（.notes-row-toggle）：18×28、圆角 4，Chevron 13.5 浅灰。
            val toggleLabel = if (open) collapseLabel(page.title) else expandLabel(page.title)
            Box(
                Modifier.padding(start = 1.dp).size(18.dp, 28.dp).clip(RoundedCornerShape(4.dp)).clickable(onClick = onToggle)
                    .semantics { contentDescription = toggleLabel; role = Role.Button },
                Alignment.Center,
            ) { LucideIcon(if (open) Lucide.ChevronDown else Lucide.ChevronRight, 13.5.dp, Faint) }
            Row(
                Modifier.weight(1f).heightIn(min = 42.dp).clickable(enabled = !busy) { onOpen(page.id) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (active || page.locked) {
                    Box(Modifier.size(30.dp, 36.dp), Alignment.Center) { NoteIcon(page.icon, 15.sp, 15.dp, iconTint, page.kind) }
                } else {
                    EmojiTriggerButton(
                        current = page.icon,
                        onChange = { icon -> onChangeIcon(page, icon) },
                        description = stringResource(R.string.em_change_icon_of, page.title),
                        modifier = Modifier.size(30.dp, 36.dp),
                        enabled = !busy,
                    ) { NoteIcon(page.icon, 15.sp, 15.dp, iconTint, page.kind) }
                }
                Text(
                    page.title,
                    // 拖动处只是标题区（网页的拖动元是标题按钮，图标按钮在它外面），撑满行高；放在行的 clickable 里层，长按后原地松手不会打开。
                    modifier = Modifier.weight(1f).heightIn(min = 42.dp).noteReorderDrag(page, rowDrag).wrapContentHeight()
                        .padding(start = 4.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                    color = if (active) Sm.Ink else Sm.Text,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val insideLabel = stringResource(R.string.pg_add_page_inside_title, page.title)
                NewPageMenuAnchor(rowDrag.state.kinds, insideLabel, onCreateInside, onGenerate = onGenerateInside) { open ->
                    RowAction(Lucide.Plus, 14.dp, insideLabel, enabled = !busy, onClick = open)
                }
                RowAction(
                    Lucide.Ellipsis, 14.dp, stringResource(R.string.sb_actions_for_title, page.title), enabled = !busy,
                    modifier = Modifier.onGloballyPositioned {
                        val b = it.boundsInWindow()
                        moreBounds = IntRect(b.left.roundToInt(), b.top.roundToInt(), b.right.roundToInt(), b.bottom.roundToInt())
                    },
                ) { menuAnchor = moreBounds }
            }
        }
        menuAnchor?.let { anchor ->
            val fav = page.favoritedAt != null
            ActionsMenu(anchor, stringResource(R.string.sb_actions_for_title, page.title), { menuAnchor = null }, animated = true) {
                if (!page.locked) {
                    MenuItem(stringResource(R.string.sb_rename), Lucide.Pencil) {
                        menuAnchor = null
                        onRename(page)
                    }
                }
                MenuItem(stringResource(if (fav) R.string.pg_remove_from_favorites else R.string.pg_add_to_favorites), if (fav) Lucide.StarOff else Lucide.Star) {
                    menuAnchor = null
                    onToggleFavorite(page)
                }
                MenuItem(stringResource(R.string.pg_move_to), Lucide.FolderInput) {
                    menuAnchor = null
                    onMove(page)
                }
                Box(Modifier.padding(horizontal = 8.dp, vertical = 4.8.dp).fillMaxWidth().height(1.dp).background(Sm.Border))
                MenuItem(stringResource(R.string.move_to_trash), Lucide.Trash2, danger = true) {
                    menuAnchor = null
                    onTrash(page)
                }
            }
        }
        if (reorderError != null) ReorderErrorPopup(reorderFailureText(reorderError), rowDrag.reorder.onDismissError)
    }
}

@Composable
private fun collapseLabel(title: String) = stringResource(R.string.pg_collapse_title, title)

@Composable
private fun expandLabel(title: String) = stringResource(R.string.pg_expand_title, title)

/** 笔记行主体的长按拖动（网页 ReorderRowButton，disabled={busy}；正在移动的这一篇、以及类型筛选平铺态也不能拖）。 */
private fun Modifier.noteReorderDrag(page: NotePageSummary, rowDrag: NoteRowDrag, extraLocked: Boolean = false): Modifier = reorderDrag(
    id = page.id,
    drag = rowDrag.drag,
    locked = extraLocked || rowDrag.busy || page.id in rowDrag.state.moveBusy,
    onStart = {
        rowDrag.reorder.surface = rowDrag.surface
        rowDrag.reorder.onDismissError()
        // 拖的这一篇放得进哪个分区（网页行的 data-page-kind）。
        rowDrag.drag.draggingTag = rowDrag.state.sectionKindOf(page).wire
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
private fun RowAction(icon: List<String>, iconSize: Dp, description: String, enabled: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.padding(end = 3.2.dp).size(25.6.dp).clip(RoundedCornerShape(4.dp))
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

/**
 * 笔记图标：设置了表情 / 上传的图片就显示它，否则是页面类型的图标（[pageKindIcon]：笔记 FileText、白板 Shapes、幻灯片 Presentation，
 * 网页 NoteIcon 的 fallback = PageKindIcon）。
 */
@Composable
fun NoteIcon(icon: String?, emojiSize: androidx.compose.ui.unit.TextUnit, iconSize: Dp, tint: Color, kind: PageKind = PageKind.Note) {
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
    else LucideIcon(pageKindIcon(kind), iconSize, tint)
}

/** 页面类型的名字（网页 PAGE_KIND_LABELS）：检索结果里白板 / 幻灯片标题后面的小字。 */
@StringRes
fun pageKindLabel(kind: PageKind): Int = when (kind) {
    PageKind.Note -> R.string.page_kind_note
    PageKind.Whiteboard -> R.string.page_kind_whiteboard
    PageKind.Slides -> R.string.page_kind_slides
}

// ---------------------------------------------------------------------------------------------
// 工作区首页（网页 NotesHome，手机）：左右 20、下 96；顶部切换（上距 4）；
// Studio 头部（"Workspace" 30/750 + 胶囊操作键 New project / Import Markdown）→ Studio Quick-Create Deck 卡片 →
// 类型筛选栏（All | Notes | Slides | Whiteboards）→ 圆角卡片分组列表（带语义色图标块、Favorites 类型标签）。

@Composable
fun NotesHome(
    state: NotesUiState,
    onSwitch: (Workspace) -> Unit,
    onOpen: (String) -> Unit,
    /** 新建这个类型的页面（首页和空状态的新建按钮，能建的类型各一个）。 */
    onCreate: (PageKind) -> Unit,
    onMove: (NotePageSummary) -> Unit,
    onNewGroup: () -> Unit,
    onRetry: () -> Unit,
    reorder: NoteReorder = NoteReorder.None,
    onToggleExpanded: (String) -> Unit = {},
    /** "Import Markdown"（头部和空状态的按钮）：打开文件选择器。 */
    onImport: () -> Unit = {},
    /** 新建卡片下面的「用 AI 生成」（能建幻灯片时）。 */
    onGenerateSlides: (() -> Unit)? = null,
) {
    val busy = state.busy || state.loading
    val scroll = rememberScrollState()
    val drag = remember(scroll) { DragState(scroll) }
    val rowDrag = NoteRowDrag(drag, state, busy, reorder, NoteListSurface.Home)
    Column(
        Modifier.fillMaxSize().onGloballyPositioned { drag.listBounds = it.boundsInWindow() }
            .verticalScroll(scroll).padding(start = 20.dp, end = 20.dp, bottom = 96.dp),
    ) {
        WorkspaceSwitch(Workspace.Notes, onSwitch, Modifier.padding(top = 4.dp))
        state.error?.let { ErrorBar(notesErrorText(it), onRetry, Modifier.padding(top = 20.dp)) }
        when {
            state.loading && state.pages.isEmpty() && state.groups.isEmpty() ->
                Text(stringResource(R.string.loading_notes), color = Sm.Muted, fontSize = 14.sp,
                    modifier = Modifier.padding(top = 96.dp, bottom = 16.dp))
            state.pages.isEmpty() && state.groups.isEmpty() -> if (state.error == null && state.loaded) NotesEmpty(state.kinds, busy, onCreate, onImport, onGenerateSlides)
            else -> NotesHomeList(state, busy, rowDrag, onOpen, onCreate, onMove, onNewGroup, onToggleExpanded, onImport, onGenerateSlides)
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
    onCreate: (PageKind) -> Unit,
    onMove: (NotePageSummary) -> Unit,
    onNewGroup: () -> Unit,
    onToggleExpanded: (String) -> Unit,
    onImport: () -> Unit,
    onGenerateSlides: (() -> Unit)?,
) {
    val drag = rowDrag.drag
    val kinds = state.kinds
    val multiKind = kinds.size > 1
    var kindFilter by remember { mutableStateOf<PageKind?>(null) }
    val activeFilter = if (multiKind) kindFilter else null
    val groupIds = remember(state.groups) { state.groups.mapTo(HashSet()) { it.id } }
    fun matchesFilter(page: NotePageSummary): Boolean = activeFilter == null || state.sectionKindOf(page) == activeFilter

    // 子页面的树（网页 notes-home）：最上层的页面按项目分组，子页面在展开的父页面下缩进并带竖线；筛选时平铺显示。
    @Composable
    fun Tree(page: NotePageSummary, flat: Boolean, showTopDivider: Boolean) {
        val kids = state.children(page.id)
        val open = !flat && page.id in state.expanded
        HomeItem(page, busy, rowDrag, onOpen, onMove, open = open, flat = flat, showTopDivider = showTopDivider, onToggle = { onToggleExpanded(page.id) })
        if (open) {
            Column(
                Modifier.padding(start = 22.dp).fillMaxWidth()
                    .drawBehind {
                        val lineW = 1.dp.toPx()
                        val lineX = if (layoutDirection == LayoutDirection.Rtl) size.width - lineW else 0f
                        drawRect(Sm.Border, topLeft = Offset(lineX, 0f), size = Size(lineW, size.height))
                    },
            ) {
                if (kids.isEmpty()) {
                    Text(
                        stringResource(R.string.pg_no_pages_inside),
                        color = Faint, fontSize = 13.5.sp,
                        modifier = Modifier.fillMaxWidth()
                            .drawBehind { drawRect(Sm.Border, size = Size(size.width, 1.dp.toPx())) }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    )
                } else {
                    kids.forEach { child -> key(child.id) { Tree(child, flat = false, showTopDivider = true) } }
                }
            }
        }
    }

    // 标题 "Workspace" 和分区的小标题是"移出项目"的投放区，项目小标题是"移进项目"的（网页 data-note-group-drop）。
    fun Modifier.zone(key: String): Modifier =
        dropZone(drag.target is DropTarget.Into && drag.targetZone == key).onGloballyPositioned { drag.zones[key] = it.boundsInWindow() }
    DisposableEffect(Unit) { onDispose { drag.zones.clear(); drag.zoneContainers.clear(); drag.zoneAccepts.clear() } }
    val sections = state.sections
    SideEffect {
        drag.rowAccepts.clear()
        sections.forEach { section -> section.roots.forEach { drag.rowAccepts[it.id] = section.kind.wire } }
    }
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl

    // Studio 头部：Workspace 标题 + New project / Import Markdown 胶囊按钮
    Column(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            stringResource(R.string.workspace),
            modifier = Modifier.fillMaxWidth().zone(""),
            color = Sm.Ink, fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight(750), letterSpacing = if (rtl) 0.sp else (-1.2).sp,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            HomeUtilPill(Lucide.FolderPlus, stringResource(R.string.new_project), enabled = !busy, onClick = onNewGroup)
            HomeUtilPill(Lucide.Upload, stringResource(R.string.import_markdown), enabled = !busy, onClick = onImport)
        }
    }

    // Studio Quick-Create Deck（移动端纵向堆叠卡片，每种页面类型一张）
    CreateDeck(kinds, busy, onCreate, onGenerateSlides, Alignment.End, Modifier.padding(bottom = 18.dp))

    // 最近编辑（网页 notes-recent-list）：显示封面、图标、标题和日期
    val recent = remember(state.pages) { state.pages.sortedByDescending { it.updatedAt }.take(8) }
    if (recent.isNotEmpty()) {
        RecentNotesCarousel(recent, busy, multiKind, onOpen, Modifier.padding(bottom = 18.dp))
    }

    // 类型筛选栏（All | Notes | Slides | Whiteboards）
    if (multiKind) {
        KindFilterBar(kinds, activeFilter, onSelect = { kindFilter = it }, modifier = Modifier.padding(bottom = 14.dp))
    }

    // Favorites（圆角卡片 + 类型胶囊标签）
    val visibleFavorites = state.favorites.filter(::matchesFilter)
    if (visibleFavorites.isNotEmpty()) {
        GroupHeading(stringResource(R.string.pg_favorites), visibleFavorites.size, icon = Lucide.Star, iconTint = Sm.KindFav)
        HomeCard {
            visibleFavorites.forEachIndexed { index, page ->
                key("fav-" + page.id) { FavoriteHomeItem(page, busy, multiKind, showTopDivider = index > 0, onOpen) }
            }
        }
    }

    // Projects
    val visibleGroups = if (activeFilter != null) {
        state.groups.mapNotNull { group ->
            val members = state.pages.filter { it.groupId == group.id && matchesFilter(it) }
            if (members.isEmpty()) null else Triple(group, members, members.size)
        }
    } else {
        state.groups.map { group -> Triple(group, state.members(group.id), state.memberCount(group.id)) }
    }
    visibleGroups.forEach { (group, members, total) ->
        key(group.id) {
            DisposableEffect(group.id) { onDispose { drag.zones.remove(group.id) } }
            GroupHeading(group.name, total, icon = Lucide.Folder, iconTint = Sm.Muted, modifier = Modifier.zone(group.id))
        }
        if (members.isEmpty()) {
            HomeEmptyCard(stringResource(R.string.no_notes_in_project))
        } else {
            HomeCard {
                members.forEachIndexed { index, page ->
                    key(page.id) { Tree(page, flat = activeFilter != null, showTopDivider = index > 0) }
                }
            }
        }
    }

    // 不在项目里的页面分区（Notes / Slides / Whiteboards）
    val ungroupedFiltered = if (activeFilter != null) {
        state.pages.filter { (it.groupId == null || it.groupId !in groupIds) && matchesFilter(it) }
    } else emptyList()
    val visibleSections = if (activeFilter != null) {
        if (ungroupedFiltered.isNotEmpty()) listOf(Triple(activeFilter, ungroupedFiltered, ungroupedFiltered.size)) else emptyList()
    } else {
        sections.filter { it.roots.isNotEmpty() }.map { Triple(it.kind, it.roots, it.count) }
    }
    visibleSections.forEach { (kind, roots, count) ->
        val zone = sectionZone(kind)
        val heading = if (multiKind) stringResource(sectionLabel(kind)) else if (state.groups.isNotEmpty()) stringResource(R.string.no_project) else null
        key(zone) {
            DisposableEffect(zone, heading != null) {
                drag.zoneContainers[zone] = null
                drag.zoneAccepts[zone] = kind.wire
                onDispose { drag.zones.remove(zone); drag.zoneContainers.remove(zone); drag.zoneAccepts.remove(zone) }
            }
            if (heading != null) {
                GroupHeading(
                    heading, count,
                    icon = if (multiKind) pageKindIcon(kind) else null,
                    iconTint = if (multiKind) pageKindColor(kind) else Sm.Muted,
                    modifier = Modifier.zone(zone),
                )
            }
        }
        HomeCard {
            roots.forEachIndexed { index, page ->
                key(page.id) { Tree(page, flat = activeFilter != null, showTopDivider = index > 0) }
            }
        }
    }

    if (activeFilter != null && visibleFavorites.isEmpty() && visibleGroups.isEmpty() && visibleSections.isEmpty()) {
        HomeEmptyCard(stringResource(R.string.sb_no_notes_match))
    }
}

@Composable
internal fun NoteCoverBanner(
    cover: String?,
    coverPosition: Int?,
    kind: PageKind,
    modifier: Modifier = Modifier,
) {
    val preset = remember(cover) { com.kakumine.notefable.data.NoteCovers.preset(cover) }
    val image = remember(cover) { com.kakumine.notefable.data.NoteCovers.imagePath(cover) }
    val bgModifier = when {
        preset != null && preset.startArgb == preset.endArgb -> Modifier.background(Color(preset.startArgb))
        preset != null -> Modifier.background(
            Brush.linearGradient(
                colors = listOf(Color(preset.startArgb), Color(preset.endArgb)),
                start = Offset.Zero,
                end = Offset(400f, 400f),
            ),
        )
        else -> Modifier.background(
            Brush.linearGradient(
                colors = listOf(pageKindSoft(kind), Sm.Sidebar),
                start = Offset.Zero,
                end = Offset(400f, 400f),
            ),
        )
    }
    Box(modifier.then(bgModifier)) {
        if (image != null) {
            val verticalBias = (((coverPosition ?: 50).coerceIn(0, 100) - 50) / 50f)
            coil3.compose.AsyncImage(
                model = com.kakumine.notefable.BuildConfig.BASE_URL.trimEnd('/') + image,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alignment = BiasAlignment(0f, verticalBias),
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun RecentNotesCarousel(
    recent: List<NotePageSummary>,
    busy: Boolean,
    multiKind: Boolean,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(start = 4.dp, end = 4.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            LucideIcon(Lucide.Clock3, 14.dp, Sm.Muted)
            Text(stringResource(R.string.recently_edited), color = Sm.Muted, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold)
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            recent.forEach { page ->
                key(page.id) {
                    val shape = RoundedCornerShape(14.dp)
                    val iconShape = RoundedCornerShape(9.dp)
                    val title = page.title.ifEmpty { stringResource(R.string.sb_untitled) }
                    Column(
                        Modifier.width(168.dp).height(132.dp)
                            .shadow(1.dp, shape, ambientColor = Color(0x0A0F172A), spotColor = Color(0x0A0F172A))
                            .clip(shape).background(Sm.Surface).border(1.dp, Sm.Border, shape)
                            .clickable(enabled = !busy, role = Role.Button) { onOpen(page.id) }
                            .alpha(if (busy) 0.55f else 1f),
                    ) {
                        Box(Modifier.fillMaxWidth().height(44.dp)) {
                            NoteCoverBanner(page.cover, page.coverPosition, page.kind, Modifier.fillMaxSize())
                            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(1.dp).background(Sm.Border))
                            if (multiKind) {
                                Box(
                                    Modifier.align(Alignment.TopEnd).padding(6.dp)
                                        .clip(CircleShape).background(Sm.Surface.copy(alpha = 0.88f)).border(1.dp, Sm.Border, CircleShape)
                                        .padding(horizontal = 6.dp, vertical = 1.5.dp),
                                ) {
                                    Text(stringResource(pageKindLabel(page.kind)), color = pageKindTextColor(page.kind), fontSize = 10.5.sp, lineHeight = 13.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                        Column(Modifier.fillMaxSize().padding(start = 12.dp, end = 12.dp, bottom = 10.dp)) {
                            Box(
                                Modifier.offset(y = (-14).dp).size(30.dp)
                                    .shadow(2.dp, iconShape, ambientColor = Color(0x120F172A), spotColor = Color(0x120F172A))
                                    .clip(iconShape).background(Sm.Surface).border(1.dp, Sm.Border, iconShape),
                                Alignment.Center,
                            ) {
                                NoteIcon(page.icon, 16.sp, 15.dp, pageKindColor(page.kind), page.kind)
                            }
                            Text(
                                title,
                                color = Sm.Ink, fontSize = 13.5.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold,
                                maxLines = 2, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.offset(y = (-8).dp),
                            )
                            Spacer(Modifier.weight(1f))
                            Text(shortDate(page.updatedAt), color = Faint, fontSize = 11.5.sp, lineHeight = 14.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeUtilPill(icon: List<String>, text: String, enabled: Boolean, onClick: () -> Unit) =
    HomeUtilPill(text, enabled, onClick) { LucideIcon(icon, 14.dp, Sm.Faint) }

@Composable
private fun HomeUtilPill(text: String, enabled: Boolean, onClick: () -> Unit, leading: @Composable () -> Unit) {
    val shape = CircleShape
    Row(
        Modifier.height(34.4.dp).clip(shape).background(Sm.Surface).border(1.dp, Sm.Border, shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .alpha(if (enabled) 1f else 0.5f)
            .padding(horizontal = 11.2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        leading()
        Spacer(Modifier.width(6.dp))
        Text(text, color = Sm.Muted, fontSize = 13.sp, fontWeight = FontWeight(520), maxLines = 1)
    }
}

// 新建卡片和它下面的「用 AI 生成」胶囊（网页 .ws-create-with-ai：间距 9.6，首页靠右、空状态居中）。能建幻灯片时才有胶囊。
@Composable
private fun CreateDeck(
    kinds: List<PageKind>, busy: Boolean, onCreate: (PageKind) -> Unit, onGenerate: (() -> Unit)?,
    alignment: Alignment.Horizontal, modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(9.6.dp), horizontalAlignment = alignment) {
        CreateDeckCards(kinds, busy, onCreate)
        if (onGenerate != null && PageKind.Slides in kinds) {
            HomeUtilPill(stringResource(R.string.slides_generate_with_ai), enabled = !busy, onClick = onGenerate) { AppIcon(16.dp) }
        }
    }
}

@Composable
private fun CreateDeckCards(kinds: List<PageKind>, busy: Boolean, onCreate: (PageKind) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        kinds.forEach { kind ->
            val cardShape = RoundedCornerShape(14.dp)
            val iconShape = RoundedCornerShape(9.dp)
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp)
                    .shadow(1.dp, cardShape, ambientColor = Color(0x0A0F172A), spotColor = Color(0x0A0F172A))
                    .clip(cardShape).background(Sm.Surface).border(1.dp, Sm.Border, cardShape)
                    .clickable(enabled = !busy, role = Role.Button) { onCreate(kind) }
                    .alpha(if (busy) 0.55f else 1f)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier.size(32.dp).clip(iconShape).background(pageKindSoft(kind)).border(1.dp, pageKindBorder(kind), iconShape),
                    Alignment.Center,
                ) {
                    LucideIcon(pageKindIcon(kind), 17.dp, pageKindColor(kind))
                }
                Text(
                    stringResource(newPageLabel(kind)),
                    color = Sm.Ink, fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight(580),
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                Box(Modifier.size(26.dp).clip(CircleShape).background(Sm.Hover), Alignment.Center) {
                    LucideIcon(Lucide.Plus, 14.dp, Sm.Muted)
                }
            }
        }
    }
}

@Composable
private fun KindFilterBar(kinds: List<PageKind>, active: PageKind?, onSelect: (PageKind?) -> Unit, modifier: Modifier = Modifier) {
    val trackShape = RoundedCornerShape(10.dp)
    val label = stringResource(R.string.ws_page_type)
    Row(
        modifier.fillMaxWidth().clip(trackShape).background(Sm.Hover).border(1.dp, Sm.Border, trackShape)
            .horizontalScroll(rememberScrollState()).padding(3.dp)
            .semantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        FilterPill(stringResource(R.string.search_tab_all), icon = null, iconTint = Sm.Muted, selected = active == null) { onSelect(null) }
        kinds.forEach { kind ->
            FilterPill(
                stringResource(sectionLabel(kind)),
                icon = pageKindIcon(kind),
                iconTint = if (active == kind) pageKindColor(kind) else Sm.Muted,
                selected = active == kind,
            ) { onSelect(kind) }
        }
    }
}

@Composable
private fun FilterPill(text: String, icon: List<String>?, iconTint: Color, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(7.2.dp)
    Row(
        Modifier.height(32.dp).clip(shape)
            .then(if (selected) Modifier.background(Sm.Surface).border(1.dp, Sm.Border, shape) else Modifier)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { this.selected = selected }
            .padding(horizontal = 10.4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (icon != null) LucideIcon(icon, 13.dp, iconTint)
        Text(text, color = if (selected) Sm.Ink else Sm.Muted, fontSize = 13.sp, fontWeight = FontWeight(540), maxLines = 1)
    }
}

@Composable
private fun HomeCard(content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.fillMaxWidth().padding(bottom = 18.dp)
            .shadow(1.dp, shape, ambientColor = Color(0x0A0F172A), spotColor = Color(0x0A0F172A))
            .clip(shape).background(Sm.Surface).border(1.dp, Sm.Border, shape),
    ) { content() }
}

@Composable
private fun HomeEmptyCard(text: String) {
    val shape = RoundedCornerShape(14.dp)
    Box(
        Modifier.fillMaxWidth().padding(bottom = 18.dp).clip(shape)
            .background(Sm.Sidebar.copy(alpha = 0.55f)).border(1.dp, Sm.BorderStrong, shape)
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text(text, color = Sm.Muted, fontSize = 13.5.sp)
    }
}

@Composable
private fun HomeKindBadge(kind: PageKind) {
    Box(
        Modifier.clip(CircleShape).background(pageKindSoft(kind)).padding(horizontal = 7.dp, vertical = 2.dp),
        Alignment.Center,
    ) {
        Text(stringResource(pageKindLabel(kind)), color = pageKindTextColor(kind), fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight(550), maxLines = 1)
    }
}

@Composable
private fun GroupHeading(name: String, count: Int, modifier: Modifier = Modifier, icon: List<String>? = null, iconTint: Color = Sm.Muted) {
    Row(
        Modifier.padding(start = 4.dp, end = 4.dp, top = 4.dp, bottom = 8.dp).then(modifier),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) LucideIcon(icon, 13.5.dp, iconTint)
        Text(name, color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.sp, fontWeight = FontWeight.SemiBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        CountPill(count)
    }
}

@Composable
private fun HomeIconTile(icon: String?, kind: PageKind) {
    val tileBg = if (icon != null) Sm.Hover else pageKindSoft(kind)
    Box(Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(tileBg), Alignment.Center) {
        NoteIcon(icon, 16.5.sp, 16.dp, pageKindColor(kind), kind)
    }
}

// 收藏的行（圆角卡片内）：最小高 52、图标块 30、间距 10、标题 15.5/530、多类型时右侧类型胶囊。
@Composable
private fun FavoriteHomeItem(page: NotePageSummary, busy: Boolean, multiKind: Boolean, showTopDivider: Boolean, onOpen: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp)
            .then(if (showTopDivider) Modifier.drawBehind { drawRect(Sm.Border, size = Size(size.width, 1.dp.toPx())) } else Modifier)
            .clickable(enabled = !busy) { onOpen(page.id) }.padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        HomeIconTile(page.icon, page.kind)
        Text(page.title, modifier = Modifier.weight(1f), color = Sm.Text, fontSize = 15.5.sp, lineHeight = 22.sp,
            fontWeight = FontWeight(530), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (multiKind) HomeKindBadge(page.kind)
    }
}

@Composable
private fun HomeItem(
    page: NotePageSummary, busy: Boolean, rowDrag: NoteRowDrag, onOpen: (String) -> Unit, onMove: (NotePageSummary) -> Unit,
    open: Boolean = false, flat: Boolean = false, showTopDivider: Boolean = false, onToggle: () -> Unit = {},
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
            .then(if (showTopDivider) Modifier.drawBehind { drawRect(Sm.Border, size = Size(size.width, 1.dp.toPx())) } else Modifier)
            .dropLine(target?.id == page.id && !target.after, target?.id == page.id && target.after),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!flat) {
            val toggleLabel = if (open) collapseLabel(page.title) else expandLabel(page.title)
            Box(
                Modifier.padding(start = 4.dp).size(26.dp, 40.dp).clip(RoundedCornerShape(6.dp)).clickable(onClick = onToggle)
                    .semantics { contentDescription = toggleLabel; role = Role.Button },
                Alignment.Center,
            ) { LucideIcon(if (open) Lucide.ChevronDown else Lucide.ChevronRight, 15.dp, Faint) }
        }
        Row(
            Modifier.weight(1f).heightIn(min = 52.dp).clickable(enabled = !busy) { onOpen(page.id) }.noteReorderDrag(page, rowDrag, extraLocked = flat)
                .padding(start = if (flat) 12.dp else 4.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            HomeIconTile(page.icon, page.kind)
            Text(page.title, modifier = Modifier.weight(1f), color = Sm.Text, fontSize = 15.5.sp, lineHeight = 22.sp,
                fontWeight = FontWeight(530), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(shortDate(page.updatedAt), color = Faint, fontSize = 12.5.sp, lineHeight = 18.sp)
        }
        Box(
            Modifier.padding(end = 4.dp).size(36.dp, 40.dp).clip(RoundedCornerShape(7.dp)).clickable(enabled = !busy) { onMove(page) }
                .semantics { contentDescription = moveLabel; role = Role.Button },
            Alignment.Center,
        ) { LucideIcon(Lucide.FolderInput, 16.dp, Faint) }
    }
    if (reorderError != null) ReorderErrorPopup(reorderFailureText(reorderError), rowDrag.reorder.onDismissError, rowHeight = 52.dp)
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

// 一篇笔记都没有（网页 NotesWorkspace 的空状态，手机）：居中 Studio 徽章（LayoutGrid）、标题、说明、Quick-Create Deck 卡片、Import 胶囊。
@Composable
private fun NotesEmpty(kinds: List<PageKind>, busy: Boolean, onCreate: (PageKind) -> Unit, onImport: () -> Unit, onGenerateSlides: (() -> Unit)?) {
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val emblemShape = RoundedCornerShape(16.dp)
    Column(Modifier.fillMaxWidth().padding(top = 56.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(56.dp).clip(emblemShape).background(Sm.AccentSoft).border(1.dp, Sm.Border, emblemShape),
            Alignment.Center,
        ) {
            LucideIcon(Lucide.LayoutGrid, 26.dp, Sm.Ink, strokeWidth = 1.6f)
        }
        Text(stringResource(R.string.workspace), modifier = Modifier.padding(top = 18.dp), color = Sm.Ink, fontSize = 32.sp,
            lineHeight = 38.sp, fontWeight = FontWeight(750), letterSpacing = if (rtl) 0.sp else (-1.2).sp)
        val intro = stringResource(R.string.notes_intro).split("%1\$s")
        Text(
            buildAnnotatedString {
                intro.forEachIndexed { index, part ->
                    if (index > 0) withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, background = Sm.CodeBackground)) { append(" / ") }
                    append(part)
                }
            },
            modifier = Modifier.padding(top = 8.dp), color = Sm.Muted, fontSize = 14.5.sp, lineHeight = 22.sp,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        CreateDeck(kinds, busy, onCreate, onGenerateSlides, Alignment.CenterHorizontally, Modifier.padding(top = 24.dp))
        Spacer(Modifier.height(14.dp))
        HomeUtilPill(Lucide.Upload, stringResource(R.string.import_markdown), enabled = !busy, onClick = onImport)
        Text(stringResource(R.string.notes_storage_hint), modifier = Modifier.padding(top = 36.dp).widthIn(max = 384.dp),
            color = Faint, fontSize = 12.sp, lineHeight = 19.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
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
    /** 文字左边的图标（网页 inline-flex gap-1：间距 4，图标 15）。 */
    leadingIcon: List<String>? = null,
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
            if (leadingIcon != null) LucideIcon(leadingIcon, 15.dp, shown)
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

/** 新建 / 重命名项目或页面（网页 GroupNameDialog / RenamePageDialog）。[onSubmit] 成功返回 true 时关闭。 */
@Composable
fun GroupNameDialog(
    title: String,
    initial: String,
    submitLabel: String,
    error: NotesError?,
    placeholder: String = stringResource(R.string.project_name),
    maxLength: Int = 60,
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
        DialogInput(name, { name = it }, placeholder, ::submit, maxLength = maxLength)
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
                                Box(Modifier.width(20.dp), Alignment.Center) { NoteIcon(target.icon, 15.sp, 15.dp, Sm.Muted, target.kind) }
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
            Box(Modifier.size(24.dp), Alignment.Center) { NoteIcon(item.icon, 17.sp, 16.dp, Sm.Muted, item.kind) }
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
