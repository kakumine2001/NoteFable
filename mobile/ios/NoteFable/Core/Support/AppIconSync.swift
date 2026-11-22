import Foundation

/// 账号上的图标（`GET / PUT /api/app-icon`）：读写的接口拆出来便于单元测试。
protocol AppIconBackend: Sendable {
    /// `GET /api/app-icon`：icon 和本机同形（nil / "character:<id>" / 图片 data URL），updatedAt 为 nil 表示账号上还没保存过，
    /// account 是这个账号的不透明的键。
    func accountAppIcon() async throws -> AppIconResponse

    /// `PUT /api/app-icon`：整体替换，nil 是默认角色 Quill。
    func saveAccountAppIcon(_ icon: String?) async throws -> AppIconResponse
}

/// 和图标一起记在本机的两项（网页 localStorage 的 `notefable:app-icon-owner` / `notefable:app-icon-pending`，
/// Android SharedPreferences `app_icon` 的 owner / pending；App 里是 UserDefaults 的 `app_icon.owner` / `app_icon.pending`）。
/// - `owner`：本机的图标属于哪个账号（服务端给的 account 键）；未登录时选的为 nil。
/// - `pending`：登录时选的、还没送到账号。
@MainActor
protocol AppIconSyncMemory: AnyObject {
    var owner: String? { get set }
    var pending: Bool { get set }
}

/// 只在内存里的 [AppIconSyncMemory]（测试用）。
@MainActor
final class InMemoryAppIconSyncMemory: AppIconSyncMemory {
    var owner: String?
    var pending = false

    init() {}
}

/// 设置里的"图标"跟着账号走（网页 src/lib/app-icon-sync.ts，Android data/AppIconSync.kt，规则相同）。只在登录时同步；
/// 未登录（访客）只存在这台设备上（[AppIconStore]）。
/// - [pull]：启动 / 登录后和打开设置时读账号上的值，有就以账号为准存到本机；账号上还没有、本机选过非默认的，就把本机的送上去一次。
/// - [push]：在设置里选了以后（已先存到本机）送到账号。按选的顺序一个一个送，旧的回复不会盖掉新的选择；读的途中又选了，读到的值就不用。
/// 离线时本机的值保持不变。另外记着 [AppIconSyncMemory]：
/// - pending：选了但没送到时立着。立着时读到账号上的旧值也不覆盖本机，而是把本机的值再送一次（送不上就继续立着）。
/// - owner：本机的图标属于别的账号时，不把它送进现在的账号，而是恢复成默认（同一台设备换账号时不泄露前一个人的图片）。
/// 明确退出登录 / 删除账号时，属于账号的图标恢复成默认（[forgetAccount]）。
@MainActor
final class AppIconSync {
    /// 是否登录（AppEnvironment 跟着账号状态设）。
    var signedIn = false {
        didSet { if !signedIn { currentAccount = nil } }
    }

    private let store: AppIconStore
    private let backend: AppIconBackend
    private let memory: AppIconSyncMemory
    /// 现在登录的账号的键（这次启动后从服务端拿到的）；还不知道时为 nil。
    private var currentAccount: String?
    /// 本机选过的次数：判断读的途中有没有又选过，以及只把最后一次送的结果告诉界面。
    private var edits = 0
    /// 退出登录时加一：在那之前发出的请求回来后不再改 owner / pending。
    private var generation = 0
    /// 读的次数：读重叠时只用最后开始的那次的结果（先开始的读晚回来也不会把新值盖回去）。
    private var pulls = 0
    /// 最后一个送出的请求：下一个等它送完再送。
    private var lastSend: Task<Bool, Never>?

    init(store: AppIconStore, backend: AppIconBackend, memory: AppIconSyncMemory? = nil) {
        self.store = store
        self.backend = backend
        self.memory = memory ?? InMemoryAppIconSyncMemory()
    }

    private func remember(owner: String?, pending: Bool) {
        memory.owner = owner
        memory.pending = pending
    }

    /// 送一次。送到了就把 owner 设成这个账号、放下 pending。
    /// `markPending`（设置里选的值、pending 的重送）时先立起 pending，送不上就一直立着；第一次同步时送本机的值不立。
    private func send(_ icon: String?, markPending: Bool) async -> Bool {
        let previous = lastSend
        let backend = self.backend
        let task = Task { [weak self] () -> Bool in
            _ = await previous?.value
            guard let self else { return false }
            let mine = self.generation
            // 现在送的值是这个账号选的：owner 是现在的账号（键还不知道时为 nil，下次读到时送进这个账号）。
            if markPending { self.remember(owner: self.currentAccount ?? self.memory.owner, pending: true) } // 键还不知道时不清掉已记的 owner。
            do {
                let response = try await backend.saveAccountAppIcon(icon)
                let account = response.account.flatMap { $0.isEmpty ? nil : $0 }
                if let account { self.currentAccount = account }
                if mine == self.generation { self.remember(owner: account ?? self.currentAccount, pending: false) }
                return true
            } catch let error as ApiException {
                // 401 是途中退出了登录：本机已经存好了，不提示。
                return error.status == 401
            } catch {
                return false
            }
        }
        lastSend = task
        return await task.value
    }

    /// 送设置里选的值。送不上（且之后没有再选）时返回 false，界面显示提示；未登录时什么都不送（这个值不属于任何账号），返回 true。
    func push(_ icon: String?) async -> Bool {
        guard signedIn else {
            remember(owner: nil, pending: false)
            return true
        }
        edits += 1
        let mine = edits
        let ok = await send(icon, markPending: true)
        return ok || mine != edits
    }

    /// 读账号上的值并存到本机。读不到（离线、未登录）时保持本机的值。
    func pull() async {
        guard signedIn else { return }
        let before = edits
        let started = generation
        pulls += 1
        let mine = pulls
        // 还有没送完的选择，等它们送完再读。
        _ = await lastSend?.value
        guard let remote = try? await backend.accountAppIcon() else { return }
        guard signedIn, edits == before, generation == started, pulls == mine else { return }
        let account = remote.account.flatMap { $0.isEmpty ? nil : $0 }
        if let account { currentAccount = account }
        if let account, let owner = memory.owner, owner != account {
            // 本机的图标属于别的账号：不送进这个账号，先恢复成默认再往下走。
            store.save(nil)
            remember(owner: nil, pending: false)
        }
        if memory.pending {
            // 有还没送到的选择：不用账号上的旧值覆盖，把本机的值再送一次（送不上就继续等下次）。
            _ = await send(store.icon, markPending: true)
            return
        }
        if let updatedAt = remote.updatedAt, !updatedAt.isEmpty {
            let icon = normalizeAppIcon(remote.icon)
            if icon != store.icon { store.save(icon) }
            remember(owner: account, pending: false)
            return
        }
        // 账号上还没保存过：把这台设备的选择（未登录时选的，或这个账号的）当作账号的第一个值。
        guard let local = store.icon else { return }
        _ = await send(local, markPending: false)
    }

    /// 明确退出登录 / 删除账号后：本机的图标属于账号（有 owner 或还在 pending）就恢复成默认，不留给下一个用这台设备的人。
    func forgetAccount() {
        generation += 1
        signedIn = false
        if memory.owner != nil || memory.pending { store.save(nil) }
        remember(owner: nil, pending: false)
    }
}

/// [AppIconSyncMemory] 存在 UserDefaults（和图标的 `app_icon.icon` 放在一起）。
@MainActor
final class UserDefaultsAppIconSyncMemory: AppIconSyncMemory {
    static let ownerKey = "app_icon.owner"
    static let pendingKey = "app_icon.pending"

    private let defaults: UserDefaults

    init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    var owner: String? {
        get { defaults.string(forKey: Self.ownerKey) }
        set {
            if let newValue { defaults.set(newValue, forKey: Self.ownerKey) } else { defaults.removeObject(forKey: Self.ownerKey) }
        }
    }

    var pending: Bool {
        get { defaults.bool(forKey: Self.pendingKey) }
        set { defaults.set(newValue, forKey: Self.pendingKey) }
    }
}
