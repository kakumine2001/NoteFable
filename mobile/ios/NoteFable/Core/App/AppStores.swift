import Foundation

// AppEnvironment 用到的几个小实现：存在本机的草稿、图片的内存缓存、Google 登录的接口。

/// 草稿和引用存在 UserDefaults（Android 的 SavedStateHandle）：App 在后台被系统回收后回来仍在。
/// 空字符串和 nil 一样当作没有，直接删掉键。
final class UserDefaultsChatSavedState: ChatSavedState {
    private let defaults: UserDefaults
    private let draftKey = "chat.draft"
    private let quoteKey = "chat.quote"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var draft: String? {
        get { defaults.string(forKey: draftKey) }
        set { store(newValue, draftKey) }
    }

    var quote: String? {
        get { defaults.string(forKey: quoteKey) }
        set { store(newValue, quoteKey) }
    }

    private func store(_ value: String?, _ key: String) {
        if let value, !value.isEmpty { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
}

/// 设置里选的图标存在 UserDefaults（Android 的 SharedPreferences "app_icon" 的 icon）。
enum AppIconDefaults {
    static let key = "app_icon.icon"

    @MainActor
    static func store(_ defaults: UserDefaults) -> AppIconStore {
        AppIconStore(
            read: { defaults.string(forKey: key) },
            write: { icon in
                if let icon { defaults.set(icon, forKey: key) } else { defaults.removeObject(forKey: key) }
                return true
            }
        )
    }
}

/// 按地址存的字节（附件图片），最近用过的留着：超过条数或总字节数时丢掉最久没用的。
/// 只在内存里，换身份时整个清掉（图片按归属校验，别的身份读不到）。
struct DataCache {
    private var entries: [String: Data] = [:]
    /// 用过的先后，最近的在最后。
    private var order: [String] = []
    private(set) var totalBytes = 0
    let maxEntries: Int
    let maxBytes: Int

    init(maxEntries: Int = 96, maxBytes: Int = 48 * 1024 * 1024) {
        self.maxEntries = maxEntries
        self.maxBytes = maxBytes
    }

    var count: Int { entries.count }

    mutating func get(_ key: String) -> Data? {
        guard let data = entries[key] else { return nil }
        touch(key)
        return data
    }

    mutating func put(_ key: String, _ data: Data) {
        // 单个就超过上限的不存（存了也会把别的全挤掉）。
        guard data.count <= maxBytes else { return }
        if let old = entries[key] { totalBytes -= old.count }
        entries[key] = data
        totalBytes += data.count
        touch(key)
        while entries.count > maxEntries || totalBytes > maxBytes, let oldest = order.first {
            order.removeFirst()
            if let dropped = entries.removeValue(forKey: oldest) { totalBytes -= dropped.count }
        }
    }

    mutating func removeAll() {
        entries.removeAll()
        order.removeAll()
        totalBytes = 0
    }

    private mutating func touch(_ key: String) {
        if let index = order.firstIndex(of: key) { order.remove(at: index) }
        order.append(key)
    }
}

/// 界面层接上的 Google 登录（GoogleSignIn SDK 在界面层，Core 不依赖它）。AccountViewModel 在界面之前建好，
/// 所以它拿到的是经过这里转一道的闭包。
@MainActor
final class GoogleSignInSeam {
    var requestIdToken: AccountViewModel.GoogleIdTokenRequest?
    var clearDeviceChoice: (@MainActor () async -> Void)?

    init() {}
}

/// 安装包配了 Google 客户端 ID，但界面层还没接上取令牌的方法（不该发生）：这次登录算失败。
struct GoogleSignInUnavailable: Error, Equatable, Sendable {}
