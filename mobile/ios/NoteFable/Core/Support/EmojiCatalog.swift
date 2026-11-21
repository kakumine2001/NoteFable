import Foundation

// 表情选择器的数据（emoji.json，由 scripts/gen-native-emoji.ts 从网页用的 emoji-picker-react 生成，和 Android 共用同一个文件）。
// Android 端 `data/EmojiCatalog.kt` 的移植。规则照着网页的选择器：
// - 分类和顺序与网页 full-emoji-picker.tsx 的 EMOJI_CATEGORIES 相同，第一类 suggested 是"最近使用"；
// - 搜索：去掉首尾空白、转小写，表情的任一关键词包含它就算命中（emoji-picker-react 的 normalizeQuery + includes）；
//   关键词用当前界面语言那一份（网页按 locale 换 emojiData）；
// - 最近使用：选中的表情（含肤色）放到最前，最多 14 个（emoji-picker-react 的 setSuggested，SuggestionMode.RECENT）；
// - 本机字体画不出来的表情不显示（网页同样隐藏浏览器不支持的表情）。

/// 分类图标 / 放大镜 / 清除图标里的一条路径（SVG path 的 `d`）。
struct EmojiShape: Decodable, Equatable, Sendable {
    let d: String
    let fill: Bool
    let stroke: Bool
    let strokeWidth: Double
    let round: Bool
    let evenOdd: Bool

    private enum CodingKeys: String, CodingKey { case d, fill, stroke, strokeWidth, round, evenOdd }

    init(d: String, fill: Bool, stroke: Bool, strokeWidth: Double = 1, round: Bool = false, evenOdd: Bool = false) {
        self.d = d
        self.fill = fill
        self.stroke = stroke
        self.strokeWidth = strokeWidth
        self.round = round
        self.evenOdd = evenOdd
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        d = try container.decode(String.self, forKey: .d)
        fill = try container.decode(Bool.self, forKey: .fill)
        stroke = try container.decode(Bool.self, forKey: .stroke)
        strokeWidth = try container.decodeIfPresent(Double.self, forKey: .strokeWidth) ?? 1
        round = try container.decodeIfPresent(Bool.self, forKey: .round) ?? false
        evenOdd = try container.decodeIfPresent(Bool.self, forKey: .evenOdd) ?? false
    }
}

/// `viewBox` 是 [minX, minY, 宽, 高]。
struct EmojiIcon: Decodable, Equatable, Sendable {
    let viewBox: [Double]
    let shapes: [EmojiShape]
}

/// 一个表情。`unified` 是码点（小写十六进制，用 - 连接），`variations` 是带肤色的版本。
struct EmojiItem: Equatable, Hashable, Identifiable, Sendable {
    let unified: String
    let category: String
    let variations: [String]
    /// 当前界面语言的关键词，已转小写。最后一个是名称（网页拿它当 aria-label）。
    let names: [String]

    var id: String { unified }
    var emoji: String { unifiedToEmoji(unified) }
    var label: String { names.last ?? "" }

    /// 选了肤色时显示带该肤色的版本（emoji-picker-react 的 emojiVariationUnified）；没有就用原样。
    func unifiedFor(_ tone: SkinTone) -> String {
        guard let code = tone.code else { return unified }
        return variations.first { containsBytes($0.utf8, code.utf8) } ?? unified
    }
}

/// 肤色（网页选择器搜索框右边的色块）。`code` 是变体里的肤色码点；默认色没有。`color` 是色块的颜色（0xRRGGBB）。
enum SkinTone: CaseIterable, Sendable {
    case neutral, light, mediumLight, medium, mediumDark, dark

    var code: String? {
        switch self {
        case .neutral: return nil
        case .light: return "1f3fb"
        case .mediumLight: return "1f3fc"
        case .medium: return "1f3fd"
        case .mediumDark: return "1f3fe"
        case .dark: return "1f3ff"
        }
    }

    var color: UInt32 {
        switch self {
        case .neutral: return 0xFFD225
        case .light: return 0xFFDFBD
        case .mediumLight: return 0xE9C197
        case .medium: return 0xC88E62
        case .mediumDark: return 0xA86637
        case .dark: return 0x60463A
        }
    }
}

/// 码点（十六进制，用 - 连接）→ 表情字符。读不出来的段跳过。
func unifiedToEmoji(_ unified: String) -> String {
    var scalars = String.UnicodeScalarView()
    for part in unified.split(separator: "-") {
        if let value = UInt32(part, radix: 16), let scalar = Unicode.Scalar(value) { scalars.append(scalar) }
    }
    return String(scalars)
}

struct EmojiCatalog: Sendable {
    let categories: [String]
    /// 分类图标，加上 `search`（放大镜）和 `clear`（清除）。
    let icons: [String: EmojiIcon]
    let emojis: [EmojiItem]
    private let byUnified: [String: EmojiItem]

    init(categories: [String], icons: [String: EmojiIcon], emojis: [EmojiItem]) {
        self.categories = categories
        self.icons = icons
        self.emojis = emojis
        var index: [String: EmojiItem] = [:]
        for item in emojis {
            index[item.unified] = item
            for variation in item.variations where index[variation] == nil { index[variation] = item }
        }
        byUnified = index
    }

    /// 码点（含带肤色的）对应的表情。
    func find(_ unified: String) -> EmojiItem? {
        byUnified[unified.lowercased()]
    }

    func inCategory(_ category: String) -> [EmojiItem] {
        emojis.filter { $0.category == category }
    }

    /// 搜索（emoji-picker-react：trim + toLowerCase，任一关键词包含就命中）。空查询返回 nil（不在搜索）。
    /// "包含"按码点比（和 JS 的 includes 一样），不按字形簇：泰语、印地语里一个辅音后面跟着元音符号时也要能搜到。
    func matcher(_ query: String) -> ((EmojiItem) -> Bool)? {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized.isEmpty { return nil }
        let needle = Array(normalized.utf8)
        return { item in item.names.contains { containsBytes($0.utf8, needle) } }
    }

    private static let emojiLocales: Set<String> = ["en", "zh", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt-BR", "it", "vi", "th", "hi", "ru"]

    private struct RawEmoji: Decodable {
        let u: String
        let c: Int
        let v: [String]
        let n: [String: [String]]

        private enum CodingKeys: String, CodingKey { case u, c, v, n }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            u = try container.decode(String.self, forKey: .u)
            c = try container.decode(Int.self, forKey: .c)
            v = try container.decodeIfPresent([String].self, forKey: .v) ?? []
            n = try container.decode([String: [String]].self, forKey: .n)
        }
    }

    private struct RawEmojiData: Decodable {
        let categories: [String]
        let icons: [String: EmojiIcon]
        let emojis: [RawEmoji]
    }

    /// 解析 `emoji.json`。`locale` 是界面语言代码（网页 EMOJI_DATA 的键）；emoji-picker-react 没有数据文件的语言
    /// （id / ar / tr）和不认识的语言用英文关键词。`supported` 判断本机字体能不能画出这个表情（要用 CoreText，
    /// 由 App 层传进来），画不出来的表情和肤色变体不收。
    static func parse(_ data: Data, locale: String, supported: (String) -> Bool = { _ in true }) throws -> EmojiCatalog {
        let raw = try JSONDecoder().decode(RawEmojiData.self, from: data)
        let key = emojiLocales.contains(locale) ? locale : "en"
        let emojis: [EmojiItem] = raw.emojis.compactMap { emoji in
            guard supported(unifiedToEmoji(emoji.u)) else { return nil }
            return EmojiItem(
                unified: emoji.u.lowercased(),
                category: raw.categories.indices.contains(emoji.c) ? raw.categories[emoji.c] : "",
                variations: emoji.v.map { $0.lowercased() }.filter { supported(unifiedToEmoji($0)) },
                names: (emoji.n[key] ?? emoji.n["en"] ?? []).map { $0.lowercased() }
            )
        }
        return EmojiCatalog(categories: raw.categories, icons: raw.icons, emojis: emojis)
    }

    static func parse(_ json: String, locale: String, supported: (String) -> Bool = { _ in true }) throws -> EmojiCatalog {
        try parse(Data(json.utf8), locale: locale, supported: supported)
    }

    private final class Cache: @unchecked Sendable {
        private let lock = NSLock()
        private var entry: (locale: String, catalog: EmojiCatalog)?

        func get(_ locale: String) -> EmojiCatalog? {
            lock.lock()
            defer { lock.unlock() }
            return entry?.locale == locale ? entry?.catalog : nil
        }

        func set(_ locale: String, _ catalog: EmojiCatalog) {
            lock.lock()
            entry = (locale, catalog)
            lock.unlock()
        }
    }

    private static let cache = Cache()

    /// 读安装包里的 emoji.json（2 MB 多，每种语言只解析一次，换语言时换掉）。在后台线程调用。
    /// `read` 只在没有缓存时调用，返回 emoji.json 的内容。
    static func load(locale: String, read: () throws -> Data, supported: (String) -> Bool) throws -> EmojiCatalog {
        if let cached = cache.get(locale) { return cached }
        let catalog = try parse(read(), locale: locale, supported: supported)
        cache.set(locale, catalog)
        return catalog
    }
}

/// 最近使用的表情（码点，含肤色），新的在前。网页存在 localStorage 的 epr_suggested，原生存在本机。
protocol RecentEmojiStore {
    func load() -> [String]
    func save(_ list: [String])
}

/// App 里用的实现：存在 UserDefaults（Android 是 SharedPreferences 的 emoji/recent，同样用逗号连起来）。
final class UserDefaultsRecentEmojiStore: RecentEmojiStore {
    private let defaults: UserDefaults
    private let key: String

    init(defaults: UserDefaults = .standard, key: String = "notefable.emoji.recent") {
        self.defaults = defaults
        self.key = key
    }

    func load() -> [String] {
        (defaults.string(forKey: key) ?? "").split(separator: ",").map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    func save(_ list: [String]) {
        defaults.set(list.joined(separator: ","), forKey: key)
    }
}

let RECENT_EMOJI_LIMIT = 14

/// 选中一个表情后的最近使用列表：放到最前、去重、最多 14 个（emoji-picker-react setSuggested）。
func pushRecentEmoji(_ recent: [String], _ unified: String) -> [String] {
    Array(([unified] + recent.filter { $0 != unified }).prefix(RECENT_EMOJI_LIMIT))
}

/// `haystack` 里有没有连续的一段等于 `needle`（按 UTF-8 字节比，等价于按码点比）。空的 `needle` 算有。
private func containsBytes<Haystack: Collection, Needle: Collection>(_ haystack: Haystack, _ needle: Needle) -> Bool
where Haystack.Element == UInt8, Needle.Element == UInt8 {
    let pattern = Array(needle)
    guard let head = pattern.first else { return true }
    let bytes = Array(haystack)
    guard bytes.count >= pattern.count else { return false }
    for start in 0...(bytes.count - pattern.count) where bytes[start] == head {
        var offset = 1
        while offset < pattern.count, bytes[start + offset] == pattern[offset] { offset += 1 }
        if offset == pattern.count { return true }
    }
    return false
}
