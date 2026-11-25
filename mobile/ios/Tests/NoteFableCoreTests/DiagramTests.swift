import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

// 「画成图」（#153，POST /api/pages/diagram）：请求的形、错误的显示、按素材的任务（一个素材一个任务、重试用同一个 clientRequestId、
// 关窗口忘掉、换身份不留结果）和笔记菜单的"先保存再开始"。规则见 docs/architecture/chat-flow.md 的“画成图”。
final class DiagramApiTests: XCTestCase {
    private func api(_ server: FakeTransport) -> DiagramApi {
        DiagramApi(http: makeApi(server).http)
    }

    private static let whiteboard = #"{"id":"wb1","kind":"whiteboard","title":"Flow","icon":null,"version":1,"position":0,"groupId":null,"parentId":"n1","favoritedAt":null,"fullWidth":false,"smallText":false,"font":"default","locked":false,"shareEnabled":false,"shareExpiresAt":null,"aiUpdatedAt":"2026-11-25T00:00:00.000Z","createdAt":"2026-11-25T00:00:00.000Z","updatedAt":"2026-11-25T00:00:00.000Z"}"#

    func testDrawsAnAnswerWithTheModelAndTheJobsRequestIdAndReadsTheNewWhiteboard() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"page":"# + Self.whiteboard + #","partial":true}"#, status: 201)
        let drawn = try await api(server).drawDiagram(
            source: .answer(sessionId: "s1", messageId: "m1"), model: "luna", clientRequestId: "req-0001"
        )
        XCTAssertEqual(drawn.page.id, "wb1")
        XCTAssertEqual(drawn.page.kind, .whiteboard)
        XCTAssertEqual(drawn.page.title, "Flow")
        XCTAssertEqual(drawn.page.parentId, "n1")
        XCTAssertNotNil(drawn.page.aiUpdatedAt)
        XCTAssertTrue(drawn.partial)
        let request = server.next()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/api/pages/diagram")
        // 会话 ID 只用来当任务的键，不送。
        XCTAssertEqual(request.json, ["source": "answer", "messageId": "m1", "model": "luna", "clientRequestId": "req-0001"])
        XCTAssertEqual(request.header("Accept"), "application/json")
        // 服务端最多生成 300 秒：和「整理成笔记」一样不按普通请求的时限断开。
        XCTAssertEqual(request.request.timeout, HTTPTimeout(idle: nil, total: 320))
    }

    func testDrawsANoteWithoutAModelAndAReplayHasNoPartialFlag() async throws {
        let server = FakeTransport()
        // 同一个 clientRequestId 再发：200，已经建好的那一页，没有 partial。
        server.enqueue(#"{"page":"# + Self.whiteboard + #"}"#, status: 200)
        let drawn = try await api(server).drawDiagram(source: .note(pageId: "n1"), model: nil, clientRequestId: "req-0002")
        XCTAssertEqual(drawn.page.id, "wb1")
        XCTAssertFalse(drawn.partial)
        XCTAssertEqual(server.next().json, ["source": "note", "pageId": "n1", "clientRequestId": "req-0002"])
    }

    func testAnInvalidDiagramCarriesTheMermaidSourceToCopy() async {
        let server = FakeTransport()
        server.enqueue(
            #"{"error":"Could not turn this into an editable diagram.","code":"diagram_invalid","source":"flowchart TD\n  A-->B"}"#,
            status: 422
        )
        server.enqueue(#"{"error":"Could not turn this into an editable diagram.","code":"diagram_invalid","source":""}"#, status: 422)
        let api = api(server)
        let error = await errorThrown(try await api.drawDiagram(source: .note(pageId: "n1"), model: nil, clientRequestId: "req-0003"))
        XCTAssertEqual(error as? DiagramInvalidError, DiagramInvalidError(message: DIAGRAM_NOT_CONVERTED, source: "flowchart TD\n  A-->B"))
        XCTAssertEqual(error.map(diagramFailure), DiagramFailure(message: DIAGRAM_NOT_CONVERTED, source: "flowchart TD\n  A-->B"))
        // 没有原文时不给"复制"。
        let empty = await errorThrown(try await api.drawDiagram(source: .note(pageId: "n1"), model: nil, clientRequestId: "req-0003"))
        XCTAssertEqual(empty.map(diagramFailure), DiagramFailure(message: DIAGRAM_NOT_CONVERTED, source: nil))
    }

    func testAResponseWithoutAPageIdIsTheGenericFailure() async {
        let server = FakeTransport()
        server.enqueue(#"{"ok":true}"#, status: 201)
        let error = await errorThrown(try await api(server).drawDiagram(source: .note(pageId: "n1"), model: nil, clientRequestId: "req-0004"))
        XCTAssertEqual(error.map(diagramFailure), DiagramFailure(message: DIAGRAM_FAILED))
    }

    func testErrorsShowTheServerSentenceOnlyForRequestAndLimitProblems() {
        func failure(_ status: Int, _ body: String) -> DiagramFailure {
            diagramFailure(DiagramApi.failure(status: status, body: Data(body.utf8)))
        }
        XCTAssertEqual(failure(400, #"{"error":"There is nothing to draw yet."}"#), DiagramFailure(message: "There is nothing to draw yet."))
        XCTAssertEqual(failure(404, #"{"error":"Message not found."}"#), DiagramFailure(message: "Message not found."))
        XCTAssertEqual(failure(404, #"{"error":"This diagram was moved to the trash."}"#), DiagramFailure(message: "This diagram was moved to the trash."))
        XCTAssertEqual(failure(413, #"{"error":"Note content exceeds 1 MiB."}"#), DiagramFailure(message: "Note content exceeds 1 MiB."))
        // 上限（429）：保留服务端说明与档位（游客用于在窗口内显示原生登录入口）。
        XCTAssertEqual(
            failure(429, #"{"error":"Daily limit reached.","code":"usage_limit","tier":"guest","kind":"chat"}"#),
            DiagramFailure(message: "Daily limit reached.", usageLimitTier: "guest")
        )
        XCTAssertEqual(failure(422, #"{"error":"Something else."}"#), DiagramFailure(message: "Something else."))
        XCTAssertEqual(failure(502, #"{"error":"Could not draw a diagram. Try again."}"#), DiagramFailure(message: DIAGRAM_FAILED))
        XCTAssertEqual(failure(503, #"{"error":"Database is unavailable."}"#), DiagramFailure(message: DIAGRAM_FAILED))
        XCTAssertEqual(failure(400, "not json"), DiagramFailure(message: DIAGRAM_FAILED))
        XCTAssertEqual(diagramFailure(URLError(.timedOut)), DiagramFailure(message: DIAGRAM_FAILED))
    }

    func testTheJobKeyNamesTheSource() {
        XCTAssertEqual(DiagramSource.answer(sessionId: "s1", messageId: "m1").key, "answer:s1\nm1")
        XCTAssertEqual(DiagramSource.note(pageId: "n1").key, "note:n1")
    }

    // ---- 按素材的任务（DiagramStore） ----

    @MainActor
    private final class FakeBackend: DiagramBackend {
        var calls: [String] = []
        var requestIds: [String] = []
        var gate: AsyncSignal?
        var fail: Error?

        func drawDiagram(source: DiagramSource, model: String?, clientRequestId: String) async throws -> DrawnDiagram {
            calls.append("\(source.key)|\(model ?? "nil")")
            requestIds.append(clientRequestId)
            let number = calls.count
            await gate?.wait()
            if let fail { throw fail }
            return DrawnDiagram(page: NotePageSummary(id: "wb-\(number)", title: "Flow", kind: .whiteboard), partial: false)
        }
    }

    @MainActor
    private func store(_ backend: FakeBackend) -> DiagramStore {
        var next = 0
        return DiagramStore(backend: backend, newRequestId: {
            next += 1
            return "req-\(next)"
        })
    }

    private let answer = DiagramSource.answer(sessionId: "s1", messageId: "m1")
    private let note = DiagramSource.note(pageId: "n1")

    @MainActor
    func testOneJobPerSourceAndChoosingItAgainKeepsTheSameJob() async {
        let backend = FakeBackend()
        backend.gate = AsyncSignal()
        let store = store(backend)
        var created = store.created().makeAsyncIterator()
        let first = store.start(answer, model: "luna")
        XCTAssertEqual(store.job(answer), .working)
        // 进行中再点、关窗口：不再发，也不忘掉。
        XCTAssertNil(store.start(answer, model: "luna"))
        store.forgetFinished(answer)
        XCTAssertEqual(store.job(answer), .working)
        // 别的素材各自一个任务。
        let other = store.start(note, model: nil)
        backend.gate?.signal()
        await first?.value
        await other?.value
        XCTAssertEqual(backend.calls, ["answer:s1\nm1|luna", "note:n1|nil"])
        XCTAssertEqual(backend.requestIds, ["req-1", "req-2"])
        let page = NotePageSummary(id: "wb-1", title: "Flow", kind: .whiteboard)
        XCTAssertEqual(store.job(answer), .done(page: page, partial: false))
        // 完成后再点：还是那个任务（窗口显示"打开白板"），不再建。
        XCTAssertNil(store.start(answer, model: "luna"))
        XCTAssertEqual(backend.calls.count, 2)
        let firstCreated = await created.next()
        let secondCreated = await created.next()
        XCTAssertEqual(Set([firstCreated?.id, secondCreated?.id]), ["wb-1", "wb-2"])
    }

    @MainActor
    func testRetryReusesTheRequestIdAndClosingAFinishedJobForgetsIt() async {
        let backend = FakeBackend()
        backend.fail = ApiException.from(status: 503, body: #"{"error":"Could not draw a diagram. Try again."}"#)
        let store = store(backend)
        // 还没有任务、或不是失败时，重试什么也不做。
        XCTAssertNil(store.retry(note, model: nil))
        await store.start(note, model: nil)?.value
        XCTAssertEqual(store.job(note), .failed(DiagramFailure(message: DIAGRAM_FAILED)))
        // 失败后再点菜单：回到同一个任务（窗口里有"重试"），不另开。
        XCTAssertNil(store.start(note, model: nil))
        // 重试：同一个 clientRequestId（上一次其实建好了的话服务端直接返回那一页）。
        backend.fail = nil
        await store.retry(note, model: "luna")?.value
        XCTAssertEqual(backend.requestIds, ["req-1", "req-1"])
        XCTAssertEqual(store.job(note), .done(page: NotePageSummary(id: "wb-2", title: "Flow", kind: .whiteboard), partial: false))
        XCTAssertNil(store.retry(note, model: nil))
        // 关掉已结束的窗口：忘掉；之后再点是新的任务、新的 clientRequestId。
        store.forgetFinished(note)
        XCTAssertNil(store.job(note))
        await store.start(note, model: nil)?.value
        XCTAssertEqual(backend.requestIds, ["req-1", "req-1", "req-2"])
        // 失败的任务关窗口也忘掉。
        backend.fail = URLError(.notConnectedToInternet)
        store.forgetFinished(note)
        await store.start(note, model: nil)?.value
        store.forgetFinished(note)
        XCTAssertNil(store.job(note))
        XCTAssertNil(store.retry(note, model: nil))
    }

    @MainActor
    func testAnInvalidDiagramKeepsItsSourceForCopying() async {
        let backend = FakeBackend()
        backend.fail = DiagramInvalidError(message: DIAGRAM_NOT_CONVERTED, source: "flowchart TD\n  A-->B")
        let store = store(backend)
        await store.start(answer, model: nil)?.value
        XCTAssertEqual(store.job(answer), .failed(DiagramFailure(message: DIAGRAM_NOT_CONVERTED, source: "flowchart TD\n  A-->B")))
    }

    @MainActor
    func testChangingIdentityKeepsARunningJobSoItIsNotSentTwiceThenDropsItsResult() async {
        let backend = FakeBackend()
        backend.gate = AsyncSignal()
        let store = store(backend)
        var created = store.created().makeAsyncIterator()
        let running = store.start(answer, model: nil)
        store.clearJobs()
        XCTAssertEqual(store.job(answer), .working)
        XCTAssertNil(store.start(answer, model: nil))
        backend.gate?.signal()
        await running?.value
        // 结果属于旧身份：不留，也不发出新白板。
        XCTAssertNil(store.job(answer))
        XCTAssertEqual(backend.calls.count, 1)
        // 新身份再点：新的任务、新的 clientRequestId。
        await store.start(answer, model: nil)?.value
        XCTAssertEqual(backend.requestIds, ["req-1", "req-2"])
        let announced = await created.next()
        XCTAssertEqual(announced?.id, "wb-2")
        // 已结束的任务换身份时清掉。
        backend.fail = ApiException.from(status: 429, body: #"{"error":"Daily limit reached."}"#)
        await store.start(note, model: nil)?.value
        XCTAssertNotNil(store.job(note))
        store.clearJobs()
        XCTAssertTrue(store.jobs.isEmpty)
        XCTAssertNil(store.retry(note, model: nil))
    }

    // ---- 笔记 ViewModel：先保存、新白板进列表 ----

    @MainActor
    func testANoteIsSavedBeforeTheServerReadsItAndAnUnsavedDraftStopsIt() async {
        let vm = NotesViewModel(backend: NotesTestBackend())
        vm.setWorkspace(.notes)
        await notesSettle()
        vm.openNote("a")
        await notesSettle()
        var flushes = 0
        vm.flushEditor = {
            flushes += 1
            return FlushResult(false)
        }
        let refused = await vm.flushBeforeServerRead("a")
        XCTAssertFalse(refused)
        XCTAssertEqual(flushes, 1)
        XCTAssertEqual(vm.state.notice?.kind, .unsavedDraft)
        XCTAssertEqual(vm.state.open?.id, "a")
        // 不设 busy：笔记的其它操作照常。
        XCTAssertFalse(vm.state.busy)
        // 别的一篇（没打开）不用保存。
        let other = await vm.flushBeforeServerRead("b")
        XCTAssertTrue(other)
        XCTAssertEqual(flushes, 1)
        vm.flushEditor = {
            flushes += 1
            return FlushResult(true)
        }
        let saved = await vm.flushBeforeServerRead("a")
        XCTAssertTrue(saved)
        XCTAssertEqual(flushes, 2)
        // 重试保存成功后清掉旧的"草稿未保存"提示。
        XCTAssertNil(vm.state.notice)
    }

    @MainActor
    func testAChangeOfIdentityWhileSavingDoesNotStart() async {
        let vm = NotesViewModel(backend: NotesTestBackend())
        vm.setWorkspace(.notes)
        await notesSettle()
        vm.openNote("a")
        await notesSettle()
        let gate = AsyncSignal()
        vm.flushEditor = {
            await gate.wait()
            return FlushResult(true)
        }
        let pending = Task { await vm.flushBeforeServerRead("a") }
        await notesSettle()
        vm.onIdentityChanged()
        gate.signal()
        let result = await pending.value
        XCTAssertFalse(result)
    }

    @MainActor
    func testANewWhiteboardShowsUpUnderItsNoteRightAway() async {
        let vm = NotesViewModel(backend: NotesTestBackend())
        vm.setWorkspace(.notes)
        await notesSettle()
        XCTAssertFalse(vm.state.expanded.contains("b"))
        vm.showCreatedPage(NotePageSummary(id: "wb", title: "Flow", parentId: "b", kind: .whiteboard))
        XCTAssertTrue(vm.state.expanded.contains("b"))
        XCTAssertEqual(vm.state.pages.first { $0.id == "wb" }?.parentId, "b")
        // 最上层的白板：它的分区折叠着就展开。
        let top = NotePageSummary(id: "wb2", title: "Flow", kind: .whiteboard)
        let section = vm.state.sectionKind(of: top)
        vm.toggleSection(section)
        XCTAssertTrue(vm.state.collapsedSections.contains(section))
        vm.showCreatedPage(top)
        XCTAssertFalse(vm.state.collapsedSections.contains(section))
        XCTAssertTrue(vm.state.pages.contains { $0.id == "wb2" })
    }
}

/// 记下假服务端收到的请求。
private final class DiagramRequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [FakeTransport.Recorded] = []

    func add(_ request: FakeTransport.Recorded) {
        lock.withLock { requests.append(request) }
    }

    func all(_ method: String, _ path: String) -> [FakeTransport.Recorded] {
        lock.withLock { requests.filter { $0.method == method && $0.path == path } }
    }
}

/// 假服务端画好的白板（那篇笔记的子页面）。
private let drawnWhiteboardReply = #"{"page":{"id":"wb1","kind":"whiteboard","title":"Flow","parentId":"n1","aiUpdatedAt":"2026-11-25T00:00:00.000Z"}}"#

/// 界面经 AppRouter 走的流程：笔记菜单先保存再开始、回答菜单再点回到同一个任务、打开白板、换身份。
@MainActor
final class DiagramRouterTests: XCTestCase {
    private var directory: URL!
    private var suiteName: String!
    private var defaults: UserDefaults!
    private var log: DiagramRequestLog!
    private var transport: FakeTransport!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("nf-diagram-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        suiteName = "nf-diagram-\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let log = DiagramRequestLog()
        self.log = log
        transport = FakeTransport()
        transport.respond { request in
            log.add(request)
            switch (request.method, request.path) {
            case ("GET", "/api/pages"):
                return FakeTransport.Reply(#"{"pages":[{"id":"n1","title":"Plan","kind":"note"}],"groups":[]}"#)
            case ("POST", "/api/pages/diagram"):
                return FakeTransport.Reply(drawnWhiteboardReply, status: 201)
            default:
                return FakeTransport.Reply("{}", status: 503)
            }
        }
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: directory)
    }

    private func makeEnvironment() throws -> AppEnvironment {
        let resources = directory.appendingPathComponent("resources", isDirectory: true)
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        return AppEnvironment(
            config: AppConfig(info: ["NoteFableBaseURL": testBaseUrl]),
            resources: try XCTUnwrap(Bundle(path: resources.path)),
            defaults: defaults,
            dataDirectory: directory.appendingPathComponent("data", isDirectory: true),
            transport: transport,
            systemLanguages: { ["en"] },
            l10n: L10n()
        )
    }

    private func eventually(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<400 {
            if condition() { return }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTFail("condition was not met in time", file: file, line: line)
    }

    private func diagramRequests() -> [FakeTransport.Recorded] {
        log.all("POST", "/api/pages/diagram")
    }

    func testTheNoteMenuSavesTheNoteFirstAndDoesNotStartWhenItCannot() async throws {
        let environment = try makeEnvironment()
        let router = AppRouter(app: environment)
        let source = DiagramSource.note(pageId: "n1")
        environment.notes.openNote("n1", title: "Plan", icon: nil, kind: .note)
        await eventually { environment.notes.state.open?.id == "n1" }
        var flushes = 0
        environment.notes.flushEditor = {
            flushes += 1
            return FlushResult(false)
        }
        await router.drawDiagramFromNote("n1").value
        // 存不上：提示，不发请求、不开窗口。
        XCTAssertEqual(flushes, 1)
        XCTAssertTrue(diagramRequests().isEmpty)
        XCTAssertNil(router.diagramSource)
        XCTAssertNil(environment.diagrams.job(source))
        XCTAssertEqual(environment.notes.state.notice?.kind, .unsavedDraft)

        environment.notes.flushEditor = {
            flushes += 1
            return FlushResult(true)
        }
        await router.drawDiagramFromNote("n1").value
        XCTAssertEqual(flushes, 2)
        XCTAssertEqual(router.diagramSource, source)
        let request = try XCTUnwrap(diagramRequests().first)
        XCTAssertEqual(request.json?["source"], "note")
        XCTAssertEqual(request.json?["pageId"], "n1")
        XCTAssertEqual(request.jsonKeys, ["source", "pageId", "clientRequestId"])
        let requestId = try XCTUnwrap(request.json?["clientRequestId"]?.stringValue)
        XCTAssertTrue((8...64).contains(requestId.count))
        XCTAssertTrue(requestId.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
        guard case let .done(_, partial)? = environment.diagrams.job(source) else {
            return XCTFail("expected a finished job")
        }
        XCTAssertFalse(partial)

        // 已有任务时再点笔记菜单直接重开窗口，不重做保存（断网 / 保存冲突也能重开）。
        environment.notes.flushEditor = {
            flushes += 1
            return FlushResult(false)
        }
        await router.drawDiagramFromNote("n1").value
        XCTAssertEqual(flushes, 2)
        XCTAssertEqual(router.diagramSource, source)
        guard case let .done(page, _)? = environment.diagrams.job(source) else {
            return XCTFail("expected a finished job")
        }

        // 恢复可保存状态，再测试"打开白板"（切走当前笔记前会先 flush）。
        environment.notes.flushEditor = {
            flushes += 1
            return FlushResult(true)
        }
        // 打开白板：放进列表、展开那篇笔记、打开白板，窗口关掉并忘掉任务。
        router.openDrawnDiagram(page)
        XCTAssertNil(router.diagramSource)
        XCTAssertNil(environment.diagrams.job(source))
        XCTAssertTrue(environment.notes.state.expanded.contains("n1"))
        XCTAssertTrue(environment.notes.state.pages.contains { $0.id == "wb1" && $0.parentId == "n1" })
        await eventually { environment.notes.state.open?.id == "wb1" }
        XCTAssertEqual(environment.notes.state.open?.kind, .whiteboard)
    }

    func testTheAnswerMenuReopensTheSameJobAndANewOneStartsAfterClosing() async throws {
        let environment = try makeEnvironment()
        environment.start()
        defer { environment.stop() }
        let router = AppRouter(app: environment)
        let source = DiagramSource.answer(sessionId: "s1", messageId: "m1")
        let refreshes = log.all("GET", "/api/pages").count

        let first = router.drawDiagram(source)
        XCTAssertEqual(router.diagramSource, source)
        XCTAssertEqual(environment.diagrams.job(source), .working)
        // 关掉进行中的窗口再点：同一个任务，不再发。
        router.closeDiagram()
        XCTAssertNil(router.diagramSource)
        XCTAssertNil(router.drawDiagram(source))
        XCTAssertEqual(router.diagramSource, source)
        await first?.value
        XCTAssertEqual(diagramRequests().count, 1)
        let request = diagramRequests()[0]
        XCTAssertEqual(request.json?["source"], "answer")
        XCTAssertEqual(request.json?["messageId"], "m1")
        XCTAssertNil(request.json?["pageId"])
        // 新白板建好了：笔记列表刷新（网页 notefable:page-created）。
        await eventually { self.log.all("GET", "/api/pages").count > refreshes }

        // 关掉已结束的窗口：忘掉；再点是新的任务、新的 clientRequestId。
        router.closeDiagram()
        XCTAssertNil(environment.diagrams.job(source))
        await router.drawDiagram(source)?.value
        XCTAssertEqual(diagramRequests().count, 2)
        XCTAssertNotEqual(
            diagramRequests()[0].json?["clientRequestId"], diagramRequests()[1].json?["clientRequestId"]
        )
    }

    func testChangingIdentityClosesTheWindowAndDropsFinishedJobs() async throws {
        let environment = try makeEnvironment()
        let router = AppRouter(app: environment)
        let source = DiagramSource.answer(sessionId: "s1", messageId: "m1")
        await router.drawDiagram(source)?.value
        XCTAssertNotNil(environment.diagrams.job(source))
        environment.onIdentityChanged()
        router.onIdentityChanged()
        XCTAssertNil(router.diagramSource)
        XCTAssertNil(environment.diagrams.job(source))
    }
}
