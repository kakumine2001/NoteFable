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

    /// 离底部不超过它算"在底部"（网页 2px）。
    private static let followThreshold: Double = 2
    /// 离底部超过它才显示"滚动到底部"（网页 8px）。
    private static let atBottomThreshold: Double = 8

    // MARK: - 接上 / 断开 UIScrollView

    func attach(_ view: UIScrollView) {
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
