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
/// 根上装一次 `.toastHost(tabBarVisible:tab:)`（RootView），然后在任何地方：
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
    /// `tabBarVisible`：底部标签栏是否显示（不显示时离底边 16）。`tab`：当前标签页；提示条放在这个标签页量到的底部遮挡
    /// （`NFBottomChrome`：标签栏 + 悬浮底栏，例如聊天的输入框）上方 8，还没量到时沿用原来的 84（见 `toastBottomClearance`）。
    func toastHost(_ center: ToastCenter = .shared, tabBarVisible: Bool, tab: AppTab) -> some View {
        modifier(ToastHostModifier(center: center, tabBarVisible: tabBarVisible, tab: tab))
    }
}

private struct ToastHostModifier: ViewModifier {
    let center: ToastCenter
    let tabBarVisible: Bool
    let tab: AppTab
    @State private var controller = ToastWindowController()
    @State private var windowFrame: CGRect?
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
            tabBarVisible: tabBarVisible,
            tab: tab
        )
        content
            .environment(center)
            .environment(\.nfWindowFrame, windowFrame)
            .background {
                GeometryReader { proxy in
                    let frame = proxy.frame(in: .global)
                    ToastWindowAnchor { window in
                        controller.attach(to: window, center: center, env: env)
                    }
                    .onChange(of: frame, initial: true) { _, next in
                        if !next.isEmpty { windowFrame = next }
                        controller.resize()
                    }
                }
                // Only the measurement covers the whole window. The app still avoids the keyboard.
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
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

/// Uses the window that hosts this root to place the toast overlay in the same scene and frame.
private struct ToastWindowAnchor: UIViewRepresentable {
    let onAttach: (UIWindow) -> Void

    func makeUIView(context: Context) -> AnchorView {
        let view = AnchorView()
        view.onAttach = onAttach
        return view
    }

    func updateUIView(_ view: AnchorView, context: Context) {
        view.onAttach = onAttach
    }

    final class AnchorView: UIView {
        var onAttach: ((UIWindow) -> Void)?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            // Wait for SwiftUI's update pass to finish before installing another hosting controller.
            DispatchQueue.main.async { [weak self] in
                guard let self, let window = self.window else { return }
                self.onAttach?(window)
            }
        }
    }
}

private struct ToastOverlayEnvironment: Equatable {
    let colorScheme: ColorScheme
    let layoutDirection: LayoutDirection
    let locale: Locale
    let forceSolidChrome: Bool
    let tabBarVisible: Bool
    /// 当前标签页：提示条读这个标签页的底部遮挡（`NFBottomChrome`）。
    let tab: AppTab
}

private final class ToastOverlayWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        nil
    }
}

@MainActor
private final class ToastWindowController {
    private weak var sourceWindow: UIWindow?
    private var window: ToastOverlayWindow?
    private var hosting: UIHostingController<ToastOverlayRootView>?

    func attach(to sourceWindow: UIWindow, center: ToastCenter, env: ToastOverlayEnvironment) {
        self.sourceWindow = sourceWindow
        sync(center: center, env: env)
    }

    func sync(center: ToastCenter, env: ToastOverlayEnvironment) {
        guard let sourceWindow, let scene = sourceWindow.windowScene else { return }
        if let existingWindow = window, existingWindow.windowScene === scene, let hosting {
            resize()
            hosting.rootView = ToastOverlayRootView(center: center, env: env, window: existingWindow)
            applyTraits(to: existingWindow, hosting: hosting, env: env)
            if existingWindow.isHidden { existingWindow.isHidden = false }
            return
        }
        teardown()
        let overlay = ToastOverlayWindow(windowScene: scene)
        overlay.frame = sourceWindow.frame
        overlay.windowLevel = .normal + 10
        overlay.backgroundColor = .clear
        overlay.isUserInteractionEnabled = false
        let host = UIHostingController(rootView: ToastOverlayRootView(center: center, env: env, window: overlay))
        host.view.backgroundColor = .clear
        overlay.rootViewController = host
        applyTraits(to: overlay, hosting: host, env: env)
        overlay.isHidden = false
        self.window = overlay
        self.hosting = host
    }

    func resize() {
        guard let window, let sourceWindow, window.frame != sourceWindow.frame else { return }
        window.frame = sourceWindow.frame
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
}

private struct ToastOverlayRootView: View {
    let center: ToastCenter
    let env: ToastOverlayEnvironment
    weak var window: ToastOverlayWindow?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let keyboardTop = KeyboardObserver.shared.top
        // 只有提示条窗口的这个根视图读 NFBottomChrome：标签页量到的遮挡变了只重画这里，不牵动 RootView。
        let obstruction = NFBottomChrome.shared.obstruction(for: env.tab)
        GeometryReader { proxy in
            let hostBottomGap = proxy.safeAreaInsets.bottom
            let bottomPadding = toastBottomClearance(
                keyboardInset: keyboardInset(screenTop: keyboardTop, hostBottomGap: hostBottomGap),
                tabBarVisible: env.tabBarVisible,
                obstructionFromScreenBottom: obstruction,
                // The host ends at the container safe area. The obstruction includes that bottom inset.
                hostBottomGap: hostBottomGap
            )
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

    private func keyboardInset(screenTop: CGFloat, hostBottomGap: CGFloat) -> CGFloat {
        guard screenTop.isFinite, let window, let scene = window.windowScene else { return 0 }
        let localTop = scene.screen.coordinateSpace.convert(CGPoint(x: 0, y: screenTop), to: window).y
        return max(0, window.bounds.maxY - hostBottomGap - localTop)
    }
}

private struct ToastBubble: View {
    let text: String
    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let shape = Capsule()
        Text(text)
            .font(.nf(14, weight: 500))
            // 小块玻璃上的字（#195 规则 1.5）：原生玻璃上用系统主色（压在深色内容上会跟着翻转），其余照旧 Sm.text。
            .foregroundStyle(chromePath.primaryInk)
            .multilineTextAlignment(.center)
            .lineLimit(4)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(minHeight: 44)
            .frame(maxWidth: 400)
            .fixedSize(horizontal: false, vertical: true)
            // 先裁内容再上玻璃，玻璃自己的边缘和高光不被裁掉；自定义阴影只在非原生玻璃时画。
            .clipShape(shape)
            .nfGlassBackground(.regular, in: shape, solidFill: Sm.surface, stroke: Sm.borderStrong)
            .nfChromeShadow(Sm.panelShadow, radius: 12, y: 6)
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
