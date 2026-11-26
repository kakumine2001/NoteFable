import SwiftUI
import UIKit

// 通用控件共用的小工具：量尺寸、键盘高度、按内容定高的滚动区、细线、图标格。

// MARK: - 量尺寸

extension View {
    /// 视图的尺寸出现和变化时回调（背景里放一个 `GeometryReader`，不影响布局）。
    ///
    /// ```swift
    /// content.nfOnSizeChange { size in height = size.height }
    /// ```
    func nfOnSizeChange(_ action: @escaping (CGSize) -> Void) -> some View {
        background {
            GeometryReader { proxy in
                Color.clear
                    .onChange(of: proxy.size, initial: true) { _, size in action(size) }
            }
        }
    }

    /// 视图的安全区边距变化时回调（不含第一次）：顶栏 / 底栏（`safeAreaBar`、`safeAreaInset`）、键盘、标签栏改变
    /// 留给内容的区域时触发。和 `nfOnSizeChange` 一样放在背景里，不影响布局。
    ///
    /// ```swift
    /// ScrollView { … }.nfOnSafeAreaChange { _ in scroll.viewportChanged() }
    /// ```
    func nfOnSafeAreaChange(_ action: @escaping (EdgeInsets) -> Void) -> some View {
        background {
            GeometryReader { proxy in
                Color.clear
                    .onChange(of: proxy.safeAreaInsets, initial: false) { _, insets in action(insets) }
            }
        }
    }
}

// MARK: - 键盘

/// 软键盘的位置。对话框、底部抽屉、全屏面板自己躲键盘（`NFOverlayMetrics.keyboardInset`），不靠系统的自动避让：
/// 这样不管根视图有没有 `ignoresSafeArea(.keyboard)`，结果都一样。
///
/// 一般不用直接读它；要在别处躲键盘时：`KeyboardObserver.shared.inset(below: proxy.frame(in: .global).maxY)`。
@MainActor
@Observable
final class KeyboardObserver {
    static let shared = KeyboardObserver()

    /// 键盘顶边在屏幕坐标里的 y；没有键盘时是 `.infinity`。
    private(set) var top: CGFloat = .infinity

    private init() {
        let center = NotificationCenter.default
        // 单例一直活着，不需要留着返回的 token 去注销。
        _ = center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] note in
            let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
            let duration = (note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
            MainActor.assumeIsolated {
                // 高度为 0 的帧是键盘收起（或接了硬件键盘）。
                let top = frame.map { $0.height > 0 ? $0.minY : CGFloat.infinity } ?? .infinity
                self?.update(top: top, duration: duration)
            }
        }
        _ = center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] note in
            let duration = (note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
            MainActor.assumeIsolated {
                self?.update(top: .infinity, duration: duration)
            }
        }
    }

    /// 底边在 `globalMaxY`（屏幕坐标）的区域被键盘挡住多高。
    func inset(below globalMaxY: CGFloat) -> CGFloat {
        max(0, globalMaxY - top)
    }

    private func update(top newTop: CGFloat, duration: Double) {
        guard newTop != top else { return }
        if duration > 0 {
            // 系统键盘的升降曲线没有公开，这组弹簧参数和它基本重合。
            withAnimation(.interpolatingSpring(mass: 3, stiffness: 1000, damping: 500, initialVelocity: 0)) { top = newTop }
        } else {
            top = newTop
        }
    }
}

// MARK: - 按内容定高的滚动区

/// 内容不高时和内容一样高，超过 `maxHeight` 就停在 `maxHeight` 并可以滚动（网页的 `max-height` + `overflow-y: auto`）。
/// 对话框、菜单、底部抽屉的内容区都用它。宽度跟外面给的宽度。
///
/// ```swift
/// FittingScrollView(maxHeight: 320) {
///     VStack(spacing: 2) { ForEach(rows) { row in … } }
/// }
/// ```
struct FittingScrollView<Content: View>: View {
    private let maxHeight: CGFloat
    private let content: Content
    @State private var contentHeight: CGFloat?

    init(maxHeight: CGFloat, @ViewBuilder content: () -> Content) {
        self.maxHeight = maxHeight
        self.content = content()
    }

    var body: some View {
        ScrollView(.vertical) {
            content
                .nfOnSizeChange { size in
                    if contentHeight != size.height { contentHeight = size.height }
                }
        }
        // 内容没超出时不能拖动回弹。
        .scrollBounceBehavior(.basedOnSize)
        // 量到内容高度之前先占满给的高度；外面的进场动画从透明开始，看不到这一帧。
        .frame(height: contentHeight.map { min($0, max(0, maxHeight)) })
    }
}

// MARK: - 细线

/// 1px 的分隔线（`border: 1px solid var(--notion-border)`）。SwiftUI 自带的 `Divider` 颜色和粗细跟着系统，不用。
///
/// ```swift
/// NFDivider()                       // 横线
/// NFDivider(.vertical, color: Sm.borderStrong)
/// ```
struct NFDivider: View {
    private let axis: Axis
    private let color: Color

    init(_ axis: Axis = .horizontal, color: Color = Sm.border) {
        self.axis = axis
        self.color = color
    }

    var body: some View {
        Rectangle()
            .fill(color)
            .frame(width: axis == .vertical ? 1 : nil, height: axis == .horizontal ? 1 : nil)
            .accessibilityHidden(true)
    }
}

// MARK: - 图标格

/// 聊天 / 笔记的图标：有表情就显示表情，没有就画默认的 lucide 图标，放在 `box` 见方的格子正中。
/// 网页的侧栏行（40 格、表情 / 图标 15）、笔记首页（28 格、20）、顶栏标题（15）都是这个结构。
/// 页面的默认图标按页面类型取（`pageKindIcon`）。
///
/// ```swift
/// NFIconTile(emoji: page.icon, fallback: pageKindIcon(page.kind), box: 40, glyph: 15)
/// ```
struct NFIconTile: View {
    private let emoji: String?
    private let fallback: [String]
    private let box: CGFloat
    private let glyph: CGFloat
    private let color: Color
    private let strokeWidth: CGFloat

    init(emoji: String?, fallback: [String], box: CGFloat, glyph: CGFloat, color: Color = Sm.muted, strokeWidth: CGFloat = 2) {
        self.emoji = emoji
        self.fallback = fallback
        self.box = box
        self.glyph = glyph
        self.color = color
        self.strokeWidth = strokeWidth
    }

    var body: some View {
        Group {
            if let image = NoteIcons.imagePath(emoji) {
                // 笔记的上传图片图标：和表情一样大（1em 四方、圆角 3），带 App 的 Cookie 读。
                RemoteImage(path: image)
                    .frame(width: glyph, height: glyph)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
            } else if let emoji, !emoji.isEmpty {
                // 表情按字号画，行高收紧到 1（网页 line-height: 1）。
                Text(emoji)
                    .font(.system(size: glyph))
                    .lineLimit(1)
                    .fixedSize()
            } else {
                LucideIcon(fallback, size: glyph, strokeWidth: strokeWidth, color: color)
            }
        }
        .frame(width: box, height: box)
        .accessibilityHidden(true)
    }
}
