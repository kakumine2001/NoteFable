package com.kakumine.notefable.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.ExportedNote
import com.kakumine.notefable.data.ImportCandidate
import com.kakumine.notefable.data.ImportMarkdownFile
import com.kakumine.notefable.data.NoteImport
import com.kakumine.notefable.data.NoteGroupSummary
import com.kakumine.notefable.data.NotePageSettings
import com.kakumine.notefable.data.NotePageSummary
import com.kakumine.notefable.data.NoteTrashItem
import com.kakumine.notefable.data.NotesBackend
import com.kakumine.notefable.data.NotesList
import com.kakumine.notefable.data.PageKind
import com.kakumine.notefable.data.PageKindTable
import com.kakumine.notefable.data.SlidesWizardSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock

/** 抽屉和首页在看聊天还是笔记（网页的 Chat / Note 切换）。 */
enum class Workspace { Chat, Notes }

/**
 * 给用户看的错误。服务端返回的原句（[detail]，英文，和聊天一样原样显示）优先；
 * 网络错误这类没有原句的，用 [kind] 对应的网页文案。
 */
data class NotesError(val kind: Kind, val detail: String? = null) {
    enum class Kind {
        Load, Create, Trash, TrashUnsaved, Group, TrashLoad, TrashAction, UnsavedDraft,
        /** 导出 Markdown：读不到 / 写不进文件；打开着的笔记还有存不上的草稿。 */
        Export, ExportUnsaved,
        /** 导入 Markdown：请求失败（或文件读不出来）；选的文件超过个数、类型不对、单个太大、合计太大。 */
        Import, ImportTooMany, ImportBadType, ImportFileTooLarge, ImportTooLarge,
    }
}

/**
 * 正在编辑的笔记。标题和图标随网页编辑器的 meta 消息更新。
 * [editor] 是这个编辑器（WebView）最初打开的页面 id，编辑器没换就不变；冲突后"另存为新笔记"时网页换到新页面，
 * [id] 跟着变成新页面，[editor] 不变，所以 WebView 不重新加载。
 * [kind] 是页面类型（列表、检索结果里的；网页的 ready 消息带着时以它为准），决定顶栏的类型图标和分享按钮。
 * [reveal] 是从检索结果打开时命中的块（笔记的块、白板的元素，结果的 blockId）：只在这个编辑器第一次加载时放进地址（`&reveal=`），
 * 网页读好页面后滚动 / 缩放到它。
 */
data class OpenNote(
    val id: String, val title: String, val icon: String?, val editor: String = id, val kind: PageKind = PageKind.Note,
    val reveal: String? = null,
)

/** 打开列表里的这一篇：标题、图标、类型都取列表项的。 */
internal fun NotePageSummary.toOpenNote(reveal: String? = null) = OpenNote(id, title, icon, kind = kind, reveal = reveal)

/** 让网页保存的结果。[draftKept]：没保存成功，但草稿已留在 WebView 里、之后会重试（不是冲突），可以先离开。 */
data class FlushResult(val ok: Boolean, val draftKept: Boolean = false)

data class TrashUiState(
    /** null 表示还在读。 */
    val items: List<NoteTrashItem>? = null,
    val loadError: NotesError? = null,
    val error: NotesError? = null,
    val busy: Boolean = false,
    val confirmAll: Boolean = false,
    val confirmId: String? = null,
)

/**
 * 开着的 AI 生成幻灯片向导（#150）。向导本身是网页（常驻 /note-embed WebView 里的 `notefableEmbed.slidesWizard`），App 只记开在哪。
 * [request] 每次打开换一个（同一个入口再点一次也要重新调网页）。[editor] 是向导盖着的编辑器（[OpenNote.editor]）；
 * null 是没有开着页面时的全屏向导画面。[shown]：网页里已经出来了（打开的结果或 open 消息），之后的 closed 才算这一次的。
 */
data class SlidesWizardUi(
    val source: SlidesWizardSource,
    val request: Int,
    val editor: String? = null,
    val shown: Boolean = false,
)

data class NotesUiState(
    val workspace: Workspace = Workspace.Chat,
    val pages: List<NotePageSummary> = emptyList(),
    val groups: List<NoteGroupSummary> = emptyList(),
    /** 还没读到过列表（首次加载中）。 */
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: NotesError? = null,
    /** 新建、移到回收站进行中：和网页一样期间禁用列表操作。 */
    val busy: Boolean = false,
    val groupError: NotesError? = null,
    val collapsed: Set<String> = emptySet(),
    /** 展开了哪些页面（子页面的树）。侧栏和首页共用，重开 App 后保留（网页 notefable:note-pages-expanded:v1）。 */
    val expanded: Set<String> = emptySet(),
    /** 折叠了哪些分区（笔记 / 幻灯片 / 白板），重开 App 后保留（网页 notefable:workspace-sections-collapsed:v1）。 */
    val collapsedSections: Set<PageKind> = emptySet(),
    val open: OpenNote? = null,
    /** 网页编辑器报来的保存状态：saved / saving / unsaved / error / conflict。 */
    val saveState: String? = null,
    /** 离开笔记时没能保存：提示后留在笔记里。 */
    val notice: NotesError? = null,
    /** 回收站窗口；null 表示没打开。 */
    val trash: TrashUiState? = null,
    /** 侧栏里改图标没成功（网页 notes-sidebar 的 iconError："Could not change the icon. Try again."）。 */
    val iconError: Boolean = false,
    /** 有一次 POST /api/pages/reorder 还没完（网页 use-note-pages 的 reorderBusy）：这时再排序会提示等上一次完成。 */
    val reorderBusy: Boolean = false,
    /** 正在移动（排序或拖进项目）的笔记：这些行不能拖（网页每个 ReorderRowButton 自己的 busy）。 */
    val moveBusy: Set<String> = emptySet(),
    /** 拖动失败的行和原因（网页 ReorderRowButton 的 list-reorder-error）。 */
    val reorderError: ReorderFailure? = null,
    /** "Import to" 窗口开着：选好的 Markdown 文件在等用户选导入到哪个项目（网页 page.tsx 的 importingFiles）。 */
    val importTarget: Boolean = false,
    /** AI 生成幻灯片的向导；null 是没开。 */
    val slidesWizard: SlidesWizardUi? = null,
) {
    /** 画面上的编辑器（[OpenNote.editor]）；停在聊天或笔记列表时是 null。 */
    val visibleEditor: String? get() = open?.editor?.takeIf { workspace == Workspace.Notes }

    /** 项目被删后残留的 groupId 也算未分组（网页 notes-sidebar.tsx 的 loose）。只列最上层的页面，子页面缩进在父页面下。 */
    val loosePages: List<NotePageSummary>
        get() = roots.filter { page -> page.groupId == null || groups.none { it.id == page.groupId } }

    /** 能新建的类型（网页 creatablePageKinds，服务端的表 [PageKindTable]）：分区、新建菜单、首页的新建按钮只出这些。 */
    val kinds: List<PageKind> get() = PageKindTable.creatable

    /** 页面所在的分区（网页 sectionKindOf）：还不能新建的类型（没有编辑器）的页面放在笔记的分区，不会看不到。 */
    fun sectionKindOf(page: NotePageSummary): PageKind = if (page.kind in kinds) page.kind else PageKind.Note

    /**
     * 工作区的分区（网页 workspaceSections，#168）：不在项目里的最上层页面按类型分成笔记、幻灯片、白板（[kinds] 的顺序），
     * 子页面跟着父页面。[WorkspaceSection.count] 含子页面（首页小标题后的数字）。
     */
    val sections: List<WorkspaceSection>
        get() {
            val loose = loosePages
            val types = kinds
            fun size(page: NotePageSummary): Int = 1 + children(page.id).sumOf { size(it) }
            return types.map { kind ->
                val members = loose.filter { (if (it.kind in types) it.kind else PageKind.Note) == kind }
                WorkspaceSection(kind, members, members.sumOf { size(it) })
            }
        }

    /** 项目里最上层的页面（列表用）。 */
    fun members(groupId: String) = roots.filter { it.groupId == groupId }

    /** 项目里的页面数（含子页面），项目标题后的数字。 */
    fun memberCount(groupId: String) = pages.count { it.groupId == groupId }

    /**
     * 父页面 → 子页面（列表顺序）。父页面不在列表里（回收站等）的子页面当最上层，键是 null（网页 note-tree.ts 的 childrenByParent）。
     * 每个状态只算一次：侧栏和首页按项目、按节点反复读。
     */
    private val tree: Map<String?, List<NotePageSummary>> by lazy {
        val ids = pages.mapTo(HashSet()) { it.id }
        pages.groupBy { page -> page.parentId?.takeIf { it in ids && it != page.id } }
    }

    val roots: List<NotePageSummary> get() = tree[null].orEmpty()

    fun children(parentId: String): List<NotePageSummary> = tree[parentId].orEmpty()

    /** 祖先（从上往下，不含自己）。数据坏了成环时也会停。 */
    fun ancestors(id: String): List<NotePageSummary> {
        val byId = pages.associateBy { it.id }
        val chain = ArrayList<NotePageSummary>()
        val seen = hashSetOf(id)
        var parent = byId[id]?.parentId
        while (parent != null && parent !in seen) {
            val page = byId[parent] ?: break
            seen += parent
            chain.add(0, page)
            parent = page.parentId
        }
        return chain
    }

    /** 子孙的 id（不含自己）。 */
    fun descendants(id: String): Set<String> {
        val result = LinkedHashSet<String>()
        val stack = ArrayDeque(children(id))
        while (stack.isNotEmpty()) {
            val page = stack.removeLast()
            if (page.id == id || !result.add(page.id)) continue
            stack.addAll(children(page.id))
        }
        return result
    }

    /** 收藏（按收藏的先后）。 */
    val favorites: List<NotePageSummary>
        get() = pages.filter { it.favoritedAt != null }.sortedBy { it.favoritedAt }

    /** 展开着：自己展开了，或者是打开着的笔记的祖先（网页侧栏同样会展开）。 */
    fun isExpanded(id: String): Boolean = id in expanded || (open != null && children(id).isNotEmpty() && ancestors(open.id).any { it.id == id })
}

/** 一个分区（网页 WorkspaceSection）：类型、最上层的页面（列表顺序）、含子页面的数量。 */
data class WorkspaceSection(val kind: PageKind, val roots: List<NotePageSummary>, val count: Int)

/**
 * 拖动失败：[id] 是被拖的笔记。[detail] 是服务端原句（经词典翻译后显示）；没有时 [wait] 为真显示
 * "Wait for the previous move to finish."，否则 "Could not move the item. Try again."。
 */
data class ReorderFailure(val id: String, val detail: String? = null, val wait: Boolean = false)

/** 折叠了哪些项目，重开 App 后保留（网页存在 localStorage）。 */
interface NotesPrefs {
    var collapsedGroups: Set<String>
    var expandedPages: Set<String>
    /** 折叠了的分区（类型的 wire 值："note" 等）。 */
    var collapsedSections: Set<String>
        get() = emptySet()
        set(@Suppress("UNUSED_PARAMETER") value) {}
}

class PrefsNotesPrefs(context: Context) : NotesPrefs {
    private val prefs = context.getSharedPreferences("notes", Context.MODE_PRIVATE)
    override var collapsedGroups: Set<String>
        get() = prefs.getStringSet("collapsed", emptySet())?.toSet() ?: emptySet()
        set(value) = prefs.edit().putStringSet("collapsed", value).apply()
    override var expandedPages: Set<String>
        get() = prefs.getStringSet("expanded", emptySet())?.toSet() ?: emptySet()
        set(value) = prefs.edit().putStringSet("expanded", value).apply()
    override var collapsedSections: Set<String>
        get() = prefs.getStringSet("collapsedSections", emptySet())?.toSet() ?: emptySet()
        set(value) = prefs.edit().putStringSet("collapsedSections", value).apply()
}

class NotesViewModel(
    private val backend: NotesBackend,
    private val prefs: NotesPrefs,
    /** 侧栏里改没打开的笔记的图标（PUT /api/pages/:id/icon）。 */
    private val noteIcons: com.kakumine.notefable.data.NoteIconBackend = com.kakumine.notefable.data.NoteIconBackend { _, _ -> error("no icon backend") },
) : ViewModel() {
    private val _state = MutableStateFlow(
        NotesUiState(
            collapsed = prefs.collapsedGroups, expanded = prefs.expandedPages,
            collapsedSections = prefs.collapsedSections.mapNotNullTo(HashSet()) { wire -> PageKind.entries.firstOrNull { it.wire == wire } },
        ),
    )
    val state: StateFlow<NotesUiState> = _state.asStateFlow()

    /**
     * 编辑器打开时由界面设置：让网页立刻保存，返回是否已经没有未保存的内容。
     * 离开、切换笔记、切到聊天之前都先调用；没有编辑器（还没加载完）时视为已保存。
     */
    var flushEditor: (suspend () -> FlushResult)? = null

    /**
     * 打开着的笔记的显示设置、锁定、收藏变了：交给网页编辑器（window.notefableEmbed.pageSettings），
     * 编辑器随即变宽、换字体或变成只读。由界面在编辑器打开时设置。
     */
    var pushPageSettings: ((NotePageSummary) -> Unit)? = null

    /**
     * 检索结果就在开着的这一页（[openNote] 不重新加载）：让网页编辑器就地跳到命中的块 / 元素
     * （window.notefableEmbed.reveal）。由界面在编辑器打开时设置。
     */
    var revealInEditor: ((String) -> Unit)? = null

    /**
     * 别的页面改了名、换了图标或从回收站复原了（服务端写入成功之后）：让网页编辑器重读笔记下方的反向链接
     * （window.notefableEmbed.refreshBacklinks）。由界面在编辑器打开时设置。
     */
    var refreshBacklinks: (() -> Unit)? = null

    /**
     * 有页面移进了回收站（本地删除、聊天提案撤销）：通知常驻 WebView 清理对应缓存（即使当前未停留在编辑页）。
     */
    var notifyPagesTrashed: ((Collection<String>) -> Unit)? = null

    /**
     * 侧栏改了一篇的图标（服务端版本号加一）：把服务端返回的整篇页面 JSON 交给常驻 WebView 的缓存（window.notefableEmbed.pageUpdated），
     * 下次从缓存打开时就是新版本，编辑也不会 409。由界面在根上设置。
     */
    var notifyPageUpdated: ((pageId: String, pageJson: String) -> Unit)? = null

    /** 没打开着的一篇的收藏、显示设置、锁定变了：交给常驻 WebView 缓存里的一览（window.notefableEmbed.pageSettings）。由界面在根上设置。 */
    var notifyPageSettings: ((NotePageSummary) -> Unit)? = null

    private var loadJob: Job? = null
    private var navigationJob: Job? = null
    private var trashJob: Job? = null
    private val trashActionJobs = mutableSetOf<Job>()

    /** 每次换身份加一。旧身份下发出、换身份后才回来的改动结果直接丢掉，不写进新身份的列表。 */
    private var identity = 0

    /** 当前身份的序号。界面在慢操作（向文件提供方问文件名和大小）前后各读一次，不一样就丢掉旧身份下选的文件。 */
    val identityGeneration: Int get() = identity

    /** 每完成一次改动（新建、移动、删除…）加一。刷新期间有改动完成的话，刷新读到的可能是改动前的列表，要重读。 */
    private var mutations = 0

    /** 改动完成后调用：还是同一个身份才把结果写进界面，并记一次改动。 */
    private inline fun commit(identityAtStart: Int, apply: () -> Unit): Boolean {
        if (identityAtStart != identity) return false
        mutations++
        apply()
        return true
    }

    // ---- 列表 ----

    /**
     * 同时只保留最新一次刷新，旧请求的结果丢弃。
     * 请求期间有改动完成的话，读到的列表可能比本地的旧（少了刚建的、多了刚删的），重读一次再用。
     */
    fun refresh() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            _state.update { it.copy(loading = !it.loaded, error = null) }
            var result: Result<NotesList>
            while (true) {
                val seen = mutations
                result = runCatching { backend.notes() }
                ensureActive()
                if (result.isFailure || seen == mutations) break
            }
            result
                .onSuccess { list ->
                    // 页面类型的功能表（分区、新建菜单的开关）：服务端发来就用服务端的（网页 PAGE_KIND_FEATURES）。
                    PageKindTable.update(list.kinds)
                    _state.update { it.copy(pages = list.pages, groups = list.groups, loading = false, loaded = true, error = null) }
                }
                .onFailure { e -> _state.update { it.copy(loading = false, error = errorOf(NotesError.Kind.Load, e)) } }
        }
    }

    /** 登录或退出后身份变了：清掉列表和打开的笔记，按新身份重新读。 */
    fun onIdentityChanged() {
        identity++
        // 旧身份的图标写入不再算数：等着它的打开操作放行，新身份同一篇笔记的选择重新排队。
        iconWrites.values.forEach { it.done.complete(false) }
        iconWrites.clear()
        loadJob?.cancel()
        // 换身份前排着的打开 / 新建不再执行，回收站里进行中的操作也不再写回。
        navigationJob?.cancel()
        navigationJob = null
        linkJob?.cancel()
        trashJob?.cancel()
        trashActionJobs.toList().forEach { it.cancel() }
        // 旧身份选好、还没选去处的导入文件不再导入（窗口随下面的新状态关掉）。
        pendingImport = null
        _state.update { NotesUiState(workspace = it.workspace, collapsed = it.collapsed, expanded = it.expanded, collapsedSections = it.collapsedSections) }
        if (_state.value.workspace == Workspace.Notes) refresh()
    }

    /**
     * 登录、退出之前调用：趁 WebView 还带着旧身份的 Cookie，把打开的笔记存掉。
     * 存不上也继续（草稿留在 WebView 里），只是尽量不丢。
     */
    suspend fun flushBeforeIdentityChange() {
        if (_state.value.open == null) return
        try { flushEditor?.invoke() } catch (e: CancellationException) { throw e } catch (_: Throwable) { }
    }

    private suspend fun flushOpen(): FlushResult =
        try { flushEditor?.invoke() ?: FlushResult(true) } catch (e: CancellationException) { throw e } catch (_: Throwable) { FlushResult(false) }

    // ---- 导航（离开笔记前先让网页保存） ----

    /**
     * 先保存当前笔记再执行 [action]。网页回答"还有没保存的"时留在笔记里，提示"保存失败，草稿已保留"。
     * 草稿已留在 WebView 里、只是暂时存不上（断网、服务器出错，不是冲突）时，提示过一次后再操作一次就放行，
     * 和网页 /app 一样不把人困在笔记里（网页切走时也只是 `void flush()`，草稿留在 localStorage 之后重试）。
     * 保存途中编辑器自己关掉了（笔记已不存在）也放行。同一时刻只跑一个导航，连点不会叠加。
     */
    private fun leaveThen(before: (suspend () -> Unit)? = null, action: suspend () -> Unit) {
        if (navigationJob?.isActive == true) return
        navigationJob = viewModelScope.launch {
            // 先等（例如目标笔记的图标写入），再保存当前笔记：等待期间在旧编辑器里输入的内容也会存上。
            before?.invoke()
            if (_state.value.open != null) {
                val warned = _state.value.notice?.kind == NotesError.Kind.UnsavedDraft
                val result = flushOpen()
                val stillOpen = _state.value.open != null
                if (!result.ok && stillOpen && !(result.draftKept && warned)) {
                    _state.update { it.copy(notice = NotesError(NotesError.Kind.UnsavedDraft)) }
                    return@launch
                }
            }
            action()
        }
    }

    /**
     * 切换工作区。[then] 只在真的切过去之后执行（已在目标工作区时立即执行）；
     * 笔记存不上、留在笔记里，或另一个导航正在进行时不执行。
     */
    fun setWorkspace(workspace: Workspace, then: (() -> Unit)? = null) {
        if (_state.value.workspace == workspace) {
            then?.invoke()
            return
        }
        leaveThen {
            // 网页手机版切到 Note 时总是先显示列表（去掉 page=）。
            _state.update { it.copy(workspace = workspace, open = null, saveState = null, notice = null) }
            then?.invoke()
            if (workspace == Workspace.Notes) refresh()
        }
    }

    /**
     * 打开笔记。[title] / [icon] / [kind] 给不在已读列表里的笔记用（检索结果：列表可能还没读过）；
     * 笔记已不存在时编辑器会报 missing，和网页一样回到列表。
     * [reveal] 是检索结果命中的块（[OpenNote.reveal]）。已经开着的那一篇不重新加载，交给 [revealInEditor] 就地跳过去。
     */
    fun openNote(id: String, title: String? = null, icon: String? = null, kind: PageKind = PageKind.Note, reveal: String? = null) {
        val current = _state.value
        if (current.open?.id == id) {
            val target = reveal?.takeIf { it.isNotBlank() }
            when {
                // 编辑器不在画面上（回到笔记时重新加载）：这次命中的块等那次加载放进地址。
                current.workspace != Workspace.Notes -> _state.update { state ->
                    state.copy(workspace = Workspace.Notes, open = state.open?.let { open -> if (target != null) open.copy(reveal = target) else open })
                }
                target != null -> revealInEditor?.invoke(target)
            }
            return
        }
        val page = current.pages.firstOrNull { it.id == id }
        val open = when {
            page != null -> page.toOpenNote(reveal)
            title != null -> OpenNote(id, title, icon, kind = kind, reveal = reveal)
            else -> return
        }
        // 侧栏刚改了这篇的图标、PUT 还没回来时先等它：编辑器会读到旧版本，下一次保存就会 409。
        val pending = iconWrites[id]
        leaveThen(before = { pending?.done?.await() }) {
            val chosen = if (pending == null) open else {
                _state.value.pages.firstOrNull { it.id == id }?.toOpenNote(reveal) ?: open
            }
            // 冲突后"另存为新笔记"时，开着的编辑器换到了新页面、editor 还是原来那篇的 id：再打开原来那篇时换一个 editor，
            // 否则编辑器（按 editor 区分）不会重新加载，还显示着新页面，检索命中的位置也不会跳过去。
            val target = if (_state.value.open?.editor == chosen.editor) chosen.copy(editor = "${chosen.id}#${java.util.UUID.randomUUID()}") else chosen
            _state.update { it.copy(workspace = Workspace.Notes, open = target, saveState = null, notice = null) }
        }
    }

    private var linkJob: Job? = null

    /**
     * 从回答里打开笔记（项目参考笔记、提案的 Open / Open the note），对应网页 page.tsx 的 openNoteFromLink：
     * 马上切到笔记页（列表或读取中），再刷新列表，笔记出现了就打开；没找到（已删除、移到回收站、读取失败）就留在列表上。
     */
    fun openNoteFromLink(id: String) {
        linkJob?.cancel()
        val current = _state.value
        if (current.workspace == Workspace.Notes && current.open?.id == id) return
        leaveThen {
            _state.update { it.copy(workspace = Workspace.Notes, open = null, saveState = null, notice = null) }
            refresh()
            linkJob = viewModelScope.launch {
                // 等最新的一次刷新结束（中途被新的刷新取代时等新的那次）。
                while (true) {
                    val job = loadJob ?: break
                    job.join()
                    if (loadJob === job) break
                }
                val now = _state.value
                // 等待期间用户去了别处（回到聊天、打开了别的笔记）就不再打开。
                if (now.workspace == Workspace.Notes && now.open == null && now.pages.any { it.id == id }) openNote(id)
            }
        }
    }

    /** 回到笔记列表（顶栏的"<"、返回键）。 */
    fun closeNote() {
        if (_state.value.open == null) return
        leaveThen {
            _state.update { it.copy(open = null, saveState = null, notice = null) }
            refresh()
        }
    }

    /**
     * 新建一篇 [kind] 的空白页面并打开（网页 createNote）。[parentId] 指定时在那一篇里新建子页面（网页 "Add a page inside"），并展开父页面；
     * 否则建在 [groupId] 项目的最上层（项目的 "+"，折叠着就展开），都没有时建在那个类型的分区里（折叠着就展开）。
     */
    fun createNote(parentId: String? = null, kind: PageKind = PageKind.Note, groupId: String? = null) {
        if (_state.value.busy) return
        leaveThen {
            _state.update { it.copy(busy = true, error = null) }
            try {
                val page = backend.createNote(parentId, kind, if (parentId == null) groupId else null)
                // 换身份会取消这个任务，走到这里一定还是同一个身份。
                mutations++
                if (parentId != null) expand(parentId)
                else if (groupId != null) { if (groupId in _state.value.collapsed) toggleGroup(groupId) }
                else openSection(_state.value.sectionKindOf(page))
                _state.update {
                    it.copy(
                        workspace = Workspace.Notes,
                        pages = upsert(it.pages, page),
                        open = page.toOpenNote(),
                        saveState = null, notice = null, busy = false,
                    )
                }
            } catch (e: CancellationException) {
                _state.update { it.copy(busy = false) }
                throw e
            } catch (e: Throwable) {
                _state.update { it.copy(busy = false, error = errorOf(NotesError.Kind.Create, e)) }
            }
        }
    }

    /**
     * 点掉笔记顶栏下面的提示条。提示条显示的是 notice，没有时显示 error（开着笔记时导入失败的原因），
     * 所以点掉的是正在显示的那一条。
     */
    fun dismissNotice() = _state.update { if (it.notice != null) it.copy(notice = null) else it.copy(error = null) }

    // ---- 网页编辑器发来的消息 ----

    // 下面的 [editor] 是发消息的编辑器（[OpenNote.editor]）。它就是打开着的编辑器时，换成它现在显示的页面 id。
    private fun pageOf(editor: String): String = _state.value.open?.takeIf { it.editor == editor }?.id ?: editor

    /**
     * 编辑器读好了页面 [pageId]。和打开着的不是同一页时，是冲突后"另存为新笔记"换到了副本：
     * 打开着的笔记换成副本（WebView 不重新加载），原来那篇的列表项不动，重读列表把副本加进来。
     * [kind] 是网页读到的页面类型（旧网页不发时是 null，保留已知的类型）。
     */
    fun onEditorReady(editor: String, pageId: String, title: String, icon: String?, kind: PageKind? = null, version: Int? = null) {
        val open = _state.value.open
        if (open != null && open.editor == editor && open.id != pageId) {
            _state.update { it.copy(open = open.copy(id = pageId, title = title, icon = icon, kind = kind ?: open.kind), saveState = null) }
            refresh()
            return
        }
        // 网页读到的类型，打开着的笔记和列表项两边都用（列表是旧服务端读的、没带类型时，顶栏、菜单、图标都以这里为准）。
        if (kind != null && open != null && open.editor == editor && open.id == pageId) {
            _state.update { state ->
                state.copy(
                    open = state.open?.takeIf { it.editor == editor && it.id == pageId }?.copy(kind = kind) ?: state.open,
                    pages = state.pages.map { if (it.id == pageId) it.copy(kind = kind) else it },
                )
            }
        }
        onEditorMeta(editor, title, icon, version)
    }

    fun onEditorMeta(editor: String, title: String, icon: String?, version: Int? = null) {
        val id = pageOf(editor)
        _state.update { state ->
            state.copy(
                open = state.open?.takeIf { it.id == id }?.copy(title = title, icon = icon) ?: state.open,
                pages = state.pages.map {
                    if (it.id == id) {
                        it.copy(
                            title = title,
                            icon = icon,
                            version = version?.takeIf { v -> v > it.version } ?: it.version,
                        )
                    } else {
                        it
                    }
                },
            )
        }
    }

    fun onEditorSaveState(editor: String, saveState: String) {
        _state.update { if (it.open?.editor == editor) it.copy(saveState = saveState) else it }
    }

    /** 笔记不存在、不属于自己、已在回收站或保存时发现已被删：直接关掉（草稿留在 WebView 里），刷新列表。 */
    fun onEditorMissing(editor: String) {
        if (_state.value.open?.editor != editor) return
        _state.update { it.copy(open = null, saveState = null) }
        refresh()
    }

    /** 编辑器里把笔记移到了回收站。 */
    fun onEditorTrashed(editor: String) {
        val id = pageOf(editor)
        mutations++
        _state.update { state ->
            state.copy(
                pages = state.pages.filterNot { it.id == id },
                open = state.open?.takeIf { it.id != id },
                saveState = if (state.open?.id == id) null else state.saveState,
            )
        }
    }

    /**
     * 别处已经把这些页面移进了回收站（聊天里撤销 AI 新建的页面，子页面一起，网页 notefable:pages-trashed）：
     * 从列表里去掉，打开着的是其中一篇就关掉（不再保存：页面已在回收站里）。
     */
    fun onPagesTrashed(ids: Collection<String>) {
        if (ids.isEmpty()) return
        val removed = ids.toSet()
        mutations++
        _state.update { state ->
            val closing = state.open?.id in removed
            state.copy(
                pages = state.pages.filterNot { it.id in removed },
                open = state.open?.takeIf { !closing },
                saveState = if (closing) null else state.saveState,
            )
        }
        notifyPagesTrashed?.invoke(removed)
    }

    // ---- 移到回收站 ----

    /** 网页的确认框"移到回收站"。打开着的那篇先保存，保存不了就不移（网页同样的提示）。成功返回 true。 */
    suspend fun trashNote(id: String): Boolean {
        if (_state.value.busy) return false
        val owner = identity
        _state.update { it.copy(busy = true, error = null) }
        try {
            // 子页面也一起移进回收站：打开着的是它或它的子页面时，先保存。
            val subtree = _state.value.descendants(id) + id
            if (_state.value.open?.id in subtree) {
                if (!flushOpen().ok) {
                    if (owner == identity) _state.update { it.copy(busy = false, error = NotesError(NotesError.Kind.TrashUnsaved)) }
                    return false
                }
            }
            val removed = backend.trashNote(id).toSet() + id
            return commit(owner) {
                _state.update { state ->
                    val closing = state.open?.id in removed
                    state.copy(
                        busy = false,
                        pages = state.pages.filterNot { it.id in removed },
                        open = state.open?.takeIf { !closing },
                        saveState = if (closing) null else state.saveState,
                    )
                }
                notifyPagesTrashed?.invoke(removed)
            }
        } catch (e: CancellationException) {
            if (owner == identity) _state.update { it.copy(busy = false) }
            throw e
        } catch (e: Throwable) {
            if (owner == identity) _state.update { it.copy(busy = false, error = errorOf(NotesError.Kind.Trash, e)) }
            return false
        }
    }

    // ---- 项目（分组）：失败时不改列表，只在对话框里显示原因 ----

    /** [run] 发请求，返回要写进界面的改动和结果；身份在请求期间换了（登录、退出）的话什么都不写，返回 null。 */
    private suspend fun <T> groupAction(run: suspend () -> Pair<() -> Unit, T>): T? {
        val owner = identity
        _state.update { it.copy(groupError = null) }
        return try {
            val (apply, value) = run()
            if (commit(owner, apply)) value else null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (owner == identity) _state.update { it.copy(groupError = errorOf(NotesError.Kind.Group, e)) }
            null
        }
    }

    fun clearGroupError() = _state.update { it.copy(groupError = null) }

    suspend fun createGroup(name: String): NoteGroupSummary? = groupAction {
        val group = backend.createGroup(name)
        Pair({ _state.update { it.copy(groups = it.groups.filter { g -> g.id != group.id } + group) } }, group)
    }

    suspend fun renameGroup(id: String, name: String): Boolean = groupAction {
        val group = backend.renameGroup(id, name)
        Pair({ _state.update { s -> s.copy(groups = s.groups.map { if (it.id == id) it.copy(name = group.name) else it }) } }, true)
    } ?: false

    /** 从侧栏或收藏栏直接重命名页面；当前正打开它时先冲洗未保存草稿，再通知常驻 WebView 同步标题和版本号。 */
    suspend fun renamePage(pageId: String, title: String): Boolean {
        val normalized = title.replace(Regex("\\r?\\n"), " ").trim()
        if (normalized.isEmpty()) return false
        val owner = identity
        _state.update { it.copy(groupError = null) }
        if (_state.value.open?.id == pageId && !flushOpen().ok) {
            if (owner == identity) _state.update { it.copy(groupError = NotesError(NotesError.Kind.UnsavedDraft)) }
            return false
        }
        if (owner != identity) return false
        val version = _state.value.pages.firstOrNull { it.id == pageId }?.version ?: 0
        return groupAction {
            val written = backend.renameNote(pageId, normalized, version)
            val page = written.page
            Pair({
                _state.update { s ->
                    s.copy(
                        pages = s.pages.map {
                            if (it.id == pageId) {
                                it.copy(
                                    title = page.title,
                                    version = page.version,
                                    updatedAt = page.updatedAt.ifBlank { it.updatedAt },
                                )
                            } else {
                                it
                            }
                        },
                        open = s.open?.let { if (it.id == pageId) it.copy(title = page.title) else it },
                    )
                }
                written.json?.let { json -> notifyPageUpdated?.invoke(pageId, json) }
                refreshBacklinks?.invoke()
            }, true)
        } ?: false
    }

    /** 项目删掉后，里面的笔记保留，变成未分组。 */
    suspend fun deleteGroup(id: String): Boolean = groupAction {
        backend.deleteGroup(id)
        Pair({
            _state.update { s ->
                s.copy(
                    groups = s.groups.filterNot { it.id == id },
                    pages = s.pages.map { if (it.groupId == id) it.copy(groupId = null) else it },
                )
            }
        }, true)
    } ?: false

    /** 移进项目（null 是移出）。子页面会脱离父页面，成为项目的最上层，子孙一起移过去。 */
    suspend fun moveNote(pageId: String, groupId: String?): Boolean = groupAction {
        val moved = backend.moveNote(pageId, groupId).toSet() + pageId
        Pair({ _state.update { s -> s.copy(pages = movedToGroup(s.pages, pageId, moved, groupId)) } }, true)
    } ?: false

    /** 移到另一页面之下（网页 Move to 的页面）；子孙一起移动，项目跟随新的父页面。成功后展开新的父页面。 */
    suspend fun moveToPage(pageId: String, parentId: String): Boolean = groupAction {
        val moved = backend.moveToPage(pageId, parentId).associateBy { it.id }
        Pair({
            _state.update { s ->
                s.copy(pages = s.pages.map { page -> moved[page.id]?.let { page.copy(parentId = it.parentId, groupId = it.groupId) } ?: page })
            }
            expand(parentId)
        }, true)
    } ?: false

    /** 收藏、显示设置：服务端回来的这一篇的元数据写进列表；打开着的笔记还要交给编辑器。 */
    private fun applyMeta(page: NotePageSummary) {
        _state.update { s ->
            s.copy(pages = s.pages.map {
                if (it.id == page.id) it.copy(favoritedAt = page.favoritedAt, fullWidth = page.fullWidth, smallText = page.smallText, font = page.font, locked = page.locked) else it
            })
        }
        if (_state.value.open?.id == page.id) pushPageSettings?.invoke(page) else notifyPageSettings?.invoke(page)
    }

    /** 每篇页面的收藏、设置一次只发一个请求：连点几个开关时，后发的请求后回来，旧的应答不会盖掉新的设置。 */
    private val metaLocks = HashMap<String, kotlinx.coroutines.sync.Mutex>()

    private suspend fun <T> serialMeta(pageId: String, run: suspend () -> T): T =
        metaLocks.getOrPut(pageId) { kotlinx.coroutines.sync.Mutex() }.withLock { run() }

    suspend fun setFavorite(pageId: String, favorite: Boolean): Boolean = serialMeta(pageId) {
        groupAction {
            val page = backend.setFavorite(pageId, favorite)
            Pair({ applyMeta(page) }, true)
        } ?: false
    }

    suspend fun updateSettings(pageId: String, settings: NotePageSettings): Boolean = serialMeta(pageId) {
        val owner = identity
        if (settings.locked == true && _state.value.open?.id == pageId && !flushOpen().ok) {
            if (owner == identity) _state.update { it.copy(notice = NotesError(NotesError.Kind.UnsavedDraft)) }
            return@serialMeta false
        }
        groupAction {
            val page = backend.updateSettings(pageId, settings)
            Pair({ applyMeta(page) }, true)
        } ?: false
    }

    suspend fun loadShare(pageId: String): com.kakumine.notefable.data.NoteShareState = backend.getShare(pageId)

    suspend fun updateShare(pageId: String, patch: com.kakumine.notefable.data.NoteSharePatch): com.kakumine.notefable.data.NoteShareState {
        val owner = identity
        if (patch.enabled == true) {
            val includeSubpages = patch.includeSubpages ?: true
            val scope = if (includeSubpages) _state.value.descendants(pageId) + pageId else setOf(pageId)
            if (_state.value.open?.id in scope && !flushOpen().ok) {
                throw IllegalStateException("Failed to update share settings.")
            }
        }
        val result = backend.updateShare(pageId, patch)
        val updated = result.page
        if (updated != null && owner == identity) {
            _state.update { s ->
                s.copy(pages = s.pages.map { if (it.id == updated.id) it.copy(shareEnabled = updated.shareEnabled, shareExpiresAt = updated.shareExpiresAt) else it })
            }
        }
        return result.share
    }

    /**
     * 复制这一篇和子页面（网页 Duplicate），复制完打开复制件。服务端复制的是已保存的内容，
     * 所以打开着的是它或它的子页面时先保存，保存不了就不复制。
     */
    fun duplicate(pageId: String) {
        if (_state.value.busy) return
        val owner = identity
        viewModelScope.launch {
            _state.update { it.copy(busy = true, groupError = null) }
            try {
                val subtree = _state.value.descendants(pageId) + pageId
                if (_state.value.open?.id in subtree && !flushOpen().ok) {
                    if (owner == identity) _state.update { it.copy(busy = false, notice = NotesError(NotesError.Kind.UnsavedDraft)) }
                    return@launch
                }
                val result = backend.duplicate(pageId)
                val applied = commit(owner) {
                    _state.update { s ->
                        val merged = s.pages.filterNot { page -> result.pages.any { it.id == page.id } } + result.pages
                        s.copy(busy = false, pages = applyOrder(merged, result.order))
                    }
                }
                if (applied) {
                    _state.update { it.copy(busy = false) }
                    openNote(result.page.id, result.page.title, result.page.icon, result.page.kind)
                }
            } catch (e: CancellationException) {
                if (owner == identity) _state.update { it.copy(busy = false) }
                throw e
            } catch (e: Throwable) {
                if (owner == identity) _state.update { it.copy(busy = false, groupError = errorOf(NotesError.Kind.Group, e)) }
            }
        }
    }

    // ---- 画成图（#153） ----

    /**
     * 笔记"…"的「画成图」之前：服务端读的是已保存的内容，打开着的是这篇时先让编辑器存上。
     * 存不上就在顶栏下面提示"保存失败，草稿已保留"并返回 false（不开始）。不用 [NotesUiState.busy]：画图期间列表照常能用。
     */
    suspend fun saveBeforeDiagram(pageId: String): Boolean {
        val owner = identity
        if (_state.value.open?.id != pageId) return true
        val saved = flushOpen().ok
        if (owner != identity) return false
        if (!saved) {
            if (_state.value.open?.id == pageId) {
                _state.update { it.copy(notice = NotesError(NotesError.Kind.UnsavedDraft)) }
            }
            return false
        }
        // 刚才没存上的提示已经不对了。
        _state.update { if (it.notice?.kind == NotesError.Kind.UnsavedDraft) it.copy(notice = null) else it }
        return true
    }

    /**
     * 打开「画成图」建好的白板（窗口里的"打开白板"）：列表可能还没刷新到它，先放进列表；是笔记的子页面就展开那篇
     * （和"添加子页面"一样），再打开。
     */
    fun openCreatedPage(page: NotePageSummary) {
        mutations++
        _state.update { it.copy(pages = upsert(it.pages, page)) }
        page.parentId?.let(::expand)
        openNote(page.id, page.title, page.icon, page.kind)
    }

    // ---- AI 生成幻灯片的向导（#150） ----

    private var slidesWizardRequests = 0

    /** 从一个入口打开向导：画面上有编辑器时盖在它上面，否则开全屏向导画面。要读的笔记正开着时网页自己先保存。 */
    fun openSlidesWizard(source: SlidesWizardSource) {
        val request = ++slidesWizardRequests
        _state.update { it.copy(slidesWizard = SlidesWizardUi(source, request, editor = it.visibleEditor)) }
    }

    /** 打开的脚本说网页里出来了。 */
    fun onSlidesWizardShown(request: Int) = _state.update { state ->
        val wizard = state.slidesWizard?.takeIf { it.request == request } ?: return@update state
        state.copy(slidesWizard = wizard.copy(shown = true))
    }

    /**
     * 网页的 `slidesWizard` open 消息。[editor] 是发消息时画面上的编辑器（全屏向导画面是 null）。
     * App 没打开过时是笔记 AI 面板里的「生成幻灯片」：记成盖在这个编辑器上、以这一篇为材料。
     */
    fun onSlidesWizardOpened(editor: String?) {
        val state = _state.value
        val wizard = state.slidesWizard
        if (wizard != null) {
            if (wizard.editor == editor) onSlidesWizardShown(wizard.request)
            return
        }
        val open = state.open?.takeIf { editor != null && state.visibleEditor == editor } ?: return
        val request = ++slidesWizardRequests
        _state.update { it.copy(slidesWizard = SlidesWizardUi(SlidesWizardSource.Note(open.id), request, editor = editor, shown = true)) }
    }

    /** 网页的 closed 消息。还没出来的那一次不动：这是上一次被藏起来时晚到的。 */
    fun onSlidesWizardClosed() = _state.update { if (it.slidesWizard?.shown == true) it.copy(slidesWizard = null) else it }

    /** App 这边关掉向导（返回键、打开了幻灯片、打不开）；[request] 指定时只关那一次。 */
    fun dismissSlidesWizard(request: Int? = null) = _state.update {
        if (request == null || it.slidesWizard?.request == request) it.copy(slidesWizard = null) else it
    }

    /**
     * 外部链接、系统分享要换画面：关掉全屏向导。盖在编辑器上的不在这里关：离开了编辑器它自然不算数，
     * 笔记存不上、留在编辑器里时向导还在网页里。
     */
    fun dismissFullScreenSlidesWizard() = _state.update {
        if (it.slidesWizard != null && it.slidesWizard.editor == null) it.copy(slidesWizard = null) else it
    }

    /** 画面上的编辑器换了：盖在别的编辑器上的向导、有了编辑器时的全屏向导画面都不再算数。 */
    fun dropStaleSlidesWizard() = _state.update {
        if (it.slidesWizard != null && it.slidesWizard.editor != it.visibleEditor) it.copy(slidesWizard = null) else it
    }

    // ---- Markdown 导出 / 导入（网页 use-note-pages.ts 的 exportPage / importMarkdown） ----

    /** 一次只导出一篇（网页的 actionBusy）。 */
    private var exporting = false

    /** 读好、等用户选保存位置的导出内容（页面 id → Markdown）。选择器开着时 Activity 重建也还在。 */
    private var heldExport: Pair<String, String>? = null

    /**
     * 导出这一篇的 Markdown（页面菜单的 "Export Markdown"）。服务端导出的是已保存的内容，所以打开着的是它时先让编辑器保存，
     * 存不上就不导出（网页："Resolve the unsaved draft before exporting this page."）。
     * 成功返回文件名和内容（内容同时留在 [takeExport] 里，等界面选好保存位置再写）；失败时原因显示在笔记顶栏下面，返回 null。
     */
    suspend fun exportNote(id: String): ExportedNote? {
        if (exporting) return null
        exporting = true
        val owner = identity
        _state.update { it.copy(notice = null) }
        try {
            if (_state.value.open?.id == id && !flushOpen().ok) {
                if (owner == identity) _state.update { it.copy(notice = NotesError(NotesError.Kind.ExportUnsaved)) }
                return null
            }
            val exported = backend.exportNote(id)
            if (owner != identity) return null
            heldExport = id to exported.markdown
            return exported.copy(fileName = exported.fileName.ifBlank { NoteImport.FALLBACK_EXPORT_NAME })
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (owner == identity) _state.update { it.copy(notice = errorOf(NotesError.Kind.Export, e)) }
            return null
        } finally {
            exporting = false
        }
    }

    /** 取走 [exportNote] 留下的内容；没有（进程被系统回收后重建）时返回 null，界面用 [exportedMarkdown] 重新读。 */
    fun takeExport(id: String): String? = heldExport?.takeIf { it.first == id }?.second.also { heldExport = null }

    /** 要写进文件的内容：[held]（刚取走的）优先，没有就重新读一次。 */
    suspend fun exportedMarkdown(id: String, held: String?): String = held ?: backend.exportNote(id).markdown

    /** 选好的位置写不进去（或没有能选保存位置的 App）：和读取失败同一句提示。 */
    fun exportFailed() = _state.update { it.copy(notice = NotesError(NotesError.Kind.Export)) }

    /** 选好了、等用户选导入到哪里的文件（[NotesUiState.importTarget] 为 true 期间）。 */
    private var pendingImport: List<ImportCandidate>? = null

    /**
     * 文件选择器选好了文件（网页 page.tsx 的 importMarkdownFiles）。一个项目都没有时和以前一样直接导入（不进项目）；
     * 有项目时先在本机查个数、扩展名和大小，不合规定只显示原因、不出窗口，通过了才打开 "Import to" 窗口让用户选放哪里。
     */
    fun pickedForImport(files: List<ImportCandidate>) {
        // 列表（含项目）还没读到时不知道有没有项目：不直接导入到"无项目"，先重新读列表（读不到会显示加载失败），读到后再导入。
        if (!_state.value.loaded) {
            refresh()
            return
        }
        if (_state.value.groups.isEmpty()) {
            importMarkdown(files)
            return
        }
        if (files.isEmpty() || _state.value.busy || !checkImport(files)) return
        pendingImport = files
        _state.update { it.copy(importTarget = true) }
    }

    /** "Import to" 窗口里选了一项：[groupId] 是项目，null 是 "No project"。选的那一刻开始导入。 */
    fun chooseImportTarget(groupId: String?) {
        val files = pendingImport
        cancelImportTarget()
        if (files != null) importMarkdown(files, groupId)
    }

    /** 关掉 "Import to" 窗口，不导入。 */
    fun cancelImportTarget() {
        pendingImport = null
        _state.update { it.copy(importTarget = false) }
    }

    /** 读之前按选择器报的大小查（网页 checkImportFiles）：有问题就显示原因并返回 false，没问题清掉之前的提示。 */
    private fun checkImport(files: List<ImportCandidate>): Boolean {
        val problem = NoteImport.check(files.map { NoteImport.Entry(it.name, it.size ?: 0) })
        _state.update { it.copy(error = problem?.let(::importError)) }
        return problem == null
    }

    /**
     * 导入 Markdown 文件（"Import Markdown"）。先按网页同样的规则查个数、扩展名和大小，不合规定就只显示原因、什么都不发；
     * 然后读出全文发给服务端（[groupId] 是放进哪个项目，null 不进项目），新建的笔记放进列表，并打开第一篇
     * （网页 use-note-pages.ts 的 importMarkdown）。期间和新建一样禁用列表操作（[NotesUiState.busy]）。
     */
    fun importMarkdown(files: List<ImportCandidate>, groupId: String? = null) {
        if (files.isEmpty() || _state.value.busy) return
        if (!checkImport(files)) return
        val owner = identity
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val payload = files.map { ImportMarkdownFile(it.name, it.read()) }
                // 选择器报不出大小的文件，读完按实际的字节数再查一遍。
                // 服务端量的是 JSON 请求体，转义后会比文件大：和网页一样按要发送的样子再量一次。
                val problem = NoteImport.check(payload.map { NoteImport.Entry(it.name, it.markdown.toByteArray(Charsets.UTF_8).size.toLong()) })
                    ?: NoteImport.Problem.TooLarge.takeIf { NoteImport.requestTooLarge(payload, groupId) }
                if (problem != null) {
                    if (owner == identity) _state.update { it.copy(busy = false, error = importError(problem)) }
                    return@launch
                }
                // 读文件期间（云盘可能很慢）换了账号：请求会带着新账号的 cookie 发出去，把旧账号选的文件导进新账号。不发。
                if (owner != identity) return@launch
                val created = backend.importMarkdown(payload, groupId)
                val applied = commit(owner) {
                    _state.update { s -> s.copy(busy = false, pages = created.fold(s.pages) { pages, page -> upsert(pages, page) }) }
                }
                if (applied) created.firstOrNull()?.let { openNote(it.id, it.title, it.icon, it.kind) }
            } catch (e: CancellationException) {
                if (owner == identity) _state.update { it.copy(busy = false) }
                throw e
            } catch (e: Throwable) {
                if (owner == identity) _state.update { it.copy(busy = false, error = errorOf(NotesError.Kind.Import, e)) }
            }
        }
    }

    private fun importError(problem: NoteImport.Problem) = NotesError(
        when (problem) {
            NoteImport.Problem.TooMany -> NotesError.Kind.ImportTooMany
            NoteImport.Problem.BadType -> NotesError.Kind.ImportBadType
            NoteImport.Problem.FileTooLarge -> NotesError.Kind.ImportFileTooLarge
            NoteImport.Problem.TooLarge -> NotesError.Kind.ImportTooLarge
        },
    )

    fun toggleExpanded(id: String) {
        val open = _state.value.isExpanded(id)
        val next = if (open) _state.value.expanded - id else _state.value.expanded + id
        prefs.expandedPages = next
        _state.update { it.copy(expanded = next) }
    }

    private fun expand(id: String) {
        if (id in _state.value.expanded) return
        val next = _state.value.expanded + id
        prefs.expandedPages = next
        _state.update { it.copy(expanded = next) }
    }

    /** 一篇笔记正在写的图标（[changeIcon]）。[desired] 是最后选的值，[dirty] 表示还有没发出去的选择。 */
    private class IconWrite(var desired: String?) {
        var dirty = true
        val done = CompletableDeferred<Boolean>()
    }

    /** 每篇笔记同一时刻只有一个 PUT：中途再选的图标合并成下一次请求，响应按顺序写进列表，版本号不会倒退。 */
    private val iconWrites = HashMap<String, IconWrite>()

    /**
     * 侧栏里改笔记图标（网页 use-note-pages.ts 的 changeIcon，只用于没打开的笔记）。成功后列表换成服务端的图标和版本号；
     * 失败返回 false 并在侧栏显示"Could not change the icon. Try again."。
     * 同一篇的请求串行：前一个还没回来时只记下最新的选择，等它回来再发（中间的选择不发）；所有调用者拿到整串的结果。
     * 只在主线程调用。
     */
    suspend fun changeIcon(pageId: String, icon: String?): Boolean {
        _state.update { it.copy(iconError = false) }
        iconWrites[pageId]?.let { pending ->
            pending.desired = icon
            pending.dirty = true
            return pending.done.await()
        }
        val owner = identity
        val write = IconWrite(icon)
        iconWrites[pageId] = write
        var ok = false
        try {
            while (write.dirty) {
                write.dirty = false
                val written = noteIcons.setNoteIconWithPage(pageId, write.desired)
                val page = written.page
                val applied = commit(owner) {
                    _state.update { s -> s.copy(pages = s.pages.map { if (it.id == pageId) it.copy(icon = page.icon, version = page.version) else it }) }
                }
                if (!applied) return false
                written.json?.let { json -> notifyPageUpdated?.invoke(pageId, json) }
                refreshBacklinks?.invoke()
            }
            ok = true
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (owner == identity) _state.update { it.copy(iconError = true) }
            return false
        } finally {
            if (iconWrites[pageId] === write) iconWrites.remove(pageId)
            write.done.complete(ok)
        }
    }

    /** 抽屉重新打开时清掉上次改图标失败的提示（网页侧栏关掉后组件卸载，iconError 跟着没了）。 */
    fun dismissIconError() = _state.update { it.copy(iconError = false) }

    // ---- 拖动排序（网页 notes-sidebar / notes-home 的 ReorderRowButton） ----

    /** 拖到另一篇笔记前 / 后（POST /api/pages/reorder，目标在别的项目里时服务端也改项目）。同一时间只做一次，和网页一样上一次没完就报错。 */
    fun reorder(move: ReorderMove) {
        if (_state.value.reorderBusy) {
            _state.update { it.copy(reorderError = ReorderFailure(move.id, wait = true)) }
            return
        }
        if (move.id == move.targetId || move.id in _state.value.moveBusy) return
        val owner = identity
        _state.update { it.copy(reorderBusy = true, moveBusy = it.moveBusy + move.id, reorderError = null) }
        viewModelScope.launch {
            val result = try {
                Result.success(backend.reorderNote(move.id, move.targetId, move.after))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Result.failure(e)
            }
            if (owner != identity) return@launch
            result.onSuccess { updates -> commit(owner) { _state.update { it.copy(pages = applyOrder(it.pages, updates)) } } }
            _state.update {
                it.copy(
                    reorderBusy = false,
                    moveBusy = it.moveBusy - move.id,
                    reorderError = result.exceptionOrNull()?.let { e -> ReorderFailure(move.id, serverDetail(e)) },
                )
            }
        }
    }

    /**
     * 拖到项目标题或 Notes 标签上（网页 onMoveGroup）：移进该项目（null = 无项目），走普通的移动接口，不受排序锁限制，
     * 只锁被拖的这一篇。侧栏里移进项目后展开它（网页 notes-sidebar 的 setCollapsed）。
     */
    fun dropIntoGroup(id: String, groupId: String?) {
        if (id in _state.value.moveBusy) return
        val current = _state.value.pages.firstOrNull { it.id == id }
        if (current != null && current.groupId == groupId && current.parentId == null) return
        val owner = identity
        _state.update { it.copy(moveBusy = it.moveBusy + id, reorderError = null) }
        viewModelScope.launch {
            var moved: Set<String> = setOf(id)
            val error = try {
                moved = backend.moveNote(id, groupId).toSet() + id
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                e
            }
            if (owner != identity) return@launch
            if (error == null) {
                commit(owner) { _state.update { s -> s.copy(pages = movedToGroup(s.pages, id, moved, groupId)) } }
                if (groupId != null && groupId in _state.value.collapsed) toggleGroup(groupId)
                // 移出项目的页面回到自己类型的分区：分区折叠着就展开（网页 setSectionOpen）。
                if (groupId == null) _state.value.pages.firstOrNull { it.id == id }?.let { openSection(_state.value.sectionKindOf(it)) }
            }
            _state.update {
                it.copy(moveBusy = it.moveBusy - id, reorderError = error?.let { e -> ReorderFailure(id, serverDetail(e)) })
            }
        }
    }

    fun dismissReorderError() = _state.update { it.copy(reorderError = null) }

    fun toggleGroup(id: String) {
        val next = _state.value.collapsed.let { if (id in it) it - id else it + id }
        prefs.collapsedGroups = next
        _state.update { it.copy(collapsed = next) }
    }

    /** 折叠 / 展开分区（网页 notes-sidebar 的分区标题）。 */
    fun toggleSection(kind: PageKind) = setSectionCollapsed(kind, kind !in _state.value.collapsedSections)

    private fun openSection(kind: PageKind) {
        if (kind in _state.value.collapsedSections) setSectionCollapsed(kind, false)
    }

    private fun setSectionCollapsed(kind: PageKind, collapsed: Boolean) {
        val next = _state.value.collapsedSections.let { if (collapsed) it + kind else it - kind }
        prefs.collapsedSections = next.mapTo(HashSet()) { it.wire }
        _state.update { it.copy(collapsedSections = next) }
    }

    // ---- 回收站 ----

    fun openTrash() {
        _state.update { it.copy(trash = TrashUiState()) }
        loadTrash()
    }

    fun closeTrash() {
        trashJob?.cancel()
        _state.update { it.copy(trash = null) }
    }

    fun loadTrash() {
        trashJob?.cancel()
        trashJob = viewModelScope.launch {
            updateTrash { it.copy(items = null, loadError = null) }
            val result = runCatching { backend.trash() }
            ensureActive()
            result
                .onSuccess { items -> updateTrash { it.copy(items = items, loadError = null) } }
                .onFailure { e -> updateTrash { it.copy(loadError = errorOf(NotesError.Kind.TrashLoad, e)) } }
        }
    }

    fun confirmEmptyTrash(show: Boolean) = updateTrash { it.copy(confirmAll = show) }
    fun confirmDeleteForever(id: String?) = updateTrash { it.copy(confirmId = id) }

    fun restore(id: String) = trashAction {
        // 一起移进回收站的子页面也回来。
        val restored = backend.restoreNote(id)
        val apply: () -> Unit = {
            _state.update { s ->
                s.copy(
                    pages = restored.fold(s.pages) { pages, page -> upsert(pages, page) },
                    trash = s.trash?.copy(items = s.trash.items?.filterNot { it.id == id }),
                )
            }
            refreshBacklinks?.invoke()
        }
        apply
    }

    fun deleteForever(id: String) = trashAction {
        val removed = backend.deleteForever(id).toSet() + id
        val apply: () -> Unit = { updateTrash { t -> t.copy(confirmId = null, items = t.items?.filterNot { it.id in removed }) } }
        apply
    }

    fun emptyTrash() = trashAction {
        // 只删确认时看到的（最新一条之前扔的），确认期间别处新扔的不删。
        val newest = _state.value.trash?.items?.firstOrNull()?.deletedAt
        if (newest == null) null else {
            backend.emptyTrash(newest)
            val apply: () -> Unit = { updateTrash { it.copy(confirmAll = false, items = emptyList()) } }
            apply
        }
    }

    /**
     * 回收站的一次操作。[work] 发请求，返回要写进界面的改动（null 表示什么都没做）；
     * 身份在请求期间换了（登录、退出）就丢掉结果，换身份时这些任务也会被取消。
     */
    private fun trashAction(work: suspend () -> (() -> Unit)?) {
        val trash = _state.value.trash ?: return
        if (trash.busy) return
        val owner = identity
        val job = viewModelScope.launch {
            updateTrash { it.copy(busy = true, error = null) }
            try {
                work()?.let { commit(owner, it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                if (owner == identity) updateTrash { it.copy(error = errorOf(NotesError.Kind.TrashAction, e)) }
            } finally {
                if (owner == identity) updateTrash { it.copy(busy = false) }
            }
        }
        trashActionJobs += job
        job.invokeOnCompletion { trashActionJobs -= job }
    }

    private fun updateTrash(transform: (TrashUiState) -> TrashUiState) {
        _state.update { s -> s.trash?.let { s.copy(trash = transform(it)) } ?: s }
    }

    private fun errorOf(kind: NotesError.Kind, error: Throwable) = NotesError(kind, serverDetail(error))

    private fun serverDetail(error: Throwable): String? = (error as? ApiException)?.message?.takeIf { it.isNotBlank() && !it.startsWith("HTTP ") }

    companion object {
        /** 加入或替换一条，再按服务端的顺序（position 升序、新建的在前）排。 */
        internal fun upsert(pages: List<NotePageSummary>, page: NotePageSummary): List<NotePageSummary> =
            (pages.filterNot { it.id == page.id } + page)
                .sortedWith(compareBy<NotePageSummary> { it.position }.thenByDescending { it.createdAt })

        /** 排序结果写进列表：换成新的 position（被移动的那篇还换项目），再按服务端的顺序排（网页 byPosition）。 */
        internal fun applyOrder(pages: List<NotePageSummary>, updates: List<com.kakumine.notefable.data.NoteOrderUpdate>): List<NotePageSummary> {
            val byId = updates.associateBy { it.id }
            return pages.map { page ->
                val update = byId[page.id] ?: return@map page
                var next = page.copy(position = update.position)
                if (update.movedGroup) next = next.copy(groupId = update.groupId)
                if (update.movedParent) next = next.copy(parentId = update.parentId)
                next
            }.sortedWith(compareBy<NotePageSummary> { it.position }.thenByDescending { it.createdAt }.thenByDescending { it.id })
        }

        /** 移进项目：这一篇脱离父页面，它和子孙都换成新的项目。 */
        internal fun movedToGroup(pages: List<NotePageSummary>, id: String, moved: Set<String>, groupId: String?): List<NotePageSummary> =
            pages.map { page ->
                when {
                    page.id == id -> page.copy(groupId = groupId, parentId = null)
                    page.id in moved -> page.copy(groupId = groupId)
                    else -> page
                }
            }

        val Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                val app = extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as NoteFableApp
                return NotesViewModel(app.api, PrefsNotesPrefs(app), com.kakumine.notefable.data.NoteIconApi(app.api.http)) as T
            }
        }
    }
}
