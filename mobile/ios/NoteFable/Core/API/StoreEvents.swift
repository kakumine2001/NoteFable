import Foundation

/// App 级的 Store 往外发的一次性事件（Kotlin 端的 SharedFlow）：发出时在听的都收到，没人听就丢掉，不补发。
/// 每调一次 [stream] 多一个听的；那个流不再被读（任务取消、流被丢掉）时自动退出。
@MainActor
final class StoreEvents<Element: Sendable> {
    private var continuations: [Int: AsyncStream<Element>.Continuation] = [:]
    private var nextId = 0

    init() {}

    func stream() -> AsyncStream<Element> {
        let id = nextId
        nextId += 1
        let (stream, continuation) = AsyncStream<Element>.makeStream()
        continuations[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor in self?.continuations[id] = nil }
        }
        return stream
    }

    func emit(_ value: Element) {
        for continuation in continuations.values { continuation.yield(value) }
    }
}
