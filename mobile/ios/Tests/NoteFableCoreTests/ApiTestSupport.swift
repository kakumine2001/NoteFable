import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

// 接口测试共用的东西：假的传输层（Android 那边用 MockWebServer）、一次性的信号、multipart 的拆解。

/// 记录请求、按顺序回放应答的传输层。[handler] 不为空时由它决定每个请求的应答（像真的服务端那样看请求内容）。
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply: Sendable {
        var status = 200
        var headers: [String: String] = [:]
        var body = Data()
        /// 流式响应的分块；nil 时整个 body 作为一块。
        var chunks: [Data]? = nil
        /// 不回应答，直接抛这个错（网络错误）。
        var error: Error? = nil

        init(_ body: String = "", status: Int = 200, headers: [String: String] = [:], chunks: [Data]? = nil, error: Error? = nil) {
            self.body = Data(body.utf8)
            self.status = status
            self.headers = headers
            self.chunks = chunks
            self.error = error
        }
    }

    struct Recorded: Sendable {
        let request: HTTPRequest
        let body: Data

        var method: String { request.method }

        /// 路径加查询串，都是发出去时的编码（MockWebServer 的 RecordedRequest.path）。
        var path: String {
            let components = URLComponents(url: request.url, resolvingAgainstBaseURL: true)
            let query = components?.percentEncodedQuery.map { "?" + $0 } ?? ""
            return (components?.percentEncodedPath ?? "") + query
        }

        func header(_ name: String) -> String? { request.header(name) }
        var bodyText: String { String(decoding: body, as: UTF8.self) }
        var json: JSONValue? { JSONValue.parse(body) }
        /// 请求体是 JSON 对象时的键。
        var jsonKeys: Set<String> { Set(json?.objectValue?.keys.map { $0 } ?? []) }
    }

    private let lock = NSLock()
    private var replies: [Reply] = []
    private var recorded: [Recorded] = []
    private var taken = 0
    private var handler: (@Sendable (Recorded) async throws -> Reply)?

    func enqueue(_ body: String = "", status: Int = 200, headers: [String: String] = [:]) {
        enqueue(Reply(body, status: status, headers: headers))
    }

    func enqueue(_ reply: Reply) {
        lock.withLock { replies.append(reply) }
    }

    func respond(with handler: @escaping @Sendable (Recorded) async throws -> Reply) {
        lock.withLock { self.handler = handler }
    }

    var requestCount: Int { lock.withLock { recorded.count } }

    /// 下一个还没看过的请求（MockWebServer 的 takeRequest）。
    func next(file: StaticString = #filePath, line: UInt = #line) -> Recorded {
        let found: Recorded? = lock.withLock {
            guard taken < recorded.count else { return nil }
            taken += 1
            return recorded[taken - 1]
        }
        guard let found else {
            XCTFail("no more recorded requests", file: file, line: line)
            return Recorded(request: HTTPRequest(url: URL(string: "https://missing.invalid/")!), body: Data())
        }
        return found
    }

    func send(_ request: HTTPRequest) async throws -> (Data, HTTPURLResponse) {
        let reply = try await reply(to: request)
        return (reply.body, Self.response(for: request, reply))
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        let reply = try await reply(to: request)
        let chunks = reply.chunks ?? (reply.body.isEmpty ? [] : [reply.body])
        let body = AsyncThrowingStream<Data, Error> { continuation in
            for chunk in chunks { continuation.yield(chunk) }
            continuation.finish()
        }
        return HTTPStreamResponse(response: Self.response(for: request, reply), body: body)
    }

    func upload(
        _ request: HTTPRequest,
        onProgress: @escaping @Sendable (_ sent: Int64, _ total: Int64) -> Void
    ) async throws -> (Data, HTTPURLResponse) {
        let total = Int64(Self.bytes(of: request.body).count)
        onProgress(total / 2, total)
        onProgress(total / 2, total)
        onProgress(total, total)
        let reply = try await reply(to: request)
        return (reply.body, Self.response(for: request, reply))
    }

    private func reply(to request: HTTPRequest) async throws -> Reply {
        try Task.checkCancellation()
        let record = Recorded(request: request, body: Self.bytes(of: request.body))
        let (dynamic, queued): ((@Sendable (Recorded) async throws -> Reply)?, Reply?) = lock.withLock {
            recorded.append(record)
            if let handler = self.handler { return (handler, nil) }
            return (nil, replies.isEmpty ? nil : replies.removeFirst())
        }
        if let dynamic { return try await dynamic(record) }
        guard let queued else { throw URLError(.resourceUnavailable) }
        if let error = queued.error { throw error }
        return queued
    }

    private static func bytes(of body: HTTPBody?) -> Data {
        switch body {
        case nil: return Data()
        case .data(let data): return data
        case .file(let url): return (try? Data(contentsOf: url)) ?? Data()
        }
    }

    private static func response(for request: HTTPRequest, _ reply: Reply) -> HTTPURLResponse {
        HTTPURLResponse(url: request.url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
    }
}

let testBaseUrl = "https://notefable.test"

func makeApi(
    _ transport: HTTPTransport,
    cookies: CookieStore = MemoryCookieStore(),
    baseUrl: String = testBaseUrl,
    acceptLanguage: @escaping @Sendable () -> String = { "en" },
    openFile: @escaping @Sendable (String) throws -> HTTPBody = { _ in throw URLError(.fileDoesNotExist) }
) -> NoteFableApi {
    NoteFableApi(baseUrl: baseUrl, cookieStore: cookies, transport: transport, acceptLanguage: acceptLanguage, openFile: openFile)
}

/// 一次性的信号：`wait()` 等到有人 `signal()`（Kotlin 测试里的 CompletableDeferred<Unit> / CountDownLatch）。
final class AsyncSignal: @unchecked Sendable {
    private let lock = NSLock()
    private var fired = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func signal() {
        let woken: [CheckedContinuation<Void, Never>] = lock.withLock {
            fired = true
            defer { waiters = [] }
            return waiters
        }
        for continuation in woken { continuation.resume() }
    }

    func wait() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let resumeNow: Bool = lock.withLock {
                if fired { return true }
                waiters.append(continuation)
                return false
            }
            if resumeNow { continuation.resume() }
        }
    }
}

/// 把 multipart/form-data 的请求体拆开（只为断言用，不是通用的解析器）。
struct MultipartParts {
    struct Part {
        let name: String
        let filename: String?
        let contentType: String?
        let data: Data
        var text: String { String(decoding: data, as: UTF8.self) }
    }

    let parts: [Part]

    init(_ recorded: FakeTransport.Recorded) {
        self.init(contentType: recorded.header("Content-Type") ?? "", body: recorded.body)
    }

    init(contentType: String, body: Data) {
        guard let boundary = contentType.components(separatedBy: "boundary=").dropFirst().first else {
            parts = []
            return
        }
        // 按 latin1 当文本切，再转回字节：正文里的任意字节都不会丢。
        let text = String(decoding: body.map { UInt16($0) }, as: UTF16.self)
        var found: [Part] = []
        for section in text.components(separatedBy: "--" + boundary).dropFirst() {
            if section.hasPrefix("--") { break }
            guard let split = section.range(of: "\r\n\r\n") else { continue }
            let head = String(section[..<split.lowerBound])
            var content = String(section[split.upperBound...])
            if content.hasSuffix("\r\n") { content = String(content.unicodeScalars.dropLast(2).map(Character.init)) }
            let name = Self.attribute("name", in: head) ?? ""
            let type = head.components(separatedBy: "\r\n").first { $0.lowercased().hasPrefix("content-type:") }
                .map { String($0.dropFirst("content-type:".count)).trimmingCharacters(in: .whitespaces) }
            found.append(Part(
                name: name, filename: Self.attribute("filename", in: head), contentType: type,
                data: Data(content.unicodeScalars.map { UInt8(truncatingIfNeeded: $0.value) })
            ))
        }
        parts = found
    }

    var names: [String] { parts.map(\.name) }

    func text(_ name: String) -> String? {
        parts.first { $0.name == name }?.text
    }

    private static func attribute(_ name: String, in head: String) -> String? {
        guard let start = head.range(of: " \(name)=\"") else { return nil }
        let rest = head[start.upperBound...]
        guard let end = rest.firstIndex(of: "\"") else { return nil }
        return String(rest[..<end])
    }
}

extension XCTestCase {
    /// 等 [operation] 抛错并把错误交回来（Kotlin 测试里的 runCatching { … }.exceptionOrNull()）。
    func errorThrown<T>(
        _ operation: @autoclosure () async throws -> T,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async -> Error? {
        do {
            _ = try await operation()
            XCTFail("expected an error", file: file, line: line)
            return nil
        } catch {
            return error
        }
    }
}
