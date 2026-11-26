import SwiftUI

// 对话框、“更多”菜单、全屏面板共用的“最上层”。
//
// 原先通过 PreferenceKey + Anchor<CGRect> 向根视图冒泡，但 UIKit 支持的 TabView 会截断 PreferenceKey 冒泡。
// 改为根上和每个 `.nfPanel` / `.nfSheet` / `.nfDialog` / `.nfPopover` 内部通过环境注入的 `@Observable NFOverlayCenter`，
// 以及基于 `.global` 坐标的触发器矩形：跨 TabView 标签页与抽屉声明的层都能稳定画在 TabView 与液态玻璃底栏之上。
// 层的顺序：全屏面板 < 对话框 < 菜单；从某一层里面再打开的（设置里的语言菜单、对话框里的菜单）叠在那一层上面。

// MARK: - 根上的宿主

extension View {
    /// 在根视图、系统 `.sheet` 或内嵌面板里安装叠加层宿主。
    func nfOverlayHost() -> some View {
        modifier(NFOverlayHostModifier())
    }

    /// `nfOverlayHost()` 的别名。
    func actionsMenuHost() -> some View {
        modifier(NFOverlayHostModifier())
    }
}

struct NFOverlayHostModifier: ViewModifier {
    @State private var center = NFOverlayCenter()

    func body(content: Content) -> some View {
        content
            .environment(center)
            .overlay {
                NFOverlayStack(center: center)
            }
    }
}

// MARK: - 关闭

/// 关掉自己所在的那一层（对话框 / 菜单 / 面板 / 系统 Sheet）。不在这些层里时什么也不做。
struct NFDismissAction {
    let action: () -> Void

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

// MARK: - 中心状态

@MainActor
@Observable
final class NFOverlaySlot: Identifiable {
    let id: NFOverlayID
    @ObservationIgnored var item: NFOverlayItem
    private(set) var revision: Int = 0

    init(item: NFOverlayItem) {
        self.id = item.id
        self.item = item
    }

    func bump() {
        revision &+= 1
    }
}

@MainActor
@Observable
final class NFOverlayCenter {
    @ObservationIgnored private var slots: [NFOverlayID: NFOverlaySlot] = [:]
    @ObservationIgnored private var pendingPublishIds: Set<NFOverlayID> = []
    @ObservationIgnored private var publishTask: Task<Void, Never>?
    private(set) var ids: [NFOverlayID] = []
    private(set) var orderRevision: Int = 0

    func upsert(_ item: NFOverlayItem) {
        if let slot = slots[item.id] {
            let levelChanged = slot.item.kind.level != item.kind.level
            slot.item = item
            slot.bump()
            if levelChanged { orderRevision &+= 1 }
        } else {
            slots[item.id] = NFOverlaySlot(item: item)
            ids.append(item.id)
            orderRevision &+= 1
        }
        pendingPublishIds.remove(item.id)
    }

    /// 在 `body` 重绘期间写入最新闭包与环境快照，并在本轮视图求值结束后异步递增对应槽位的 `revision`，
    /// 使已打开的浮层（如切换语言后的设置面板）保留状态的同时立即拿到新环境。
    func updateStoredContent(_ item: NFOverlayItem) {
        guard let slot = slots[item.id] else { return }
        slot.item = item
        pendingPublishIds.insert(item.id)
        guard publishTask == nil else { return }
        publishTask = Task { @MainActor [weak self] in
            guard let self else { return }
            self.publishTask = nil
            let dirty = self.pendingPublishIds
            self.pendingPublishIds.removeAll()
            for id in dirty {
                self.slots[id]?.bump()
            }
        }
    }

    func remove(_ id: NFOverlayID) {
        pendingPublishIds.remove(id)
        let existed = slots.removeValue(forKey: id) != nil
        if let index = ids.firstIndex(of: id) {
            ids.remove(at: index)
        }
        if existed {
            orderRevision &+= 1
        }
    }

    var orderedSlots: [NFOverlaySlot] {
        _ = orderRevision
        return ids.compactMap { slots[$0] }
            .enumerated()
            .sorted { ($0.element.item.kind.level, $0.offset) < ($1.element.item.kind.level, $1.offset) }
            .map(\.element)
    }
}

// MARK: - 一层的描述

/// 要显示的一层。由各个 `.nfXxx` 修饰符注册给当前最近的 `NFOverlayCenter`。
struct NFOverlayItem: Identifiable {
    enum Kind {
        case panel(NFPanelStyle)
        case dialog

        /// 叠放顺序：数字大的在上面。
        var level: Int {
            switch self {
            case .panel: return 0
            case .dialog: return 1
            }
        }
    }

    let id: NFOverlayID
    let kind: Kind
    /// 为 true 时点遮罩 / 点外面都不关（请求进行中）。
    let dismissDisabled: Bool
    /// 声明处的环境值：内容虽然画在宿主上，读到的环境和声明它的地方一样。
    let environment: EnvironmentValues
    let content: () -> AnyView
    let dismiss: () -> Void
}

/// 一层的身份：声明它的那个修饰符（`namespace`）+ item 版本里的 `item.id`（换了 item 就是新的一层，重新进场）。
struct NFOverlayID: Hashable {
    let namespace: Namespace.ID
    let key: AnyHashable?
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

/// 不需要锚点的层（对话框、面板）。
struct NFOverlayPresenter: ViewModifier {
    let isPresented: Bool
    let key: AnyHashable?
    let kind: NFOverlayItem.Kind
    let dismissDisabled: Bool
    let overlayContent: () -> AnyView
    let dismiss: () -> Void

    @Namespace private var namespace
    @Environment(\.self) private var environment
    @Environment(NFOverlayCenter.self) private var center: NFOverlayCenter?
    @State private var registeredId: NFOverlayID?

    private var currentId: NFOverlayID {
        NFOverlayID(namespace: namespace, key: key)
    }

    private func makeItem() -> NFOverlayItem {
        NFOverlayItem(
            id: currentId,
            kind: kind,
            dismissDisabled: dismissDisabled,
            environment: environment,
            content: overlayContent,
            dismiss: dismiss
        )
    }

    func body(content: Content) -> some View {
        if isPresented {
            center?.updateStoredContent(makeItem())
        }
        return content
            .onChange(of: isPresented, initial: true) { _, shown in
                sync(shown: shown)
            }
            .onChange(of: currentId) { oldId, _ in
                if registeredId == oldId {
                    center?.remove(oldId)
                    registeredId = nil
                }
                sync(shown: isPresented)
            }
            .onChange(of: dismissDisabled) { _, _ in
                if isPresented {
                    sync(shown: true)
                }
            }
            .onDisappear {
                if let registeredId {
                    center?.remove(registeredId)
                    self.registeredId = nil
                } else {
                    center?.remove(currentId)
                }
            }
    }

    private func sync(shown: Bool) {
        if shown {
            let item = makeItem()
            registeredId = item.id
            center?.upsert(item)
        } else if let registeredId {
            center?.remove(registeredId)
            self.registeredId = nil
        } else {
            center?.remove(currentId)
        }
    }
}

// MARK: - 把各层叠起来

private struct NFOverlayStack: View {
    let center: NFOverlayCenter
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let slots = center.orderedSlots
        let keyboardTop = KeyboardObserver.shared.top
        GeometryReader { proxy in
            let metrics = NFOverlayMetrics(
                size: proxy.size,
                keyboardInset: max(0, proxy.frame(in: .global).maxY - keyboardTop)
            )
            ZStack {
                ForEach(Array(slots.enumerated()), id: \.element.id) { index, slot in
                    NFOverlaySlotView(slot: slot, metrics: metrics, zBase: Double(index))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            // 各层的进场 / 退场各有自己的时长（见各层的 transition），这里只负责让增减带上动画。
            .animation(reduceMotion ? nil : NFMotion.cssEaseOut(0.2), value: slots.map(\.id))
        }
        // 键盘由 metrics.keyboardInset 处理，不让系统再顶一次。
        .ignoresSafeArea(.keyboard)
    }
}

private struct NFOverlaySlotView: View {
    let slot: NFOverlaySlot
    let metrics: NFOverlayMetrics
    let zBase: Double

    var body: some View {
        let _ = slot.revision
        let item = slot.item
        NFOverlayLayer(item: item, metrics: metrics, zBase: zBase)
            .environment(\.nfDismiss, NFDismissAction(action: item.dismiss))
            // 先放回声明处的环境，再在上面盖本层的关闭动作（离内容近的修饰符优先）。
            .environment(\.self, item.environment)
    }
}

private struct NFOverlayLayer: View {
    let item: NFOverlayItem
    let metrics: NFOverlayMetrics
    let zBase: Double

    var body: some View {
        switch item.kind {
        case .dialog:
            NFDialogLayer(item: item, metrics: metrics, zBase: zBase)
        case let .panel(style):
            NFPanelLayer(item: item, style: style, metrics: metrics, zBase: zBase)
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
