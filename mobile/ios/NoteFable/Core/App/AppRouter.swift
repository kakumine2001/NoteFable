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

    /// 检索结果里的笔记：结果自带标题和图标，列表还没读过也能开。
    /// 直接交给 openNote（Android NoteFableRoot 的 onOpenNote 也是）：它自己先存当前笔记、再切到笔记工作区。
    /// 不能包在 setWorkspace(.notes) { … } 里：那个回调在导航进行中执行，openNote 会被当成重复导航丢掉。
    func openNote(_ id: String, title: String?, icon: String?) {
        dismissOverlays()
        app.notes.openNote(id, title: title, icon: icon)
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

    /// 取走一份分享，切到聊天、放进新聊天的输入栏（不自动发送）。先关掉检索面板、抽屉和设置。
    private func openIncomingShare(id: String?) async {
        guard let payload = await app.consumeSharePayload(id), !payload.text.isEmpty || !payload.files.isEmpty else { return }
        dismissOverlays()
        settingsOpen = false
        let files = payload.files
        app.notes.setWorkspace(.chat) { [app] in
            app.chat.applyIncomingShare(text: payload.text, loadFiles: files.isEmpty ? nil : { files })
        }
    }

    /// 登录 / 退出后：旧身份整理好的笔记打不开了（网页登录 / 退出会重新加载页面）。
    func onIdentityChanged() {
        createPageSessionId = nil
        // 检索面板里还是旧身份的结果。
        searchOpen = false
    }

    private func dismissOverlays() {
        searchOpen = false
        drawerOpen = false
    }
}
