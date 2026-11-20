import Foundation

/// 安装包里的配置（Android 的 BuildConfig）：Info.plist 的 `NoteFableBaseURL` / `NoteFableSiteURL` / `GIDClientID`，
/// 值来自 `Config/*.xcconfig`。没填（或读不到 Info.plist）时用正式环境的地址。
struct AppConfig: Equatable, Sendable {
    static let DEFAULT_BASE_URL = "https://app.notefable.com"
    static let DEFAULT_SITE_URL = "https://notefable.com"

    /// App 的服务器（`BuildConfig.BASE_URL`），末尾不带 `/`。
    let baseURL: String
    /// 官网（`BuildConfig.SITE_URL`：隐私政策、使用条款等页面），末尾不带 `/`。
    let siteURL: String
    /// Google 登录的 iOS 客户端 ID；没配时是 nil，登录窗口只有邮箱验证码。
    let googleIOSClientId: String?
    /// 版本号（`CFBundleShortVersionString`，Android 的 versionName）；读不到是空字符串。
    let appVersion: String
    /// 构建号（`CFBundleVersion`，Android 的 versionCode）；读不到是空字符串。
    let buildNumber: String

    init(baseURL: String, siteURL: String, googleIOSClientId: String? = nil, appVersion: String = "", buildNumber: String = "") {
        self.baseURL = Self.url(baseURL, default: Self.DEFAULT_BASE_URL)
        self.siteURL = Self.url(siteURL, default: Self.DEFAULT_SITE_URL)
        self.googleIOSClientId = googleIOSClientId.flatMap(Self.text)
        self.appVersion = appVersion
        self.buildNumber = buildNumber
    }

    /// - Parameter info: Info.plist 的内容；App 里是 `Bundle.main.infoDictionary`，测试里直接给字典。
    init(info: [String: Any]? = Bundle.main.infoDictionary) {
        func string(_ key: String) -> String? { (info?[key] as? String).flatMap(Self.text) }
        self.init(
            baseURL: string("NoteFableBaseURL") ?? "",
            siteURL: string("NoteFableSiteURL") ?? "",
            googleIOSClientId: string("GIDClientID"),
            appVersion: string("CFBundleShortVersionString") ?? "",
            buildNumber: string("CFBundleVersion") ?? ""
        )
    }

    /// 去掉首尾空白；空的、xcconfig 变量没展开的（`$(NAME)`）都算没填。
    private static func text(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty || value.hasPrefix("$(") ? nil : value
    }

    /// 地址末尾的 `/` 去掉（接口路径都以 `/` 开头）；没填用默认值。
    private static func url(_ raw: String, default fallback: String) -> String {
        guard var value = text(raw) else { return fallback }
        while value.hasSuffix("/") { value.removeLast() }
        return value.isEmpty ? fallback : value
    }
}
