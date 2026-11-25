import Foundation
import Observation

/// 跨界面的导航状态：抽屉、全屏面板和“打开某篇笔记 / 某段聊天”。
/// Android 里这些是 `NoteFableRoot` 的局部状态加 `LocalOpenNote` 等 CompositionLocal；
/// 这里集中成一个对象，各界面经 `@Environment(AppRouter.self)` 读写，互相不直接依赖。
@MainActor
@Observable
final class AppRouter {
    private let app: AppEnvironment

    /// 侧边栏抽屉。
    var drawerOpen = false
    /// 全屏检索面板（抽屉的 Search 行、顶栏的搜索按钮）。
    var searchOpen = false
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
    func openSearch() { searchOpen = true }
    func openSettings() { settingsOpen = true }
    func openSignIn() { signInOpen = true }

    /// 打开一篇笔记（提案卡片的“打开笔记”、项目上下文的笔记标签、发言下的笔记标签、“打开已保存的笔记”）。
    /// 网页 openNoteFromLink：马上切到笔记列表，刷新后笔记在就打开，不在就留在列表上。
    func openNote(_ id: String) {
        dismissOverlays()
        app.notes.openNoteFromLink(id)
    }

    /// 检索结果里的笔记：结果自带标题、图标和页面类型，列表还没读过也能开；[reveal] 是命中的块 / 元素，编辑器打开后定位过去。
    /// 直接交给 openNote（Android NoteFableRoot 的 onOpenNote 也是）：它自己先存当前笔记、再切到笔记工作区。
    /// 不能包在 setWorkspace(.notes) { … } 里：那个回调在导航进行中执行，openNote 会被当成重复导航丢掉。
    func openNote(_ id: String, title: String?, icon: String?, kind: PageKind = .note, reveal: String? = nil) {
        dismissOverlays()
        app.notes.openNote(id, title: title, icon: icon, kind: kind, reveal: reveal)
    }

    /// 打开一段聊天并定位到某条消息（检索结果、聊天链接）。在笔记里时先保存笔记，存不上就留在笔记里、不动聊天。
    func openChat(_ sessionId: String, messageId: String? = nil) {
        openLink(.open(chatId: sessionId, messageId: messageId))
    }

    /// 外部链接（Universal Link、笔记里点到的聊天链接）：先关掉检索面板和抽屉，再切到那段聊天。
    func openLink(_ link: ChatLink) {
        dismissOverlays()
        app.notes.setWorkspace(.chat) { [app] in
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

    /// 取走分享并放进新聊天的输入栏（不自动发送）。先确保切到聊天工作区再从共享目录取走删除：
    /// 如果当前笔记保存失败留在笔记里，分享内容继续安全留在共享目录，等用户切回聊天时再自动取走。
    private func openIncomingShare(id: String?) async {
        let deliver: @MainActor () async -> Void = { [weak self] in
            guard let self else { return }
            let payloads = await app.consumeSharePayloads(id).filter { !$0.text.isEmpty || !$0.files.isEmpty }
            guard !payloads.isEmpty else { return }
            dismissOverlays()
            settingsOpen = false
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
            defer { self?.flushingDiagramPages.remove(pageId) }
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

    /// 登录 / 退出后：旧身份整理好的笔记、画好的白板打不开了（网页登录 / 退出会重新加载页面）。
    func onIdentityChanged() {
        diagramIdentityGeneration += 1
        flushingDiagramPages.removeAll()
        createPageSessionId = nil
        diagramSource = nil
        // 检索面板里还是旧身份的结果。
        searchOpen = false
    }

    private func dismissOverlays() {
        searchOpen = false
        drawerOpen = false
    }
}
