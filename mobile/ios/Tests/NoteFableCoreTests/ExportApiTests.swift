import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

// 回答的"…"菜单：存到笔记（POST /api/pages/from-answer）与下载对话（GET /api/sessions/:id/export），规则同网页 answer-actions.tsx。
// （Android 这个文件里菜单定位的那一条是界面层的，不在这里。）
final class ExportApiTests: XCTestCase {
    private func api(_ server: FakeTransport) -> ExportApi {
        ExportApi(http: makeApi(server).http)
    }

    func testSavesTheAnswerMarkdownWithItsChatMessageAndTheDeviceDate() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"page":{"id":"p1","title":"Plan"}}"#, status: 201)
        let id = try await api(server).saveAnswer(markdown: "# Plan\n\n- a", sessionId: "s1", messageId: "m1", savedOn: "2026-11-14")
        XCTAssertEqual(id, "p1")
        let request = server.next()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/api/pages/from-answer")
        XCTAssertEqual(request.json, ["markdown": "# Plan\n\n- a", "sessionId": "s1", "messageId": "m1", "savedOn": "2026-11-14"])
    }

    func testAResponseWithoutAPageIdIsAFailure() async {
        let server = FakeTransport()
        server.enqueue(#"{"ok":true}"#, status: 201)
        let error = await errorThrown(try await api(server).saveAnswer(markdown: "x", sessionId: "s1", messageId: "m1", savedOn: "2026-11-14"))
        XCTAssertTrue(error is ApiException)
        XCTAssertEqual(error.map(answerSaveError), AnswerSaveError())
    }

    func testDownloadsTheConversationExportWithAnEncodedChatId() async throws {
        let server = FakeTransport()
        server.enqueue(##"{"fileName":"Plan.md","markdown":"# Plan\n"}"##)
        let export = try await api(server).exportConversation(sessionId: "a b", date: "2026-11-14")
        XCTAssertEqual(export, ConversationExport(fileName: "Plan.md", markdown: "# Plan\n"))
        XCTAssertEqual(server.next().path, "/api/sessions/a%20b/export?date=2026-11-14")
    }

    func testExportErrorsCarryTheStatus() async {
        let server = FakeTransport()
        server.enqueue(#"{"error":"Session not found."}"#, status: 404)
        server.enqueue(#"{"fileName":"Empty.md","markdown":"  \n"}"#)
        let api = api(server)
        let missing = await errorThrown(try await api.exportConversation(sessionId: "s1", date: "2026-11-14")) as? ApiException
        XCTAssertEqual(missing?.status, 404)
        // 网页：没有消息就当作取不到会话。
        let empty = await errorThrown(try await api.exportConversation(sessionId: "s1", date: "2026-11-14")) as? ApiException
        XCTAssertEqual(empty?.status, 404)
    }

    func testSaveErrorsFollowTheWeb() {
        XCTAssertEqual(answerSaveError(ApiException.from(status: 413, body: #"{"error":"Note content exceeds 1 MiB."}"#)), AnswerSaveError(tooLarge: true))
        XCTAssertEqual(
            answerSaveError(ApiException.from(status: 400, body: #"{"error":"Invalid JSON request."}"#)),
            AnswerSaveError(serverMessage: "Invalid JSON request.")
        )
        XCTAssertEqual(answerSaveError(ApiException.from(status: 400, body: "not json")), AnswerSaveError())
        XCTAssertEqual(answerSaveError(ApiException.from(status: 503, body: #"{"error":"Database is unavailable."}"#)), AnswerSaveError())
        XCTAssertEqual(answerSaveError(URLError(.notConnectedToInternet)), AnswerSaveError())
    }

    @MainActor
    private final class FakeBackend: ExportBackend {
        var saves: [String] = []
        var gate: AsyncSignal?
        var fail: Error?
        var pages: [String] = []
        var pageGate: AsyncSignal?
        var pageFail: Error?

        func saveAnswer(markdown: String, sessionId: String, messageId: String, savedOn: String) async throws -> String {
            saves.append("\(sessionId)/\(messageId)")
            let number = saves.count
            await gate?.wait()
            if let fail { throw fail }
            return "page-\(number)"
        }

        func exportConversation(sessionId: String, date: String) async throws -> ConversationExport {
            ConversationExport(fileName: "a.md", markdown: "x")
        }

        func createPageFromChat(sessionId: String, model: String?, savedOn: String) async throws -> CreatedPage {
            pages.append("\(sessionId)/\(model ?? "nil")/\(savedOn)")
            let number = pages.count
            await pageGate?.wait()
            if let pageFail { throw pageFail }
            return CreatedPage(id: "note-\(number)", title: "Plan", partial: false)
        }
    }

    // ---- 整理成笔记（网页 create-page-dialog.tsx） ----

    func testCreatePagePostsTheModelAndTheDeviceDateAndReadsThePageAndPartial() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"page":{"id":"n1","title":"Plan"},"partial":true}"#, status: 201)
        let page = try await api(server).createPageFromChat(sessionId: "a b", model: "luna", savedOn: "2026-11-15")
        XCTAssertEqual(page, CreatedPage(id: "n1", title: "Plan", partial: true))
        let request = server.next()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/api/sessions/a%20b/page")
        XCTAssertEqual(request.json, ["model": "luna", "savedOn": "2026-11-15"])
        // 服务端最多生成 300 秒：不按普通请求的时限断开。
        XCTAssertEqual(request.request.timeout, HTTPTimeout(idle: nil, total: 320))
    }

    func testCreatePageWithoutAPageIdFailsAndAMissingModelIsLeftOut() async {
        let server = FakeTransport()
        server.enqueue(#"{"ok":true}"#, status: 201)
        let error = await errorThrown(try await api(server).createPageFromChat(sessionId: "s1", model: nil, savedOn: "2026-11-15"))
        XCTAssertTrue(error is ApiException)
        XCTAssertEqual(error.map(createPageErrorMessage), CREATE_PAGE_FAILED)
        XCTAssertEqual(server.next().jsonKeys, ["savedOn"])
    }

    @MainActor
    func testChangingIdentityKeepsARunningPageJobSoItIsNotSentTwiceThenDropsItsResult() async {
        let backend = FakeBackend()
        backend.pageGate = AsyncSignal()
        let store = AnswerExportStore(backend: backend)
        let job = store.createPage(sessionId: "s1", model: nil, savedOn: "2026-11-15")
        store.clearPageJobs()
        XCTAssertEqual(store.pageJobs["s1"], .working)
        XCTAssertNil(store.createPage(sessionId: "s1", model: nil, savedOn: "2026-11-15"))
        backend.pageGate?.signal()
        await job?.value
        XCTAssertEqual(backend.pages.count, 1)
        XCTAssertNil(store.pageJobs["s1"])
    }

    func testCreatePageErrorsFollowTheWeb() {
        XCTAssertEqual(createPageErrorMessage(ApiException.from(status: 429, body: #"{"error":"Daily limit reached."}"#)), "Daily limit reached.")
        XCTAssertEqual(
            createPageErrorMessage(ApiException.from(status: 400, body: #"{"error":"This chat has nothing to turn into a page yet."}"#)),
            "This chat has nothing to turn into a page yet."
        )
        XCTAssertEqual(createPageErrorMessage(ApiException.from(status: 413, body: #"{"error":"Note content exceeds 1 MiB."}"#)), "Note content exceeds 1 MiB.")
        XCTAssertEqual(createPageErrorMessage(ApiException.from(status: 404, body: #"{"error":"whatever"}"#)), "Session not found.")
        XCTAssertEqual(createPageErrorMessage(ApiException.from(status: 502, body: #"{"error":"Upstream down"}"#)), CREATE_PAGE_FAILED)
        XCTAssertEqual(createPageErrorMessage(ApiException.from(status: 400, body: "not json")), CREATE_PAGE_FAILED)
        XCTAssertEqual(createPageErrorMessage(URLError(.notConnectedToInternet)), CREATE_PAGE_FAILED)
    }

    @MainActor
    func testCreatePageRunsOncePerChatAnnouncesThePageAndClosingForgetsOnlyFinishedResults() async {
        let backend = FakeBackend()
        backend.pageGate = AsyncSignal()
        let store = AnswerExportStore(backend: backend)
        var created = store.created().makeAsyncIterator()
        let first = store.createPage(sessionId: "s1", model: "luna", savedOn: "2026-11-15")
        XCTAssertEqual(store.pageJobs["s1"], .working)
        // 进行中再点、关窗口：不重复建，也不忘掉。
        XCTAssertNil(store.createPage(sessionId: "s1", model: "luna", savedOn: "2026-11-15"))
        store.forgetFinishedPage(sessionId: "s1")
        XCTAssertEqual(store.pageJobs["s1"], .working)
        backend.pageGate?.signal()
        await first?.value
        XCTAssertEqual(backend.pages, ["s1/luna/2026-11-15"])
        XCTAssertEqual(store.pageJobs["s1"], .done(pageId: "note-1", title: "Plan", partial: false))
        // 关窗口后忘掉，下次能重新整理。
        store.forgetFinishedPage(sessionId: "s1")
        XCTAssertNil(store.pageJobs["s1"])
        // 失败：显示原因，可以重试；不发新笔记。
        backend.pageFail = ApiException.from(status: 429, body: #"{"error":"Daily limit reached."}"#)
        await store.createPage(sessionId: "s1", model: "luna", savedOn: "2026-11-15")?.value
        XCTAssertEqual(store.pageJobs["s1"], .failed(message: "Daily limit reached."))
        backend.pageFail = nil
        await store.createPage(sessionId: "s1", model: "luna", savedOn: "2026-11-15")?.value
        XCTAssertEqual(store.pageJobs["s1"], .done(pageId: "note-3", title: "Plan", partial: false))
        // 发出的只有成功的两篇，失败的那次没有。
        let firstCreated = await created.next()
        let secondCreated = await created.next()
        XCTAssertEqual([firstCreated, secondCreated], ["note-1", "note-3"])
        store.clearPageJobs()
        XCTAssertTrue(store.pageJobs.isEmpty)
    }

    @MainActor
    func testSavingShowsSavingThenSavedWithThePageAndNeverSavesTheSameAnswerTwice() async {
        let backend = FakeBackend()
        backend.gate = AsyncSignal()
        let store = AnswerExportStore(backend: backend)
        let key = AnswerExportStore.key("s1", "m1")
        let first = store.save(sessionId: "s1", messageId: "m1", markdown: "Hi", savedOn: "2026-11-14")
        XCTAssertEqual(store.saves[key], .saving)
        // 保存中再点：什么也不做。
        let again = await store.save(sessionId: "s1", messageId: "m1", markdown: "Hi", savedOn: "2026-11-14").value
        XCTAssertEqual(again, .pending)
        backend.gate?.signal()
        let result = await first.value
        XCTAssertEqual(result, .ok)
        XCTAssertEqual(store.saves[key], .saved(pageId: "page-1"))
        // 已保存再点：也不再建。
        let third = await store.save(sessionId: "s1", messageId: "m1", markdown: "Hi", savedOn: "2026-11-14").value
        XCTAssertEqual(third, .pending)
        XCTAssertEqual(backend.saves, ["s1/m1"])
        // 另一条回答各自保存。
        _ = await store.save(sessionId: "s1", messageId: "m2", markdown: "Other", savedOn: "2026-11-14").value
        XCTAssertEqual(backend.saves, ["s1/m1", "s1/m2"])
    }

    @MainActor
    func testAFailedSaveCanBeRetried() async {
        let backend = FakeBackend()
        backend.fail = ApiException.from(status: 413, body: "{}")
        let store = AnswerExportStore(backend: backend)
        let result = await store.save(sessionId: "s1", messageId: "m1", markdown: "Hi", savedOn: "2026-11-14").value
        XCTAssertEqual(result, .failed(AnswerSaveError(tooLarge: true)))
        XCTAssertTrue(store.saves.isEmpty)
        backend.fail = nil
        _ = await store.save(sessionId: "s1", messageId: "m1", markdown: "Hi", savedOn: "2026-11-14").value
        XCTAssertEqual(store.saves[AnswerExportStore.key("s1", "m1")], .saved(pageId: "page-2"))
    }

    @MainActor
    func testASaveKeepsItsStateWhenTheAnswersLocalIdIsReplacedByTheStoredId() async {
        // 已保存后换 ID：搬到新 ID 下，不能再存一次。
        let backend = FakeBackend()
        let store = AnswerExportStore(backend: backend)
        _ = await store.save(sessionId: "s1", messageId: "local-2", markdown: "Hi", savedOn: "2026-11-14").value
        store.rename(sessionId: "s1", from: "local-2", to: "cm1")
        XCTAssertEqual(store.saves, [AnswerExportStore.key("s1", "cm1"): .saved(pageId: "page-1")])
        let again = await store.save(sessionId: "s1", messageId: "cm1", markdown: "Hi", savedOn: "2026-11-14").value
        XCTAssertEqual(again, .pending)

        // 保存中换 ID：保存完成后记在新 ID 下。
        backend.gate = AsyncSignal()
        let pending = store.save(sessionId: "s1", messageId: "local-4", markdown: "Next", savedOn: "2026-11-14")
        store.rename(sessionId: "s1", from: "local-4", to: "cm2")
        XCTAssertEqual(store.saves[AnswerExportStore.key("s1", "cm2")], .saving)
        backend.gate?.signal()
        _ = await pending.value
        XCTAssertEqual(store.saves[AnswerExportStore.key("s1", "cm2")], .saved(pageId: "page-2"))
        XCTAssertNil(store.saves[AnswerExportStore.key("s1", "local-4")])
    }

    @MainActor
    func testAFinishedSaveAnnouncesTheNewPageSoTheNotesListRefreshes() async {
        let backend = FakeBackend()
        let store = AnswerExportStore(backend: backend)
        var created = store.created().makeAsyncIterator()
        _ = await store.save(sessionId: "s1", messageId: "m1", markdown: "Hi", savedOn: "2026-11-14").value
        // 失败不发。
        backend.fail = ApiException.from(status: 500, body: "{}")
        _ = await store.save(sessionId: "s1", messageId: "m2", markdown: "Hi", savedOn: "2026-11-14").value
        backend.fail = nil
        _ = await store.save(sessionId: "s1", messageId: "m3", markdown: "Hi", savedOn: "2026-11-14").value
        let first = await created.next()
        let second = await created.next()
        XCTAssertEqual([first, second], ["page-1", "page-3"])
    }

    @MainActor
    func testAHeldExportIsHandedOutOnce() {
        let store = AnswerExportStore(backend: FakeBackend())
        store.holdExport(sessionId: "s1", markdown: "# Chat")
        XCTAssertEqual(store.takeExport(sessionId: "s1"), "# Chat")
        XCTAssertNil(store.takeExport(sessionId: "s1"))
    }
}
