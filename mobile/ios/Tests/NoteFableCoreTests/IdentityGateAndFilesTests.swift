import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

final class IdentityGateAndFilesTests: XCTestCase {
    /// 像服务端一样：没带设备 Cookie 的请求各签发一个新身份。第一个请求故意慢，
    /// 没有闸门的话后面的请求会在它回来之前出发，拿到另一个身份。
    private final class IdentityServer: @unchecked Sendable {
        private let lock = NSLock()
        private var minted = 0
        private var devices: [String?] = []
        let firstArrived = AsyncSignal()
        let release = AsyncSignal()

        var seen: [String?] { lock.withLock { devices } }

        func handle(_ request: FakeTransport.Recorded) async -> FakeTransport.Reply {
            let device = request.header("Cookie")?.components(separatedBy: "; ")
                .first { $0.hasPrefix("notefable_device=") }.map { String($0.dropFirst("notefable_device=".count)) }
            var reply = FakeTransport.Reply(#"{"sessions":[],"pages":[],"groups":[]}"#)
            let id: String? = lock.withLock {
                devices.append(device)
                guard device == nil else { return nil }
                minted += 1
                return "d\(minted)"
            }
            guard let id else { return reply }
            if id == "d1" {
                firstArrived.signal()
                await release.wait()
            }
            reply.headers["Set-Cookie"] = "notefable_device=\(id); Path=/"
            return reply
        }
    }

    func testBeforeTheIdentityIsSettledOtherRequestsWaitForTheFirstOne() async throws {
        let server = IdentityServer()
        let transport = FakeTransport()
        transport.respond { await server.handle($0) }
        let jar = MemoryCookieStore()
        let api = makeApi(transport, cookies: jar)

        let sessions = Task { try await api.sessions() }
        await server.firstArrived.wait()
        let notes = Task { try await api.notes() }
        // 给第二个请求一点时间：有闸门时它到不了服务端。
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(transport.requestCount, 1)
        server.release.signal()
        _ = try await sessions.value
        _ = try await notes.value
        XCTAssertEqual(server.seen, [nil, "d1"])
        let stored = jar.loadForRequest(URL(string: testBaseUrl + "/api/sessions")!)
        XCTAssertEqual(stored.first { $0.name == "notefable_device" }?.value, "d1")
        XCTAssertTrue(api.identityGate.isSettled)
    }

    func testTheModelsListNeitherWaitsNorSettlesTheIdentity() async {
        let server = FakeTransport()
        server.enqueue(#"{"models":[],"defaultModel":null}"#)
        let api = makeApi(server)
        _ = try? await api.models()
        XCTAssertEqual(server.requestCount, 1)
        XCTAssertFalse(api.identityGate.isSettled)
    }

    func testAfterSignOutTheNextRequestRunsAloneAgain() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"sessions":[]}"#)
        server.enqueue(#"{"csrfToken":"t k"}"#)
        server.enqueue("", status: 302, headers: [
            "Location": testBaseUrl,
            "Set-Cookie": "authjs.session-token=; Path=/; Max-Age=0, authjs.callback-url=x; Path=/",
        ])
        let jar = MemoryCookieStore()
        let url = URL(string: testBaseUrl + "/")!
        jar.saveFromResponse(url, [
            StoredCookie(name: "authjs.session-token.0", value: "jwt", domain: "notefable.test"),
            StoredCookie(name: "notefable_device", value: "me", domain: "notefable.test"),
        ])
        let api = makeApi(server, cookies: jar)
        XCTAssertFalse(api.identityGate.isSettled)
        _ = try await api.sessions()
        XCTAssertTrue(api.identityGate.isSettled)
        try await api.signOut()
        XCTAssertFalse(api.identityGate.isSettled)

        _ = server.next()
        XCTAssertEqual(server.next().path, "/api/auth/csrf")
        let signout = server.next()
        XCTAssertEqual(signout.method, "POST")
        XCTAssertEqual(signout.path, "/api/auth/signout")
        XCTAssertEqual(signout.header("Content-Type"), "application/x-www-form-urlencoded")
        XCTAssertEqual(signout.bodyText, "csrfToken=t%20k&callbackUrl=https%3A%2F%2Fnotefable.test")
        // 302 不去跟（首页不用读）；本地的会话 Cookie 删掉，设备 Cookie 留着。
        XCTAssertEqual(server.requestCount, 3)
        XCTAssertEqual(jar.loadForRequest(url).map(\.name).sorted(), ["authjs.callback-url", "notefable_device"])
    }

    func testSignOutDropsTheSessionEvenWhenTheServerCannotBeReached() async {
        let server = FakeTransport()
        server.enqueue(.init(error: URLError(.notConnectedToInternet)))
        let jar = MemoryCookieStore()
        let url = URL(string: testBaseUrl + "/")!
        jar.saveFromResponse(url, [StoredCookie(name: "__Secure-authjs.session-token", value: "jwt", domain: "notefable.test")])
        let api = makeApi(server, cookies: jar)
        _ = await errorThrown(try await api.signOut())
        XCTAssertTrue(jar.loadForRequest(url).isEmpty)
        XCTAssertFalse(api.identityGate.isSettled)
    }

    func testANetworkFailureDoesNotSettleAndAResetWhileInFlightKeepsItUnsettled() async throws {
        let gate = IdentityGate(host: "notefable.test")
        let url = URL(string: "https://notefable.test/api/sessions")!
        _ = try? await gate.run(for: url) { throw URLError(.timedOut) }
        XCTAssertFalse(gate.isSettled)
        // 别的站不过闸门，也不算数。
        try await gate.run(for: URL(string: "https://vercel.com/api/blob")!) {}
        XCTAssertFalse(gate.isSettled)
        // 登录发生在请求途中：这个请求带回的是旧身份，不能把新身份标成已确定。
        try await gate.run(for: url) { gate.reset() }
        XCTAssertFalse(gate.isSettled)
        try await gate.run(for: url) {}
        XCTAssertTrue(gate.isSettled)
    }

    func testWaitingRequestsGoOneByOneUntilAResponseSettlesTheIdentity() async throws {
        let gate = IdentityGate(host: "notefable.test")
        let url = URL(string: "https://notefable.test/api/sessions")!
        let firstStarted = AsyncSignal()
        let releaseFirst = AsyncSignal()
        let running = Collected<String>()
        let first = Task {
            try? await gate.run(for: url) {
                firstStarted.signal()
                await releaseFirst.wait()
                throw URLError(.networkConnectionLost)
            }
        }
        await firstStarted.wait()
        let others = (1...3).map { index in
            Task { try await gate.run(for: url) { running.add("r\(index)") } }
        }
        // 被取消的等待者不能卡住后面的。
        let cancelled = Task { try await gate.run(for: url) { running.add("cancelled") } }
        try await Task.sleep(nanoseconds: 50_000_000)
        cancelled.cancel()
        XCTAssertEqual(running.values, [])
        releaseFirst.signal()
        await first.value
        for task in others { try await task.value }
        _ = try? await cancelled.value
        XCTAssertEqual(running.values.sorted(), ["r1", "r2", "r3"])
        XCTAssertTrue(gate.isSettled)
    }

    func testRecognisesOnlySameSiteNoteFileLinks() {
        let base = "https://notefable.example"
        XCTAssertTrue(NoteFileLinks.isNoteFile("https://notefable.example/api/pages/files?key=note-files%2Fu%2Fx.pdf&name=a.pdf", baseUrl: base))
        XCTAssertFalse(NoteFileLinks.isNoteFile("https://notefable.example/api/pages/files", baseUrl: base))
        XCTAssertFalse(NoteFileLinks.isNoteFile("https://other.example/api/pages/files?key=k", baseUrl: base))
        XCTAssertFalse(NoteFileLinks.isNoteFile("http://notefable.example/api/pages/files?key=k", baseUrl: base))
        XCTAssertFalse(NoteFileLinks.isNoteFile("https://notefable.example/api/pages/files/x?key=k", baseUrl: base))
        XCTAssertFalse(NoteFileLinks.isNoteFile("not a url", baseUrl: base))
        XCTAssertTrue(NoteFileLinks.isNoteFile("https://NoteFable.example:443/api/pages/files?key=k", baseUrl: base))
    }

    func testFileNamesComeFromTheHeaderThenTheLinkAndNeverContainPaths() {
        let url = URL(string: "https://s.example/api/pages/files?key=k&name=from%20link.txt")!
        XCTAssertEqual(
            NoteFileLinks.fileName(contentDisposition: "attachment; filename*=UTF-8''%E8%AC%9B%E7%BE%A9%20%E3%83%8E%E3%83%BC%E3%83%88+1.pdf", url: url),
            "講義 ノート+1.pdf"
        )
        XCTAssertEqual(NoteFileLinks.fileName(contentDisposition: nil, url: url), "from link.txt")
        XCTAssertEqual(NoteFileLinks.fileName(contentDisposition: "attachment; filename*=UTF-8''%2Fetc%2Fpasswd", url: url), "_etc_passwd")
        XCTAssertEqual(NoteFileLinks.fileName(contentDisposition: nil, url: URL(string: "https://s.example/api/pages/files?key=k")!), "file")
        XCTAssertEqual(NoteFileLinks.fileName(url: url.absoluteString), "from link.txt")
    }

    func testDownloadsAPrivateNoteFileWithTheAppCookies() async throws {
        let server = FakeTransport()
        server.enqueue("hello", headers: [
            "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename*=UTF-8''notes.pdf",
        ])
        let jar = MemoryCookieStore()
        jar.saveFromResponse(URL(string: testBaseUrl + "/")!, [StoredCookie(name: "notefable_device", value: "me", domain: "notefable.test")])
        let api = makeApi(server, cookies: jar)
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("nf-download-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: destination) }
        var asked: [String] = []
        let result = try await api.downloadNoteFile("\(testBaseUrl)/api/pages/files?key=k&name=x.pdf") { name, type in
            asked = [name, type]
            return destination
        }
        XCTAssertEqual(result, NoteFileDownload(name: "notes.pdf", mimeType: "application/pdf"))
        XCTAssertEqual(asked, ["notes.pdf", "application/pdf"])
        XCTAssertEqual(try String(contentsOf: destination, encoding: .utf8), "hello")
        XCTAssertEqual(server.next().header("Cookie"), "notefable_device=me")
    }

    func testAMissingFileReportsTheServerMessage() async {
        let server = FakeTransport()
        server.enqueue(#"{"error":"File not found."}"#, status: 404)
        let api = makeApi(server)
        let error = await errorThrown(try await api.downloadNoteFile("/api/pages/files?key=k") { _, _ in
            XCTFail("no destination should be asked for")
            return FileManager.default.temporaryDirectory
        })
        XCTAssertEqual((error as? ApiException)?.message, "File not found.")
    }
}
