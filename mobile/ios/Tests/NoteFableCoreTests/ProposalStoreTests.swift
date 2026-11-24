import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

// 网页 page-proposal.tsx 的状态规则：按提案 ID 记在卡片外，服务端已确定的状态优先（已应用的只让本机的撤销结果盖过），
// 失败回到原来的状态并带错误。
final class ProposalStoreTests: XCTestCase {
    /// Activity 里的 Proposal 的替身：只带 Store 要看的那几项。
    private struct TestProposal: ProposalTarget {
        var id: String
        var status: String? = nil
        var editedPageId: String? = nil
        var appliedPageId: String? = nil
        var undoable: Bool = false
    }

    private let edit = TestProposal(id: "pr1", editedPageId: "p1")
    private let create = TestProposal(id: "np1")

    @MainActor
    private final class FakeBackend: ProposalBackend {
        var calls: [String] = []
        var gate: AsyncSignal?
        var fail: Error?
        var createdId: String? = "new-page"
        var undone = UndoneProposal()

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

        func undo(proposalId: String) async throws -> UndoneProposal {
            calls.append("undo:\(proposalId)")
            await gate?.wait()
            if let fail { throw fail }
            return undone
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
        XCTAssertTrue(store.stateOf(edit).pending)
        // 处理中再点不会重复请求。
        XCTAssertNil(store.apply(edit))
        XCTAssertNil(store.discard(edit))
        XCTAssertNil(store.undo(edit))
        backend.gate?.signal()
        await task?.value
        XCTAssertEqual(backend.calls, ["apply:pr1"])
        // 刚在这里应用的都能撤销。
        XCTAssertEqual(store.stateOf(edit), ProposalState(status: .applied, pageId: "p1", undoable: true))
        XCTAssertTrue(store.stateOf(edit).showsUndo)
        XCTAssertFalse(store.stateOf(edit).pending)
        XCTAssertEqual(store.stateOf(edit).openPageId(isEdit: true), "p1")
        // 服务端返回的新版本跟着事件走，打开着的编辑器用它换成新版本。
        let change = await changes.next()
        XCTAssertEqual(change, ProposalChangeEvent(pageId: "p1", created: false, page: #"{"id":"new-page","version":3}"#))
    }

    @MainActor
    func testACreatedNoteOpensThePageTheServerMade() async {
        let store = ProposalStore(backend: FakeBackend())
        var changes = store.changes().makeAsyncIterator()
        await store.apply(create)?.value
        XCTAssertEqual(store.stateOf(create), ProposalState(status: .applied, pageId: "new-page", undoable: true))
        let change = await changes.next()
        XCTAssertEqual(change?.created, true)
        XCTAssertEqual(change?.pageId, "new-page")
        XCTAssertEqual(change?.trashedIds, [])
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
        XCTAssertEqual(
            [ProposalError.Action.apply, .discard, .undo].map { ProposalError(action: $0, serverMessage: nil).fallbackKey },
            ["proposal_apply_failed", "proposal_discard_failed", "proposal_undo_failed"]
        )
    }

    @MainActor
    func testAProposalSettledElsewhereShowsTheServersStateInsteadOfOfferingApplyAgain() async {
        let backend = FakeBackend()
        backend.fail = ProposalException(serverMessage: "This change was undone.", finalStatus: "undone", pageId: "p1")
        let store = ProposalStore(backend: backend)
        await store.apply(edit)?.value
        XCTAssertEqual(store.stateOf(edit), ProposalState(status: .undone, pageId: "p1"))
        backend.fail = ProposalException(serverMessage: "This proposal was already applied.", finalStatus: "applied", pageId: "new-page", undoable: true)
        await store.discard(create)?.value
        // 服务端说能撤销时，撤销键照常出现。
        XCTAssertEqual(store.stateOf(create), ProposalState(status: .applied, pageId: "new-page", undoable: true))
        // 别处已经撤销过：撤销换成"已撤销"，不显示错误。
        backend.fail = ProposalException(serverMessage: "Note not found.", finalStatus: "undone", pageId: "new-page")
        await store.undo(create)?.value
        XCTAssertEqual(store.stateOf(create), ProposalState(status: .undone, pageId: "new-page"))
        // 放弃一个别处已应用的编辑提案：没带 pageId 时，"打开"仍指向被改的页面。
        backend.fail = ProposalException(serverMessage: "This proposal was already applied.", finalStatus: "applied")
        let otherEdit = TestProposal(id: "pr2", editedPageId: "p2")
        await store.discard(otherEdit)?.value
        XCTAssertEqual(store.stateOf(otherEdit).pageId, "p2")
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
        XCTAssertNil(store.undo(reloaded))
        XCTAssertEqual(backend.calls, ["apply:pr1"])
        XCTAssertEqual(ProposalStore.initialState(TestProposal(id: "c", status: "applied", appliedPageId: "np2")).pageId, "np2")
        // 应用失败留下的"未处理 + 错误"也不盖过别处应用后的"已应用"。
        reloaded.status = "applied"
        XCTAssertEqual(store.stateOf(reloaded), ProposalState(status: .applied, pageId: "p1"))
        XCTAssertFalse(store.stateOf(reloaded).showsUndo, "the server did not say it can be undone")
    }

    @MainActor
    func testDiscardingSettlesTheCard() async {
        let backend = FakeBackend()
        let store = ProposalStore(backend: backend)
        await store.discard(edit)?.value
        XCTAssertEqual(store.stateOf(edit).status, .discarded)
        XCTAssertTrue(store.stateOf(edit).settled)
        XCTAssertNil(store.stateOf(edit).openPageId(isEdit: true))
        XCTAssertNil(store.apply(edit))
        XCTAssertNil(store.undo(edit))
        XCTAssertEqual(backend.calls, ["discard:pr1"])
    }

    // ---- 撤销 ----

    @MainActor
    func testUndoingAnEditRestoresThePageAndAnnouncesItLikeApplying() async {
        let backend = FakeBackend()
        backend.undone = UndoneProposal(page: AppliedPage(id: "p1", json: #"{"id":"p1","version":5}"#))
        let store = ProposalStore(backend: backend)
        var changes = store.changes().makeAsyncIterator()
        // 还没应用的不能撤销。
        XCTAssertNil(store.undo(edit))
        await store.apply(edit)?.value
        _ = await changes.next()

        backend.gate = AsyncSignal()
        let task = store.undo(edit)
        let undoing = store.stateOf(edit)
        XCTAssertEqual(undoing.status, .undoing)
        XCTAssertTrue(undoing.busy)
        XCTAssertTrue(undoing.showsUndo, "the undo button turns into a spinner")
        XCTAssertFalse(undoing.pending, "no Apply / Discard while undoing")
        XCTAssertTrue(undoing.settled, "undoing counts as settled, as on the web")
        XCTAssertEqual(undoing.openPageId(isEdit: true), "p1", "the edited page stays open-able while undoing")
        XCTAssertNil(undoing.openPageId(isEdit: false), "a created page is on its way to the Trash")
        // 撤销中再点不会重复请求，也不能应用 / 放弃。
        XCTAssertNil(store.undo(edit))
        XCTAssertNil(store.apply(edit))
        XCTAssertNil(store.discard(edit))
        backend.gate?.signal()
        await task?.value

        XCTAssertEqual(backend.calls, ["apply:pr1", "undo:pr1"])
        let undone = store.stateOf(edit)
        XCTAssertEqual(undone, ProposalState(status: .undone, pageId: "p1"))
        XCTAssertTrue(undone.settled)
        XCTAssertFalse(undone.showsUndo)
        // 撤销过的编辑提案还能打开那个页面（内容恢复了）。
        XCTAssertEqual(undone.openPageId(isEdit: true), "p1")
        // 和应用后一样：刷新列表，开着的编辑器换成恢复后的版本。
        let change = await changes.next()
        XCTAssertEqual(change, ProposalChangeEvent(pageId: "p1", created: false, page: #"{"id":"p1","version":5}"#))
        XCTAssertNil(store.apply(edit))
        XCTAssertNil(store.undo(edit))
    }

    @MainActor
    func testUndoingANewPageMovesItAndItsSubpagesToTheTrash() async {
        let backend = FakeBackend()
        backend.undone = UndoneProposal(trashedIds: ["new-page", "child"])
        let store = ProposalStore(backend: backend)
        var changes = store.changes().makeAsyncIterator()
        await store.apply(create)?.value
        _ = await changes.next()
        await store.undo(create)?.value
        let state = store.stateOf(create)
        XCTAssertEqual(state.status, .undone)
        // 页面在回收站里：不给"打开"。
        XCTAssertNil(state.openPageId(isEdit: false))
        let change = await changes.next()
        XCTAssertEqual(change, ProposalChangeEvent(pageId: "new-page", created: false, trashedIds: ["new-page", "child"]))
    }

    @MainActor
    func testAFailedUndoStaysAppliedWithTheReasonAndCanBeTriedAgain() async {
        let backend = FakeBackend()
        let store = ProposalStore(backend: backend)
        // 服务端说已应用、能撤销（例如页面 AI 面板自动应用的）。
        let applied = TestProposal(id: "pr2", status: "applied", editedPageId: "p2", undoable: true)
        XCTAssertEqual(store.stateOf(applied), ProposalState(status: .applied, pageId: "p2", undoable: true))
        XCTAssertTrue(store.stateOf(applied).showsUndo)

        let sentence = "This page changed after the AI edit. Restore an earlier version from the page history."
        backend.fail = ProposalException(serverMessage: sentence)
        await store.undo(applied)?.value
        var state = store.stateOf(applied)
        XCTAssertEqual(state, ProposalState(status: .applied, error: ProposalError(action: .undo, serverMessage: sentence), pageId: "p2", undoable: true))
        XCTAssertTrue(state.showsUndo)
        // 断网没有服务端原句：界面用本地的"无法撤销"。
        backend.fail = URLError(.notConnectedToInternet)
        await store.undo(applied)?.value
        XCTAssertEqual(store.stateOf(applied).error, ProposalError(action: .undo, serverMessage: nil))

        backend.fail = nil
        await store.undo(applied)?.value
        state = store.stateOf(applied)
        XCTAssertEqual(state.status, .undone)
        XCTAssertNil(state.error)
        XCTAssertEqual(backend.calls, ["undo:pr2", "undo:pr2", "undo:pr2"])
    }

    @MainActor
    func testAnUndoMadeHereOutlivesAnOlderAppliedStatusButNotTheServersUndoneOrDiscarded() async {
        let store = ProposalStore(backend: FakeBackend())
        let applied = TestProposal(id: "pr3", status: "applied", editedPageId: "p3", undoable: true)
        await store.undo(applied)?.value
        // 重读的历史还是"已应用"（读在撤销之前）：用本机撤销的结果。
        XCTAssertEqual(store.stateOf(applied).status, .undone)
        // 服务端说已撤销、已放弃的以服务端为准。
        let undone = TestProposal(id: "pr3", status: "undone", editedPageId: "p3")
        XCTAssertEqual(store.stateOf(undone), ProposalState(status: .undone, pageId: "p3"))
        XCTAssertEqual(store.stateOf(TestProposal(id: "pr3", status: "discarded", editedPageId: "p3")).status, .discarded)
        // 没保存过的状态（还在流里）用本机的。
        XCTAssertEqual(store.stateOf(TestProposal(id: "pr3", editedPageId: "p3")).status, .undone)
        // 撤销过的新建提案：服务端的状态里也没有"打开"。
        XCTAssertNil(ProposalStore.initialState(TestProposal(id: "np3", status: "undone", appliedPageId: "n3")).openPageId(isEdit: false))
        XCTAssertEqual(ProposalStore.initialState(TestProposal(id: "np3", status: "undone", appliedPageId: "n3")).pageId, "n3")
    }

    // ---- 接口 ----

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

    func testApiUndoReadsTheRestoredPageOrTheTrashedPages() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"status":"undone","kind":"edit","page":{"id":"p1","title":"Plan","version":6}}"#)
        server.enqueue(#"{"status":"undone","kind":"create","ids":["n1","n2",3]}"#)
        server.enqueue(#"{"status":"undone","kind":"create","ids":[]}"#)
        server.enqueue(#"{"error":"This page changed after the AI edit. Restore an earlier version from the page history."}"#, status: 409)
        server.enqueue("not json", status: 404)
        let api = ProposalApi(http: makeApi(server).http)

        let edit = try await api.undo(proposalId: "pr 1")
        XCTAssertEqual(edit, UndoneProposal(page: AppliedPage(id: "p1", json: #"{"id":"p1","title":"Plan","version":6}"#)))
        let request = server.next()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/api/proposals/pr%201/undo")
        XCTAssertEqual(request.body, Data())
        // 新建提案：移进回收站的页面（不是字符串的项跳过）。
        let created = try await api.undo(proposalId: "np1")
        XCTAssertEqual(created, UndoneProposal(trashedIds: ["n1", "n2"]))
        XCTAssertEqual(server.next().path, "/api/proposals/np1/undo")
        // 已经撤销过：同样成功，没有页面要移。
        let again = try await api.undo(proposalId: "np1")
        XCTAssertEqual(again, UndoneProposal())

        let conflict = await errorThrown(try await api.undo(proposalId: "pr1")) as? ProposalException
        XCTAssertEqual(conflict?.serverMessage, "This page changed after the AI edit. Restore an earlier version from the page history.")
        let missing = await errorThrown(try await api.undo(proposalId: "pr1")) as? ProposalException
        XCTAssertEqual(missing, ProposalException(serverMessage: nil))
    }

    func testReportsPostExactlyOneTargetAndATrimmedReason() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"ok":true}"#, status: 201)
        server.enqueue(#"{"ok":true}"#, status: 201)
        server.enqueue(#"{"ok":true}"#, status: 201)
        server.enqueue(#"{"error":"This content is no longer available."}"#, status: 404)
        let api = ReportApi(http: makeApi(server).http)

        try await api.report(.answer(messageId: "m1"), reason: "  wrong \n")
        let answer = server.next()
        XCTAssertEqual(answer.method, "POST")
        XCTAssertEqual(answer.path, "/api/reports")
        XCTAssertNil(answer.header("Origin"))
        XCTAssertEqual(answer.json, ["messageId": "m1", "reason": "wrong"])

        try await api.report(.proposal(proposalId: "pr1"), reason: "")
        XCTAssertEqual(server.next().json, ["proposalId": "pr1", "reason": ""])

        try await api.report(.page(pageId: "pg1"), reason: " Made up facts ")
        XCTAssertEqual(server.next().json, ["pageId": "pg1", "reason": "Made up facts"])

        let error = await errorThrown(try await api.report(.page(pageId: "gone"), reason: "")) as? ApiException
        XCTAssertEqual(error?.status, 404)
        XCTAssertEqual(error?.message, "This content is no longer available.")
    }

    func testTheReportWindowNamesAnswersAndOtherAIContentDifferently() {
        XCTAssertEqual(ReportTarget.answer(messageId: "m").titleKey, "report_title")
        XCTAssertEqual(ReportTarget.answer(messageId: "m").helpKey, "report_help")
        for target in [ReportTarget.proposal(proposalId: "p"), .page(pageId: "g")] {
            XCTAssertEqual(target.titleKey, "report_ai_content")
            XCTAssertEqual(target.helpKey, "report_ai_help")
        }
    }
}
