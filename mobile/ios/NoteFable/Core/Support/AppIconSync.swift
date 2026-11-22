import Foundation

/// 账号上的图标（`GET / PUT /api/app-icon`）：读写的接口拆出来便于单元测试。
protocol AppIconBackend: Sendable {
    /// `GET /api/app-icon`：icon 和本机同形（nil / "character:<id>" / 图片 data URL），updatedAt 为 nil 表示账号上还没保存过。
    func accountAppIcon() async throws -> AppIconResponse

    /// `PUT /api/app-icon`：整体替换，nil 是默认角色 Quill。
    func saveAccountAppIcon(_ icon: String?) async throws -> AppIconResponse
}

/// 设置里的"图标"跟着账号走（网页 src/lib/app-icon-sync.ts，Android data/AppIconSync.kt）。只在登录时同步；
/// 未登录（访客）只存在这台设备上（[AppIconStore]）。
/// - [pull]：启动 / 登录后和打开设置时读账号上的值，有就以账号为准存到本机；账号上还没有、本机选过非默认的，就把本机的送上去一次。
/// - [push]：在设置里选了以后（已先存到本机）送到账号。按选的顺序一个一个送，旧的回复不会盖掉新的选择；读的途中又选了，读到的值就不用。
/// 离线时本机的值保持不变。
@MainActor
final class AppIconSync {
    /// 是否登录（AppEnvironment 跟着账号状态设）。
    var signedIn = false

    private let store: AppIconStore
    private let backend: AppIconBackend
    /// 本机选过的次数：判断读的途中有没有又选过，以及只把最后一次送的结果告诉界面。
    private var edits = 0
    /// 最后一个送出的请求：下一个等它送完再送。
    private var lastSend: Task<Bool, Never>?

    init(store: AppIconStore, backend: AppIconBackend) {
        self.store = store
        self.backend = backend
    }

    private func send(_ icon: String?) async -> Bool {
        let previous = lastSend
        let backend = self.backend
        let task = Task { () -> Bool in
            _ = await previous?.value
            do {
                _ = try await backend.saveAccountAppIcon(icon)
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

    /// 送设置里选的值。送不上（且之后没有再选）时返回 false，界面显示提示；未登录时什么都不做、返回 true。
    func push(_ icon: String?) async -> Bool {
        guard signedIn else { return true }
        edits += 1
        let mine = edits
        let ok = await send(icon)
        return ok || mine != edits
    }

    /// 读账号上的值并存到本机。读不到（离线、未登录）时保持本机的值。
    func pull() async {
        guard signedIn else { return }
        let before = edits
        // 还有没送完的选择，等它们送完再读。
        _ = await lastSend?.value
        guard let remote = try? await backend.accountAppIcon() else { return }
        guard signedIn, edits == before else { return }
        if let updatedAt = remote.updatedAt, !updatedAt.isEmpty {
            let icon = normalizeAppIcon(remote.icon)
            if icon != store.icon { store.save(icon) }
            return
        }
        // 账号上还没保存过：把这台设备的选择当作账号的第一个值。
        guard let local = store.icon else { return }
        _ = await send(local)
    }
}
