import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

final class NoteFableApiTests: XCTestCase {
    func testRestoringGoogleProfileClearsBothNameAndAvatarUsingTheServerContract() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"user":{"name":"Ann","icon":null,"avatarUrl":null}}"#)
        let api = makeApi(server)

        let user = try await AccountApi(http: api.http).updateProfile(.resetToGoogle)
        XCTAssertEqual(user.name, "Ann")

        let request = server.next()
        XCTAssertEqual(request.method, "PATCH")
        XCTAssertEqual(request.path, "/api/account")
        XCTAssertEqual(request.jsonKeys, ["displayName", "icon"])
        XCTAssertEqual(request.json?["displayName"], JSONValue.null)
        XCTAssertEqual(request.json?["icon"], JSONValue.null)
    }

    func testEmailSignInPostsTheAddressWithTheUILanguageThenTheCodeAndKeepsTheServersReason() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"ok":true}"#)
        server.enqueue(#"{"ok":true}"#)
        server.enqueue(#"{"error":"That code is incorrect."}"#, status: 400)
        let api = makeApi(server)

        try await api.emailSignInStart(email: "a@example.test", locale: "zh-Hant")
        try await api.emailSignInVerify(email: "a@example.test", code: "123456")

        let start = server.next()
        XCTAssertEqual(start.method, "POST")
        XCTAssertEqual(start.path, "/api/auth/email/start")
        // 服务端只在没有 Origin 时放行原生客户端（isSameOrigin）。
        XCTAssertNil(start.header("Origin"))
        XCTAssertEqual(start.json?["email"]?.stringValue, "a@example.test")
        XCTAssertEqual(start.json?["locale"]?.stringValue, "zh-Hant")

        let verify = server.next()
        XCTAssertEqual(verify.path, "/api/auth/email/verify")
        XCTAssertEqual(verify.jsonKeys, ["email", "code"])
        XCTAssertEqual(verify.json?["code"]?.stringValue, "123456")

        let error = await errorThrown(try await api.emailSignInVerify(email: "a@example.test", code: "000000"))
        XCTAssertEqual((error as? ApiException)?.serverMessage(), "That code is incorrect.")
    }

    func testParsesTheUsageLimitFieldsFromA429Body() {
        let error = ApiException.from(
            status: 429,
            body: #"{"error":"You've used today's free messages. Sign in for more, or try again tomorrow.","code":"usage_limit","tier":"guest","kind":"chat"}"#
        )
        XCTAssertEqual(error.status, 429)
        XCTAssertEqual(error.message, "You've used today's free messages. Sign in for more, or try again tomorrow.")
        XCTAssertEqual(error.code, "usage_limit")
        XCTAssertEqual(error.tier, "guest")
        XCTAssertEqual(error.kind, "chat")
        XCTAssertTrue(error.isUsageLimit)
    }

    func testPlainAndUnreadableErrorBodiesKeepTheOldMessage() {
        let plain = ApiException.from(status: 404, body: #"{"error":"Note not found."}"#)
        XCTAssertEqual(plain.message, "Note not found.")
        XCTAssertNil(plain.code)
        XCTAssertFalse(plain.isUsageLimit)
        XCTAssertEqual(ApiException.from(status: 502, body: "<html>Bad gateway</html>").message, "HTTP 502")
        XCTAssertEqual(ApiException.from(status: 400, body: #"{"error":"  "}"#).message, "HTTP 400")
        // 429 但不是使用上限（没有 code）时不算上限。
        XCTAssertFalse(ApiException.from(status: 429, body: #"{"error":"Slow down."}"#).isUsageLimit)
    }

    func testTheStreamRequestEndsWithTheParsedApiException() async {
        let server = FakeTransport()
        server.enqueue(
            #"{"error":"You've reached today's message limit. Try again tomorrow.","code":"usage_limit","tier":"member","kind":"chat"}"#,
            status: 429
        )
        let api = makeApi(server)
        var thrown: Error?
        do {
            for try await _ in api.streamChat(ChatRequest(message: "hi")) {}
        } catch {
            thrown = error
        }
        let error = thrown as? ApiException
        XCTAssertEqual(error?.tier, "member")
        XCTAssertEqual(error?.isUsageLimit, true)
    }

    func testJSONRequestsTurnErrorResponsesIntoApiExceptionWithTheServerText() async {
        let server = FakeTransport()
        server.enqueue(#"{"error":"Database is unavailable."}"#, status: 503)
        let api = makeApi(server, acceptLanguage: { "ja,en;q=0.8" })
        let error = await errorThrown(try await api.notes()) as? ApiException
        XCTAssertEqual(error?.status, 503)
        XCTAssertEqual(error?.message, "Database is unavailable.")
        let request = server.next()
        XCTAssertEqual(request.header("User-Agent"), NoteFableApi.USER_AGENT)
        XCTAssertEqual(request.header("User-Agent"), "NoteFableNative/0.1 (iOS)")
        XCTAssertEqual(request.header("Accept-Language"), "ja,en;q=0.8")
        XCTAssertEqual(request.header("Accept"), "application/json")
    }

    func testChangingOnlyTheNamePreservesTheExistingAvatar() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"user":{"name":"Local","icon":"🙂"}}"#)
        let api = makeApi(server)

        let user = try await AccountApi(http: api.http).updateProfile(.name("Local"))
        XCTAssertEqual(user.icon, "🙂")

        let request = server.next()
        XCTAssertEqual(request.json?["displayName"]?.stringValue, "Local")
        XCTAssertFalse(request.jsonKeys.contains("icon"))
    }

    // ---- 以下是 iOS 端补的：Android 靠 OkHttp / MockWebServer 保证的部分，这边是自己写的 ----

    func testStreamChatSendsTheWebFormFieldsAndYieldsStartedDeltasAndActivity() async throws {
        let server = FakeTransport()
        let sse = Data("data: \"你好\"\r\n\r\ndata: {\"activity\":{\"type\":\"thought\",\"id\":\"t1\"}}\n\n: ping\n\ndata: \" 🙂\"\n\ndata: [DONE]".utf8)
        // 切在一个汉字中间、一行中间：行要凑齐了才解析。
        let chunks = [Data(sse.prefix(9)), Data(sse.dropFirst(9).prefix(30)), Data(sse.dropFirst(39))]
        server.enqueue(.init(headers: ["x-session-id": "s9", "Content-Type": "text/event-stream"], chunks: chunks))
        let api = makeApi(server)

        var events: [ChatStreamEvent] = []
        let request = ChatRequest(message: "hi", sessionId: "s1", model: "luna", reasoning: "high", uploads: ["t1"], pages: ["p1", "p2"])
        for try await event in api.streamChat(request) { events.append(event) }

        XCTAssertEqual(events, [
            .started(sessionId: "s9"),
            .delta(text: "你好"),
            .activity(payload: ["type": "thought", "id": "t1"]),
            .delta(text: " 🙂"),
        ])
        let sent = server.next()
        XCTAssertEqual(sent.method, "POST")
        XCTAssertEqual(sent.path, "/api/chat")
        XCTAssertEqual(sent.header("Accept"), "text/event-stream")
        XCTAssertEqual(sent.request.timeout, .streaming)
        let form = MultipartParts(sent)
        XCTAssertEqual(form.names, ["message", "model", "reasoning", "webSearch", "sessionId", "uploads", "pages"])
        XCTAssertEqual(form.text("message"), "hi")
        XCTAssertEqual(form.text("webSearch"), "auto")
        XCTAssertEqual(form.text("uploads"), #"["t1"]"#)
        XCTAssertEqual(form.text("pages"), #"["p1","p2"]"#)
    }

    func testEditAndRegenerateReuseTheOriginalAttachmentsAndNotes() async throws {
        let server = FakeTransport()
        server.enqueue("")
        server.enqueue("")
        let api = makeApi(server)
        for try await _ in api.streamChat(ChatRequest(message: "new", sessionId: "s1", uploads: ["t"], pages: ["p"], edit: "m1")) {}
        for try await _ in api.streamChat(ChatRequest(message: "", sessionId: "s1", regenerate: "m2")) {}
        XCTAssertEqual(MultipartParts(server.next()).names, ["message", "webSearch", "sessionId", "edit"])
        XCTAssertEqual(MultipartParts(server.next()).names, ["webSearch", "sessionId", "regenerate"])
    }

    func testImageGenerationPostsThePromptFormWithoutATotalTimeout() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"sessionId":"s2","image":{"dataUrl":"data:image/png;base64,AA"}}"#)
        let result = try await makeApi(server).generateImage(ChatRequest(message: "a cat", uploads: ["t1"]))
        XCTAssertEqual(result.sessionId, "s2")
        XCTAssertEqual(result.image?.mimeType, "image/png")
        let sent = server.next()
        XCTAssertEqual(sent.path, "/api/images")
        XCTAssertEqual(sent.request.timeout, .streaming)
        XCTAssertEqual(MultipartParts(sent).names, ["prompt", "uploads"])
        XCTAssertEqual(MultipartParts(sent).text("prompt"), "a cat")
    }

    func testBlobUploadExchangesTheTicketForATokenAndPutsTheBytesToVercelBlob() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"uploads":[{"path":"chat/u 1/a.png","ticket":"tk+1"}],"mode":"blob"}"#)
        server.enqueue(#"{"type":"blob.generate-client-token","clientToken":"vercel_blob_client_store9_secret"}"#)
        server.enqueue(#"{"url":"https://blob/x"}"#)
        let file = LocalFile(uri: "mem://a", name: "a.png", mimeType: "image/png", size: 4)
        let api = makeApi(server, openFile: { uri in
            XCTAssertEqual(uri, "mem://a")
            return .data(Data([1, 2, 3, 4]))
        })
        let percents = Collected<Int>()

        let plan = try await api.prepareUploads([file])
        try await api.uploadFile(slot: plan.uploads[0], mode: plan.mode, file: file) { percents.add($0) }

        let prepare = server.next()
        XCTAssertEqual(prepare.path, "/api/uploads")
        XCTAssertEqual(prepare.json, ["files": [["name": "a.png", "type": "image/png", "size": 4]]])
        let token = server.next()
        XCTAssertEqual(token.path, "/api/uploads")
        XCTAssertEqual(token.json, [
            "type": "blob.generate-client-token",
            "payload": ["pathname": "chat/u 1/a.png", "clientPayload": "tk+1", "multipart": false],
        ])
        let put = server.next()
        XCTAssertEqual(put.method, "PUT")
        XCTAssertEqual(put.request.url.absoluteString, "https://vercel.com/api/blob/?pathname=chat%2Fu%201%2Fa.png")
        XCTAssertEqual(put.header("authorization"), "Bearer vercel_blob_client_store9_secret")
        XCTAssertEqual(put.header("x-api-version"), "12")
        XCTAssertEqual(put.header("x-vercel-blob-store-id"), "store9")
        XCTAssertEqual(put.header("x-vercel-blob-access"), "private")
        XCTAssertEqual(put.header("x-content-type"), "image/png")
        XCTAssertEqual(put.header("x-content-length"), "4")
        XCTAssertEqual(put.header("Content-Type"), "image/png")
        XCTAssertEqual(put.request.timeout, .upload)
        XCTAssertEqual(put.body, Data([1, 2, 3, 4]))
        // 别的站：不带本站的 Cookie。
        XCTAssertNil(put.header("Cookie"))
        // 百分比变了才报。
        XCTAssertEqual(percents.values, [50, 100])
    }

    func testLocalUploadPutsToTheDevServerAndFailuresCarryTheServerText() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"ok":true}"#)
        server.enqueue(#"{"error":"Attachment upload failed. Please try again."}"#, status: 400)
        let file = LocalFile(uri: "x", name: "a.txt", mimeType: "text/plain", size: 2)
        let api = makeApi(server, openFile: { _ in .data(Data("hi".utf8)) })
        let slot = UploadSlot(path: "p", ticket: "a b/c")
        try await api.uploadFile(slot: slot, mode: "local", file: file) { _ in }
        let put = server.next()
        XCTAssertEqual(put.method, "PUT")
        XCTAssertEqual(put.path, "/api/uploads/local?ticket=a%20b%2Fc")
        XCTAssertEqual(put.bodyText, "hi")
        let error = await errorThrown(try await api.uploadFile(slot: slot, mode: "local", file: file) { _ in }) as? ApiException
        XCTAssertEqual(error?.message, "Attachment upload failed. Please try again.")
    }

    func testAPlanThatDoesNotCoverEveryFileIsRefusedAndDiscardNeverThrows() async {
        let server = FakeTransport()
        server.enqueue(#"{"uploads":[],"mode":"blob"}"#)
        server.enqueue(.init(error: URLError(.notConnectedToInternet)))
        let api = makeApi(server)
        let file = LocalFile(uri: "x", name: "a.txt", mimeType: "text/plain", size: 2)
        _ = await errorThrown(try await api.prepareUploads([file]))
        _ = server.next()
        await api.discardUploads([])
        XCTAssertEqual(server.requestCount, 1)
        await api.discardUploads(["t1", "t2"])
        let delete = server.next()
        XCTAssertEqual(delete.method, "DELETE")
        XCTAssertEqual(delete.path, "/api/uploads")
        XCTAssertEqual(delete.json, ["uploads": ["t1", "t2"]])
    }

    func testDiscardStillRunsWhenTheCallerWasCancelled() async {
        let server = FakeTransport()
        server.enqueue(#"{"ok":true}"#)
        let api = makeApi(server)
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            await api.discardUploads(["t1"])
        }
        await task.value
        XCTAssertEqual(server.requestCount, 1)
    }

    func testStopVersionsAndBranchUseTheSessionEndpoints() async throws {
        let server = FakeTransport()
        server.enqueue("{}")
        server.enqueue("{}")
        server.enqueue(#"{"session":{"id":"n","title":"Copy"}}"#, status: 201)
        let api = makeApi(server)
        try await api.stopSession(sessionId: "s1")
        try await api.showVersion(sessionId: "s1", messageId: "m1")
        let branched = try await api.branchSession(sessionId: "s1", messageId: "m2", title: "Copy")
        XCTAssertEqual(branched.id, "n")
        let stop = server.next()
        XCTAssertEqual(stop.method, "POST")
        XCTAssertEqual(stop.path, "/api/sessions/s1/stop")
        XCTAssertEqual(server.next().json, ["messageId": "m1"])
        let branch = server.next()
        XCTAssertEqual(branch.path, "/api/sessions/s1/branch")
        XCTAssertEqual(branch.json, ["messageId": "m2", "title": "Copy"])
    }

    func testMessagesKeepActivityAsRawJSONAndTolerateMissingAndNullFields() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"messages":[{"id":"m1","role":"ASSISTANT","content":null,"thinkingMs":1200,"activity":[{"type":"web"}],"proposals":null,"versions":{"index":1,"total":2,"prevId":"m0"},"later":1}]}"#)
        let message = try await makeApi(server).messages(sessionId: "s 1").first
        XCTAssertEqual(server.next().path, "/api/sessions/s%201/messages")
        XCTAssertEqual(message?.content, "")
        XCTAssertEqual(message?.thinkingMs, 1200)
        XCTAssertEqual(message?.activity, [["type": "web"]])
        XCTAssertNil(message?.proposals)
        XCTAssertEqual(message?.versions, MessageVersions(index: 1, total: 2, prevId: "m0"))
        XCTAssertEqual(message?.attachments, [])
    }

    func testAccountLocaleTellsUnknownFromAutomatic() throws {
        XCTAssertEqual(try NoteFableJson.decodeFromString(AccountUser.self, #"{"name":"A"}"#).locale, LOCALE_UNKNOWN)
        XCTAssertNil(try NoteFableJson.decodeFromString(AccountUser.self, #"{"name":"A","locale":null}"#).locale)
        XCTAssertEqual(try NoteFableJson.decodeFromString(AccountUser.self, #"{"locale":"ja"}"#).locale, "ja")
        let plan = try NoteFableJson.decodeFromString(PlanInfo.self, #"{"plan":"pro","usage":{"chat":{"used":3,"limit":100,"period":"day"}},"priceJpy":980}"#)
        XCTAssertEqual(plan.usage["chat"]?.used, 3)
        XCTAssertEqual(plan.priceJpy, 980)
    }

    func testProposalPreviewURLBuildsStaticEmbedQuery() {
        let api = makeApi(FakeTransport())
        let url = api.proposalPreviewUrl(proposalId: "prop 1", lang: "ja", theme: "dark")
        XCTAssertEqual(url, "https://notefable.test/note-embed?proposal=prop%201&lang=ja&theme=dark")
    }
}

/// 从后台线程收集回调的值。
final class Collected<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [Value] = []

    func add(_ value: Value) {
        lock.withLock { items.append(value) }
    }

    var values: [Value] { lock.withLock { items } }
}
