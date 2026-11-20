import Foundation

/// 聊天图标的保存（网页 src/lib/session-icon-sync.ts、Android `ui/SessionIconSync.kt` 的移植，行为相同）：
/// - 每个聊天的保存排队进行，连点几次只把最后一次选的发出去；
/// - 先在界面上显示，保存失败时退回最后一次保存成功的值并报错；
/// - 列表刷新时，把刷新开始后改过（或还在保存）的图标盖回去，免得旧列表把刚选的图标冲掉。
/// 只在主线程里用，不需要加锁。
@MainActor
final class SessionIconSync {
    private final class Edit {
        var desired: String?
        var confirmed: String?
        var running = false
        var seq = 0

        init(desired: String?, confirmed: String?) {
            self.desired = desired
            self.confirmed = confirmed
        }
    }

    private let send: @MainActor (_ sessionId: String, _ icon: String?) async -> Bool
    private var seq = 0
    private var edits: [String: Edit] = [:]

    init(_ send: @escaping @MainActor (_ sessionId: String, _ icon: String?) async -> Bool) {
        self.send = send
    }

    /// 开始读列表之前调用；把返回值交给 `reconcile`。
    func mark() -> Int { seq }

    func reconcile(_ sessions: [SessionSummary], startedAt: Int) -> [SessionSummary] {
        sessions.map { session in
            guard let edit = edits[session.id], edit.running || edit.seq > startedAt else { return session }
            var patched = session
            patched.icon = edit.running ? edit.desired : edit.confirmed
            return patched
        }
    }

    /// `current` 是界面上现在的图标。`show` 把值显示出来；保存失败时先退回再调用 `fail`。
    func change(
        _ sessionId: String,
        _ icon: String?,
        current: String?,
        show: @MainActor (String?) -> Void,
        fail: @MainActor () -> Void
    ) async {
        let edit: Edit
        if let existing = edits[sessionId] {
            edit = existing
        } else {
            edit = Edit(desired: icon, confirmed: current)
            edits[sessionId] = edit
        }
        if !edit.running { edit.confirmed = current }
        edit.desired = icon
        seq += 1
        edit.seq = seq
        show(icon)
        if edit.running { return }

        edit.running = true
        while edit.desired != edit.confirmed {
            let sending = edit.desired
            if await send(sessionId, sending) {
                edit.confirmed = sending
            } else {
                edit.desired = edit.confirmed
                show(edit.confirmed)
                fail()
                break
            }
        }
        edit.running = false
        seq += 1
        edit.seq = seq
    }
}
