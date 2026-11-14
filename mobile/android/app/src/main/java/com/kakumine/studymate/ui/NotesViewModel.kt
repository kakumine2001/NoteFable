package com.kakumine.studymate.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.kakumine.studymate.StudyMateApp
import com.kakumine.studymate.data.ApiException
import com.kakumine.studymate.data.NoteGroupSummary
import com.kakumine.studymate.data.NotePageSummary
import com.kakumine.studymate.data.NoteTrashItem
import com.kakumine.studymate.data.NotesBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** 抽屉和首页在看聊天还是笔记（网页的 Chat / Note 切换）。 */
enum class Workspace { Chat, Notes }

/**
 * 给用户看的错误。服务端返回的原句（[detail]，英文，和聊天一样原样显示）优先；
 * 网络错误这类没有原句的，用 [kind] 对应的网页文案。
 */
data class NotesError(val kind: Kind, val detail: String? = null) {
    enum class Kind { Load, Create, Trash, TrashUnsaved, Group, TrashLoad, TrashAction, UnsavedDraft }
}

/**
 * 正在编辑的笔记。标题和图标随网页编辑器的 meta 消息更新。
 * [editor] 是这个编辑器（WebView）最初打开的页面 id，编辑器没换就不变；冲突后"另存为新笔记"时网页换到新页面，
 * [id] 跟着变成新页面，[editor] 不变，所以 WebView 不重新加载。
 */
data class OpenNote(val id: String, val title: String, val icon: String?, val editor: String = id)

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
    val open: OpenNote? = null,
    /** 网页编辑器报来的保存状态：saved / saving / unsaved / error / conflict。 */
    val saveState: String? = null,
    /** 离开笔记时没能保存：提示后留在笔记里。 */
    val notice: NotesError? = null,
    /** 回收站窗口；null 表示没打开。 */
    val trash: TrashUiState? = null,
) {
    /** 项目被删后残留的 groupId 也算未分组（网页 notes-sidebar.tsx 的 loose）。 */
    val loosePages: List<NotePageSummary>
        get() = pages.filter { page -> page.groupId == null || groups.none { it.id == page.groupId } }

    fun members(groupId: String) = pages.filter { it.groupId == groupId }
}

/** 折叠了哪些项目，重开 App 后保留（网页存在 localStorage）。 */
interface NotesPrefs {
    var collapsedGroups: Set<String>
}

class PrefsNotesPrefs(context: Context) : NotesPrefs {
    private val prefs = context.getSharedPreferences("notes", Context.MODE_PRIVATE)
    override var collapsedGroups: Set<String>
        get() = prefs.getStringSet("collapsed", emptySet())?.toSet() ?: emptySet()
        set(value) = prefs.edit().putStringSet("collapsed", value).apply()
}

class NotesViewModel(
    private val backend: NotesBackend,
    private val prefs: NotesPrefs,
) : ViewModel() {
    private val _state = MutableStateFlow(NotesUiState(collapsed = prefs.collapsedGroups))
    val state: StateFlow<NotesUiState> = _state.asStateFlow()

    /**
     * 编辑器打开时由界面设置：让网页立刻保存，返回是否已经没有未保存的内容。
     * 离开、切换笔记、切到聊天之前都先调用；没有编辑器（还没加载完）时视为已保存。
     */
    var flushEditor: (suspend () -> FlushResult)? = null

    private var loadJob: Job? = null
    private var navigationJob: Job? = null
    private var trashJob: Job? = null

    // ---- 列表 ----

    /** 同时只保留最新一次刷新，旧请求的结果丢弃。 */
    fun refresh() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            _state.update { it.copy(loading = !it.loaded, error = null) }
            val result = runCatching { backend.notes() }
            ensureActive()
            result
                .onSuccess { list -> _state.update { it.copy(pages = list.pages, groups = list.groups, loading = false, loaded = true, error = null) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = errorOf(NotesError.Kind.Load, e)) } }
        }
    }

    /** 登录或退出后身份变了：清掉列表和打开的笔记，按新身份重新读。 */
    fun onIdentityChanged() {
        loadJob?.cancel()
        // 换身份前排着的打开 / 新建不再执行。
        navigationJob?.cancel()
        navigationJob = null
        _state.update { NotesUiState(workspace = it.workspace, collapsed = it.collapsed) }
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
    private fun leaveThen(action: suspend () -> Unit) {
        if (navigationJob?.isActive == true) return
        navigationJob = viewModelScope.launch {
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

    fun setWorkspace(workspace: Workspace) {
        if (_state.value.workspace == workspace) return
        leaveThen {
            // 网页手机版切到 Note 时总是先显示列表（去掉 page=）。
            _state.update { it.copy(workspace = workspace, open = null, saveState = null, notice = null) }
            if (workspace == Workspace.Notes) refresh()
        }
    }

    fun openNote(id: String) {
        val current = _state.value
        if (current.open?.id == id) return
        val page = current.pages.firstOrNull { it.id == id } ?: return
        leaveThen {
            _state.update { it.copy(workspace = Workspace.Notes, open = OpenNote(page.id, page.title, page.icon), saveState = null, notice = null) }
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

    fun createNote() {
        if (_state.value.busy) return
        leaveThen {
            _state.update { it.copy(busy = true, error = null) }
            try {
                val page = backend.createNote()
                _state.update {
                    it.copy(
                        workspace = Workspace.Notes,
                        pages = upsert(it.pages, page),
                        open = OpenNote(page.id, page.title, page.icon),
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

    fun dismissNotice() = _state.update { it.copy(notice = null) }

    // ---- 网页编辑器发来的消息 ----

    // 下面的 [editor] 是发消息的编辑器（[OpenNote.editor]）。它就是打开着的编辑器时，换成它现在显示的页面 id。
    private fun pageOf(editor: String): String = _state.value.open?.takeIf { it.editor == editor }?.id ?: editor

    /**
     * 编辑器读好了页面 [pageId]。和打开着的不是同一页时，是冲突后"另存为新笔记"换到了副本：
     * 打开着的笔记换成副本（WebView 不重新加载），原来那篇的列表项不动，重读列表把副本加进来。
     */
    fun onEditorReady(editor: String, pageId: String, title: String, icon: String?) {
        val open = _state.value.open
        if (open != null && open.editor == editor && open.id != pageId) {
            _state.update { it.copy(open = open.copy(id = pageId, title = title, icon = icon), saveState = null) }
            refresh()
            return
        }
        onEditorMeta(editor, title, icon)
    }

    fun onEditorMeta(editor: String, title: String, icon: String?) {
        val id = pageOf(editor)
        _state.update { state ->
            state.copy(
                open = state.open?.takeIf { it.id == id }?.copy(title = title, icon = icon) ?: state.open,
                pages = state.pages.map { if (it.id == id) it.copy(title = title, icon = icon) else it },
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
        _state.update { state ->
            state.copy(
                pages = state.pages.filterNot { it.id == id },
                open = state.open?.takeIf { it.id != id },
                saveState = if (state.open?.id == id) null else state.saveState,
            )
        }
    }

    // ---- 移到回收站 ----

    /** 网页的确认框"移到回收站"。打开着的那篇先保存，保存不了就不移（网页同样的提示）。成功返回 true。 */
    suspend fun trashNote(id: String): Boolean {
        if (_state.value.busy) return false
        _state.update { it.copy(busy = true, error = null) }
        try {
            if (_state.value.open?.id == id) {
                if (!flushOpen().ok) {
                    _state.update { it.copy(busy = false, error = NotesError(NotesError.Kind.TrashUnsaved)) }
                    return false
                }
            }
            backend.trashNote(id)
            _state.update { state ->
                state.copy(
                    busy = false,
                    pages = state.pages.filterNot { it.id == id },
                    open = state.open?.takeIf { it.id != id },
                    saveState = if (state.open?.id == id) null else state.saveState,
                )
            }
            return true
        } catch (e: CancellationException) {
            _state.update { it.copy(busy = false) }
            throw e
        } catch (e: Throwable) {
            _state.update { it.copy(busy = false, error = errorOf(NotesError.Kind.Trash, e)) }
            return false
        }
    }

    // ---- 项目（分组）：失败时不改列表，只在对话框里显示原因 ----

    private suspend fun <T> groupAction(run: suspend () -> T): T? {
        _state.update { it.copy(groupError = null) }
        return try {
            run()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            _state.update { it.copy(groupError = errorOf(NotesError.Kind.Group, e)) }
            null
        }
    }

    fun clearGroupError() = _state.update { it.copy(groupError = null) }

    suspend fun createGroup(name: String): NoteGroupSummary? = groupAction {
        val group = backend.createGroup(name)
        _state.update { it.copy(groups = it.groups + group) }
        group
    }

    suspend fun renameGroup(id: String, name: String): Boolean = groupAction {
        val group = backend.renameGroup(id, name)
        _state.update { s -> s.copy(groups = s.groups.map { if (it.id == id) it.copy(name = group.name) else it }) }
        true
    } ?: false

    /** 项目删掉后，里面的笔记保留，变成未分组。 */
    suspend fun deleteGroup(id: String): Boolean = groupAction {
        backend.deleteGroup(id)
        _state.update { s ->
            s.copy(
                groups = s.groups.filterNot { it.id == id },
                pages = s.pages.map { if (it.groupId == id) it.copy(groupId = null) else it },
            )
        }
        true
    } ?: false

    suspend fun moveNote(pageId: String, groupId: String?): Boolean = groupAction {
        backend.moveNote(pageId, groupId)
        _state.update { s -> s.copy(pages = s.pages.map { if (it.id == pageId) it.copy(groupId = groupId) else it }) }
        true
    } ?: false

    fun toggleGroup(id: String) {
        val next = _state.value.collapsed.let { if (id in it) it - id else it + id }
        prefs.collapsedGroups = next
        _state.update { it.copy(collapsed = next) }
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
        val page = backend.restoreNote(id)
        _state.update { s ->
            s.copy(
                pages = upsert(s.pages, page),
                trash = s.trash?.copy(items = s.trash.items?.filterNot { it.id == id }),
            )
        }
    }

    fun deleteForever(id: String) = trashAction {
        backend.deleteForever(id)
        updateTrash { t -> t.copy(confirmId = null, items = t.items?.filterNot { it.id == id }) }
    }

    fun emptyTrash() = trashAction {
        // 只删确认时看到的（最新一条之前扔的），确认期间别处新扔的不删。
        val newest = _state.value.trash?.items?.firstOrNull()?.deletedAt ?: return@trashAction
        backend.emptyTrash(newest)
        updateTrash { it.copy(confirmAll = false, items = emptyList()) }
    }

    private fun trashAction(work: suspend () -> Unit) {
        val trash = _state.value.trash ?: return
        if (trash.busy) return
        viewModelScope.launch {
            updateTrash { it.copy(busy = true, error = null) }
            try {
                work()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                updateTrash { it.copy(error = errorOf(NotesError.Kind.TrashAction, e)) }
            } finally {
                updateTrash { it.copy(busy = false) }
            }
        }
    }

    private fun updateTrash(transform: (TrashUiState) -> TrashUiState) {
        _state.update { s -> s.trash?.let { s.copy(trash = transform(it)) } ?: s }
    }

    private fun errorOf(kind: NotesError.Kind, error: Throwable) =
        NotesError(kind, (error as? ApiException)?.message?.takeIf { !it.startsWith("HTTP ") })

    companion object {
        /** 加入或替换一条，再按服务端的顺序（position 升序、新建的在前）排。 */
        internal fun upsert(pages: List<NotePageSummary>, page: NotePageSummary): List<NotePageSummary> =
            (pages.filterNot { it.id == page.id } + page)
                .sortedWith(compareBy<NotePageSummary> { it.position }.thenByDescending { it.createdAt })

        val Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                val app = extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as StudyMateApp
                return NotesViewModel(app.api, PrefsNotesPrefs(app)) as T
            }
        }
    }
}
