#if DEBUG
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Debug 截图 / fixture 模式用的离线传输层：所有请求在本地由 [FixtureCatalog] 回答，绝不发起真实网络请求。
/// 遵守 [HTTPTransport] 契约（不处理 Cookie / 重定向，取消时抛 `CancellationError`）。
final class FixtureTransport: HTTPTransport, @unchecked Sendable {
    struct Reply: Sendable {
        var status: Int = 200
        var headers: [String: String] = ["Content-Type": "application/json; charset=utf-8"]
        var body: Data = Data()
        /// 流式响应的分块；nil 时把非空 body 当成单块发出。
        var chunks: [Data]? = nil
        var chunkGap: Duration? = nil
        /// 为 true 时发完分块后保持流打开，直到读取方取消（用于 `chat-streaming` 截图场景）。
        var holdOpen: Bool = false

        init(
            status: Int = 200,
            headers: [String: String] = ["Content-Type": "application/json; charset=utf-8"],
            body: Data = Data(),
            chunks: [Data]? = nil,
            chunkGap: Duration? = nil,
            holdOpen: Bool = false
        ) {
            self.status = status
            self.headers = headers
            self.body = body
            self.chunks = chunks
            self.chunkGap = chunkGap
            self.holdOpen = holdOpen
        }
    }

    private let catalog: FixtureCatalog
    private let latency: Duration?
    private let onMiss: @Sendable (String) -> Void
    private let lock = NSLock()
    private var seen: [String] = []

    init(
        catalog: FixtureCatalog,
        latency: Duration? = nil,
        onMiss: @escaping @Sendable (String) -> Void = { _ in }
    ) {
        self.catalog = catalog
        self.latency = latency
        self.onMiss = onMiss
    }

    var requests: [String] {
        lock.withLock { seen }
    }

    func send(_ request: HTTPRequest) async throws -> (Data, HTTPURLResponse) {
        let reply = try await answer(request)
        return (reply.body, Self.head(request, reply))
    }

    func upload(
        _ request: HTTPRequest,
        onProgress: @escaping @Sendable (_ sent: Int64, _ total: Int64) -> Void
    ) async throws -> (Data, HTTPURLResponse) {
        let reply = try await answer(request)
        onProgress(1, 1)
        return (reply.body, Self.head(request, reply))
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        let reply = try await answer(request)
        let chunks = reply.chunks ?? (reply.body.isEmpty ? [] : [reply.body])
        let (body, continuation) = AsyncThrowingStream<Data, Error>.makeStream()
        let pump = Task {
            for chunk in chunks {
                if let gap = reply.chunkGap {
                    try? await Task.sleep(for: gap)
                }
                if Task.isCancelled { break }
                continuation.yield(chunk)
            }
            while reply.holdOpen && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
            }
            continuation.finish()
        }
        continuation.onTermination = { _ in pump.cancel() }
        return HTTPStreamResponse(response: Self.head(request, reply), body: body, cancel: { pump.cancel() })
    }

    private func answer(_ request: HTTPRequest) async throws -> Reply {
        try Task.checkCancellation()
        if let latency {
            try await Task.sleep(for: latency)
            try Task.checkCancellation()
        }
        let line = "\(request.method) \(request.url.path)"
        lock.withLock { seen.append(line) }
        if let reply = catalog.reply(to: request) {
            return reply
        }
        onMiss(line)
        return Reply(status: 404, body: Data(#"{"error":"No fixture for this request."}"#.utf8))
    }

    private static func head(_ request: HTTPRequest, _ reply: Reply) -> HTTPURLResponse {
        HTTPURLResponse(url: request.url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
    }
}
#endif
