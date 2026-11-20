import SwiftUI

// 对话框、“更多”菜单、底部抽屉、全屏面板共用的“最上层”。
//
// 网页这些东西是 <dialog> / position: fixed，盖在整个页面上；系统的 .sheet / .alert / Menu 外观和动画都对不上，所以自己画：
// 各处用 `.nfDialog` / `.actionsMenu` / `.nfBottomSheet` / `.nfPanel` 声明“现在要显示什么”，声明经 preference 传到根上，
// 根上的 `.nfOverlayHost()` 把它们叠在内容上面。层的顺序：全屏面板 < 底部抽屉 < 对话框 < 菜单；
// 从某一层里面再打开的（设置里的语言菜单、对话框里的菜单）叠在那一层上面。
//
// 使用时要知道的三件事：
// 1. `.nfOverlayHost()` 在 App 的根视图上装一次。系统的 `.sheet` / `.fullScreenCover` 是另一棵视图树，里面要用这些控件就再装一次。
// 2. 内容画在根上，但环境值取的是声明处的（`@Environment` 的模型、布局方向、语言都照常能读）。
// 3. 内容里要自己关掉时用 `@Environment(\.nfDismiss)`，或者直接改绑定的状态。

// MARK: - 根上的宿主

extension View {
    /// 在根视图上装一次：对话框、菜单、底部抽屉、全屏面板都画在它上面（见本文件开头的说明）。
    ///
    /// ```swift
    /// RootView()
    ///     .nfOverlayHost()
    ///     .toastHost()
    /// ```
    func nfOverlayHost() -> some View {
        modifier(NFOverlayHostModifier())
    }

    /// `nfOverlayHost()` 的别名：菜单和对话框、抽屉用的是同一个宿主，装过其中一个就不用再装。
    func actionsMenuHost() -> some View {
        modifier(NFOverlayHostModifier())
    }
}

struct NFOverlayHostModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .overlayPreferenceValue(NFOverlayKey.self) { items in
                NFOverlayStack(items: items)
            }
            // 已经画出来的不再往上传：宿主套宿主时（面板里的宿主、根上的宿主）不会画两遍。
            .transformPreference(NFOverlayKey.self) { $0.removeAll() }
    }
}

// MARK: - 关闭

/// 关掉自己所在的那一层（对话框 / 菜单 / 抽屉 / 面板）。不在这些层里时什么也不做。
///
/// ```swift
/// @Environment(\.nfDismiss) private var dismiss
/// NotionButton(L("cancel")) { dismiss() }
/// ```
struct NFDismissAction {
    fileprivate let action: () -> Void

    func callAsFunction() {
        action()
    }
}

private struct NFDismissKey: EnvironmentKey {
    static let defaultValue = NFDismissAction(action: {})
}

extension EnvironmentValues {
    var nfDismiss: NFDismissAction {
        get { self[NFDismissKey.self] }
        set { self[NFDismissKey.self] = newValue }
    }
}

// MARK: - 一层的描述

/// 要显示的一层。由各个 `.nfXxx` 修饰符生成，经 `NFOverlayKey` 传给宿主。
struct NFOverlayItem: Identifiable {
    enum Kind {
        case panel(NFPanelStyle)
        case sheet(BottomSheetStyle)
        case dialog
        case menu(ActionsMenuConfiguration, Anchor<CGRect>)

        /// 叠放顺序：数字大的在上面。
        var level: Int {
            switch self {
            case .panel: return 0
            case .sheet: return 1
            case .dialog: return 2
            case .menu: return 3
            }
        }
    }

    let id: NFOverlayID
    let kind: Kind
    /// 为 true 时点遮罩 / 点外面 / 下拉都不关（请求进行中）。
    let dismissDisabled: Bool
    /// 声明处的环境值：内容虽然画在根上，读到的环境和声明它的地方一样。
    let environment: EnvironmentValues
    let content: () -> AnyView
    let dismiss: () -> Void
}

/// 一层的身份：声明它的那个修饰符（`namespace`）+ item 版本里的 `item.id`（换了 item 就是新的一层，重新进场）。
struct NFOverlayID: Hashable {
    let namespace: Namespace.ID
    let key: AnyHashable?
}

struct NFOverlayKey: PreferenceKey {
    static let defaultValue: [NFOverlayItem] = []

    static func reduce(value: inout [NFOverlayItem], nextValue: () -> [NFOverlayItem]) {
        value.append(contentsOf: nextValue())
    }
}

/// 宿主的尺寸和键盘挡住的高度。各层按它摆放：内容区的底边 = `size.height - keyboardInset`。
struct NFOverlayMetrics: Equatable {
    var size: CGSize
    var keyboardInset: CGFloat

    /// 没被键盘挡住的高度。
    var availableHeight: CGFloat {
        max(0, size.height - keyboardInset)
    }
}

// MARK: - 声明一层

/// 不需要锚点的层（对话框、抽屉、面板）。
struct NFOverlayPresenter: ViewModifier {
    let isPresented: Bool
    let key: AnyHashable?
    let kind: NFOverlayItem.Kind
    let dismissDisabled: Bool
    let overlayContent: () -> AnyView
    let dismiss: () -> Void

    @Namespace private var namespace
    @Environment(\.self) private var environment

    func body(content: Content) -> some View {
        content.transformPreference(NFOverlayKey.self) { items in
            guard isPresented else { return }
            items.append(NFOverlayItem(
                id: NFOverlayID(namespace: namespace, key: key),
                kind: kind,
                dismissDisabled: dismissDisabled,
                environment: environment,
                content: overlayContent,
                dismiss: dismiss
            ))
        }
    }
}

/// 贴着某个视图显示的层（菜单）：把那个视图的位置一起带上。
struct NFAnchoredOverlayPresenter: ViewModifier {
    let isPresented: Bool
    let configuration: ActionsMenuConfiguration
    let dismissDisabled: Bool
    let overlayContent: () -> AnyView
    let dismiss: () -> Void

    @Namespace private var namespace
    @Environment(\.self) private var environment

    func body(content: Content) -> some View {
        content.transformAnchorPreference(key: NFOverlayKey.self, value: .bounds) { (items: inout [NFOverlayItem], anchor: Anchor<CGRect>) in
            guard isPresented else { return }
            items.append(NFOverlayItem(
                id: NFOverlayID(namespace: namespace, key: nil),
                kind: .menu(configuration, anchor),
                dismissDisabled: dismissDisabled,
                environment: environment,
                content: overlayContent,
                dismiss: dismiss
            ))
        }
    }
}

// MARK: - 把各层叠起来

private struct NFOverlayStack: View {
    let items: [NFOverlayItem]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 按层级排（同一级按声明的先后），并记下序号当 zIndex：退场动画期间也不会掉到别的层下面。
    private var ordered: [NFOverlayEntry] {
        items.enumerated()
            .sorted { ($0.element.kind.level, $0.offset) < ($1.element.kind.level, $1.offset) }
            .enumerated()
            .map { NFOverlayEntry(index: $0.offset, item: $0.element.element) }
    }

    var body: some View {
        let keyboardTop = KeyboardObserver.shared.top
        GeometryReader { proxy in
            let metrics = NFOverlayMetrics(
                size: proxy.size,
                keyboardInset: max(0, proxy.frame(in: .global).maxY - keyboardTop)
            )
            ZStack {
                ForEach(ordered) { entry in
                    NFOverlayLayer(item: entry.item, metrics: metrics, zBase: Double(entry.index))
                        .environment(\.nfDismiss, NFDismissAction(action: entry.item.dismiss))
                        // 先放回声明处的环境，再在上面盖本层的关闭动作（离内容近的修饰符优先）。
                        .environment(\.self, entry.item.environment)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            // 各层的进场 / 退场各有自己的时长（见各层的 transition），这里只负责让增减带上动画。
            .animation(reduceMotion ? nil : NFMotion.cssEaseOut(0.2), value: items.map(\.id))
        }
        // 键盘由 metrics.keyboardInset 处理，不让系统再顶一次。
        .ignoresSafeArea(.keyboard)
    }
}

private struct NFOverlayEntry: Identifiable {
    let index: Int
    let item: NFOverlayItem
    var id: NFOverlayID { item.id }
}

private struct NFOverlayLayer: View {
    let item: NFOverlayItem
    let metrics: NFOverlayMetrics
    let zBase: Double

    var body: some View {
        switch item.kind {
        case .dialog:
            NFDialogLayer(item: item, metrics: metrics, zBase: zBase)
        case let .sheet(style):
            BottomSheetLayer(item: item, style: style, metrics: metrics, zBase: zBase)
        case let .panel(style):
            NFPanelLayer(item: item, style: style, metrics: metrics, zBase: zBase)
        case let .menu(configuration, anchor):
            ActionsMenuLayer(item: item, configuration: configuration, anchor: anchor, metrics: metrics, zBase: zBase)
        }
    }
}

// MARK: - 各层共用

extension View {
    /// 层里的内容：恢复文字的默认排版（声明处如果在 `.lineLimit(1)` 之类的里面，不带进来）。
    func nfOverlayContentDefaults() -> some View {
        self
            .lineLimit(nil)
            .multilineTextAlignment(.leading)
    }
}
