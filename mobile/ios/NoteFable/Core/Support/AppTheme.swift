import Foundation
import Observation

// 外观（跟随系统 / 浅色 / 深色）。网页 src/lib/theme.ts、Android data/AppTheme.kt 的同一套三个值。
// 只保存在当前设备上（不跨设备同步）：网页是 localStorage 的 `notefable:theme:v1`，Android 是 SharedPreferences "app_theme" 的 theme，
// 这里是 UserDefaults 的 `app_theme.theme`。颜色本身在界面层（DesignSystem/Theme.swift 的 `Sm`）。

/// 实际显示的外观（网页 ResolvedTheme）。原始值就是交给网页编辑器的字符串。
enum ResolvedTheme: String, Equatable, Sendable {
    case light
    case dark
}

/// 设置里选的外观（网页 ThemePreference）。原始值就是存下来的字符串。
enum ThemePreference: String, CaseIterable, Equatable, Sendable {
    case system
    case light
    case dark

    /// 网页 parseThemePreference：去掉首尾空白、不分大小写；别的值（nil、空串、乱写的）都不认。
    static func parse(_ raw: String?) -> ThemePreference? {
        guard let raw else { return nil }
        return ThemePreference(rawValue: raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    /// 网页 resolveTheme：选了浅色 / 深色就用它，"跟随系统"看系统现在是不是深色。
    func resolve(systemDark: Bool) -> ResolvedTheme {
        switch self {
        case .dark: return .dark
        case .light: return .light
        case .system: return systemDark ? .dark : .light
        }
    }

    /// 设置里这一项的文案键（网页 THEME_OPTIONS 的 System / Light / Dark）。
    var labelKey: String {
        switch self {
        case .system: return "theme_system"
        case .light: return "theme_light"
        case .dark: return "theme_dark"
        }
    }
}

/// 现在的外观设置。`read` / `write` 是这台设备上的存储（App 里是 UserDefaults）；
/// 读不到或读到不认识的值按"跟随系统"（网页 readThemePreference）；存不进去时 `save` 返回 false、显示的外观不变。
@MainActor
@Observable
final class AppThemeStore {
    private(set) var preference: ThemePreference

    @ObservationIgnored private let write: (String) throws -> Bool

    init(read: () throws -> String?, write: @escaping (String) throws -> Bool) {
        self.preference = ThemePreference.parse(try? read()) ?? .system
        self.write = write
    }

    @discardableResult
    func save(_ next: ThemePreference) -> Bool {
        guard (try? write(next.rawValue)) == true else { return false }
        preference = next
        return true
    }
}
