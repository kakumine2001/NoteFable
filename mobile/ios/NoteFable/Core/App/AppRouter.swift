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
    func openNote(_ id: String, title: String?, icon: String?) {
        dismissOverlays()
        app.notes.setWorkspace(.notes) { [app] in
            app.notes.openNote(id, title: title, icon: icon)
        }
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

    /// 系统交来的网址（`onOpenURL` / `NSUserActivity`）。不是本站的聊天链接返回 false。
    @discardableResult
    func handleIncomingURL(_ url: URL) -> Bool {
        guard let link = ChatLink.parse(url.absoluteString, baseUrl: app.config.baseURL) else { return false }
        app.chat.requestLink(link)
        return true
    }

    /// 登录 / 退出后：旧身份整理好的笔记打不开了（网页登录 / 退出会重新加载页面）。
    func onIdentityChanged() {
        createPageSessionId = nil
    }

    private func dismissOverlays() {
        searchOpen = false
        drawerOpen = false
    }
}
