import Foundation

/// 身份确定之前只放一个请求过去。
///
/// 匿名身份（`notefable_device` Cookie）由第一个到达服务端的请求签发。App 刚启动、或刚登录 / 退出时，
/// 聊天、笔记、账号几个请求同时发出的话，服务端会各签发一个身份，后到的 Cookie 盖掉先到的，前面那个身份下建的东西就读不回来了。
/// 所以在身份"未确定"时，第一个请求单独走，其它请求等它拿到响应头（Set-Cookie 已经存进 Cookie 存储）再走；
/// 之后身份确定，请求并行。登录、退出时 [reset]，下一个请求又单独走。
///
/// 装在 [NoteFableHttp] 的请求流程里（对应 Android 的 OkHttp 拦截器 IdentityGate.kt），聊天、笔记、账号、附件图片、
/// 笔记文件下载都经过它。只拦本站的请求。
final class IdentityGate: @unchecked Sendable {
    /// 不读也不签发身份的接口：不排队，也不能把身份标成已确定。
    /// 否则启动时最先发出的 /api/models 一回来闸门就开了，后面的会话、账号请求又会各拿一个新身份。
    static let IDENTITY_FREE_PATHS: Set<String> = ["/api/models"]

    private let host: String
    private let lock = NSLock()
    private var settled = false
    /// 每次 [reset] 加一。重置前就发出去的那个"单独走"的请求回来时，不能把新身份标成已确定。
    private var epoch = 0
    /// 有一个请求正在单独走。
    private var running = false
    private var waiters: [(id: UInt64, continuation: CheckedContinuation<Void, Never>)] = []
    private var nextWaiter: UInt64 = 0

    init(host: String) {
        self.host = host.lowercased()
    }

    /// 身份变了（登录、退出）：下一个请求重新单独走。不挂起，可以在主线程上直接调。
    func reset() {
        lock.withLock {
            epoch += 1
            settled = false
        }
    }

    var isSettled: Bool { lock.withLock { settled } }

    /// 经过闸门执行一次请求。[operation] 正常返回＝拿到了响应（不论状态码），这时 Set-Cookie 已经处理完；
    /// 抛出＝网络错误或被取消，没有 Cookie，身份仍未确定，下一个请求再单独走。
    func run<T>(for url: URL, _ operation: () async throws -> T) async throws -> T {
        guard applies(to: url), let started = try await enter() else { return try await operation() }
        do {
            let result = try await operation()
            leave(started: started, gotResponse: true)
            return result
        } catch {
            leave(started: started, gotResponse: false)
            throw error
        }
    }

    private func applies(to url: URL) -> Bool {
        url.host?.lowercased() == host && !Self.IDENTITY_FREE_PATHS.contains(url.path)
    }

    private enum Decision {
        case parallel
        case alone(epoch: Int)
        case wait
    }

    /// 返回 nil：身份已确定，直接走。返回数字：轮到这个请求单独走（数字是出发时的 epoch）。
    private func enter() async throws -> Int? {
        while true {
            if Task.isCancelled {
                // 被叫醒的正好是已取消的任务：把这一轮让给下一个，不然其它等着的请求没人叫。
                wakeNextIfIdle()
                throw CancellationError()
            }
            let decision: Decision = lock.withLock {
                if settled { return .parallel }
                if running { return .wait }
                running = true
                return .alone(epoch: epoch)
            }
            switch decision {
            case .parallel: return nil
            case .alone(let epoch): return epoch
            case .wait: await waitForTurn()
            }
        }
    }

    /// 等前面那个请求结束（或身份确定、或自己被取消）。醒来后由 [enter] 重新判断。
    private func waitForTurn() async {
        let id: UInt64 = lock.withLock {
            nextWaiter += 1
            return nextWaiter
        }
        await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                let resumeNow: Bool = lock.withLock {
                    // 登记之前前一个请求可能已经结束，或者这个任务已经被取消（onCancel 找不到它）。
                    if settled || !running || Task.isCancelled { return true }
                    waiters.append((id, continuation))
                    return false
                }
                if resumeNow { continuation.resume() }
            }
        } onCancel: {
            let continuation: CheckedContinuation<Void, Never>? = lock.withLock {
                guard let index = waiters.firstIndex(where: { $0.id == id }) else { return nil }
                return waiters.remove(at: index).continuation
            }
            continuation?.resume()
        }
    }

    private func wakeNextIfIdle() {
        let next: CheckedContinuation<Void, Never>? = lock.withLock {
            guard !running, !settled, !waiters.isEmpty else { return nil }
            return waiters.removeFirst().continuation
        }
        next?.resume()
    }

    private func leave(started: Int, gotResponse: Bool) {
        let woken: [CheckedContinuation<Void, Never>] = lock.withLock {
            running = false
            if gotResponse && epoch == started { settled = true }
            if settled {
                // 身份确定了：等着的请求一起走。
                let all = waiters.map(\.continuation)
                waiters.removeAll()
                return all
            }
            // 还没确定（网络错误，或期间换了身份）：只叫醒一个，让它单独走。
            return waiters.isEmpty ? [] : [waiters.removeFirst().continuation]
        }
        for continuation in woken { continuation.resume() }
    }
}
