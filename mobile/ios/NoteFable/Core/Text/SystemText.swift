import Foundation

/// 服务端发来的英文系统文（API 错误、工具完成标签、429 上限说明、"Request failed: …"）的各语言译文。
/// Android 端 `data/SystemText.kt` 的移植。
///
/// 网页用 `t()` / `localizeSystemText`（`src/lib/i18n/translate.ts`）翻译这些句子；原生端没有网页字典，
/// 用安装包里的 `system-text.json`（`scripts/gen-native-system-text.ts` 从网页字典生成，和 Android 共用同一个文件）。
/// 规则与网页逐条对应：只翻译整句命中的系统文和 `templates` 里的句型，句型里的值（标题、文件名、搜索词）原样保留，
/// `{detail}` 再递归翻译一次。
struct SystemText: Sendable {
    private let messages: [String: [String: String]]
    private let patterns: [Pattern]

    init(templates: [String], messages: [String: [String: String]]) {
        self.messages = messages
        patterns = templates.compactMap(SystemText.patternOf)
    }

    /// 没有词典（读不到资源）时：一律显示英文原句，和网页英文界面一样。
    static let empty = SystemText(templates: [], messages: [:])

    /// 按界面语言（网页 Locale 代码或语言标签；英文和不认识的语言返回英文原句）取翻译器。
    func translator(_ language: String?) -> SystemTextTranslator {
        let key = SystemText.normalizeLanguage(language)
        return SystemTextTranslator(messages: key.flatMap { messages[$0] } ?? [:], patterns: patterns)
    }

    private struct Asset: Decodable {
        var templates: [String]
        var messages: [String: [String: String]]

        private enum CodingKeys: String, CodingKey { case templates, messages }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            templates = try container.decodeIfPresent([String].self, forKey: .templates) ?? []
            messages = try container.decodeIfPresent([String: [String: String]].self, forKey: .messages) ?? [:]
        }
    }

    /// 解析 `system-text.json`；不是预期的 JSON 时抛出。
    static func parse(_ data: Data) throws -> SystemText {
        let asset = try JSONDecoder().decode(Asset.self, from: data)
        return SystemText(templates: asset.templates, messages: asset.messages)
    }

    static func parse(_ json: String) throws -> SystemText {
        try parse(Data(json.utf8))
    }

    /// 界面语言代码或语言标签 → 词典的键。zh 和网页 localeFromTag 一样：有 Hant 或台港澳地区是繁体，其余简体。
    static func normalizeLanguage(_ language: String?) -> String? {
        guard let language else { return nil }
        let parts = language.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .split(omittingEmptySubsequences: false) { $0 == "-" || $0 == "_" }.map(String.init)
        switch parts.first ?? "" {
        case "zh", "chi", "zho", "cmn":
            if parts.contains("hant") { return "zh-Hant" }
            if parts.contains("hans") { return "zh" }
            if parts.contains(where: { $0 == "tw" || $0 == "hk" || $0 == "mo" }) { return "zh-Hant" }
            return "zh"
        case "ja", "jpn": return "ja"
        case "ko", "kor": return "ko"
        case "es", "spa": return "es"
        case "fr", "fra", "fre": return "fr"
        case "de", "deu", "ger": return "de"
        case "pt", "por": return "pt-BR"
        case "it", "ita": return "it"
        case "id", "in", "ind": return "id"
        case "vi", "vie": return "vi"
        case "th", "tha": return "th"
        case "hi", "hin": return "hi"
        case "ar", "ara": return "ar"
        case "tr", "tur": return "tr"
        case "ru", "rus": return "ru"
        default: return nil
        }
    }

    /// 一个句型：`前缀{名字}后缀`，整句匹配（网页是 `^前缀([\s\S]*)后缀$`）。
    struct Pattern: Sendable {
        let key: String
        let name: String
        let prefix: [Unicode.Scalar]
        let suffix: [Unicode.Scalar]

        /// 整句是这个句型时返回 `{名字}` 位置上的文字。按码点比较，和网页的正则一样不做 Unicode 等价折叠。
        func capture(_ text: String) -> String? {
            let scalars = Array(text.unicodeScalars)
            guard scalars.count >= prefix.count + suffix.count,
                  scalars[..<prefix.count].elementsEqual(prefix),
                  scalars[(scalars.count - suffix.count)...].elementsEqual(suffix) else { return nil }
            var captured = String.UnicodeScalarView()
            captured.append(contentsOf: scalars[prefix.count..<(scalars.count - suffix.count)])
            return String(captured)
        }
    }

    private static func patternOf(_ template: String) -> Pattern? {
        let scalars = Array(template.unicodeScalars)
        guard let slot = firstSlot(in: scalars, from: 0) else { return nil }
        return Pattern(key: template, name: slot.name, prefix: Array(scalars[..<slot.start]), suffix: Array(scalars[slot.end...]))
    }
}

struct SystemTextTranslator: Sendable {
    static let REQUEST_FAILED = "Request failed: {detail}"

    private let messages: [String: String]
    private let patterns: [SystemText.Pattern]

    fileprivate init(messages: [String: String], patterns: [SystemText.Pattern]) {
        self.messages = messages
        self.patterns = patterns
    }

    /// 网页的 `t(text, vars)`：按英文原句查译文，没有就用原句，再把 `{name}` 换成值（值里的花括号不再展开）。
    func t(_ text: String, _ vars: [String: String] = [:]) -> String {
        let template = messages[text] ?? text
        return vars.isEmpty ? template : fill(template, vars)
    }

    /// 网页的 `localizeSystemText`：只用于明确的系统错误和工具标签，不要传正文、标题或文件名。
    func localize(_ text: String) -> String {
        for pattern in patterns {
            guard let captured = pattern.capture(text) else { continue }
            let value = pattern.name == "detail" ? localize(captured) : captured
            return t(pattern.key, [pattern.name: value])
        }
        return t(text)
    }

    /// 网页的 `localizeFailureText`：回答末尾由服务端追加的 "Request failed: …" 换成译文。
    /// 只在 `failure` 指向的位置正好是那句话时替换，不从正文的措辞猜测。位置是 UTF-16 下标（和 JS 一样）。
    func localizeFailure(_ content: String, _ failure: FailureInfo?) -> String {
        guard let failure else { return content }
        let units = Array(content.utf16)
        guard failure.offset >= 0, failure.offset <= units.count else { return content }
        let appended = fill(SystemTextTranslator.REQUEST_FAILED, ["detail": failure.detail])
        guard units[failure.offset...].elementsEqual(appended.utf16) else { return content }
        return String(decoding: units[..<failure.offset], as: UTF16.self)
            + t(SystemTextTranslator.REQUEST_FAILED, ["detail": localize(failure.detail)])
    }
}

/// 服务端追加的失败文的位置与原因（`src/lib/failure-text.ts` 的 FailureInfo，存在 activity 里）。
struct FailureInfo: Equatable, Sendable {
    /// 正文里的 UTF-16 下标。
    let offset: Int
    let detail: String

    init(offset: Int, detail: String) {
        self.offset = offset
        self.detail = detail
    }

    /// 从一个 activity 事件 / 步骤（`{type|kind: "failure", offset, detail}`）读出失败信息。
    static func from(_ element: JSONValue?) -> FailureInfo? {
        guard let element, element.objectValue != nil else { return nil }
        guard (element["type"]?.stringValue ?? element["kind"]?.stringValue) == "failure",
              let offset = element["offset"]?.intValue, offset >= 0,
              let detail = element["detail"]?.stringValue else { return nil }
        return FailureInfo(offset: offset, detail: detail)
    }

    /// 保存的回答：activity 是步骤数组，取其中的失败步骤。
    static func fromActivity(_ activity: JSONValue?) -> FailureInfo? {
        guard let steps = activity?.arrayValue else { return nil }
        for step in steps {
            if let failure = from(step) { return failure }
        }
        return nil
    }
}

// MARK: - `{name}` 占位

private func isWordScalar(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x30...0x39, 0x41...0x5a, 0x61...0x7a, 0x5f: return true
    default: return false
    }
}

/// 从 `from` 起第一个 `{\w+}`：名字和它在 `scalars` 里的范围 `[start, end)`。
private func firstSlot(in scalars: [Unicode.Scalar], from: Int) -> (name: String, start: Int, end: Int)? {
    var index = from
    while index < scalars.count {
        if scalars[index] == "{" {
            var end = index + 1
            while end < scalars.count, isWordScalar(scalars[end]) { end += 1 }
            if end > index + 1, end < scalars.count, scalars[end] == "}" {
                var name = String.UnicodeScalarView()
                name.append(contentsOf: scalars[(index + 1)..<end])
                return (String(name), index, end + 1)
            }
        }
        index += 1
    }
    return nil
}

/// 把模板里的 `{name}` 换成值；没有对应值的占位原样留着。只扫一遍，值里的花括号不再展开。
private func fill(_ template: String, _ vars: [String: String]) -> String {
    let scalars = Array(template.unicodeScalars)
    var out = String.UnicodeScalarView()
    var index = 0
    while let slot = firstSlot(in: scalars, from: index) {
        out.append(contentsOf: scalars[index..<slot.start])
        if let value = vars[slot.name] {
            out.append(contentsOf: value.unicodeScalars)
        } else {
            out.append(contentsOf: scalars[slot.start..<slot.end])
        }
        index = slot.end
    }
    out.append(contentsOf: scalars[index...])
    return String(out)
}
