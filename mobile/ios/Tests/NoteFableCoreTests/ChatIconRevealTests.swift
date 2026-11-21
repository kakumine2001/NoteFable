import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

/// 聊天图标（草稿图标、保存排队、失败退回）。Android `ChatIconTest` 里 ViewModel 的部分
/// （表情选择器的排版在界面层，不在 Core）。
final class ChatIconTests: XCTestCase {
    @MainActor
    private final class Saver {
        var calls: [[String?]] = []
        var result = true
        var gate: ChatDeferred<Void>?
        var onSaved: (String, String?) -> Void = { _, _ in }

        func save(_ id: String, _ icon: String?) async -> Bool {
            calls.append([id, icon])
            if let gate { _ = try? await gate.value() }
            if result { onSaved(id, icon) }
            return result
        }
    }

    /// 会话列表在 `sessions` 盒子里，测试中途可以换。
    @MainActor
    private func newBackend(_ sessions: ChatTestBox<[SessionSummary]>) -> ChatFakeBackend {
        let backend = ChatFakeBackend(models: ModelsResponse(defaultModel: "a", models: []))
        backend.sessionsHandler = { _ in sessions.value }
        backend.baseUrl = ""
        return backend
    }

    @MainActor
    private func newViewModel(_ backend: ChatFakeBackend, _ saver: Saver, _ clock: ChatTestClock) async -> ChatViewModel {
        let vm = makeChatViewModel(backend, clock: clock, saveIcon: { id, icon in await saver.save(id, icon) })
        await clock.advanceUntilIdle()
        return vm
    }

    @MainActor
    func testADraftIconOnAnUnsavedChatIsSavedToTheSessionTheFirstReplyCreates() async {
        let clock = ChatTestClock()
        let sessions = ChatTestBox<[SessionSummary]>([])
        let backend = newBackend(sessions)
        // 保存成功后服务端的列表里就有这个图标。
        let saver = Saver()
        saver.onSaved = { id, icon in
            sessions.value = sessions.value.map { session in
                guard session.id == id else { return session }
                var saved = session
                saved.icon = icon
                return saved
            }
        }
        let vm = await newViewModel(backend, saver, clock)

        vm.changeIcon("🧪")
        XCTAssertEqual(vm.state.draftIcon, "🧪")
        XCTAssertEqual(vm.state.activeIcon, "🧪")
        XCTAssertEqual(saver.calls, [])

        sessions.value = [SessionSummary(id: "s1", title: "New chat")]
        vm.send("hi")
        backend.events.send(.started(sessionId: "s1"))
        await clock.advance(by: 100)

        XCTAssertEqual(saver.calls, [["s1", "🧪"]])
        XCTAssertNil(vm.state.draftIcon)
        // 刷新回来的列表里保存过的值不会被冲掉。
        XCTAssertEqual(vm.state.sessions.filter { $0.id == "s1" }.map(\.icon), ["🧪"])
        backend.events.close()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testAChatMadeFromAProjectKeepsTheCarriedDraftIconFromTheFirstFrame() async {
        let clock = ChatTestClock()
        let backend = newBackend(ChatTestBox([]))
        let saver = Saver()
        let gate = ChatDeferred<Void>()
        saver.gate = gate
        let vm = await newViewModel(backend, saver, clock)
        vm.changeIcon("📚")

        vm.openCreatedSession(SessionSummary(id: "p1", title: "New chat"))
        // 保存还没开始（也还没结束），新行和标题已经是带过来的图标。
        XCTAssertEqual(vm.state.sessions.filter { $0.id == "p1" }.map(\.icon), ["📚"])
        XCTAssertEqual(vm.state.activeIcon, "📚")
        XCTAssertNil(vm.state.draftIcon)

        gate.complete()
        await clock.advanceUntilIdle()
        XCTAssertEqual(saver.calls, [["p1", "📚"]])
        XCTAssertEqual(vm.state.activeIcon, "📚")
    }

    @MainActor
    func testTheIconFailureNoticeIsClearedWhenAnotherChatIsOpened() async {
        let clock = ChatTestClock()
        let backend = newBackend(ChatTestBox([SessionSummary(id: "s1", title: "One"), SessionSummary(id: "s2", title: "Two")]))
        let saver = Saver()
        saver.result = false
        let vm = await newViewModel(backend, saver, clock)
        vm.changeSessionIcon("s1", "📕")
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.notice, .iconFailed)

        vm.openSession("s2")
        XCTAssertNil(vm.state.notice)

        vm.changeSessionIcon("s1", "📕")
        await clock.advanceUntilIdle()
        vm.newChat()
        XCTAssertNil(vm.state.notice)
    }

    @MainActor
    func testOpeningAnotherChatDropsTheDraftIcon() async {
        let clock = ChatTestClock()
        let backend = newBackend(ChatTestBox([SessionSummary(id: "old", title: "Old")]))
        let vm = await newViewModel(backend, Saver(), clock)
        vm.changeIcon("🎒")
        vm.openSession("old")
        await clock.advanceUntilIdle()
        XCTAssertNil(vm.state.draftIcon)
    }

    @MainActor
    func testAFailedSavePutsTheLastSavedIconBackAndShowsTheComposerNotice() async {
        let clock = ChatTestClock()
        let backend = newBackend(ChatTestBox([SessionSummary(id: "s1", title: "Chat", icon: "📘")]))
        let saver = Saver()
        saver.result = false
        let vm = await newViewModel(backend, saver, clock)
        vm.openSession("s1")
        await clock.advanceUntilIdle()

        vm.changeIcon("📕")
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.activeIcon, "📘")
        XCTAssertEqual(vm.state.notice, .iconFailed)
    }

    @MainActor
    func testQuickChangesOnlySendTheLatestIconAndSurviveAStaleListRefresh() async {
        let clock = ChatTestClock()
        let backend = newBackend(ChatTestBox([SessionSummary(id: "s1", title: "Chat")]))
        let saver = Saver()
        let gate = ChatDeferred<Void>()
        saver.gate = gate
        let vm = await newViewModel(backend, saver, clock)

        vm.changeSessionIcon("s1", "1️⃣")
        await clock.runCurrent()
        vm.changeSessionIcon("s1", "2️⃣")
        vm.changeSessionIcon("s1", "3️⃣")
        await clock.runCurrent()
        // 旧列表（没有图标）在保存期间回来。
        vm.refreshSessions()
        await clock.runCurrent()
        XCTAssertEqual(vm.state.sessions.map(\.icon), ["3️⃣"])

        gate.complete()
        await clock.advanceUntilIdle()
        XCTAssertEqual(saver.calls, [["s1", "1️⃣"], ["s1", "3️⃣"]])
        XCTAssertEqual(vm.state.sessions.map(\.icon), ["3️⃣"])
    }

    @MainActor
    func testIconSyncReconcilesOnlyEditsMadeAfterTheRefreshStarted() async {
        let sync = SessionIconSync { _, _ in true }
        let shown = ChatTestBox<[String: String?]>([:])
        let before = sync.mark()
        await sync.change("a", "🍎", current: nil, show: { shown.value["a"] = $0 }, fail: {})
        let after = sync.mark()
        let fetched = [SessionSummary(id: "a", title: "A"), SessionSummary(id: "b", title: "B", icon: "🍌")]
        XCTAssertEqual(shown.value["a"], "🍎")
        XCTAssertEqual(sync.reconcile(fetched, startedAt: before)[0].icon, "🍎")
        // 改动结束后才开始的刷新以服务端为准。
        XCTAssertNil(sync.reconcile(fetched, startedAt: after)[0].icon)
        XCTAssertEqual(sync.reconcile(fetched, startedAt: before)[1].icon, "🍌")
    }
}

/// 检索结果 / 链接打开聊天时的定位请求，以及链接 ID 不对时的提示。Android `ChatRevealTest` 的移植。
final class ChatRevealTests: XCTestCase {
    @MainActor
    private func newBackend() -> ChatFakeBackend {
        let backend = ChatFakeBackend(models: ModelsResponse(defaultModel: "a"))
        backend.sessionsHandler = { _ in [SessionSummary(id: "s1", title: "One"), SessionSummary(id: "s2", title: "Two")] }
        backend.stored = [chatDto("m1", "USER", "q"), chatDto("m2", "ASSISTANT", "a")]
        backend.streamHandler = { _ in AsyncThrowingStream { $0.finish() } }
        backend.baseUrl = ""
        return backend
    }

    @MainActor
    func testOpeningAtAMessageKeepsARevealRequestUntilTheScreenConsumesIt() async throws {
        let clock = ChatTestClock()
        let vm = makeChatViewModel(newBackend(), clock: clock)
        vm.openSessionAt("s1", messageId: "m2")
        await clock.advanceUntilIdle()
        let reveal = try XCTUnwrap(vm.state.reveal)
        XCTAssertEqual([reveal.sessionId, reveal.messageId], ["s1", "m2"])
        XCTAssertEqual(vm.state.messages.count, 2)
        vm.consumeReveal(reveal.token - 1)
        XCTAssertEqual(vm.state.reveal, reveal)
        vm.consumeReveal(reveal.token)
        XCTAssertNil(vm.state.reveal)

        // 同一个聊天再定位一次：新的 token。
        vm.openSessionAt("s1", messageId: "m1")
        let again = try XCTUnwrap(vm.state.reveal)
        XCTAssertEqual(again.messageId, "m1")
        XCTAssertEqual(again.token, reveal.token + 1)
        // 换到别的聊天就作废。
        vm.openSession("s2")
        XCTAssertNil(vm.state.reveal)
        vm.openSessionAt("s1", messageId: nil)
        await clock.advanceUntilIdle()
        XCTAssertNil(vm.state.reveal)
    }

    @MainActor
    func testAnInvalidLinkReturnsToANewChatWithTheLoadErrorUntilTheNextNavigation() async {
        let clock = ChatTestClock()
        let vm = makeChatViewModel(newBackend(), clock: clock)
        vm.openSession("s1")
        await clock.advanceUntilIdle()
        vm.showLinkFailed()
        XCTAssertNil(vm.state.activeSessionId)
        XCTAssertEqual(vm.state.notice, .linkFailed)
        vm.openSession("s2")
        XCTAssertNil(vm.state.notice)
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testAHitMissingFromTheOpenChatsCachedHistoryReloadsItBeforeRevealing() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = makeChatViewModel(backend, clock: clock)
        vm.openSession("s1")
        await clock.advanceUntilIdle()
        let before = backend.messageCalls.count
        backend.stored.append(chatDto("m3", "USER", "from another device"))
        vm.openSessionAt("s1", messageId: "m3")
        // 重读完成前保持"读取中"，界面不会把它当成不存在的消息。
        XCTAssertTrue(vm.state.messagesLoading)
        await clock.advanceUntilIdle()
        XCTAssertEqual(backend.messageCalls.count, before + 1)
        XCTAssertEqual(vm.state.reveal?.messageId, "m3")
        XCTAssertEqual(vm.state.messages.count, 3)
        // 已经在本地的消息不重读。
        vm.openSessionAt("s1", messageId: "m1")
        await clock.advanceUntilIdle()
        XCTAssertEqual(backend.messageCalls.count, before + 1)
    }
}

/// 回答失败时显示的原因。Android `ChatFailureDetailTest` 的移植。
final class ChatFailureDetailTests: XCTestCase {
    private struct IllegalState: Error {}

    func testConnectionFailuresUseTheDictionarySentence() {
        XCTAssertEqual(chatFailureDetail(URLError(.cannotConnectToHost)), CONNECTION_FAILED)
        XCTAssertEqual(chatFailureDetail(URLError(.cannotFindHost)), CONNECTION_FAILED)
        XCTAssertEqual(chatFailureDetail(URLError(.timedOut)), CONNECTION_FAILED)
        XCTAssertEqual(chatFailureDetail(URLError(.networkConnectionLost)), CONNECTION_FAILED)
        XCTAssertEqual(chatFailureDetail(URLError(.notConnectedToInternet)), CONNECTION_FAILED)
        XCTAssertEqual(chatFailureDetail(URLError(.secureConnectionFailed)), CONNECTION_FAILED)
    }

    func testServerAndOtherErrorsKeepTheirOwnText() {
        XCTAssertEqual(chatFailureDetail(ApiException(status: 404, message: "Note not found.")), "Note not found.")
        XCTAssertEqual(chatFailureDetail(ChatTurnError("Failed to generate image.")), "Failed to generate image.")
        XCTAssertEqual(chatFailureDetail(IllegalState()), "IllegalState")
    }
}

/// ChatViewModel 旁边的纯函数（Android 的 AttachUi.kt / ChatRecentNotes.kt 里不依赖界面的部分）。
final class ChatViewModelSupportTests: XCTestCase {
    func testPickedFilesWinOverTheCameraAndAnEmptyCameraFileIsIgnored() {
        XCTAssertEqual(pickedAttachmentSources(["a", "b"], cameraTarget: "camera") { _ in true }, ["a", "b"])
        XCTAssertEqual(pickedAttachmentSources([], cameraTarget: "camera") { _ in true }, ["camera"])
        XCTAssertEqual(pickedAttachmentSources([], cameraTarget: "camera") { _ in false }, [])
        XCTAssertEqual(pickedAttachmentSources([String](), cameraTarget: nil) { _ in true }, [])
    }

    func testTogglingANoteRemovesAddsOrLeavesTheFullSelectionAlone() {
        let a = ChatProjectNote(id: "a", title: "A")
        let b = ChatProjectNote(id: "b", title: "B")
        XCTAssertEqual(toggleAttachedNote([a], a, max: 2), [])
        XCTAssertEqual(toggleAttachedNote([a], b, max: 2), [a, b])
        XCTAssertEqual(toggleAttachedNote([a], b, max: 1), [a])
    }

    func testRecentNotesAreTheFourLatestAndFullSelectionsOnlyAllowRemoving() {
        let pages = (1...6).map { NotePageSummary(id: "p\($0)", title: "P\($0)", updatedAt: "2026-01-0\($0)") }
        XCTAssertEqual(recentChatNotes(pages).map(\.id), ["p6", "p5", "p4", "p3"])
        let full = (1...MAX_MESSAGE_NOTES).map { ChatProjectNote(id: "p\($0)", title: "") }
        XCTAssertTrue(canToggleRecentNote("p1", selected: full, enabled: true))
        XCTAssertFalse(canToggleRecentNote("p6", selected: full, enabled: true))
        XCTAssertFalse(canToggleRecentNote("p1", selected: [], enabled: false))
    }

    func testDataUrlsYieldTheirBytesAndPlainUrlsDoNot() {
        XCTAssertEqual(dataUrlBytes("data:image/png;base64,AAEC"), Data([0, 1, 2]))
        XCTAssertNil(dataUrlBytes("https://example.test/a.png"))
    }
}
