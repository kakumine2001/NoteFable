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
            // 设置里选的外观（网页 data-theme）：浅色 / 深色定死，“跟随系统”不指定。`Sm` 的颜色跟着它自己换，
            // 状态栏的字、键盘、系统弹出的界面（文件选择、提示框、分享面板）也跟着窗口走。
            .preferredColorScheme(theme.colorScheme)
            // 同时直接定到窗口上：从深色 / 浅色改回“跟随系统”时，只靠 preferredColorScheme(nil) 有时不会马上放开。
            .onChange(of: theme, initial: true) { _, value in applyWindowAppearance(value) }
            // 自定义 URL scheme（Google 登录的回调）和 Universal Link 都可能从这里进来。
            .onOpenURL { url in open(url) }
            // Universal Link：`https://<工作区主机>/c/<会话>?message=<消息>` 等（规则在 `ChatLink.parse`；Android 的 VIEW intent）。
            // 同一个网址如果两边都收到，`open` 只处理一次。
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { open(url) }
            }
            // 回到前台时系统语言可能改过（Android 的 onConfigurationChanged）：按“自动”显示着的话重新解析。
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { app.language.systemLanguagesChanged() }
            }
            .task {
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
