import SwiftUI
import UIKit

/// App 的入口（Android 的 `NoteFableApp.kt` + `MainActivity.kt`）：建依赖（`AppEnvironment`）和导航状态（`AppRouter`），
/// 接上界面层才有的东西（Google 登录、表情字形检测），然后把根视图放进窗口。
/// 账号在 `AccountViewModel` 建好时就读一次（Android 的 ViewModel 同样在 init 里读），这里不用再读。
@main
struct NoteFableApp: App {
    // 告诉系统现在允许的界面方向（只有幻灯片放映中是横屏，OrientationLock）。
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var app: AppEnvironment
    @State private var router: AppRouter

    @MainActor
    init() {
        #if DEBUG
        let fixture = FixtureLaunch.fromProcess()
        let app = fixture?.makeEnvironment() ?? AppEnvironment()
        #else
        let app = AppEnvironment()
        #endif
        let router = AppRouter(app: app)
        // 画不出来的表情不进表情面板（要用 CoreText，所以在界面层接上）。
        app.emojiGlyphSupported = { emoji in EmojiGlyphs.isSupported(emoji) }
        #if DEBUG
        if fixture != nil {
            // Fixture 模式完全隔离：不读取 App Group 共享目录、不安装 Google Sign-In。
            app.hasPendingShare = { _ in false }
            app.consumeSharePayloads = { _ in [] }
            app.requestGoogleIdToken = { _, _ in nil }
            app.clearGoogleSignIn = {}
        } else {
            // 系统「分享」：分享扩展写进 App Group 共享目录的内容，在这里检查并取走（Android 的 SEND intent）。
            app.hasPendingShare = { id in await ShareInboxBridge.hasPending(id: id) }
            app.consumeSharePayloads = { id in await ShareInboxBridge.consume(id: id) }
            GoogleSignInBridge.install(into: app)
        }
        #else
        // 系统「分享」：分享扩展写进 App Group 共享目录的内容，在这里检查并取走（Android 的 SEND intent）。
        app.hasPendingShare = { id in await ShareInboxBridge.hasPending(id: id) }
        app.consumeSharePayloads = { id in await ShareInboxBridge.consume(id: id) }
        GoogleSignInBridge.install(into: app)
        #endif
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

/// 窗口里的最外层：语言方向、区域、外观（浅色 / 深色 / 跟随系统），以及系统交来的链接。
/// 单独一个视图是为了让语言、外观的变化（`app.language`、`app.appTheme`）能触发重绘。
private struct NoteFableWindow: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @State private var lastOpened: (url: URL, at: Date)? = nil

    var body: some View {
        let language = app.language
        let theme = app.appTheme.preference
        RootView()
            // 阿拉伯语：整个界面从右往左排，抽屉从右边出来（Android 的 window.decorView.layoutDirection）。
            .environment(\.layoutDirection, language.isRightToLeft ? .rightToLeft : .leftToRight)
            // 日期、数字按界面语言写（不跟系统语言）。
            .environment(\.locale, Locale(identifier: language.active.tag ?? language.uiLocale))
            .environment(\.nfForceSolidChrome, ScreenshotHooks.forceSolidChrome)
            // 设置里选的外观（网页 data-theme）：浅色 / 深色定死，“跟随系统”不指定。`Sm` 的颜色跟着它自己换，
            // 状态栏的字、键盘、系统弹出的界面（文件选择、提示框、分享面板）也跟着窗口走。
            .preferredColorScheme(theme.colorScheme)
            // 同时直接定到窗口上：从深色 / 浅色改回“跟随系统”时，只靠 preferredColorScheme(nil) 有时不会马上放开。
            .onChange(of: theme, initial: true) { _, value in applyWindowAppearance(value) }
            // 应用内切换 RTL 语言（例如 ar-app）时同步更新 UIKit 窗口方向，确保原生 TabBar 与系统 Sheet 一致翻转。
            .onChange(of: language.isRightToLeft, initial: true) { _, rtl in applyWindowLayoutDirection(rtl) }
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
                if phase == .active, !ScreenshotHooks.isActive {
                    app.language.systemLanguagesChanged()
                    router.consumePendingShares()
                }
            }
            .task(id: app.account.state.user != nil ? app.identityGeneration : nil) {
                guard !ScreenshotHooks.isActive, app.account.state.user != nil else { return }
                await AppleSubscription.observe(api: app.accountApi) {
                    app.onAppleBillingChanged()
                }
            }
            .task {
                #if DEBUG
                if let fixture = FixtureLaunch.current {
                    await fixture.apply(app: app, router: router)
                    return
                }
                #endif
                // 冷启动：上次分享扩展留下的分享。
                router.consumePendingShares()
                // App 开着的时候改系统语言 / 地区。
                for await _ in NotificationCenter.default.notifications(named: NSLocale.currentLocaleDidChangeNotification) {
                    app.language.systemLanguagesChanged()
                }
            }
    }

    /// 把外观定到 App 的每个窗口（和它的根控制器）上；“跟随系统”是不指定。
    private func applyWindowAppearance(_ preference: ThemePreference) {
        let style = preference.interfaceStyle
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                window.overrideUserInterfaceStyle = style
                window.rootViewController?.overrideUserInterfaceStyle = style
            }
        }
    }

    private func applyWindowLayoutDirection(_ rtl: Bool) {
        let attribute: UISemanticContentAttribute = rtl ? .forceRightToLeft : .forceLeftToRight
        let direction: UITraitEnvironmentLayoutDirection = rtl ? .rightToLeft : .leftToRight
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                window.semanticContentAttribute = attribute
                window.rootViewController?.view.semanticContentAttribute = attribute
                window.rootViewController?.traitOverrides.layoutDirection = direction
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

private extension ThemePreference {
    /// SwiftUI 的写法；“跟随系统”是 nil。
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    /// UIKit 的写法；“跟随系统”是 `.unspecified`。
    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .system: return .unspecified
        case .light: return .light
        case .dark: return .dark
        }
    }
}
