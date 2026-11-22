import SwiftUI
import UIKit
import UniformTypeIdentifiers

// 输入栏的输入框（Android ChatScreen.kt 的 BasicTextField + contentReceiver）。
// 用 UITextView：SwiftUI 的 TextField 接不到粘贴的图片。文字 16 / 行高 24、光标墨色，最小高 40，随内容长高到 6 行，再多就在里面滚动。
// 粘贴：PNG / JPEG / WEBP 交给附件流程（网页 onPaste 的 getClipboardImageFiles），其它内容照常粘贴成文字。

/// 粘贴进来的一张图片。
struct ChatPastedImage {
    let data: Data
    let mimeType: String
    let fileExtension: String
}

enum ChatComposerMetrics {
    static let fontSize: CGFloat = 16
    static let lineHeight: CGFloat = 24
    /// 系统字体 16 的自然行高（约 1.193 倍）；差的部分一半在第一行上面，其余由行间距补上。
    static var lineGap: CGFloat { max(0, lineHeight - UIFont.systemFont(ofSize: fontSize).lineHeight) }
    /// 文字离输入框顶 4、离行首 6（Android decorator 的 padding）。
    static let topInset: CGFloat = 4
    static let leadingInset: CGFloat = 6
    static let minHeight: CGFloat = 40
    /// 最多 6 行（TextFieldLineLimits.MultiLine(maxHeightInLines = 6)）：顶上的留白（4 + 半个行距）+ 6 个行高。
    static var maxHeight: CGFloat { topInset + lineGap / 2 + lineHeight * 6 }
}

/// 输入框 + 占位文字。高度跟着内容：`ChatComposerTextView` 量出内容高度后报上来。
struct ChatComposerInput: View {
    let text: String
    let placeholder: String
    /// 上传附件期间不能改文字（网页此时输入框是只读的）；键盘不收起。
    let readOnly: Bool
    /// 每加一就聚焦一次（引用回答、点了最近的笔记）。
    let focusRequest: Int
    let onTextChange: (String) -> Void
    let onFocusChange: (Bool) -> Void
    let onPasteImages: ([ChatPastedImage]) -> Void

    @State private var contentHeight: CGFloat = ChatComposerMetrics.minHeight

    var body: some View {
        ChatComposerTextView(
            text: text,
            readOnly: readOnly,
            focusRequest: focusRequest,
            label: placeholder,
            onTextChange: onTextChange,
            onFocusChange: onFocusChange,
            onPasteImages: onPasteImages,
            onHeightChange: { height in
                if abs(height - contentHeight) > 0.5 { contentHeight = height }
            }
        )
        .frame(height: min(max(contentHeight, ChatComposerMetrics.minHeight), ChatComposerMetrics.maxHeight))
        .frame(maxWidth: .infinity)
        .overlay(alignment: .topLeading) {
            if text.isEmpty {
                Text(placeholder)
                    .font(.nf(ChatComposerMetrics.fontSize))
                    .nfLineHeight(ChatComposerMetrics.lineHeight, fontSize: ChatComposerMetrics.fontSize)
                    .foregroundStyle(Sm.faint)
                    .lineLimit(1)
                    .padding(.leading, ChatComposerMetrics.leadingInset)
                    .padding(.top, ChatComposerMetrics.topInset)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }
}

struct ChatComposerTextView: UIViewRepresentable {
    let text: String
    let readOnly: Bool
    let focusRequest: Int
    let label: String
    let onTextChange: (String) -> Void
    let onFocusChange: (Bool) -> Void
    let onPasteImages: ([ChatPastedImage]) -> Void
    let onHeightChange: (CGFloat) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> ChatComposerUITextView {
        // TextKit 1：行间距用 NSLayoutManagerDelegate 统一给，不依赖每段文字自己的段落样式。
        let view = ChatComposerUITextView(usingTextLayoutManager: false)
        let coordinator = context.coordinator
        view.delegate = coordinator
        view.layoutManager.delegate = coordinator
        view.backgroundColor = .clear
        view.font = UIFont.systemFont(ofSize: ChatComposerMetrics.fontSize)
        view.textColor = SmUI.text
        view.tintColor = SmUI.ink
        view.textContainer.lineFragmentPadding = 0
        view.contentInsetAdjustmentBehavior = .never
        view.isScrollEnabled = true
        view.alwaysBounceVertical = false
        view.showsVerticalScrollIndicator = false
        view.showsHorizontalScrollIndicator = false
        view.adjustsFontForContentSizeCategory = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.text = text
        view.accessibilityLabel = label
        coordinator.lastFocusRequest = focusRequest
        view.acceptsImagePaste = { [weak coordinator] in !(coordinator?.parent.readOnly ?? true) }
        view.onPasteImages = { [weak coordinator] images in coordinator?.parent.onPasteImages(images) }
        view.onWidthChange = { [weak coordinator, weak view] in
            guard let coordinator, let view else { return }
            coordinator.reportHeight(view)
        }
        applyInsets(view, context: context)
        return view
    }

    func updateUIView(_ uiView: ChatComposerUITextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        // ViewModel 自己改了草稿（发出后清空、上限时放回被拒的原文）：写回输入框，光标放到末尾。
        // 文字相同就不碰：输入法正在组字（中文、日文）时重设文字会打断它。
        if uiView.text != text {
            uiView.text = text
            let end = uiView.endOfDocument
            uiView.selectedTextRange = uiView.textRange(from: end, to: end)
            coordinator.reportHeight(uiView)
        }
        if uiView.accessibilityLabel != label { uiView.accessibilityLabel = label }
        applyInsets(uiView, context: context)
        if coordinator.lastFocusRequest != focusRequest {
            coordinator.lastFocusRequest = focusRequest
            // 等这一轮更新走完（输入框可能刚进窗口）再聚焦。
            Task { @MainActor [weak uiView] in
                _ = uiView?.becomeFirstResponder()
            }
        }
    }

    /// 文字离顶 4（再加半个行距，和网页 line-height 把字放在行中间一样）、离行首 6。
    private func applyInsets(_ view: UITextView, context: Context) {
        let rtl = context.environment.layoutDirection == .rightToLeft
        let insets = UIEdgeInsets(
            top: ChatComposerMetrics.topInset + ChatComposerMetrics.lineGap / 2,
            left: rtl ? 0 : ChatComposerMetrics.leadingInset,
            bottom: 0,
            right: rtl ? ChatComposerMetrics.leadingInset : 0
        )
        if view.textContainerInset != insets { view.textContainerInset = insets }
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate, NSLayoutManagerDelegate {
        var parent: ChatComposerTextView
        var lastFocusRequest = 0
        private var lastHeight: CGFloat = 0

        init(_ parent: ChatComposerTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.onTextChange(textView.text ?? "")
            reportHeight(textView)
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            notifyFocus(true)
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            notifyFocus(false)
        }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            !parent.readOnly
        }

        /// 排版可能不在主线程上问这个值，所以不挂在主线程上（只读常量）。
        nonisolated func layoutManager(
            _ layoutManager: NSLayoutManager,
            lineSpacingAfterGlyphAt glyphIndex: Int,
            withProposedLineFragmentRect rect: CGRect
        ) -> CGFloat {
            ChatComposerMetrics.lineGap
        }

        /// 量内容的高度报给外面；内容没超过上限时不让它在里面滚走。
        func reportHeight(_ textView: UITextView) {
            let width = textView.bounds.width
            guard width > 0 else { return }
            let fitting = textView.sizeThatFits(CGSize(width: width, height: CGFloat.greatestFiniteMagnitude))
            let height = fitting.height.rounded(.up)
            let overflowing = height > ChatComposerMetrics.maxHeight
            if textView.showsVerticalScrollIndicator != overflowing { textView.showsVerticalScrollIndicator = overflowing }
            if !overflowing, textView.contentOffset.y != 0 {
                textView.setContentOffset(.zero, animated: false)
            }
            guard abs(height - lastHeight) > 0.5 else { return }
            lastHeight = height
            // 可能正在 SwiftUI 的更新过程里：改状态放到下一轮主循环。
            let report = parent.onHeightChange
            DispatchQueue.main.async { report(height) }
        }

        private func notifyFocus(_ focused: Bool) {
            let notify = parent.onFocusChange
            DispatchQueue.main.async { notify(focused) }
        }
    }
}

/// 能接住粘贴图片的 UITextView。
final class ChatComposerUITextView: UITextView {
    /// 现在收不收图片（上传附件期间不收）。
    var acceptsImagePaste: () -> Bool = { true }
    var onPasteImages: (([ChatPastedImage]) -> Void)?
    /// 宽度变了（第一次排版、转屏）：行数可能变了，要重新量高度。
    var onWidthChange: (() -> Void)?
    private var lastWidth: CGFloat = 0

    override func layoutSubviews() {
        super.layoutSubviews()
        if abs(bounds.width - lastWidth) > 0.5 {
            lastWidth = bounds.width
            onWidthChange?()
        }
    }

    /// 剪贴板里只有图片时系统不给"粘贴"：自己打开。
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(UIResponderStandardEditActions.paste(_:)), acceptsImagePaste(), UIPasteboard.general.hasImages {
            return true
        }
        return super.canPerformAction(action, withSender: sender)
    }

    override func paste(_ sender: Any?) {
        guard acceptsImagePaste() else {
            super.paste(sender)
            return
        }
        let content = ChatPasteboardReader.read(UIPasteboard.general)
        guard !content.images.isEmpty else {
            super.paste(sender)
            return
        }
        onPasteImages?(content.images)
        // 和图片一起拷来的文字照常贴进输入框。
        let text = content.text.joined(separator: "\n")
        if !text.isEmpty { insertText(text) }
    }
}

/// 把剪贴板的内容分成图片和文字：每一项有图片就当图片，否则取它的文字。
enum ChatPasteboardReader {
    static func read(_ pasteboard: UIPasteboard) -> (images: [ChatPastedImage], text: [String]) {
        var images: [ChatPastedImage] = []
        var text: [String] = []
        for index in 0..<pasteboard.numberOfItems {
            let item = IndexSet(integer: index)
            if let image = image(pasteboard, item: item, index: index) {
                images.append(image)
            } else if let string = string(pasteboard, item: item) {
                text.append(string)
            }
        }
        return (images, text)
    }

    private static func image(_ pasteboard: UIPasteboard, item: IndexSet, index: Int) -> ChatPastedImage? {
        // 网页也收的三种类型（PASTE_IMAGE_TYPES）原样用。
        let accepted: [(type: UTType, mimeType: String, fileExtension: String)] = [
            (UTType.png, "image/png", "png"),
            (UTType.jpeg, "image/jpeg", "jpg"),
            (UTType.webP, "image/webp", "webp"),
        ]
        for entry in accepted where PASTE_IMAGE_TYPES.contains(entry.mimeType) {
            if let data = pasteboard.data(forPasteboardType: entry.type.identifier, inItemSet: item)?.first, !data.isEmpty {
                return ChatPastedImage(data: data, mimeType: entry.mimeType, fileExtension: entry.fileExtension)
            }
        }
        // 别的图片格式（照片 App 拷的 HEIC 等，浏览器里粘贴时系统会先转好）：转成 JPEG 再收。
        let items = pasteboard.items
        guard index < items.count else { return nil }
        for identifier in items[index].keys {
            guard let type = UTType(identifier), type.conforms(to: .image) else { continue }
            guard let data = pasteboard.data(forPasteboardType: identifier, inItemSet: item)?.first,
                  let decoded = UIImage(data: data),
                  let jpeg = decoded.jpegData(compressionQuality: 0.9)
            else { continue }
            return ChatPastedImage(data: jpeg, mimeType: "image/jpeg", fileExtension: "jpg")
        }
        return nil
    }

    private static func string(_ pasteboard: UIPasteboard, item: IndexSet) -> String? {
        let types = [UTType.utf8PlainText.identifier, UTType.plainText.identifier, UTType.text.identifier, UTType.url.identifier]
        for identifier in types {
            guard let value = pasteboard.values(forPasteboardType: identifier, inItemSet: item)?.first else { continue }
            if let string = value as? String, !string.isEmpty { return string }
            if let url = value as? URL { return url.absoluteString }
        }
        return nil
    }
}
