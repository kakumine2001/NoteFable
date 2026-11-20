import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(Glibc)
import Glibc
#elseif canImport(Darwin)
import Darwin
#endif
@testable import NoteFableCore

// 正式的传输层（URLSession + delegate）对着本机的一个小 HTTP 服务器跑：没有 Mac 能跑 App，
// 至少在 Linux 上确认回调的接法（响应头、分块、进度、取消、总时限、不跟重定向）是对的。
final class URLSessionTransportTests: XCTestCase {
    private var server: LocalHTTPServer!
    private var transport: URLSessionTransport!

    override func tearDown() {
        transport?.invalidate()
        server?.stop()
        super.tearDown()
    }

    private func start(_ handler: @escaping @Sendable (LocalHTTPServer.Request) -> LocalHTTPServer.Reply) throws {
        server = try LocalHTTPServer(handler: handler)
        transport = URLSessionTransport()
    }

    private func url(_ path: String) -> URL {
        URL(string: "http://127.0.0.1:\(server.port)\(path)")!
    }

    func testSendsTheRequestAndReturnsStatusHeadersAndBody() async throws {
        let seen = Collected<LocalHTTPServer.Request>()
        try start { request in
            seen.add(request)
            return .full(status: 404, headers: ["X-Session-Id": "s1", "Content-Type": "application/json"], body: Data(#"{"error":"nope"}"#.utf8))
        }
        var request = HTTPRequest(method: "PATCH", url: url("/api/x?y=1"), body: .data(Data(#"{"a":1}"#.utf8)))
        request.setHeader("Content-Type", "application/json")
        request.setHeader("User-Agent", "NoteFableNative/0.1 (iOS)")
        request.setHeader("Cookie", "notefable_device=me")
        let (data, response) = try await transport.send(request)
        XCTAssertEqual(response.statusCode, 404)
        XCTAssertEqual(response.header("x-session-id"), "s1")
        XCTAssertEqual(String(decoding: data, as: UTF8.self), #"{"error":"nope"}"#)
        let received = try XCTUnwrap(seen.values.first)
        XCTAssertEqual(received.method, "PATCH")
        XCTAssertEqual(received.path, "/api/x?y=1")
        XCTAssertEqual(received.headers["user-agent"], "NoteFableNative/0.1 (iOS)")
        XCTAssertEqual(received.headers["cookie"], "notefable_device=me")
        XCTAssertEqual(received.headers["content-type"], "application/json")
        XCTAssertEqual(String(decoding: received.body, as: UTF8.self), #"{"a":1}"#)
    }

    func testRedirectsAreHandedBackNotFollowedAndNoCookieIsKeptByTheSession() async throws {
        let seen = Collected<LocalHTTPServer.Request>()
        try start { request in
            seen.add(request)
            if request.path == "/go" {
                return .full(status: 302, headers: ["Location": "/there", "Set-Cookie": "a=1; Path=/"], body: Data())
            }
            return .full(status: 200, headers: [:], body: Data("ok".utf8))
        }
        let (_, response) = try await transport.send(HTTPRequest(url: url("/go")))
        XCTAssertEqual(response.statusCode, 302)
        XCTAssertEqual(response.header("Location"), "/there")
        XCTAssertEqual(response.header("Set-Cookie"), "a=1; Path=/")
        let stream = try await transport.stream(HTTPRequest(url: url("/go")))
        XCTAssertEqual(stream.response.statusCode, 302)
        _ = try await transport.send(HTTPRequest(url: url("/after")))
        XCTAssertEqual(seen.values.map(\.path), ["/go", "/go", "/after"])
        // URLSession 自己不存、不发 Cookie：身份只在 App 的 CookieStore 里。
        XCTAssertNil(seen.values.last?.headers["cookie"])
    }

    func testTheWholePipelineKeepsTheIdentityCookieAndFollowsRedirectsItself() async throws {
        let seen = Collected<LocalHTTPServer.Request>()
        try start { request in
            seen.add(request)
            switch request.path {
            case "/api/sessions":
                return .full(status: 200, headers: ["Set-Cookie": "notefable_device=d1; Path=/; HttpOnly"], body: Data(#"{"sessions":[]}"#.utf8))
            case "/api/attachments/a/image":
                return .full(status: 307, headers: ["Location": "/blob/a.png"], body: Data())
            default:
                return .full(status: 200, headers: ["Content-Type": "image/png"], body: Data("PNG".utf8))
            }
        }
        let jar = MemoryCookieStore()
        let api = makeApi(transport, cookies: jar, baseUrl: "http://127.0.0.1:\(server.port)")
        _ = try await api.sessions()
        let image = try await api.fetchData("/api/attachments/a/image")
        XCTAssertEqual(String(decoding: image.data, as: UTF8.self), "PNG")
        XCTAssertEqual(seen.values.map(\.path), ["/api/sessions", "/api/attachments/a/image", "/blob/a.png"])
        XCTAssertEqual(seen.values.map { $0.headers["cookie"] }, [nil, "notefable_device=d1", "notefable_device=d1"])
        XCTAssertEqual(seen.values.first?.headers["user-agent"], "NoteFableNative/0.1 (iOS)")
        XCTAssertEqual(seen.values.first?.headers["accept-language"], "en")
        XCTAssertTrue(api.identityGate.isSettled)
    }

    func testStreamedBodiesArriveChunkByChunkBeforeTheResponseEnds() async throws {
        let proceed = DispatchSemaphore(value: 0)
        try start { _ in
            .chunked(status: 200, headers: ["Content-Type": "text/event-stream", "X-Session-Id": "s7"], chunks: [
                Data("data: \"a\"\n\n".utf8), Data("data: \"b\"\n\n".utf8),
            ], between: { proceed.wait() })
        }
        let stream = try await transport.stream(HTTPRequest(method: "POST", url: url("/api/chat"), body: .data(Data("x".utf8)), timeout: .streaming))
        XCTAssertEqual(stream.response.header("X-Session-Id"), "s7")
        var iterator = stream.body.makeAsyncIterator()
        let first = try await iterator.next()
        // 第二块还卡在服务端：第一块已经到手。
        XCTAssertEqual(first.map { String(decoding: $0, as: UTF8.self) }, "data: \"a\"\n\n")
        proceed.signal()
        var rest = Data()
        while let chunk = try await iterator.next() { rest.append(chunk) }
        XCTAssertEqual(String(decoding: rest, as: UTF8.self), "data: \"b\"\n\n")
    }

    func testStreamChatReadsARealEventStream() async throws {
        try start { _ in
            .chunked(status: 200, headers: ["Content-Type": "text/event-stream", "X-Session-Id": "s8"], chunks: [
                Data("data: \"Hel".utf8), Data("lo\"\n\ndata: {\"activity\":{\"type\":\"web\",\"id\":\"w\"}}\n\ndata: [DONE]\n\n".utf8),
            ], between: {})
        }
        let api = makeApi(transport, baseUrl: "http://127.0.0.1:\(server.port)")
        var events: [ChatStreamEvent] = []
        for try await event in api.streamChat(ChatRequest(message: "hi")) { events.append(event) }
        XCTAssertEqual(events, [.started(sessionId: "s8"), .delta(text: "Hello"), .activity(payload: ["type": "web", "id": "w"])])
    }

    func testUploadsAFileAndReportsProgress() async throws {
        let seen = Collected<LocalHTTPServer.Request>()
        try start { request in
            seen.add(request)
            return .full(status: 200, headers: [:], body: Data("{}".utf8))
        }
        let bytes = Data((0..<300_000).map { UInt8(truncatingIfNeeded: $0) })
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("nf-upload-\(UUID().uuidString)")
        try bytes.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        var request = HTTPRequest(method: "PUT", url: url("/api/uploads/local?ticket=t"), body: .file(file), timeout: .upload)
        request.setHeader("Content-Type", "application/pdf")
        request.setHeader("x-content-length", "300000")
        let progress = Collected<Int64>()
        let (_, response) = try await transport.upload(request) { sent, _ in progress.add(sent) }
        XCTAssertEqual(response.statusCode, 200)
        let received = try XCTUnwrap(seen.values.first)
        XCTAssertEqual(received.method, "PUT")
        XCTAssertEqual(received.body, bytes)
        XCTAssertEqual(received.headers["content-type"], "application/pdf")
        XCTAssertEqual(received.headers["x-content-length"], "300000")
        XCTAssertEqual(progress.values.last, 300_000)
        XCTAssertEqual(progress.values, progress.values.sorted())
    }

    func testCancellingTheTaskCancelsTheRequest() async throws {
        let arrived = AsyncSignal()
        try start { _ in
            arrived.signal()
            return .hang
        }
        let transport = try XCTUnwrap(self.transport)
        let target = url("/slow")
        let task = Task { try await transport.send(HTTPRequest(url: target, timeout: .streaming)) }
        await arrived.wait()
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("expected cancellation")
        } catch {
            XCTAssertTrue(error is CancellationError, "\(error)")
        }
    }

    func testCancellingTheReaderEndsAStream() async throws {
        let proceed = DispatchSemaphore(value: 0)
        try start { _ in
            .chunked(status: 200, headers: [:], chunks: [Data("one".utf8), Data("two".utf8)], between: { proceed.wait() })
        }
        defer { proceed.signal() }
        let stream = try await transport.stream(HTTPRequest(url: url("/api/chat"), timeout: .streaming))
        let gotFirst = AsyncSignal()
        let reader = Task { () -> Int in
            var count = 0
            for try await _ in stream.body {
                count += 1
                gotFirst.signal()
            }
            return count
        }
        await gotFirst.wait()
        reader.cancel()
        let count = try await reader.value
        XCTAssertEqual(count, 1)
    }

    func testTheTotalTimeLimitEndsARequestThatNeverAnswers() async throws {
        try start { _ in .hang }
        do {
            _ = try await transport.send(HTTPRequest(url: url("/slow"), timeout: HTTPTimeout(idle: nil, total: 0.3)))
            XCTFail("expected a timeout")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .timedOut, "\(error)")
        }
    }

    func testAConnectionFailureIsANetworkErrorNotAnApiError() async throws {
        try start { _ in .hang }
        let closedPort = server.port
        server.stop()
        do {
            _ = try await transport.send(HTTPRequest(url: URL(string: "http://127.0.0.1:\(closedPort)/x")!))
            XCTFail("expected a failure")
        } catch {
            XCTAssertTrue(error is URLError, "\(error)")
        }
    }
}

/// 只够这些测试用的 HTTP/1.1 服务器：每个连接一个线程，读完一个请求、回一个应答就关。
final class LocalHTTPServer: @unchecked Sendable {
    struct Request: Sendable {
        let method: String
        let path: String
        /// 名字都是小写。
        let headers: [String: String]
        let body: Data
    }

    enum Reply {
        case full(status: Int, headers: [String: String], body: Data)
        /// 分块发；每两块之间先调 [between]（可以在里面等测试放行）。
        case chunked(status: Int, headers: [String: String], chunks: [Data], between: @Sendable () -> Void)
        /// 不回答，一直挂到对方断开。
        case hang
    }

    let port: Int
    private let listener: Int32
    private let handler: @Sendable (Request) -> Reply
    private let lock = NSLock()
    private var stopped = false

    init(handler: @escaping @Sendable (Request) -> Reply) throws {
        self.handler = handler
        #if canImport(Glibc)
        let streamType = Int32(SOCK_STREAM.rawValue)
        #else
        let streamType = SOCK_STREAM
        #endif
        let listener = socket(AF_INET, streamType, 0)
        self.listener = listener
        guard listener >= 0 else { throw URLError(.cannotConnectToHost) }
        var yes: Int32 = 1
        setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr.s_addr = UInt32(0x7f00_0001).bigEndian
        let size = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(listener, $0, size) } }
        guard bound == 0, listen(listener, 16) == 0 else { throw URLError(.cannotConnectToHost) }
        var actual = sockaddr_in()
        var actualSize = size
        _ = withUnsafeMutablePointer(to: &actual) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(listener, $0, &actualSize) } }
        port = Int(UInt16(bigEndian: actual.sin_port))
        let thread = Thread { [self] in acceptLoop() }
        thread.start()
    }

    func stop() {
        let already: Bool = lock.withLock {
            defer { stopped = true }
            return stopped
        }
        if already { return }
        shutdown(listener, Int32(SHUT_RDWR))
        close(listener)
    }

    private func acceptLoop() {
        while true {
            let connection = accept(listener, nil, nil)
            if connection < 0 { return }
            #if canImport(Darwin)
            var yes: Int32 = 1
            setsockopt(connection, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
            #endif
            let thread = Thread { [self] in
                serve(connection)
                close(connection)
            }
            thread.start()
        }
    }

    private func serve(_ connection: Int32) {
        var buffer = Data()
        var headerEnd: Range<Data.Index>?
        while headerEnd == nil {
            guard let more = receive(connection) else { return }
            buffer.append(more)
            headerEnd = buffer.range(of: Data("\r\n\r\n".utf8))
        }
        guard let headerEnd else { return }
        let lines = String(decoding: buffer[..<headerEnd.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
        let start = lines[0].components(separatedBy: " ")
        guard start.count >= 2 else { return }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        var body = Data(buffer[headerEnd.upperBound...])
        if headers["expect"]?.lowercased() == "100-continue" { write(connection, Data("HTTP/1.1 100 Continue\r\n\r\n".utf8)) }
        if headers["transfer-encoding"]?.lowercased().contains("chunked") == true {
            var decoded: Data?
            while true {
                decoded = Self.decodeChunked(body)
                if decoded != nil { break }
                guard let more = receive(connection) else { return }
                body.append(more)
            }
            body = decoded ?? Data()
        } else {
            let length = Int(headers["content-length"] ?? "") ?? 0
            while body.count < length {
                guard let more = receive(connection) else { return }
                body.append(more)
            }
        }

        switch handler(Request(method: start[0], path: start[1], headers: headers, body: body)) {
        case .full(let status, let replyHeaders, let replyBody):
            var head = "HTTP/1.1 \(status) Status\r\n"
            for (name, value) in replyHeaders { head += "\(name): \(value)\r\n" }
            head += "Content-Length: \(replyBody.count)\r\nConnection: close\r\n\r\n"
            write(connection, Data(head.utf8) + replyBody)
        case .chunked(let status, let replyHeaders, let chunks, let between):
            var head = "HTTP/1.1 \(status) Status\r\n"
            for (name, value) in replyHeaders { head += "\(name): \(value)\r\n" }
            head += "Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
            write(connection, Data(head.utf8))
            for (index, chunk) in chunks.enumerated() {
                if index > 0 { between() }
                write(connection, Data("\(String(chunk.count, radix: 16))\r\n".utf8) + chunk + Data("\r\n".utf8))
            }
            write(connection, Data("0\r\n\r\n".utf8))
        case .hang:
            while receive(connection) != nil {}
        }
    }

    /// 读一些字节；对方关了连接或出错时返回 nil。
    private func receive(_ connection: Int32) -> Data? {
        var bytes = [UInt8](repeating: 0, count: 64 * 1024)
        let count = recv(connection, &bytes, bytes.count, 0)
        return count > 0 ? Data(bytes[0..<count]) : nil
    }

    private func write(_ connection: Int32, _ data: Data) {
        #if canImport(Glibc)
        let flags = Int32(MSG_NOSIGNAL)
        #else
        let flags: Int32 = 0
        #endif
        data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let sent = send(connection, raw.baseAddress! + offset, raw.count - offset, flags)
                if sent <= 0 { return }
                offset += sent
            }
        }
    }

    /// 请求体是分块编码时把它拼回来；还没收全时返回 nil。
    private static func decodeChunked(_ data: Data) -> Data? {
        var out = Data()
        var rest = data[...]
        let crlf = Data("\r\n".utf8)
        while true {
            guard let lineEnd = rest.range(of: crlf) else { return nil }
            let sizeText = String(decoding: rest[..<lineEnd.lowerBound], as: UTF8.self).components(separatedBy: ";")[0]
            guard let size = Int(sizeText.trimmingCharacters(in: .whitespaces), radix: 16) else { return nil }
            let start = lineEnd.upperBound
            if size == 0 { return out }
            guard rest.endIndex - start >= size + 2 else { return nil }
            out.append(rest[start..<(start + size)])
            rest = rest[(start + size + 2)...]
        }
    }
}
