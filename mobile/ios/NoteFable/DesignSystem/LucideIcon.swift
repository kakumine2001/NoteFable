import SwiftUI

/// lucide 图标（Android `LucideIcon`、网页 lucide-react 组件）：24×24 的路径按 `size` 缩放，只描边、圆头圆角。
/// `strokeWidth` 和网页一样是 24 画布上的线宽（跟着图标一起缩放）：`size: 16, strokeWidth: 2` 画出来的线是 1.33。
/// `color` 不给时跟随外面的前景色（`foregroundStyle`），按钮样式可以按状态统一换色。
/// 有方向的图标（`Lucide.rtlMirrored`）在从右到左的界面里自动镜像，也可以用 `mirrorInRTL` 指定。
///
/// ```swift
/// LucideIcon(Lucide.menu, size: 20, strokeWidth: 2, color: Sm.muted)
/// LucideIcon(Lucide.chevronRight, size: 14)   // 阿拉伯语界面里指向左边
/// ```
/// 图标是装饰，读屏不念；需要念的时候在外面的按钮上写 `accessibilityLabel`。
struct LucideIcon: View {
    private let paths: [String]
    private let size: CGFloat
    private let strokeWidth: CGFloat
    private let color: Color?
    private let mirrorInRTL: Bool

    init(_ paths: [String], size: CGFloat, strokeWidth: CGFloat = 2, color: Color? = nil, mirrorInRTL: Bool? = nil) {
        self.paths = paths
        self.size = size
        self.strokeWidth = strokeWidth
        self.color = color
        self.mirrorInRTL = mirrorInRTL ?? Lucide.rtlMirrored.contains(paths)
    }

    var body: some View {
        LucideShape(paths: paths)
            .stroke(
                color.map { AnyShapeStyle($0) } ?? AnyShapeStyle(ForegroundStyle()),
                style: StrokeStyle(lineWidth: strokeWidth * size / 24, lineCap: .round, lineJoin: .round)
            )
            .frame(width: size, height: size)
            .flipsForRightToLeftLayoutDirection(mirrorInRTL)
            .accessibilityHidden(true)
    }
}

/// 图标的轮廓：把 24×24 画布上的路径缩放到给定的矩形里（居中，等比）。要自己填色 / 裁剪时直接用它。
struct LucideShape: Shape {
    let paths: [String]

    // Shape 在 iOS 17+ 默认会跟随 RTL 自动镜像，导致这里和外部的 `.flipsForRightToLeftLayoutDirection(mirrorInRTL)` 叠加后双重翻转。
    var layoutDirectionBehavior: LayoutDirectionBehavior { .fixed }

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        let transform = CGAffineTransform(
            a: scale, b: 0, c: 0, d: scale,
            tx: rect.midX - 12 * scale, ty: rect.midY - 12 * scale
        )
        return SVGPath.icon(paths).applying(transform)
    }
}
