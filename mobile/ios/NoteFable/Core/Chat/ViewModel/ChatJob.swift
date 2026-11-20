import Foundation

/// 聊天 ViewModel 里的一个后台任务（Kotlin 协程的 Job）：Swift 的 Task 问不出"还在不在跑"，这里自己记。
/// 只在主线程上用。
@MainActor
final class ChatJob {
    private(set) var isCompleted = false
    private(set) var isCancelled = false
    private var task: Task<Void, Never>?

    init() {}

    /// 还没结束、也没被取消（Kotlin 的 isActive：取消后收尾期间已经是 false）。
    var isActive: Bool { !isCompleted && !isCancelled }

    /// 开始执行。任务体总是晚一拍才跑（不会在这里同步执行），所以可以先登记再启动。
    /// `skipIfCancelled`：还没开始就被取消时不执行任务体（Kotlin 的协程也是这样）；要收尾的任务传 false。
    func start(skipIfCancelled: Bool = true, _ body: @escaping @MainActor () async -> Void) {
        task = Task { @MainActor in
            if !(skipIfCancelled && self.isCancelled) { await body() }
            self.isCompleted = true
        }
    }

    func cancel() {
        isCancelled = true
        task?.cancel()
    }

    /// 等任务结束（被取消的也等它收尾完）。
    func join() async {
        await task?.value
    }

    @discardableResult
    static func launch(_ body: @escaping @MainActor () async -> Void) -> ChatJob {
        let job = ChatJob()
        job.start(body)
        return job
    }
}
