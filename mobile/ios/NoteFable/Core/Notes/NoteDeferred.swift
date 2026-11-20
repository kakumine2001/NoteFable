import Foundation

/// 只完成一次的结果（Kotlin 的 CompletableDeferred）：先完成的值算数，之后的 [complete] 不起作用；
/// [wait] 等到完成为止（已经完成就马上返回）。用锁保护，任何线程都能完成。
final class NoteDeferred<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value?
    private var waiters: [CheckedContinuation<Value, Never>] = []

    init() {}

    /// 返回这一次是不是真的完成了它（false：早就完成过）。
    @discardableResult
    func complete(_ result: Value) -> Bool {
        let woken: [CheckedContinuation<Value, Never>]? = lock.withLock {
            if value != nil { return nil }
            value = result
            defer { waiters = [] }
            return waiters
        }
        guard let woken else { return false }
        for continuation in woken { continuation.resume(returning: result) }
        return true
    }

    func wait() async -> Value {
        await withCheckedContinuation { (continuation: CheckedContinuation<Value, Never>) in
            let ready: Value? = lock.withLock {
                if let value { return value }
                waiters.append(continuation)
                return nil
            }
            if let ready { continuation.resume(returning: ready) }
        }
    }
}
