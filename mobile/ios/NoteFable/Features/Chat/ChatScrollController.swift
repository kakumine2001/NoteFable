import SwiftUI
import UIKit

// 消息列表的滚动（Android ChatScreen.kt 的 MessageList 里围着 LazyListState 的那部分）。
// SwiftUI（iOS 17）的 ScrollView 不给出"用户是不是在滚""离底部多远"，所以从列表内容里找到它背后的 UIScrollView，直接读它的状态：
// 位置和内容高度用 KVO，手指的拖动用它自带的 pan 手势。"要不要跟着最新内容"的规则仍是 Core 的 `followAction`（网页 followBottomRef）：
// 打开会话、发出消息、点"滚动到底部"时跟随；用户一滚离开底部就停止；滚动停在离底部 2 以内又跟随；滚动进行中不恢复。

@MainActor
final class ChatScrollController: NSObject {
    /// 跟着最新内容：回答变长时贴住底部。
    var following = true
    /// 正在定位到检索结果 / 链接里的消息：这期间不贴底、也不改跟随状态。
    var revealPending = false
    var hasItems = false
    /// 离底部是否不超过 8（"滚动到底部"按钮据此显示 / 隐藏）。下一轮主循环才调用，可以直接改界面状态。
    var onAtBottomChange: ((Bool) -> Void)?

    private weak var scrollView: UIScrollView?
    private var observations: [NSKeyValueObservation] = []
    /// "滚动到底部"按钮自己发起的平滑滚动：不能当成用户往回滚而停止跟随。
    private var programmatic = false
    private var programmaticTask: Task<Void, Never>?
    private var idleTask: Task<Void, Never>?
    private var notifyTask: Task<Void, Never>?
    private var evaluating = false
    private var atBottom = true
    #if DEBUG
    /// 排查消息区空白（ChatDebug）：懒加载列表里出现着的行、出现过的行。
    var debugRowsOn: [String: Int] = [:]
    var debugRowsEver: Set<String> = []
    /// 候选修复 D：SwiftUI 自己滚的这一小段时间控制器不贴底。
    private var debugHoldPin = false
    private var debugRepairTask: Task<Void, Never>?
    #endif

    /// 离底部不超过它算"在底部"（网页 2px）。
    private static let followThreshold: Double = 2
    /// 离底部超过它才显示"滚动到底部"（网页 8px）。
    private static let atBottomThreshold: Double = 8

    // MARK: - 接上 / 断开 UIScrollView

    func attach(_ view: UIScrollView) {
        #if DEBUG
        ChatDebug.track(self)
        #endif
        if scrollView === view { return }
        detach()
        scrollView = view
        view.panGestureRecognizer.addTarget(self, action: #selector(handlePan(_:)))
        observations = [
            view.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
                MainActor.assumeIsolated { self?.geometryChanged() }
            },
            view.observe(\.contentSize, options: [.new]) { [weak self] _, _ in
                MainActor.assumeIsolated { self?.geometryChanged() }
            },
            view.observe(\.bounds, options: [.new]) { [weak self] _, _ in
                MainActor.assumeIsolated { self?.geometryChanged() }
            },
        ]
        geometryChanged()
    }

    func detach() {
        observations.forEach { $0.invalidate() }
        observations = []
        scrollView?.panGestureRecognizer.removeTarget(self, action: #selector(handlePan(_:)))
        scrollView = nil
        // 等着的检查都是对旧的 UIScrollView 的：一起取消。
        cancelProgrammatic()
        idleTask?.cancel()
        idleTask = nil
    }

    // MARK: - 给消息列表用的

    /// 开始跟随并贴到底（换了会话、消息条数变了）。内容还没排好时，排好后的高度变化会再贴一次。
    func follow() {
        following = true
        evaluate()
    }

    /// 可视区的大小变了（键盘升降、输入栏变高）：下一轮主循环等 UIScrollView 的 bounds 更新后再看。
    func viewportChanged() {
        Task { [weak self] in
            self?.evaluate()
        }
    }

    /// "滚动到底部"：生成中、或离得很远时直接跳到底（动画追不上变长的末尾），否则平滑滚动（网页 scrollChatToBottom）。
    func scrollToBottom(animated: Bool) {
        following = true
        guard let scrollView else { return }
        let target = CGPoint(x: scrollView.contentOffset.x, y: bottomOffset(scrollView))
        let far = distanceToBottom > Double(scrollView.bounds.height) * 2
        if animated, !far {
            programmatic = true
            programmaticTask?.cancel()
            programmaticTask = Task { [weak self] in
                // UIScrollView 的 setContentOffset(animated:) 大约 0.3 秒，结束时没有可以 KVO 的信号。
                try? await Task.sleep(nanoseconds: 400_000_000)
                guard !Task.isCancelled, let self else { return }
                self.programmatic = false
                self.evaluate()
            }
            scrollView.setContentOffset(target, animated: true)
        } else {
            cancelProgrammatic()
            scrollView.setContentOffset(target, animated: false)
            evaluate()
        }
    }

    /// 按现在的位置决定跟随 / 停止 / 贴底，并更新"是否在底部"。
    func evaluate() {
        guard let scrollView, !evaluating else { return }
        evaluating = true
        defer { evaluating = false }
        #if DEBUG
        // 候选修复 B 的规则（-NFChatPinPastEnd）：滚过了末尾、没在滚、也没有定位请求，就贴回去（跟不跟随都贴）。
        if ChatDebug.pinPastEnd, !revealPending, !isUserScrolling(scrollView), !programmatic,
           distanceToBottom < -Self.followThreshold {
            pin(scrollView)
            reportAtBottom()
            return
        }
        #endif
        let action = followAction(
            following: following,
            distanceToBottom: distanceToBottom,
            threshold: Self.followThreshold,
            scrolling: isUserScrolling(scrollView) || programmatic,
            programmaticScroll: programmatic,
            hasItems: hasItems,
            revealPending: revealPending
        )
        switch action {
        case .follow:
            following = true
        case .unfollow:
            following = false
        case .pin:
            // 回答变高了（或刚开始跟随）：贴底，不带动画，新的文字直接出现在底部。
            pin(scrollView)
        case .none:
            break
        }
        reportAtBottom()
    }

    // MARK: - 内部

    /// 列表末尾（含底部内边距）离可视区底边还有多远。
    private var distanceToBottom: Double {
        guard let scrollView else { return 0 }
        #if DEBUG
        // 候选修复 B（-NFChatPinPastEnd）：保留负数，evaluate 能看出滚过了末尾。其它读它的地方遇到负数和 0 一样。
        if ChatDebug.pinPastEnd { return Double(bottomOffset(scrollView) - scrollView.contentOffset.y) }
        #endif
        return max(0, Double(bottomOffset(scrollView) - scrollView.contentOffset.y))
    }

    /// 贴底时的 contentOffset.y；内容不满一屏时是顶部。
    private func bottomOffset(_ scrollView: UIScrollView) -> CGFloat {
        let insets = scrollView.adjustedContentInset
        return max(-insets.top, scrollView.contentSize.height + insets.bottom - scrollView.bounds.height)
    }

    private func isUserScrolling(_ scrollView: UIScrollView) -> Bool {
        scrollView.isTracking || scrollView.isDragging || scrollView.isDecelerating
    }

    private func pin(_ scrollView: UIScrollView) {
        #if DEBUG
        // 排查用（-NFChatNoPin）：从不贴底。候选修复 D 滚动期间也不贴。
        if ChatDebug.noPin || debugHoldPin { return }
        #endif
        let target = bottomOffset(scrollView)
        guard abs(scrollView.contentOffset.y - target) > 0.5 else { return }
        scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: target), animated: false)
    }

    private func geometryChanged() {
        evaluate()
        if let scrollView, isUserScrolling(scrollView) { scheduleIdleCheck() }
    }

    /// 惯性滚动停下时没有通知：位置不再变化后过一小会儿再看一次（"滚动停在底部又跟随"）。
    private func scheduleIdleCheck() {
        idleTask?.cancel()
        idleTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 80_000_000)
            guard !Task.isCancelled, let self else { return }
            if let scrollView = self.scrollView, self.isUserScrolling(scrollView) {
                self.scheduleIdleCheck()
            } else {
                self.evaluate()
            }
        }
    }

    private func cancelProgrammatic() {
        programmaticTask?.cancel()
        programmaticTask = nil
        programmatic = false
    }

    private func reportAtBottom() {
        let now = distanceToBottom <= Self.atBottomThreshold
        guard now != atBottom else { return }
        atBottom = now
        // 这里可能正处在 SwiftUI 的布局过程中（内容高度变了）：改界面状态放到下一轮。
        notifyTask?.cancel()
        notifyTask = Task { [weak self] in
            guard !Task.isCancelled, let self else { return }
            self.onAtBottomChange?(self.atBottom)
        }
    }

    @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
        switch recognizer.state {
        case .began:
            // 手指开始拖：先停止跟随（Android 的 DragInteraction.Start），松手时还在底部再恢复。
            cancelProgrammatic()
            following = false
        case .ended, .cancelled, .failed:
            if distanceToBottom <= Self.followThreshold { following = true }
            scheduleIdleCheck()
        default:
            break
        }
        reportAtBottom()
    }
}

#if DEBUG
extension ChatScrollController {
    /// CI 截图（chat-scrolled）用：停止跟随，先跳到最上面，再平滑地滚到离底部 `distance` 处停住，
    /// 让消息在浮动顶栏下面、"滚动到底部"按钮也显示出来。不改跟随规则本身。
    func fixtureScroll(distanceFromBottom distance: CGFloat) async {
        guard let scrollView else { return }
        following = false
        scrollView.setContentOffset(
            CGPoint(x: scrollView.contentOffset.x, y: -scrollView.adjustedContentInset.top),
            animated: false
        )
        try? await Task.sleep(nanoseconds: 100_000_000)
        // 等的时候列表可能换了（换了会话）：用现在接着的那个。
        guard let current = self.scrollView else { return }
        let target = max(-current.adjustedContentInset.top, bottomOffset(current) - distance)
        current.setContentOffset(CGPoint(x: current.contentOffset.x, y: target), animated: true)
        try? await Task.sleep(nanoseconds: 450_000_000)
        evaluate()
    }

    /// 候选修复 D（-NFChatScrollToRow）和 E（-NFChatStackIdentity）：对话里有行换掉之后修列表（ChatDebug）。
    /// 等新行进到列表里后做两遍。D 期间不贴底：旧的内容高度还在时，一贴底就又回到空白处。
    func debugRepairAfterReplace(_ proxy: ScrollViewProxy, replaced: String?, last: String?) {
        guard ChatDebug.scrollToRow || ChatDebug.stackIdentity, !revealPending else { return }
        debugRepairTask?.cancel()
        let wasFollowing = following
        debugHoldPin = ChatDebug.scrollToRow
        debugRepairTask = Task { [weak self] in
            for wait in [60, 100] {
                try? await Task.sleep(for: .milliseconds(wait))
                guard !Task.isCancelled, let self else { return }
                if ChatDebug.scrollToRow, let target = wasFollowing ? last : replaced {
                    proxy.scrollTo(target, anchor: wasFollowing ? UnitPoint.bottom : nil)
                }
                if ChatDebug.stackIdentity, wasFollowing, let scrollView = self.scrollView {
                    self.pin(scrollView)
                }
            }
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled, let self else { return }
            self.debugHoldPin = false
            self.evaluate()
        }
    }

    /// 列表的 UIScrollView 现在在窗口里。
    var debugInWindow: Bool { scrollView?.window != nil }

    /// `NF_CHAT_GEOMETRY` 里这个列表的部分（ChatDebug）：滚动位置、内边距、内容和可视区大小、跟随状态、出现过的行。
    /// `pastEnd` 大于 0 表示滚过了末尾；`area` 是两条浮动栏之间的消息可见区在屏幕上的位置（点），
    /// `chat-blank-check.py` 按它在截图里查是不是空白。只读不改。
    var debugGeometry: String {
        guard let scrollView else { return "attached=false following=\(following)" }
        let number = { (value: CGFloat) in String(format: "%.1f", Double(value)) }
        let insets = scrollView.adjustedContentInset
        let bounds = scrollView.bounds
        let content = scrollView.contentSize
        let offset = scrollView.contentOffset.y
        let end = bottomOffset(scrollView)
        var line = "attached=true following=\(following) hasItems=\(hasItems) revealPending=\(revealPending)"
        line += " offsetY=\(number(offset)) bottomY=\(number(end)) pastEnd=\(number(offset - end))"
        line += " insetTop=\(number(insets.top)) insetBottom=\(number(insets.bottom))"
        line += " contentW=\(number(content.width)) contentH=\(number(content.height))"
        line += " boundsW=\(number(bounds.width)) boundsH=\(number(bounds.height))"
        if let window = scrollView.window {
            let area = scrollView.convert(bounds.inset(by: insets), to: window.screen.coordinateSpace)
            let screen = window.screen.bounds.size
            line += " area=\(number(area.minX)),\(number(area.minY)),\(number(area.width)),\(number(area.height))"
            line += " screen=\(number(screen.width))x\(number(screen.height))"
        }
        let on = debugRowsOn.filter { $0.value > 0 }.keys.sorted()
        line += " rowsOn=\(on.count) rowsEver=\(debugRowsEver.count) rows=\(on.joined(separator: ","))"
        return line
    }
}
#endif

/// 放在滚动内容的背景里，只用来找到外面的 UIScrollView 并交给 `ChatScrollController`。不显示任何东西、不接触摸。
struct ChatScrollProbe: UIViewRepresentable {
    let controller: ChatScrollController

    func makeUIView(context: Context) -> ChatScrollProbeView {
        let view = ChatScrollProbeView()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        view.controller = controller
        return view
    }

    func updateUIView(_ uiView: ChatScrollProbeView, context: Context) {
        uiView.controller = controller
        uiView.locate()
    }
}

final class ChatScrollProbeView: UIView {
    weak var controller: ChatScrollController?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        locate()
        // 刚进窗口时上面的视图层级可能还没接好：下一轮主循环再找一次（已经接上的话 attach 直接返回）。
        Task { @MainActor [weak self] in
            self?.locate()
        }
    }

    /// 往上找第一个 UIScrollView（SwiftUI 的 ScrollView 背后就是它）。
    func locate() {
        guard window != nil else { return }
        var ancestor = superview
        while let view = ancestor {
            if let scrollView = view as? UIScrollView {
                controller?.attach(scrollView)
                return
            }
            ancestor = view.superview
        }
    }
}
