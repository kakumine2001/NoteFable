import Foundation

/// 聊天 ViewModel 里的一个后台任务（Kotlin 协程的 Job）：Swift 的 Task 问不出"还在不在跑"，这里自己记。
/// 只在主线程上用。
@MainActor
final class ChatJob {
    private(set) var isCompleted = false
    private(set) var isCancelled = false
    private var task: Task<Void, Never>?
    /// 在 [join] 里等着的调用方；任务结束或调用方自己被取消时放行。
    private var waiters: [Int: CheckedContinuation<Void, Never>] = [:]
    private var nextWaiter = 0

    init() {}

    /// 还没结束、也没被取消（Kotlin 的 isActive：取消后收尾期间已经是 false）。
    var isActive: Bool { !isCompleted && !isCancelled }

    /// 开始执行。任务体总是晚一拍才跑（不会在这里同步执行），所以可以先登记再启动。
    /// `skipIfCancelled`：还没开始就被取消时不执行任务体（Kotlin 的协程也是这样）；要收尾的任务传 false。
    func start(skipIfCancelled: Bool = true, _ body: @escaping @MainActor () async -> Void) {
        task = Task { @MainActor in
            if !(skipIfCancelled && self.isCancelled) { await body() }
            self.isCompleted = true
            let waiting = self.waiters.values
            self.waiters = [:]
            waiting.forEach { $0.resume() }
        }
    }

    func cancel() {
        isCancelled = true
        task?.cancel()
    }

    /// 等任务结束（被取消的也等它收尾完）。
    /// 和 Kotlin 的 Job.join() 一样，等的一方自己被取消时马上返回（不取消这个任务）：`await task.value` 不理会
    /// 调用方的取消，停止键会被一个卡住的请求拖住。返回后调用方自己查 `Task.isCancelled`。
    func join() async {
        if task == nil || isCompleted { return }
        nextWaiter += 1
        let id = nextWaiter
        await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                if isCompleted || Task.isCancelled {
                    continuation.resume()
                } else {
                    waiters[id] = continuation
                }
            }
        } onCancel: {
            Task { @MainActor in self.waiters.removeValue(forKey: id)?.resume() }
        }
    }

    @discardableResult
    static func launch(_ body: @escaping @MainActor () async -> Void) -> ChatJob {
        let job = ChatJob()
        job.start(body)
        return job
    }
}
