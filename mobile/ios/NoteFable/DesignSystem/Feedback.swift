import SwiftUI
import UIKit

// 反馈类的小部件：转圈、提示条、触感。

// MARK: - 转圈

/// 转圈的 lucide `LoaderCircle`（网页 `animate-spin`：1 秒一圈、匀速；Android `Spinner`）。
/// 搜索框里的那个是 800ms 一圈：`Spinner(size: 16, duration: 0.8)`。
/// “减弱动态效果”时网页的搜索转圈放慢到 1.6 秒一圈（进度指示不算装饰，不停掉），这里一律照做。
///
/// ```swift
/// Spinner(size: 16)                                  // 灰色、线宽 2
/// Spinner(size: 16, color: Sm.text, strokeWidth: 1.9)
/// ```
struct Spinner: View {
    private let size: CGFloat
    private let color: Color
    private let strokeWidth: CGFloat
    private let duration: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(size: CGFloat = 16, color: Color = Sm.muted, strokeWidth: CGFloat = 2, duration: Double = 1) {
        self.size = size
        self.color = color
        self.strokeWidth = strokeWidth
        self.duration = duration
    }

    var body: some View {
        let period = max(0.1, reduceMotion ? max(duration, 1.6) : duration)
        // 按时间算角度：不依赖动画事务，出现在别的动画里也不会跟着乱飞；离屏时自动停。
        TimelineView(.animation) { context in
            let elapsed = context.date.timeIntervalSinceReferenceDate
            let angle = elapsed.truncatingRemainder(dividingBy: period) / period * 360
            LucideIcon(Lucide.loaderCircle, size: size, strokeWidth: strokeWidth, color: color)
                .rotationEffect(.degrees(angle))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - 提示条

/// 一条提示。
struct ToastMessage: Equatable, Identifiable {
    let id: Int
    let text: String
}

/// 屏幕下方短暂出现的一句提示（Android 的 `Toast`：“正在下载…”“聊天已下载”“请求失败：…”）。
/// 网页没有对应的东西（这些场合只有读屏通知），所以外观借用网页里最接近的浮条 `.settings-unsaved`：
/// 墨色底、圆角 14、白字 14 / 500、阴影 0 8 28 rgba(12,23,48,.28)，从下方 16 处滑入（200ms）。
///
/// 根上装一次 `.toastHost()`，然后在任何地方：
/// ```swift
/// Toast.show(L("downloading"))
/// Toast.show(L("request_failed", reason), long: true)
/// // 或者在视图里：@Environment(ToastCenter.self) private var toasts … toasts.show("…")
/// ```
@MainActor
@Observable
final class ToastCenter {
    static let shared = ToastCenter()

    /// 正在显示的提示；同一时间只显示一条，新的顶掉旧的。
    private(set) var current: ToastMessage?

    @ObservationIgnored private var counter = 0
    @ObservationIgnored private var hideTask: Task<Void, Never>?

    init() {}

    /// 显示一条提示。`long` 对应 Android 的 `LENGTH_LONG`（3.5 秒），否则 2 秒。读屏会念出来。
    func show(_ text: String, long: Bool = false) {
        guard !text.isEmpty else { return }
        counter += 1
        let message = ToastMessage(id: counter, text: text)
        current = message
        UIAccessibility.post(notification: .announcement, argument: text)
        hideTask?.cancel()
        let seconds: UInt64 = long ? 3_500 : 2_000
        hideTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: seconds * 1_000_000)
            guard !Task.isCancelled else { return }
            self?.hide(message)
        }
    }

    /// 马上收起（只收起指定的那一条；不给就收起当前的）。
    func hide(_ message: ToastMessage? = nil) {
        if message == nil || message == current { current = nil }
    }
}

/// `ToastCenter.shared` 的简写，给不在视图里的代码用。
@MainActor
enum Toast {
    static func show(_ text: String, long: Bool = false) {
        ToastCenter.shared.show(text, long: long)
    }
}

extension View {
    /// 在根视图上装一次：通过不拦截触摸的独立 `UIWindow` 在系统 `.sheet` 与悬浮底栏之上渲染提示条，并把 `ToastCenter` 放进环境。
    func toastHost(_ center: ToastCenter = .shared, tabBarVisible: Bool = false) -> some View {
        modifier(ToastHostModifier(center: center, tabBarVisible: tabBarVisible))
    }
}

private struct ToastHostModifier: ViewModifier {
    let center: ToastCenter
    let tabBarVisible: Bool
    @State private var controller = ToastWindowController()
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.locale) private var locale
    @Environment(\.nfForceSolidChrome) private var forceSolidChrome

    func body(content: Content) -> some View {
        let env = ToastOverlayEnvironment(
            colorScheme: colorScheme,
            layoutDirection: layoutDirection,
            locale: locale,
            forceSolidChrome: forceSolidChrome,
            tabBarVisible: tabBarVisible
        )
        content
            .environment(center)
            .onAppear {
                controller.sync(center: center, env: env)
            }
            .onChange(of: env) { _, next in
                controller.sync(center: center, env: next)
            }
            .onChange(of: center.current) { _, _ in
                controller.sync(center: center, env: env)
            }
            .onDisappear {
                controller.teardown()
            }
    }
}

private struct ToastOverlayEnvironment: Equatable {
    let colorScheme: ColorScheme
    let layoutDirection: LayoutDirection
    let locale: Locale
    let forceSolidChrome: Bool
    let tabBarVisible: Bool
}

private final class ToastOverlayWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        nil
    }
}

@MainActor
private final class ToastWindowController {
    private var window: ToastOverlayWindow?
    private var hosting: UIHostingController<ToastOverlayRootView>?

    func sync(center: ToastCenter, env: ToastOverlayEnvironment) {
        guard let scene = activeWindowScene() else { return }
        let rootView = ToastOverlayRootView(center: center, env: env)
        if let existingWindow = window, existingWindow.windowScene === scene, let hosting {
            hosting.rootView = rootView
            applyTraits(to: existingWindow, hosting: hosting, env: env)
            if existingWindow.isHidden { existingWindow.isHidden = false }
            return
        }
        teardown()
        let host = UIHostingController(rootView: rootView)
        host.view.backgroundColor = .clear
        let overlay = ToastOverlayWindow(windowScene: scene)
        overlay.windowLevel = .normal + 10
        overlay.backgroundColor = .clear
        overlay.isUserInteractionEnabled = false
        overlay.rootViewController = host
        applyTraits(to: overlay, hosting: host, env: env)
        overlay.isHidden = false
        self.window = overlay
        self.hosting = host
    }

    func teardown() {
        window?.isHidden = true
        window?.rootViewController = nil
        window = nil
        hosting = nil
    }

    private func applyTraits(to overlay: UIWindow, hosting: UIHostingController<ToastOverlayRootView>, env: ToastOverlayEnvironment) {
        let style: UIUserInterfaceStyle = (env.colorScheme == .dark) ? .dark : .light
        let attr: UISemanticContentAttribute = (env.layoutDirection == .rightToLeft) ? .forceRightToLeft : .forceLeftToRight
        let dir: UITraitEnvironmentLayoutDirection = (env.layoutDirection == .rightToLeft) ? .rightToLeft : .leftToRight
        overlay.overrideUserInterfaceStyle = style
        overlay.semanticContentAttribute = attr
        hosting.overrideUserInterfaceStyle = style
        hosting.view.semanticContentAttribute = attr
        hosting.traitOverrides.layoutDirection = dir
    }

    private func activeWindowScene() -> UIWindowScene? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    }
}

private struct ToastOverlayRootView: View {
    let center: ToastCenter
    let env: ToastOverlayEnvironment
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let keyboardTop = KeyboardObserver.shared.top
        GeometryReader { proxy in
            let keyboardInset = max(0, proxy.frame(in: .global).maxY - keyboardTop)
            let bottomPadding: CGFloat = keyboardInset > 0
                ? keyboardInset + 12
                : (env.tabBarVisible ? 84 : 16)
            ZStack(alignment: .bottom) {
                Color.clear
                if let message = center.current {
                    ToastBubble(text: message.text)
                        .id(message.id)
                        .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.nfRise(offsetY: 16))
                        .padding(.horizontal, 16)
                        .padding(.bottom, bottomPadding)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .animation(reduceMotion ? nil : NFMotion.emphasized(0.2), value: center.current)
        }
        .ignoresSafeArea(.keyboard)
        .allowsHitTesting(false)
        .environment(\.colorScheme, env.colorScheme)
        .environment(\.layoutDirection, env.layoutDirection)
        .environment(\.locale, env.locale)
        .environment(\.nfForceSolidChrome, env.forceSolidChrome)
    }
}

private struct ToastBubble: View {
    let text: String

    var body: some View {
        let shape = Capsule()
        Text(text)
            .font(.nf(14, weight: 500))
            .foregroundStyle(Sm.text)
            .multilineTextAlignment(.center)
            .lineLimit(4)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(minHeight: 44)
            .frame(maxWidth: 400)
            .fixedSize(horizontal: false, vertical: true)
            .nfGlassBackground(.regular, in: shape, solidFill: Sm.surface, stroke: Sm.borderStrong)
            .clipShape(shape)
            .shadow(color: Sm.panelShadow, radius: 12, x: 0, y: 6)
            .accessibilityHidden(true)
    }
}

// MARK: - 触感

/// 触感反馈（Android 的 `HapticFeedbackType`）。网页没有触感，只在 Android 端有的地方用：长按开始拖动排序时一下。
///
/// ```swift
/// Haptics.dragStart()     // 长按抓起一行（Android 的 LongPress）
/// Haptics.selection()     // 拖动中换了落点
/// ```
@MainActor
enum Haptics {
    /// 选择变化的轻微一下。
    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }

    /// 一次轻的撞击。
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    /// 长按后抓起一行开始拖动。
    static func dragStart() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
}
