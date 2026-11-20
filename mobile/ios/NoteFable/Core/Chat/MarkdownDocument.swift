import Foundation
import Markdown

// 回答正文的 Markdown 解析成一棵可以直接画的值树。Android 用现成的渲染库（mikepenz markdown），iOS 没有同款，
// 所以用 swift-markdown（cmark-gfm）解析，界面层（SwiftUI）照着这棵树原生地画，样式对照网页 .markdown-body。
// 语法范围和网页的 react-markdown + remark-gfm 一致：表格、删除线、任务列表、裸网址自动成链接；
// 链接和图片的地址按网页 defaultUrlTransform 的规则过滤；数学公式经 MathMarkdown 的占位符放回来。
//
// swift-markdown 的类型（Text、Link、Image、Table、CodeBlock…）在这个文件里一律写成 `Markdown.X`：
// App 模块里同名的类型（比如界面层的 CodeBlock 视图）会盖过导入的名字。

/// 行内元素。
indirect enum MarkdownInline: Equatable, Sendable {
    case text(String)
    case strong([MarkdownInline])
    case emphasis([MarkdownInline])
    case strikethrough([MarkdownInline])
    /// 行内代码（网页 .markdown-inline-code）。
    case code(String)
    /// `destination` 已按网页的规则过滤和编码；可能是相对地址（`/c/…`、`#…`），由界面按站点地址解析。
    case link(destination: String, children: [MarkdownInline])
    case image(source: String, alt: String)
    /// 源文里的普通换行：画成一个空格（和网页一样不换行）。
    case softBreak
    /// 行尾两个空格或反斜杠的强制换行。
    case lineBreak
    /// 行内公式的 LaTeX 源码（交给排版前先过 `MathMarkdown.typeset`）。
    case math(String)

    /// 不带样式的文字（量宽度、读屏用）。公式是 LaTeX 源码，图片是替代文字。
    static func plainText(_ inlines: [MarkdownInline]) -> String {
        var out = ""
        for inline in inlines {
            switch inline {
            case .text(let text), .code(let text), .math(let text): out += text
            case .strong(let children), .emphasis(let children), .strikethrough(let children), .link(_, let children):
                out += plainText(children)
            case .image(_, let alt): out += alt
            case .softBreak: out += " "
            case .lineBreak: out += "\n"
            }
        }
        return out
    }
}

/// 一个块。`id` 由它在树里的位置和种类决定，和内容无关：回答一边生成、最后一块一边变长时，SwiftUI 认得出是同一块；
/// 内容没变的块相等（Equatable），不用重画。
struct MarkdownBlock: Equatable, Identifiable, Sendable {
    let id: String
    let content: Content

    indirect enum Content: Equatable, Sendable {
        case paragraph([MarkdownInline])
        /// `level` 是 1…6。
        case heading(level: Int, [MarkdownInline])
        case list(MarkdownList)
        case blockQuote([MarkdownBlock])
        /// 围栏代码或缩进代码。`language` 是围栏上写的语言（没写、缩进代码是 nil），`code` 不带末尾的换行。
        /// 没写完的围栏（生成途中）也在这里，一直到文末都算代码。
        case codeBlock(language: String?, code: String)
        case table(MarkdownTable)
        case thematicBreak
        /// 独立公式：整段只有一个独立公式的段落，或 ```math 代码块。
        case math(latex: String)
        /// HTML 块的原文（当普通文字显示；网页 react-markdown 的 skipHtml 是直接不显示）。
        case html(String)

        /// 写进 `id` 的种类名。
        var tag: String {
            switch self {
            case .paragraph: return "p"
            case .heading: return "h"
            case .list(let list): return list.ordered ? "ol" : "ul"
            case .blockQuote: return "quote"
            case .codeBlock: return "code"
            case .table: return "table"
            case .thematicBreak: return "hr"
            case .math: return "math"
            case .html: return "html"
            }
        }
    }
}

struct MarkdownList: Equatable, Sendable {
    let ordered: Bool
    /// 有序列表第一项的编号（源文里写的，`3.` 开头就是 3）；无序列表是 1。第 n 项的编号见 `orderedListMarker`。
    let start: Int
    /// 紧凑列表（项与项之间没有空行）：项里的段落之间不加段落间距，和网页不包 `<p>` 一样。
    let tight: Bool
    let items: [MarkdownListItem]
}

struct MarkdownListItem: Equatable, Identifiable, Sendable {
    let id: String
    /// 任务列表：true 已勾、false 未勾；普通列表项是 nil。
    let checkbox: Bool?
    let blocks: [MarkdownBlock]
}

struct MarkdownTable: Equatable, Sendable {
    enum Alignment: Equatable, Sendable {
        case left, center, right
    }

    /// 每列的对齐标记（`:--`、`:-:`、`--:`），没写的是 nil。网页的 CSS 把单元格一律左对齐，标记只是如实带出来。
    let alignments: [Alignment?]
    let header: [[MarkdownInline]]
    /// 每行的单元格数都等于表头的列数（少的补空、多的丢掉，GFM 的规则）。
    let rows: [[[MarkdownInline]]]

    var columnCount: Int { header.count }
}

struct MarkdownDocument: Equatable, Sendable {
    let blocks: [MarkdownBlock]

    static let empty = MarkdownDocument(blocks: [])

    /// 解析一条回答的原文。`math` 为 false 时不认公式（网页 `<AssistantMarkdown math={false}>`：笔记历史的预览）。
    /// 生成途中的半截 Markdown 也能解析：没写完的围栏是代码块，没写完的公式、表格先当普通文字。
    static func parse(_ markdown: String, math: Bool = true) -> MarkdownDocument {
        let prepared = math ? MathMarkdown.prepare(markdown) : MathMarkdown.Prepared(text: markdown, formulas: [])
        return parse(prepared: prepared, math: math)
    }

    /// `prepared` 是 `MathMarkdown.prepare` 的结果（公式已换成占位符）。
    static func parse(prepared: MathMarkdown.Prepared, math: Bool = true) -> MarkdownDocument {
        if prepared.text.isEmpty { return .empty }
        // 不要 cmark 的"智能标点"（把 -- 换成破折号、直引号换成弯引号）：网页不换。
        let document = Markdown.Document(parsing: prepared.text, options: [.disableSmartOpts])
        let converter = MarkdownConverter(formulas: prepared.formulas, math: math)
        return MarkdownDocument(blocks: converter.blocks(of: document, path: "", depth: 0))
    }
}

/// 链接、图片地址的过滤（网页 react-markdown 的 defaultUrlTransform）和编码（micromark 的 normalizeUri）。
enum MarkdownLinks {
    private static let safeProtocols: Set<String> = ["http", "https", "irc", "ircs", "mailto", "xmpp"]

    /// 可以用的地址（已编码）；不安全的协议（javascript:、data:、file: …）和空地址返回 nil。
    /// 没有协议的是相对地址，照样放行（网页上相对于当前页面）。
    static func safeUrl(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        let url = normalizeUri(value)
        let scalars = Array(url.unicodeScalars)
        guard let colon = scalars.firstIndex(of: ":") else { return url }
        // 第一个冒号在 /、?、# 后面：不是协议。
        for mark in "/?#".unicodeScalars {
            if let index = scalars.firstIndex(of: mark), colon > index { return url }
        }
        let scheme = String(String.UnicodeScalarView(scalars[..<colon])).lowercased()
        return safeProtocols.contains(scheme) ? url : nil
    }

    /// 不能直接出现在地址里的字符写成 `%XX`，已经编码好的 `%XX` 不动。
    static func normalizeUri(_ value: String) -> String {
        let scalars = Array(value.unicodeScalars)
        var out = ""
        var i = 0
        while i < scalars.count {
            let scalar = scalars[i]
            if scalar == "%", i + 2 < scalars.count, ChatText.isASCIIAlphanumeric(scalars[i + 1]),
               ChatText.isASCIIAlphanumeric(scalars[i + 2]) {
                out.unicodeScalars.append(contentsOf: scalars[i...(i + 2)])
                i += 3
                continue
            }
            if isUriCharacter(scalar) {
                out.unicodeScalars.append(scalar)
            } else {
                ChatText.percentEncode(scalar, into: &out)
            }
            i += 1
        }
        return out
    }

    /// normalizeUri 留着不编码的 ASCII：`[!#$&-;=?-Z_a-z~]`。
    private static func isUriCharacter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x21, 0x23, 0x24, 0x3D, 0x5F, 0x7E: return true
        case 0x26...0x3B, 0x3F...0x5A, 0x61...0x7A: return true
        default: return false
        }
    }
}

/// GFM 的裸网址自动成链接（remark-gfm 的 autolink literal；swift-markdown 没有开 cmark 的这个扩展）：
/// `https://…`、`http://…`、`www.…` 和邮箱地址。规则照 cmark-gfm 的 autolink.c：网址到空白或 `<` 为止，
/// 末尾的标点（`?!.,:*_~'"`）、多出来的 `)` 和 `&xxx;` 不算在内；域名最后两段不能有下划线。
enum MarkdownAutolink {
    /// 把一段文字切成文字和链接。
    static func split(_ text: String) -> [MarkdownInline] {
        guard text.contains("://") || text.contains("@") || text.range(of: "www.", options: .caseInsensitive) != nil else {
            return [.text(text)]
        }
        let s = Array(text.unicodeScalars)
        var out: [MarkdownInline] = []
        var last = 0
        var i = 0
        func string(_ range: Range<Int>) -> String { String(String.UnicodeScalarView(s[range])) }
        while i < s.count {
            var match: (start: Int, end: Int, prefix: String)?
            switch s[i] {
            case ":": match = url(s, colon: i, lowerBound: last)
            case "w", "W": match = www(s, at: i)
            case "@": match = email(s, at: i, lowerBound: last)
            default: break
            }
            guard let match else {
                i += 1
                continue
            }
            if match.start > last { out.append(.text(string(last..<match.start))) }
            let label = string(match.start..<match.end)
            out.append(.link(destination: MarkdownLinks.normalizeUri(match.prefix + label), children: [.text(label)]))
            last = match.end
            i = match.end
        }
        if last < s.count { out.append(.text(string(last..<s.count))) }
        return out
    }

    private static func url(_ s: [Unicode.Scalar], colon: Int, lowerBound: Int) -> (start: Int, end: Int, prefix: String)? {
        guard colon + 2 < s.count, s[colon + 1] == "/", s[colon + 2] == "/" else { return nil }
        var start = colon
        while start > lowerBound, ChatText.isASCIILetter(s[start - 1]) { start -= 1 }
        // 网页只认 http、https（前面紧挨着别的字母的，比如 xhttps://，不算）。
        let scheme = String(String.UnicodeScalarView(s[start..<colon])).lowercased()
        guard scheme == "http" || scheme == "https" else { return nil }
        let domainStart = colon + 3
        let domain = domainLength(s, from: domainStart, allowShort: true)
        guard domain > 0 else { return nil }
        let end = trimEnd(s, start: start, end: pathEnd(s, from: domainStart + domain))
        return end > domainStart ? (start, end, "") : nil
    }

    private static func www(_ s: [Unicode.Scalar], at index: Int) -> (start: Int, end: Int, prefix: String)? {
        // 前面只能是开头、空白或 * _ ~ (。
        if index > 0, !ChatText.isWhitespace(s[index - 1]), !"*_~(".unicodeScalars.contains(s[index - 1]) { return nil }
        guard index + 4 < s.count, String(String.UnicodeScalarView(s[index..<(index + 4)])).lowercased() == "www." else { return nil }
        let domain = domainLength(s, from: index, allowShort: false)
        guard domain > 0 else { return nil }
        let end = trimEnd(s, start: index, end: pathEnd(s, from: index + domain))
        return end > index + 4 ? (index, end, "http://") : nil
    }

    private static func email(_ s: [Unicode.Scalar], at index: Int, lowerBound: Int) -> (start: Int, end: Int, prefix: String)? {
        var start = index
        while start > lowerBound, ChatText.isASCIIAlphanumeric(s[start - 1]) || ".+-_".unicodeScalars.contains(s[start - 1]) { start -= 1 }
        guard start < index else { return nil }
        var end = index + 1
        var dots = 0
        while end < s.count {
            let c = s[end]
            if ChatText.isASCIIAlphanumeric(c) {
                end += 1
            } else if c == "@" {
                return nil
            } else if c == ".", end + 1 < s.count, ChatText.isASCIIAlphanumeric(s[end + 1]) {
                dots += 1
                end += 1
            } else if c == "-" || c == "_" {
                end += 1
            } else {
                break
            }
        }
        // 域名至少有一个点，最后一个字符不能是 - 或 _。
        while end > index + 1, s[end - 1] == "-" || s[end - 1] == "_" { end -= 1 }
        guard end > index + 1, dots > 0 else { return nil }
        return (start, end, "mailto:")
    }

    /// 从 `from` 起像域名的那一段有多长（cmark-gfm 的 check_domain）。最后两段里有下划线的不算域名；
    /// `allowShort` 为 false 时至少要有一个点。
    private static func domainLength(_ s: [Unicode.Scalar], from: Int, allowShort: Bool) -> Int {
        var i = from
        var dots = 0
        var underscoresBefore = 0
        var underscoresLast = 0
        while i < s.count {
            let c = s[i]
            if c == "_" {
                underscoresLast += 1
            } else if c == "." {
                underscoresBefore = underscoresLast
                underscoresLast = 0
                dots += 1
            } else if c != "-", !isHostCharacter(c) {
                break
            }
            i += 1
        }
        if underscoresBefore > 0 || underscoresLast > 0 { return 0 }
        return allowShort || dots > 0 ? i - from : 0
    }

    /// 不是空白也不是标点。
    private static func isHostCharacter(_ c: Unicode.Scalar) -> Bool {
        if c.isASCII { return ChatText.isASCIIAlphanumeric(c) }
        if ChatText.isWhitespace(c) { return false }
        switch c.properties.generalCategory {
        case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation,
             .otherPunctuation, .control, .format, .privateUse, .unassigned, .surrogate:
            return false
        default:
            return true
        }
    }

    /// 网址一直到空白或 `<` 为止。
    private static func pathEnd(_ s: [Unicode.Scalar], from: Int) -> Int {
        var end = from
        while end < s.count, !ChatText.isWhitespace(s[end]), s[end] != "<", s[end] != MathMarkdown.open { end += 1 }
        return end
    }

    /// 去掉末尾不属于网址的部分（cmark-gfm 的 autolink_delim）。
    private static func trimEnd(_ s: [Unicode.Scalar], start: Int, end: Int) -> Int {
        var end = end
        while end > start {
            let c = s[end - 1]
            if "?!.,:*_~'\"".unicodeScalars.contains(c) {
                end -= 1
            } else if c == ";" {
                // 末尾的 &xxx; 是实体，不算在网址里。
                var entity = end - 2
                while entity > start, ChatText.isASCIILetter(s[entity]) { entity -= 1 }
                if entity >= start, entity < end - 2, s[entity] == "&" { end = entity } else { end -= 1 }
            } else if c == ")" {
                // 成对的括号留着（维基百科的地址）；右括号比左括号多时去掉一个。
                var opening = 0
                var closing = 0
                for k in start..<end {
                    if s[k] == "(" { opening += 1 } else if s[k] == ")" { closing += 1 }
                }
                if closing <= opening { break }
                end -= 1
            } else {
                break
            }
        }
        return end
    }
}

/// swift-markdown 的语法树 → 上面的值树。
private struct MarkdownConverter {
    let formulas: [MathMarkdown.Formula]
    let math: Bool

    /// 嵌套太深的（引用套引用几十层）不再往下拆，当普通文字：免得递归把栈用完。
    private static let maxDepth = 40

    // ---- 块 ----

    func blocks(of parent: Markup, path: String, depth: Int) -> [MarkdownBlock] {
        var out: [MarkdownBlock] = []
        for (index, child) in parent.children.enumerated() {
            let own = "\(path)\(index)"
            if let content = content(of: child, path: own, depth: depth) {
                out.append(MarkdownBlock(id: "\(own):\(content.tag)", content: content))
            }
        }
        return out
    }

    private func content(of node: Markup, path: String, depth: Int) -> MarkdownBlock.Content? {
        if depth > Self.maxDepth {
            let text = ChatText.trim(node.format())
            return text.isEmpty ? nil : .paragraph([.text(text)])
        }
        switch node {
        case let paragraph as Markdown.Paragraph:
            // 整段只有一个独立公式的，画成居中的公式；其余段落照常。
            if paragraph.childCount == 1, let text = paragraph.child(at: 0) as? Markdown.Text,
               let formula = MathMarkdown.displayFormula(text.string, formulas) {
                return .math(latex: formula.latex)
            }
            return .paragraph(inlines(of: paragraph, inLink: false))
        case let heading as Markdown.Heading:
            return .heading(level: heading.level, inlines(of: heading, inLink: false))
        case let list as Markdown.UnorderedList:
            return .list(self.list(list, ordered: false, start: 1, path: path, depth: depth))
        case let list as Markdown.OrderedList:
            return .list(self.list(list, ordered: true, start: Int(clamping: list.startIndex), path: path, depth: depth))
        case let quote as Markdown.BlockQuote:
            return .blockQuote(blocks(of: quote, path: path + ".", depth: depth + 1))
        case let code as Markdown.CodeBlock:
            let language = Self.fenceLanguage(code.language)
            let text = Self.dropTrailingNewline(code.code)
            // ```math 的代码块是独立公式（网页由 rehype-katex 画）。
            if math, language == "math", !ChatText.isBlank(text) { return .math(latex: ChatText.trim(text)) }
            return .codeBlock(language: language, code: text)
        case let table as Markdown.Table:
            return .table(self.table(table))
        case is Markdown.ThematicBreak:
            return .thematicBreak
        case let html as Markdown.HTMLBlock:
            let text = ChatText.trimEnd(html.rawHTML)
            return text.isEmpty ? nil : .html(text)
        default:
            // 没有开的扩展语法（指令块等）不会出现在这里。
            return nil
        }
    }

    private func list(_ list: Markup, ordered: Bool, start: Int, path: String, depth: Int) -> MarkdownList {
        var items: [MarkdownListItem] = []
        for (index, child) in list.children.enumerated() {
            guard let item = child as? Markdown.ListItem else { continue }
            let own = "\(path).\(index)"
            items.append(
                MarkdownListItem(
                    id: own,
                    checkbox: item.checkbox.map { $0 == .checked },
                    blocks: blocks(of: item, path: own + ".", depth: depth + 1)
                )
            )
        }
        return MarkdownList(ordered: ordered, start: start, tight: Self.isTight(list), items: items)
    }

    private func table(_ table: Markdown.Table) -> MarkdownTable {
        var header: [[MarkdownInline]] = []
        var rows: [[[MarkdownInline]]] = []
        for section in table.children {
            if section is Markdown.Table.Head {
                header = cells(of: section)
            } else if section is Markdown.Table.Body {
                for row in section.children { rows.append(cells(of: row)) }
            }
        }
        let columns = header.isEmpty ? (rows.map(\.count).max() ?? 0) : header.count
        func fit<T>(_ values: [T], _ filler: T) -> [T] {
            values.count >= columns ? Array(values.prefix(columns)) : values + Array(repeating: filler, count: columns - values.count)
        }
        let alignments = table.columnAlignments.map { alignment -> MarkdownTable.Alignment? in
            switch alignment {
            case .left: return .left
            case .center: return .center
            case .right: return .right
            case nil: return nil
            }
        }
        return MarkdownTable(alignments: fit(alignments, nil), header: fit(header, []), rows: rows.map { fit($0, []) })
    }

    private func cells(of row: Markup) -> [[MarkdownInline]] {
        row.children.map { cell -> [MarkdownInline] in
            let content = inlines(of: cell, inLink: false)
            // cmark 的"合并单元格"扩展把只写了 ^ 的单元格清空（并到上一行）；GFM 和网页没有这个语法，把 ^ 放回来。
            if content.isEmpty, let cell = cell as? Markdown.Table.Cell, cell.rowspan == 0 { return [.text("^")] }
            return content
        }
    }

    /// 围栏上写的语言：信息串的第一个词里开头那段 `[\w#+.-]`（网页 getNodeLanguage 的 `language-([\w#+.-]+)`）。
    private static func fenceLanguage(_ info: String?) -> String? {
        guard let info else { return nil }
        var out = String.UnicodeScalarView()
        for scalar in ChatText.trim(info).unicodeScalars {
            guard ChatText.isASCIIAlphanumeric(scalar) || "_#+.-".unicodeScalars.contains(scalar) else { break }
            out.append(scalar)
        }
        return out.isEmpty ? nil : String(out)
    }

    /// 去掉代码末尾的一个换行（网页 `value.replace(/\n$/, "")`）。按码位处理：`\r\n` 在 Swift 里是一个 Character。
    private static func dropTrailingNewline(_ code: String) -> String {
        var scalars = code.unicodeScalars
        guard scalars.last == "\n" else { return code }
        scalars.removeLast()
        if scalars.last == "\r" { scalars.removeLast() }
        return String(scalars)
    }

    // ---- 紧凑 / 松散列表 ----

    /// CommonMark：项与项之间、或一项里相邻的两块之间有空行的是松散列表。swift-markdown 没有带出 cmark 的这个标记，
    /// 这里按源文的行号算：下一块的起始行和上一块最后一行之间隔着行，就是有空行。
    private static func isTight(_ list: Markup) -> Bool {
        let items = Array(list.children)
        for (index, item) in items.enumerated() {
            let children = Array(item.children)
            if index + 1 < items.count, let end = lastLine(of: item), let next = items[index + 1].range?.lowerBound.line, next - end > 1 {
                return false
            }
            for (block, following) in zip(children, children.dropFirst()) {
                if let end = lastLine(of: block), let next = following.range?.lowerBound.line, next - end > 1 { return false }
            }
        }
        return true
    }

    /// 一个块最后一行内容的行号。容器（列表、列表项、引用）记下的结束行可能把后面的空行算进去，所以一路取最后一个子块。
    private static func lastLine(of node: Markup) -> Int? {
        var current = node
        while current is Markdown.ListItem || current is Markdown.OrderedList || current is Markdown.UnorderedList
            || current is Markdown.BlockQuote, current.childCount > 0, let last = current.child(at: current.childCount - 1) {
            current = last
        }
        // 空的列表项只有标记那一行。
        if current is Markdown.ListItem { return current.range?.lowerBound.line }
        return current.range?.upperBound.line
    }

    // ---- 行内 ----

    func inlines(of parent: Markup, inLink: Bool) -> [MarkdownInline] {
        var out: [MarkdownInline] = []
        var pending = ""
        func flush() {
            if pending.isEmpty { return }
            appendText(pending, to: &out, inLink: inLink)
            pending = ""
        }
        func appendLink(_ destination: String?, _ node: Markup) {
            let children = inlines(of: node, inLink: true)
            if let destination = MarkdownLinks.safeUrl(destination), !children.isEmpty {
                out.append(.link(destination: destination, children: children))
            } else {
                // 地址不安全或为空：不做成链接，文字照常显示。
                out.append(contentsOf: children)
            }
        }
        for child in parent.children {
            switch child {
            case let text as Markdown.Text:
                // 相邻的文字先攒在一起再找网址和公式。
                pending += text.string
            case is Markdown.SoftBreak:
                flush()
                out.append(.softBreak)
            case is Markdown.LineBreak:
                flush()
                out.append(.lineBreak)
            case let code as Markdown.InlineCode:
                flush()
                out.append(.code(code.code))
            case let strong as Markdown.Strong:
                flush()
                out.append(.strong(inlines(of: strong, inLink: inLink)))
            case let emphasis as Markdown.Emphasis:
                flush()
                out.append(.emphasis(inlines(of: emphasis, inLink: inLink)))
            case let strikethrough as Markdown.Strikethrough:
                flush()
                out.append(.strikethrough(inlines(of: strikethrough, inLink: inLink)))
            case let link as Markdown.Link:
                flush()
                appendLink(link.destination, link)
            case let image as Markdown.Image:
                flush()
                let alt = MathMarkdown.restore(image.plainText, formulas)
                if let source = MarkdownLinks.safeUrl(image.source) {
                    out.append(.image(source: source, alt: alt))
                } else if !alt.isEmpty {
                    out.append(.text(alt))
                }
            case let html as Markdown.InlineHTML:
                // 行内的 HTML 标签当普通文字（不在里面找网址）。
                flush()
                out.append(.text(html.rawHTML))
            case let attributes as Markdown.InlineAttributes:
                // swift-cmark 自己的 `^[文字](属性)` 语法；在 CommonMark 里这是一个 ^ 加一个链接。
                pending += "^"
                flush()
                appendLink(attributes.attributes, attributes)
            default:
                // 没有开的扩展语法：有子节点就照常往下，否则取它的文字。
                if child.childCount > 0 {
                    flush()
                    out.append(contentsOf: inlines(of: child, inLink: inLink))
                } else if let plain = child as? any PlainTextConvertibleMarkup {
                    pending += plain.plainText
                }
            }
        }
        flush()
        return Self.mergeText(out)
    }

    /// 一段文字：占位符换回公式，其余部分里的裸网址做成链接（已经在链接里的不做）。
    private func appendText(_ text: String, to out: inout [MarkdownInline], inLink: Bool) {
        for segment in MathMarkdown.segments(text, formulas) {
            switch segment {
            case .formula(let formula):
                out.append(.math(formula.latex))
            case .text(let text):
                if inLink { out.append(.text(text)) } else { out.append(contentsOf: MarkdownAutolink.split(text)) }
            }
        }
    }

    /// 相邻的文字并成一个。
    private static func mergeText(_ inlines: [MarkdownInline]) -> [MarkdownInline] {
        var out: [MarkdownInline] = []
        for inline in inlines {
            if case .text(let text) = inline, case .text(let previous)? = out.last {
                out[out.count - 1] = .text(previous + text)
            } else {
                out.append(inline)
            }
        }
        return out
    }
}
