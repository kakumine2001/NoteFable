import SwiftUI
import UIKit

/// App 的入口（Android 的 `NoteFableApp.kt` + `MainActivity.kt`）：建依赖（`AppEnvironment`）和导航状态（`AppRouter`），
/// 接上界面层才有的东西（Google 登录、表情字形检测），然后把根视图放进窗口。
/// 账号在 `AccountViewModel` 建好时就读一次（Android 的 ViewModel 同样在 init 里读），这里不用再读。
@main
struct NoteFableApp: App {
    @State private var app: AppEnvironment
    @State private var router: AppRouter

    @MainActor
    init() {
        let app = AppEnvironment()
        let router = AppRouter(app: app)
        // 画不出来的表情不进表情面板（要用 CoreText，所以在界面层接上）。
        app.emojiGlyphSupported = { emoji in EmojiGlyphs.isSupported(emoji) }
        // 系统「分享」：分享扩展写进 App Group 共享目录的内容，在这里检查并取走（Android 的 SEND intent）。
        app.hasPendingShare = { id in await ShareInboxBridge.hasPending(id: id) }
        app.consumeSharePayloads = { id in await ShareInboxBridge.consume(id: id) }
        GoogleSignInBridge.install(into: app)
        app.start()
        router.start()
        _app = State(initialValue: app)
        _router = State(initialValue: router)
    }

    var body: some Scene {
        WindowGroup {
            NoteFableWindow()
                .environment(app)
                .environment(router)
        }
    }
}

/// 窗口里的最外层：语言方向、区域、浅色，以及系统交来的链接。
/// 单独一个视图是为了让语言变化（`app.language`）能触发重绘。
private struct NoteFableWindow: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @State private var lastOpened: (url: URL, at: Date)? = nil

    var body: some View {
        let language = app.language
        RootView()
            // 阿拉伯语：整个界面从右往左排，抽屉从右边出来（Android 的 window.decorView.layoutDirection）。
            .environment(\.layoutDirection, language.isRightToLeft ? .rightToLeft : .leftToRight)
            // 日期、数字按界面语言写（不跟系统语言）。
            .environment(\.locale, Locale(identifier: language.active.tag ?? language.uiLocale))
            // 网页只有浅色主题。
            .preferredColorScheme(.light)
            // 自定义 URL scheme（Google 登录的回调）和 Universal Link 都可能从这里进来。
            .onOpenURL { url in open(url) }
            // Universal Link：`https://<工作区主机>/c/<会话>?message=<消息>` 等（规则在 `ChatLink.parse`；Android 的 VIEW intent）。
            // 同一个网址如果两边都收到，`open` 只处理一次。
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { open(url) }
            }
            // 回到前台时系统语言可能改过（Android 的 onConfigurationChanged）：按“自动”显示着的话重新解析。
            // 同时取走分享扩展留下的、还没取的分享（扩展没能唤起 App 时的兜底）。
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    app.language.systemLanguagesChanged()
                    router.consumePendingShares()
                }
            }
            .task {
                // 冷启动：上次分享扩展留下的分享。
                router.consumePendingShares()
                // App 开着的时候改系统语言 / 地区。
                for await _ in NotificationCenter.default.notifications(named: NSLocale.currentLocaleDidChangeNotification) {
                    app.language.systemLanguagesChanged()
                }
            }
    }

    private func open(_ url: URL) {
        if GoogleSignInBridge.handle(url) { return }
        // Universal Link 可能同时交给 onOpenURL 和 onContinueUserActivity：一秒内的同一个网址只开一次。
        let now = Date()
        if let last = lastOpened, last.url == url, now.timeIntervalSince(last.at) < 1 { return }
        lastOpened = (url, now)
        router.handleIncomingURL(url)
    }
}
