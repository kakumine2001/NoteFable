import SwiftUI
import UIKit

// 回答正文里的一段行内内容（Android `AnswerMarkdown.kt` 交给 Markdown 库画的那部分）：
// `[MarkdownInline]` 先摊平成一串带样式的小段，再按需要拼成两种形式：
//  - SwiftUI 的 `Text`（生成途中用：只有最后一块在变，拼 `Text` 最省）；
//  - `NSAttributedString`（写完的回答放进 `SelectableText`，可以选中、引用；表格量列宽也用它）。
// 样式对照网页 .markdown-body：粗体 600、链接蓝色 500 带下划线、行内代码 #e2e8f0 底 + #0f172a + 等宽 0.85em、
// 行内公式是正文的 1.21 倍并按基线嵌进文字。

// MARK: - 样式

/// 正文的三种文字色。做成枚举是为了能当公式图片缓存的键。
enum AnswerInk: Hashable {
    /// --notion-text：正文。
    case text
    /// --notion-muted：引用块里的文字。
    case muted
    /// --nf-ink：标题、表头。
    case ink

    var color: Color {
        switch self {
        case .text: return Sm.text
        case .muted: return Sm.muted
        case .ink: return Sm.ink
        }
    }

    var uiColor: UIColor { UIColor(color) }
}

/// 一段文字的基础样式（字号 / 行高 / 字重 / 颜色 / 字距）。
struct AnswerTextStyle: Equatable {
    var size: CGFloat = 16
    var lineHeight: CGFloat = 27.52
    /// CSS 的字重数值。
    var weight: Int = 400
    var ink: AnswerInk = .text
    var tracking: CGFloat = 0

    /// 正文 16 / 行高 1.72；引用块里是灰色。
    static func body(muted: Bool) -> AnswerTextStyle {
        AnswerTextStyle(ink: muted ? .muted : .text)
    }

    /// 标题：24.8 / 20.8 / 17.28，650、--nf-ink、行高 1.3、字距 -0.015em（阿拉伯语等从右到左的文字不加字距）。
    static func heading(level: Int, rtl: Bool) -> AnswerTextStyle {
        let size: CGFloat = level <= 1 ? 24.8 : (level == 2 ? 20.8 : 17.28)
        return AnswerTextStyle(size: size, lineHeight: size * 1.3, weight: 650, ink: .ink, tracking: rtl ? 0 : size * -0.015)
    }

    /// 表头：--nf-ink、600。
    static let tableHeader = AnswerTextStyle(weight: 600, ink: .ink)
}

private let inlineCodeBackground = Color(argb: 0xFFE2E8F0)
private let inlineCodeInk = Color(argb: 0xFF0F172A)

// MARK: - 摊平

/// 行内元素叠起来的样式。
struct AnswerInlineAttributes: Equatable {
    var strong = false
    var emphasis = false
    var strikethrough = false
    var code = false
    /// 链接的地址（`MarkdownInline.link` 的 destination，可能是相对地址）。
    var link: String?
}

/// 摊平后的一小段。
enum AnswerInlinePiece: Equatable {
    case text(String, AnswerInlineAttributes)
    /// 行内公式的 LaTeX 源码。
    case math(String, AnswerInlineAttributes)
    case image(source: String, alt: String, link: String?)

    static func flatten(_ inlines: [MarkdownInline]) -> [AnswerInlinePiece] {
        var out: [AnswerInlinePiece] = []
        append(inlines, AnswerInlineAttributes(), to: &out)
        return out
    }

    private static func append(_ inlines: [MarkdownInline], _ attributes: AnswerInlineAttributes, to out: inout [AnswerInlinePiece]) {
        for inline in inlines {
            switch inline {
            case .text(let text):
                out.append(.text(text, attributes))
            case .strong(let children):
                var next = attributes
                next.strong = true
                append(children, next, to: &out)
            case .emphasis(let children):
                var next = attributes
                next.emphasis = true
                append(children, next, to: &out)
            case .strikethrough(let children):
                var next = attributes
                next.strikethrough = true
                append(children, next, to: &out)
            case .code(let code):
                var next = attributes
                next.code = true
                out.append(.text(code, next))
            case .link(let destination, let children):
                var next = attributes
                next.link = destination
                append(children, next, to: &out)
            case .image(let source, let alt):
                out.append(.image(source: source, alt: alt, link: attributes.link))
            case .softBreak:
                // 源文里的普通换行：和网页一样画成一个空格。
                out.append(.text(" ", attributes))
            case .lineBreak:
                out.append(.text("\n", attributes))
            case .math(let latex):
                out.append(.math(latex, attributes))
            }
        }
    }
}

/// 一个段落里交替出现的文字和图片：图片单独成块显示（网页的 <img> 也是另起一块那么大），文字照常排。
enum AnswerInlineSegment {
    case text([AnswerInlinePiece])
    case image(source: String, alt: String, link: String?)

    static func split(_ inlines: [MarkdownInline]) -> [AnswerInlineSegment] {
        var out: [AnswerInlineSegment] = []
        var pending: [AnswerInlinePiece] = []
        func isBlank(_ pieces: [AnswerInlinePiece]) -> Bool {
            pieces.allSatisfy { piece in
                if case .text(let text, _) = piece { return ChatText.isBlank(text) }
                return false
            }
        }
        for piece in AnswerInlinePiece.flatten(inlines) {
            if case .image(let source, let alt, let link) = piece {
                // 图片之间只有空白的文字不单独占一行。
                if !isBlank(pending) { out.append(.text(pending)) }
                pending = []
                out.append(.image(source: source, alt: alt, link: link))
            } else {
                pending.append(piece)
            }
        }
        if !isBlank(pending) || out.isEmpty { out.append(.text(pending)) }
        return out
    }
}

// MARK: - 链接

/// 链接地址按站点地址补全（网页上相对于当前页面）：`/c/…`、`#…` 这样的相对地址接在 `AppConfig.baseURL` 后面。
struct AnswerLinkResolver {
    private let base: URL?

    init(baseURL: String) {
        base = URL(string: baseURL + "/")
    }

    func url(_ destination: String) -> URL? {
        if let url = URL(string: destination), url.scheme != nil { return url }
        guard let base else { return nil }
        return URL(string: destination, relativeTo: base)?.absoluteURL
    }
}

// MARK: - 拼成文字

extension NSAttributedString.Key {
    /// 这一段在引用时要换成的原文（公式图片 → `$…$` 的 LaTeX 源码）。
    static let answerSource = NSAttributedString.Key("NoteFableAnswerSource")
}

@MainActor
enum AnswerInlineRenderer {
    /// 行内公式相对正文的大小（网页 .katex 是 1.21em）。
    static let mathScale: CGFloat = 1.21

    // ---- SwiftUI ----

    static func text(_ pieces: [AnswerInlinePiece], style: AnswerTextStyle, links: AnswerLinkResolver) -> Text {
        var out = Text(verbatim: "")
        // 相邻的文字攒成一个 AttributedString 再变成 Text，少拼几次。
        var pending = AttributedString()
        var hasPending = false
        for piece in pieces {
            switch piece {
            case .text(let string, let attributes):
                pending.append(attributed(string, attributes, style: style, links: links))
                hasPending = true
            case .image(_, let alt, let link):
                // 走到这里的图片（表格单元格里的）只显示替代文字。
                guard !alt.isEmpty else { continue }
                pending.append(attributed(alt, AnswerInlineAttributes(link: link), style: style, links: links))
                hasPending = true
            case .math(let latex, let attributes):
                guard let render = MathImageCache.shared.render(latex, fontSize: style.size * mathScale, ink: style.ink, display: false) else {
                    // 排不出来的公式（写错、还没写完、库不支持）：原处显示 LaTeX 源码。
                    pending.append(attributed(latex, attributes, style: style, links: links))
                    hasPending = true
                    continue
                }
                if hasPending {
                    out = out + Text(pending)
                    pending = AttributedString()
                    hasPending = false
                }
                // 图片的底边在基线上：往下放 descent，公式的基线就和文字的对齐了。
                let formula: Text = Text(Image(uiImage: render.image))
                    .baselineOffset(-render.descent)
                    .accessibilityLabel(Text(verbatim: latex))
                out = out + formula
            }
        }
        if hasPending { out = out + Text(pending) }
        return out
    }

    private static func attributed(
        _ string: String,
        _ attributes: AnswerInlineAttributes,
        style: AnswerTextStyle,
        links: AnswerLinkResolver
    ) -> AttributedString {
        var part = AttributedString(string)
        let url = attributes.link.flatMap { links.url($0) }
        var font: Font
        if attributes.code {
            font = .system(size: style.size * 0.85, weight: .css(fontWeight(attributes, style, isLink: url != nil)), design: .monospaced)
        } else {
            font = .system(size: style.size, weight: .css(fontWeight(attributes, style, isLink: url != nil)))
        }
        if attributes.emphasis { font = font.italic() }
        part.swiftUI.font = font
        part.swiftUI.foregroundColor = foreground(attributes, style, isLink: url != nil)
        if attributes.code { part.swiftUI.backgroundColor = inlineCodeBackground }
        if attributes.strikethrough { part.swiftUI.strikethroughStyle = Text.LineStyle.single }
        if style.tracking != 0 { part.swiftUI.tracking = style.tracking }
        if let url {
            part.link = url
            part.swiftUI.underlineStyle = Text.LineStyle.single
        }
        return part
    }

    /// 粗体 600；链接 500；其余跟这一段的基础字重（标题 650、表头 600）。
    private static func fontWeight(_ attributes: AnswerInlineAttributes, _ style: AnswerTextStyle, isLink: Bool) -> Int {
        var weight = style.weight
        if isLink { weight = max(weight, 500) }
        if attributes.strong { weight = max(weight, 600) }
        return weight
    }

    private static func foreground(_ attributes: AnswerInlineAttributes, _ style: AnswerTextStyle, isLink: Bool) -> Color {
        if isLink { return Sm.blue }
        if attributes.code { return inlineCodeInk }
        // .markdown-body strong 写死了 --notion-text：引用块里的粗体也是正文色。
        if attributes.strong, style.ink == .muted { return Sm.text }
        return style.ink.color
    }

    // ---- UIKit ----

    static func attributedString(_ pieces: [AnswerInlinePiece], style: AnswerTextStyle, links: AnswerLinkResolver) -> NSAttributedString {
        let out = NSMutableAttributedString()
        let baseFont = uiFont(size: style.size, weight: style.weight, monospaced: false, italic: false)
        let paragraph = NSMutableParagraphStyle()
        // 只定最小行高：行里有比较高的公式时那一行自己变高（和网页一样）。
        paragraph.minimumLineHeight = style.lineHeight
        paragraph.lineBreakMode = .byWordWrapping
        // 多出来的行高系统全放在字的上面；往上提一半，字就在行的正中（CSS 的 line-height 是上下平分）。
        let lift = max(0, (style.lineHeight - baseFont.lineHeight) / 2)
        var common: [NSAttributedString.Key: Any] = [.paragraphStyle: paragraph, .baselineOffset: lift]
        if style.tracking != 0 { common[.kern] = style.tracking }

        func append(_ string: String, _ attributes: AnswerInlineAttributes) {
            let url = attributes.link.flatMap { links.url($0) }
            var values = common
            values[.font] = uiFont(
                size: attributes.code ? style.size * 0.85 : style.size,
                weight: fontWeight(attributes, style, isLink: url != nil),
                monospaced: attributes.code,
                italic: attributes.emphasis
            )
            values[.foregroundColor] = UIColor(foreground(attributes, style, isLink: url != nil))
            if attributes.code { values[.backgroundColor] = UIColor(inlineCodeBackground) }
            if attributes.strikethrough { values[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if let url {
                values[.link] = url
                values[.underlineStyle] = NSUnderlineStyle.single.rawValue
            }
            out.append(NSAttributedString(string: string, attributes: values))
        }

        for piece in pieces {
            switch piece {
            case .text(let string, let attributes):
                append(string, attributes)
            case .image(_, let alt, let link):
                if !alt.isEmpty { append(alt, AnswerInlineAttributes(link: link)) }
            case .math(let latex, let attributes):
                guard let render = MathImageCache.shared.render(latex, fontSize: style.size * mathScale, ink: style.ink, display: false) else {
                    append(latex, attributes)
                    continue
                }
                let attachment = NSTextAttachment()
                attachment.image = render.image
                attachment.bounds = CGRect(x: 0, y: -render.descent, width: render.image.size.width, height: render.image.size.height)
                let formula = NSMutableAttributedString(attributedString: NSAttributedString(attachment: attachment))
                var values = common
                values[.answerSource] = "$\(latex)$"
                formula.addAttributes(values, range: NSRange(location: 0, length: formula.length))
                out.append(formula)
            }
        }
        return out
    }

    private static func uiFont(size: CGFloat, weight: Int, monospaced: Bool, italic: Bool) -> UIFont {
        let uiWeight = uiFontWeight(weight)
        let font = monospaced ? UIFont.monospacedSystemFont(ofSize: size, weight: uiWeight) : UIFont.systemFont(ofSize: size, weight: uiWeight)
        guard italic else { return font }
        let traits = font.fontDescriptor.symbolicTraits.union(.traitItalic)
        guard let descriptor = font.fontDescriptor.withSymbolicTraits(traits) else { return font }
        return UIFont(descriptor: descriptor, size: size)
    }

    /// CSS font-weight 数值 → 系统字重（和 `Font.Weight.css` 同一张表）。
    private static func uiFontWeight(_ value: Int) -> UIFont.Weight {
        switch value {
        case ..<350: return .light
        case ..<450: return .regular
        case ..<550: return .medium
        case ..<650: return .semibold
        case ..<750: return .bold
        default: return .heavy
        }
    }

    // ---- 量宽度（表格分配列宽用）----

    /// 一段文字要多宽：`max` 是整段不折行，`min` 是最长的那个不能折行的词（中日韩文字每个字都能折行）。
    static func measure(_ text: NSAttributedString) -> AnswerTableLayout.CellWidth {
        guard text.length > 0 else { return AnswerTableLayout.CellWidth(min: 0, max: 0) }
        let unlimited = CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        let full = text.boundingRect(with: unlimited, options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).width
        let string = text.string as NSString
        var longest: CGFloat = 0
        var start = 0
        var index = 0
        // 量完 [start, end) 这个词。
        func closeToken(_ end: Int) {
            guard end > start else { return }
            let width = text.attributedSubstring(from: NSRange(location: start, length: end - start)).size().width
            longest = max(longest, width)
        }
        while index < string.length {
            let range = string.rangeOfComposedCharacterSequence(at: index)
            let unit = string.character(at: range.location)
            let next = NSMaxRange(range)
            if isSpace(unit) {
                closeToken(range.location)
                start = next
            } else if breaksAnywhere(unit) {
                closeToken(range.location)
                start = range.location
                closeToken(next)
                start = next
            }
            index = next
        }
        closeToken(string.length)
        // 多留 1：UIKit 和 SwiftUI 量出来差零点几，会让最后一个词折行。
        let maxWidth = Double(ceil(full)) + 1
        return AnswerTableLayout.CellWidth(min: Swift.min(Double(ceil(longest)) + 1, maxWidth), max: maxWidth)
    }

    private static func isSpace(_ unit: unichar) -> Bool {
        unit == 0x20 || unit == 0x09 || unit == 0x0A || unit == 0x0D || unit == 0x3000
    }

    /// 汉字、假名、谚文、全角符号（以及代理对：表情、扩展区汉字）：前后都可以折行。
    private static func breaksAnywhere(_ unit: unichar) -> Bool {
        switch unit {
        case 0x2E80...0x9FFF, 0xAC00...0xD7AF, 0xD800...0xDFFF, 0xF900...0xFAFF, 0xFE30...0xFE4F, 0xFF00...0xFFEF: return true
        default: return false
        }
    }
}

// MARK: - 视图

/// 回答里的文字能不能选中（写完的回答能；生成途中用普通 `Text`，最省）。
private struct AnswerSelectableKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var answerSelectable: Bool {
        get { self[AnswerSelectableKey.self] }
        set { self[AnswerSelectableKey.self] = newValue }
    }
}

/// 一段带样式的文字。宽度跟内容（最宽到外面给的宽度），折行。
struct AnswerRichText: View {
    let pieces: [AnswerInlinePiece]
    let style: AnswerTextStyle

    @Environment(\.answerSelectable) private var selectable
    @Environment(\.answerQuote) private var quote
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        let links = AnswerLinkResolver(baseURL: app.config.baseURL)
        if selectable {
            SelectableText(
                text: AnswerInlineRenderer.attributedString(pieces, style: style, links: links),
                content: SelectableTextContent(pieces: pieces, style: style, baseURL: app.config.baseURL),
                minHeight: style.lineHeight,
                quote: quote,
                onOpenLink: { url in openLink(url) }
            )
        } else {
            AnswerInlineRenderer.text(pieces, style: style, links: links)
                .nfLineHeight(style.lineHeight, fontSize: style.size)
                .tint(Sm.blue)
                .environment(\.openURL, OpenURLAction { url in
                    openLink(url)
                    return .handled
                })
        }
    }

    /// 指向本站聊天的链接在 App 里打开，其余交给系统浏览器。
    @MainActor
    private func openLink(_ url: URL) {
        if router.handleIncomingURL(url) { return }
        UIApplication.shared.open(url)
    }
}

/// 一个段落（或标题）：文字照常排，夹在里面的图片各占一块。
struct AnswerParagraph: View {
    let inlines: [MarkdownInline]
    let style: AnswerTextStyle

    var body: some View {
        let segments = AnswerInlineSegment.split(inlines)
        if segments.count == 1, case .text(let pieces) = segments[0] {
            AnswerRichText(pieces: pieces, style: style)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                    switch segment {
                    case .text(let pieces):
                        AnswerRichText(pieces: pieces, style: style)
                    case .image(let source, let alt, let link):
                        AnswerInlineImage(source: source, alt: alt, link: link)
                    }
                }
            }
        }
    }
}

/// 回答正文里的图片（Markdown 的 `![alt](url)`）：按原来的大小显示，最宽到正文的宽度（网页 img 的 max-width: 100%）。
/// 读到之前和读不到时显示替代文字。外面套着链接的，点一下打开链接。
private struct AnswerInlineImage: View {
    let source: String
    let alt: String
    let link: String?

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    /// 带着地址和身份记：段落里的图片按位置排，同一个位置换了地址（生成途中）或换了身份时不留旧图。
    @State private var loaded: LoadedImage? = nil

    var body: some View {
        let links = AnswerLinkResolver(baseURL: app.config.baseURL)
        let address = links.url(source)?.absoluteString ?? source
        Group {
            if let image = loaded?.current(address, app: app) ?? RemoteImageLoader.cachedImage(address, app: app) {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: image.size.width)
                    .accessibilityLabel(alt)
            } else if !alt.isEmpty {
                Text(alt)
                    .font(.nf(16))
                    .foregroundStyle(Sm.muted)
            }
        }
        .onTapGesture {
            guard let link, let url = links.url(link) else { return }
            if router.handleIncomingURL(url) { return }
            UIApplication.shared.open(url)
        }
        .task(id: RemoteImageRequest(path: address, generation: app.identityGeneration)) {
            let image = await RemoteImageLoader.image(address, app: app)
            if Task.isCancelled { return }
            loaded = image.map { LoadedImage(path: address, generation: app.identityGeneration, image: $0) }
        }
    }
}
