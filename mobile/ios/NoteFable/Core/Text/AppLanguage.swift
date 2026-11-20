import Foundation

/// 界面语言（和网页 `src/lib/i18n/locale.ts` 的 Locale / LocalePreference 一致）。Android 端 `data/AppLanguage.kt` 的移植。
///
/// - 选择（`Preference`）由 `LanguageController` 存在本机；"自动" = 不存，跟系统语言走。
/// - 界面实际用的语言由 `resolveLocale` 决定，文案（`<lproj>.lproj`）、系统文、笔记 WebView 的 `lang=`
///   和发给服务端的 Accept-Language 都跟它走，所以不会出现"界面是英文、系统文是中文"的情况。
enum AppLanguage {
    /// 第一项是"自动"，后面 17 种语言的顺序和网页 LOCALE_DEFINITIONS 相同（语言菜单按这个顺序列）。
    enum Preference: CaseIterable, Hashable, Sendable {
        case auto
        case english, simplified, traditional, japanese
        case korean, spanish, french, german, portugueseBrazil, italian
        case indonesian, vietnamese, thai, hindi, arabic, turkish, russian

        /// 网页 Locale 代码（存在账号和本机的就是它）；"自动"是 "auto"。
        var code: String { AppLanguage.definitions[self]?.code ?? "auto" }
        /// BCP 47 标签（网页 LOCALE_TAGS），用作 Accept-Language 和文字排版的语言；"自动"没有。
        var tag: String? { AppLanguage.definitions[self]?.tag }
        /// 文案所在的 `Resources/<lproj>.lproj`；"自动"没有。
        var lproj: String? { AppLanguage.definitions[self]?.lproj }
        /// 从右往左书写（网页 LOCALE_DIRS：目前只有阿拉伯语）。
        var isRightToLeft: Bool { AppLanguage.definitions[self]?.rtl ?? false }
    }

    private struct Definition {
        let code: String
        let tag: String
        let lproj: String
        let name: String
        var rtl = false
    }

    // 网页 LOCALE_DEFINITIONS 的 code / tag / name / dir，加上 iOS 的 lproj 名（scripts/ios-strings.ts 的 IOS_LPROJ）。
    // src/lib/ios-language.test.ts 逐行核对，改语言表时两边一起改。
    private static let definitions: [Preference: Definition] = [
        .english: Definition(code: "en", tag: "en", lproj: "en", name: "English"),
        .simplified: Definition(code: "zh", tag: "zh-CN", lproj: "zh-Hans", name: "简体中文"),
        .traditional: Definition(code: "zh-Hant", tag: "zh-TW", lproj: "zh-Hant", name: "繁體中文"),
        .japanese: Definition(code: "ja", tag: "ja", lproj: "ja", name: "日本語"),
        .korean: Definition(code: "ko", tag: "ko", lproj: "ko", name: "한국어"),
        .spanish: Definition(code: "es", tag: "es", lproj: "es", name: "Español"),
        .french: Definition(code: "fr", tag: "fr", lproj: "fr", name: "Français"),
        .german: Definition(code: "de", tag: "de", lproj: "de", name: "Deutsch"),
        .portugueseBrazil: Definition(code: "pt-BR", tag: "pt-BR", lproj: "pt-BR", name: "Português (Brasil)"),
        .italian: Definition(code: "it", tag: "it", lproj: "it", name: "Italiano"),
        .indonesian: Definition(code: "id", tag: "id", lproj: "id", name: "Bahasa Indonesia"),
        .vietnamese: Definition(code: "vi", tag: "vi", lproj: "vi", name: "Tiếng Việt"),
        .thai: Definition(code: "th", tag: "th", lproj: "th", name: "ไทย"),
        .hindi: Definition(code: "hi", tag: "hi", lproj: "hi", name: "हिन्दी"),
        .arabic: Definition(code: "ar", tag: "ar", lproj: "ar", name: "العربية", rtl: true),
        .turkish: Definition(code: "tr", tag: "tr", lproj: "tr", name: "Türkçe"),
        .russian: Definition(code: "ru", tag: "ru", lproj: "ru", name: "Русский"),
    ]

    /// 网页 LOCALE_NAMES：各语言用它自己的写法；"自动"由调用方翻译（`language_auto` / `language_auto_current`）。
    static func nativeName(_ preference: Preference) -> String? {
        definitions[preference]?.name
    }

    private static let traditionalRegions: Set<String> = ["tw", "hk", "mo"]
    private static let aliases: [String: String] = [
        "eng": "en", "jpn": "ja", "chi": "zh", "zho": "zh", "cmn": "zh",
        "kor": "ko", "spa": "es", "fra": "fr", "fre": "fr", "deu": "de", "ger": "de",
        "por": "pt", "ita": "it", "ind": "id", "in": "id", "vie": "vi", "tha": "th",
        "hin": "hi", "ara": "ar", "tur": "tr", "rus": "ru",
    ]

    /// 语言标签 → 启用的语言；不认识、没启用或写法不对的是 nil。规则同网页 `localeFromTag`：
    /// 严格按 BCP 47 的结构解析（下划线当连字符，ISO 639-2/3 和 `in` 这些旧代码先换成两字母代码），
    /// 中文先看文字（Hant / Hans）再看地区（台港澳是繁体），`pt` 不分地区都是 pt-BR。
    ///
    /// 网页用 `Intl.Locale`、Android 用 `Locale.Builder` 解析；这里自己按同一套结构解析，不依赖 ICU，
    /// 所以 iOS 和 Linux（单元测试）结果相同：语言[-文字][-地区](-变体)*(-扩展)*[-x-私用]。
    /// 和 `Intl.Locale` 一样不接受 extlang（`zh-yue`）、重复的变体或扩展。
    static func localeFromTag(_ tag: String?) -> Preference? {
        guard let tag else { return nil }
        let normalized = tag.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "_", with: "-")
        // 网页的 /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i。先按原样检查再转小写：有些非 ASCII 字母（开尔文符号 K）小写后是 ASCII。
        let rawParts = normalized.split(separator: "-", omittingEmptySubsequences: false)
        guard let rawPrimary = rawParts.first, (2...8).contains(rawPrimary.utf8.count), rawPrimary.utf8.allSatisfy(isAsciiLetter),
              rawParts.dropFirst().allSatisfy({ (1...8).contains($0.utf8.count) && $0.utf8.allSatisfy(isAsciiAlphanumeric) })
        else { return nil }
        let parts = rawParts.map { $0.lowercased() }
        let primary = parts[0]

        var index = 1
        var script: String?
        var region: String?
        if index < parts.count, parts[index].utf8.count == 4, parts[index].utf8.allSatisfy(isAsciiLetter) {
            script = parts[index]
            index += 1
        }
        if index < parts.count, isRegion(parts[index]) {
            region = parts[index]
            index += 1
        }
        var variants = Set<String>()
        while index < parts.count, isVariant(parts[index]) {
            guard variants.insert(parts[index]).inserted else { return nil }
            index += 1
        }
        var singletons = Set<String>()
        while index < parts.count, parts[index].utf8.count == 1, parts[index] != "x" {
            guard singletons.insert(parts[index]).inserted else { return nil }
            index += 1
            let start = index
            while index < parts.count, parts[index].utf8.count >= 2 { index += 1 }
            guard index > start else { return nil }
        }
        if index < parts.count, parts[index] == "x" {
            guard index + 1 < parts.count else { return nil }
            index = parts.count
        }
        guard index == parts.count else { return nil }

        switch aliases[primary] ?? primary {
        case "en": return .english
        case "ja": return .japanese
        case "zh":
            if script == "hant" { return .traditional }
            if script == "hans" { return .simplified }
            if let region, traditionalRegions.contains(region) { return .traditional }
            return .simplified
        case "ko": return .korean
        case "es": return .spanish
        case "fr": return .french
        case "de": return .german
        case "pt": return .portugueseBrazil
        case "it": return .italian
        case "id": return .indonesian
        case "vi": return .vietnamese
        case "th": return .thai
        case "hi": return .hindi
        case "ar": return .arabic
        case "tr": return .turkish
        case "ru": return .russian
        default: return nil
        }
    }

    private static func isAsciiLetter(_ byte: UInt8) -> Bool {
        (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x41 && byte <= 0x5a)
    }

    private static func isAsciiDigit(_ byte: UInt8) -> Bool {
        byte >= 0x30 && byte <= 0x39
    }

    private static func isAsciiAlphanumeric(_ byte: UInt8) -> Bool {
        isAsciiLetter(byte) || isAsciiDigit(byte)
    }

    /// 地区：两个字母或三个数字（`es-419`）。
    private static func isRegion(_ part: String) -> Bool {
        let bytes = part.utf8
        return (bytes.count == 2 && bytes.allSatisfy(isAsciiLetter)) || (bytes.count == 3 && bytes.allSatisfy(isAsciiDigit))
    }

    /// 变体：5～8 个字母数字，或数字开头的 4 个。
    private static func isVariant(_ part: String) -> Bool {
        let bytes = part.utf8
        if (5...8).contains(bytes.count) { return true }
        return bytes.count == 4 && bytes.first.map(isAsciiDigit) == true
    }

    /// 存下来的语言标签 → 选项；读不出来的是"自动"（Android 的 `preferenceOf(Locale)`）。
    static func preferenceOf(_ tag: String?) -> Preference {
        localeFromTag(tag) ?? .auto
    }

    /// 保守的国家回退（网页 `localeFromCountry`）：多语或英语通用的地区（IN、CH、CA、BE…）不按国家指定语言。
    static func localeFromCountry(_ country: String?) -> Preference? {
        switch country?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
        case "US", "GB", "AU", "NZ", "IE": return .english
        case "CN", "SG": return .simplified
        case "TW", "HK", "MO": return .traditional
        case "JP": return .japanese
        case "KR": return .korean
        case "ES", "MX", "AR", "CO", "CL", "PE": return .spanish
        case "FR": return .french
        case "DE", "AT": return .german
        case "BR": return .portugueseBrazil
        case "IT": return .italian
        case "ID": return .indonesian
        case "VN": return .vietnamese
        case "TH": return .thai
        case "SA", "EG", "AE", "MA", "DZ", "JO", "KW", "QA": return .arabic
        case "TR": return .turkish
        case "RU": return .russian
        default: return nil
        }
    }

    /// 界面实际用的语言：明确的选择优先；"自动"时取系统语言列表里第一个启用的语言，没有再按国家，最后英文。
    static func resolveLocale(_ preference: Preference, preferredTags: [String], country: String? = nil) -> Preference {
        if preference != .auto { return preference }
        for tag in preferredTags {
            if let locale = localeFromTag(tag) { return locale }
        }
        return localeFromCountry(country) ?? .english
    }

    /// 账号上存的语言代码（网页 Locale）→ 选项；不认识的是 nil。"auto" 不是账号能存的值。
    static func preferenceOfCode(_ code: String?) -> Preference? {
        guard let code else { return nil }
        return Preference.allCases.first { $0 != .auto && $0.code == code }
    }

    /// 界面语言代码（网页 Locale）→ Accept-Language 的值（网页 LOCALE_TAGS）。
    static func acceptLanguage(_ uiLocale: String?) -> String {
        preferenceOfCode(uiLocale)?.tag ?? "en"
    }

    /// 语言菜单的搜索（网页 language-menu.tsx）：按原生名、代码、标签找，不分大小写；"自动"总是留着。
    static func options(matching query: String) -> [Preference] {
        let needle = Array(query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().unicodeScalars)
        guard !needle.isEmpty else { return Preference.allCases }
        return Preference.allCases.filter { option in
            guard let definition = definitions[option] else { return true }
            let haystack = Array("\(definition.name) \(definition.code) \(definition.tag)".lowercased().unicodeScalars)
            guard haystack.count >= needle.count else { return false }
            return (0...(haystack.count - needle.count)).contains { haystack[$0..<($0 + needle.count)].elementsEqual(needle) }
        }
    }

    private final class LockedString: @unchecked Sendable {
        private let lock = NSLock()
        private var value: String
        init(_ value: String) { self.value = value }
        func get() -> String {
            lock.lock()
            defer { lock.unlock() }
            return value
        }
        func set(_ next: String) {
            lock.lock()
            value = next
            lock.unlock()
        }
    }

    private static let currentUiLocale = LockedString("en")

    /// 当前界面语言（网页 Locale 代码）。由 `LanguageController` 更新；网络层在任意线程读它来设置 Accept-Language
    /// （`AppLanguage.acceptLanguage(AppLanguage.uiLocale)`）。
    static var uiLocale: String {
        get { currentUiLocale.get() }
        set { currentUiLocale.set(newValue) }
    }

    /// 账号上存的界面语言（网页 AccountUser.locale 的三种状态）。
    enum SavedLocale: Equatable, Sendable {
        /// 服务端没返回这个字段：不知道，不能当成"自动"，也不能用本机的选择覆盖账号。
        case unknown
        /// JSON 里是 null：明确的"自动"。
        case auto
        /// 网页 Locale 代码。
        case code(String)

        /// Android 的 DTO 写法：字段缺失时是一个约定的标记（`LOCALE_UNKNOWN`），null 是自动。
        init(accountLocale: String?, unknownMarker: String) {
            if let accountLocale {
                self = accountLocale == unknownMarker ? .unknown : .code(accountLocale)
            } else {
                self = .auto
            }
        }
    }
}

/// 语言同步要做的事（网页 `src/lib/locale-sync.ts` 的 LocaleSyncAction）。
enum LocaleSyncAction: Equatable, Sendable {
    case switchTo(AppLanguage.Preference)
}

/// 界面语言跟着账号走的规则（网页 `localeSyncAction`，Android 同名函数）。
/// 账号上是 null = 权威的"自动"；字段缺失 = 不知道，什么也不做；没登录时保留本机的选择。
/// `target` 是正在切换去的语言（原生端切换是同步的，传 nil）。
func localeSyncAction(
    loaded: Bool,
    configured: Bool,
    signedIn: Bool,
    saved: AppLanguage.SavedLocale,
    preference: AppLanguage.Preference,
    active: AppLanguage.Preference,
    target: AppLanguage.Preference?
) -> LocaleSyncAction? {
    guard loaded, configured, signedIn else { return nil }
    let desired: AppLanguage.Preference
    switch saved {
    case .unknown:
        return nil
    case .auto:
        desired = .auto
    case .code(let code):
        guard let known = AppLanguage.preferenceOfCode(code) else { return nil }
        desired = known
    }
    if desired == .auto {
        return (target ?? preference) == desired ? nil : .switchTo(desired)
    }
    return preference == desired && (target ?? active) == desired ? nil : .switchTo(desired)
}
