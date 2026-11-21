import Foundation

/// 横断检索的"折叠"，逐条移植自网页 `src/lib/search-fold.ts`（只移植客户端用到的部分：折叠、命中范围、计数、摘录）。
/// Android 端是 `data/SearchFold.kt`。
///
/// 规则：NFKC（全角英数→半角、半角假名→全角、兼容字符统一）→ 小写 → 平假名→片假名 → 排版用引号、破折号→ASCII。
/// 规则只在 search-fold.ts 里改；改了以后运行 `npx tsx scripts/gen-native-search-fold-cases.ts` 重新生成对照用例，
/// SearchFoldParityTests 会用它核对结果一致。
///
/// 位置都是 UTF-16 下标（和 JS、Kotlin 一样），比较也按 UTF-16 码元做：Swift 的 `String` 按字形簇和 Unicode 等价比较，
/// "が" 和 "か + ゛"、"กิ" 里的 "ก" 都会和网页的结果不同，所以内部一律用 `[UInt16]`。
enum SearchFold {
    private static let KANA_OFFSET: UInt16 = 0x60

    private static func isHiragana(_ unit: UInt16) -> Bool {
        (unit >= 0x3041 && unit <= 0x3096) || unit == 0x309d || unit == 0x309e
    }

    /// 排版用的引号、破折号。NFKC 不会把它们变成 ASCII，但 AI 的回答和 PDF 里常写 ’ 和 –，检索时打的是 ' 和 -。
    private static func typography(_ unit: UInt16) -> UInt16? {
        switch unit {
        case 0x2018, 0x2019, 0x201a, 0x201b, 0x2032: return 0x27
        case 0x201c, 0x201d, 0x201e, 0x201f, 0x2033: return 0x22
        case 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212: return 0x2d
        default: return nil
        }
    }

    /// NFKC 下会和前一个字合成的字：组合记号、半角浊点 / 半浊点、谚文字母的元音 / 收音（search-fold.ts 的 CONTINUATION）。
    private static func isContinuation(_ scalar: Unicode.Scalar) -> Bool {
        let value = scalar.value
        if value < 0x80 { return false }
        switch scalar.properties.generalCategory {
        case .nonspacingMark, .enclosingMark, .spacingMark: return true
        default: break
        }
        return (value >= 0x1160 && value <= 0x11ff) || (value >= 0xd7b0 && value <= 0xd7ff) || value == 0xff9e || value == 0xff9f
    }

    /// 单独一个字时折叠后不变的大块（汉字、谚文音节）：search-fold.ts 的 STABLE_RANGES。只是省掉一次 NFKC，结果不变。
    private static func isStable(_ value: UInt32) -> Bool {
        (value >= 0x4e00 && value <= 0x9fff) || (value >= 0x3400 && value <= 0x4dbf) || (value >= 0xac00 && value <= 0xd7a3)
    }

    /// NFKC。Foundation 的 `precomposedStringWithCompatibilityMapping` 本该就是它，但 swift-foundation 的实现
    /// （Linux，以及 macOS 26 的 CI 上实测也是）只分解不合成：ﾃ+ﾞ 得到 テ+゛，가+ᆨ 不变。
    /// 所以第一次用时拿一小段文字试一遍，用第一个结果正确的做法；都不对时退回 Foundation 的（对照用例的单元测试会失败）。
    static func nfkc(_ text: String) -> String {
        nfkcImplementation(text)
    }

    private static let nfkcImplementation: @Sendable (String) -> String = {
        let candidates: [@Sendable (String) -> String] = [
            { $0.precomposedStringWithCompatibilityMapping },
            // NFKD 再 NFC：按定义就是 NFKC。
            { $0.decomposedStringWithCompatibilityMapping.precomposedStringWithCanonicalMapping },
            // ICU 的变换。
            { $0.applyingTransform(StringTransform(rawValue: "NFKC"), reverse: false) ?? $0 },
        ]
        // ﾃﾞ、分开写的 각、Ａ、㌕ → デ 각 A キログラム。按码点比：String 的 == 把合成前后的写法算作相等。
        let probe = "\u{FF83}\u{FF9E}\u{AC00}\u{11A8}\u{FF21}\u{3315}"
        let expected: [UInt32] = [0x30C7, 0xAC01, 0x41, 0x30AD, 0x30ED, 0x30B0, 0x30E9, 0x30E0]
        for candidate in candidates where candidate(probe).unicodeScalars.map(\.value) == expected {
            return candidate
        }
        return candidates[0]
    }()

    /// 折叠一个"字 + 跟着它的组合记号"，接到 `out` 后面，返回接了几个 UTF-16 码元。
    private static func foldCluster(_ cluster: ArraySlice<Unicode.Scalar>, into out: inout [UInt16]) -> Int {
        if cluster.count == 1, let value = cluster.first?.value {
            // ASCII 单字 NFKC 不变（长英文不必逐字 normalize）。
            if value < 0x80 {
                out.append(UInt16(value >= 0x41 && value <= 0x5a ? value + 0x20 : value))
                return 1
            }
            if isStable(value) {
                out.append(UInt16(value))
                return 1
            }
        }
        var scalars = String.UnicodeScalarView()
        scalars.append(contentsOf: cluster)
        let lowered = nfkc(String(scalars)).lowercased()
        var count = 0
        for unit in lowered.utf16 {
            out.append(isHiragana(unit) ? unit + KANA_OFFSET : typography(unit) ?? unit)
            count += 1
        }
        return count
    }

    private struct Folded {
        var units: [UInt16] = []
        var starts: [Int] = []
        var ends: [Int] = []
    }

    private static func fold(_ text: String) -> Folded {
        var out = Folded()
        let scalars = Array(text.unicodeScalars)
        out.units.reserveCapacity(scalars.count)
        out.starts.reserveCapacity(scalars.count)
        out.ends.reserveCapacity(scalars.count)
        func flush(_ cluster: ArraySlice<Unicode.Scalar>, _ from: Int, _ to: Int) {
            let count = foldCluster(cluster, into: &out.units)
            for _ in 0..<count {
                out.starts.append(from)
                out.ends.append(to)
            }
        }
        var first = 0 // 当前这一块的第一个码点在 scalars 里的下标
        var from = 0 // 当前这一块在原文里的 UTF-16 起点
        var at = 0
        for (index, scalar) in scalars.enumerated() {
            // 不是会合成的字：前面这一块到此为止，开始下一块（第一个字只是开始）。
            if at > from, !isContinuation(scalar) {
                flush(scalars[first..<index], from, at)
                from = at
                first = index
            }
            at += scalar.value > 0xffff ? 2 : 1
        }
        if at > from { flush(scalars[first...], from, at) }
        return out
    }

    /// `folded` 的第 i 个 UTF-16 码元来自原文的 `[starts[i], ends[i])`（UTF-16 位置）。
    /// 展开（㌔→キロ）或合成（ﾃ+ﾞ→デ）让长度变了也对得上。
    struct FoldMap: Equatable {
        let folded: String
        let starts: [Int]
        let ends: [Int]
    }

    static func foldWithMap(_ text: String) -> FoldMap {
        let out = fold(text)
        return FoldMap(folded: String(decoding: out.units, as: UTF16.self), starts: out.starts, ends: out.ends)
    }

    /// 去掉 NUL 的折叠结果（PostgreSQL 的 text 放不了 NUL，网页同样去掉）。
    private static func searchUnits(_ text: String) -> [UInt16] {
        fold(text).units.filter { $0 != 0 }
    }

    /// 检索词的折叠。
    static func foldSearchText(_ text: String) -> String {
        String(decoding: searchUnits(text), as: UTF16.self)
    }

    static let MAX_SEARCH_QUERY_CHARS = 100
    static let MAX_SEARCH_TERMS = 8

    /// 网页 src/types/search.ts 的 parseSearchTerms：折叠、按空白切开、去重，最多 8 个词。
    static func parseSearchTerms(_ query: String) -> [String] {
        var seen = Set<[UInt16]>()
        var terms: [[UInt16]] = []
        for piece in searchUnits(query).split(whereSeparator: isJsWhitespace) {
            let term = Array(piece)
            if seen.insert(term).inserted { terms.append(term) }
        }
        return terms.prefix(MAX_SEARCH_TERMS).map { String(decoding: $0, as: UTF16.self) }
    }

    private static func isAsciiWordUnit(_ unit: UInt16) -> Bool {
        (unit >= 0x61 && unit <= 0x7a) || (unit >= 0x30 && unit <= 0x39)
    }

    private static func isShortAsciiTerm(_ term: [UInt16]) -> Bool {
        (1...2).contains(term.count) && term.allSatisfy(isAsciiWordUnit)
    }

    /// 1~2 个字符的英数字词只在词首命中（"detail" 里的 "ai" 不算）。
    static func isShortAsciiTerm(_ term: String) -> Bool {
        isShortAsciiTerm(Array(term.utf16))
    }

    private static func acceptsMatch(_ folded: [UInt16], _ at: Int, _ term: [UInt16]) -> Bool {
        !isShortAsciiTerm(term) || at == 0 || !isAsciiWordUnit(folded[at - 1])
    }

    /// JS 的 `indexOf(needle, from)`（needle 不为空）。
    private static func indexOf(_ haystack: [UInt16], _ needle: [UInt16], from: Int) -> Int? {
        let limit = haystack.count - needle.count
        guard let head = needle.first, from <= limit else { return nil }
        var at = from
        while at <= limit {
            if haystack[at] == head {
                var offset = 1
                while offset < needle.count, haystack[at + offset] == needle[offset] { offset += 1 }
                if offset == needle.count { return at }
            }
            at += 1
        }
        return nil
    }

    /// text 里含有几个词（词是折叠过的；全角半角、平假名片假名、大小写的差别不算）。
    static func countMatchedTerms(_ text: String, _ terms: [String]) -> Int {
        if text.isEmpty { return 0 }
        let folded = searchUnits(text)
        var count = 0
        for term in terms {
            let needle = Array(term.utf16)
            var from = indexOf(folded, needle, from: 0)
            while let at = from {
                if acceptsMatch(folded, at, needle) {
                    count += 1
                    break
                }
                from = indexOf(folded, needle, from: at + 1)
            }
        }
        return count
    }

    /// 原文里的一段，UTF-16 下标 `[start, end)`。
    struct TextRange: Equatable {
        let start: Int
        let end: Int
    }

    /// 原文里命中的范围，从左到右、不重叠；同一位置优先长的词。terms 是折叠过的。
    static func findTermRanges(_ text: String, _ terms: [String]) -> [TextRange] {
        var seen = Set<[UInt16]>()
        var needles: [[UInt16]] = []
        for term in terms {
            let needle = Array(term.utf16)
            if !needle.isEmpty, seen.insert(needle).inserted { needles.append(needle) }
        }
        if text.isEmpty || needles.isEmpty { return [] }
        let map = fold(text)
        var found: [TextRange] = []
        for needle in needles {
            var from = indexOf(map.units, needle, from: 0)
            while let at = from {
                if acceptsMatch(map.units, at, needle) { found.append(TextRange(start: at, end: at + needle.count)) }
                from = indexOf(map.units, needle, from: at + 1)
            }
        }
        found.sort { $0.start != $1.start ? $0.start < $1.start : $0.end > $1.end }
        var ranges: [TextRange] = []
        var cursor = 0
        for match in found {
            if match.start < cursor { continue }
            cursor = match.end
            let start = map.starts[match.start]
            let end = map.ends[match.end - 1]
            // 一个原字（㌔）展开出的两处命中，在原文上是同一段。
            if let last = ranges.last, start < last.end {
                ranges[ranges.count - 1] = TextRange(start: last.start, end: max(last.end, end))
            } else {
                ranges.append(TextRange(start: start, end: end))
            }
        }
        return ranges
    }

    private static let SNIPPET_CHARS = 160

    private static func isLowSurrogate(_ unit: UInt16) -> Bool {
        unit >= 0xdc00 && unit <= 0xdfff
    }

    /// 命中的词附近的一段（没有命中就是开头）。空白压成一个空格；按别的写法命中时也照原文摘。
    static func buildSearchSnippet(_ body: String?, _ terms: [String]) -> String {
        // (body ?? "").replace(/\s+/g, " ").trim()
        var units: [UInt16] = []
        var space = false
        for unit in (body ?? "").utf16 {
            if isJsWhitespace(unit) {
                space = !units.isEmpty
                continue
            }
            if space { units.append(0x20) }
            space = false
            units.append(unit)
        }
        let text = String(decoding: units, as: UTF16.self)
        let at = findTermRanges(text, terms).first?.start ?? 0
        var start = max(0, at - SNIPPET_CHARS / 4)
        var end = start + SNIPPET_CHARS
        // 不把代理对（表情等）从中间切开。
        if start > 0, start < units.count, isLowSurrogate(units[start]) { start -= 1 }
        if end < units.count, isLowSurrogate(units[end]) { end += 1 }
        let slice = units[min(start, units.count)..<min(end, units.count)]
        return (start > 0 ? "…" : "") + String(decoding: slice, as: UTF16.self) + (end < units.count ? "…" : "")
    }

    /// 高亮用的一段文字：`isMatch` 的那些画黄色底。
    struct HighlightPart: Equatable {
        let text: String
        let isMatch: Bool
    }

    /// 把文字切成"命中 / 不命中"的片段（网页 search-dialog.tsx 的 splitHighlight）。片段是原文，接起来等于原文。
    static func splitHighlight(_ text: String, _ terms: [String]) -> [HighlightPart] {
        if text.isEmpty { return [] }
        let units = Array(text.utf16)
        var parts: [HighlightPart] = []
        var last = 0
        func piece(_ from: Int, _ to: Int) -> String {
            String(decoding: units[from..<to], as: UTF16.self)
        }
        for range in findTermRanges(text, terms) {
            if range.start > last { parts.append(HighlightPart(text: piece(last, range.start), isMatch: false)) }
            parts.append(HighlightPart(text: piece(range.start, range.end), isMatch: true))
            last = range.end
        }
        if last < units.count { parts.append(HighlightPart(text: piece(last, units.count), isMatch: false)) }
        return parts
    }

    /// JS 的 `\s`：空白、行终止符、NBSP、BOM 和 Unicode Zs。
    private static func isJsWhitespace(_ unit: UInt16) -> Bool {
        switch unit {
        case 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff: return true
        default: return unit >= 0x2000 && unit <= 0x200a
        }
    }
}
