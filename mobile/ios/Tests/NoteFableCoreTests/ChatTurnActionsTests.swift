import Foundation
import XCTest
@testable import NoteFableCore

/// 重新生成、编辑、版本切换、分支，以及停止后与服务端对账（网页 page.tsx 的 rerunTurn / showVersion / branchChat / finishStoppedStream）。
/// Android `ChatTurnActionsTest` 的移植。
final class ChatTurnActionsTests: XCTestCase {
    @MainActor
    private func newBackend() -> ChatFakeBackend {
        let backend = ChatFakeBackend()
        backend.storedBySession = ["s1": [
            chatDto("u1", "USER", "question"),
            chatDto("a1", "ASSISTANT", "first answer"),
            chatDto("u2", "USER", "follow-up"),
            chatDto("a2", "ASSISTANT", "second answer"),
        ]]
        backend.sessionsHandler = { _ in [SessionSummary(id: "s1", title: "Chat")] }
        return backend
    }

    @MainActor
    private func openChat(_ backend: ChatFakeBackend, _ clock: ChatTestClock) async -> ChatViewModel {
        let vm = makeChatViewModel(backend, clock: clock)
        await clock.advanceUntilIdle()
        vm.openSession("s1")
        await clock.advanceUntilIdle()
        return vm
    }

    @MainActor
    private func contents(_ vm: ChatViewModel) -> [String] {
        vm.state.messages.map(\.content)
    }

    /// 服务端把最后一条换成新版本 a3。
    @MainActor
    private func storeNewVersion(_ backend: ChatFakeBackend, _ content: String, activity: String? = nil) {
        let kept = (backend.storedBySession?["s1"] ?? []).dropLast()
        backend.storedBySession?["s1"] = kept + [
            chatDto("a3", "ASSISTANT", content, activity: activity, versions: MessageVersions(index: 2, total: 2, prevId: "a2")),
        ]
    }

    @MainActor
    func testRegeneratingReplacesTheAnswerAndWhatFollowedAndAsksTheServerForANewVersion() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await openChat(backend, clock)

        vm.regenerate("a1")
        // 这条回答和它后面的对话先从画面上拿掉，换成等待中的新回答。
        XCTAssertEqual(contents(vm), ["question", ""])
        XCTAssertTrue(vm.state.sending)
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "better answer"))
        await clock.settle()
        XCTAssertEqual(backend.requests.count, 1)
        let request = backend.requests.first
        XCTAssertEqual(request?.regenerate, "a1")
        XCTAssertNil(request?.edit)
        XCTAssertEqual(request?.sessionId, "s1")

        backend.storedBySession?["s1"] = [
            chatDto("u1", "USER", "question"),
            chatDto("a3", "ASSISTANT", "better answer", versions: MessageVersions(index: 2, total: 2, prevId: "a1")),
        ]
        backend.events.close()
        await clock.advanceUntilIdle()
        XCTAssertEqual(contents(vm), ["question", "better answer"])
        XCTAssertEqual(vm.state.messages.last?.versions, MessageVersions(index: 2, total: 2, prevId: "a1"))
        XCTAssertFalse(vm.state.sending)
    }

    @MainActor
    func testEditingSendsTheNewTextForThatMessageAndKeepsItsAttachmentsOnScreen() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await openChat(backend, clock)

        vm.editMessage("u2", text: "  rewritten  ")
        XCTAssertEqual(contents(vm), ["question", "first answer", "rewritten", ""])
        backend.events.send(.started(sessionId: "s1"))
        await clock.settle()
        XCTAssertEqual(backend.requests.count, 1)
        let request = backend.requests.first
        XCTAssertEqual(request?.edit, "u2")
        XCTAssertEqual(request?.message, "rewritten")
        XCTAssertNil(request?.regenerate)
        // 输入栏里的草稿不受影响。
        XCTAssertEqual(vm.draft, "")
        backend.events.close()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testOnlyAnswersCanBeRegeneratedAndOnlyOwnMessagesEdited() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await openChat(backend, clock)

        vm.regenerate("u1")
        vm.editMessage("a1", text: "x")
        vm.editMessage("u1", text: "   ")
        vm.regenerate("missing")
        await clock.advanceUntilIdle()
        XCTAssertTrue(backend.requests.isEmpty)
        XCTAssertEqual(vm.state.messages.count, 4)
    }

    @MainActor
    func testARegenerationRefusedBeforeItStartsPutsTheConversationBackAndSaysWhy() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.streamError = ApiException(status: 429, message: "You’ve reached today’s limit.", code: "usage_limit", tier: "guest", kind: "chat")
        let vm = await openChat(backend, clock)
        vm.updateDraft("typing something else")

        vm.regenerate("a2")
        await clock.advanceUntilIdle()
        XCTAssertEqual(contents(vm), ["question", "first answer", "follow-up", "second answer"])
        XCTAssertEqual(vm.state.notice, .failed(detail: "You’ve reached today’s limit."))
        XCTAssertEqual(vm.state.guestLimit, "chat")
        // 被拒的不是输入栏里的提问：草稿不动。
        XCTAssertEqual(vm.draft, "typing something else")
    }

    @MainActor
    func testStopAsksTheServerAndTheAnswerThenEndsLikeAFinishedOne() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.stopAcknowledged = true
        let vm = await openChat(backend, clock)

        vm.regenerate("a2")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "half an"))
        await clock.settle()
        vm.stop()
        await clock.runCurrent()
        // 不取消请求：等服务端存好、自己结束流。这期间停止键不能再点。
        XCTAssertEqual(backend.stops, ["s1"])
        XCTAssertTrue(vm.state.sending)
        XCTAssertTrue(vm.state.stopping)
        vm.stop()
        await clock.runCurrent()
        XCTAssertEqual(backend.stops, ["s1"])

        storeNewVersion(backend, "half an")
        backend.events.close()
        await clock.runCurrent()
        XCTAssertNil(vm.state.characterOutcome)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.messages.last?.id, "a3")
        XCTAssertNil(vm.state.characterOutcome)
        XCTAssertFalse(vm.state.sending)
        XCTAssertFalse(vm.state.stopping)
    }

    @MainActor
    func testARegeneratedStreamThatEmitsFailureBeforeClosingFlashesErrorInsteadOfCompleted() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await openChat(backend, clock)

        vm.regenerate("a2")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "Partial\n\nRequest failed: Upstream reset."))
        backend.events.send(chatActivity(#"{"type":"failure","id":"request-failure","offset":9,"detail":"Upstream reset."}"#))
        storeNewVersion(
            backend, "Partial\n\nRequest failed: Upstream reset.",
            activity: #"[{"id":"request-failure","kind":"failure","offset":9,"detail":"Upstream reset."}]"#
        )
        backend.events.close()
        await clock.runCurrent()
        await clock.advance(by: 100)

        XCTAssertEqual(vm.state.characterOutcome, .error)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .error)
        XCTAssertEqual(vm.state.messages.last?.content, "Partial\n\nRequest failed: Upstream reset.")

        await clock.advanceUntilIdle()
        XCTAssertNil(vm.state.characterOutcome)
    }

    @MainActor
    func testARejectedEditReopensTheEditorWithTheRewrittenText() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.streamError = ChatTestError("offline")
        let vm = await openChat(backend, clock)

        vm.editMessage("u2", text: "rewritten")
        await clock.advanceUntilIdle()
        XCTAssertEqual(contents(vm), ["question", "first answer", "follow-up", "second answer"])
        XCTAssertEqual(vm.state.rejectedEdit, RejectedEdit(messageId: "u2", text: "rewritten"))
        XCTAssertEqual(vm.state.notice, .failed(detail: "offline"))
        vm.dismissRejectedEdit()
        XCTAssertNil(vm.state.rejectedEdit)
    }

    @MainActor
    func testWhenTheServerCannotBeAskedToStopThePartialAnswerIsAdoptedOnceItShowsUp() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await openChat(backend, clock)

        vm.regenerate("a2")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "half an"))
        await clock.settle()
        vm.stop()
        await clock.runCurrent()
        // 服务端还没存好，原来的回答（a2）还显示着：它不是新存下的回答，本机这半截留着。
        await clock.advance(by: 700)
        XCTAssertEqual(vm.state.messages.last?.content, "half an")
        XCTAssertEqual(vm.state.messages.last?.id.hasPrefix("local-"), true)

        storeNewVersion(backend, "half an")
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.messages.last?.id, "a3")
        XCTAssertEqual(vm.state.messages.last?.versions, MessageVersions(index: 2, total: 2, prevId: "a2"))
    }

    @MainActor
    func testStoppingARegenerationBeforeAnythingArrivesBringsTheOldAnswerBack() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await openChat(backend, clock)

        vm.regenerate("a2")
        backend.events.send(.started(sessionId: "s1"))
        await clock.settle()
        vm.stop()
        await clock.advanceUntilIdle()
        XCTAssertEqual(contents(vm), ["question", "first answer", "follow-up", "second answer"])
    }

    @MainActor
    func testShowingAnotherVersionReloadsTheConversationFromTheServer() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await openChat(backend, clock)

        backend.storedBySession?["s1"] = [
            chatDto("u1", "USER", "question"),
            chatDto("a0", "ASSISTANT", "older answer", versions: MessageVersions(index: 1, total: 2, nextId: "a1")),
        ]
        vm.showVersion("a0")
        await clock.advanceUntilIdle()
        XCTAssertEqual(backend.shown, [["s1", "a0"]])
        XCTAssertEqual(contents(vm), ["question", "older answer"])

        backend.showError = ChatTestError("offline")
        vm.showVersion("a1")
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.notice, .failed(detail: ChatViewModel.VERSION_SWITCH_FAILED))
        XCTAssertEqual(contents(vm), ["question", "older answer"])
    }

    @MainActor
    func testBranchingOpensTheNewChatAndListsItFirst() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await openChat(backend, clock)

        vm.branch("a1", title: "Branch · Chat")
        await clock.advanceUntilIdle()
        XCTAssertEqual(backend.branched, [["s1", "a1", "Branch · Chat"]])
        XCTAssertEqual(vm.state.activeSessionId, "s2")
        XCTAssertEqual(vm.state.sessions.first?.id, "s2")
    }
}
