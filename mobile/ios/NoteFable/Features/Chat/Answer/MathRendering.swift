import SwiftMath
import SwiftUI
import UIKit

// 数学公式的排版（网页用 KaTeX，Android 用 latex-renderer；这里用 SwiftMath，iosMath 的 Swift 版，自带 Latin Modern Math 字体）。
// 用到 SwiftMath 的地方都在这个文件里：`MTMathUILabel` 负责解析和排版，排好的结果（`displayList`）画成一张图片，
// 行内公式按基线嵌进文字，独立公式居中显示。同一个公式（源码、字号、颜色都相同）只排一次。
// LaTeX 源码原样交给 SwiftMath。Android 的 `MathMarkdown.typeset`（把 - 换成 `\minus` / U+2212）没有移植：那是给 latex-renderer 用的（它把 - 画成短横线），
// SwiftMath 自己就把 - 排成减号 U+2212，并按 TeX 的规则把开头、运算符后面的 - 当负号（MTMathList.finalized）；
// 它没有 `\minus` 命令（整个公式会报错），也不认 LaTeX 源码里的非 ASCII 字符 U+2212（直接丢掉，负号就没了）。

/// 排好的公式：图片，以及基线离图片底边的距离。
struct MathRender {
    let image: UIImage
    let descent: CGFloat
}

@MainActor
final class MathImageCache {
    static let shared = MathImageCache()

    private struct Key: Hashable {
        let latex: String
        let fontSize: CGFloat
        let ink: AnswerInk
        let display: Bool
    }

    /// 排不出来的也记着（值是 nil），不用每次重画都再试一遍。
    private var entries: [Key: MathRender?] = [:]
    private let limit = 600

    private init() {}

    /// `display` 为 true 是独立公式的排法（分数、求和的上下限更大），false 是行内的排法。
    /// 排不出来（写错、还没写完、库不支持的命令）返回 nil：调用方在原处显示 LaTeX 源码。
    func render(_ latex: String, fontSize: CGFloat, ink: AnswerInk, display: Bool) -> MathRender? {
        let key = Key(latex: latex, fontSize: fontSize, ink: ink, display: display)
        if let cached = entries[key] { return cached }
        // 很长的对话里公式很多时整个清掉重来，比记谁最久没用简单。
        if entries.count >= limit { entries.removeAll(keepingCapacity: true) }
        let result = Self.typeset(latex, fontSize: fontSize, color: ink.uiColor, display: display)
        entries.updateValue(result, forKey: key)
        return result
    }

    private static func typeset(_ latex: String, fontSize: CGFloat, color: UIColor, display: Bool) -> MathRender? {
        let label = MTMathUILabel(frame: .zero)
        label.displayErrorInline = false
        label.labelMode = display ? .display : .text
        label.textAlignment = .left
        label.fontSize = fontSize
        label.textColor = color
        label.latex = latex
        guard label.error == nil, label.mathList != nil else { return nil }

        let fitting = label.intrinsicContentSize
        guard fitting.width.isFinite, fitting.height.isFinite, fitting.width > 0, fitting.height > 0 else { return nil }
        // 高度不到半个字号的（一个减号、一个点）SwiftMath 按半个字号居中，图片也留这么高。
        let size = CGSize(width: ceil(fitting.width), height: ceil(max(fitting.height, fontSize / 2)))
        label.frame = CGRect(origin: .zero, size: size)
        label.setNeedsLayout()
        label.layoutIfNeeded()
        // 不在窗口里的视图有时不走布局：直接让它排一次。
        if label.displayList == nil { label.layoutSubviews() }
        guard let list = label.displayList else { return nil }

        // 和 MTMathUILabel 自己摆位置的算法一致：内容在图片里上下居中，基线离底边 = 留白的一半 + descent。
        let contentHeight = max(list.ascent + list.descent, fontSize / 2)
        let descent = (size.height - contentHeight) / 2 + list.descent

        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { context in
            let cg = context.cgContext
            cg.saveGState()
            // SwiftMath 按 y 轴朝上的坐标画，先把画布翻过来。
            cg.translateBy(x: 0, y: size.height)
            cg.scaleBy(x: 1, y: -1)
            list.draw(cg)
            cg.restoreGState()
        }
        return MathRender(image: image, descent: descent)
    }
}

/// 独立公式（网页 .katex-display）：单独一块，居中；比正文宽时在公式里横向滚动。数学公式始终从左往右排。
/// 字号 19.36（网页 .katex 是正文的 1.21 倍），颜色跟正文（引用里是灰色）。
struct DisplayMath: View, Equatable {
    let latex: String
    let ink: AnswerInk

    var body: some View {
        if let render = MathImageCache.shared.render(latex, fontSize: 19.36, ink: ink, display: true) {
            ViewThatFits(in: .horizontal) {
                formula(render)
                    .frame(maxWidth: .infinity)
                ScrollView(.horizontal) {
                    formula(render)
                }
                .scrollIndicators(.hidden)
            }
            // .katex-display 的 padding: 0.15rem 0。
            .padding(.vertical, 2.4)
            .environment(\.layoutDirection, .leftToRight)
        } else {
            // 排不出来的：显示 LaTeX 源码。
            Text(latex)
                .font(.nf(16))
                .nfLineHeight(27.52, fontSize: 16)
                .foregroundStyle(ink.color)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func formula(_ render: MathRender) -> some View {
        Image(uiImage: render.image)
            .accessibilityLabel(latex)
    }
}
