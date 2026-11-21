import SwiftUI
import UIKit

// 可以选中的回答文字，和选中后菜单里的「问 NoteFable」（网页 quote-selection.tsx，Android `QuoteSelection.kt`）。
//
// SwiftUI 的 `Text` 在 iOS 上只能整段复制，不能选一部分，也加不了菜单项，所以写完的回答每一段用一个
// 不能编辑、不滚动的 `UITextView`；生成途中的回答仍然是 `Text`（见 `AnswerRichText`）。
// 「问 NoteFable」排在系统的「拷贝」「全选」前面（Android 也是第一项）；上传附件期间发出的内容已定，不出这一项。
// 引用之后取消选中（Android 是换 key 重建选区）。选区限于一段之内（一段一个 `UITextView`）。

/// 「问 NoteFable」：`perform` 收到选中的文字。没有提供时（没有对话、回答没写完或失败了）菜单里只有系统的项。
struct AnswerQuoteAction {
    /// 菜单项的文字（`L("ask_notefable")`）。
    let title: String
    /// 现在能不能引用（上传附件期间不能）。每次弹出菜单时问一次。
    let isAvailable: @MainActor () -> Bool
    let perform: @MainActor (String) -> Void
}

private struct AnswerQuoteKey: EnvironmentKey {
    static let defaultValue: AnswerQuoteAction? = nil
}

extension EnvironmentValues {
    var answerQuote: AnswerQuoteAction? {
        get { self[AnswerQuoteKey.self] }
        set { self[AnswerQuoteKey.self] = newValue }
    }
}

/// `SelectableText` 显示的内容由什么决定：这几样没变，拼出来的文字就一样。
/// 不直接比 `NSAttributedString`：公式的 `NSTextAttachment` 每次拼都是新对象、只按对象比，带公式的段落永远"不相等"。
struct SelectableTextContent: Equatable {
    let pieces: [AnswerInlinePiece]
    let style: AnswerTextStyle
    let baseURL: String
}

/// 一段可以选中的富文本。宽度跟内容（最宽到外面给的宽度），高度跟着折行后的内容。
struct SelectableText: UIViewRepresentable {
    let text: NSAttributedString
    /// `text` 的来源；它没变时不重设文字。
    let content: SelectableTextContent
    /// 外面给的宽度是 0（父视图在问"最窄多窄"）时报的高度：一行的行高。
    let minHeight: CGFloat
    let quote: AnswerQuoteAction?
    let onOpenLink: (URL) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView(frame: .zero)
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.dataDetectorTypes = []
        view.adjustsFontForContentSizeCategory = false
        // 拖动选中的文字没有用处，还会和滚动、选区手柄抢手势。
        view.textDragInteraction?.isEnabled = false
        // .markdown-body a：蓝色、下划线（字重在文字的属性里）。
        view.linkTextAttributes = [
            .foregroundColor: UIColor(Sm.blue),
            .underlineStyle: NSUnderlineStyle.single.rawValue,
        ]
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.quote = quote
        coordinator.onOpenLink = onOpenLink
        // 内容没变就不重设：重设会丢掉用户正在选的选区（回答之外的重绘也会走到这里）。
        if coordinator.content != content {
            view.attributedText = text
            view.invalidateIntrinsicContentSize()
            coordinator.content = content
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let proposed = proposal.width else {
            // 没给宽度：问的是不折行时多大。
            let ideal = uiView.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude))
            return CGSize(width: ceil(ideal.width), height: ceil(ideal.height))
        }
        // 宽度 0 是父视图在问最小尺寸：可以一直变窄，不用真的去排一遍。
        guard proposed > 0 else { return CGSize(width: 0, height: minHeight) }
        let width = proposed.isFinite ? proposed : CGFloat.greatestFiniteMagnitude
        let fitting = uiView.sizeThatFits(CGSize(width: width, height: CGFloat.greatestFiniteMagnitude))
        return CGSize(width: min(width, ceil(fitting.width)), height: ceil(fitting.height))
    }

    /// `range` 里的文字；公式的图片换回 `$…$` 的 LaTeX 源码（`NSAttributedString.Key.answerSource`）。
    static func sourceText(_ attributed: NSAttributedString, range: NSRange) -> String {
        let clamped = NSIntersectionRange(range, NSRange(location: 0, length: attributed.length))
        guard clamped.length > 0 else { return "" }
        var out = ""
        attributed.enumerateAttribute(.answerSource, in: clamped, options: []) { value, part, _ in
            if let source = value as? String {
                out += source
            } else {
                out += attributed.attributedSubstring(from: part).string
            }
        }
        return out
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        var quote: AnswerQuoteAction?
        var onOpenLink: ((URL) -> Void)?
        /// 现在显示着的内容。
        var content: SelectableTextContent?

        // 点链接：交给外面（本站的聊天链接在 App 里开，其余用系统浏览器），不走系统默认的打开方式和长按预览。
        func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
            if interaction == .invokeDefaultAction { onOpenLink?(URL) }
            return false
        }

        // 公式是图片附件：不让长按出"存储图片"之类的菜单。
        func textView(
            _ textView: UITextView,
            shouldInteractWith textAttachment: NSTextAttachment,
            in characterRange: NSRange,
            interaction: UITextItemInteraction
        ) -> Bool {
            false
        }

        // 选中文字后的菜单：最前面加「问 NoteFable」，后面是系统的项。
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard let quote, range.length > 0, quote.isAvailable() else { return nil }
            let ask = UIAction(title: quote.title) { [weak textView] _ in
                guard let textView else { return }
                let shown: NSAttributedString = textView.attributedText ?? NSAttributedString()
                let selected = SelectableText.sourceText(shown, range: textView.selectedRange)
                // 引用后取消选中。
                textView.selectedTextRange = nil
                if !ChatText.isBlank(selected) { quote.perform(selected) }
            }
            var children: [UIMenuElement] = [ask]
            children.append(contentsOf: suggestedActions)
            return UIMenu(children: children)
        }
    }
}
