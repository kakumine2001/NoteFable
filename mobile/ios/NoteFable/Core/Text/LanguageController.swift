import Foundation
import Observation

/// 本机保存的界面语言选择（Android 是系统的"应用语言"，网页是 Cookie `notefable-locale`）。
/// 存的是网页 Locale 代码；nil = 自动（跟系统语言）。
protocol LanguagePreferenceStore {
    func load() -> String?
    func save(_ code: String?)
}

/// App 里用的实现：存在 UserDefaults。
final class UserDefaultsLanguagePreferenceStore: LanguagePreferenceStore {
    private let defaults: UserDefaults
    private let key: String

    init(defaults: UserDefaults = .standard, key: String = "notefable.language") {
        self.defaults = defaults
        self.key = key
    }

    func load() -> String? { defaults.string(forKey: key) }

    func save(_ code: String?) {
        if let code { defaults.set(code, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
}

/// 界面语言的控制器（Android 的 `MainActivity.resolveAutoConfiguration` + `ui/LanguageUi.kt` 里不画界面的那部分）。
///
/// - 本机的选择（`preference`）存在 `LanguagePreferenceStore`；"自动"时按系统语言列表解析（`AppLanguage.resolveLocale`）。
/// - 实际显示的语言（`active`）换了就找到 `<lproj>.lproj`，交给 `L10n`：用 `L()` 的视图就地重绘，
///   不重建界面，草稿、附件、会话和流式回答都留着。同时更新 `AppLanguage.uiLocale`（Accept-Language 用）。
/// - 系统语言列表里没有启用的语言时先显示英文，再问服务端（`inferLocale`，按 IP 的国家推断）；
///   结果只记在内存里，不写进本机的选择。
/// - 登录后跟着账号上的语言走（`syncWithAccount`）；退出 / 删除账号后忘掉本机的选择（`forgetChoice`）。
@MainActor
@Observable
final class LanguageController {
    /// 本机的选择（语言菜单里打对勾的那一项）；`.auto` = 跟系统语言。
    private(set) var preference: AppLanguage.Preference
    /// 界面实际显示的语言，不会是 `.auto`。
    private(set) var active: AppLanguage.Preference = .english
    /// 上一次切换失败（网页 changeError）：设置里显示 `language_change_failed` 和"重试"。
    private(set) var changeFailed = false
    /// 上一次尝试切换但失败的选择（未登录用户在设置里点"重试"时使用）。
    private(set) var lastFailedPreference: AppLanguage.Preference? = nil

    /// 实际显示的语言的代码（网页 Locale；Android 的 `ui_locale`）。系统文、表情关键词、笔记 WebView 的 `lang=` 用它。
    var uiLocale: String { active.code }
    /// 阿拉伯语：整个界面从右往左排。
    var isRightToLeft: Bool { active.isRightToLeft }
    /// 发给服务端的 Accept-Language。
    var acceptLanguage: String { AppLanguage.acceptLanguage(active.code) }

    @ObservationIgnored private let store: LanguagePreferenceStore
    @ObservationIgnored private let resources: Bundle
    @ObservationIgnored private let systemLanguages: () -> [String]
    @ObservationIgnored private let inferLocale: (([String]) async -> String?)?
    @ObservationIgnored private let l10n: L10n
    /// 已经交给 L10n 的语言；同一个不重复交（每交一次，所有用到文案的视图都会重绘）。
    @ObservationIgnored private var displayed: AppLanguage.Preference?
    @ObservationIgnored private var autoRequest = 0
    /// 服务端推断的结果，只对这份系统语言列表有效（键是列表用逗号连起来）。
    @ObservationIgnored private var autoFallback: (key: String, language: AppLanguage.Preference)?
    /// 正在进行的推断请求（测试里等它结束）。
    @ObservationIgnored private(set) var inference: Task<Void, Never>?

    /// - Parameters:
    ///   - resources: 装着 `<lproj>.lproj/Localizable.strings` 的包（App 里是 `Bundle.main`）。
    ///   - systemLanguages: 系统的语言列表，靠前的优先（`Locale.preferredLanguages`；在系统设置里给这个 App 单独选了语言时就是那个语言）。
    ///   - inferLocale: 系统语言都没启用时问服务端：`GET /api/i18n?preference=auto&format=locale`，
    ///     `Accept-Language` 是参数里的列表用逗号连起来，不带 Cookie；返回 `{"locale": 代码}` 里的代码
    ///     （`AppLanguage.inferredLocaleCode(from:)`），失败返回 nil。不传就一直显示英文。
    init(
        store: LanguagePreferenceStore,
        resources: Bundle = .main,
        systemLanguages: @escaping () -> [String] = { Locale.preferredLanguages },
        inferLocale: (([String]) async -> String?)? = nil,
        l10n: L10n = .shared
    ) {
        self.store = store
        self.resources = resources
        self.systemLanguages = systemLanguages
        self.inferLocale = inferLocale
        self.l10n = l10n
        preference = AppLanguage.preferenceOfCode(store.load()) ?? .auto
        if !apply(preference, save: false) {
            // 存着的语言的资源找不到了（不该发生）：按"自动"显示，存着的选择不动。
            _ = display(autoLanguage(systemLanguages()))
        }
    }

    /// 换本机的语言选择并立刻显示（Android 的 applyLanguage）。找不到这种语言的资源时什么都不换，记下 `changeFailed`。
    func choose(_ next: AppLanguage.Preference) {
        changeFailed = !apply(next, save: true)
        lastFailedPreference = changeFailed ? next : nil
    }

    /// 未登录时在设置里选了语言：只改本机。按系统语言显示着同一种语言时选它，也当作选择存下来（和网页一样）。
    func chooseOnDevice(_ choice: AppLanguage.Preference) {
        if choice != preference || changeFailed { choose(choice) }
    }

    /// 退出登录、删除账号后忘掉本机的选择，回到系统语言（网页 forgetLocaleChoice）。
    func forgetChoice() {
        if preference != .auto { choose(.auto) }
    }

    /// 系统语言变了（`NSLocale.currentLocaleDidChangeNotification`，或回到前台时）：按"自动"显示着的话重新解析。
    func systemLanguagesChanged() {
        if preference == .auto { _ = apply(.auto, save: false) }
    }

    /// 让界面语言跟着账号走（网页 / Android 的 AccountLocaleSync，App 里只放一处）。
    /// 只在账号状态（读到没有、是否登录、账号上的语言、是否正在退出）变化时调用；规则见 `localeSyncAction`。
    func syncWithAccount(loaded: Bool, configured: Bool, signedIn: Bool, signingOut: Bool = false, saved: AppLanguage.SavedLocale) {
        // 退出登录期间不同步（网页 signingOut）：不在即将离开的身份上切换；退出完成后再判断一次（这时已是未登录）。
        if signingOut { return }
        let action = localeSyncAction(
            loaded: loaded, configured: configured, signedIn: signedIn, saved: saved,
            preference: preference, active: active,
            // 原生端的切换是同步的（没有取字典这一步），不存在"切换中"。
            target: nil
        )
        if case .switchTo(let language) = action { choose(language) }
    }

    /// `<包>/<lproj>.lproj` 这个目录本身当成一个包：`localizedString` 就从它里面的 Localizable.strings 读。
    nonisolated static func lprojBundle(_ lproj: String, in resources: Bundle) -> Bundle? {
        let directory = (resources.resourceURL ?? resources.bundleURL).appendingPathComponent("\(lproj).lproj", isDirectory: true)
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory), isDirectory.boolValue {
            return Bundle(path: directory.path)
        }
        return resources.path(forResource: lproj, ofType: "lproj").flatMap { Bundle(path: $0) }
    }

    // MARK: - 内部

    /// 返回 false = 这种语言的资源找不到，什么都没换。
    private func apply(_ next: AppLanguage.Preference, save: Bool) -> Bool {
        let tags = next == .auto ? systemLanguages() : []
        guard display(next == .auto ? autoLanguage(tags) : next) else { return false }
        // 新的选择、系统语言的变化都让还没回来的推断作废。
        autoRequest += 1
        inference?.cancel()
        inference = nil
        if preference != next { preference = next }
        if save { store.save(next == .auto ? nil : next.code) }
        if next == .auto { inferIfNeeded(tags) }
        return true
    }

    private func matched(_ tags: [String]) -> AppLanguage.Preference? {
        for tag in tags {
            if let language = AppLanguage.localeFromTag(tag) { return language }
        }
        return nil
    }

    /// "自动"时显示的语言：系统列表里第一个启用的语言 → 上次服务端对同一份列表的推断 → 英文。
    private func autoLanguage(_ tags: [String]) -> AppLanguage.Preference {
        if let language = matched(tags) { return language }
        if let autoFallback, autoFallback.key == tags.joined(separator: ",") { return autoFallback.language }
        return .english
    }

    private func inferIfNeeded(_ tags: [String]) {
        let key = tags.joined(separator: ",")
        guard let inferLocale, matched(tags) == nil, autoFallback?.key != key else { return }
        let request = autoRequest
        inference = Task { [weak self] in
            guard let inferred = AppLanguage.preferenceOfCode(await inferLocale(tags)) else { return }
            // 这期间手动选了语言，或系统语言变了（出行、改设置），这个结果就不用了。
            guard let self, request == self.autoRequest, self.preference == .auto, self.systemLanguages() == tags else { return }
            self.autoFallback = (key, inferred)
            _ = self.display(inferred)
        }
    }

    private func display(_ language: AppLanguage.Preference) -> Bool {
        if displayed == language { return true }
        guard let lproj = language.lproj, let bundle = Self.lprojBundle(lproj, in: resources) else { return false }
        l10n.use(bundle: bundle, locale: language.code)
        AppLanguage.uiLocale = language.code
        displayed = language
        if active != language { active = language }
        return true
    }
}

extension AppLanguage {
    /// `GET /api/i18n?preference=auto&format=locale` 的响应（`{"locale":"ja"}`）里的语言代码；读不出来是 nil。
    static func inferredLocaleCode(from data: Data) -> String? {
        JSONValue.parse(data)?["locale"]?.stringValue
    }
}
