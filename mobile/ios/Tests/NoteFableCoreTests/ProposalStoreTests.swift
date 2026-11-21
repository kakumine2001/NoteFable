import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

// 网页 page-edit-proposal.tsx 的状态规则：按提案 ID 记在卡片外，服务端已确定的状态优先，失败回到未处理并带错误。
final class ProposalStoreTests: XCTestCase {
    /// Activity 里的 Proposal 的替身：只带 Store 要看的那几项。
    private struct TestProposal: ProposalTarget {
        var id: String
        var status: String? = nil
        var editedPageId: String? = nil
        var appliedPageId: String? = nil
    }

    private let edit = TestProposal(id: "pr1", editedPageId: "p1")
    private let create = TestProposal(id: "np1")

    @MainActor
    private final class FakeBackend: ProposalBackend {
        var calls: [String] = []
        var gate: AsyncSignal?
        var fail: Error?
        var createdId: String? = "new-page"

        func apply(proposalId: String) async throws -> AppliedPage {
            calls.append("apply:\(proposalId)")
            await gate?.wait()
            if let fail { throw fail }
            return AppliedPage(id: createdId, json: createdId.map { #"{"id":"\#($0)","version":3}"# })
        }

        func discard(proposalId: String) async throws {
            calls.append("discard:\(proposalId)")
            await gate?.wait()
            if let fail { throw fail }
        }
    }

    @MainActor
    func testApplyingShowsASpinnerThenAppliedWithTheNoteToOpenAndAnnouncesTheChange() async {
        let backend = FakeBackend()
        backend.gate = AsyncSignal()
        let store = ProposalStore(backend: backend)
        var changes = store.changes().makeAsyncIterator()
        let task = store.apply(edit)
        XCTAssertEqual(store.stateOf(edit).status, .applying)
        XCTAssertTrue(store.stateOf(edit).busy)
        // 处理中再点不会重复请求。
        XCTAssertNil(store.apply(edit))
        XCTAssertNil(store.discard(edit))
        backend.gate?.signal()
        await task?.value
        XCTAssertEqual(backend.calls, ["apply:pr1"])
        XCTAssertEqual(store.stateOf(edit), ProposalState(status: .applied, pageId: "p1"))
        // 服务端返回的新版本跟着事件走，打开着的编辑器用它换成新版本。
        let change = await changes.next()
        XCTAssertEqual(change, ProposalChangeEvent(pageId: "p1", created: false, page: #"{"id":"new-page","version":3}"#))
    }

    @MainActor
    func testACreatedNoteOpensThePageTheServerMade() async {
        let store = ProposalStore(backend: FakeBackend())
        var changes = store.changes().makeAsyncIterator()
        await store.apply(create)?.value
        XCTAssertEqual(store.stateOf(create), ProposalState(status: .applied, pageId: "new-page"))
        let change = await changes.next()
        XCTAssertEqual(change?.created, true)
        XCTAssertEqual(change?.pageId, "new-page")
    }

    @MainActor
    func testAFailureGoesBackToIdleWithTheServerMessage() async {
        let backend = FakeBackend()
        backend.fail = ProposalException(serverMessage: "The note changed since this edit was proposed.")
        let store = ProposalStore(backend: backend)
        await store.apply(edit)?.value
        let state = store.stateOf(edit)
        XCTAssertEqual(state.status, .idle)
        XCTAssertEqual(state.error, ProposalError(action: .apply, serverMessage: "The note changed since this edit was proposed."))
        // 网络错误没有服务端原句，界面用本地的"无法应用"。
        backend.fail = URLError(.notConnectedToInternet)
        await store.discard(edit)?.value
        XCTAssertEqual(store.stateOf(edit).error, ProposalError(action: .discard, serverMessage: nil))
    }

    @MainActor
    func testTheStatusSavedOnTheServerWinsOverLocalState() async {
        let backend = FakeBackend()
        backend.fail = ProposalException(serverMessage: "x")
        let store = ProposalStore(backend: backend)
        await store.apply(edit)?.value
        var reloaded = edit
        reloaded.status = "discarded"
        XCTAssertEqual(store.stateOf(reloaded), ProposalState(status: .discarded, pageId: "p1"))
        // 已确定的提案不再发请求。
        XCTAssertNil(store.apply(reloaded))
        XCTAssertEqual(backend.calls, ["apply:pr1"])
        XCTAssertEqual(ProposalStore.initialState(TestProposal(id: "c", status: "applied", appliedPageId: "np2")).pageId, "np2")
    }

    @MainActor
    func testDiscardingSettlesTheCard() async {
        let backend = FakeBackend()
        let store = ProposalStore(backend: backend)
        await store.discard(edit)?.value
        XCTAssertEqual(store.stateOf(edit).status, .discarded)
        XCTAssertTrue(store.stateOf(edit).settled)
        XCTAssertNil(store.apply(edit))
        XCTAssertEqual(backend.calls, ["discard:pr1"])
    }

    func testApiPostsToApplyAndDiscardAndReadsTheCreatedPageId() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"status":"applied","page":{"id":"pg9","title":"Plan","version":4}}"#)
        server.enqueue(#"{"error":"The note changed."}"#, status: 409)
        server.enqueue("{}")
        let api = ProposalApi(http: makeApi(server).http)
        let applied = try await api.apply(proposalId: "np 1")
        XCTAssertEqual(applied.id, "pg9")
        XCTAssertEqual(applied.json, #"{"id":"pg9","title":"Plan","version":4}"#)
        let first = server.next()
        XCTAssertEqual(first.method, "POST")
        XCTAssertEqual(first.path, "/api/proposals/np%201/apply")
        XCTAssertEqual(first.body, Data())
        let error = await errorThrown(try await api.apply(proposalId: "pr1")) as? ProposalException
        XCTAssertEqual(error?.serverMessage, "The note changed.")
        try await api.discard(proposalId: "pr1")
        _ = server.next()
        XCTAssertEqual(server.next().path, "/api/proposals/pr1/discard")
    }

    func testReportsPostTheMessageAndATrimmedReason() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"ok":true}"#, status: 201)
        server.enqueue(#"{"error":"Sign in to report an answer."}"#, status: 401)
        let api = ReportApi(http: makeApi(server).http)
        try await api.reportAnswer(messageId: "m1", reason: "  wrong \n")
        let request = server.next()
        XCTAssertEqual(request.path, "/api/reports")
        XCTAssertNil(request.header("Origin"))
        XCTAssertEqual(request.json, ["messageId": "m1", "reason": "wrong"])
        let error = await errorThrown(try await api.reportAnswer(messageId: "m1", reason: "")) as? ApiException
        XCTAssertEqual(error?.message, "Sign in to report an answer.")
    }
}
