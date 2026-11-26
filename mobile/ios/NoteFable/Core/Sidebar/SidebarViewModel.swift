import Foundation
import Observation

/// 侧栏里显示的错误。[detail] 是服务端的英文原句（显示前用系统文词典翻译）；没有时显示 [fallback]
/// （文案键，也就是网页在同一处用的 msg() 句子）。
struct SidebarError: Error, Equatable, Sendable {
    var detail: String?
    var fallback: String

    static func of(_ error: Error, _ fallback: String) -> SidebarError {
        let message = (error as? ApiException)?.message
        return SidebarError(detail: message.flatMap { ApiText.isBlank($0) ? nil : $0 }, fallback: fallback)
    }
}

/// 拖动排序：把 [id] 放到 [targetId] 的前 / 后（网页 ReorderRequest）。
struct ReorderMove: Equatable, Sendable {
    var id: String
    var targetId: String
    var after: Bool
}

/// 拖动失败的行和原因。
struct SidebarReorderError: Equatable, Sendable {
    var id: String
    var error: SidebarError
}

struct SidebarUiState: Equatable, Sendable {
    var projects: [ChatProjectSummary] = []
    /// 项目列表读不到（网页 "Could not load projects. Refresh to retry."）。
    var projectsFailed = false
    /// 折叠着的项目。和网页一样只记在内存里。
    var collapsed: Set<String> = []
    /// 有一次 POST /api/sessions/reorder 还没完（网页 reorderChatBusy）：这时再排序会提示等上一次完成。
    var reorderBusy = false
    /// 正在移动的聊天：这些行不能拖（网页每个 ReorderRowButton 自己的 busy）。
    var moveBusy: Set<String> = []
    /// 拖动失败的行和原因（网页 ReorderRowButton 的 list-reorder-error）。
    var reorderError: SidebarReorderError? = nil
    /// 在项目里新建聊天失败（网页把它显示在输入栏上方；原生显示在侧栏 Projects 下面）。
    var createError: SidebarError? = nil
}

/// 侧栏里每个分组按网页的顺序：置顶在前，然后 position 升序，再按更新时间新的在前。其余保持原来的先后。
func orderedSessions(_ sessions: [SessionSummary]) -> [SessionSummary] {
    sessions.enumerated().sorted { a, b in
        if a.element.pinned != b.element.pinned { return a.element.pinned }
        if a.element.position != b.element.position { return a.element.position < b.element.position }
        if a.element.updatedAt != b.element.updatedAt { return a.element.updatedAt > b.element.updatedAt }
        return a.offset < b.offset
    }.map(\.element)
}

/// 侧栏分组（网页 ChatSidebar）：Pinned、各项目里没置顶的、Chats（没项目或项目已不存在）。
struct SidebarGroups: Equatable, Sendable {
    var pinned: [SessionSummary]
    var byProject: [String: [SessionSummary]]
    /// 项目里有聊天但全都置顶了：显示 "All chats pinned" 而不是 "No chats"。
    var allPinned: Set<String>
    var loose: [SessionSummary]

    static func of(_ sessions: [SessionSummary], _ projects: [ChatProjectSummary]) -> SidebarGroups {
        let ordered = orderedSessions(sessions)
        let known = Set(projects.map(\.id))
        var byProject: [String: [SessionSummary]] = [:]
        var allPinned: Set<String> = []
        for project in projects {
            let own = ordered.filter { $0.projectId == project.id }
            let unpinned = own.filter { !$0.pinned }
            byProject[project.id] = unpinned
            if !own.isEmpty, unpinned.isEmpty { allPinned.insert(project.id) }
        }
        return SidebarGroups(
            pinned: ordered.filter(\.pinned),
            byProject: byProject,
            allPinned: allPinned,
            loose: ordered.filter { session in
                !session.pinned && (session.projectId.map { !known.contains($0) } ?? true)
            }
        )
    }
}

/// 项目设置要保存的改动（网页 ChatProjectSettings.save）：只发改了的字段；参考笔记是整体替换，没动就不发。
struct ProjectSettingsChanges: Equatable, Sendable {
    var instructions: String?
    var noteIds: [String]?
}

/// 返回 nil 表示什么都没改，直接关闭。
func projectSettingsChanges(_ initial: ChatProjectDetail, _ instructions: String, _ selected: [ChatProjectNote]) -> ProjectSettingsChanges? {
    let text = ApiText.trim(instructions)
    let newInstructions = text != (initial.instructions ?? "") ? text : nil
    let ids = selected.map(\.id)
    let newIds = ids != initial.notes.map(\.id) ? ids : nil
    if newInstructions == nil, newIds == nil { return nil }
    return ProjectSettingsChanges(instructions: newInstructions, noteIds: newIds)
}

/// 侧栏要用到的聊天状态（Android 里直接读 ChatViewModel.state.value 的那几个字段）。
struct SidebarChatSnapshot: Equatable, Sendable {
    var sessions: [SessionSummary] = []
    var activeSessionId: String? = nil
    /// 正在生成回答的聊天（ChatUiState.generatingSessionIds）。
    var generatingSessionIds: Set<String> = []
    /// ChatUiState.messages.isEmpty。
    var messagesEmpty = true
    var sending = false
    var messagesLoading = false
}

/// SidebarViewModel 从 ChatViewModel 用到的全部成员（名字和 Android 相同）。会话列表本身在聊天那边，侧栏只通过这几个入口读写。
@MainActor
protocol SidebarChatHost: AnyObject {
    /// 当前的聊天状态（ChatUiState 里侧栏要看的字段）。
    var sidebarChat: SidebarChatSnapshot { get }
    /// 每换一次聊天加一：慢请求回来时用它判断用户是不是已经去了别处。
    var navigationCount: Int { get }
    /// 改本地的会话列表；正在刷新列表的话再刷一次，免得旧结果盖掉改动。
    func patchSessions(_ transform: ([SessionSummary]) -> [SessionSummary])
    /// 聊天已删除：从列表去掉；删的是正在看的聊天时回到新聊天。
    func onSessionDeleted(_ id: String)
    /// 建好的聊天放到列表最前并打开。
    func openCreatedSession(_ session: SessionSummary)
    /// 建好的聊天只放进列表（用户已经去了别处）。
    func addCreatedSession(_ session: SessionSummary)
}

/// 设置窗口打开时读到的内容：项目详情 + 全部笔记（参考笔记的候选）。
struct ProjectSettingsLoaded: Equatable, Sendable {
    var detail: ChatProjectDetail
    var notes: [ChatProjectNote]
}

/// 侧栏的聊天整理：置顶、改名、移到项目、删除、拖动排序，以及聊天项目（新建、改名、删除、设置）。
/// 接口在 [SessionsBackend] / [ProjectsBackend]；会话列表本身仍在 ChatViewModel，成功后通过 [SidebarChatHost] 的几个小入口更新。
@MainActor
@Observable
final class SidebarViewModel {
    private(set) var state = SidebarUiState()

    @ObservationIgnored private let sessions: SessionsBackend
    @ObservationIgnored private let projectsApi: ProjectsBackend
    @ObservationIgnored private let chat: SidebarChatHost
    @ObservationIgnored private let work = PendingWork()

    @ObservationIgnored private var projectsJob: Task<Void, Never>?
    /// 最新一次刷新的编号；还没回来时 projectsLoading 为 true（Android 的 projectsJob.isActive）。
    @ObservationIgnored private var projectsRequest = 0
    @ObservationIgnored private var projectsLoading = false

    /// 身份代数：登录 / 退出后，旧身份下发出的请求结果直接丢弃。
    @ObservationIgnored private var generation = 0

    /// 聊天改名或删除写入服务端成功后通知（例如常驻侧栏里操作时，让旁边开着的笔记编辑器立即重读反向链接）。
    @ObservationIgnored var onSessionMutated: (@MainActor () -> Void)?

    init(sessions: SessionsBackend, projectsApi: ProjectsBackend, chat: SidebarChatHost) {
        self.sessions = sessions
        self.projectsApi = projectsApi
        self.chat = chat
        refreshProjects()
    }

    /// 等自己发起的请求都结束（单元测试用）。
    func idle() async {
        await work.idle()
    }

    /// 本地改过项目列表后，正在进行的刷新可能是改之前读的：重新刷一次（和 ChatViewModel.patchSessions 一样）。
    private func patchProjects(_ change: (inout SidebarUiState) -> Void) {
        change(&state)
        if projectsLoading { refreshProjects() }
    }

    // 同时只认最新一次刷新；失败时保留已有列表。
    func refreshProjects() {
        projectsJob?.cancel()
        projectsRequest += 1
        let request = projectsRequest
        let gen = generation
        projectsLoading = true
        projectsJob = work.launch { [weak self] in
            guard let self else { return }
            let result: Result<[ChatProjectSummary], Error>
            do {
                result = .success(try await self.projectsApi.projects())
            } catch {
                result = .failure(error)
            }
            // 已经被更新的一次刷新取代。
            guard request == self.projectsRequest else { return }
            self.projectsLoading = false
            guard gen == self.generation else { return }
            switch result {
            case .success(let list):
                self.state.projects = list
                self.state.projectsFailed = false
            case .failure(let error):
                if !(error is CancellationError) { self.state.projectsFailed = true }
            }
        }
    }

    func onIdentityChanged() {
        generation += 1
        state = SidebarUiState()
        refreshProjects()
    }

    func toggleProject(_ id: String) {
        if state.collapsed.contains(id) { state.collapsed.remove(id) } else { state.collapsed.insert(id) }
    }

    private func expand(_ id: String) {
        if state.collapsed.contains(id) { state.collapsed.remove(id) }
    }

    func dismissCreateError() {
        state.createError = nil
    }

    // ---- 聊天 ----

    /// 置顶 / 取消置顶（"…"菜单里的那一项，网页 onUpdate({pinned})）：服务端存好了才改本地列表。
    func setPinned(_ id: String, _ pinned: Bool) async -> SidebarError? {
        await guarded("sb_err_save_change") {
            try await self.sessions.updateSession(id: id, title: nil, pinned: pinned, project: nil)
            self.chat.patchSessions { list in
                list.map { session in
                    var next = session
                    if next.id == id { next.pinned = pinned }
                    return next
                }
            }
        }
    }

    func rename(_ id: String, _ title: String) async -> SidebarError? {
        await guarded("sb_err_save_chat") {
            let trimmed = ApiText.trim(title)
            try await self.sessions.updateSession(id: id, title: trimmed, pinned: nil, project: nil)
            self.chat.patchSessions { list in
                list.map { session in
                    var next = session
                    if next.id == id { next.title = trimmed }
                    return next
                }
            }
            self.onSessionMutated?()
        }
    }

    /// 移到项目；[projectId] 为 nil 是"无项目"。拖到项目标题上时同时取消置顶（网页 onMoveProject）。
    func moveToProject(_ id: String, _ projectId: String?, unpin: Bool = false) async -> SidebarError? {
        await guarded("sb_err_save_chat") {
            try await self.sessions.updateSession(
                id: id, title: nil, pinned: unpin ? false : nil, project: ProjectChange(projectId: projectId)
            )
            self.chat.patchSessions { list in
                list.map { session in
                    var next = session
                    if next.id == id {
                        next.projectId = projectId
                        if unpin { next.pinned = false }
                    }
                    return next
                }
            }
            if let projectId, unpin { self.expand(projectId) }
        }
    }

    func delete(_ id: String) async -> SidebarError? {
        // 网页：回答还在生成的聊天不能删。
        if chat.sidebarChat.generatingSessionIds.contains(id) {
            return SidebarError(detail: nil, fallback: "sb_err_wait_reply_delete")
        }
        return await guarded("sb_err_delete_chat") {
            try await self.sessions.deleteSession(id: id)
            self.chat.onSessionDeleted(id)
            self.onSessionMutated?()
        }
    }

    /// 项目行的"＋"（网页 createSession(projectId)）。正在看的是空的新聊天时不多建一个：
    /// 同一项目就直接用；在别的项目（且没置顶）就把它移过来；否则新建并打开。成功返回 true（关抽屉）。
    func newChatInProject(_ projectId: String) async -> Bool {
        expand(projectId)
        state.createError = nil
        let current = chat.sidebarChat
        let active = current.sessions.first { $0.id == current.activeSessionId }
        let empty = (current.activeSessionId == nil || active?.title == "New chat")
            && current.messagesEmpty && !current.sending && !current.messagesLoading
        if empty, let active {
            if active.projectId == projectId { return true }
            if !active.pinned {
                guard let error = await moveToProject(active.id, projectId) else { return true }
                // 失败时不关抽屉，原因显示在 PROJECTS 下面。
                state.createError = error
                return false
            }
        }
        let gen = generation
        let nav = chat.navigationCount
        do {
            let session = try await sessions.createSession(projectId: projectId)
            if gen != generation { return false }
            if chat.navigationCount != nav {
                chat.addCreatedSession(session)
                return false
            }
            chat.openCreatedSession(session)
            return true
        } catch is CancellationError {
            return false
        } catch {
            state.createError = SidebarError.of(error, "sb_err_create_chat")
            return false
        }
    }

    /// 拖动排序（POST /api/sessions/reorder）。同一时间只做一次，和网页一样上一次没完就报错。
    func reorder(_ move: ReorderMove) {
        if state.reorderBusy {
            state.reorderError = SidebarReorderError(id: move.id, error: SidebarError(detail: nil, fallback: "sb_err_wait_move"))
            return
        }
        if move.id == move.targetId || state.moveBusy.contains(move.id) { return }
        let gen = generation
        state.reorderBusy = true
        state.moveBusy.insert(move.id)
        state.reorderError = nil
        work.launch { [weak self] in
            guard let self else { return }
            var failure: Error?
            var updates: [SessionOrderUpdate] = []
            do {
                updates = try await self.sessions.reorderSession(id: move.id, targetId: move.targetId, after: move.after)
            } catch {
                failure = error
            }
            guard gen == self.generation else { return }
            if failure == nil {
                var byId: [String: SessionOrderUpdate] = [:]
                for update in updates { byId[update.id] = update }
                self.chat.patchSessions { list in
                    list.map { session in
                        guard let update = byId[session.id] else { return session }
                        var next = session
                        next.position = update.position
                        // projectId 可以是 null（移到 Chats），所以看字段在不在。
                        if update.movedGroup { next.projectId = update.projectId }
                        if let pinned = update.pinned { next.pinned = pinned }
                        return next
                    }
                }
            }
            self.state.reorderBusy = false
            self.state.moveBusy.remove(move.id)
            self.state.reorderError = failure.map { SidebarReorderError(id: move.id, error: SidebarError.of($0, "sb_err_move_chat")) }
        }
    }

    /// 拖到项目标题或 Chats 标签上（网页 onMoveProject）：移进去并取消置顶，然后展开该项目。
    // 网页这里走的是普通的更新接口，不受排序锁限制；只锁被拖的这一行。
    func dropIntoProject(_ id: String, _ projectId: String?) {
        if state.moveBusy.contains(id) { return }
        let gen = generation
        state.moveBusy.insert(id)
        state.reorderError = nil
        work.launch { [weak self] in
            guard let self else { return }
            let error = await self.moveToProject(id, projectId, unpin: true)
            guard gen == self.generation else { return }
            self.state.moveBusy.remove(id)
            self.state.reorderError = error.map {
                SidebarReorderError(id: id, error: SidebarError(detail: $0.detail, fallback: "sb_err_move_item"))
            }
        }
    }

    func dismissReorderError() {
        state.reorderError = nil
    }

    // ---- 项目 ----

    func createProject(_ name: String) async -> (project: ChatProjectSummary?, error: SidebarError?) {
        let gen = generation
        do {
            let project = try await projectsApi.createProject(name: ApiText.trim(name))
            if gen == generation {
                patchProjects { state in
                    state.projects.append(project)
                    state.projectsFailed = false
                }
            }
            return (project, nil)
        } catch is CancellationError {
            return (nil, nil)
        } catch {
            return (nil, SidebarError.of(error, "sb_err_save_project"))
        }
    }

    func renameProject(_ id: String, _ name: String) async -> SidebarError? {
        await guarded("sb_err_save_project") {
            let project = try await self.projectsApi.renameProject(id: id, name: ApiText.trim(name))
            self.projectSaved(project)
        }
    }

    /// 删除项目：里面的聊天留着，移到 Chats（服务端把 projectId 置空）。
    func deleteProject(_ id: String) async -> SidebarError? {
        await guarded("sb_err_save_project") {
            try await self.projectsApi.deleteProject(id: id)
            self.patchProjects { state in
                state.projects.removeAll { $0.id == id }
                state.collapsed.remove(id)
            }
            self.chat.patchSessions { list in
                list.map { session in
                    var next = session
                    if next.projectId == id { next.projectId = nil }
                    return next
                }
            }
        }
    }

    func projectSaved(_ project: ChatProjectSummary) {
        patchProjects { state in
            state.projects = state.projects.map { $0.id == project.id ? project : $0 }
        }
    }

    /// 设置窗口打开时读项目详情和全部页面（两个都要成功）。失败时和网页一样：页面读不到是 "Could not load your pages."，
    /// 否则 "Could not load the project settings."；服务端给了原因就用原因（见 [projectSettingsLoadError]）。
    func loadProjectSettings(_ id: String) async -> Result<ProjectSettingsLoaded, Error> {
        let api = projectsApi
        // 两个请求并行，但和网页一样先看项目详情的结果。
        async let detail = Self.attempt { try await api.projectDetail(id: id) }
        async let pages = Self.attempt { try await api.notesForPicker() }
        let loaded: ChatProjectDetail
        switch await detail {
        case .success(let value): loaded = value
        case .failure(let error):
            _ = await pages
            return .failure(error)
        }
        switch await pages {
        case .success(let notes):
            return .success(ProjectSettingsLoaded(
                detail: loaded, notes: notes.map { ChatProjectNote(page: $0) }
            ))
        case .failure(let error):
            if error is CancellationError { return .failure(error) }
            return .failure(SidebarError.of(error, "sb_err_load_your_notes"))
        }
    }

    private nonisolated static func attempt<T>(_ request: () async throws -> T) async -> Result<T, Error> {
        do {
            return .success(try await request())
        } catch {
            return .failure(error)
        }
    }

    /// 只发改了的字段。成功返回 nil，失败返回错误。
    func saveProjectSettings(_ id: String, _ changes: ProjectSettingsChanges) async -> SidebarError? {
        await guarded("sb_err_save_project_settings") {
            self.projectSaved(try await self.projectsApi.updateProjectSettings(
                id: id, instructions: changes.instructions, noteIds: changes.noteIds
            ))
        }
    }

    /// 设置窗口加载失败时要显示的错误。
    func projectSettingsLoadError(_ error: Error) -> SidebarError {
        (error as? SidebarError) ?? SidebarError.of(error, "sb_err_load_project_settings")
    }

    /// 身份换了以后才回来的失败不报（那是上一个身份的请求）。任务被取消时也不报，本地列表不动。
    private func guarded(_ fallback: String, _ work: @MainActor () async throws -> Void) async -> SidebarError? {
        let gen = generation
        do {
            try await work()
            return nil
        } catch is CancellationError {
            return nil
        } catch {
            return gen != generation ? nil : SidebarError.of(error, fallback)
        }
    }
}
