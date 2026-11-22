import Foundation

// 回答里代码块的语言选择和高亮（Android ui/CodeBlock.kt 里不属于界面的部分；网页 assistant-markdown.tsx 的 highlightCode
// + globals.css 的 .hljs-*）。这里只出数据：记号的位置和类别、每个类别的颜色；界面层（SwiftUI）自己拼成带样式的文字。

/// highlight.js 的高亮类别里网页主题上了颜色的那些。
enum CodeTokenKind: Equatable, Sendable, CaseIterable {
    case keyword, builtIn, title, string, number, variable, comment, meta, tag

    /// globals.css 的 .hljs-* 颜色（0xAARRGGBB）。
    var color: UInt32 {
        switch self {
        case .keyword, .builtIn: return 0xFF7C_3AED
        case .title: return 0xFF03_69A1
        case .string: return 0xFF04_7857
        case .number: return 0xFFB4_5309
        case .variable: return 0xFFBE_123C
        case .comment: return 0xFF64_748B
        case .meta: return 0xFF47_5569
        case .tag: return 0xFF1D_4ED8
        }
    }

    /// 深色外观的颜色（globals.css 的 :root[data-theme="dark"] .hljs-*）。
    var darkColor: UInt32 {
        switch self {
        case .keyword, .builtIn: return 0xFFC0_84FC
        case .title: return 0xFF60_A5FA
        case .string: return 0xFF34_D399
        case .number: return 0xFFFB_BF24
        case .variable: return 0xFFFB_7185
        case .comment: return 0xFF94_A3B8
        case .meta: return 0xFFA1_A1AA
        case .tag: return 0xFF7D_D3FC
        }
    }

    /// 声明名（.hljs-title）是 650，其余跟随代码的字重。
    var fontWeight: Int? { self == .title ? 650 : nil }

    /// 注释（.hljs-comment）是斜体。
    var isItalic: Bool { self == .comment }
}

/// 一个记号：`start`、`end` 是代码文字的 UTF-16 下标（和 Kotlin 端相同，可以直接换成 NSRange）。记号可以重叠，后面的盖住前面的。
struct CodeToken: Equatable, Sendable {
    let start: Int
    let end: Int
    let kind: CodeTokenKind
}

/// 连续的一段同类文字（`kind` 为 nil 是没上色的普通代码）。界面按顺序拼起来就是整段代码。
struct CodeRun: Equatable, Sendable {
    let text: String
    let kind: CodeTokenKind?
}

struct HighlightResult: Equatable, Sendable {
    let language: String
    let tokens: [CodeToken]

    /// 把重叠的记号摊平成首尾相接的几段（后加的记号优先，和 Android 逐个 addStyle 的结果一样）。
    func runs(_ code: String) -> [CodeRun] {
        let units = Array(code.utf16)
        if units.isEmpty { return [] }
        var kinds = [CodeTokenKind?](repeating: nil, count: units.count)
        for token in tokens {
            let start = max(0, token.start)
            let end = min(units.count, token.end)
            if start < end {
                for index in start..<end { kinds[index] = token.kind }
            }
        }
        var runs: [CodeRun] = []
        var start = 0
        for index in 1...units.count {
            // 不在代理对中间断开。
            if index < units.count, kinds[index] == kinds[start] || UTF16.isTrailSurrogate(units[index]) { continue }
            runs.append(CodeRun(text: String(decoding: units[start..<index], as: UTF16.self), kind: kinds[start]))
            start = index
        }
        return runs
    }
}

/// 网页用 highlight.js（17 种语言）。原生没有现成的同款库，这里（和 Android 一样）用一个小的词法高亮器覆盖同样的 17 种语言，
/// 颜色类别与网页主题一致：关键字、内置、声明名、字符串、数字 / 字面量 / 类型、变量 / 属性、注释、元信息、标签。
/// 语言选择与网页相同：先用围栏上写的语言（含别名），再用 guessLanguage 的 Python 规则，最后自动识别（分数不到 2 当纯文本）。
/// 自动识别和逐词规则是近似，不保证与 highlight.js 每个记号都一样。
enum CodeHighlighter {
    static let plain = "plaintext"

    /// 代码文字的颜色（.markdown-body pre code）。
    static let ink: UInt32 = 0xFF11_1827

    static let languages = [
        "bash", "c", "cpp", "csharp", "css", "java", "javascript", "json", "markdown",
        "php", "python", "ruby", "rust", "sql", "typescript", "xml", "yaml",
    ]

    private static let aliases: [String: String] = [
        "c++": "cpp", "c#": "csharp", "html": "xml", "js": "javascript", "jsx": "javascript",
        "md": "markdown", "py": "python", "sh": "bash", "shell": "bash", "ts": "typescript",
        "tsx": "typescript", "yml": "yaml",
    ]

    // 网页 languageLabels；plaintext 用本地化的 "Code"。
    private static let languageLabels: [String: String] = [
        "bash": "Bash", "c": "C", "cpp": "C++", "csharp": "C#", "css": "CSS", "java": "Java",
        "javascript": "JavaScript", "json": "JSON", "markdown": "Markdown", "php": "PHP", "python": "Python",
        "ruby": "Ruby", "rust": "Rust", "sql": "SQL", "typescript": "TypeScript", "xml": "HTML", "yaml": "YAML",
    ]

    /// 代码块头部显示的语言名（`language` 是 `highlight` 结果里的）。
    static func label(_ language: String) -> String {
        if language == plain { return L("code_label_plain") }
        return languageLabels[language] ?? language
    }

    /// 网页 normalizeLanguage：小写、去掉 language- 前缀、换别名。
    static func normalize(_ language: String?) -> String? {
        guard let language, !ChatText.isBlank(language) else { return nil }
        var normalized = ChatText.trim(language).lowercased()
        if normalized.hasPrefix("language-") { normalized = String(normalized.dropFirst("language-".count)) }
        return aliases[normalized] ?? normalized
    }

    private static let pythonSignals = [
        ChatRegex(#"^\s*(def|class)\s+\w+"#, [.anchorsMatchLines]),
        ChatRegex(#"^\s*(from|import)\s+\w+"#, [.anchorsMatchLines]),
        ChatRegex(#"\b(input|print)\s*\("#),
    ]

    /// 网页 guessLanguage：只认 Python。
    static func guess(_ code: String) -> String? {
        pythonSignals.contains { $0.test(code) } ? "python" : nil
    }

    static func highlight(_ code: String, _ language: String?) -> HighlightResult {
        let chosen = normalize(language) ?? guess(code)
        if let chosen, languages.contains(chosen) { return HighlightResult(language: chosen, tokens: tokenize(code, chosen)) }
        // 写了不认识的语言或没写：在 17 种里自动识别，分数不够就当纯文本（网页 relevance >= 2）。
        guard let detected = detect(code) else { return HighlightResult(language: plain, tokens: []) }
        return HighlightResult(language: detected, tokens: tokenize(code, detected))
    }

    /// 自动识别：按各语言的特征计分，取最高且不低于 2 的。
    static func detect(_ code: String) -> String? {
        let words = identifiers(Array(code.utf16))
        var best: String?
        var bestScore = 1
        for language in languages {
            let score = relevance(code, words, language)
            if score > bestScore {
                best = language
                bestScore = score
            }
        }
        return best
    }

    /// 代码里出现过的标识符（`[A-Za-z_][A-Za-z0-9_]*`）。
    private static func identifiers(_ code: [UInt16]) -> Set<String> {
        var words = Set<String>()
        var i = 0
        while i < code.count {
            guard isASCIIWordStart(code[i]) else {
                i += 1
                continue
            }
            var end = i + 1
            while end < code.count, isASCIIWord(code[end]) { end += 1 }
            words.insert(String(decoding: code[i..<end], as: UTF16.self))
            i = end
        }
        return words
    }

    private static func relevance(_ code: String, _ words: Set<String>, _ language: String) -> Int {
        guard let spec = specs[language] else { return 0 }
        var score = 0
        for signature in spec.signatures where signature.test(code) { score += 2 }
        // 按"不同的词"计数（大小写不同算两个词，和 Kotlin 端一样）。
        for word in words {
            let key = spec.caseInsensitive ? word.lowercased() : word
            if spec.keywords.contains(key), !commonWords.contains(key) { score += 1 }
        }
        return score
    }

    // highlight.js 里这些常见英文词的分数是 0，不算识别依据。
    private static let commonWords: Set<String> = [
        "if", "else", "for", "in", "of", "and", "or", "not", "is", "do", "then", "return", "as", "with", "to", "new", "case",
    ]

    static func tokenize(_ code: String, _ language: String) -> [CodeToken] {
        let units = Array(code.utf16)
        switch language {
        case "xml": return tokenizeMarkup(units)
        case "markdown": return tokenizeMarkdown(code)
        case "json": return specs["json"].map { tokenizeGeneric(units, $0, keyBeforeColon: true) } ?? []
        case "yaml": return tokenizeYaml(code, units)
        case "css": return tokenizeCss(units)
        default: return specs[language].map { tokenizeGeneric(units, $0) } ?? []
        }
    }

    /// 所有语言的识别式子都能编译（单元测试用）。
    static var patternsAreValid: Bool {
        specs.values.allSatisfy { $0.signatures.allSatisfy(\.isValid) } && pythonSignals.allSatisfy(\.isValid) &&
            yamlKey.isValid && markdownLink.isValid && markdownQuote.isValid
    }

    // ---- 各语言的词表 ----

    private struct Spec {
        var keywords: Set<String> = []
        var builtIns: Set<String> = []
        var literals: Set<String> = []
        var types: Set<String> = []
        var lineComments: [[UInt16]] = []
        var blockComment: (open: [UInt16], close: [UInt16])?
        var quotes: Set<UInt16> = [0x22, 0x27]
        /// 这些关键字后面的名字是声明名（hljs title）。
        var titleAfter: Set<String> = []
        /// `$name` 是变量（bash、php）。
        var dollarVariables = false
        /// `@name` 是元信息（Python 装饰器、Java 注解）。
        var atMeta = false
        /// 以 `#` 开头的行是预处理指令（C、C++、C#）。
        var hashDirective = false
        var caseInsensitive = false
        var signatures: [ChatRegex] = []
    }

    private static func words(_ text: String) -> Set<String> {
        Set(text.split(separator: " ").map(String.init))
    }

    private static func units(_ text: String) -> [UInt16] { Array(text.utf16) }
    private static func quoteSet(_ text: String) -> Set<UInt16> { Set(text.utf16) }
    private static let slashComment = [units("//")]
    private static let hashComment = [units("#")]
    private static let cBlockComment = (open: units("/*"), close: units("*/"))
    private static func lines(_ pattern: String) -> ChatRegex { ChatRegex(pattern, [.anchorsMatchLines]) }

    private static let cTypes = words("int char void short long float double signed unsigned bool size_t const static struct union enum auto")

    private static let specs: [String: Spec] = [
        "bash": Spec(
            keywords: words("if then else elif fi for while until do done case esac in function select time"),
            builtIns: words("echo cd export source alias unset read printf exit local declare set shift test eval exec pwd ls grep sed awk cat mkdir rm cp mv chmod chown sudo npm npx git curl"),
            literals: words("true false"),
            lineComments: hashComment,
            titleAfter: words("function"),
            dollarVariables: true,
            signatures: [ChatRegex(#"^#!.*\b(ba|z)?sh\b"#), lines(#"^\s*(sudo|npm|npx|git|cd|echo|export)\s"#), ChatRegex(#"\$\{?\w+"#)]
        ),
        "c": Spec(
            keywords: words("if else for while do switch case break continue return goto default typedef sizeof extern register volatile inline"),
            builtIns: words("printf scanf malloc free memcpy strlen NULL"),
            literals: words("true false NULL"),
            types: cTypes,
            lineComments: slashComment,
            blockComment: cBlockComment,
            hashDirective: true,
            signatures: [ChatRegex(#"#include\s*<\w+\.h>"#), ChatRegex(#"\bint\s+main\s*\("#)]
        ),
        "cpp": Spec(
            keywords: words("if else for while do switch case break continue return default typedef sizeof namespace using class public private protected virtual override template typename new delete try catch throw this operator friend inline const_cast static_cast dynamic_cast reinterpret_cast nullptr constexpr noexcept"),
            builtIns: words("std cout cin endl vector string map set unique_ptr shared_ptr make_unique printf"),
            literals: words("true false nullptr NULL"),
            types: cTypes,
            lineComments: slashComment,
            blockComment: cBlockComment,
            titleAfter: words("class struct namespace"),
            hashDirective: true,
            signatures: [ChatRegex(#"#include\s*<\w+>"#), ChatRegex(#"std::"#), ChatRegex(#"\bcout\s*<<"#)]
        ),
        "csharp": Spec(
            keywords: words("using namespace class public private protected internal static readonly void return if else for foreach while do switch case break continue new this base override virtual abstract async await var get set try catch finally throw interface struct enum record in out ref params"),
            builtIns: words("Console Math List Dictionary Task String"),
            literals: words("true false null"),
            types: words("int string bool double float decimal long short byte char object void"),
            lineComments: slashComment,
            blockComment: cBlockComment,
            titleAfter: words("class interface struct enum record namespace"),
            hashDirective: true,
            signatures: [ChatRegex(#"\busing\s+System"#), ChatRegex(#"Console\.Write"#), ChatRegex(#"\bnamespace\s+[\w.]+"#)]
        ),
        "css": Spec(
            keywords: words("important media import keyframes font-face supports"),
            blockComment: cBlockComment,
            signatures: [lines(#"^\s*[.#]?[\w\-]+\s*\{"#), lines(#"^\s*[\w\-]+\s*:\s*[^;]+;"#)]
        ),
        "java": Spec(
            keywords: words("public private protected static final abstract class interface extends implements return if else for while do switch case break continue new this super try catch finally throw throws import package void synchronized enum instanceof var record"),
            builtIns: words("System String Math List ArrayList Map HashMap Integer Object"),
            literals: words("true false null"),
            types: words("int long short byte char boolean float double void"),
            lineComments: slashComment,
            blockComment: cBlockComment,
            titleAfter: words("class interface enum record"),
            atMeta: true,
            signatures: [ChatRegex(#"public\s+static\s+void\s+main"#), ChatRegex(#"System\.out\.print"#), lines(#"^\s*package\s+[\w.]+;"#)]
        ),
        "javascript": Spec(
            keywords: words("const let var function return if else for while do switch case break continue new this class extends import export from default async await try catch finally throw typeof instanceof of in yield delete static get set"),
            builtIns: words("console window document Math JSON Promise Array Object String Number Boolean Map Set Date Error require module process"),
            literals: words("true false null undefined NaN Infinity"),
            lineComments: slashComment,
            blockComment: cBlockComment,
            quotes: quoteSet("\"'`"),
            titleAfter: words("function class"),
            signatures: [ChatRegex(#"\b(const|let)\s+\w+\s*="#), ChatRegex(#"=>"#), ChatRegex(#"console\.log"#)]
        ),
        "json": Spec(
            literals: words("true false null"),
            quotes: quoteSet("\""),
            signatures: [ChatRegex(#"^\s*[\[\{]"#), ChatRegex(#""\w+"\s*:"#)]
        ),
        "markdown": Spec(
            signatures: [lines(#"^#{1,6}\s+\S"#), lines(#"^\s*[\-*]\s+\S"#), ChatRegex(#"\[[^\]]+\]\([^)]+\)"#)]
        ),
        "php": Spec(
            keywords: words("function return if else elseif for foreach while do switch case break continue new class extends implements public private protected static echo print use namespace require include try catch throw as array isset unset empty"),
            builtIns: words("strlen count array_map json_encode var_dump"),
            literals: words("true false null TRUE FALSE NULL"),
            lineComments: [units("//"), units("#")],
            blockComment: cBlockComment,
            titleAfter: words("function class"),
            dollarVariables: true,
            signatures: [ChatRegex(#"<\?php"#), ChatRegex(#"\$\w+\s*="#)]
        ),
        "python": Spec(
            keywords: words("def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield global nonlocal assert del async await match case"),
            builtIns: words("print input len range int str float list dict set tuple open enumerate zip map filter sorted sum min max abs type isinstance super self"),
            literals: words("True False None"),
            lineComments: hashComment,
            titleAfter: words("def class"),
            atMeta: true,
            signatures: [lines(#"^\s*def\s+\w+\(.*\)\s*:"#), lines(#"^\s*(from\s+\w+\s+)?import\s+\w+"#)]
        ),
        "ruby": Spec(
            keywords: words("def end class module if elsif else unless while until for in do return yield begin rescue ensure raise require attr_accessor then case when self nil"),
            builtIns: words("puts print p require_relative each map"),
            literals: words("true false nil"),
            lineComments: hashComment,
            titleAfter: words("def class module"),
            signatures: [lines(#"^\s*def\s+\w+[^:(]*$"#), lines(#"^\s*end\s*$"#), ChatRegex(#"\bputs\s"#)]
        ),
        "rust": Spec(
            keywords: words("fn let mut pub use mod struct enum impl trait for in while loop if else match return self Self crate super where as move ref async await dyn const static unsafe extern type"),
            builtIns: words("println print format vec Vec String Option Some None Result Ok Err Box"),
            literals: words("true false"),
            types: words("i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 bool char str usize isize"),
            lineComments: slashComment,
            blockComment: cBlockComment,
            titleAfter: words("fn struct enum trait impl mod"),
            signatures: [ChatRegex(#"\bfn\s+\w+\s*\("#), ChatRegex(#"\blet\s+mut\b"#), ChatRegex(#"println!"#)]
        ),
        "sql": Spec(
            keywords: words("select from where insert into values update set delete create table drop alter add join left right inner outer on group by order having limit offset as and or not null is in like between distinct union all primary key foreign references index view default exists case when then else end"),
            builtIns: words("count sum avg min max now coalesce"),
            literals: words("true false null"),
            types: words("int integer varchar text boolean date timestamp serial bigint numeric"),
            lineComments: [units("--")],
            blockComment: cBlockComment,
            quotes: quoteSet("'\""),
            caseInsensitive: true,
            signatures: [ChatRegex(#"(?i)\bselect\b[\s\S]*\bfrom\b"#), ChatRegex(#"(?i)\b(create\s+table|insert\s+into)\b"#)]
        ),
        "typescript": Spec(
            keywords: words("const let var function return if else for while do switch case break continue new this class extends implements interface type enum import export from default async await try catch finally throw typeof instanceof keyof of in readonly public private protected as declare namespace abstract"),
            builtIns: words("console window document Math JSON Promise Array Object Record Partial Map Set Date Error"),
            literals: words("true false null undefined"),
            types: words("string number boolean any unknown never void"),
            lineComments: slashComment,
            blockComment: cBlockComment,
            quotes: quoteSet("\"'`"),
            titleAfter: words("function class interface type enum"),
            signatures: [ChatRegex(#"\binterface\s+\w+\s*\{"#), ChatRegex(#":\s*(string|number|boolean)\b"#), ChatRegex(#"\btype\s+\w+\s*="#)]
        ),
        "xml": Spec(
            signatures: [ChatRegex(#"<(\w+)[^>]*>[\s\S]*</\1>"#), ChatRegex(#"<!DOCTYPE"#, [.caseInsensitive])]
        ),
        "yaml": Spec(
            literals: words("true false null yes no"),
            lineComments: hashComment,
            signatures: [lines(#"^[\w\-]+:\s*$"#), lines(#"^\s+-\s+\w+:"#)]
        ),
    ]

    // ---- 字符的判断（按 UTF-16 单元，和 Kotlin 的 Char 一样；代理对的两半都不是字母） ----

    private static let newline: UInt16 = 0x0A

    private static func scalar(_ unit: UInt16) -> Unicode.Scalar? { Unicode.Scalar(unit) }

    private static func isLetter(_ unit: UInt16) -> Bool {
        if unit < 0x80 { return (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) }
        return scalar(unit).map(ChatText.isLetter) ?? false
    }

    private static func isDigit(_ unit: UInt16) -> Bool {
        if unit < 0x80 { return unit >= 48 && unit <= 57 }
        return scalar(unit).map(ChatText.isDigit) ?? false
    }

    private static func isLetterOrDigit(_ unit: UInt16) -> Bool { isLetter(unit) || isDigit(unit) }

    private static func isWhitespace(_ unit: UInt16) -> Bool {
        if unit < 0x80 { return unit == 0x20 || (unit >= 0x09 && unit <= 0x0D) || (unit >= 0x1C && unit <= 0x1F) }
        return scalar(unit).map(ChatText.isWhitespace) ?? false
    }

    private static func isIdentStart(_ unit: UInt16) -> Bool { isLetter(unit) || unit == 0x5F }
    private static func isIdent(_ unit: UInt16) -> Bool { isLetterOrDigit(unit) || unit == 0x5F }

    private static func isASCIIWordStart(_ unit: UInt16) -> Bool {
        (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) || unit == 0x5F
    }

    private static func isASCIIWord(_ unit: UInt16) -> Bool {
        isASCIIWordStart(unit) || (unit >= 48 && unit <= 57)
    }

    private static func starts(_ code: [UInt16], _ prefix: [UInt16], at index: Int) -> Bool {
        guard index + prefix.count <= code.count else { return false }
        for offset in 0..<prefix.count where code[index + offset] != prefix[offset] { return false }
        return true
    }

    /// `unit` 从 `from` 起第一次出现的位置（`limit` 之前）；没有时是 nil。
    private static func index(of unit: UInt16, in code: [UInt16], from: Int, limit: Int? = nil) -> Int? {
        let end = limit ?? code.count
        var i = from
        while i < end {
            if code[i] == unit { return i }
            i += 1
        }
        return nil
    }

    private static func index(of needle: [UInt16], in code: [UInt16], from: Int) -> Int? {
        guard let first = needle.first else { return from }
        var i = from
        while i + needle.count <= code.count {
            if code[i] == first, starts(code, needle, at: i) { return i }
            i += 1
        }
        return nil
    }

    private static func lineEnd(_ code: [UInt16], from: Int) -> Int {
        index(of: newline, in: code, from: from) ?? code.count
    }

    // ---- 记号切分 ----

    private static func readString(_ code: [UInt16], _ start: Int, _ quote: UInt16) -> Int {
        var i = start + 1
        while i < code.count {
            let c = code[i]
            if c == 0x5C {
                i += 2
                continue
            }
            if c == quote { return i + 1 }
            // 普通引号的字符串不跨行（模板字符串可以）。
            if c == newline, quote != 0x60 { return i }
            i += 1
        }
        return code.count
    }

    private static func readNumber(_ code: [UInt16], _ start: Int) -> Int {
        var i = start
        if starts(code, [0x30, 0x78], at: i) || starts(code, [0x30, 0x58], at: i) {
            i += 2
            while i < code.count, isLetterOrDigit(code[i]) || code[i] == 0x5F { i += 1 }
            return i
        }
        while i < code.count, isDigit(code[i]) || code[i] == 0x5F || code[i] == 0x2E { i += 1 }
        if i < code.count, code[i] == 0x65 || code[i] == 0x45 {
            var j = i + 1
            if j < code.count, code[j] == 0x2B || code[j] == 0x2D { j += 1 }
            if j < code.count, isDigit(code[j]) {
                i = j
                while i < code.count, isDigit(code[i]) { i += 1 }
            }
        }
        while i < code.count, isLetter(code[i]) { i += 1 } // 1L、2f、3u32 之类的后缀
        return i
    }

    private static func tokenizeGeneric(_ code: [UInt16], _ spec: Spec, keyBeforeColon: Bool = false) -> [CodeToken] {
        var tokens: [CodeToken] = []
        var i = 0
        var expectTitle = false
        var lineStart = true
        while i < code.count {
            let c = code[i]
            if c == newline {
                lineStart = true
                i += 1
                continue
            }
            if isWhitespace(c) {
                i += 1
                continue
            }
            let atLineStart = lineStart
            lineStart = false
            if spec.hashDirective, atLineStart, c == 0x23 {
                let end = lineEnd(code, from: i)
                tokens.append(CodeToken(start: i, end: end, kind: .meta))
                // #include <stdio.h> / "x.h" 里的文件名是字符串（`<[^>\n]+>|"[^"\n]*"` 的第一个匹配）。
                var p = i
                while p < end {
                    if code[p] == 0x3C, let close = index(of: 0x3E, in: code, from: p + 1, limit: end), close > p + 1 {
                        tokens.append(CodeToken(start: p, end: close + 1, kind: .string))
                        break
                    }
                    if code[p] == 0x22, let close = index(of: 0x22, in: code, from: p + 1, limit: end) {
                        tokens.append(CodeToken(start: p, end: close + 1, kind: .string))
                        break
                    }
                    p += 1
                }
                i = end
                continue
            }
            if let lineComment = spec.lineComments.first(where: { starts(code, $0, at: i) }),
               !(lineComment == [0x23] && spec.dollarVariables && i > 0 && code[i - 1] == 0x24) {
                let end = lineEnd(code, from: i)
                tokens.append(CodeToken(start: i, end: end, kind: .comment))
                i = end
                continue
            }
            if let block = spec.blockComment, starts(code, block.open, at: i) {
                let close = index(of: block.close, in: code, from: i + block.open.count)
                let end = close.map { $0 + block.close.count } ?? code.count
                tokens.append(CodeToken(start: i, end: end, kind: .comment))
                i = end
                continue
            }
            if spec.quotes.contains(c) {
                let end = readString(code, i, c)
                // 按下标往后跳过空格看冒号，不复制剩余文本（每个字符串都复制一次，大 JSON 会变成平方级）。
                var isKey = false
                if keyBeforeColon {
                    var next = end
                    while next < code.count, code[next] == 0x20 || code[next] == 0x09 { next += 1 }
                    isKey = next < code.count && code[next] == 0x3A
                }
                tokens.append(CodeToken(start: i, end: end, kind: isKey ? .variable : .string))
                i = end
                continue
            }
            if spec.dollarVariables, c == 0x24, i + 1 < code.count, isIdentStart(code[i + 1]) || code[i + 1] == 0x7B {
                var end = i + 1
                if code[end] == 0x7B {
                    end = index(of: 0x7D, in: code, from: end).map { $0 + 1 } ?? code.count
                } else {
                    while end < code.count, isIdent(code[end]) { end += 1 }
                }
                tokens.append(CodeToken(start: i, end: end, kind: .variable))
                i = end
                continue
            }
            if spec.atMeta, c == 0x40, i + 1 < code.count, isIdentStart(code[i + 1]) {
                var end = i + 1
                while end < code.count, isIdent(code[end]) || code[end] == 0x2E { end += 1 }
                tokens.append(CodeToken(start: i, end: end, kind: .meta))
                i = end
                continue
            }
            if isDigit(c) || (c == 0x2D && keyBeforeColon && i + 1 < code.count && isDigit(code[i + 1])) {
                let end = readNumber(code, c == 0x2D ? i + 1 : i)
                tokens.append(CodeToken(start: i, end: end, kind: .number))
                i = end
                continue
            }
            if isIdentStart(c) {
                var end = i + 1
                while end < code.count, isIdent(code[end]) { end += 1 }
                let word = String(decoding: code[i..<end], as: UTF16.self)
                let key = spec.caseInsensitive ? word.lowercased() : word
                var kind: CodeTokenKind?
                if expectTitle {
                    kind = .title
                } else if spec.literals.contains(key) || spec.types.contains(key) {
                    kind = .number
                } else if spec.keywords.contains(key) {
                    kind = .keyword
                } else if spec.builtIns.contains(key) {
                    kind = .builtIn
                }
                expectTitle = kind != .title && spec.titleAfter.contains(key)
                if let kind { tokens.append(CodeToken(start: i, end: end, kind: kind)) }
                i = end
                continue
            }
            expectTitle = false
            i += 1
        }
        return tokens
    }

    /// 按起点排序，起点相同的保持原来的先后（Kotlin 的 sortedBy 是稳定排序）。
    private static func sortedByStart(_ tokens: [CodeToken]) -> [CodeToken] {
        tokens.enumerated().sorted { ($0.element.start, $0.offset) < ($1.element.start, $1.offset) }.map(\.element)
    }

    private static let yamlKey = lines(#"^(\s*-?\s*)([^\s#:'"][^:#\n]*?|"[^"\n]*"|'[^'\n]*')\s*:(?=\s|$)"#)

    // YAML：行首的键是属性色，# 注释，字符串、数字、字面量。
    private static func tokenizeYaml(_ text: String, _ code: [UInt16]) -> [CodeToken] {
        guard let spec = specs["yaml"] else { return [] }
        var tokens: [CodeToken] = []
        let keyRanges = yamlKey.matches(in: text).map { $0.range(at: 2) }.filter { $0.location != NSNotFound }
        for range in keyRanges { tokens.append(CodeToken(start: range.location, end: range.location + range.length, kind: .variable)) }
        // 两边都按起点排好序：双指针去掉和键重叠的记号，避免 记号数 × 键数 的开销。
        var k = 0
        for token in sortedByStart(tokenizeGeneric(code, spec)) {
            while k < keyRanges.count, keyRanges[k].location + keyRanges[k].length - 1 < token.start { k += 1 }
            if k < keyRanges.count, keyRanges[k].location < token.end { continue }
            tokens.append(token)
        }
        return sortedByStart(tokens)
    }

    /// `^-?-?[\w-]+\s*:`：从 `index` 起（最多看 120 个字符）是不是"属性名 + 冒号"。
    private static func isCssProperty(_ code: [UInt16], _ index: Int) -> Bool {
        let limit = min(code.count, index + 120)
        var i = index
        while i < limit, isASCIIWord(code[i]) || code[i] == 0x2D { i += 1 }
        guard i > index else { return false }
        while i < limit, code[i] == 0x20 || (code[i] >= 0x09 && code[i] <= 0x0D) { i += 1 }
        return i < limit && code[i] == 0x3A
    }

    // 属性名只在声明开头：往前跳过空白后是 {、; 或开头。
    private static func startsDeclaration(_ code: [UInt16], _ index: Int) -> Bool {
        var j = index - 1
        while j >= 0, isWhitespace(code[j]) { j -= 1 }
        return j < 0 || code[j] == 0x7B || code[j] == 0x3B
    }

    // CSS：选择器里的元素名是 selector-tag，属性名是 attribute，@规则是关键字，数值是数字。
    private static func tokenizeCss(_ code: [UInt16]) -> [CodeToken] {
        var tokens: [CodeToken] = []
        var i = 0
        var depth = 0
        let commentOpen = units("/*")
        let commentClose = units("*/")
        let selectorBreak = Set(".#-:_".utf16)
        while i < code.count {
            let c = code[i]
            if starts(code, commentOpen, at: i) {
                let end = index(of: commentClose, in: code, from: i + 2).map { $0 + 2 } ?? code.count
                tokens.append(CodeToken(start: i, end: end, kind: .comment))
                i = end
            } else if c == 0x22 || c == 0x27 {
                let end = readString(code, i, c)
                tokens.append(CodeToken(start: i, end: end, kind: .string))
                i = end
            } else if c == 0x40 {
                var end = i + 1
                while end < code.count, isIdent(code[end]) || code[end] == 0x2D { end += 1 }
                tokens.append(CodeToken(start: i, end: end, kind: .keyword))
                i = end
            } else if c == 0x7B {
                depth += 1
                i += 1
            } else if c == 0x7D {
                depth = max(0, depth - 1)
                i += 1
            } else if depth > 0, isIdentStart(c) || c == 0x2D, startsDeclaration(code, i), isCssProperty(code, i) {
                var end = i
                while end < code.count, isIdent(code[end]) || code[end] == 0x2D { end += 1 }
                tokens.append(CodeToken(start: i, end: end, kind: .variable))
                i = end
            } else if isDigit(c) || (c == 0x2E && i + 1 < code.count && isDigit(code[i + 1])) {
                var end = i
                while end < code.count, isDigit(code[end]) || code[end] == 0x2E { end += 1 }
                while end < code.count, isLetter(code[end]) || code[end] == 0x25 { end += 1 }
                tokens.append(CodeToken(start: i, end: end, kind: .number))
                i = end
            } else if c == 0x23, depth > 0 {
                var end = i + 1
                while end < code.count, isLetterOrDigit(code[end]) { end += 1 }
                tokens.append(CodeToken(start: i, end: end, kind: .number))
                i = end
            } else if depth == 0, isIdentStart(c), i == 0 || (!selectorBreak.contains(code[i - 1]) && !isIdent(code[i - 1])) {
                var end = i
                while end < code.count, isIdent(code[end]) || code[end] == 0x2D { end += 1 }
                tokens.append(CodeToken(start: i, end: end, kind: .keyword))
                i = end
            } else {
                i += 1
            }
        }
        return tokens
    }

    // HTML / XML：整个标签是 tag 色，标签名是 name，属性名是 attr，属性值是字符串，<!-- --> 是注释。
    private static func tokenizeMarkup(_ code: [UInt16]) -> [CodeToken] {
        var tokens: [CodeToken] = []
        var i = 0
        let commentOpen = units("<!--")
        let commentClose = units("-->")
        while i < code.count {
            if starts(code, commentOpen, at: i) {
                let end = index(of: commentClose, in: code, from: i + 4).map { $0 + 3 } ?? code.count
                tokens.append(CodeToken(start: i, end: end, kind: .comment))
                i = end
            } else if starts(code, [0x3C, 0x21], at: i) || starts(code, [0x3C, 0x3F], at: i) {
                let end = index(of: 0x3E, in: code, from: i).map { $0 + 1 } ?? code.count
                tokens.append(CodeToken(start: i, end: end, kind: .meta))
                i = end
            } else if code[i] == 0x3C, i + 1 < code.count, isLetter(code[i + 1]) || code[i + 1] == 0x2F {
                let end = index(of: 0x3E, in: code, from: i).map { $0 + 1 } ?? code.count
                tokens.append(CodeToken(start: i, end: end, kind: .tag))
                var j = i + 1
                if j < end, code[j] == 0x2F { j += 1 }
                let nameStart = j
                while j < end, isLetterOrDigit(code[j]) || code[j] == 0x2D || code[j] == 0x3A { j += 1 }
                if j > nameStart { tokens.append(CodeToken(start: nameStart, end: j, kind: .title)) }
                while j < end {
                    let c = code[j]
                    if c == 0x22 || c == 0x27 {
                        let close = min(readString(code, j, c), end)
                        tokens.append(CodeToken(start: j, end: close, kind: .string))
                        j = close
                    } else if isLetter(c) {
                        let start = j
                        while j < end, isLetterOrDigit(code[j]) || code[j] == 0x2D || code[j] == 0x3A || code[j] == 0x5F { j += 1 }
                        tokens.append(CodeToken(start: start, end: j, kind: .variable))
                    } else {
                        j += 1
                    }
                }
                i = end
            } else {
                i += 1
            }
        }
        return tokens
    }

    private static let markdownLink = ChatRegex(#"\[([^\]\n]+)\]\(([^)\n]+)\)"#)
    private static let markdownQuote = lines(#"^>.*$"#)

    // Markdown：网页主题只给链接文字（string）和行内代码以外的少数记号上色，这里只标链接和引用。
    private static func tokenizeMarkdown(_ text: String) -> [CodeToken] {
        var tokens: [CodeToken] = []
        for match in markdownLink.matches(in: text) {
            let label = match.range(at: 1)
            tokens.append(CodeToken(start: label.location, end: label.location + label.length, kind: .string))
        }
        for match in markdownQuote.matches(in: text) {
            tokens.append(CodeToken(start: match.range.location, end: match.range.location + match.range.length, kind: .comment))
        }
        return sortedByStart(tokens)
    }
}
