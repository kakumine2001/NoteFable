package com.kakumine.notefable.ui

import com.kakumine.notefable.data.ChatProjectSummary
import com.kakumine.notefable.data.ChatSearchResult
import com.kakumine.notefable.data.NoteSearchResult
import com.kakumine.notefable.data.PageKind
import com.kakumine.notefable.data.PageKindTable
import com.kakumine.notefable.data.SearchBackend
import com.kakumine.notefable.data.SearchFold
import com.kakumine.notefable.data.SearchResponse
import com.kakumine.notefable.data.SearchScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** 一条检索结果（网页 search-dialog.tsx 的 Result）。 */
sealed interface SearchHit {
    val id: String
    val title: String
    val icon: String?
    val snippet: String
    val updatedAt: String

    data class Note(val result: NoteSearchResult) : SearchHit {
        override val id get() = result.id
        override val title get() = result.title
        override val icon get() = result.icon
        override val snippet get() = result.snippet
        override val updatedAt get() = result.updatedAt
    }

    data class Chat(val result: ChatSearchResult) : SearchHit {
        override val id get() = result.id
        override val title get() = result.title
        override val icon get() = result.icon
        override val snippet get() = result.snippet
        override val updatedAt get() = result.updatedAt
    }
}

/** 哪个检索条件的结果；data 为 null 表示这次检索失败。 */
data class SearchLoaded(val key: String, val data: SearchResponse?)

data class SearchUiState(
    val input: String = "",
    val scope: SearchScope = SearchScope.All,
    /** Chats 标签页的项目筛选；"" 表示全部项目。 */
    val projectChoice: String = "",
    /** Notes 标签页的类型筛选（类型的 wire 值，网页 search-dialog 的 kindChoice）；"" 表示全部类型。 */
    val kindChoice: String = "",
    val loaded: SearchLoaded? = null,
    val retry: Int = 0,
    /** 高亮的行（网页的 aria-activedescendant；手机上是第一行或点过的行）。 */
    val active: Int = 0,
)

data class SearchGroup(val isChats: Boolean, val results: List<SearchHit>)

/** 由 [SearchUiState] 和项目列表推出的界面内容，规则与 search-dialog.tsx 的 SearchPanel 相同。 */
data class SearchView(
    val query: String,
    val projectId: String,
    /** 生效的类型筛选（wire 值，"" 是全部类型）：只在 Notes 标签页、能新建的类型有两种以上时。 */
    val kind: String,
    /** 类型筛选的选项（网页 creatablePageKinds）。少于两种时不显示筛选。 */
    val kindOptions: List<PageKind>,
    val key: String,
    val idle: Boolean,
    val failed: Boolean,
    val loading: Boolean,
    val data: SearchResponse?,
    val terms: List<String>,
    val groups: List<SearchGroup>,
    /** 筛选的选项：当前聊天所在的项目在最前，其余按原顺序。 */
    val projectOptions: List<ChatProjectSummary>,
) {
    val rows: List<SearchHit> get() = groups.flatMap { it.results }
    val projectNames: Map<String, String> get() = projectOptions.associate { it.id to it.name }
}

fun orderProjects(projects: List<ChatProjectSummary>, currentProjectId: String?): List<ChatProjectSummary> {
    val current = currentProjectId?.let { id -> projects.firstOrNull { it.id == id } } ?: return projects
    return listOf(current) + projects.filter { it !== current }
}

/**
 * @param chatFirst 当前在聊天界面：Chats 组在前；在笔记界面时 Notes 在前（网页的 view）。
 */
fun SearchUiState.view(projects: List<ChatProjectSummary>, currentProjectId: String?, chatFirst: Boolean, kinds: List<PageKind> = PageKindTable.creatable): SearchView {
    val options = orderProjects(projects, currentProjectId)
    // 只有 Chats 标签页能筛选；选中的项目已经不在了就退回"全部"。
    val projectId = if (scope == SearchScope.Chats && options.any { it.id == projectChoice }) projectChoice else ""
    // 类型筛选只在 Notes 标签页，能新建的类型有两种以上时（开关关着的类型不出现）。
    val kind = if (scope == SearchScope.Notes && kinds.size > 1 && kinds.any { it.wire == kindChoice }) kindChoice else ""
    val query = input.trim().take(SearchFold.MAX_SEARCH_QUERY_CHARS)
    val key = "${scope.wire}\n$projectId\n$kind\n$query\n$retry"
    val idle = query.isEmpty()
    val current = loaded?.takeIf { !idle && it.key == key }
    val failed = current != null && current.data == null
    val loading = !idle && current == null
    // 检索中保留上一次的结果（淡显），输入时画面不会一下子变空。
    val data = if (idle || failed) null else (current ?: loaded)?.data
    val terms = data?.let { SearchFold.parseSearchTerms(it.query) } ?: emptyList()
    val chats = if (scope == SearchScope.Notes) emptyList() else data?.chats.orEmpty().map { SearchHit.Chat(it) }
    val notes = if (scope == SearchScope.Chats) emptyList() else data?.notes.orEmpty().map { SearchHit.Note(it) }
    val ordered = if (chatFirst) listOf(SearchGroup(true, chats), SearchGroup(false, notes)) else listOf(SearchGroup(false, notes), SearchGroup(true, chats))
    return SearchView(query, projectId, kind, if (kinds.size > 1) kinds else emptyList(), key, idle, failed, loading, data, terms, ordered.filter { it.results.isNotEmpty() }, options)
}

/**
 * 全屏检索的状态（网页 SearchPanel）。每次打开检索时新建一个，和网页一样打开时输入、标签和结果都是空的。
 * 输入停 250ms 后检索；条件变了就取消上一次请求，晚到的旧结果丢掉。
 */
class SearchViewModel(
    private val scope: CoroutineScope,
    private val backend: SearchBackend,
    private val debounceMs: Long = DEBOUNCE_MS,
) {
    private val _state = MutableStateFlow(SearchUiState())
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    private var projects: List<ChatProjectSummary> = emptyList()
    /** 能新建的类型（类型筛选的选项，[PageKindTable.creatable]）。表换了要重新检索（选着的类型可能没了）。 */
    private var kinds: List<PageKind> = PageKindTable.creatable
    private var job: Job? = null
    private var scheduledKey: String? = null

    fun setProjects(list: List<ChatProjectSummary>) {
        projects = list
        schedule()
    }

    fun setKinds(list: List<PageKind>) {
        kinds = list
        schedule()
    }

    fun setInput(text: String) {
        _state.update { it.copy(input = text.take(SearchFold.MAX_SEARCH_QUERY_CHARS), active = 0) }
        schedule()
    }

    fun setScope(scope: SearchScope) {
        _state.update { it.copy(scope = scope, active = 0) }
        schedule()
    }

    fun setProject(id: String) {
        _state.update { it.copy(projectChoice = id, active = 0) }
        schedule()
    }

    /** Notes 的类型筛选（wire 值，"" 是全部类型）。 */
    fun setKind(wire: String) {
        _state.update { it.copy(kindChoice = wire, active = 0) }
        schedule()
    }

    fun retry() {
        _state.update { it.copy(retry = it.retry + 1) }
        schedule()
    }

    fun setActive(index: Int) {
        _state.update { it.copy(active = index) }
    }

    private fun schedule() {
        val view = _state.value.view(projects, null, true, kinds)
        if (view.key == scheduledKey) return
        scheduledKey = view.key
        job?.cancel()
        if (view.idle) return
        val key = view.key
        val searchScope = _state.value.scope
        job = scope.launch {
            delay(debounceMs)
            val result = try {
                backend.search(view.query, searchScope, view.projectId.ifEmpty { null }, view.kind.ifEmpty { null })
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Throwable) {
                null
            }
            if (scheduledKey != key) return@launch
            _state.update { it.copy(loaded = SearchLoaded(key, result), active = if (result != null) 0 else it.active) }
        }
    }

    companion object {
        const val DEBOUNCE_MS = 250L
    }
}
