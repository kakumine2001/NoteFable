import Foundation
import Observation

/// 底部导航标签页：聊天 / 工作区 / 搜索。
enum AppTab: Hashable, Sendable {
    case chat
    case workspace
    case search
}

/// 跨界面的导航状态：抽屉、底部标签页、全屏面板和“打开某篇笔记 / 某段聊天”。
@MainActor
@Observable
final class AppRouter {
    private let app: AppEnvironment

    /// 侧边栏抽屉。
    var drawerOpen = false
    /// 当前底部标签页。
    var selectedTab: AppTab = .chat
    /// 设置（登录后点侧栏的账号行）。
    var settingsOpen = false
    /// 登录窗口（侧栏底部和上限提示的“登录”按钮）。
    var signInOpen = false
    /// 「整理成笔记」窗口开着的聊天（网页 createPageSessionId）。
    var createPageSessionId: String?
    /// 「画成图」窗口显示的素材（状态在 `app.diagrams`）。
    var diagramSource: DiagramSource?

    private var linkTask: Task<Void, Never>?
    private var shareTask: Task<Void, Never>?
    /// 每次导航动作递增，确保延迟完成的异步新建项目聊天不会覆盖用户后续的新切换（如打开笔记）。
    private var navigationEpoch = 0

    init(app: AppEnvironment) {
        self.app = app
    }

    /// 开始接收外部链接（`ChatViewModel.linkRequests`）。重复调用无效。
    func start() {
        guard linkTask == nil else { return }
        let links = app.chat.linkRequests
        linkTask = Task { [weak self] in
            for await link in links {
                self?.openLink(link)
            }
        }
    }

    func openDrawer() { drawerOpen = true }
    func closeDrawer() { drawerOpen = false }

    /// 切换底部标签页（必要时先保存当前打开的笔记，等工作区真正切换完成后再更新选中标签）。
    func selectTab(_ tab: AppTab) {
        navigationEpoch &+= 1
        drawerOpen = false
        switch tab {
        case .search:
            selectedTab = .search
        case .chat:
            if app.notes.state.workspace == .chat {
                selectedTab = .chat
            } else {
                app.notes.setWorkspace(.chat) { [weak self] in
                    self?.selectedTab = .chat
                }
            }
        case .workspace:
            if app.notes.state.workspace == .notes {
                selectedTab = .workspace
            } else {
                app.notes.setWorkspace(.notes) { [weak self] in
                    self?.selectedTab = .workspace
                }
            }
        }
    }

    func openSearch() {
        navigationEpoch &+= 1
        drawerOpen = false
        selectedTab = .search
    }

    func openSettings() { settingsOpen = true }
    func openSignIn() { signInOpen = true }

    /// 关闭抽屉并切到聊天新建会话（在笔记工作区时先保存打开的笔记）。
    func openNewChat() {
        navigationEpoch &+= 1
        drawerOpen = false
        let startNew: @MainActor () -> Void = { [weak self, app] in
            app.chat.newChat()
            self?.selectedTab = .chat
        }
        if app.notes.state.workspace == .chat {
            startNew()
        } else {
            app.notes.setWorkspace(.chat, then: startNew)
        }
    }

    /// 在项目里新建聊天；在笔记工作区时先保存打开的笔记并切换工作区，成功后才创建会话与关抽屉。
    func openNewChat(inProject projectId: String) {
        navigationEpoch &+= 1
        let epoch = navigationEpoch
        let createAndSwitch: @MainActor () -> Void = { [weak self, app] in
            Task { @MainActor in
                guard let self, self.navigationEpoch == epoch else { return }
                guard await app.sidebar.newChatInProject(projectId) else { return }
                guard self.navigationEpoch == epoch, app.notes.state.workspace == .chat else { return }
                self.selectedTab = .chat
                self.drawerOpen = false
            }
        }
        if app.notes.state.workspace == .chat {
            createAndSwitch()
        } else {
            app.notes.setWorkspace(.chat, then: createAndSwitch)
        }
    }

    /// 在工作区新建页面（同步由 `NotesViewModel.createNote` 切入工作区，保证标签与工作区一致）。
    func createNote(parentId: String? = nil, kind: PageKind = .note, groupId: String? = nil) {
        navigationEpoch &+= 1
        dismissOverlays()
        if app.notes.state.workspace == .notes {
            selectedTab = .workspace
        }
        app.notes.createNote(parentId: parentId, kind: kind, groupId: groupId)
    }

    /// 打开一篇笔记（提案卡片的“打开笔记”、项目上下文的笔记标签、发言下的笔记标签、“打开已保存的笔记”、统一抽屉）。
    func openNote(_ id: String) {
        navigationEpoch &+= 1
        dismissOverlays()
        selectedTab = .workspace
        app.notes.openNoteFromLink(id)
    }

    /// 检索结果 / 列表里已知元信息的笔记，直接打开并切到工作区标签页。
    func openNote(_ id: String, title: String?, icon: String?, kind: PageKind = .note, reveal: String? = nil) {
        navigationEpoch &+= 1
        dismissOverlays()
        selectedTab = .workspace
        app.notes.openNote(id, title: title, icon: icon, kind: kind, reveal: reveal)
    }

    /// 打开一段聊天并定位到某条消息（检索结果、聊天链接、统一抽屉）。在笔记里时先保存笔记，存不上就留在笔记里、不动聊天。
    func openChat(_ sessionId: String, messageId: String? = nil) {
        openLink(.open(chatId: sessionId, messageId: messageId))
    }

    /// 外部链接（Universal Link、笔记里点到的聊天链接）：先关掉抽屉，再切到聊天工作区与标签页。
    func openLink(_ link: ChatLink) {
        navigationEpoch &+= 1
        dismissOverlays()
        app.notes.setWorkspace(.chat) { [weak self, app] in
            self?.selectedTab = .chat
            switch link {
            case .open(let chatId, let messageId):
                app.chat.openSessionAt(chatId, messageId: messageId)
            case .invalid:
                app.chat.showLinkFailed()
            }
        }
    }

    /// 系统交来的网址（`onOpenURL` / `NSUserActivity`）。不是本站的聊天链接、也不是分享扩展的 `notefable://share` 返回 false。
    @discardableResult
    func handleIncomingURL(_ url: URL) -> Bool {
        if let shareId = ShareIntake.parseShareURL(url) {
            enqueueShare(id: shareId)
            return true
        }
        guard let link = ChatLink.parse(url.absoluteString, baseUrl: app.config.baseURL) else { return false }
        app.chat.requestLink(link)
        return true
    }

    /// App 启动或回到前台时：取走分享扩展留在共享目录里、还没取的分享（扩展没能唤起 App 时的兜底）。
    func consumePendingShares() {
        enqueueShare(id: nil)
    }

    /// 取分享排成一条队：`onOpenURL` 和回到前台几乎同时来，不能两个同时去取（同一份分享会被放进输入栏两次）。
    private func enqueueShare(id: String?) {
        let previous = shareTask
        shareTask = Task { [weak self] in
            await previous?.value
            await self?.openIncomingShare(id: id)
        }
    }

    /// 取走分享并放进新聊天的输入栏（不自动发送）。
    private func openIncomingShare(id: String?) async {
        let deliver: @MainActor () async -> Void = { [weak self] in
            guard let self else { return }
            let payloads = await app.consumeSharePayloads(id).filter { !$0.text.isEmpty || !$0.files.isEmpty }
            guard !payloads.isEmpty else { return }
            dismissOverlays()
            settingsOpen = false
            selectedTab = .chat
            for payload in payloads {
                let files = payload.files
                app.chat.applyIncomingShare(text: payload.text, loadFiles: files.isEmpty ? nil : { files })
            }
        }
        if app.notes.state.workspace == .chat {
            await deliver()
            return
        }
        // 在笔记工作区时：只有真的有待取分享才尝试切回聊天；没切过去（例如笔记保存失败）就不删共享目录。
        guard await app.hasPendingShare(id) else { return }
        app.notes.setWorkspace(.chat) { [weak self] in
            self?.enqueueShare(id: id)
        }
    }

    // MARK: - 画成图

    // 正在等待保存（flushBeforeServerRead）的笔记 id：避免慢保存期间连点两次并发 flush 或重复开任务。
    @ObservationIgnored private var flushingDiagramPages: Set<String> = []
    @ObservationIgnored private var diagramIdentityGeneration = 0

    /// 回答"…"菜单的「画成图」：马上开始（不先确认）并打开进度窗口。同一素材已有任务时只是重新打开窗口，不再发一次。
    /// 模型用聊天里选着的（和「整理成笔记」相同）。返回开始的任务（已有任务时是 nil）。
    @discardableResult
    func drawDiagram(_ source: DiagramSource) -> Task<Void, Never>? {
        let task = app.diagrams.start(source, model: app.chat.state.selectedModel?.id)
        diagramSource = source
        return task
    }

    /// 笔记"…"菜单的「画成图」：已有任务时直接重开窗口（不重做保存）；否则服务端读的是已保存的正文，先让网页保存，
    /// 存不上就提示（编辑页顶栏下面）、不开始。同页保存中忽略重入；保存期间换了身份也不再开始。
    @discardableResult
    func drawDiagramFromNote(_ pageId: String) -> Task<Void, Never> {
        let source = DiagramSource.note(pageId: pageId)
        if app.diagrams.job(source) != nil {
            diagramSource = source
            return Task {}
        }
        guard flushingDiagramPages.insert(pageId).inserted else { return Task {} }
        let generation = diagramIdentityGeneration
        let notes = app.notes
        return Task { [weak self] in
            defer {
                if let self, self.diagramIdentityGeneration == generation {
                    self.flushingDiagramPages.remove(pageId)
                }
            }
            guard await notes.flushBeforeServerRead(pageId) else { return }
            guard let self, self.diagramIdentityGeneration == generation else { return }
            await self.drawDiagram(source)?.value
        }
    }

    /// 失败后的"重试"：同一个 clientRequestId。
    @discardableResult
    func retryDiagram(_ source: DiagramSource) -> Task<Void, Never>? {
        app.diagrams.retry(source, model: app.chat.state.selectedModel?.id)
    }

    /// 关窗口（"关闭"、点遮罩、打开白板之后）：已结束的任务忘掉，之后再点是新的任务；进行中的留着。
    func closeDiagram() {
        if let source = diagramSource { app.diagrams.forgetFinished(source) }
        diagramSource = nil
    }

    /// 完成后的"打开白板"：新白板先放进列表（从笔记来的展开父页面），打开它，再关窗口（网页：先打开再关）。
    func openDrawnDiagram(_ page: NotePageSummary) {
        app.notes.showCreatedPage(page)
        openNote(page.id, title: page.title, icon: page.icon, kind: page.kind)
        closeDiagram()
    }

    /// 登录 / 退出后：旧身份整理好的笔记、画好的白板与搜索状态恢复默认标签。
    func onIdentityChanged() {
        navigationEpoch &+= 1
        diagramIdentityGeneration += 1
        flushingDiagramPages.removeAll()
        createPageSessionId = nil
        diagramSource = nil
        if selectedTab == .search {
            selectedTab = (app.notes.state.workspace == .notes) ? .workspace : .chat
        }
    }

    private func dismissOverlays() {
        drawerOpen = false
    }
}
