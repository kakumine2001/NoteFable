import Foundation

/// 回答里的数学公式（LaTeX）。规则和网页 `src/lib/math-markdown.ts` 的 `prepareMath`、Android `data/MathMarkdown.kt` 相同，
/// 改规则时三边一起改：认 `\( … \)`、`\[ … \]`、`$ … $`、`$$ … $$`；`$ … $` 按 Pandoc 的规则判断（开头的 `$` 后面、
/// 结尾的 `$` 前面不是空白，结尾的 `$` 后面不是数字），所以"$5 和 $10"不是公式；代码（围栏和行内）、链接地址和网址里的内容不动；
/// 紧跟在英文字母、数字或 `[` 后面的 `\[`、`\(` 是 Markdown 对括号的转义，不是公式。
///
/// 和网页不同的是结果的形式：网页把公式整理成 `$` 写法交给 remark-math，这里（和 Android 一样）把每个公式换成一个占位符，
/// 由 `MarkdownDocument` 在占位符的位置放回公式（行内公式 / 独占一段的独立公式）。
enum MathMarkdown {
    /// 一个公式：LaTeX 源码，以及是不是独占一行的独立公式（居中、可横向滚动）。
    struct Formula: Equatable, Sendable {
        let latex: String
        let display: Bool
    }

    /// `text` 是换好占位符的 Markdown；没有公式时就是原文，`formulas` 为空。
    struct Prepared: Equatable, Sendable {
        let text: String
        let formulas: [Formula]
    }

    // 占位符：私用区字符夹着公式的序号。Markdown 解析器把它当普通文字，不会拆开也不会当成语法。
    static let open: Unicode.Scalar = "\u{E000}"
    static let close: Unicode.Scalar = "\u{E001}"

    static func placeholder(_ index: Int) -> String {
        "\u{E000}\(index)\u{E001}"
    }

    /// `text` 整段只有一个独立公式的占位符时，返回那个公式。
    static func displayFormula(_ text: String, _ formulas: [Formula]) -> Formula? {
        let scalars = Array(ChatText.trim(text).unicodeScalars)
        guard scalars.count >= 3, scalars[0] == open, scalars[scalars.count - 1] == close else { return nil }
        guard let index = placeholderIndex(scalars[1..<(scalars.count - 1)]), formulas.indices.contains(index) else { return nil }
        return formulas[index].display ? formulas[index] : nil
    }

    /// 占位符之间的文字，或占位符对应的公式。
    enum Segment: Equatable, Sendable {
        case text(String)
        case formula(Formula)
    }

    /// 把带占位符的文字切成"文字 / 公式"。序号不存在的占位符原样留在文字里（Android 也是照原样显示）。
    static func segments(_ text: String, _ formulas: [Formula]) -> [Segment] {
        guard !formulas.isEmpty, text.unicodeScalars.contains(open) else { return text.isEmpty ? [] : [.text(text)] }
        var out: [Segment] = []
        var pending = String.UnicodeScalarView()
        let scalars = Array(text.unicodeScalars)
        var i = 0
        while i < scalars.count {
            if scalars[i] == open, let closeIndex = scalars[(i + 1)...].firstIndex(where: { !ChatText.isASCIIDigit($0) }),
               scalars[closeIndex] == close, let index = placeholderIndex(scalars[(i + 1)..<closeIndex]), formulas.indices.contains(index) {
                if !pending.isEmpty {
                    out.append(.text(String(pending)))
                    pending = String.UnicodeScalarView()
                }
                out.append(.formula(formulas[index]))
                i = closeIndex + 1
                continue
            }
            pending.append(scalars[i])
            i += 1
        }
        if !pending.isEmpty { out.append(.text(String(pending))) }
        return out
    }

    /// 占位符换回 LaTeX 源码（`$…$` / `$$…$$`）：图片的替代文字、纯文字的场合用。
    static func restore(_ text: String, _ formulas: [Formula]) -> String {
        segments(text, formulas).map { segment -> String in
            switch segment {
            case .text(let text): return text
            case .formula(let formula): return formula.display ? "$$\(formula.latex)$$" : "$\(formula.latex)$"
            }
        }.joined()
    }

    private static func placeholderIndex(_ digits: ArraySlice<Unicode.Scalar>) -> Int? {
        guard !digits.isEmpty, digits.count <= 9, digits.allSatisfy(ChatText.isASCIIDigit) else { return nil }
        return digits.reduce(0) { $0 * 10 + Int($1.value - 48) }
    }

    // ---- prepare ----

    // 不跨空行的一段（公式和行内代码都不会跨段落）。
    private static let noBlankLine = #"(?:(?!\n[ \t>]*\n)[\s\S])*?"#

    // 从左到右切，靠前的优先：1 转义的反斜杠、2 行内代码（3 是反引号）、4 链接地址和网址、5 \[…\]、6 \(…\)、7 $$…$$、
    // 8 \$、9 $…$、10 剩下的 $。和网页、Android 是同一个式子（数字写成 [0-9]：ICU 的 \d 还包括别的文字的数字）。
    private static let tokens = ChatRegex(
        [
            #"(\\\\)"#,
            #"((?<!`)(`+)(?!`)"# + noBlankLine + #"(?<!`)\3(?!`))"#,
            #"(\]\((?:\\.|[^()\\\s]|\((?:\\.|[^()\\\s])*\))*(?:[ \t]+"[^"\n]*")?\)|<https?:[^>\s]+>|https?://[^\s<>]+)"#,
            #"(?<![A-Za-z0-9\[])\\\[("# + noBlankLine + #")\\\]"#,
            #"(?<![A-Za-z0-9])\\\(("# + noBlankLine + #")\\\)"#,
            #"\$\$("# + noBlankLine + #")\$\$"#,
            #"(\\\$)"#,
            #"\$(?!\s)((?:\\[\s\S]|[^\$\\\n])+?)(?<!\s)\$(?![0-9])"#,
            #"(\$)"#,
        ].joined(separator: "|")
    )

    private static let lineBreakInFormula = ChatRegex(#"\s*\n\s*"#)

    /// 所有式子都能编译（单元测试用）。
    static var patternsAreValid: Bool { tokens.isValid && lineBreakInFormula.isValid }

    private static let newline: UInt16 = 0x0A
    private static let space: UInt16 = 0x20
    private static let tab: UInt16 = 0x09
    private static let greater: UInt16 = 0x3E
    private static let backtick: UInt16 = 0x60
    private static let tilde: UInt16 = 0x7E
    private static let dollar: UInt16 = 0x24
    private static let backslash: UInt16 = 0x5C

    static func prepare(_ markdown: String) -> Prepared {
        let units = Array(markdown.utf16)
        if !quick(units) { return Prepared(text: markdown, formulas: []) }
        var formulas: [Formula] = []
        var output: [[UInt16]] = []
        var pending: [ArraySlice<UInt16>] = []
        var fenceChar: UInt16 = 0
        var fenceLength = 0
        func flush() {
            if !pending.isEmpty {
                let text = String(decoding: Array(pending.joined(separator: [newline])), as: UTF16.self)
                output.append(Array(prepareText(text, &formulas).utf16))
            }
            pending.removeAll(keepingCapacity: true)
        }
        // 这里能不能开始一个缩进的代码块（前一行是空行、开头或代码块的结尾）。
        var afterBreak = true
        var inList = false
        var indentedCode = false
        for line in units.split(separator: newline, omittingEmptySubsequences: false) {
            if fenceLength > 0 {
                output.append(Array(line))
                let closing = trimmed(line)
                if closing.count >= fenceLength, closing.allSatisfy({ $0 == fenceChar }) {
                    fenceLength = 0
                    afterBreak = true
                }
                continue
            }
            let blank = isBlank(line)
            if indentedCode {
                // 中间隔着空行，只要缩进还在就还是代码。
                if blank || isIndented(line) {
                    output.append(Array(line))
                    continue
                }
                indentedCode = false
                afterBreak = true
            }
            if let open = fenceOpen(line) {
                flush()
                fenceChar = open.char
                fenceLength = open.length
                output.append(Array(line))
                continue
            }
            if afterBreak, !inList, isIndented(line) {
                flush()
                indentedCode = true
                output.append(Array(line))
                continue
            }
            if isListItem(line) { inList = true } else if isParagraphStart(line) { inList = false }
            afterBreak = blank
            pending.append(line)
        }
        flush()
        // 没有公式就原样返回（不成对的 $ 也不用转义）。
        if formulas.isEmpty { return Prepared(text: markdown, formulas: []) }
        return Prepared(text: String(decoding: Array(output.joined(separator: [newline])), as: UTF16.self), formulas: formulas)
    }

    /// 有没有可能是公式的写法：`$`、`\(`、`\[`。
    private static func quick(_ units: [UInt16]) -> Bool {
        for (index, unit) in units.enumerated() {
            if unit == dollar { return true }
            if unit == backslash, index + 1 < units.count, units[index + 1] == 0x28 || units[index + 1] == 0x5B { return true }
        }
        return false
    }

    private static func isWhitespace(_ unit: UInt16) -> Bool {
        if unit < 0x80 { return unit == 0x20 || (unit >= 0x09 && unit <= 0x0D) }
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return ChatText.isWhitespace(scalar)
    }

    private static func isBlank(_ line: ArraySlice<UInt16>) -> Bool {
        line.allSatisfy(isWhitespace)
    }

    private static func trimmed(_ line: ArraySlice<UInt16>) -> ArraySlice<UInt16> {
        var slice = line
        while let first = slice.first, isWhitespace(first) { slice = slice.dropFirst() }
        while let last = slice.last, isWhitespace(last) { slice = slice.dropLast() }
        return slice
    }

    private static func trimmedEnd(_ line: ArraySlice<UInt16>) -> ArraySlice<UInt16> {
        var slice = line
        while let last = slice.last, isWhitespace(last) { slice = slice.dropLast() }
        return slice
    }

    /// 代码块的围栏（CommonMark，`^ {0,3}(`{3,}|~{3,})(.*)$`）：3 个以上的 ` 或 ~。
    /// ``` 后面同一行还有 ` 的是行内代码，不是代码块的开头。
    private static func fenceOpen(_ line: ArraySlice<UInt16>) -> (char: UInt16, length: Int)? {
        var i = line.startIndex
        var spaces = 0
        while i < line.endIndex, line[i] == space, spaces < 3 {
            i += 1
            spaces += 1
        }
        guard i < line.endIndex, line[i] == backtick || line[i] == tilde else { return nil }
        let char = line[i]
        var length = 0
        while i < line.endIndex, line[i] == char {
            i += 1
            length += 1
        }
        guard length >= 3 else { return nil }
        if char == backtick, line[i...].contains(backtick) { return nil }
        return (char, length)
    }

    /// 缩进的代码块（`^(?: {4,}| {0,3}\t)\s*\S`）：以 4 个以上空格或制表符开头的非空行。
    /// 能不能真的开始代码块由调用处判断：要在空行（或开头、代码块）后面，而且不在列表里
    /// （列表里更深的缩进是列表项的后续内容或嵌套，不算代码）。
    private static func isIndented(_ line: ArraySlice<UInt16>) -> Bool {
        var i = line.startIndex
        var spaces = 0
        while i < line.endIndex, line[i] == space {
            i += 1
            spaces += 1
        }
        let prefixed = spaces >= 4 || (i < line.endIndex && line[i] == tab)
        return prefixed && !isBlank(line)
    }

    /// 列表项的开头（`^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)`）。
    private static func isListItem(_ line: ArraySlice<UInt16>) -> Bool {
        var i = line.startIndex
        var spaces = 0
        while i < line.endIndex, line[i] == space, spaces < 3 {
            i += 1
            spaces += 1
        }
        guard i < line.endIndex else { return false }
        if line[i] == 0x2D || line[i] == 0x2A || line[i] == 0x2B {
            i += 1
        } else {
            var digits = 0
            while i < line.endIndex, line[i] >= 0x30, line[i] <= 0x39, digits < 9 {
                i += 1
                digits += 1
            }
            guard digits > 0, i < line.endIndex, line[i] == 0x2E || line[i] == 0x29 else { return false }
            i += 1
        }
        return i == line.endIndex || line[i] == space || line[i] == tab
    }

    /// 段落的开头（`^ ?\S`）：最多一个空格后面就是文字。
    private static func isParagraphStart(_ line: ArraySlice<UInt16>) -> Bool {
        var i = line.startIndex
        if i < line.endIndex, line[i] == space { i += 1 }
        return i < line.endIndex && !isWhitespace(line[i])
    }

    private static func prepareText(_ text: String, _ formulas: inout [Formula]) -> String {
        let matches = tokens.matches(in: text)
        if matches.isEmpty { return text }
        let units = Array(text.utf16)
        var out: [UInt16] = []
        out.reserveCapacity(units.count + 16)
        var last = 0
        func slice(_ range: NSRange) -> ArraySlice<UInt16> {
            units[range.location..<(range.location + range.length)]
        }
        func has(_ match: NSTextCheckingResult, _ group: Int) -> Bool {
            match.range(at: group).location != NSNotFound
        }
        for match in matches {
            let range = match.range
            out.append(contentsOf: units[last..<range.location])
            last = range.location + range.length
            var replacement: String?
            if has(match, 1) || has(match, 2) || has(match, 4) || has(match, 8) {
                replacement = nil
            } else if has(match, 5) {
                let body = slice(match.range(at: 5))
                // \[ \]、\[x\] 是转义写法的任务列表方框，不是公式。
                let checkbox = body.isEmpty || (body.count == 1 && (body.first == space || body.first == 0x78 || body.first == 0x58))
                replacement = checkbox ? nil : display(units, range, body, &formulas)
            } else if has(match, 6) {
                let raw = String(decoding: slice(match.range(at: 6)), as: UTF16.self)
                let body = ChatText.trim(lineBreakInFormula.replaceAll(in: raw, with: " "))
                if !body.isEmpty {
                    formulas.append(Formula(latex: body, display: false))
                    replacement = placeholder(formulas.count - 1)
                }
            } else if has(match, 7) {
                replacement = display(units, range, slice(match.range(at: 7)), &formulas)
            } else if has(match, 9) {
                formulas.append(Formula(latex: String(decoding: slice(match.range(at: 9)), as: UTF16.self), display: false))
                replacement = placeholder(formulas.count - 1)
            } else if has(match, 10) {
                // 不成对的 $ 当普通字符。
                replacement = "\\$"
            }
            if let replacement {
                out.append(contentsOf: replacement.utf16)
            } else {
                out.append(contentsOf: slice(range))
            }
        }
        out.append(contentsOf: units[last...])
        return String(decoding: out, as: UTF16.self)
    }

    /// 独立公式。从行首（只有缩进和引用的 >）开始、到行尾结束的，单独占一个段落：前后各空一行，保留缩进和 >，
    /// 所以列表和引用里的公式留在原处；夹在句子中间的当行内公式。
    private static func display(_ text: [UInt16], _ match: NSRange, _ rawBody: ArraySlice<UInt16>, _ formulas: inout [Formula]) -> String? {
        func isPrefixUnit(_ unit: UInt16) -> Bool { unit == space || unit == tab || unit == greater }
        /// 从 `from` 往前找换行，没有时是 -1（Kotlin 的 lastIndexOf）。
        func lastNewline(_ from: Int) -> Int {
            var i = min(from, text.count - 1)
            while i >= 0 {
                if text[i] == newline { return i }
                i -= 1
            }
            return -1
        }
        let offset = match.location
        let lineStart = lastNewline(offset - 1) + 1
        let prefix = text[lineStart..<offset]
        let restStart = match.location + match.length
        var afterSpaces = restStart
        while afterSpaces < text.count, text[afterSpaces] == space || text[afterSpaces] == tab { afterSpaces += 1 }
        let ownLines = prefix.allSatisfy(isPrefixUnit) && (afterSpaces == text.count || text[afterSpaces] == newline)
        // 每行去掉的是行首的缩进和外面引用的 >（前缀里有几个就去几个）；公式里的 >（大于号）留着。
        let quotes = prefix.filter { $0 == greater }.count
        var lines: [String] = []
        for rawLine in rawBody.split(separator: newline, omittingEmptySubsequences: false) {
            var i = rawLine.startIndex
            while i < rawLine.endIndex, rawLine[i] == space || rawLine[i] == tab { i += 1 }
            var stripped = 0
            while stripped < quotes, i < rawLine.endIndex, rawLine[i] == greater {
                i += 1
                stripped += 1
                while i < rawLine.endIndex, rawLine[i] == space || rawLine[i] == tab { i += 1 }
            }
            let line = trimmedEnd(rawLine[i...])
            if !line.isEmpty { lines.append(String(decoding: line, as: UTF16.self)) }
        }
        if lines.isEmpty { return nil }
        formulas.append(Formula(latex: lines.joined(separator: ownLines ? "\n" : " "), display: ownLines))
        let mark = placeholder(formulas.count - 1)
        if !ownLines { return mark }
        // 前后已经是空行（或文字的开头、结尾）的不再加：连着两个空行会让解析器把列表项在这里截断。
        let before = lineStart == 0 || text[(lastNewline(lineStart - 2) + 1)..<(lineStart - 1)].allSatisfy(isPrefixUnit)
        var after = true
        if let lineEnd = text[restStart...].firstIndex(of: newline) {
            let nextStart = lineEnd + 1
            let nextEnd = text[nextStart...].firstIndex(of: newline) ?? text.count
            after = text[nextStart..<nextEnd].allSatisfy(isPrefixUnit)
        }
        // 匹配的前面已经有这一行的前缀：要加空行时先换行（留下只有前缀的"空行"），再写前缀和占位符。
        let prefixText = String(decoding: prefix, as: UTF16.self)
        let prefixEnd = String(decoding: trimmedEnd(prefix), as: UTF16.self)
        return (before ? "" : "\n" + prefixText) + mark + (after ? "" : "\n" + prefixEnd)
    }
}
