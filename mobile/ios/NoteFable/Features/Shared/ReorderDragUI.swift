import SwiftUI
import UIKit

// 列表拖动排序的界面部分（Android ui/ReorderDrag.kt；网页 reorder-row-button.tsx + globals.css 的 .list-reorder-*、[data-order-*]）。
// 聊天侧栏和笔记侧栏 / 首页共用。找目标的规则在 Core（`DragState`、`DropTarget`、`dropTargetAt`、`reorderScrollDelta`）。
//
// - 没有专门的把手：长按行的标题区后拖动（网页触屏：350ms、移动不超过 8），开始时一次触感 `Haptics.dragStart()`；点按照常打开。
// - 被拖的行半透明 .5；目标行上 / 下出现 2px 蓝线 #2383e2；拖到投放区（项目标题、Chats / Notes 标签）上整块
//   rgba(35,131,226,.12) 底加 1px 蓝框、圆角 4。
// - 手指在列表上下边 30 以内移动时每次移动滚 12（手指不动就不滚）。长按之前的滑动照常滚动列表。
// - 失败提示 .list-reorder-error：行下方，宽 220、内边距 6、白底、1px 细线、12 红字，点一下关闭。
//
// 长按用 UIKit 的 `UILongPressGestureRecognizer`，装在列表所在的 UIScrollView 上（和系统列表的长按排序同一套机制）：
// 长按生效之前手指一动就是普通滚动；长按生效后它独占这次触摸，滚动手势、行上的点按、抽屉的横滑都不会再触发。
// 坐标都在“列表内容”的坐标系里（跟着内容一起滚），所以自动滚动时登记的位置不用重量。
//
// ## 接口
//
// ```swift
// @State private var reorder = ReorderDragController()          // 每个列表一个
//
// ScrollView {
//     VStack(spacing: 0) {
//         SectionLabel("CHATS")
//             .reorderDropZone("", in: reorder)                    // 投放区：键是容器 id，空白键（""、" "）= 无项目
//         ForEach(rows) { row in
//             HStack {
//                 Icon(row)
//                 Button { if !reorder.swallowsTap() { open(row) } } label: { Title(row) }
//                     .reorderHandle(row.id, in: reorder, locked: busy.contains(row.id))   // 长按这里开始拖
//                 MoreButton(row)
//             }
//             .reorderRow(row.id, in: reorder)                     // 整行是落点：半透明、插入线
//             .reorderError(errorText(row)) { dismissError() }     // 可选：行下方的失败提示
//         }
//     }
//     .reorderContainer(reorder, onStart: { _ in dismissError() }) { id, target in
//         viewModel.drop(id, on: target)                           // 松手：target 可能是 nil（没有落在任何目标上）
//     }
// }
// ```
//
// - `reorderContainer` 要放在 ScrollView **里面**的内容上（它顺着父视图找 UIScrollView）；不在 ScrollView 里也能拖，只是不会自动滚动。
// - 要自己画插入线时：`.reorderRow(id, in: reorder, showsDropLine: false)`，再读 `reorder.dropLine(id)`。
// - 读 `reorder.dragging` / `reorder.target` / `reorder.isDropZoneActive(key)` 会跟着拖动重绘。
// - `ReorderDragSession.isActive`：有列表正在拖（抽屉的横滑手势用它让路）。

/// 插入线和投放区的蓝色（#2383e2）。
let ReorderDropBlue = Sm.blue
/// 投放区的底色 rgba(35,131,226,.12)。
private let ReorderDropFill = Color(argb: 0x1F2383E2)

/// 有没有列表正在拖动排序。别的手势（抽屉的横滑）在拖动期间让路。
@MainActor
enum ReorderDragSession {
    fileprivate static var count = 0

    static var isActive: Bool { count > 0 }
}

// MARK: - 控制器

/// 一个列表的拖动状态。界面读 `dragging` / `target`（被拖的行、当前目标）来画半透明、插入线和投放区。
/// 行、标题区、投放区的位置由各自的修饰符登记，离开界面（折叠、删除）时注销，免得命中已经看不见的行。
@MainActor
@Observable
final class ReorderDragController {
    /// 正在拖的行；没在拖是 nil。
    private(set) var dragging: String?
    /// 手指下的目标。
    private(set) var target: DropTarget?
    /// 当前目标是投放区时它的键（同一个容器可以有几个投放区，只高亮手指下的那个）。
    private(set) var targetZone: String?

    /// 列表内容的坐标系的名字（`let` 不参与观察，不用标 @ObservationIgnored）。
    let space = UUID()

    private struct Slot {
        var owner: UUID
        var frame: CGRect
        var locked = false
    }

    /// 找目标用的状态（Core 的规则）。位置在拖动开始 / 移动时从下面三张表拷进去。
    @ObservationIgnored private var drag = DragState()
    @ObservationIgnored private var rows: [String: Slot] = [:]
    @ObservationIgnored private var zones: [String: Slot] = [:]
    @ObservationIgnored private var handles: [String: Slot] = [:]
    @ObservationIgnored private var lastEnded: Date?
    /// 投放规则（工作区的分区，Core 的 `noteDropRules`）：拖动开始时问一次，拖完之前一直用这一份。
    @ObservationIgnored var rules: () -> ReorderDropRules = { ReorderDropRules() }
    @ObservationIgnored private var activeRules = ReorderDropRules()

    init() {}

    var isDragging: Bool { dragging != nil }

    /// 这一行上要不要画插入线（[data-order-drop="before|after"]）。
    func dropLine(_ id: String) -> (before: Bool, after: Bool) {
        guard case .row(let targetId, let after) = target, targetId == id else { return (false, false) }
        return (!after, after)
    }

    /// 投放区 `key` 要不要高亮（[data-order-drop="into"]）。
    func isDropZoneActive(_ key: String) -> Bool {
        dragging != nil && targetZone == key
    }

    /// 刚拖完（或正在拖）：这时到的点按不算数（网页 suppressClick）。行的点按动作里先问一下。
    /// 一般用不到（长按生效时系统已经取消了行上的按下），留作保险。
    func swallowsTap() -> Bool {
        if dragging != nil { return true }
        guard let lastEnded else { return false }
        return Date().timeIntervalSince(lastEnded) < 0.25
    }

    // ---- 登记位置（修饰符调用）----

    fileprivate func setRow(_ id: String, owner: UUID, frame: CGRect?) {
        Self.store(&rows, id, owner, frame, locked: false)
    }

    fileprivate func setZone(_ key: String, owner: UUID, frame: CGRect?) {
        Self.store(&zones, key, owner, frame, locked: false)
    }

    fileprivate func setHandle(_ id: String, owner: UUID, frame: CGRect?, locked: Bool) {
        Self.store(&handles, id, owner, frame, locked: locked)
    }

    /// 同一个 id 的行换了位置（从一个分组到另一个）时，新的先登记、旧的后注销：只让登记的那一个注销自己。
    private static func store(_ table: inout [String: Slot], _ key: String, _ owner: UUID, _ frame: CGRect?, locked: Bool) {
        if let frame {
            table[key] = Slot(owner: owner, frame: frame, locked: locked)
        } else if table[key]?.owner == owner {
            table[key] = nil
        }
    }

    // ---- 手势（ReorderProbeView 调用）----

    /// `point` 下能拖的行（按在标题区上，而且没锁）。
    fileprivate func handle(at point: CGPoint) -> String? {
        handles.keys.sorted().first { id in
            guard let slot = handles[id] else { return false }
            return !slot.locked && slot.frame.contains(point)
        }
    }

    fileprivate func begin(_ id: String, at point: CGPoint, visible: CGRect) {
        if drag.dragging != nil { _ = end() }
        Haptics.dragStart()
        activeRules = rules()
        sync(visible)
        drag.start(id, at: point, tag: activeRules.tag(id))
        ReorderDragSession.count += 1
        publish()
    }

    /// 手指移动一次。返回列表这次要滚的量（0 = 不滚）。
    fileprivate func move(to point: CGPoint, visible: CGRect) -> CGFloat {
        guard drag.dragging != nil else { return 0 }
        sync(visible)
        let delta = drag.move(point)
        publish()
        return CGFloat(delta)
    }

    /// 列表滚了以后手指下的内容变了：按新的位置再找一次目标。
    fileprivate func update(at point: CGPoint, visible: CGRect) {
        guard drag.dragging != nil else { return }
        sync(visible)
        drag.update(point)
        publish()
    }

    /// 松手或取消。返回被拖的行和当时的目标；没在拖是 nil。
    fileprivate func end() -> (id: String, target: DropTarget?)? {
        guard let id = drag.dragging else { return nil }
        let result = (id: id, target: drag.target)
        drag.clear()
        ReorderDragSession.count = max(0, ReorderDragSession.count - 1)
        lastEnded = Date()
        publish()
        return result
    }

    private func sync(_ visible: CGRect) {
        drag.listBounds = visible
        drag.rows = rows.mapValues(\.frame)
        drag.zones = zones.mapValues(\.frame)
        drag.zoneContainers = activeRules.zoneContainers
        drag.zoneAccepts = activeRules.zoneAccepts
        drag.rowAccepts = activeRules.rowAccepts
    }

    /// 只在变了的时候写，免得每次手指移动都让所有行重绘。
    private func publish() {
        if dragging != drag.dragging { dragging = drag.dragging }
        if target != drag.target { target = drag.target }
        if targetZone != drag.targetZone { targetZone = drag.targetZone }
    }
}

// MARK: - 修饰符

extension View {
    /// 列表的内容（ScrollView 里面的那一层）：提供坐标系、接长按拖动、靠近上下边时自动滚动，松手时报告 `(被拖的行, 目标)`。
    /// `onStart` 在长按生效时调用（参数是被拖的行；用来关掉上一次的失败提示）。
    func reorderContainer(
        _ controller: ReorderDragController,
        onStart: @escaping (String) -> Void = { _ in },
        onDrop: @escaping (String, DropTarget?) -> Void
    ) -> some View {
        self
            .background { ReorderProbe(controller: controller, onStart: onStart, onDrop: onDrop) }
            .coordinateSpace(NamedCoordinateSpace.named(controller.space))
    }

    /// 一整行：登记成落点（别的行可以放到它前 / 后），被拖时半透明 .5，是目标时上边或下边画 2px 蓝线。
    func reorderRow(_ id: String, in controller: ReorderDragController, showsDropLine: Bool = true) -> some View {
        ReorderRowView(id: id, controller: controller, showsDropLine: showsDropLine, content: self)
    }

    /// 行的标题区：长按这里开始拖这一行。`locked` 时不能拖（这一行正在移动）。
    func reorderHandle(_ id: String, in controller: ReorderDragController, locked: Bool = false) -> some View {
        ReorderHandleView(id: id, controller: controller, locked: locked, content: self)
    }

    /// 投放区（项目行、Chats / Notes 标签）：拖到上面时整块浅蓝底加 1px 蓝框。`key` 是容器 id；空白键（""、" "）= 无项目。
    func reorderDropZone(_ key: String, in controller: ReorderDragController, cornerRadius: CGFloat = 4) -> some View {
        ReorderDropZoneView(key: key, controller: controller, cornerRadius: cornerRadius, content: self)
    }

    /// `.list-reorder-error`：拖动失败的原因，显示在这一行下方（`rowHeight` 处），点一下关闭。`text` 为 nil 时不显示。
    func reorderError(_ text: String?, rowHeight: CGFloat = 44, onDismiss: @escaping () -> Void) -> some View {
        self
            .overlay(alignment: .topLeading) {
                if let text {
                    ReorderErrorBubble(text: text, onDismiss: onDismiss)
                        .offset(y: rowHeight)
                }
            }
            // 盖在下面几行之上（网页 z-index: 5）。
            .zIndex(text == nil ? 0 : 5)
    }
}

/// 2px 的插入线。自己画插入线的行可以直接用。
struct ReorderDropLine: View {
    var body: some View {
        Rectangle()
            .fill(ReorderDropBlue)
            .frame(height: 2)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

private struct ReorderRowView<Content: View>: View {
    let id: String
    let controller: ReorderDragController
    let showsDropLine: Bool
    let content: Content
    @State private var owner = UUID()

    var body: some View {
        let line = showsDropLine ? controller.dropLine(id) : (before: false, after: false)
        content
            .overlay(alignment: .top) {
                if line.before { ReorderDropLine() }
            }
            .overlay(alignment: .bottom) {
                if line.after { ReorderDropLine() }
            }
            .opacity(controller.dragging == id ? 0.5 : 1)
            .modifier(ReorderFrameReader(space: controller.space, flag: false) { frame, _ in
                controller.setRow(id, owner: owner, frame: frame)
            })
    }
}

private struct ReorderHandleView<Content: View>: View {
    let id: String
    let controller: ReorderDragController
    let locked: Bool
    let content: Content
    @State private var owner = UUID()

    var body: some View {
        content
            .modifier(ReorderFrameReader(space: controller.space, flag: locked) { frame, locked in
                controller.setHandle(id, owner: owner, frame: frame, locked: locked)
            })
    }
}

private struct ReorderDropZoneView<Content: View>: View {
    let key: String
    let controller: ReorderDragController
    let cornerRadius: CGFloat
    let content: Content
    @State private var owner = UUID()

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius)
        content
            .background {
                if controller.isDropZoneActive(key) {
                    shape
                        .fill(ReorderDropFill)
                        .overlay { shape.strokeBorder(ReorderDropBlue, lineWidth: 1) }
                        .allowsHitTesting(false)
                }
            }
            .modifier(ReorderFrameReader(space: controller.space, flag: false) { frame, _ in
                controller.setZone(key, owner: owner, frame: frame)
            })
    }
}

private struct ReorderFrameKey: Equatable {
    var frame: CGRect
    var flag: Bool
}

/// 把视图在列表坐标系里的位置报出去（出现、变化时）；离开界面时报 nil。
private struct ReorderFrameReader: ViewModifier {
    let space: UUID
    let flag: Bool
    let report: (CGRect?, Bool) -> Void

    func body(content: Content) -> some View {
        content.background {
            GeometryReader { proxy in
                Color.clear
                    .onChange(
                        of: ReorderFrameKey(frame: proxy.frame(in: NamedCoordinateSpace.named(space)), flag: flag),
                        initial: true
                    ) { _, key in
                        report(key.frame, key.flag)
                    }
                    .onDisappear { report(nil, false) }
            }
        }
    }
}

private struct ReorderErrorBubble: View {
    let text: String
    let onDismiss: () -> Void

    var body: some View {
        Button(action: onDismiss) {
            Text(text)
                .font(.nf(12))
                .nfLineHeight(16, fontSize: 12)
                // .list-reorder-error：--notion-surface 底、--nf-danger 的字；深色是 --nf-error-bg 底、--nf-error-text 的字
                // （半透明的红底垫在 --notion-surface 上，免得透出下面的行）。
                .foregroundStyle(Color(light: 0xFFB91C1C, dark: 0xFFFCA5A5))
                .multilineTextAlignment(.leading)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(6)
                .frame(width: 220)
                .background(Color(light: 0x00FFFFFF, dark: 0x29EF4444))
                .background(Sm.surface)
                .overlay { Rectangle().strokeBorder(Sm.border, lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .fixedSize()
        .onAppear { UIAccessibility.post(notification: .announcement, argument: text) }
    }
}

// MARK: - 长按手势（UIKit）

/// 铺在列表内容后面的一个看不见的 UIView：用它找到所在的 UIScrollView 并装上长按手势，也用它把触摸位置换算到内容坐标。
private struct ReorderProbe: UIViewRepresentable {
    let controller: ReorderDragController
    let onStart: (String) -> Void
    let onDrop: (String, DropTarget?) -> Void

    func makeUIView(context: Context) -> ReorderProbeView {
        let view = ReorderProbeView()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: ReorderProbeView, context: Context) {
        uiView.controller = controller
        uiView.onStart = onStart
        uiView.onDrop = onDrop
    }

    static func dismantleUIView(_ uiView: ReorderProbeView, coordinator: ()) {
        uiView.detach()
    }
}

private final class ReorderProbeView: UIView, UIGestureRecognizerDelegate {
    weak var controller: ReorderDragController?
    var onStart: ((String) -> Void)?
    var onDrop: ((String, DropTarget?) -> Void)?

    private weak var host: UIView?
    private weak var scrollView: UIScrollView?
    private var recognizer: UILongPressGestureRecognizer?
    /// 拖动期间关掉了列表自己的滚动手势，结束时恢复。
    private var panDisabled = false

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { detach() } else { attach() }
    }

    /// 顺着父视图找最近的 UIScrollView；没有就装在最外层的视图上（能拖，不会自动滚）。
    private func attach() {
        var scroll: UIScrollView?
        var top: UIView?
        var current = superview
        while let view = current, !(view is UIWindow) {
            if let found = view as? UIScrollView {
                scroll = found
                break
            }
            top = view
            current = view.superview
        }
        let candidate: UIView? = scroll ?? top
        guard let target = candidate else { return }
        if host === target, recognizer != nil { return }
        detach()
        let press = UILongPressGestureRecognizer(target: self, action: #selector(pressed(_:)))
        // 网页触屏：按住 350ms 生效，这之前移动超过 8 就算滑动。
        press.minimumPressDuration = 0.35
        press.allowableMovement = 8
        press.delegate = self
        target.addGestureRecognizer(press)
        host = target
        scrollView = scroll
        recognizer = press
    }

    func detach() {
        finish(dropped: false)
        if let recognizer { recognizer.view?.removeGestureRecognizer(recognizer) }
        recognizer = nil
        host = nil
        scrollView = nil
    }

    // 只接按在“能拖的标题区”上的触摸，别的地方完全不受影响。
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard let controller else { return false }
        return controller.handle(at: touch.location(in: self)) != nil
    }

    @objc private func pressed(_ press: UILongPressGestureRecognizer) {
        guard let controller else { return }
        let point = press.location(in: self)
        switch press.state {
        case .began:
            guard let id = controller.handle(at: point) else {
                // 按下后这一行锁住了或离开了：这次长按作废。
                press.isEnabled = false
                press.isEnabled = true
                return
            }
            onStart?(id)
            if let scrollView, scrollView.panGestureRecognizer.isEnabled {
                scrollView.panGestureRecognizer.isEnabled = false
                panDisabled = true
            }
            controller.begin(id, at: point, visible: visibleRect())
        case .changed:
            let delta = controller.move(to: point, visible: visibleRect())
            if delta != 0, scroll(by: delta) {
                controller.update(at: press.location(in: self), visible: visibleRect())
            }
        case .ended:
            finish(dropped: true)
        case .cancelled, .failed:
            finish(dropped: false)
        default:
            break
        }
    }

    private func finish(dropped: Bool) {
        if panDisabled {
            scrollView?.panGestureRecognizer.isEnabled = true
            panDisabled = false
        }
        guard let result = controller?.end() else { return }
        if dropped { onDrop?(result.id, result.target) }
    }

    /// 列表的可见区域，换算到内容坐标（自动滚动的上下边）。
    private func visibleRect() -> CGRect {
        if let scrollView {
            return scrollView.convert(scrollView.bounds.inset(by: scrollView.adjustedContentInset), to: self)
        }
        if let window { return convert(window.bounds, from: nil) }
        return bounds
    }

    /// 滚 `delta`（到头就不滚）。滚了返回 true。
    private func scroll(by delta: CGFloat) -> Bool {
        guard let scrollView else { return false }
        let inset = scrollView.adjustedContentInset
        let top = -inset.top
        let bottom = max(top, scrollView.contentSize.height - scrollView.bounds.height + inset.bottom)
        let offset = scrollView.contentOffset
        let next = min(max(offset.y + delta, top), bottom)
        guard next != offset.y else { return false }
        scrollView.setContentOffset(CGPoint(x: offset.x, y: next), animated: false)
        return true
    }
}
