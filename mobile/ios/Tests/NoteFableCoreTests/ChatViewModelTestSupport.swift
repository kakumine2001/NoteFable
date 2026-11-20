import Foundation
import XCTest
@testable import NoteFableCore

// ChatViewModel 的测试共用的东西：虚拟时钟、可以等的值、假的事件流和假后端。
//
// Kotlin 测试用 StandardTestDispatcher 的虚拟时间（runCurrent / advanceTimeBy / advanceUntilIdle）。这里的对应：
// ViewModel、假后端、时钟都在主线程上，任务按排队的顺序跑；`runCurrent()` 让出主线程足够多次，等排着的任务都跑到下一个等待点，
// `advance(by:)` 按到点的先后叫醒 `sleep`。没有真的等待，结果只取决于代码里的顺序。

@MainActor
final class ChatTestClock {
    private struct Sleeper {
        let id: Int
        let deadline: Int
        let continuation: CheckedContinuation<Void, Error>
    }

    /// 虚拟的现在（毫秒）。
    private(set) var nowMs = 1_000_000
    private var sleepers: [Sleeper] = []
    private var nextId = 0

    func sleep(_ milliseconds: UInt64) async throws {
        try Task.checkCancellation()
        let id = nextId
        nextId += 1
        let deadline = nowMs + Int(milliseconds)
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if Task.isCancelled {
                    continuation.resume(throwing: CancellationError())
                } else {
                    sleepers.append(Sleeper(id: id, deadline: deadline, continuation: continuation))
                }
            }
        } onCancel: {
            Task { @MainActor in self.cancel(id) }
        }
    }

    private func cancel(_ id: Int) {
        guard let index = sleepers.firstIndex(where: { $0.id == id }) else { return }
        sleepers.remove(at: index).continuation.resume(throwing: CancellationError())
    }

    /// 让已经排上的任务都跑到下一个等待点（Kotlin 的 runCurrent）。
    func runCurrent() async {
        for _ in 0..<150 { await Task.yield() }
    }

    private func wakeNext(upTo limit: Int?) -> Bool {
        let due = sleepers.filter { limit == nil || $0.deadline <= limit! }
        guard let next = due.min(by: { ($0.deadline, $0.id) < ($1.deadline, $1.id) }) else { return false }
        sleepers.removeAll { $0.id == next.id }
        nowMs = max(nowMs, next.deadline)
        next.continuation.resume()
        return true
    }

    /// 往前拨 `milliseconds`，到点的 sleep 按时间先后叫醒，每叫醒一个都等它跑完（Kotlin 的 advanceTimeBy + runCurrent）。
    func advance(by milliseconds: Int) async {
        let target = nowMs + milliseconds
        await runCurrent()
        while wakeNext(upTo: target) { await runCurrent() }
        nowMs = target
    }

    /// 回答进行中只推进一小段虚拟时间（Kotlin 测试里的 settle）。
    func settle() async {
        await advance(by: 100)
    }

    /// 一直拨到没有任务在等时间（Kotlin 的 advanceUntilIdle）。
    func advanceUntilIdle(file: StaticString = #filePath, line: UInt = #line) async {
        await runCurrent()
        var woken = 0
        while wakeNext(upTo: nil) {
            await runCurrent()
            woken += 1
            if woken > 20_000 {
                XCTFail("advanceUntilIdle never became idle", file: file, line: line)
                return
            }
        }
    }
}

/// 之后才给出的值（Kotlin 测试里的 CompletableDeferred）。等它的任务被取消时抛 CancellationError，和协程一样。
@MainActor
final class ChatDeferred<Value: Sendable> {
    private var result: Result<Value, Error>?
    private var waiters: [Int: CheckedContinuation<Value, Error>] = [:]
    private var nextId = 0

    init() {}

    func complete(_ value: Value) {
        finish(.success(value))
    }

    func fail(_ error: Error) {
        finish(.failure(error))
    }

    private func finish(_ outcome: Result<Value, Error>) {
        guard result == nil else { return }
        result = outcome
        let waiting = waiters.values
        waiters = [:]
        for continuation in waiting { continuation.resume(with: outcome) }
    }

    func value() async throws -> Value {
        if let result { return try result.get() }
        try Task.checkCancellation()
        let id = nextId
        nextId += 1
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Value, Error>) in
                if Task.isCancelled {
                    continuation.resume(throwing: CancellationError())
                } else {
                    waiters[id] = continuation
                }
            }
        } onCancel: {
            Task { @MainActor in self.waiters.removeValue(forKey: id)?.resume(throwing: CancellationError()) }
        }
    }
}

extension ChatDeferred where Value == Void {
    func complete() {
        complete(())
    }
}

/// 假的事件流（Kotlin 测试里的 Channel(UNLIMITED) + receiveAsFlow）：没人读时先存着，读的人来了再给。
@MainActor
final class ChatEventChannel {
    private var buffer: [ChatStreamEvent] = []
    private var closed = false
    private var closeError: Error?
    private var readers: [AsyncThrowingStream<ChatStreamEvent, Error>.Continuation] = []

    init() {}

    func send(_ event: ChatStreamEvent) {
        while let reader = readers.first {
            if case .terminated = reader.yield(event) {
                readers.removeFirst()
                continue
            }
            return
        }
        buffer.append(event)
    }

    func close(_ error: Error? = nil) {
        closed = true
        closeError = error
        for reader in readers { reader.finish(throwing: error) }
        readers = []
    }

    func receiveAsStream() -> AsyncThrowingStream<ChatStreamEvent, Error> {
        let (stream, continuation) = AsyncThrowingStream.makeStream(of: ChatStreamEvent.self, throwing: Error.self)
        for event in buffer { continuation.yield(event) }
        buffer = []
        if closed {
            continuation.finish(throwing: closeError)
        } else {
            readers.append(continuation)
        }
        return stream
    }
}

/// 带文字的错误（Kotlin 测试里的 IOException("offline")）。
struct ChatTestError: LocalizedError, Equatable {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

final class ChatMemorySettings: SettingsStore {
    var modelId: String?
    var reasoning: String?

    init(modelId: String? = nil, reasoning: String? = nil) {
        self.modelId = modelId
        self.reasoning = reasoning
    }
}

/// 假后端：记下请求，行为由各个测试换掉对应的 handler。都在主线程上。
@MainActor
final class ChatFakeBackend: ChatBackend {
    // ---- 记下的调用 ----
    var requests: [ChatRequest] = []
    var imageRequests: [ChatRequest] = []
    var messageCalls: [String] = []
    var uploaded: [String] = []
    var discarded: [String] = []
    var stops: [String] = []
    var shown: [[String]] = []
    var branched: [[String]] = []
    /// 每个聊天请求各自的流，按发送顺序（`streamPerRequest` 时）。
    var streams: [ChatEventChannel] = []

    // ---- 行为 ----
    var sessionsHandler: @MainActor (_ call: Int) async throws -> [SessionSummary] = { _ in [] }
    var messagesHandler: (@MainActor (_ sessionId: String) async throws -> [MessageDto])?
    var models: ModelsResponse?
    /// `messagesHandler` 没设时，所有聊天读到的消息。
    var stored: [MessageDto] = []
    /// 设了以后按会话读，没有的会话是空的。
    var storedBySession: [String: [MessageDto]]?
    var messagesGate: ChatDeferred<Void>?
    var messagesError: Error?
    var events = ChatEventChannel()
    var streamPerRequest = false
    var streamError: Error?
    var streamHandler: (@MainActor (ChatRequest) -> AsyncThrowingStream<ChatStreamEvent, Error>)?
    var imageHandler: (@MainActor (ChatRequest) async throws -> ImageResult)?
    var imageResult = ImageResult(sessionId: "img-1", image: GeneratedImagePayload(dataUrl: "data:image/png;base64,AAAA"))
    var uploadHandler: (@MainActor () async throws -> Void)?
    var uploadError: Error?
    var stopAcknowledged = false
    var showError: Error?
    var baseUrl = "https://example.test"
    private var sessionsCalls = 0

    init(models: ModelsResponse? = nil) {
        self.models = models
    }

    func sessions() async throws -> [SessionSummary] {
        sessionsCalls += 1
        return try await sessionsHandler(sessionsCalls)
    }

    func messages(sessionId: String) async throws -> [MessageDto] {
        messageCalls.append(sessionId)
        if let messagesHandler { return try await messagesHandler(sessionId) }
        if let gate = messagesGate { try await gate.value() }
        if let error = messagesError { throw error }
        if let storedBySession { return storedBySession[sessionId] ?? [] }
        return stored
    }

    func models() async throws -> ModelsResponse {
        guard let models else { throw ChatTestError("404") }
        return models
    }

    nonisolated func absoluteUrl(_ path: String) -> String {
        MainActor.assumeIsolated { baseUrl + path }
    }

    nonisolated func streamChat(_ request: ChatRequest) -> AsyncThrowingStream<ChatStreamEvent, Error> {
        MainActor.assumeIsolated {
            requests.append(request)
            if let streamHandler { return streamHandler(request) }
            if let error = streamError {
                return AsyncThrowingStream { $0.finish(throwing: error) }
            }
            if streamPerRequest {
                let channel = ChatEventChannel()
                streams.append(channel)
                return channel.receiveAsStream()
            }
            return events.receiveAsStream()
        }
    }

    func generateImage(_ request: ChatRequest) async throws -> ImageResult {
        imageRequests.append(request)
        if let imageHandler { return try await imageHandler(request) }
        return imageResult
    }

    func prepareUploads(_ files: [LocalFile]) async throws -> UploadPlan {
        UploadPlan(uploads: files.indices.map { UploadSlot(path: "path-\($0)", ticket: "ticket-\($0)") }, mode: "local")
    }

    func uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: @escaping @Sendable (Int) -> Void) async throws {
        if let uploadHandler { try await uploadHandler() }
        if let error = uploadError { throw error }
        onProgress(50)
        uploaded.append(slot.ticket)
    }

    func discardUploads(_ tickets: [String]) async {
        discarded += tickets
    }

    func stopSession(sessionId: String) async throws {
        if !stopAcknowledged { throw ChatTestError("offline") }
        stops.append(sessionId)
    }

    func showVersion(sessionId: String, messageId: String) async throws {
        if let error = showError { throw error }
        shown.append([sessionId, messageId])
    }

    func branchSession(sessionId: String, messageId: String, title: String) async throws -> SessionSummary {
        branched.append([sessionId, messageId, title])
        return SessionSummary(id: "s2", title: title)
    }
}

@MainActor
func makeChatViewModel(
    _ backend: ChatBackend,
    clock: ChatTestClock,
    settings: SettingsStore = ChatMemorySettings(),
    bundledModels: @escaping () throws -> ModelsResponse? = { nil },
    savedState: ChatSavedState = MemoryChatSavedState(),
    saveIcon: @escaping @MainActor (String, String?) async -> Bool = { _, _ in false },
    onMessageIdChanged: @escaping @MainActor (String, String, String) -> Void = { _, _, _ in }
) -> ChatViewModel {
    ChatViewModel(
        backend: backend, settings: settings, flushIntervalMs: 10, bundledModels: bundledModels, savedState: savedState,
        saveIcon: saveIcon, onMessageIdChanged: onMessageIdChanged,
        sleep: { try await clock.sleep($0) }, now: { clock.nowMs }
    )
}

func chatDto(
    _ id: String,
    _ role: String,
    _ content: String,
    thinkingMs: Int? = nil,
    activity: String? = nil,
    proposals: String? = nil,
    pages: [ChatProjectNote] = [],
    versions: MessageVersions? = nil
) -> MessageDto {
    MessageDto(
        id: id, role: role, content: content, thinkingMs: thinkingMs,
        activity: activity.flatMap { JSONValue.parse($0) }, proposals: proposals.flatMap { JSONValue.parse($0) }, pages: pages, versions: versions
    )
}

func chatActivity(_ json: String) -> ChatStreamEvent {
    .activity(payload: JSONValue.parse(json) ?? .null)
}

func chatUsageLimit(_ message: String = "You've reached today's limit.", tier: String, kind: String = "chat") -> ApiException {
    ApiException(status: 429, message: message, code: ApiException.USAGE_LIMIT_CODE, tier: tier, kind: kind)
}
