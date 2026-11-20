import Foundation
import Observation

/// 一条检索结果（网页 search-dialog.tsx 的 Result）。
enum SearchHit: Equatable, Sendable, Identifiable {
    case note(NoteSearchResult)
    case chat(ChatSearchResult)

    /// 笔记或聊天的 ID。
    var id: String {
        switch self {
        case .note(let result): return result.id
        case .chat(let result): return result.id
        }
    }

    var title: String {
        switch self {
        case .note(let result): return result.title
        case .chat(let result): return result.title
        }
    }

    var icon: String? {
        switch self {
        case .note(let result): return result.icon
        case .chat(let result): return result.icon
        }
    }

    var snippet: String {
        switch self {
        case .note(let result): return result.snippet
        case .chat(let result): return result.snippet
        }
    }

    var updatedAt: String {
        switch self {
        case .note(let result): return result.updatedAt
        case .chat(let result): return result.updatedAt
        }
    }

    var isChat: Bool {
        if case .chat = self { return true }
        return false
    }

    /// 列表里的键：笔记和聊天的 ID 可能相同，所以带上种类。
    var key: String { (isChat ? "chat:" : "note:") + id }
}

/// 哪个检索条件的结果；data 为 nil 表示这次检索失败。
struct SearchLoaded: Equatable, Sendable {
    var key: String
    var data: SearchResponse?
}

struct SearchUiState: Equatable, Sendable {
    var input = ""
    var scope: SearchScope = .all
    /// Chats 标签页的项目筛选；"" 表示全部项目。
    var projectChoice = ""
    var loaded: SearchLoaded? = nil
    var retry = 0
    /// 高亮的行（网页的 aria-activedescendant；手机上是第一行或点过的行）。
    var active = 0
}

struct SearchGroup: Equatable, Sendable {
    var isChats: Bool
    var results: [SearchHit]
}

/// 由 [SearchUiState] 和项目列表推出的界面内容，规则与 search-dialog.tsx 的 SearchPanel 相同。
struct SearchView: Equatable, Sendable {
    var query: String
    var projectId: String
    var key: String
    var idle: Bool
    var failed: Bool
    var loading: Bool
    var data: SearchResponse?
    var terms: [String]
    var groups: [SearchGroup]
    /// 筛选的选项：当前聊天所在的项目在最前，其余按原顺序。
    var projectOptions: [ChatProjectSummary]

    var rows: [SearchHit] { groups.flatMap(\.results) }

    var projectNames: [String: String] {
        var names: [String: String] = [:]
        for project in projectOptions { names[project.id] = project.name }
        return names
    }
}

func orderProjects(_ projects: [ChatProjectSummary], _ currentProjectId: String?) -> [ChatProjectSummary] {
    guard let currentProjectId, let index = projects.firstIndex(where: { $0.id == currentProjectId }) else { return projects }
    var rest = projects
    let current = rest.remove(at: index)
    return [current] + rest
}

extension SearchUiState {
    /// - Parameter chatFirst: 当前在聊天界面：Chats 组在前；在笔记界面时 Notes 在前（网页的 view）。
    func view(_ projects: [ChatProjectSummary], _ currentProjectId: String?, _ chatFirst: Bool) -> SearchView {
        let options = orderProjects(projects, currentProjectId)
        // 只有 Chats 标签页能筛选；选中的项目已经不在了就退回"全部"。
        let projectId = scope == .chats && options.contains { $0.id == projectChoice } ? projectChoice : ""
        let query = clipUtf16(ApiText.trim(input), SearchFold.MAX_SEARCH_QUERY_CHARS)
        let key = "\(scope.wire)\n\(projectId)\n\(query)\n\(retry)"
        let idle = query.isEmpty
        let current = loaded.flatMap { !idle && $0.key == key ? $0 : nil }
        let failed = current != nil && current?.data == nil
        let loading = !idle && current == nil
        // 检索中保留上一次的结果（淡显），输入时画面不会一下子变空。
        let data = idle || failed ? nil : (current ?? loaded)?.data
        let terms = data.map { SearchFold.parseSearchTerms($0.query) } ?? []
        let chats: [SearchHit] = scope == .notes ? [] : (data?.chats ?? []).map { .chat($0) }
        let notes: [SearchHit] = scope == .chats ? [] : (data?.notes ?? []).map { .note($0) }
        let chatGroup = SearchGroup(isChats: true, results: chats)
        let noteGroup = SearchGroup(isChats: false, results: notes)
        let ordered = chatFirst ? [chatGroup, noteGroup] : [noteGroup, chatGroup]
        return SearchView(
            query: query, projectId: projectId, key: key, idle: idle, failed: failed, loading: loading, data: data,
            terms: terms, groups: ordered.filter { !$0.results.isEmpty }, projectOptions: options
        )
    }
}

/// 全屏检索的状态（网页 SearchPanel）。每次打开检索时新建一个，和网页一样打开时输入、标签和结果都是空的。
/// 输入停 250ms 后检索；条件变了就取消上一次请求，晚到的旧结果丢掉。关掉检索时调 [close]（Android 是界面的协程作用域结束）。
@MainActor
@Observable
final class SearchViewModel {
    nonisolated static let DEBOUNCE_MS = 250

    private(set) var state = SearchUiState()

    @ObservationIgnored private let backend: SearchBackend
    @ObservationIgnored private let debounceMs: Int
    @ObservationIgnored private let sleep: (Int) async throws -> Void
    @ObservationIgnored private var projects: [ChatProjectSummary] = []
    /// 正在等待 / 进行的那次检索（测试里等它结束）。
    @ObservationIgnored private(set) var job: Task<Void, Never>?
    @ObservationIgnored private var scheduledKey: String?

    /// - Parameter sleep: 等这么多毫秒（被取消时抛错）；测试里换成假的时钟。
    init(
        backend: SearchBackend,
        debounceMs: Int = SearchViewModel.DEBOUNCE_MS,
        sleep: @escaping (Int) async throws -> Void = { try await Task.sleep(nanoseconds: UInt64(max($0, 0)) * 1_000_000) }
    ) {
        self.backend = backend
        self.debounceMs = debounceMs
        self.sleep = sleep
    }

    deinit {
        job?.cancel()
    }

    func setProjects(_ list: [ChatProjectSummary]) {
        projects = list
        schedule()
    }

    func setInput(_ text: String) {
        state.input = clipUtf16(text, SearchFold.MAX_SEARCH_QUERY_CHARS)
        state.active = 0
        schedule()
    }

    func setScope(_ scope: SearchScope) {
        state.scope = scope
        state.active = 0
        schedule()
    }

    func setProject(_ id: String) {
        state.projectChoice = id
        state.active = 0
        schedule()
    }

    func retry() {
        state.retry += 1
        schedule()
    }

    func setActive(_ index: Int) {
        state.active = index
    }

    /// 界面内容；项目列表是 [setProjects] 给的那份。
    func view(currentProjectId: String?, chatFirst: Bool) -> SearchView {
        state.view(projects, currentProjectId, chatFirst)
    }

    /// 检索关掉了：停掉还在等的请求。
    func close() {
        job?.cancel()
        job = nil
        scheduledKey = nil
    }

    private func schedule() {
        let view = state.view(projects, nil, true)
        if view.key == scheduledKey { return }
        scheduledKey = view.key
        job?.cancel()
        job = nil
        if view.idle { return }
        let key = view.key
        let searchScope = state.scope
        let query = view.query
        let projectId = view.projectId.isEmpty ? nil : view.projectId
        let backend = self.backend
        let sleep = self.sleep
        let debounceMs = self.debounceMs
        job = Task { @MainActor [weak self] in
            var result: SearchResponse?
            do {
                try await sleep(debounceMs)
                try Task.checkCancellation()
                result = try await backend.search(query: query, scope: searchScope, projectId: projectId)
            } catch is CancellationError {
                return
            } catch {
                result = nil
            }
            // 被取消的请求即使晚到也不写回。
            guard let self, !Task.isCancelled, self.scheduledKey == key else { return }
            self.state.loaded = SearchLoaded(key: key, data: result)
            if result != nil { self.state.active = 0 }
        }
    }
}
