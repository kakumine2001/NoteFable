import Foundation
import XCTest
@testable import NoteFableCore

/// 切换聊天、开新聊天时回答在后台继续生成（网页 page.tsx 的 sessionMessagesRef / streamingSessionsRef）。
/// Android `ChatViewModelBackgroundTest` 的移植。
final class ChatViewModelBackgroundTests: XCTestCase {
    private let notes = LocalFile(uri: "content://notes", name: "notes.txt", mimeType: "text/plain", size: 1200)

    /// 每个请求一条自己的流，按发送顺序编号；消息按会话存。
    @MainActor
    private func newBackend() -> ChatFakeBackend {
        let backend = ChatFakeBackend(models: ModelsResponse(defaultModel: ""))
        backend.streamPerRequest = true
        backend.storedBySession = [:]
        return backend
    }

    @MainActor
    private func newViewModel(_ backend: ChatFakeBackend, _ clock: ChatTestClock) async -> ChatViewModel {
        let vm = makeChatViewModel(backend, clock: clock)
        await clock.advanceUntilIdle()
        return vm
    }

    @MainActor
    private func contents(_ vm: ChatViewModel) -> [String] {
        vm.state.messages.map(\.content)
    }

    @MainActor
    func testANewChatKeepsGeneratingAfterStartingAnotherNewChatAndMovesToItsSessionId() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("first")
        await clock.settle()
        // 还没拿到 X-Session-Id 就开了新聊天：新聊天是空的，可以直接发。
        vm.newChat()
        XCTAssertNil(vm.state.activeSessionId)
        XCTAssertTrue(vm.state.messages.isEmpty)
        XCTAssertFalse(vm.state.sending)

        backend.streams[0].send(.started(sessionId: "s1"))
        backend.streams[0].send(.delta(text: "one"))
        await clock.settle()
        // 迁到 s1 的是第一个聊天，不是现在看着的新聊天。
        XCTAssertNil(vm.state.activeSessionId)
        XCTAssertTrue(vm.state.messages.isEmpty)
        XCTAssertEqual(vm.state.generatingSessionIds, ["s1"])

        vm.send("second")
        await clock.settle()
        XCTAssertEqual(backend.requests.count, 2)
        XCTAssertNil(backend.requests[1].sessionId)
        backend.streams[1].send(.started(sessionId: "s2"))
        backend.streams[1].send(.delta(text: "two"))
        await clock.settle()
        XCTAssertEqual(vm.state.activeSessionId, "s2")
        XCTAssertEqual(contents(vm), ["second", "two"])
        XCTAssertEqual(vm.state.generatingSessionIds, ["s1", "s2"])

        // 回到 s1：显示它的进行中状态，不去读历史。
        let callsBefore = backend.messageCalls.count
        vm.openSession("s1")
        XCTAssertEqual(contents(vm), ["first", "one"])
        XCTAssertTrue(vm.state.sending)
        XCTAssertEqual(vm.state.messages.last?.streaming, true)
        XCTAssertFalse(vm.state.messagesLoading)
        await clock.settle()
        XCTAssertEqual(backend.messageCalls.count, callsBefore)

        // 停止只停当前聊天。
        vm.stop()
        await clock.advance(by: 50)
        XCTAssertFalse(vm.state.sending)
        XCTAssertEqual(vm.state.generatingSessionIds, ["s2"])
        backend.streams[1].send(.delta(text: " more"))
        await clock.settle()
        vm.openSession("s2")
        XCTAssertEqual(contents(vm), ["second", "two more"])
        XCTAssertTrue(vm.state.sending)
        backend.streams[1].close()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testAChatFinishingInTheBackgroundReconcilesOnlyItsOwnCache() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.storedBySession?["s9"] = [chatDto("o-1", "USER", "other chat")]
        let vm = await newViewModel(backend, clock)

        vm.send("q")
        await clock.runCurrent()
        backend.streams[0].send(.started(sessionId: "s1"))
        backend.streams[0].send(.delta(text: "answer"))
        await clock.settle()
        vm.openSession("s9")
        await clock.settle()
        XCTAssertEqual(contents(vm), ["other chat"])

        backend.storedBySession?["s1"] = [chatDto("db-1", "USER", "q"), chatDto("db-2", "ASSISTANT", "answer", thinkingMs: 900)]
        backend.streams[0].close()
        await clock.advanceUntilIdle()
        // 当前看着的聊天不受影响。
        XCTAssertEqual(contents(vm), ["other chat"])
        XCTAssertTrue(vm.state.generatingSessionIds.isEmpty)

        // 回到 s1：先显示对账后的缓存，再静默刷新，不出现加载中。
        let gate = ChatDeferred<Void>()
        backend.messagesGate = gate
        vm.openSession("s1")
        XCTAssertFalse(vm.state.messagesLoading)
        XCTAssertEqual(vm.state.messages.map(\.id), ["db-1", "db-2"])
        XCTAssertEqual(vm.state.messages.last?.thinkingMs, 900)
        gate.complete()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.messages.map(\.id), ["db-1", "db-2"])
    }

    @MainActor
    func testAnotherChatCanSendWhileOneIsGenerating() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.storedBySession?["s5"] = [chatDto("o-1", "USER", "old")]
        let vm = await newViewModel(backend, clock)

        vm.send("first")
        await clock.runCurrent()
        backend.streams[0].send(.started(sessionId: "s1"))
        await clock.settle()
        vm.openSession("s5")
        await clock.settle()
        vm.send("second")
        await clock.settle()

        XCTAssertEqual(backend.requests.count, 2)
        XCTAssertEqual(backend.requests.last?.sessionId, "s5")
        XCTAssertEqual(vm.state.generatingSessionIds, ["s1", "s5"])
        // 同一个聊天里在回答结束前不能再发。
        vm.send("third")
        await clock.settle()
        XCTAssertEqual(backend.requests.count, 2)

        backend.streams.forEach { $0.close() }
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testImageGenerationForANewChatContinuesInTheBackgroundAndLandsInItsSession() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let imageGate = ChatDeferred<ImageResult>()
        backend.imageHandler = { _ in try await imageGate.value() }
        let vm = await newViewModel(backend, clock)

        vm.setImageMode(true)
        vm.send("a cat")
        await clock.settle()
        vm.newChat()
        backend.storedBySession?["img-1"] = [chatDto("db-1", "USER", "a cat")]
        imageGate.complete(ImageResult(sessionId: "img-1", image: GeneratedImagePayload(dataUrl: "data:image/png;base64,AAAA")))
        await clock.advanceUntilIdle()

        XCTAssertNil(vm.state.activeSessionId)
        XCTAssertTrue(vm.state.messages.isEmpty)
        vm.openSession("img-1")
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.messages.map(\.id), ["db-1"])
    }

    @MainActor
    func testLeavingAChatWhileItsAttachmentsUploadCancelsNothingElseAndSendsNothing() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let uploadGate = ChatDeferred<Void>()
        backend.uploadHandler = { try await uploadGate.value() }
        let vm = await newViewModel(backend, clock)

        vm.addFiles([notes])
        vm.updateDraft("with file")
        vm.send("with file")
        await clock.settle()
        XCTAssertTrue(vm.state.sending)
        vm.openSession("s7")
        uploadGate.complete()
        await clock.advanceUntilIdle()

        // 和网页一样：上传期间去了别处就不发，清掉传上去的文件，文字和附件留在输入栏。
        XCTAssertTrue(backend.requests.isEmpty)
        XCTAssertEqual(backend.discarded, ["ticket-0"])
        XCTAssertEqual(vm.state.files, [notes])
        XCTAssertEqual(vm.draft, "with file")
        XCTAssertNil(vm.state.upload)
        XCTAssertFalse(vm.state.sending)
    }

    @MainActor
    func testSigningInOrOutStopsEveryChatsAnswerAndForgetsTheirCaches() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("q")
        await clock.runCurrent()
        backend.streams[0].send(.started(sessionId: "s1"))
        backend.streams[0].send(.delta(text: "partial"))
        await clock.settle()
        vm.newChat()
        vm.onIdentityChanged()
        await clock.advanceUntilIdle()

        XCTAssertTrue(vm.state.generatingSessionIds.isEmpty)
        vm.openSession("s1")
        await clock.advanceUntilIdle()
        // 旧身份的半截回答不会冒出来，显示的是服务器读回的内容。
        XCTAssertTrue(vm.state.messages.isEmpty)
        XCTAssertFalse(vm.state.sending)
    }

    @MainActor
    func testDeletingTheOpenChatReturnsToANewChatWithoutTouchingAnotherChatsAnswer() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("q")
        await clock.runCurrent()
        backend.streams[0].send(.started(sessionId: "s1"))
        await clock.settle()
        vm.openSession("s3")
        await clock.settle()
        vm.onSessionDeleted("s3")
        XCTAssertNil(vm.state.activeSessionId)
        XCTAssertEqual(vm.state.generatingSessionIds, ["s1"])
        backend.streams[0].close()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testOpeningANewChatsSessionBeforeItsIdArrivesKeepsBothSends() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("first")
        await clock.runCurrent()
        // 服务端已经建好 s1（还没回 X-Session-Id），用户从侧栏打开了它：读到的历史只有这次的提问。
        vm.newChat()
        backend.storedBySession?["s1"] = [chatDto("db-1", "USER", "first")]
        vm.openSession("s1")
        await clock.settle()
        XCTAssertEqual(contents(vm), ["first"])
        vm.send("second")
        await clock.runCurrent()

        backend.streams[0].send(.started(sessionId: "s1"))
        backend.streams[0].send(.delta(text: "one"))
        await clock.settle()
        // 本机这份换掉读来的历史，后发的那条接在后面，两个任务都还在。
        XCTAssertEqual(contents(vm), ["first", "one", "second", ""])
        XCTAssertTrue(vm.state.sending)

        backend.streams[0].close()
        await clock.settle()
        XCTAssertTrue(vm.state.sending)
        backend.streams[1].send(.delta(text: "two"))
        await clock.settle()
        XCTAssertEqual(contents(vm), ["first", "one", "second", "two"])
        vm.stop()
        await clock.advanceUntilIdle()
        XCTAssertFalse(vm.state.sending)
    }

    @MainActor
    func testATurnFinishedAndReconciledInTheNewChatsSessionSurvivesTheLateMigration() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("first")
        await clock.runCurrent()
        vm.newChat()
        backend.storedBySession?["s1"] = [chatDto("db-1", "USER", "first")]
        vm.openSession("s1")
        await clock.settle()
        vm.send("second")
        await clock.runCurrent()
        // 第二回合先结束并对账：读到的历史里它已经是服务端 ID。
        backend.storedBySession?["s1"] = [
            chatDto("db-1", "USER", "first"),
            chatDto("db-2", "USER", "second"),
            chatDto("db-3", "ASSISTANT", "two"),
        ]
        backend.streams[1].send(.delta(text: "two"))
        backend.streams[1].close()
        await clock.settle()

        backend.streams[0].send(.started(sessionId: "s1"))
        backend.streams[0].send(.delta(text: "one"))
        await clock.settle()
        XCTAssertEqual(contents(vm), ["first", "one", "second", "two"])
        vm.stop()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testANewChatThatFailsAfterTheUserLeftPutsThePromptBack() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.storedBySession?["s9"] = [chatDto("o-1", "USER", "other chat")]
        let vm = await newViewModel(backend, clock)

        vm.updateDraft("lost?")
        vm.send("lost?")
        await clock.runCurrent()
        XCTAssertEqual(vm.draft, "")
        vm.openSession("s9")
        await clock.settle()
        backend.streams[0].close(ChatTestError("boom"))
        await clock.advanceUntilIdle()

        XCTAssertEqual(vm.draft, "lost?")
        XCTAssertEqual(contents(vm), ["other chat"])
        XCTAssertTrue(vm.state.generatingSessionIds.isEmpty)
    }

    @MainActor
    func testNewChatOnAnUnsentNewChatKeepsTheUploadGoing() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let uploadGate = ChatDeferred<Void>()
        backend.uploadHandler = { try await uploadGate.value() }
        let vm = await newViewModel(backend, clock)

        vm.addFiles([notes])
        vm.send("with file")
        await clock.settle()
        vm.newChat()
        uploadGate.complete()
        await clock.settle()

        XCTAssertEqual(backend.requests.count, 1)
        XCTAssertEqual(backend.requests.first?.uploads, ["ticket-0"])
        XCTAssertEqual(contents(vm).first, "with file")
        backend.streams[0].close()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testAnUploadFailingAfterTheUserLeftShowsNoErrorInTheOtherChat() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let uploadGate = ChatDeferred<Void>()
        backend.uploadHandler = { try await uploadGate.value() }
        let vm = await newViewModel(backend, clock)

        vm.addFiles([notes])
        vm.send("with file")
        await clock.settle()
        vm.openSession("s7")
        uploadGate.fail(ChatTestError("offline"))
        await clock.advanceUntilIdle()

        XCTAssertNil(vm.state.notice)
        XCTAssertNil(vm.state.upload)
    }

    @MainActor
    func testAFailedQuietReloadKeepsTheCacheAndShowsANoticeAndAMissingChatUnbinds() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)

        vm.send("q")
        await clock.runCurrent()
        backend.streams[0].send(.started(sessionId: "s1"))
        await clock.settle()
        backend.storedBySession?["s1"] = [chatDto("db-1", "USER", "q"), chatDto("db-2", "ASSISTANT", "a")]
        backend.streams[0].close()
        await clock.advanceUntilIdle()
        vm.openSession("s9")
        await clock.advanceUntilIdle()

        backend.messagesError = ChatTestError("offline")
        vm.openSession("s1")
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.activeSessionId, "s1")
        XCTAssertEqual(contents(vm), ["q", "a"])
        XCTAssertEqual(vm.state.notice, .loadFailed)
        XCTAssertFalse(vm.state.messagesFailed)

        vm.openSession("s9")
        XCTAssertNil(vm.state.notice)
        await clock.advanceUntilIdle()
        backend.messagesError = ApiException(status: 404, message: "Session not found")
        vm.openSession("s1")
        await clock.advanceUntilIdle()
        XCTAssertNil(vm.state.activeSessionId)
        XCTAssertTrue(vm.state.messages.isEmpty)
        XCTAssertEqual(vm.state.notice, .loadFailed)
    }

    @MainActor
    func testABackgroundChatsReconcileCarriesLocalKeysAndReportsReplacedIds() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let renames = ChatTestBox<[[String]]>([])
        let vm = makeChatViewModel(backend, clock: clock, onMessageIdChanged: { session, from, to in renames.value.append([session, from, to]) })
        await clock.advanceUntilIdle()

        vm.send("q")
        await clock.runCurrent()
        backend.streams[0].send(.started(sessionId: "s1"))
        backend.streams[0].send(.delta(text: "a"))
        await clock.settle()
        let localIds = vm.state.messages.map(\.id)
        XCTAssertEqual(localIds.count, 2)
        // 回答结束前去了别的聊天：对账在后台进行。
        vm.openSession("s9")
        await clock.settle()
        backend.storedBySession?["s1"] = [chatDto("db-1", "USER", "q"), chatDto("db-2", "ASSISTANT", "a")]
        backend.streams[0].close()
        await clock.advanceUntilIdle()

        XCTAssertEqual(renames.value, [["s1", localIds.first ?? "", "db-1"], ["s1", localIds.last ?? "", "db-2"]])
        let gate = ChatDeferred<Void>()
        backend.messagesGate = gate
        vm.openSession("s1")
        await clock.runCurrent()
        XCTAssertEqual(vm.state.messages.map(\.id), ["db-1", "db-2"])
        XCTAssertEqual(vm.state.messages.map(\.key), localIds)
        // 回来时的静默重读同样沿用 key，不再重复报告。
        gate.complete()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.messages.map(\.key), localIds)
        XCTAssertEqual(renames.value.count, 2)
    }

    @MainActor
    func testADraftIconFollowsItsSendToTheSessionIdAfterTheUserLeftThatNewChat() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let saved = ChatTestBox<[[String?]]>([])
        let vm = makeChatViewModel(backend, clock: clock, saveIcon: { id, icon in
            saved.value.append([id, icon])
            return true
        })
        await clock.advanceUntilIdle()

        vm.changeIcon("🧪")
        vm.send("q")
        await clock.runCurrent()
        vm.newChat()
        // 新开的聊天没有草稿图标；它自己的草稿不影响前一个聊天。
        XCTAssertNil(vm.state.draftIcon)
        vm.changeIcon("🎒")
        backend.streams[0].send(.started(sessionId: "s1"))
        await clock.settle()

        XCTAssertEqual(saved.value, [["s1", "🧪"]])
        XCTAssertNil(vm.state.activeSessionId)
        XCTAssertEqual(vm.state.draftIcon, "🎒")
        backend.streams[0].close()
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testRevealingAHitMissingFromACachedBackgroundChatWaitsForTheReload() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let vm = await newViewModel(backend, clock)
        vm.send("q")
        await clock.runCurrent()
        backend.streams[0].send(.started(sessionId: "s1"))
        await clock.settle()
        backend.storedBySession?["s1"] = [chatDto("db-1", "USER", "q"), chatDto("db-2", "ASSISTANT", "a")]
        backend.streams[0].close()
        await clock.advanceUntilIdle()
        vm.openSession("s9")
        await clock.advanceUntilIdle()

        backend.storedBySession?["s1"]?.append(chatDto("db-3", "USER", "from another device"))
        vm.openSessionAt("s1", messageId: "db-3")
        // 缓存先显示，但定位要等服务器版本。
        XCTAssertEqual(contents(vm), ["q", "a"])
        XCTAssertTrue(vm.state.messagesLoading)
        await clock.advanceUntilIdle()
        XCTAssertFalse(vm.state.messagesLoading)
        XCTAssertEqual(vm.state.reveal?.messageId, "db-3")
        XCTAssertEqual(vm.state.messages.count, 3)

        // 缓存里已有的消息直接定位，不等读取。
        vm.openSession("s9")
        await clock.advanceUntilIdle()
        vm.openSessionAt("s1", messageId: "db-1")
        XCTAssertFalse(vm.state.messagesLoading)
        XCTAssertEqual(vm.state.reveal?.messageId, "db-1")
        await clock.advanceUntilIdle()
    }

    @MainActor
    func testANewChatInAProjectTakesTheDraftIconOfANewChatStillUploadingItsFirstSend() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let uploadGate = ChatDeferred<Void>()
        backend.uploadHandler = { try await uploadGate.value() }
        let saved = ChatTestBox<[[String?]]>([])
        let vm = makeChatViewModel(backend, clock: clock, saveIcon: { id, icon in
            saved.value.append([id, icon])
            return true
        })
        await clock.advanceUntilIdle()

        vm.changeIcon("🧪")
        vm.addFiles([notes])
        vm.updateDraft("with file")
        vm.send("with file")
        await clock.settle()
        XCTAssertTrue(vm.state.sending)
        // 上传还没完就在项目里新建：这次上传不会发出，草稿图标带到建好的聊天上。
        vm.openCreatedSession(SessionSummary(id: "p1", title: "New chat", projectId: "proj"))
        await clock.settle()
        XCTAssertEqual(vm.state.activeSessionId, "p1")
        XCTAssertEqual(vm.state.activeIcon, "🧪")
        XCTAssertEqual(saved.value, [["p1", "🧪"]])

        uploadGate.complete()
        await clock.advanceUntilIdle()
        XCTAssertTrue(backend.requests.isEmpty)
        XCTAssertEqual(vm.draft, "with file")
        XCTAssertEqual(vm.leftoverNewChats, [])
    }

    @MainActor
    func testADiscardedUploadOfANewChatTheUserLeftLeavesNoCacheOrDraftIcon() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        let uploadGate = ChatDeferred<Void>()
        backend.uploadHandler = { try await uploadGate.value() }
        let vm = await newViewModel(backend, clock)

        vm.changeIcon("🧪")
        vm.addFiles([notes])
        vm.send("with file")
        await clock.settle()
        vm.openSession("s7")
        uploadGate.complete()
        await clock.advanceUntilIdle()

        XCTAssertTrue(backend.requests.isEmpty)
        XCTAssertEqual(vm.leftoverNewChats, [])
    }

    @MainActor
    func testAUsageLimitOnANewChatTheUserLeftPutsThePromptBackAndLeavesNoCache() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.storedBySession?["s9"] = [chatDto("o-1", "USER", "other chat")]
        let vm = await newViewModel(backend, clock)

        vm.changeIcon("🧪")
        vm.updateDraft("over")
        vm.send("over")
        await clock.runCurrent()
        vm.openSession("s9")
        await clock.settle()
        backend.streams[0].close(chatUsageLimit("Daily limit reached.", tier: "guest"))
        await clock.advanceUntilIdle()

        XCTAssertEqual(vm.draft, "over")
        XCTAssertEqual(vm.state.guestLimit, "chat")
        XCTAssertEqual(contents(vm), ["other chat"])
        XCTAssertTrue(vm.state.generatingSessionIds.isEmpty)
        XCTAssertEqual(vm.leftoverNewChats, [])
    }

    @MainActor
    func testAPromptPutBackWhileTheOpenChatUploadsSurvivesThatSend() async {
        let clock = ChatTestClock()
        let backend = newBackend()
        backend.storedBySession?["s9"] = [chatDto("o-1", "USER", "other chat")]
        let uploadGate = ChatDeferred<Void>()
        backend.uploadHandler = { try await uploadGate.value() }
        let vm = await newViewModel(backend, clock)

        vm.updateDraft("lost?")
        vm.send("lost?")
        await clock.runCurrent()
        vm.openSession("s9")
        await clock.settle()
        vm.addFiles([notes])
        vm.updateDraft("with file")
        vm.send("with file")
        await clock.settle()
        XCTAssertNotNil(vm.state.upload)
        // 后台的新聊天失败：现在放回去会被这次发送清掉，等上传结束再放。
        backend.streams[0].close(ChatTestError("boom"))
        await clock.settle()
        XCTAssertEqual(vm.draft, "with file")

        uploadGate.complete()
        await clock.settle()
        XCTAssertEqual(backend.requests.count, 2)
        XCTAssertEqual(backend.requests.last?.message, "with file")
        XCTAssertEqual(vm.draft, "lost?")
        XCTAssertTrue(vm.state.files.isEmpty)
        backend.streams[1].close()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.draft, "lost?")
    }
}
