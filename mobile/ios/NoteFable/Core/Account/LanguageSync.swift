import Foundation

// 界面语言和账号之间的衔接（Android ui/LanguageUi.kt 里不画界面的部分）。切换本身在 LanguageController。

/// 语言同步要看的账号状态。只在它变化时同步一次（Android AccountLocaleSync 的 LaunchedEffect 键）。
struct AccountLocaleSyncKey: Equatable, Sendable {
    var loaded: Bool
    var configured: Bool
    var signedIn: Bool
    var saved: AppLanguage.SavedLocale
    var signingOut: Bool
}

extension AccountUser {
    /// 账号上存的界面语言的三种状态：字段缺失（不知道）、null（自动）、语言代码。
    var savedLocale: AppLanguage.SavedLocale {
        AppLanguage.SavedLocale(accountLocale: locale, unknownMarker: LOCALE_UNKNOWN)
    }
}

extension AccountUiState {
    var localeSyncKey: AccountLocaleSyncKey {
        AccountLocaleSyncKey(
            loaded: loaded, configured: configured, signedIn: user != nil,
            // 没登录时不看这一项。
            saved: user?.savedLocale ?? .unknown, signingOut: signingOut
        )
    }
}

extension LanguageController {
    /// 让界面语言跟着账号走（网页 AccountLocaleSync，App 里只放一处）：账号状态（[AccountUiState.localeSyncKey]）变化时调用。
    /// 账号上是 null 明确表示"自动"，不用本机的选择写回账号；退出登录期间不同步。
    func syncWithAccount(_ account: AccountUiState) {
        let key = account.localeSyncKey
        syncWithAccount(
            loaded: key.loaded, configured: key.configured, signedIn: key.signedIn, signingOut: key.signingOut, saved: key.saved
        )
    }
}

/// 设置里"语言"一行的内容（网页 LanguageSettings）。只保存到账号，切换交给语言同步。
struct LanguageSettingsRow: Equatable, Sendable {
    /// 账号上保存的偏好（null 是自动）；不认识的代码、读不到时是 nil。切换失败时"重试"就是再切到它。
    var saved: AppLanguage.Preference?
    /// 菜单里打对勾的那一项；读不到账号的语言时哪一项都不标。
    var checked: AppLanguage.Preference?
    /// 按钮上写的语言：打勾的那一项，没有就是正在显示的语言。
    var shown: AppLanguage.Preference

    /// - Parameter showing: 界面正在显示的语言（`LanguageController.active`）。
    init(user: AccountUser, showing: AppLanguage.Preference) {
        switch user.savedLocale {
        case .unknown:
            saved = AppLanguage.preferenceOfCode(user.locale)
            checked = nil
        case .auto:
            saved = .auto
            checked = .auto
        case .code(let code):
            saved = AppLanguage.preferenceOfCode(code)
            checked = saved
        }
        shown = checked ?? showing
    }

    /// 在菜单里选了一项：和保存的不同才保存（"自动"存成明确的 null，其余存语言代码）。
    @MainActor
    func choose(_ choice: AppLanguage.Preference, _ account: AccountViewModel) {
        if choice != saved { account.setLocale(choice == .auto ? nil : choice.code) }
    }
}

/// 语言名：各语言用它自己的写法；"自动"后面带上正在显示的语言（language_auto_current）。
func languageLabel(_ option: AppLanguage.Preference, showing: AppLanguage.Preference) -> String {
    option == .auto ? L("language_auto_current", AppLanguage.nativeName(showing) ?? "") : AppLanguage.nativeName(option) ?? ""
}
