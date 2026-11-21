import Foundation
import XCTest
@testable import NoteFableCore

/// Android `ChatViewModelTest` 的移植。
final class ChatViewModelTests: XCTestCase {
    private let notes = LocalFile(uri: "content://notes", name: "notes.txt", mimeType: "text/plain", size: 1200)
    private let photo = LocalFile(uri: "content://photo", name: "photo.png", mimeType: "image/png", size: 3400)
    private let planNote = ChatProjectNote(id: "n1", title: "Plan", icon: "📘")
    private let todoNote = ChatProjectNote(id: "n2", title: "Todo", icon: nil)

    @MainActor
    private func newBackend() -> ChatFakeBackend {
        ChatFakeBackend(models: ModelsResponse(
            defaultModel: "a",
            models: [
                ModelInfo(id: "a", label: "Model A", supportsWebSearch: true, reasoningEfforts: ["low", "medium", "high"], defaultReasoning: "medium"),
                ModelInfo(id: "b", label: "Model B", supportsWebSearch: false, reasoningEfforts: ["low", "high"], defaultReasoning: "high"),
            ]
        ))
    }

    @MainActor
    private func newViewModel(_ backend: ChatFakeBackend, _ clock: ChatTestClock, settings: SettingsStore = ChatMemorySettings()) async -> ChatViewModel {
        let vm = makeChatViewModel(backend, clock: clock, settings: settings)
        await clock.advanceUntilIdle()
        return vm
    }

    @MainActor
    func testStreamsTextIntoTheAssistantBubbleAdoptsTheNewSessionIdAndReconcilesWithTheServer() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("  hi  ")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "Hel"))
        backend.events.send(.delta(text: "lo"))
        await clock.settle()

        XCTAssertEqual(vm.state.activeSessionId, "s1")
        XCTAssertTrue(vm.state.sending)
        XCTAssertEqual(vm.state.messages.map(\.content), ["hi", "Hello"])
        XCTAssertEqual(vm.state.messages.last?.streaming, true)

        backend.stored = [chatDto("db-1", "USER", "hi"), chatDto("db-2", "ASSISTANT", "Hello", thinkingMs: 1200)]
        backend.events.close()
        await clock.advanceUntilIdle()

        let state = vm.state
        XCTAssertFalse(state.sending)
        XCTAssertEqual(state.messages.map(\.id), ["db-1", "db-2"])
        XCTAssertEqual(state.messages.last?.thinkingMs, 1200)
        XCTAssertEqual(state.messages.last?.streaming, false)
    }

    // ---- 添加页面（网页 attachedPages） ----

    @MainActor
    func testAttachedPagesGoOutAsIdsShowOnTheQuestionAndClearFromTheComposer() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)
        vm.setAttachedPages([planNote, todoNote])
        vm.removeAttachedPage("n2")
        XCTAssertEqual(vm.state.attachedPages, [planNote])

        vm.send("summarize")
        await clock.settle()
        XCTAssertEqual(backend.requests.count, 1)
        XCTAssertEqual(backend.requests.first?.pages, ["n1"])
        XCTAssertEqual(vm.state.messages.first?.pages, [planNote])
        XCTAssertTrue(vm.state.attachedPages.isEmpty)

        // 历史里的页面（标题和图标由服务端从笔记取）。
        backend.stored = [chatDto("db-1", "USER", "summarize", pages: [planNote]), chatDto("db-2", "ASSISTANT", "ok")]
        backend.events.close()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.messages.first?.pages, [planNote])
    }

    @MainActor
    func testPagesAreRefusedInImageModeAndOverTheLimitInsteadOfBeingDropped() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)
        vm.setAttachedPages([planNote])
        vm.setImageMode(true)
        vm.send("draw it")
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.notice, .pagesInImageMode)
        XCTAssertTrue(backend.imageRequests.isEmpty)
        XCTAssertEqual(vm.state.attachedPages, [planNote])

        vm.setImageMode(false)
        vm.setAttachedPages((1...6).map { ChatProjectNote(id: "p\($0)", title: "P\($0)") })
        vm.send("hi")
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.notice, .tooManyPages)
        XCTAssertTrue(backend.requests.isEmpty)
        // 移除一篇就清掉提示。
        vm.removeAttachedPage("p6")
        XCTAssertNil(vm.state.notice)
    }

    func testRestoredPagesGoFirstAndPagesPickedMeanwhileStay() {
        XCTAssertEqual(ChatViewModel.mergeRestoredPages([planNote], [todoNote, planNote]), [planNote, todoNote])
        XCTAssertEqual(ChatViewModel.mergeRestoredPages([], [todoNote]), [todoNote])
    }

    func testTheAttachDialogKeepsCurrentTitlesAndDropsTrashedPages() {
        var renamed = planNote
        renamed.title = "Plan v2"
        XCTAssertEqual(refreshAttachedPages([planNote, todoNote], [renamed]), [renamed])
    }

    @MainActor
    func testAFailedRequestRecordsTheReasonOnTheAssistantBubble() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)
        backend.streamError = ChatTestError("Daily limit reached")

        vm.send("hi")
        await clock.advanceUntilIdle()

        let assistant = vm.state.messages.last
        XCTAssertEqual(assistant?.errorDetail, "Daily limit reached")
        XCTAssertEqual(assistant?.streaming, false)
        XCTAssertFalse(vm.state.sending)
    }

    @MainActor
    func testRemembersWhereTheServerAppendedItsFailureTextLiveAndFromStoredActivity() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)
        let failure = FailureInfo(offset: 9, detail: "Note not found.")

        vm.send("hi")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "Partial\n\nRequest failed: Note not found."))
        backend.events.send(chatActivity(#"{"type":"failure","id":"request-failure","offset":9,"detail":"Note not found."}"#))
        await clock.settle()
        XCTAssertEqual(vm.state.messages.last?.failure, failure)

        backend.stored = [
            chatDto("db-1", "USER", "hi"),
            chatDto(
                "db-2", "ASSISTANT", "Partial\n\nRequest failed: Note not found.",
                activity: #"[{"id":"t","kind":"thought","text":"x"},{"id":"request-failure","kind":"failure","offset":9,"detail":"Note not found."}]"#
            ),
        ]
        backend.events.close()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.messages.map(\.id), ["db-1", "db-2"])
        XCTAssertEqual(vm.state.messages.last?.failure, failure)
        XCTAssertNil(vm.state.messages.first?.failure)
    }

    @MainActor
    func testMergesLiveActivityIntoTheAnswerAndRestoresActivityAndProposalsFromHistory() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("hi")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(chatActivity(#"{"type":"thought","id":"rs:0","delta":"**Plan**"}"#))
        backend.events.send(chatActivity(#"{"type":"thought","id":"rs:0","delta":" more"}"#))
        backend.events.send(chatActivity(#"{"type":"web","id":"ws","status":"running"}"#))
        await clock.settle()
        let waiting = vm.state.messages.last
        XCTAssertEqual(waiting?.activity, [.thought(id: "rs:0", text: "**Plan** more"), .web(id: "ws", done: false)])
        XCTAssertNotNil(waiting?.startedAt)
        XCTAssertNil(waiting?.thinkingMs)

        backend.events.send(chatActivity(#"{"type":"web","id":"ws","status":"done","action":{"kind":"open_page","url":"https://a.com/x"}}"#))
        backend.events.send(.delta(text: "Answer"))
        await clock.settle()
        let answering = vm.state.messages.last
        XCTAssertEqual(answering?.activity.last, .web(id: "ws", done: true, action: .openPage(url: "https://a.com/x")))
        XCTAssertNotNil(answering?.thinkingMs)

        backend.stored = [
            chatDto("db-1", "USER", "hi"),
            chatDto(
                "db-2", "ASSISTANT", "Answer",
                activity: #"[{"id":"rs:0","kind":"thought","text":"**Plan** more"}]"#,
                proposals: #"[{"kind":"create_proposal","id":"np1","title":"Plan","content":"","proposed":{"title":"Plan","blocks":[]},"status":"applied","appliedPageId":"pg1"}]"#
            ),
        ]
        backend.events.close()
        await clock.advanceUntilIdle()
        let stored = vm.state.messages.last
        XCTAssertEqual(stored?.activity, [.thought(id: "rs:0", text: "**Plan** more")])
        XCTAssertEqual(
            stored?.proposals,
            [.create(Proposal.Create(id: "np1", title: "Plan", icon: nil, content: "", status: "applied", appliedPageId: "pg1"))]
        )
    }

    @MainActor
    func testStoppingKeepsWhatArrivedAndDropsAnEmptyBubble() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("one")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "partial"))
        await clock.settle()
        vm.stop()
        await clock.advanceUntilIdle()
        XCTAssertEqual(Array(vm.state.messages.map(\.content).prefix(2)), ["one", "partial"])
        XCTAssertFalse(vm.state.sending)

        backend.events = ChatEventChannel()
        vm.newChat()
        vm.send("two")
        await clock.settle()
        vm.stop()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.messages.map(\.content), ["two"])
    }

    @MainActor
    func testStoppingKeepsAnAnswerThatSoFarHoldsOnlyActivity() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("q")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(chatActivity(#"{"type":"thought","id":"rs:0","delta":"Plan"}"#))
        await clock.settle()
        // 这个假后端不认识"停止"的请求：走自己取消的后备路径，不知道服务端存了什么，本机这份留着。
        vm.stop()
        await clock.advanceUntilIdle()

        let answer = vm.state.messages.last
        XCTAssertEqual(answer?.activity, [.thought(id: "rs:0", text: "Plan")])
        XCTAssertEqual(answer?.streaming, false)
    }

    @MainActor
    func testSwitchingChatsKeepsTheRunningAnswerInItsOwnChatWithoutLeakingIntoTheOtherOne() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.storedBySession = ["s2": [chatDto("o-1", "USER", "other")]]
        let vm = await newViewModel(backend, clock)

        vm.send("q")
        backend.events.send(.started(sessionId: "s1"))
        await clock.settle()
        vm.openSession("s2")
        backend.events.send(.delta(text: "late"))
        await clock.settle()

        XCTAssertFalse(vm.state.sending)
        XCTAssertEqual(vm.state.activeSessionId, "s2")
        XCTAssertEqual(vm.state.messages.map(\.content), ["other"])
        XCTAssertEqual(vm.state.generatingSessionIds, ["s1"])

        vm.openSession("s1")
        XCTAssertTrue(vm.state.sending)
        XCTAssertEqual(vm.state.messages.map(\.content), ["q", "late"])
        vm.stop()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testASecondSendWhileOneIsRunningIsIgnored() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("first")
        vm.send("second")
        await clock.settle()

        XCTAssertEqual(backend.requests.count, 1)
        vm.stop()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testRequestCarriesTheChosenModelASupportedReasoningLevelAndWebSearchSupport() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let settings = ChatMemorySettings()
        let vm = await newViewModel(backend, clock, settings: settings)

        vm.selectModel("a")
        vm.selectReasoning("medium") // b 不支持 medium
        vm.selectModel("b")
        XCTAssertEqual(vm.state.selectedReasoning, "high")

        vm.selectModel("a")
        vm.selectReasoning("low") // b 也支持 low，切换后保留
        vm.selectModel("b")
        XCTAssertEqual(vm.state.selectedReasoning, "low")

        vm.send("x")
        await clock.settle()
        XCTAssertEqual(backend.requests.count, 1)
        let request = backend.requests.first
        XCTAssertEqual(request?.model, "b")
        XCTAssertEqual(request?.reasoning, "low")
        XCTAssertEqual(request?.webSearch, "off")
        XCTAssertEqual(settings.modelId, "b")
        vm.stop()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testAnUnsupportedSavedReasoningLevelFallsBackToTheModelDefault() async {
        let clock = ChatTestClock()
        let vm = await newViewModel(newBackend(), clock, settings: ChatMemorySettings(modelId: "b", reasoning: "medium"))
        XCTAssertEqual(vm.state.selectedReasoning, "high")
    }

    @MainActor
    func testTheBundledModelListIsUsedWhenTheServerCannotSupplyOne() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.models = nil
        let bundled = ModelsResponse(
            defaultModel: "b",
            models: [ModelInfo(id: "b", label: "Model B", reasoningEfforts: ["low", "high"], defaultReasoning: "high")]
        )
        let vm = makeChatViewModel(backend, clock: clock, bundledModels: { bundled })
        await clock.advanceUntilIdle()

        XCTAssertEqual(vm.state.models.map(\.id), ["b"])
        XCTAssertEqual(vm.state.selectedReasoning, "high")
    }

    @MainActor
    func testWithoutAModelListTheRequestLeavesModelAndReasoningToTheServer() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.models = nil
        let vm = await newViewModel(backend, clock)

        vm.send("x")
        await clock.settle()

        XCTAssertEqual(backend.requests.count, 1)
        XCTAssertNil(backend.requests.first?.model)
        XCTAssertNil(backend.requests.first?.reasoning)
        vm.stop()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testTheFirstChatRequestWaitsForTheInitialSessionListSoOnlyOneDeviceIdentityIsCreated() async {
        let clock = ChatTestClock()
        let gate = ChatDeferred<Void>()
        let backend = newBackend()
        backend.sessionsHandler = { _ in
            try await gate.value()
            return []
        }
        let vm = await newViewModel(backend, clock)

        vm.send("hello")
        await clock.settle()
        XCTAssertTrue(backend.requests.isEmpty, "chat request must not start while the session list is in flight")
        XCTAssertTrue(vm.state.sending)

        gate.complete()
        await clock.settle()
        XCTAssertEqual(backend.requests.count, 1)

        vm.stop()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testStopEndsASendStillWaitingForAStalledSessionList() async {
        let clock = ChatTestClock()
        let gate = ChatDeferred<Void>()
        let backend = newBackend()
        backend.sessionsHandler = { _ in
            try await gate.value()
            return []
        }
        let vm = await newViewModel(backend, clock)

        vm.send("hello")
        await clock.settle()
        XCTAssertTrue(vm.state.sending)

        // 会话列表还卡着：停止键不能被它拖住（Kotlin 的 join() 被取消就返回）。
        vm.stop()
        await clock.advanceUntilIdle()
        XCTAssertFalse(vm.state.sending)
        XCTAssertTrue(backend.requests.isEmpty)

        gate.complete()
        await clock.advanceUntilIdle()
        XCTAssertTrue(backend.requests.isEmpty, "a stopped send never reaches /api/chat")
    }

    @MainActor
    func testAnOlderSessionListResponseCannotOverwriteANewerOne() async {
        let clock = ChatTestClock()
        let slow = ChatDeferred<[SessionSummary]>()
        let backend = newBackend()
        backend.sessionsHandler = { call in
            if call == 1 { return try await slow.value() }
            return [SessionSummary(id: "new", title: "New")]
        }
        let vm = await newViewModel(backend, clock) // 第 1 次刷新卡在 slow 上
        vm.refreshSessions() // 第 2 次立即返回
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.sessions.map(\.id), ["new"])

        slow.complete([SessionSummary(id: "old", title: "Old")])
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.sessions.map(\.id), ["new"])
    }

    @MainActor
    func testALaterSuccessfulRefreshClearsTheFailedState() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.sessionsHandler = { call in
            if call == 1 { throw ChatTestError("offline") }
            return [SessionSummary(id: "a", title: "A")]
        }
        let vm = await newViewModel(backend, clock)
        XCTAssertTrue(vm.state.sessionsFailed)

        vm.refreshSessions()
        await clock.advanceUntilIdle()
        XCTAssertFalse(vm.state.sessionsFailed)
        XCTAssertEqual(vm.state.sessions.map(\.id), ["a"])
    }

    @MainActor
    func testSendingStartsANewQuestionThatALateHistoryResponseCannotErase() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        // 第一个回答正常结束，触发静默对账；让对账请求卡住。
        vm.send("first")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "answer"))
        let reconcile = ChatDeferred<[MessageDto]>()
        backend.messagesHandler = { _ in try await reconcile.value() }
        backend.events.close()
        await clock.advanceUntilIdle()
        XCTAssertFalse(vm.state.sending)

        // 对账还没返回时就追问。
        backend.events = ChatEventChannel()
        vm.send("second")
        backend.events.send(.delta(text: "again"))
        await clock.settle()

        // 迟到的快照（发送前的内容）不应该覆盖屏幕。
        reconcile.complete([chatDto("db-1", "USER", "first"), chatDto("db-2", "ASSISTANT", "answer")])
        await clock.settle()
        XCTAssertEqual(vm.state.messages.map(\.content), ["first", "answer", "second", "again"])

        vm.stop()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testSendingIsIgnoredWhileTheChatHistoryIsStillLoading() async {
        let clock = ChatTestClock()
        let gate = ChatDeferred<[MessageDto]>()
        let backend = newBackend()
        backend.messagesHandler = { _ in try await gate.value() }
        let vm = await newViewModel(backend, clock)

        vm.openSession("s1")
        await clock.advanceUntilIdle()
        XCTAssertTrue(vm.state.messagesLoading)

        vm.send("too early")
        await clock.advanceUntilIdle()
        XCTAssertTrue(backend.requests.isEmpty)
        XCTAssertFalse(vm.state.sending)

        gate.complete([chatDto("db-1", "USER", "old")])
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.messages.map(\.content), ["old"])
    }

    @MainActor
    func testSendingIsIgnoredAfterTheHistoryFailedToLoadUntilAReloadSucceeds() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.messagesError = ChatTestError("offline")
        backend.stored = [chatDto("db-1", "USER", "old")]
        let vm = await newViewModel(backend, clock)

        vm.openSession("s1")
        await clock.advanceUntilIdle()
        XCTAssertTrue(vm.state.messagesFailed)

        // 失败页盖在消息列表上，此时发出去的提问和回答用户看不到。
        vm.send("hello")
        await clock.advanceUntilIdle()
        XCTAssertTrue(backend.requests.isEmpty)
        XCTAssertFalse(vm.state.sending)

        backend.messagesError = nil
        vm.reloadActive()
        await clock.advanceUntilIdle()
        XCTAssertFalse(vm.state.messagesFailed)
        vm.send("hello")
        await clock.settle()
        XCTAssertEqual(backend.requests.count, 1)
        vm.stop()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testUploadsAttachmentsFirstThenSendsTheirTicketsAndClearsTheComposer() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)
        vm.addFiles([notes])

        vm.send("summarise")
        await clock.settle()

        XCTAssertEqual(backend.uploaded, ["ticket-0"])
        XCTAssertEqual(backend.requests.count, 1)
        XCTAssertEqual(backend.requests.first?.uploads, ["ticket-0"])
        XCTAssertTrue(vm.state.files.isEmpty)
        XCTAssertNil(vm.state.upload)
        XCTAssertEqual(vm.state.sentCount, 1)
        XCTAssertEqual(vm.state.messages.first?.attachments.map(\.filename), ["notes.txt"])

        backend.events.close()
        await clock.advanceUntilIdle()
        // 迟到的上传进度不会把"上传中"再显示出来。
        XCTAssertNil(vm.state.upload)
    }

    @MainActor
    func testSendingWaitsUntilImportedAttachmentsAreCopiedThenIncludesThem() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)
        let copied = ChatDeferred<[LocalFile]>()

        vm.importFiles { try await copied.value() }
        await clock.runCurrent()
        XCTAssertEqual(vm.state.importing, 1)

        // 还在拷贝：发送被拦下，没有请求，草稿里的附件也不会丢到下一条。
        vm.send("summarise")
        await clock.advanceUntilIdle()
        XCTAssertTrue(backend.requests.isEmpty)
        XCTAssertFalse(vm.state.sending)

        copied.complete([notes])
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.importing, 0)
        XCTAssertEqual(vm.state.files, [notes])

        vm.send("summarise")
        await clock.settle()
        XCTAssertEqual(backend.requests.count, 1)
        XCTAssertEqual(backend.requests.first?.uploads, ["ticket-0"])

        backend.events.close()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testAFailedImportReleasesTheSendLockAndAddsNothing() async {
        let clock = ChatTestClock()
        let vm = await newViewModel(newBackend(), clock)

        vm.importFiles { throw ChatTestError("revoked") }
        vm.importFiles { [] }
        await clock.advanceUntilIdle()

        XCTAssertEqual(vm.state.importing, 0)
        XCTAssertTrue(vm.state.files.isEmpty)
        XCTAssertNil(vm.state.notice)
    }

    @MainActor
    func testAFailedUploadKeepsTheFilesAndTheDraftRemovesWhatWasUploadedAndSendsNothing() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.uploadError = ChatTestError("offline")
        let vm = await newViewModel(backend, clock)
        vm.addFiles([notes])

        vm.send("summarise")
        await clock.advanceUntilIdle()

        XCTAssertTrue(backend.requests.isEmpty)
        XCTAssertEqual(backend.discarded, ["ticket-0"])
        XCTAssertEqual(vm.state.files, [notes])
        XCTAssertEqual(vm.state.notice, .uploadFailed)
        XCTAssertFalse(vm.state.sending)
        XCTAssertEqual(vm.state.sentCount, 0)
        XCTAssertTrue(vm.state.messages.isEmpty)
    }

    @MainActor
    func testAnImageIsRefusedWhileTheModelCannotReadImagesAndAcceptedInImageMode() async {
        let clock = ChatTestClock()
        let vm = await newViewModel(newBackend(), clock)

        vm.addFiles([photo])
        XCTAssertTrue(vm.state.files.isEmpty)
        XCTAssertEqual(vm.state.notice, .rejected(.notAdded(cause: .modelCannotReadImages)))

        vm.setImageMode(true)
        vm.addFiles([photo])
        XCTAssertEqual(vm.state.files, [photo])
        XCTAssertNil(vm.state.notice)

        // 关掉图片模式后，这张图对当前模型又不能用了：留在输入栏里，但不能发送。
        vm.setImageMode(false)
        XCTAssertEqual(vm.state.filesError, .modelCannotReadImages)
        vm.send("describe")
        await clock.advanceUntilIdle()
        XCTAssertTrue(vm.state.messages.isEmpty)
    }

    @MainActor
    func testImageModeSendsThePromptToTheImageApiAndShowsTheResult() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)
        vm.setImageMode(true)
        backend.stored = [chatDto("db-1", "USER", "a red kite"), chatDto("db-2", "ASSISTANT", "")]

        vm.send("a red kite")
        XCTAssertEqual(vm.state.messages.last?.generatingImage, true)
        await clock.advanceUntilIdle()

        XCTAssertTrue(backend.requests.isEmpty)
        XCTAssertEqual(backend.imageRequests.map(\.message), ["a red kite"])
        XCTAssertEqual(vm.state.activeSessionId, "img-1")
        XCTAssertFalse(vm.state.sending)
        XCTAssertEqual(vm.state.messages.map(\.id), ["db-1", "db-2"])
    }

    @MainActor
    func testAUsageLimitShowsTheServerSentenceAsTheAnswerNotAsAFailure() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)
        let limit = "You've used today's free messages. Sign in for more, or try again tomorrow."
        backend.streamError = chatUsageLimit(limit, tier: "guest")

        vm.send("hi")
        await clock.advanceUntilIdle()

        let assistant = vm.state.messages.last
        XCTAssertEqual(assistant?.content, limit)
        XCTAssertEqual(assistant?.usageLimit, true)
        XCTAssertNil(assistant?.errorDetail)
        XCTAssertEqual(assistant?.streaming, false)
        XCTAssertFalse(vm.state.sending)
    }

    @MainActor
    func testAFailedImageRequestEndsThePlaceholderWithTheReason() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.imageResult = ImageResult(error: "No image today.")
        let vm = await newViewModel(backend, clock)
        vm.setImageMode(true)

        vm.send("a red kite")
        await clock.advanceUntilIdle()

        let answer = vm.state.messages.last
        XCTAssertEqual(answer?.generatingImage, false)
        XCTAssertEqual(answer?.images.isEmpty, true)
        // 失败的图片回合仍是图片回合，不带文字聊天的模型 ID。
        XCTAssertEqual(answer?.imageTurn, true)
        XCTAssertEqual(answer?.isImageAnswer, true)
        XCTAssertNil(answer?.modelId)
        XCTAssertEqual(answer?.errorDetail, "No image today.")
        XCTAssertFalse(vm.state.sending)

        // 即使消息带着 modelId，imageTurn 也让 isImageAnswer 在 generatingImage 清掉后保持 true。
        let syntheticFailedImage = UiMessage(
            "img-fail", .assistant, "", modelId: "a", errorDetail: "No image today.", generatingImage: false, imageTurn: true
        )
        XCTAssertTrue(syntheticFailedImage.isImageAnswer)
    }

    @MainActor
    func testTheComposerDraftLivesInTheViewModelAndClearsOnlyOnceTheMessageIsSent() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.uploadError = ChatTestError("offline")
        let vm = await newViewModel(backend, clock)
        vm.updateDraft("half-written question")
        // 切到笔记再回来时界面重建，草稿从 ViewModel 读回。
        vm.onIdentityChanged()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.draft, "half-written question")

        vm.addFiles([notes])
        vm.send(vm.draft)
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.draft, "half-written question")

        backend.uploadError = nil
        vm.send(vm.draft)
        await clock.settle()
        XCTAssertEqual(vm.draft, "")
        backend.events.close()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testTheDraftAndQuoteSurviveTheProcessBeingRecreated() async {
        let clock = ChatTestClock()
        let saved = MemoryChatSavedState()
        let first = makeChatViewModel(newBackend(), clock: clock, savedState: saved)
        first.updateDraft("keep me")
        first.setQuote("  quoted\n\n\ntext ")
        let second = makeChatViewModel(newBackend(), clock: clock, savedState: saved)
        XCTAssertEqual(second.draft, "keep me")
        XCTAssertEqual(second.state.quote, "quoted\n\ntext")
        first.clearQuote()
        XCTAssertNil(saved.quote)
        await clock.advanceUntilIdle()
    }

    func testReconcileKeepsTheListKeysOfTheTurnThatWasJustSent() {
        let old = [
            UiMessage("cm0", .assistant, "Earlier"),
            UiMessage("local-1", .user, "Q"),
            UiMessage("local-2", .assistant, "A"),
        ]
        let loaded = [
            UiMessage("cm0", .assistant, "Earlier"),
            UiMessage("cm1", .user, "Q"),
            UiMessage("cm2", .assistant, "A"),
        ]
        let merged = carryLocalKeys(old, loaded)
        XCTAssertEqual(merged.map(\.id), ["cm0", "cm1", "cm2"])
        XCTAssertEqual(merged.map(\.key), ["cm0", "local-1", "local-2"])
    }

    func testReconcileKeepsLocalKeysOfEarlierTurnsThatAlreadyHaveStoredIds() {
        // 第一回合对账后：id 是服务端的，key 还是 local-*；第二回合刚发送。
        let old = [
            UiMessage("cm1", .user, "Q1", key: "local-1"),
            UiMessage("cm2", .assistant, "A1", key: "local-2"),
            UiMessage("local-3", .user, "Q2"),
            UiMessage("local-4", .assistant, "A2"),
        ]
        let loaded = [
            UiMessage("cm1", .user, "Q1"),
            UiMessage("cm2", .assistant, "A1"),
            UiMessage("cm3", .user, "Q2"),
            UiMessage("cm4", .assistant, "A2"),
        ]
        let merged = carryLocalKeys(old, loaded)
        XCTAssertEqual(merged.map(\.id), ["cm1", "cm2", "cm3", "cm4"])
        XCTAssertEqual(merged.map(\.key), ["local-1", "local-2", "local-3", "local-4"])
        // 只有这次换了 ID 的消息才需要搬保存状态。
        XCTAssertEqual(replacedLocalIds(old, merged).map { [$0.from, $0.to] }, [["local-3", "cm3"], ["local-4", "cm4"]])
    }

    @MainActor
    func testReconcileReportsReplacedIdsEvenWhenTheAnswerIsNotOnScreen() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let renames = ChatTestBox<[[String]]>([])
        let vm = makeChatViewModel(backend, clock: clock, onMessageIdChanged: { session, from, to in renames.value.append([session, from, to]) })
        await clock.advanceUntilIdle()

        vm.send("hi")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "Hello"))
        await clock.settle()
        let localIds = vm.state.messages.map(\.id)
        XCTAssertEqual(localIds.count, 2)
        backend.stored = [chatDto("db-1", "USER", "hi"), chatDto("db-2", "ASSISTANT", "Hello")]
        backend.events.close()
        await clock.advanceUntilIdle()

        XCTAssertEqual(renames.value, [["s1", localIds.first ?? "", "db-1"], ["s1", localIds.last ?? "", "db-2"]])
        XCTAssertEqual(vm.state.messages.map(\.key), localIds)
    }

    @MainActor
    func testCharacterStateTracksRealTurnLifecycleAndClearsImmediatelyOnStop() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        XCTAssertEqual(vm.state.heroCharacterState(), .idle)
        XCTAssertEqual(vm.state.heroCharacterState(isTyping: true), .typing)

        vm.send("hi")
        await clock.runCurrent()
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .thinking)

        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "Hello"))
        await clock.settle()
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .responding)

        backend.stored = [chatDto("db-1", "USER", "hi"), chatDto("db-2", "ASSISTANT", "Hello")]
        backend.events.close()
        await clock.runCurrent()
        await clock.advance(by: 100)
        XCTAssertEqual(vm.state.characterOutcome, .completed)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .completed)

        await clock.advanceUntilIdle()
        XCTAssertNil(vm.state.characterOutcome)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)

        // 停止回合：离开 thinking / responding，不闪"完成"。
        backend.events = ChatEventChannel()
        vm.send("stop me")
        await clock.runCurrent()
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .thinking)
        vm.stop()
        await clock.runCurrent()
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)
        await clock.advanceUntilIdle()
        XCTAssertNil(vm.state.characterOutcome)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)

        // 失败的回合短暂闪"出错"，再回到 idle。
        backend.streamError = ChatTestError("network down")
        vm.send("fail me")
        await clock.runCurrent()
        await clock.advance(by: 100)
        XCTAssertEqual(vm.state.characterOutcome, .error)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .error)
        await clock.advanceUntilIdle()
        XCTAssertNil(vm.state.characterOutcome)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)
    }

    @MainActor
    func testStreamedFailureAfterPartialOutputFlashesErrorInsteadOfCompletedAndPreservesPartialAnswer() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("explain photosynthesis")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "Photosynthesis converts light"))
        await clock.settle()
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .responding)

        let errorSuffix = "\n\nRequest failed: Provider connection reset."
        backend.events.send(.delta(text: errorSuffix))
        backend.events.send(chatActivity(#"{"type":"failure","id":"request-failure","offset":31,"detail":"Provider connection reset."}"#))
        backend.stored = [
            chatDto("db-1", "USER", "explain photosynthesis"),
            chatDto(
                "db-2", "ASSISTANT", "Photosynthesis converts light\(errorSuffix)",
                activity: #"[{"id":"request-failure","kind":"failure","offset":31,"detail":"Provider connection reset."}]"#
            ),
        ]
        backend.events.close()
        await clock.runCurrent()
        await clock.advance(by: 100)

        XCTAssertEqual(vm.state.characterOutcome, .error)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .error)
        XCTAssertEqual(vm.state.messages.last?.content, "Photosynthesis converts light\(errorSuffix)")
        XCTAssertEqual(vm.state.messages.last?.failure, FailureInfo(offset: 31, detail: "Provider connection reset."))

        await clock.advanceUntilIdle()
        XCTAssertNil(vm.state.characterOutcome)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)
    }

    @MainActor
    func testServerAcknowledgedStopAfterPartialOutputEndsIdleAndNeverFlashesCompleted() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.stopAcknowledged = true
        let vm = await newViewModel(backend, clock)

        vm.send("write an essay")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "Partial essay"))
        await clock.settle()
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .responding)

        vm.stop()
        await clock.runCurrent()
        XCTAssertEqual(backend.stops, ["s1"])
        XCTAssertTrue(vm.state.stopping)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)
        XCTAssertNil(vm.state.characterOutcome)

        // 服务端存好半截回答，正常结束流。
        backend.stored = [chatDto("db-1", "USER", "write an essay"), chatDto("db-2", "ASSISTANT", "Partial essay")]
        backend.events.close()
        await clock.runCurrent()
        XCTAssertNil(vm.state.characterOutcome)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)

        await clock.advance(by: 100)
        XCTAssertNil(vm.state.characterOutcome)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)

        await clock.advanceUntilIdle()
        XCTAssertFalse(vm.state.sending)
        XCTAssertFalse(vm.state.stopping)
        XCTAssertNil(vm.state.characterOutcome)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)
        XCTAssertEqual(vm.state.messages.last?.content, "Partial essay")
    }

    @MainActor
    func testAStopTheServerNeverActsOnFallsBackToCancellingAfterEightSeconds() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.stopAcknowledged = true
        let vm = await newViewModel(backend, clock)

        vm.send("write an essay")
        backend.events.send(.started(sessionId: "s1"))
        backend.events.send(.delta(text: "Partial essay"))
        await clock.settle()
        vm.stop()
        // 服务端收到了停止的请求，但流一直没结束：等到 8 秒才自己取消。
        await clock.advance(by: 7900)
        XCTAssertTrue(vm.state.sending)
        XCTAssertTrue(vm.state.stopping)
        await clock.advance(by: 200)
        XCTAssertFalse(vm.state.sending)
        XCTAssertFalse(vm.state.stopping)
        XCTAssertEqual(vm.state.messages.last?.content, "Partial essay")
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testOutcomeTimersAreScopedPerSessionSoSendingInAnotherChatNeverFreezesAnEarlierChatErrorCue() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.storedBySession = ["s1": [chatDto("u1", "USER", "earlier")], "s2": [chatDto("o1", "USER", "other")]]
        let vm = await newViewModel(backend, clock)
        vm.openSession("s1")
        await clock.advanceUntilIdle()

        // s1 失败 → s1 上开始 950ms 的出错提示。
        backend.streamError = ChatTestError("network down")
        vm.send("fail in s1")
        await clock.runCurrent()
        XCTAssertEqual(vm.state.characterOutcome, .error)

        // 200ms 后换到 s2 并开始一个回合。
        await clock.advance(by: 200)
        vm.openSession("s2")
        await clock.runCurrent()
        XCTAssertNil(vm.state.characterOutcome)

        backend.streamError = nil
        backend.events = ChatEventChannel()
        vm.send("work in s2")
        backend.events.send(.started(sessionId: "s2"))
        await clock.runCurrent()

        // s1 的 600ms 时回到 s1（s2 还在后台等）：s1 仍显示出错。
        await clock.advance(by: 400)
        vm.openSession("s1")
        await clock.runCurrent()
        XCTAssertEqual(vm.state.characterOutcome, .error)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .error)

        // s1 满 950ms（再过 350ms）时它自己的计时到点，s2 还在等也一样。
        await clock.advance(by: 350)
        XCTAssertNil(vm.state.characterOutcome)
        XCTAssertEqual(vm.state.activeReplyCharacterState(), .idle)

        // 收尾：停掉 s2 后台的流。
        vm.openSession("s2")
        await clock.runCurrent()
        vm.stop()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testLinkRequestsAreBufferedUntilTheScreenReadsThem() async {
        let clock = ChatTestClock()
        let vm = await newViewModel(newBackend(), clock)
        vm.requestLink(.open(chatId: "s1", messageId: "m1"))
        vm.requestLink(.invalid)
        var received: [ChatLink] = []
        for await link in vm.linkRequests {
            received.append(link)
            if received.count == 2 { break }
        }
        XCTAssertEqual(received, [.open(chatId: "s1", messageId: "m1"), .invalid])
    }

    @MainActor
    func testAQuoteGoesOutAsAQuoteBlockAndClears() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)
        vm.setQuote("the quoted part")
        XCTAssertEqual(vm.state.quote, "the quoted part")

        vm.send("why?")
        await clock.settle()
        XCTAssertEqual(backend.requests.first?.message, "> the quoted part\n\nwhy?")
        XCTAssertNil(vm.state.quote)
        vm.stop()
        await clock.advanceUntilIdle()
    }
}

/// 闭包里要改的值放在盒子里。
@MainActor
final class ChatTestBox<Value> {
    var value: Value

    init(_ value: Value) {
        self.value = value
    }
}
