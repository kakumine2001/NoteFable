import Foundation
import Observation

/// 聊天界面的 ViewModel（Android `ui/ChatViewModel.kt` 的移植，名字和行为相同）。
///
/// 和 Kotlin 端的对应：`StateFlow` → 可观察的 `state`；协程的 Job → `ChatJob`；`delay` / `System.currentTimeMillis`
/// → 注入的 `sleep` / `now`（测试里换成虚拟时钟）；`SavedStateHandle` → `ChatSavedState`。
/// Swift 的任务不会在创建时同步执行，也不会在挂起点被取消打断：每次 `await` 回来后自己查是否已取消。
@MainActor
@Observable
final class ChatViewModel {
    private(set) var state: ChatUiState

    /// 输入栏里还没发出的文字。放在 ViewModel 里，切到笔记再切回来都还在。
    private(set) var draft: String

    private let backend: ChatBackend
    private let settings: SettingsStore
    /// 流式文字攒一小段再刷新界面，避免每个 token 都触发一次重绘。
    private let flushIntervalMs: Int
    /// 线上 /api/models 读不到（例如网站还没发布这个接口）时用的后备列表，来自安装包自带的 models.json。
    private let bundledModels: () throws -> ModelsResponse?
    /// 草稿和引用也存进这里，App 在后台被系统杀掉后回来仍在。
    private let savedState: ChatSavedState
    /// 对账把一条消息的本地 ID（`local-N`）换成服务端 ID 时调用（会话 ID、旧 ID、新 ID）。后台聊天的对账也会调用。
    /// "存到笔记"的状态据此搬到新 ID 下，不依赖那条回答此刻是否在屏幕上（AnswerExportStore.rename）。
    private let onMessageIdChanged: @MainActor (_ sessionId: String, _ from: String, _ to: String) -> Void
    private let sleep: @MainActor (_ milliseconds: UInt64) async throws -> Void
    private let now: @MainActor () -> Int

    // ---- 每个聊天各自的消息与回答（网页 page.tsx 的 sessionMessagesRef / streamingSessionsRef） ----
    //
    // 切换聊天、开新聊天都不停掉正在生成的回答：每个聊天有自己的消息缓存和自己的流，界面只显示当前聊天那一份。
    // 键是会话 ID；还没有 ID 的新聊天用本机键（每开一次新聊天换一个），拿到 X-Session-Id 后迁到真正的 ID 下。
    // 这些表只在主线程上读写。

    /// 当前新聊天的本机键。和网页不同（网页发送前先建好会话），所以每次开新聊天换一个，免得两个新聊天共用一份缓存。
    @ObservationIgnored private var newChatKey = "new-chat:0"
    @ObservationIgnored private var newChats = 0

    /// 每个聊天显示的消息（含进行中的回答）。
    @ObservationIgnored private var cache: [String: [UiMessage]] = [:]

    /// 正在发送（上传附件或等待 / 接收回答）的聊天 → 它的任务。通常一个聊天只有一个；新聊天拿到会话 ID 之前，
    /// 用户可能已经从侧栏打开了这个会话并又发了一条，迁过来后这个聊天下就有两个，停止键两个都停。
    @ObservationIgnored private var streams: [String: [ChatJob]] = [:]

    /// 回答正常结束后用服务器版本对账的请求，按会话 ID 各一个。
    @ObservationIgnored private var reconcileJobs: [String: ChatJob] = [:]

    /// 还没有会话 ID 的新聊天先选的图标（网页 draftIcon），按新聊天的本机键存：发出去后用户去了别的聊天，
    /// 拿到 X-Session-Id 时图标仍跟着这次发送迁过去并保存（网页 send 里的 sentIcon / latestIcon）。
    @ObservationIgnored private var draftIcons: [String: String] = [:]

    private let iconSync: SessionIconSync

    /// 登录 / 退出后加一：旧身份下还在收尾的回答不再写进缓存。
    @ObservationIgnored private var epoch = 0

    @ObservationIgnored private var loadJob: ChatJob?
    @ObservationIgnored private var sessionsJob: ChatJob?
    @ObservationIgnored private var versionJob: ChatJob?
    @ObservationIgnored private var branchJob: ChatJob?
    @ObservationIgnored private var localIds = 0
    @ObservationIgnored private var revealTokens = 0

    /// 正在接收回答（不是上传附件、不是生成图片）的任务：只有它们能请服务端停止。
    @ObservationIgnored private var chatJobs: Set<ObjectIdentifier> = []

    /// 已经请服务端停止、在等回答结束的聊天。
    @ObservationIgnored private var stopping: Set<String> = []

    /// 每个聊天各自的角色短暂完成 / 出错反馈与计时任务（切换聊天或在别的聊天里发送不会取消其它聊天的计时）。
    @ObservationIgnored private var outcomes: [String: CharacterOutcome] = [:]
    @ObservationIgnored private var outcomeJobs: [String: ChatJob] = [:]

    /// 当前聊天正在上传附件时退回来的提问：上传成功后 `beginTurn` 会清空输入栏，现在放回去会被一起清掉，
    /// 所以等上传结束（发出、失败或离开后不发）再放。
    @ObservationIgnored private var pendingRestores: [Restore] = []

    /// 每次换到别的聊天（新聊天、打开历史聊天、打开刚建的聊天）加一，用来判断慢请求回来时用户是否已经去了别处。
    @ObservationIgnored private(set) var navigationCount = 0

    // 外部链接（通用链接 / URL scheme）：交给根界面，先关掉检索面板和抽屉再打开（它们是界面状态，不在 ViewModel 里）。
    // 有缓冲：冷启动时链接先于界面开始读。只给一处读。
    let linkRequests: AsyncStream<ChatLink>
    private let externalLinks: AsyncStream<ChatLink>.Continuation

    init(
        backend: ChatBackend,
        settings: SettingsStore,
        flushIntervalMs: Int = 40,
        bundledModels: @escaping () throws -> ModelsResponse? = { nil },
        savedState: ChatSavedState = MemoryChatSavedState(),
        /// 保存聊天图标（PATCH /api/sessions/:id {icon}），返回是否成功。
        saveIcon: @escaping @MainActor (_ sessionId: String, _ icon: String?) async -> Bool = { _, _ in false },
        onMessageIdChanged: @escaping @MainActor (_ sessionId: String, _ from: String, _ to: String) -> Void = { _, _, _ in },
        sleep: @escaping @MainActor (_ milliseconds: UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0 * 1_000_000) },
        now: @escaping @MainActor () -> Int = { Int(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.backend = backend
        self.settings = settings
        self.flushIntervalMs = flushIntervalMs
        self.bundledModels = bundledModels
        self.savedState = savedState
        self.onMessageIdChanged = onMessageIdChanged
        self.sleep = sleep
        self.now = now
        self.iconSync = SessionIconSync(saveIcon)
        let (links, continuation) = AsyncStream.makeStream(of: ChatLink.self)
        self.linkRequests = links
        self.externalLinks = continuation
        // 引用和草稿一起存下：进程被系统回收后（比如登录时离开了 App），提问和它引用的文字一起回来。
        self.state = ChatUiState(chosenModelId: settings.modelId, chosenReasoning: settings.reasoning, quote: savedState.quote)
        self.draft = savedState.draft ?? ""

        ChatJob.launch { [self] in await loadModels() }
        refreshSessions()
    }

    // MARK: - 小工具

    /// 改状态；没变就不写回去，免得界面白白重绘。
    private func update(_ change: (inout ChatUiState) -> Void) {
        var next = state
        change(&next)
        if next != state { state = next }
    }

    private func attempt<T>(_ body: () async throws -> T) async -> Result<T, Error> {
        do {
            return .success(try await body())
        } catch {
            return .failure(error)
        }
    }

    private func nextLocalId() -> String {
        localIds += 1
        return "\(Self.LOCAL_ID_PREFIX)\(localIds)"
    }

    func updateDraft(_ text: String) {
        let changed = text != draft
        if changed { draft = text }
        savedState.draft = text
        let activeKey = keyOf(state)
        if changed, outcomes[activeKey] == .error {
            flashOutcome(activeKey, nil)
        }
    }

    private func addStream(_ key: String, _ job: ChatJob) {
        streams[key, default: []].append(job)
    }

    @discardableResult
    private func removeStream(_ key: String, _ job: ChatJob) -> Bool {
        guard var jobs = streams[key], let index = jobs.firstIndex(where: { $0 === job }) else { return false }
        jobs.remove(at: index)
        streams[key] = jobs.isEmpty ? nil : jobs
        return true
    }

    private func keyOf(_ state: ChatUiState) -> String {
        state.activeSessionId ?? newChatKey
    }

    /// 写入某个聊天的消息；是当前聊天就同时更新界面。
    private func setCached(_ key: String, _ messages: [UiMessage]) {
        cache[key] = messages
        if keyOf(state) == key { update { $0.messages = messages } }
    }

    private func updateCached(_ key: String, _ transform: ([UiMessage]) -> [UiMessage]) {
        setCached(key, transform(cache[key] ?? []))
    }

    /// 服务器版本换掉某个聊天的缓存（打开时的读取、重试、检索前补读、回答结束后的对账，前台后台都一样）：
    /// 沿用本地 key 并报告换掉的 ID，行不会重建，"已存到笔记"也不会挂在旧 ID 上。
    private func applyLoaded(_ sessionId: String, _ list: [MessageDto]) {
        let old = cache[sessionId] ?? []
        let messages = carryLocalKeys(old, list.map(toUiMessage))
        for (from, to) in replacedLocalIds(old, messages) { onMessageIdChanged(sessionId, from, to) }
        setCached(sessionId, messages)
    }

    /// 界面上的草稿图标只属于当前新聊天；打开的是已保存的聊天时为空。
    private func syncDraftIcon() {
        update { $0.draftIcon = $0.activeSessionId == nil ? draftIcons[newChatKey] : nil }
    }

    /// `ChatUiState.sending` 只看当前聊天；`ChatUiState.generatingSessionIds` 是所有在发送的聊天。
    private func syncBusy() {
        let generating = Set(streams.keys.filter { !$0.hasPrefix(Self.NEW_CHAT_PREFIX) })
        stopping = stopping.filter { streams[$0] != nil }
        update {
            let key = keyOf($0)
            $0.sending = streams[key] != nil
            $0.stopping = stopping.contains(key)
            $0.generatingSessionIds = generating
        }
    }

    private func syncOutcome() {
        update { $0.characterOutcome = outcomes[keyOf($0)] }
    }

    private func flashOutcome(_ key: String, _ kind: CharacterOutcome?) {
        outcomeJobs.removeValue(forKey: key)?.cancel()
        guard let kind else {
            if outcomes.removeValue(forKey: key) != nil { syncOutcome() }
            return
        }
        outcomes[key] = kind
        syncOutcome()
        let job = ChatJob()
        outcomeJobs[key] = job
        job.start { [self] in
            try? await sleep(UInt64(kind.durationMs))
            if job.isCancelled { return }
            if outcomes[key] == kind {
                outcomes[key] = nil
                outcomeJobs[key] = nil
                syncOutcome()
            }
        }
    }

    // MARK: - 聊天列表

    // 同时只保留最新的一次刷新：旧请求被取消，在途结果丢弃，避免旧列表盖掉新列表。
    func refreshSessions() {
        sessionsJob?.cancel()
        let job = ChatJob()
        sessionsJob = job
        job.start { [self] in
            update {
                $0.sessionsLoading = $0.sessions.isEmpty
                $0.sessionsFailed = false
            }
            let iconMark = iconSync.mark()
            let result = await attempt { try await backend.sessions() }
            if job.isCancelled { return }
            switch result {
            case .success(let fetched):
                // 读列表期间改过（或还在保存）的图标盖回去，旧列表不能把刚选的图标冲掉。
                let list = iconSync.reconcile(fetched, startedAt: iconMark)
                update {
                    $0.sessions = list
                    $0.sessionsLoading = false
                    $0.sessionsFailed = false
                }
            case .failure:
                update {
                    $0.sessionsLoading = false
                    $0.sessionsFailed = $0.sessions.isEmpty
                }
            }
        }
    }

    // ---- 侧栏整理（置顶、改名、移动、删除、排序、在项目里新建）：接口调用在 SidebarViewModel，这里只改本地状态 ----

    /// 服务端已保存的改动写进本地列表。进行中的刷新可能读到改动前的列表，所以让它重读一次。
    func patchSessions(_ transform: ([SessionSummary]) -> [SessionSummary]) {
        update { $0.sessions = transform($0.sessions) }
        if sessionsJob?.isActive == true { refreshSessions() }
    }

    /// 聊天已删除：从列表去掉；删的是正在看的聊天时回到新聊天（网页 deleteSession）。
    func onSessionDeleted(_ id: String) {
        cache[id] = nil
        outcomeJobs.removeValue(forKey: id)?.cancel()
        outcomes[id] = nil
        if state.activeSessionId == id { newChat() }
        patchSessions { list in list.filter { $0.id != id } }
    }

    /// 刚在项目里建好的空聊天：放到列表最前并打开（网页 createSession(projectId)）。别的聊天的回答照常继续。
    func openCreatedSession(_ session: SessionSummary) {
        // 从还没发过东西的新聊天过来：先选的图标带到建好的聊天上（网页 createEmptySession(carriedIcon, projectId)）。
        // 已经发出去、还在等会话 ID 的新聊天的图标属于那次发送，不带走。附件还在上传（缓存里还没有消息）的不算发出去：
        // 离开后这次上传不会发出（见 send），图标也跟着到建好的聊天上。
        let from = keyOf(state)
        let carried = state.activeSessionId == nil && (cache[from] ?? []).isEmpty ? draftIcons.removeValue(forKey: from) : nil
        var created = session
        created.icon = session.icon ?? carried
        cache[session.id] = []
        // 先把带图标的聊天放进列表再打开、再保存：保存时先显示的那一步要能找到这一行。
        update { $0.sessions = [created] + $0.sessions.filter { $0.id != session.id } }
        show(session.id)
        if let carried, session.icon == nil { saveCreatedIcon(session.id, carried) }
        // 进行中的刷新可能读到建好之前的列表，回来会把新聊天盖掉：让它重读。
        if sessionsJob?.isActive == true { refreshSessions() }
    }

    /// 建好了，但用户在等待期间已经去了别的聊天：只加进列表，不打开。
    func addCreatedSession(_ session: SessionSummary) {
        patchSessions { list in [session] + list.filter { $0.id != session.id } }
    }

    // 首次启动时，设备 Cookie 由第一个到达服务端的请求签发。发送前先等会话列表请求结束，
    // 否则它和 /api/chat 各签发一个身份，后到的 Cookie 会覆盖先到的，第一个聊天就读不回来了。
    func awaitSessionsRequest() async {
        while let job = sessionsJob, job.isActive {
            await job.join()
            // 自己被取消（停止键、换身份）就不再等：Kotlin 的 join() 在这里抛 CancellationException。
            if Task.isCancelled { return }
        }
    }

    /// 登录或退出后身份变了：停掉所有聊天的回答，清掉缓存和列表，按新身份重新加载。
    func onIdentityChanged() {
        epoch += 1
        // 等着放回的提问：文字留着，附件和待发送附件一样不跨登录保留。
        pendingRestores = pendingRestores.map { Restore(text: $0.text, files: [], pages: []) }
        // 被拒的改写：输入栏空着时把那段文字放进输入栏，登录后还在（网页登录前把它预存为草稿）。
        if let rejected = state.rejectedEdit, ApiText.isBlank(draft) { updateDraft(rejected.text) }
        let running = streams.values.flatMap { $0 }
        streams = [:]
        running.forEach { $0.cancel() }
        let reconciling = Array(reconcileJobs.values)
        reconcileJobs = [:]
        reconciling.forEach { $0.cancel() }
        cache = [:]
        draftIcons = [:]
        loadJob?.cancel()
        let flashing = Array(outcomeJobs.values)
        outcomeJobs = [:]
        flashing.forEach { $0.cancel() }
        outcomes = [:]
        newChats += 1
        newChatKey = "\(Self.NEW_CHAT_PREFIX)\(newChats)"
        // 草稿文字留着（网页登录前把它预存起来、回来后放回输入栏）；附件和网页一样不跨登录保留（网页登录会重载页面，
        // 登录提示里也写着"登录时不会保留附件"）。
        update {
            $0.sessions = []
            $0.sessionsLoading = true
            $0.sessionsFailed = false
            $0.activeSessionId = nil
            $0.messages = []
            $0.messagesLoading = false
            $0.messagesFailed = false
            if $0.upload == nil { $0.files = [] }
            $0.attachedPages = []
            $0.notice = nil
            $0.guestLimit = nil
            $0.upgradeLimit = nil
            $0.reveal = nil
            $0.rejectedEdit = nil
            $0.draftIcon = nil
            $0.characterOutcome = nil
        }
        syncBusy()
        refreshSessions()
    }

    // MARK: - 聊天图标（网页 changeSessionIcon / changeDraftIcon）

    /// 顶栏或空白页标题旁的图标：已保存的聊天直接保存；还没保存的新聊天先记成草稿。
    func changeIcon(_ icon: String?) {
        if let id = state.activeSessionId {
            changeSessionIcon(id, icon)
            return
        }
        draftIcons[newChatKey] = icon
        syncDraftIcon()
    }

    /// 先显示，保存按聊天排队；失败时退回最后保存成功的图标并在输入栏上方提示。
    func changeSessionIcon(_ sessionId: String, _ icon: String?) {
        let current = state.sessions.first { $0.id == sessionId }?.icon
        saveIcon(sessionId, icon, current: current)
    }

    private func saveIcon(_ sessionId: String, _ icon: String?, current: String?) {
        ChatJob.launch { [self] in
            await iconSync.change(
                sessionId, icon, current: current,
                show: { value in self.showIcon(sessionId, value) },
                fail: { self.update { $0.notice = .iconFailed } }
            )
        }
    }

    private func showIcon(_ sessionId: String, _ icon: String?) {
        update { state in
            state.sessions = state.sessions.map { session in
                guard session.id == sessionId else { return session }
                var patched = session
                patched.icon = icon
                return patched
            }
        }
    }

    /// 新聊天在服务端建好了：把草稿图标存上去（原生的会话由 /api/chat 建，建的时候不带图标）。
    private func saveCreatedIcon(_ sessionId: String, _ icon: String) {
        saveIcon(sessionId, icon, current: nil)
    }

    // MARK: - 切换聊天

    /// 换到另一个聊天：先显示它缓存里的消息（生成中的回答也在里面）。
    private func show(_ sessionId: String?, loading: Bool = false) {
        navigationCount += 1
        loadJob?.cancel()
        let previous = keyOf(state)
        // 离开的是不在发送中的新聊天：没有会话 ID，之后再也回不来，缓存和草稿图标都不再有用
        // （打开别的聊天时丢掉草稿图标，网页 loadMessages 里的 changeDraftIcon(null)）。
        if previous.hasPrefix(Self.NEW_CHAT_PREFIX), streams[previous] == nil {
            cache[previous] = nil
            draftIcons[previous] = nil
            outcomeJobs.removeValue(forKey: previous)?.cancel()
            outcomes[previous] = nil
        }
        if sessionId == nil {
            newChats += 1
            newChatKey = "\(Self.NEW_CHAT_PREFIX)\(newChats)"
        }
        let key = sessionId ?? newChatKey
        // 换聊天时清掉输入栏上方的提示（网页 loadSession / createSession 的 setSendError("")）和之前的定位请求。
        update {
            $0.activeSessionId = sessionId
            $0.messages = cache[key] ?? []
            $0.messagesLoading = loading
            $0.messagesFailed = false
            $0.notice = nil
            $0.reveal = nil
            $0.rejectedEdit = nil
            $0.characterOutcome = outcomes[key]
        }
        syncDraftIcon()
        syncBusy()
    }

    func newChat() {
        // 已经在一个还没发过东西的新聊天里：不换（网页 createSession 同样直接返回），上传中的附件照常发出。
        if state.activeSessionId == nil && state.messages.isEmpty { return }
        show(nil)
    }

    func openSession(_ id: String) {
        if state.activeSessionId == id {
            navigationCount += 1
            // 之前的定位请求和链接错误都作废（网页 loadMessages 的 cancelReveal / setSendError("")）。
            update {
                $0.reveal = nil
                if $0.notice == .linkFailed { $0.notice = nil }
            }
            return
        }
        // 生成中的聊天以本机显示为准（服务器还没存下进行中的回答），不读历史（网页 loadMessages）。
        if streams[id] != nil {
            show(id)
            return
        }
        let cached = cache[id] ?? []
        show(id, loading: cached.isEmpty)
        // 缓存里有（例如刚在后台答完）就先显示，再静默换成服务器版本。
        loadMessages(id, quiet: !cached.isEmpty)
    }

    /// 从检索结果或链接打开聊天，有 `messageId` 时读完后滚到那条消息并闪一下（网页 openChatFromLink）。
    /// 在那个聊天自己的缓存里找：没有这条（别的设备后来加的）就先读服务器版本再定位，读完前保持"读取中"，
    /// 免得把存在的消息当成已删除。正在生成的聊天不重读（会盖掉进行中的回答），找不到就按不存在处理。
    func openSessionAt(_ id: String, messageId: String?) {
        let wasActive = state.activeSessionId == id
        openSession(id)
        guard let messageId else { return }
        revealTokens += 1
        let reveal = MessageReveal(sessionId: id, messageId: messageId, token: revealTokens)
        let cached = cache[id] ?? []
        if streams[id] != nil || cached.contains(where: { $0.id == messageId }) {
            update { $0.reveal = reveal }
            return
        }
        // 刚打开的聊天已经在读（有缓存时是静默读）；本来就开着的要补读一次。
        let reload = wasActive && !state.messagesLoading
        update {
            $0.reveal = reveal
            $0.messagesLoading = true
        }
        if reload { loadMessages(id, quiet: !cached.isEmpty) }
    }

    /// 链接里的 ID 形式不对：和网页一样回到新聊天，在输入栏上方提示读不到。
    func showLinkFailed() {
        newChat()
        update { $0.notice = .linkFailed }
    }

    func requestLink(_ link: ChatLink) {
        externalLinks.yield(link)
    }

    /// 把系统「分享」交来的内容放进一个新聊天的输入栏（不自动发送，用户补一句再发；Android 的 `applyIncomingShare`）。
    /// 已经在空的新聊天里时不换，输入栏里写了一半的话保留、分享的文字接在后面；换聊天时旧聊天的引用不带过来。
    func applyIncomingShare(text: String, loadFiles: (@MainActor () async throws -> [LocalFile])? = nil) {
        let switched = state.activeSessionId != nil || !state.messages.isEmpty
        newChat()
        if switched { clearQuote() }
        if !text.isEmpty { updateDraft(ShareIntake.mergeDraft(existing: draft, shared: text)) }
        if let loadFiles { importFiles(loadFiles) }
    }

    /// 界面处理完（滚到了、或消息已不存在）后清掉这次定位请求。
    func consumeReveal(_ token: Int) {
        update { if $0.reveal?.token == token { $0.reveal = nil } }
    }

    func reloadActive() {
        if let id = state.activeSessionId { loadMessages(id) }
    }

    private func loadMessages(_ sessionId: String, quiet: Bool = false) {
        loadJob?.cancel()
        let job = ChatJob()
        loadJob = job
        job.start { [self] in
            if !quiet {
                update {
                    $0.messagesLoading = true
                    $0.messagesFailed = false
                }
            }
            let result = await attempt { try await backend.messages(sessionId: sessionId) }
            // 在途请求被取消（切换会话、开始发送）后不能再写回界面。
            if job.isCancelled { return }
            let current = state.activeSessionId == sessionId && streams[sessionId] == nil
            switch result {
            case .success(let list):
                if current { applyLoaded(sessionId, list) }
                update {
                    if $0.activeSessionId == sessionId {
                        $0.messagesLoading = false
                        $0.messagesFailed = false
                    }
                }
            case .failure(let error):
                if !current {
                    update { $0.messagesLoading = false }
                } else if let api = error as? ApiException, api.status == 404 {
                    // 会话已不存在（别处删了）：和网页一样解除绑定，当作新聊天用，并提示读取失败。
                    cache[sessionId] = nil
                    show(nil)
                    update { $0.notice = .loadFailed }
                } else if quiet {
                    // 已显示缓存：保留它，只在输入栏上方提示（网页 setSendError）。
                    update {
                        $0.messagesLoading = false
                        $0.notice = .loadFailed
                    }
                } else {
                    update {
                        $0.messagesLoading = false
                        $0.messagesFailed = true
                    }
                }
            }
        }
    }

    // MARK: - 模型

    private func loadModels() async {
        let response: ModelsResponse
        if let fetched = try? await backend.models() {
            response = fetched
        } else if let bundled = try? bundledModels() {
            response = bundled
        } else {
            return
        }
        update {
            $0.models = response.models
            $0.defaultModelId = response.defaultModel
        }
    }

    func selectModel(_ id: String) {
        settings.modelId = id
        update { $0.chosenModelId = id }
        // 新模型不支持当前推理强度时，退回它的默认值。
        let reasoning = state.selectedReasoning
        settings.reasoning = reasoning
        update { $0.chosenReasoning = reasoning }
    }

    func selectReasoning(_ effort: String) {
        settings.reasoning = effort
        update { $0.chosenReasoning = effort }
    }

    // MARK: - 附件与图片模式

    func addFiles(_ incoming: [LocalFile]) {
        update { $0 = Self.withFiles($0, incoming) }
    }

    /// 附件要先在后台读出来（拷贝粘贴的图片、读文件名和大小）：读的期间 `ChatUiState.importing` 加一，发送键不可用；
    /// 读完后在同一次状态更新里减一并加进附件，中间不会有可以发送的空档。
    /// `load` 在主线程上被调用，里面的读写要自己放到后台（调一个不在主线程上的 async 函数即可）。
    func importFiles(_ load: @escaping @MainActor () async throws -> [LocalFile]) {
        update { $0.importing += 1 }
        ChatJob.launch { [self] in
            // 读不出来的附件当作没选（和读取函数里返回 nil 的情况一样）。
            let files = (try? await load()) ?? []
            update {
                $0.importing = max(0, $0.importing - 1)
                $0 = Self.withFiles($0, files)
            }
        }
    }

    private static func withFiles(_ state: ChatUiState, _ incoming: [LocalFile]) -> ChatUiState {
        if incoming.isEmpty || state.upload != nil { return state }
        var next = state
        if let error = selectionError(current: state.files, incoming: incoming, supportsImages: state.supportsImages) {
            next.notice = .rejected(error)
        } else {
            next.files = state.files + incoming
            next.notice = nil
        }
        return next
    }

    func removeFile(_ uri: String) {
        update {
            guard $0.upload == nil else { return }
            $0.files = $0.files.filter { $0.uri != uri }
            $0.notice = nil
        }
    }

    /// 添加笔记窗口点了「添加」：换成选好的这组（网页 setAttachedPages），清掉输入栏上方的提示。上传中不改。
    func setAttachedPages(_ pages: [ChatProjectNote]) {
        update {
            guard $0.upload == nil else { return }
            $0.attachedPages = pages
            $0.notice = nil
        }
    }

    func toggleRecentNote(_ note: ChatProjectNote) {
        update {
            guard $0.upload == nil else { return }
            $0.attachedPages = toggleAttachedNote($0.attachedPages, note, max: MAX_MESSAGE_NOTES)
            $0.notice = nil
        }
    }

    /// 回答里选中文字点了「问 NoteFable」：放到输入栏上方作为引用（再引用会换掉之前的）。
    func setQuote(_ text: String) {
        let quote = ChatQuote.normalize(text)
        // 上传附件时发出的内容已定，引用和附件一样不能改（网页同样）。
        if !quote.isEmpty {
            update {
                guard $0.upload == nil else { return }
                $0.quote = quote
                $0.notice = nil
            }
        }
        saveQuote()
    }

    private func saveQuote() {
        savedState.quote = state.quote
    }

    /// 点掉输入栏上方的引用。
    func clearQuote() {
        update { if $0.upload == nil { $0.quote = nil } }
        saveQuote()
    }

    /// 点掉输入栏上方的一篇笔记。
    func removeAttachedPage(_ id: String) {
        update {
            guard $0.upload == nil else { return }
            $0.attachedPages = $0.attachedPages.filter { $0.id != id }
            $0.notice = nil
        }
    }

    func dismissGuestLimit() {
        update { $0.guestLimit = nil }
    }

    func dismissUpgradeLimit() {
        update { $0.upgradeLimit = nil }
    }

    func setImageMode(_ on: Bool) {
        // 关掉「生成图片」正是"带着笔记不能生成图片"提示要用户做的事：提示随之消失。
        update {
            $0.imageMode = on
            if !on, $0.notice == .pagesInImageMode { $0.notice = nil }
        }
    }

    // MARK: - 发送

    /// 停止键：只停当前看着的这个聊天（上传附件中或回答中），别的聊天照常生成。
    ///
    /// 正在接收的回答：请服务端停止（`POST /api/sessions/:id/stop`），它把已生成的部分存好再结束流，这边像正常结束一样对账
    /// （断开连接不一定能传到服务端，回答可能照样生成完）。请求没成功、或等了一阵流还没结束，就自己取消。
    /// 还在上传附件、生成图片、或新聊天还没拿到会话 ID 时没有可停的回答，直接取消。
    func stop() {
        let key = keyOf(state)
        let jobs = streams[key] ?? []
        if jobs.isEmpty || stopping.contains(key) { return }
        let answering = jobs.filter { chatJobs.contains(ObjectIdentifier($0)) }
        jobs.filter { !chatJobs.contains(ObjectIdentifier($0)) }.forEach { $0.cancel() }
        if answering.isEmpty { return }
        if key.hasPrefix(Self.NEW_CHAT_PREFIX) {
            answering.forEach { $0.cancel() }
            return
        }
        stopping.insert(key)
        syncBusy()
        ChatJob.launch { [self] in
            let acknowledged = (try? await backend.stopSession(sessionId: key)) != nil
            if acknowledged {
                // 服务端每秒看一次停止的请求。等一阵还没结束就不等了。
                let deadline = Self.STOP_WAIT_MS / Self.STOP_WAIT_STEP_MS
                var waited = 0
                while waited < deadline, answering.contains(where: { $0.isActive }) {
                    guard (try? await sleep(UInt64(Self.STOP_WAIT_STEP_MS))) != nil else { break }
                    waited += 1
                }
            }
            answering.filter { $0.isActive }.forEach { $0.cancel() }
        }
    }

    /// 关掉重新打开的编辑框（取消）：被拒的改写不再留着。
    func dismissRejectedEdit() {
        update { $0.rejectedEdit = nil }
    }

    func send(_ text: String) {
        let prompt = ApiText.trim(text)
        let current = state
        // 历史还在加载、或加载失败时发送，新消息会插进空列表（失败页还会盖住它们）；而回答结束后的对账又会换掉整个列表。读到历史再发。
        if prompt.isEmpty || current.sending || current.messagesLoading || current.messagesFailed { return }
        if current.upload != nil || current.filesError != nil || current.importing > 0 { return }
        let key = keyOf(current)
        // 图片接口只收文字和参考图，不读笔记：不悄悄丢掉，提示用户（网页同样）。
        if current.imageMode && !current.attachedPages.isEmpty {
            update { $0.notice = .pagesInImageMode }
            flashOutcome(key, .error)
            return
        }
        // 放回被拒的提问时可能超过上限：不悄悄删减，让用户自己移除。
        if current.attachedPages.count > MAX_MESSAGE_NOTES {
            update { $0.notice = .tooManyPages }
            flashOutcome(key, .error)
            return
        }
        flashOutcome(key, nil)
        // 正在进行的静默对账返回的是发送前的快照，会抹掉刚加进去的消息，所以先取消。
        loadJob?.cancel()
        reconcileJobs.removeValue(forKey: key)?.cancel()

        let files = current.files
        let pages = current.attachedPages
        let imageMode = current.imageMode
        let modelId = current.selectedModel?.id
        // 有引用时，引用块放在提问前面一起发（网页 composeQuotedMessage）。被拒时整段放回，引用回到输入栏上方。
        let quote = current.quote
        let message = ChatQuote.compose(quote: quote, body: prompt)
        let rawText = quote != nil ? message : text
        let request = ChatRequest(
            message: message,
            sessionId: current.activeSessionId,
            model: modelId,
            reasoning: current.selectedReasoning,
            webSearch: current.selectedModel?.supportsWebSearch == false ? "off" : "auto",
            pages: pages.map(\.id)
        )

        if files.isEmpty {
            // 提问立即出现在对话里（不等任务被调度）。
            let run = TurnRun(key: key, epoch: epoch)
            let turn = beginTurn(run, prompt: message, rawText: rawText, files: files, pages: pages, imageMode: imageMode, modelId: modelId)
            launchTurn(run) { [self] in await runTurn(run, turn, request, imageMode: imageMode) }
            return
        }

        // 和网页一样先上传、成功后才把这条消息放进对话；上传失败时文字和附件都留在输入栏。
        update {
            $0.upload = .preparing
            $0.notice = nil
        }
        let navigation = navigationCount
        let run = TurnRun(key: key, epoch: epoch)
        launchTurn(run) { [self] in
            let tickets: [String]
            switch await uploadFiles(files, navigation: navigation) {
            case .cancelled:
                return nil
            case .failed:
                dropLeftNewChat(run.key)
                return nil
            case .uploaded(let uploaded):
                tickets = uploaded
            }
            // 上传期间去了别的聊天：和网页一样不发了，清掉传上去的文件；文字和附件还在输入栏。
            if navigation != navigationCount {
                flushRestores()
                dropLeftNewChat(run.key)
                await backend.discardUploads(tickets)
                return nil
            }
            // 上传期间笔记不能改（按钮不可用），所以发的还是开始上传时的这组。
            let turn = beginTurn(run, prompt: message, rawText: rawText, files: files, pages: pages, imageMode: imageMode, modelId: modelId)
            var withUploads = request
            withUploads.uploads = tickets
            return await runTurn(run, turn, withUploads, imageMode: imageMode)
        }
    }

    /// 没发出去的新聊天，而用户已经离开它：再也回不来，它的缓存和草稿图标都不留。
    private func dropLeftNewChat(_ key: String) {
        if !key.hasPrefix(Self.NEW_CHAT_PREFIX) || key == keyOf(state) { return }
        cache[key] = nil
        draftIcons[key] = nil
    }

    /// 一次发送所属的聊天。新聊天拿到会话 ID 后 `key` 换成它（`migrate`）。
    @MainActor
    private final class TurnRun {
        var key: String
        let epoch: Int
        var job = ChatJob()

        init(key: String, epoch: Int) {
            self.key = key
            self.epoch = epoch
        }
    }

    /// 一次发送的结果：会话 ID 和是否正常结束（决定要不要对账）。
    /// `stopped`：用户点了停止，服务端会把已经生成的部分存下来；`hasAnswer` 是停止时本机已经收到正文或提案。
    /// `resync`：编辑 / 重新生成没开始就失败了，画面已经退回原样，再按服务端的状态核对一次。
    private struct TurnOutcome {
        var sessionId: String?
        var completed: Bool
        var streamFailed = false
        var stopped = false
        var hasAnswer = false
        var resync = false
        /// 编辑 / 重新生成开始前就已经保存在服务端的消息 ID：对账时不能把它们当成"新存下的回答"。
        var knownBefore: Set<String> = []
    }

    /// 登记这个聊天的发送任务再启动，结束（完成、失败、停止）后注销并对账。
    private func launchTurn(_ run: TurnRun, _ body: @escaping @MainActor () async -> TurnOutcome?) {
        let job = run.job
        addStream(run.key, job)
        syncBusy()
        // 还没开始就被停止也要走完收尾（注销、去掉等待中的气泡）。
        job.start(skipIfCancelled: false) { [self] in
            let outcome = await body()
            let stopRequested = stopping.contains(run.key)
            removeStream(run.key, job)
            syncBusy()
            guard run.epoch == epoch, let outcome else { return }
            if outcome.streamFailed {
                flashOutcome(run.key, .error)
            } else if outcome.completed && !outcome.stopped && !stopRequested {
                flashOutcome(run.key, .completed)
            }
            if outcome.stopped {
                reconcileStopped(outcome.sessionId, hasAnswer: outcome.hasAnswer, knownBefore: outcome.knownBefore)
            } else {
                reconcile(outcome.sessionId, completed: outcome.completed || outcome.resync)
            }
        }
    }

    /// 新聊天拿到了服务端的会话 ID：缓存和进行中的任务迁过去；用户还在看它的话，当前聊天也换成这个 ID。
    ///
    /// 服务端先建会话、稍后才回 `X-Session-Id`，这期间用户可能已从侧栏打开了这个会话（读到的历史只有这次的提问），
    /// 甚至又发了一条。所以不覆盖已有的东西：读来的历史只会是这次发送自己的半份，换成本机这份；
    /// 之后在那边新发的消息（本机 ID）接在后面，它的任务也留着。
    private func migrate(_ run: TurnRun, _ sessionId: String) {
        let from = run.key
        if from == sessionId || run.epoch != epoch { return }
        let moved = cache.removeValue(forKey: from) ?? []
        // 读来的历史开头是这次发送自己的提问（服务端先存提问、回答结束才存回答）：去掉它，其余都留着——
        // 包括用户在那边又发、已经对过账（ID 已换成服务端 ID）的后续回合。
        // 这是新建的会话，读来的历史第一条一定是这次的提问（服务端 ID）。
        let dest = cache[sessionId] ?? []
        // 去掉开头这次回合的服务端副本（提问，以及图片模式下已存好的回答），从下一条提问起都留着。
        let later: [UiMessage]
        if let first = dest.first, first.role == .user, !first.id.hasPrefix(Self.LOCAL_ID_PREFIX) {
            if let next = dest.dropFirst().firstIndex(where: { $0.role == .user }) {
                later = Array(dest[next...])
            } else {
                later = []
            }
        } else {
            later = dest
        }
        if removeStream(from, run.job) { addStream(sessionId, run.job) }
        if let kind = outcomes.removeValue(forKey: from) {
            outcomeJobs.removeValue(forKey: from)?.cancel()
            flashOutcome(sessionId, kind)
        }
        run.key = sessionId
        if state.activeSessionId == nil && newChatKey == from { update { $0.activeSessionId = sessionId } }
        if keyOf(state) == sessionId {
            // 正在看它：本机这份更新，不再用读到的历史盖掉。
            loadJob?.cancel()
            update {
                $0.messagesLoading = false
                $0.messagesFailed = false
            }
        }
        setCached(sessionId, moved + later)
        // 草稿图标跟着这次发送走，用户已经去了别的聊天也一样（网页 send 里的 sentIcon / latestIcon）。
        if let icon = draftIcons.removeValue(forKey: from) { saveCreatedIcon(sessionId, icon) }
        syncDraftIcon()
        syncBusy()
    }

    /// 一次发送：两个气泡的本地 ID，以及被上限拒绝时要放回输入栏的原文、附件和笔记。
    private struct Turn {
        let assistantId: String
        let userId: String
        let rawText: String
        let files: [LocalFile]
        let pages: [ChatProjectNote]
        /// 编辑 / 重新生成：开始前这个聊天显示的消息。没开始就失败时退回它（提问不放回输入栏）。
        var before: [UiMessage]? = nil
        /// 编辑：改写的是哪条提问、改成了什么。被拒绝时把这段文字放回那条提问的编辑框。
        var edit: RejectedEdit? = nil
    }

    /// 把提问和等待中的回答放进对话，并清空输入栏里的附件和笔记。
    private func beginTurn(
        _ run: TurnRun,
        prompt: String,
        rawText: String,
        files: [LocalFile],
        pages: [ChatProjectNote],
        imageMode: Bool,
        modelId: String?
    ) -> Turn {
        let assistantId = nextLocalId()
        let userId = nextLocalId()
        let userMessage = UiMessage(
            userId, .user, prompt,
            // 发送后先用本机文件显示缩略图，回答结束后换成服务器保存的版本。
            attachments: files.map {
                AttachmentDto(id: $0.uri, filename: $0.name, mimeType: $0.mimeType, size: $0.size, dataUrl: $0.isImage ? $0.uri : nil)
            },
            pages: pages
        )
        let assistantMessage = UiMessage(
            assistantId, .assistant, "", streaming: true,
            // 图片不是聊天模型画的，回答上方不显示模型名（和网页一致）。
            modelId: imageMode ? nil : modelId, generatingImage: imageMode
        )
        updateCached(run.key) { $0 + [userMessage, assistantMessage] }
        update {
            $0.files = []
            $0.attachedPages = []
            $0.quote = nil
            $0.upload = nil
            $0.notice = nil
            $0.sentCount += 1
        }
        saveQuote()
        // 消息真正发出去之后才清空草稿：附件上传失败时文字还留在输入栏里。
        updateDraft("")
        // 上传期间别的聊天退回来的提问，等这里清空输入栏后再放回去。
        flushRestores()
        return Turn(assistantId: assistantId, userId: userId, rawText: rawText, files: files, pages: pages)
    }

    private enum UploadResult {
        case uploaded([String])
        case failed
        case cancelled
    }

    /// 上传进度从后台线程报回来，要晚一拍才到主线程：只收当前这个文件的，上传结束后迟到的不收。
    @MainActor
    private final class UploadReporter {
        var index = -1
    }

    /// 逐个上传附件，返回凭证；失败或被取消时清掉已上传的文件。
    private func uploadFiles(_ files: [LocalFile], navigation: Int) async -> UploadResult {
        var tickets: [String] = []
        let reporter = UploadReporter()
        do {
            await awaitSessionsRequest()
            try Task.checkCancellation()
            let plan = try await backend.prepareUploads(files)
            tickets = plan.uploads.map(\.ticket)
            guard plan.uploads.count >= files.count else { throw ChatTurnError("Upload slots are missing.") }
            for (index, file) in files.enumerated() {
                try Task.checkCancellation()
                reporter.index = index
                let report: @MainActor (Int) -> Void = { [weak self] percent in
                    guard let self, reporter.index == index else { return }
                    self.update { $0.upload = .uploading(index: index + 1, total: files.count, name: file.name, percent: percent) }
                }
                report(0)
                try await backend.uploadFile(slot: plan.uploads[index], mode: plan.mode, file: file) { percent in
                    Task { @MainActor in report(percent) }
                }
                try Task.checkCancellation()
                report(100)
            }
            reporter.index = -1
            update { $0.upload = nil }
            return .uploaded(tickets)
        } catch {
            reporter.index = -1
            await backend.discardUploads(tickets)
            let cancelled = error is CancellationError || Task.isCancelled
            // 用户已经去了别的聊天：不在那边的输入栏报错（网页只在 navigationIntent 没变时 setSendError）。
            let report = !cancelled && navigation == navigationCount
            update {
                $0.upload = nil
                if report { $0.notice = .uploadFailed }
            }
            if report { flashOutcome(keyOf(state), .error) }
            flushRestores()
            return cancelled ? .cancelled : .failed
        }
    }

    private func runTurn(_ run: TurnRun, _ turn: Turn, _ request: ChatRequest, imageMode: Bool) async -> TurnOutcome {
        imageMode ? await runImage(run, turn, request) : await runStream(run, turn, request)
    }

    private func runImage(_ run: TurnRun, _ turn: Turn, _ request: ChatRequest) async -> TurnOutcome {
        let assistantId = turn.assistantId
        var sessionId = request.sessionId
        var failure: Error?
        var completed = false
        // 网页在分到 /api/images 之前就记下开始时间：等待秒数不因界面重绘而归零。
        let startedAt = now()
        updateAssistant(run, assistantId) { $0.startedAt = startedAt }
        do {
            await awaitSessionsRequest()
            try Task.checkCancellation()
            let result = try await backend.generateImage(request)
            if let error = result.error { throw ChatTurnError(error) }
            guard let image = result.image, !image.dataUrl.isEmpty else { throw ChatTurnError("Failed to generate image.") }
            if sessionId == nil, let created = result.sessionId {
                sessionId = created
                migrate(run, created)
            }
            let imageId = nextLocalId()
            updateAssistant(run, assistantId) {
                $0.generatingImage = false
                $0.images = [GeneratedImageDto(id: imageId, dataUrl: image.dataUrl, mimeType: image.mimeType)]
            }
            completed = true
        } catch {
            // 被取消是用户点了停止。
            if !(error is CancellationError || Task.isCancelled) { failure = error }
        }
        finishAssistant(run, turn, failure)
        return TurnOutcome(sessionId: sessionId, completed: completed)
    }

    /// 回答结束（完成、失败或被停止）时收尾：去掉"进行中"状态，失败则记下原因。
    private func finishAssistant(_ run: TurnRun, _ turn: Turn, _ failed: Error?) {
        if run.epoch != epoch { return }
        if failed != nil { flashOutcome(run.key, .error) }
        let assistantId = turn.assistantId
        let apiError = failed as? ApiException
        let limited = apiError?.isUsageLimit == true
        // 还没拿到会话 ID 的新聊天失败了，而用户已经离开它：这个聊天再也打不开（网页发送前就建好了会话，
        // 侧栏里能找回）。把提问和附件放回输入栏，不留看不到的缓存。撞到上限也一样（未登录时照常显示登录提示）。
        if failed != nil, run.key.hasPrefix(Self.NEW_CHAT_PREFIX), run.key != keyOf(state) {
            if limited, let apiError { restoreRejected(turn, apiError) } else { restoreDraft(turn) }
            dropLeftNewChat(run.key)
            return
        }
        // 编辑 / 重新生成在收到任何内容之前失败（上限、断网、消息已不存在）：服务端没有留下新版本，
        // 退回开始前的画面，在输入栏上方说明原因（网页 rerunTurn 的同一分支）。
        if let before = turn.before, let failed {
            let assistant = cache[run.key]?.first { $0.id == assistantId }
            if assistant.map({ $0.content.isEmpty && $0.activity.isEmpty }) != false {
                setCached(run.key, before)
                let kind = apiError?.kind == "image" ? "image" : "chat"
                let guest = limited && apiError?.tier == "guest"
                let member = limited && apiError?.tier == "member"
                let detail = chatFailureDetail(failed)
                update {
                    let shown = keyOf($0) == run.key
                    if shown { $0.notice = .failed(detail: detail) }
                    if guest { $0.guestLimit = kind }
                    if member { $0.upgradeLimit = kind }
                    // 改写的文字不丢：那条提问的编辑框带着它重新打开。
                    if shown, let edit = turn.edit { $0.rejectedEdit = edit }
                }
                return
            }
        }
        if limited, let apiError { restoreRejected(turn, apiError) }
        updateCached(run.key) { list in
            list.compactMap { message -> UiMessage? in
                // 被拒的提问不再显示本机图片：附件已经放回输入栏（网页 stripAttachmentPreviewUrls）。
                if limited && message.id == turn.userId {
                    var stripped = message
                    stripped.attachments = message.attachments.map { attachment in
                        var plain = attachment
                        plain.dataUrl = nil
                        return plain
                    }
                    return stripped
                }
                if message.id != assistantId { return message }
                var done = message
                done.streaming = false
                done.generatingImage = false
                if limited {
                    done.content = apiError?.message ?? ""
                    done.usageLimit = true
                    done.failure = nil
                    return done
                }
                if let failed {
                    done.errorDetail = chatFailureDetail(failed)
                    return done
                }
                // 没收到任何内容就被停止：不留空气泡。已有过程或提案卡片（服务器已存了提案）时保留，和网页一样。
                if message.content.isEmpty && message.images.isEmpty && message.activity.isEmpty && message.proposals.isEmpty {
                    return nil
                }
                return done
            }
        }
        // 重新生成什么都没收到就停了：服务端的原回答还显示着（新回答存下时才换），画面也退回原样。
        if failed == nil, let before = turn.before, turn.edit == nil,
           cache[run.key]?.contains(where: { $0.id == assistantId }) == false {
            setCached(run.key, before)
        }
    }

    /// 上限拒绝的发送没有保存在任何地方：和网页一样把原文和附件放回输入栏。
    /// 等待期间又写了字或加了附件的话不覆盖，被拒的原文放在前面（空一行），附件也排在前面。
    /// 未登录用户（tier = guest）另外显示登录提示，免费用户（tier = member）显示升级提示。
    private func restoreRejected(_ turn: Turn, _ error: ApiException) {
        restoreDraft(turn)
        let kind = error.kind == "image" ? "image" : "chat"
        if error.tier == "guest" { update { $0.guestLimit = kind } }
        if error.tier == "member" { update { $0.upgradeLimit = kind } }
    }

    /// 要放回输入栏的原文、附件和笔记。
    private struct Restore {
        let text: String
        let files: [LocalFile]
        let pages: [ChatProjectNote]
    }

    private func restoreDraft(_ turn: Turn) {
        restoreDraft(Restore(text: turn.rawText, files: turn.files, pages: turn.pages))
    }

    /// 没发出去的原文和附件放回输入栏，排在等待期间新写的字和新加的附件前面。
    private func restoreDraft(_ restore: Restore) {
        if state.upload != nil {
            pendingRestores.append(restore)
            return
        }
        // 带引用的提问：引用回到输入栏上方，输入栏只放提问。等待期间已经选了别的引用时留着它，
        // 被拒的提问连同引用块整段放回输入栏（网页 restoreComposerText 同样）。
        let keepQuote = state.quote != nil
        let split: (quote: String?, body: String) = keepQuote ? (nil, restore.text) : ChatQuote.split(restore.text)
        updateDraft(Self.mergeRejectedDraft(split.body, draft))
        update { state in
            state.quote = split.quote ?? state.quote
            if !restore.files.isEmpty {
                state.files = restore.files + state.files.filter { current in !restore.files.contains { $0.uri == current.uri } }
            }
            // 笔记也排在前面；合起来超过上限也不删减（发送前提示用户移除，网页同样）。
            state.attachedPages = Self.mergeRestoredPages(restore.pages, state.attachedPages)
        }
        saveQuote()
    }

    /// 上传结束了：放回等着的提问。
    private func flushRestores() {
        if pendingRestores.isEmpty || state.upload != nil { return }
        let restores = pendingRestores
        pendingRestores = []
        restores.forEach { restoreDraft($0) }
    }

    /// 这边自己取消了回答（没能请服务端停止时的后备路径；请到了的话流正常结束，走 `reconcile`）。
    /// 服务端可能已经把生成的部分存下：本机收到过内容时，等那条新回答出现再换成服务器版本（网页 finishStoppedStream），
    /// 免得屏幕上的半截文字消失；一直没等到就保留本机这份。什么都没收到时不知道服务端的状态，不动画面。
    /// 期间又在这个聊天里发送就作废。
    private func reconcileStopped(_ sessionId: String?, hasAnswer: Bool, knownBefore: Set<String>) {
        guard let finished = sessionId else { return }
        refreshSessions()
        if !hasAnswer { return }
        reconcileJobs.removeValue(forKey: finished)?.cancel()
        // 重新生成时原来的回答已经从画面上拿掉，但服务端还显示着它：它不是新存下的回答。
        let known = knownBefore.union((cache[finished] ?? []).map(\.id))
        let job = ChatJob()
        reconcileJobs[finished] = job
        job.start { [self] in
            defer { if reconcileJobs[finished] === job { reconcileJobs[finished] = nil } }
            for wait in Self.STOP_SYNC_WAITS {
                guard (try? await sleep(UInt64(wait))) != nil, !job.isCancelled else { return }
                let list = try? await backend.messages(sessionId: finished)
                if job.isCancelled || streams[finished] != nil { return }
                guard let list, let last = list.last, last.role.uppercased() == "ASSISTANT", !known.contains(last.id) else { continue }
                applyLoaded(finished, list)
                return
            }
        }
    }

    // MARK: - 重新生成、编辑、版本切换、分支（网页 page.tsx 的 rerunTurn / showVersion / branchChat）

    /// 用现在选的模型和推理强度重做这条回答。原来的回答留在服务端，用「‹ 2/3 ›」切回去。
    func regenerate(_ messageId: String) {
        rerun(messageId, text: nil)
    }

    /// 改写自己的提问并重新回答。原来的提问和它后面的对话留在服务端，用「‹ 2/3 ›」切回去。
    func editMessage(_ messageId: String, text: String) {
        let content = ApiText.trim(text)
        if !content.isEmpty { rerun(messageId, text: content) }
    }

    private func rerun(_ messageId: String, text: String?) {
        let current = state
        guard let sessionId = current.activeSessionId else { return }
        if current.sending || current.messagesLoading || current.messagesFailed || current.upload != nil { return }
        if versionJob?.isActive == true { return }
        let before = cache[sessionId] ?? []
        guard let index = before.firstIndex(where: { $0.id == messageId }) else { return }
        let target = before[index]
        if target.role != (text != nil ? MessageRole.user : MessageRole.assistant) { return }
        loadJob?.cancel()
        reconcileJobs.removeValue(forKey: sessionId)?.cancel()
        flashOutcome(sessionId, nil)

        // 从这条消息起先从画面上拿掉，放上新版本的位置；服务端只是把它们隐藏，不删除。
        let modelId = current.selectedModel?.id
        let assistantId = nextLocalId()
        let userId = nextLocalId()
        var shown = Array(before[..<index])
        if let text {
            var edited = target
            edited.id = userId
            edited.key = userId
            edited.content = text
            edited.versions = nil
            shown.append(edited)
        }
        shown.append(UiMessage(assistantId, .assistant, "", streaming: true, modelId: modelId))
        setCached(sessionId, shown)
        update {
            $0.notice = nil
            $0.reveal = nil
            $0.rejectedEdit = nil
        }
        let request = ChatRequest(
            message: text ?? "",
            sessionId: sessionId,
            model: modelId,
            reasoning: current.selectedReasoning,
            webSearch: current.selectedModel?.supportsWebSearch == false ? "off" : "auto",
            edit: text != nil ? messageId : nil,
            regenerate: text == nil ? messageId : nil
        )
        let run = TurnRun(key: sessionId, epoch: epoch)
        let turn = Turn(
            assistantId: assistantId, userId: userId, rawText: "", files: [], pages: [], before: before,
            edit: text.map { RejectedEdit(messageId: messageId, text: $0) }
        )
        launchTurn(run) { [self] in await runStream(run, turn, request) }
    }

    /// 显示另一个版本（编辑前的提问、之前的回答），它后面的对话一起换。
    func showVersion(_ messageId: String) {
        let current = state
        guard let sessionId = current.activeSessionId else { return }
        if current.sending || current.messagesLoading || streams[sessionId] != nil || versionJob?.isActive == true { return }
        loadJob?.cancel()
        reconcileJobs.removeValue(forKey: sessionId)?.cancel()
        flashOutcome(sessionId, nil)
        update {
            $0.notice = nil
            $0.reveal = nil
        }
        let identity = epoch
        let job = ChatJob()
        versionJob = job
        job.start { [self] in
            let result = await attempt { () -> [MessageDto] in
                try await backend.showVersion(sessionId: sessionId, messageId: messageId)
                return try await backend.messages(sessionId: sessionId)
            }
            if job.isCancelled || identity != epoch { return }
            switch result {
            case .success(let list):
                if streams[sessionId] == nil { applyLoaded(sessionId, list) }
            case .failure(let error):
                let detail = (error as? ApiException)?.message ?? Self.VERSION_SWITCH_FAILED
                update { if $0.activeSessionId == sessionId { $0.notice = .failed(detail: detail) } }
            }
        }
    }

    /// 把到这条回答为止的对话复制成一个新聊天并打开它（`title` 是界面按语言拼好的「分支 · 原标题」）。原聊天不变。
    func branch(_ messageId: String, title: String) {
        guard let sessionId = state.activeSessionId else { return }
        if branchJob?.isActive == true { return }
        update { $0.notice = nil }
        let navigation = navigationCount
        let identity = epoch
        let job = ChatJob()
        branchJob = job
        job.start { [self] in
            let result = await attempt { try await backend.branchSession(sessionId: sessionId, messageId: messageId, title: title) }
            // 等待期间登录 / 退出了：那是之前身份的聊天，不放进现在的列表。
            if job.isCancelled || identity != epoch { return }
            switch result {
            case .success(let session):
                // 等待期间去了别的聊天：只加进列表，不把用户拉走。
                if navigation != navigationCount {
                    addCreatedSession(session)
                    return
                }
                update { $0.sessions = [session] + $0.sessions.filter { $0.id != session.id } }
                openSession(session.id)
                if sessionsJob?.isActive == true { refreshSessions() }
            case .failure(let error):
                let detail = (error as? ApiException)?.message ?? Self.BRANCH_FAILED
                update { if $0.activeSessionId == sessionId { $0.notice = .failed(detail: detail) } }
            }
        }
    }

    /// 正常结束时用服务器上保存的版本对账（拿到真实 ID、生成的图片、思考时长），只换这个聊天自己的缓存，
    /// 不管用户现在看的是哪个聊天（网页 refreshSessionMessages）。
    /// 被停止时走 `reconcileStopped`：要等服务端把半截回答存好，换早了屏幕上的文字会凭空消失。
    private func reconcile(_ sessionId: String?, completed: Bool) {
        guard let finished = sessionId else { return }
        refreshSessions()
        if !completed { return }
        reconcileJobs.removeValue(forKey: finished)?.cancel()
        let job = ChatJob()
        reconcileJobs[finished] = job
        job.start { [self] in
            let list = try? await backend.messages(sessionId: finished)
            // 这期间又在这个聊天里发了新消息：快照是旧的，不用；空列表也不冲掉本机已收到的回答。
            if !job.isCancelled, let list, !list.isEmpty, streams[finished] == nil { applyLoaded(finished, list) }
            if reconcileJobs[finished] === job { reconcileJobs[finished] = nil }
        }
    }

    /// 流里攒着、还没刷到界面上的正文和过程事件，以及那次定时刷新。
    @MainActor
    private final class StreamBuffer {
        var pending = ""
        // 过程事件（推理摘要是很碎的增量）和正文一起攒着，每次刷新只重绘一次（网页每次 read 合并一次）。
        var events: [ActivityEvent] = []
        var flushTask: Task<Void, Never>?
    }

    private func flush(_ buffer: StreamBuffer, _ run: TurnRun, _ assistantId: String, startedAt: Int) {
        if buffer.pending.isEmpty && buffer.events.isEmpty { return }
        let chunk = buffer.pending
        buffer.pending = ""
        let events = buffer.events
        buffer.events = []
        let receivedAt = now()
        updateAssistant(run, assistantId) {
            $0.content += chunk
            $0.activity = Activity.apply($0.activity, events)
            // 正文开始出现前的时间就是"思考了多久"。
            if $0.thinkingMs == nil, !chunk.isEmpty { $0.thinkingMs = receivedAt - startedAt }
        }
    }

    /// 有东西攒着时，过 `flushIntervalMs` 刷一次（Kotlin 端是每隔这么久看一次的定时器；这里只在有内容时才定时）。
    private func scheduleFlush(_ buffer: StreamBuffer, _ run: TurnRun, _ assistantId: String, startedAt: Int) {
        if buffer.flushTask != nil { return }
        buffer.flushTask = Task { @MainActor [self] in
            try? await sleep(UInt64(flushIntervalMs))
            if Task.isCancelled { return }
            buffer.flushTask = nil
            flush(buffer, run, assistantId, startedAt: startedAt)
        }
    }

    private func runStream(_ run: TurnRun, _ turn: Turn, _ request: ChatRequest) async -> TurnOutcome {
        let assistantId = turn.assistantId
        let buffer = StreamBuffer()
        var sessionId = request.sessionId
        var failure: Error?
        var streamFailed = false
        var completed = false
        var stopped = false
        let startedAt = now()
        updateAssistant(run, assistantId) { $0.startedAt = startedAt }

        chatJobs.insert(ObjectIdentifier(run.job))
        do {
            await awaitSessionsRequest()
            try Task.checkCancellation()
            for try await event in backend.streamChat(request) {
                switch event {
                case .started(let created):
                    if sessionId == nil, let created {
                        sessionId = created
                        migrate(run, created)
                        refreshSessions()
                    }
                case .delta(let text):
                    buffer.pending += text
                    scheduleFlush(buffer, run, assistantId, startedAt: startedAt)
                case .activity(let payload):
                    // 进度条与提案卡片的事件；服务端追加的失败文的位置另外记下，并把本回合标为出错（不播完成反馈）。
                    if let parsed = Activity.parseEvent(payload) {
                        if case .failure = parsed { streamFailed = true }
                        buffer.events.append(parsed)
                        scheduleFlush(buffer, run, assistantId, startedAt: startedAt)
                    }
                    if let info = FailureInfo.from(payload) {
                        streamFailed = true
                        updateAssistant(run, assistantId) { $0.failure = info }
                    }
                }
            }
            // 读流的任务被取消时流直接结束、不抛错（见 ChatBackend.streamChat）。
            if Task.isCancelled { stopped = true } else { completed = true }
        } catch {
            // 用户点了停止：保留已经收到的文字。
            if error is CancellationError || Task.isCancelled { stopped = true } else { failure = error }
        }
        chatJobs.remove(ObjectIdentifier(run.job))
        buffer.flushTask?.cancel()
        buffer.flushTask = nil
        flush(buffer, run, assistantId, startedAt: startedAt)
        finishAssistant(run, turn, failure)

        let shown = cache[run.key]
        // 停止时本机还留着这条回答（有正文或提案）：服务端也会把它存下来。
        let hasAnswer = stopped && shown?.contains { message in
            message.id == assistantId && (!ApiText.isBlank(message.content) || !message.proposals.isEmpty || message.activity.contains { step in
                if case .proposal = step { return true }
                return false
            })
        } == true
        // 编辑 / 重新生成没开始就失败：finishAssistant 已经退回原样，再核对一次服务端的状态。
        let resync = failure != nil && turn.before != nil && shown?.contains { $0.id == assistantId } == false
        return TurnOutcome(
            sessionId: sessionId, completed: completed, streamFailed: streamFailed, stopped: stopped, hasAnswer: hasAnswer,
            resync: resync, knownBefore: Set((turn.before ?? []).map(\.id))
        )
    }

    private func updateAssistant(_ run: TurnRun, _ id: String, _ transform: (inout UiMessage) -> Void) {
        if run.epoch != epoch { return }
        updateCached(run.key) { list in
            list.map { message in
                guard message.id == id else { return message }
                var changed = message
                transform(&changed)
                return changed
            }
        }
    }

    private func toUiMessage(_ dto: MessageDto) -> UiMessage {
        let role: MessageRole
        switch dto.role.uppercased() {
        case "USER": role = .user
        case "ASSISTANT": role = .assistant
        default: role = .system
        }
        return UiMessage(
            dto.id, role, dto.content,
            attachments: dto.attachments.map { attachment in
                var absolute = attachment
                absolute.dataUrl = attachment.dataUrl.map(backend.absoluteUrl)
                return absolute
            },
            images: dto.generatedImages.map { image in
                var absolute = image
                absolute.dataUrl = backend.absoluteUrl(image.dataUrl)
                return absolute
            },
            pages: dto.pages,
            modelId: dto.model,
            thinkingMs: dto.thinkingMs,
            failure: FailureInfo.fromActivity(dto.activity),
            activity: Activity.parseStored(dto.activity),
            proposals: Activity.parseStoredProposals(dto.proposals),
            versions: dto.versions
        )
    }

    // MARK: - 常量与纯函数

    /// 还没有会话 ID 的新聊天的本机键前缀（服务端的 ID 不会这样开头）。
    static let NEW_CHAT_PREFIX = "new-chat:"

    /// 本机先放进对话的消息的 ID 前缀（服务端的 ID 不会这样开头）。
    static let LOCAL_ID_PREFIX = "local-"

    /// 自己取消回答后，等服务端存好半截回答再对账：每次读取前等的毫秒数（网页 finishStoppedStream 的 500 / 1000 / 2000）。
    private static let STOP_SYNC_WAITS = [500, 1000, 2000]

    /// 请服务端停止后，最多等这么久让回答自己结束（网页 8 秒），每隔一小段看一次。
    private static let STOP_WAIT_MS = 8000
    private static let STOP_WAIT_STEP_MS = 200

    /// 网页字典里的原句（译文在 system-text.json），服务端没给出原因时用。
    static let VERSION_SWITCH_FAILED = "Could not switch versions. Try again."
    static let BRANCH_FAILED = "Could not branch this chat. Try again."

    /// 被拒的提问的笔记排在前面，等待期间新选的笔记接在后面（同一篇只留一份；网页 setAttachedPages 的合并）。
    nonisolated static func mergeRestoredPages(_ restored: [ChatProjectNote], _ current: [ChatProjectNote]) -> [ChatProjectNote] {
        restored.isEmpty ? current : restored + current.filter { page in !restored.contains { $0.id == page.id } }
    }

    /// 被拒的原文 + 等待期间写的字（网页 page.tsx 的 restored）。
    nonisolated static func mergeRejectedDraft(_ rejected: String, _ typedMeanwhile: String) -> String {
        ApiText.isBlank(typedMeanwhile) ? rejected : ChatText.trimEnd(rejected) + "\n\n" + typedMeanwhile
    }

    /// 测试用：按聊天存的表（缓存、草稿图标）里还留着的新聊天本机键。没有再也打不开的新聊天时为空。
    var leftoverNewChats: [String] {
        Set(cache.keys).union(draftIcons.keys).filter { $0.hasPrefix(Self.NEW_CHAT_PREFIX) }.sorted()
    }
}
