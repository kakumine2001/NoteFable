import Foundation

/// ViewModel 自己发起的后台任务（Android 的 viewModelScope.launch）。记着还没结束的任务，
/// 单元测试用 `idle()` 等它们全部结束（Kotlin 测试里的 advanceUntilIdle），不用真的等时间。
@MainActor
final class PendingWork {
    private var tasks: [Int: Task<Void, Never>] = [:]
    private var nextId = 0

    @discardableResult
    func launch(_ operation: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let id = nextId
        nextId += 1
        let task = Task { @MainActor [weak self] in
            await operation()
            self?.tasks[id] = nil
        }
        tasks[id] = task
        return task
    }

    /// 等到没有任务在跑（等的过程中新发起的也算）。
    func idle() async {
        while let task = tasks.values.first {
            await task.value
        }
    }

    func cancelAll() {
        for task in tasks.values { task.cancel() }
    }
}

/// 按发起的顺序一个一个执行的队列（Android 用公平的 Mutex：先到先得）。
/// 排队在调用的那一刻就定下来，不靠任务的启动顺序。
@MainActor
final class SerialWorkQueue {
    private var tail: Task<Void, Never>?

    /// 排到队尾，等轮到并做完后返回结果。调用方的任务被取消也照样做完（已经发出的保存不能半途丢掉）。
    func run<T: Sendable>(_ operation: @escaping @MainActor () async -> T) async -> T {
        let previous = tail
        let task = Task { @MainActor () -> T in
            await previous?.value
            return await operation()
        }
        tail = Task { @MainActor in _ = await task.value }
        return await task.value
    }

    /// 排到队尾，不等结果。
    @discardableResult
    func enqueue(_ operation: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = tail
        let task = Task { @MainActor in
            await previous?.value
            await operation()
        }
        tail = task
        return task
    }
}

/// Kotlin 的 `String.take(max)`（按 UTF-16 计，和网页输入框的 maxLength 相同），但不把一个表情（代理对）从中间切开。
func clipUtf16(_ text: String, _ max: Int) -> String {
    let units = text.utf16
    if units.count <= max { return text }
    guard max > 0 else { return "" }
    var end = max
    if UTF16.isLeadSurrogate(units[units.index(units.startIndex, offsetBy: max - 1)]) { end = max - 1 }
    return String(decoding: Array(units.prefix(end)), as: UTF16.self)
}
