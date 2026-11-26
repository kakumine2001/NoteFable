package com.kakumine.notefable.ui

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.kakumine.notefable.R
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.ChatProjectDetail
import com.kakumine.notefable.data.ChatProjectNote
import com.kakumine.notefable.data.ChatProjectSummary
import com.kakumine.notefable.data.ProjectChange
import com.kakumine.notefable.data.ProjectsApi
import com.kakumine.notefable.data.ProjectsBackend
import com.kakumine.notefable.data.SessionSummary
import com.kakumine.notefable.data.SessionsApi
import com.kakumine.notefable.data.SessionsBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * 侧栏里显示的错误。[detail] 是服务端的英文原句（显示前用系统文词典翻译）；没有时显示 [fallback]，
 * 也就是网页在同一处用的 msg() 句子。
 */
data class SidebarError(val detail: String?, @StringRes val fallback: Int) {
    companion object {
        fun of(error: Throwable, @StringRes fallback: Int) =
            SidebarError((error as? ApiException)?.message?.takeIf { it.isNotBlank() }, fallback)
    }
}

/** 拖动排序：把 [id] 放到 [targetId] 的前 / 后（网页 ReorderRequest）。 */
data class ReorderMove(val id: String, val targetId: String, val after: Boolean)

data class SidebarUiState(
    val projects: List<ChatProjectSummary> = emptyList(),
    /** 项目列表读不到（网页 "Could not load projects. Refresh to retry."）。 */
    val projectsFailed: Boolean = false,
    /** 折叠着的项目。和网页一样只记在内存里。 */
    val collapsed: Set<String> = emptySet(),
    /** 有一次 POST /api/sessions/reorder 还没完（网页 reorderChatBusy）：这时再排序会提示等上一次完成。 */
    val reorderBusy: Boolean = false,
    /** 正在移动的聊天：这些行不能拖（网页每个 ReorderRowButton 自己的 busy）。 */
    val moveBusy: Set<String> = emptySet(),
    /** 拖动失败的行和原因（网页 ReorderRowButton 的 list-reorder-error）。 */
    val reorderError: Pair<String, SidebarError>? = null,
    /** 在项目里新建聊天失败（网页把它显示在输入栏上方；原生显示在侧栏 Projects 下面）。 */
    val createError: SidebarError? = null,
)

/** 侧栏里每个分组按网页的顺序：置顶在前，然后 position 升序，再按更新时间新的在前。 */
fun orderedSessions(sessions: List<SessionSummary>): List<SessionSummary> =
    sessions.sortedWith(
        compareByDescending<SessionSummary> { it.pinned }
            .thenBy { it.position }
            .thenByDescending { it.updatedAt },
    )

/** 侧栏分组（网页 ChatSidebar）：Pinned、各项目里没置顶的、Chats（没项目或项目已不存在）。 */
data class SidebarGroups(
    val pinned: List<SessionSummary>,
    val byProject: Map<String, List<SessionSummary>>,
    /** 项目里有聊天但全都置顶了：显示 "All chats pinned" 而不是 "No chats"。 */
    val allPinned: Set<String>,
    val loose: List<SessionSummary>,
) {
    companion object {
        fun of(sessions: List<SessionSummary>, projects: List<ChatProjectSummary>): SidebarGroups {
            val ordered = orderedSessions(sessions)
            val known = projects.mapTo(HashSet()) { it.id }
            return SidebarGroups(
                pinned = ordered.filter { it.pinned },
                byProject = projects.associate { project -> project.id to ordered.filter { it.projectId == project.id && !it.pinned } },
                allPinned = projects.filter { p -> ordered.any { it.projectId == p.id } && ordered.none { it.projectId == p.id && !it.pinned } }
                    .mapTo(HashSet()) { it.id },
                loose = ordered.filter { !it.pinned && (it.projectId == null || it.projectId !in known) },
            )
        }
    }
}

/**
 * 项目设置要保存的改动（网页 ChatProjectSettings.save）：只发改了的字段；参考笔记是整体替换，没动就不发。
 * 返回 null 表示什么都没改，直接关闭。
 */
data class ProjectSettingsChanges(val instructions: String?, val noteIds: List<String>?)

fun projectSettingsChanges(initial: ChatProjectDetail, instructions: String, selected: List<ChatProjectNote>): ProjectSettingsChanges? {
    val text = instructions.trim()
    val newInstructions = text.takeIf { it != (initial.instructions ?: "") }
    val ids = selected.map { it.id }
    val newIds = ids.takeIf { it != initial.notes.map { note -> note.id } }
    return if (newInstructions == null && newIds == null) null else ProjectSettingsChanges(newInstructions, newIds)
}

/** 想关项目设置时（返回键、点遮罩、取消）要做的事（网页 projectSettingsDismissStep）。 */
enum class ProjectSettingsDismiss { Stay, Confirm, Close }

/** 保存中不关（结果没处显示）；有没保存的改动时不悄悄丢掉，先把底栏换成“未保存的更改”确认；否则关闭。 */
fun projectSettingsDismissStep(busy: Boolean, dirty: Boolean): ProjectSettingsDismiss = when {
    busy -> ProjectSettingsDismiss.Stay
    dirty -> ProjectSettingsDismiss.Confirm
    else -> ProjectSettingsDismiss.Close
}

/** 想关的次数（底栏确认的晃动）。改动全撤回后归零，免得再改一个字时没想关也出确认（网页 projectSettingsAttention）。 */
fun projectSettingsAttention(attention: Int, dirty: Boolean): Int = if (dirty) attention else 0

/**
 * 侧栏的聊天整理：置顶、改名、移到项目、删除、拖动排序，以及聊天项目（新建、改名、删除、设置）。
 * 接口在 [SessionsBackend] / [ProjectsBackend]；会话列表本身仍在 [ChatViewModel]，成功后通过它的几个小入口更新。
 */
class SidebarViewModel(
    private val sessions: SessionsBackend,
    private val projectsApi: ProjectsBackend,
    private val chat: ChatViewModel,
) : ViewModel() {
    private val _state = MutableStateFlow(SidebarUiState())
    val state: StateFlow<SidebarUiState> = _state.asStateFlow()

    private var projectsJob: Job? = null

    /** 身份代数：登录 / 退出后，旧身份下发出的请求结果直接丢弃。 */
    private var generation = 0

    init {
        refreshProjects()
    }

    /** 本地改过项目列表后，正在进行的刷新可能是改之前读的：重新刷一次（和 ChatViewModel.patchSessions 一样）。 */
    private fun patchProjects(change: (SidebarUiState) -> SidebarUiState) {
        _state.update(change)
        if (projectsJob?.isActive == true) refreshProjects()
    }

    // 同时只认最新一次刷新；失败时保留已有列表。
    fun refreshProjects() {
        projectsJob?.cancel()
        val gen = generation
        projectsJob = viewModelScope.launch {
            val result = runCatching { projectsApi.projects() }
            ensureActive()
            if (gen != generation) return@launch
            result
                .onSuccess { list -> _state.update { it.copy(projects = list, projectsFailed = false) } }
                .onFailure { error -> if (error !is CancellationException) _state.update { it.copy(projectsFailed = true) } }
        }
    }

    fun onIdentityChanged() {
        generation++
        _state.value = SidebarUiState()
        refreshProjects()
    }

    fun toggleProject(id: String) = _state.update {
        it.copy(collapsed = if (id in it.collapsed) it.collapsed - id else it.collapsed + id)
    }

    private fun expand(id: String) = _state.update { it.copy(collapsed = it.collapsed - id) }

    fun dismissCreateError() = _state.update { it.copy(createError = null) }

    // ---- 聊天 ----

    /** 置顶 / 取消置顶（"…"菜单里的那一项，网页 onUpdate({pinned})）：服务端存好了才改本地列表。 */
    suspend fun setPinned(id: String, pinned: Boolean): SidebarError? = guarded(R.string.sb_err_save_change) {
        sessions.updateSession(id, pinned = pinned)
        chat.patchSessions { list -> list.map { if (it.id == id) it.copy(pinned = pinned) else it } }
    }

    suspend fun rename(id: String, title: String): SidebarError? = guarded(R.string.sb_err_save_chat) {
        val trimmed = title.trim()
        sessions.updateSession(id, title = trimmed)
        chat.patchSessions { list -> list.map { if (it.id == id) it.copy(title = trimmed) else it } }
    }

    /** 移到项目；[projectId] 为 null 是"无项目"。拖到项目标题上时同时取消置顶（网页 onMoveProject）。 */
    suspend fun moveToProject(id: String, projectId: String?, unpin: Boolean = false): SidebarError? = guarded(R.string.sb_err_save_chat) {
        sessions.updateSession(id, pinned = if (unpin) false else null, project = ProjectChange(projectId))
        chat.patchSessions { list ->
            list.map { if (it.id == id) it.copy(projectId = projectId, pinned = if (unpin) false else it.pinned) else it }
        }
        if (projectId != null && unpin) expand(projectId)
    }

    suspend fun delete(id: String): SidebarError? {
        val current = chat.state.value
        // 网页：回答还在生成的聊天不能删。
        if (id in current.generatingSessionIds) return SidebarError(null, R.string.sb_err_wait_reply_delete)
        return guarded(R.string.sb_err_delete_chat) {
            sessions.deleteSession(id)
            chat.onSessionDeleted(id)
        }
    }

    /**
     * 项目行的"＋"（网页 createSession(projectId)）。正在看的是空的新聊天时不多建一个：
     * 同一项目就直接用；在别的项目（且没置顶）就把它移过来；否则新建并打开。成功返回 true（关抽屉）。
     */
    suspend fun newChatInProject(projectId: String): Boolean {
        expand(projectId)
        _state.update { it.copy(createError = null) }
        val current = chat.state.value
        val active = current.sessions.firstOrNull { it.id == current.activeSessionId }
        val empty = (current.activeSessionId == null || active?.title == "New chat") &&
            current.messages.isEmpty() && !current.sending && !current.messagesLoading
        if (empty && active != null) {
            if (active.projectId == projectId) return true
            if (!active.pinned) {
                val error = moveToProject(active.id, projectId) ?: return true
                // 失败时不关抽屉，原因显示在 PROJECTS 下面。
                _state.update { it.copy(createError = error) }
                return false
            }
        }
        val gen = generation
        val nav = chat.navigationCount
        return try {
            val session = sessions.createSession(projectId)
            if (gen != generation) return false
            if (chat.navigationCount != nav) {
                chat.addCreatedSession(session)
                return false
            }
            chat.openCreatedSession(session)
            true
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Throwable) {
            _state.update { it.copy(createError = SidebarError.of(error, R.string.sb_err_create_chat)) }
            false
        }
    }

    /** 拖动排序（POST /api/sessions/reorder）。同一时间只做一次，和网页一样上一次没完就报错。 */
    fun reorder(move: ReorderMove) {
        if (_state.value.reorderBusy) {
            _state.update { it.copy(reorderError = move.id to SidebarError(null, R.string.sb_err_wait_move)) }
            return
        }
        if (move.id == move.targetId || move.id in _state.value.moveBusy) return
        val gen = generation
        _state.update { it.copy(reorderBusy = true, moveBusy = it.moveBusy + move.id, reorderError = null) }
        viewModelScope.launch {
            val result = runCatching { sessions.reorderSession(move.id, move.targetId, move.after) }
            if (gen != generation) return@launch
            result.onSuccess { updates ->
                val byId = updates.associateBy { it.id }
                chat.patchSessions { list ->
                    list.map { s ->
                        val u = byId[s.id] ?: return@map s
                        if (u.movedGroup) s.copy(position = u.position, projectId = u.projectId, pinned = u.pinned ?: s.pinned)
                        else s.copy(position = u.position, pinned = u.pinned ?: s.pinned)
                    }
                }
            }
            _state.update {
                it.copy(
                    reorderBusy = false,
                    moveBusy = it.moveBusy - move.id,
                    reorderError = result.exceptionOrNull()?.let { e -> move.id to SidebarError.of(e, R.string.sb_err_move_chat) },
                )
            }
        }
    }

    /** 拖到项目标题或 Chats 标签上（网页 onMoveProject）：移进去并取消置顶，然后展开该项目。 */
    // 网页这里走的是普通的更新接口，不受排序锁限制；只锁被拖的这一行。
    fun dropIntoProject(id: String, projectId: String?) {
        if (id in _state.value.moveBusy) return
        val gen = generation
        _state.update { it.copy(moveBusy = it.moveBusy + id, reorderError = null) }
        viewModelScope.launch {
            val error = moveToProject(id, projectId, unpin = true)
            if (gen != generation) return@launch
            _state.update { it.copy(moveBusy = it.moveBusy - id, reorderError = error?.let { e -> id to e.copy(fallback = R.string.sb_err_move_item) }) }
        }
    }

    fun dismissReorderError() = _state.update { it.copy(reorderError = null) }

    // ---- 项目 ----

    suspend fun createProject(name: String): Pair<ChatProjectSummary?, SidebarError?> {
        val gen = generation
        return try {
            val project = projectsApi.createProject(name.trim())
            if (gen == generation) patchProjects { it.copy(projects = it.projects + project, projectsFailed = false) }
            project to null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Throwable) {
            null to SidebarError.of(error, R.string.sb_err_save_project)
        }
    }

    suspend fun renameProject(id: String, name: String): SidebarError? = guarded(R.string.sb_err_save_project) {
        val project = projectsApi.renameProject(id, name.trim())
        projectSaved(project)
    }

    /** 删除项目：里面的聊天留着，移到 Chats（服务端把 projectId 置空）。 */
    suspend fun deleteProject(id: String): SidebarError? = guarded(R.string.sb_err_save_project) {
        projectsApi.deleteProject(id)
        patchProjects { it.copy(projects = it.projects.filterNot { p -> p.id == id }, collapsed = it.collapsed - id) }
        chat.patchSessions { list -> list.map { if (it.projectId == id) it.copy(projectId = null) else it } }
    }

    fun projectSaved(project: ChatProjectSummary) = patchProjects {
        it.copy(projects = it.projects.map { p -> if (p.id == project.id) project else p })
    }

    /**
     * 设置窗口打开时读项目详情和全部页面（两个都要成功）。失败时和网页一样：页面读不到是 "Could not load your pages."，
     * 否则 "Could not load the project settings."；服务端给了原因就用原因。
     */
    suspend fun loadProjectSettings(id: String): Result<Pair<ChatProjectDetail, List<ChatProjectNote>>> = runCatching {
        coroutineScope {
            // 两个请求并行，但和网页一样先看项目详情的结果。
            val detail = async { runCatching { projectsApi.projectDetail(id) } }
            val pages = async { runCatching { projectsApi.notesForPicker() } }
            val loaded = detail.await().onFailure { if (it is CancellationException) throw it }.getOrThrow()
            val notes = pages.await().onFailure { error ->
                if (error is CancellationException) throw error
                throw ProjectSettingsLoadError(SidebarError.of(error, R.string.sb_err_load_your_notes))
            }.getOrThrow()
            loaded to notes.map { ChatProjectNote(it.id, it.title, it.icon, it.kind) }
        }
    }.onFailure { if (it is CancellationException) throw it }

    /** 只发改了的字段；没改返回 null（直接关）。失败返回错误。 */
    suspend fun saveProjectSettings(id: String, changes: ProjectSettingsChanges): SidebarError? =
        guarded(R.string.sb_err_save_project_settings) {
            projectSaved(projectsApi.updateProjectSettings(id, changes.instructions, changes.noteIds))
        }

    /** 设置窗口加载失败时要显示的错误。 */
    fun projectSettingsLoadError(error: Throwable): SidebarError =
        (error as? ProjectSettingsLoadError)?.error ?: SidebarError.of(error, R.string.sb_err_load_project_settings)

    private class ProjectSettingsLoadError(val error: SidebarError) : Exception(error.detail)

    private suspend fun guarded(@StringRes fallback: Int, work: suspend () -> Unit): SidebarError? {
        val gen = generation
        return try {
            work()
            null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Throwable) {
            if (gen != generation) null else SidebarError.of(error, fallback)
        }
    }

    companion object {
        fun factory(chat: ChatViewModel) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                val app = extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as NoteFableApp
                return SidebarViewModel(SessionsApi(app.api.http), ProjectsApi(app.api.http), chat) as T
            }
        }
    }
}
