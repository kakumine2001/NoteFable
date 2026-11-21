import SwiftUI

// 聊天界面共用的尺寸（网页 412×915 手机视口下量的值，见 docs/architecture/android-native.md 的对照表；Android ChatScreen.kt 开头）。
enum ChatMetrics {
    /// 消息列和空白首页左右的留白。
    static let pageGutter: CGFloat = 24
    /// 两条消息之间的间距。
    static let turnGap: CGFloat = 36
    /// 网页消息列的 pb-12（48）+ 输入栏区顶部"滚动到底部"那一行（40 + 8）。
    static let listBottomPadding: CGFloat = 96
}

/// 一行放不下就换到下一行（Compose 的 `FlowRow`，网页的 `flex-wrap`）：附件缩略图、文件标签、笔记标签都用它。
/// 比一整行还宽的子视图收到一整行的宽度（标签里的文字自己省略）。从右到左的界面由 SwiftUI 整体镜像。
///
/// ```swift
/// ChatFlowLayout(spacing: 8, lineSpacing: 8) {
///     ForEach(files, id: \.uri) { file in Chip(file) }
/// }
/// ```
struct ChatFlowLayout: Layout {
    /// 同一行里相邻两个的间距。
    var spacing: CGFloat = 8
    /// 行与行的间距。
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let arrangement = arrange(width: bounds.width, subviews: subviews)
        for (index, frame) in arrangement.frames.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(width: frame.width, height: frame.height)
            )
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], size: CGSize) {
        let bounded = width.isFinite
        let limit = bounded ? max(0, width) : CGFloat.greatestFiniteMagnitude
        var frames: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            var size = subview.sizeThatFits(ProposedViewSize(width: bounded ? limit : nil, height: nil))
            if bounded { size.width = min(size.width, limit) }
            if x > 0, x + size.width > limit {
                x = 0
                y += rowHeight + lineSpacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            widest = max(widest, x + size.width)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (frames, CGSize(width: widest, height: y + rowHeight))
    }
}
