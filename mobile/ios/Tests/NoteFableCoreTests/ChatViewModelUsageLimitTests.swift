import Foundation
import XCTest
@testable import NoteFableCore

/// 429 使用上限：被拒的草稿和附件放回输入栏、未登录时的登录提示（网页 page.tsx 的 UsageLimitError 分支）。
/// Android `ChatViewModelUsageLimitTest` 的移植（安装包里的 usage-limits.json 那一条在 UsageLimitsTests）。
final class ChatViewModelUsageLimitTests: XCTestCase {
    private let photo = LocalFile(uri: "content://photo", name: "photo.png", mimeType: "image/png", size: 3400)
    private let notes = LocalFile(uri: "content://notes", name: "notes.txt", mimeType: "text/plain", size: 1200)

    /// 每次发送都等 `release` 放行后以 `error` 结束。
    @MainActor
    private func limitedBackend(_ error: Error, _ release: ChatTestBox<ChatDeferred<Void>>) -> ChatFakeBackend {
        let backend = ChatFakeBackend(models: ModelsResponse(
            defaultModel: "a",
            models: [ModelInfo(id: "a", label: "Model A", supportsImageInput: true, supportsWebSearch: true, reasoningEfforts: ["low"], defaultReasoning: "low")]
        ))
        backend.streamHandler = { _ in
            let gate = release.value
            return AsyncThrowingStream { continuation in
                Task { @MainActor in
                    _ = try? await gate.value()
                    continuation.finish(throwing: error)
                }
            }
        }
        backend.imageHandler = { _ in
            try await release.value.value()
            throw error
        }
        return backend
    }

    @MainActor
    private func newViewModel(_ backend: ChatFakeBackend, _ clock: ChatTestClock) async -> ChatViewModel {
        let vm = makeChatViewModel(backend, clock: clock)
        await clock.advanceUntilIdle()
        return vm
    }

    @MainActor
    func testARejectedMessageGoesBackIntoTheComposerAheadOfTextTypedMeanwhile() async {
        let clock = ChatTestClock()
        let release = ChatTestBox(ChatDeferred<Void>())
        let vm = await newViewModel(limitedBackend(chatUsageLimit(tier: "guest"), release), clock)

        vm.updateDraft("first question  ")
        vm.send(vm.draft)
        await clock.settle()
        XCTAssertEqual(vm.draft, "")
        vm.updateDraft("added later")
        release.value.complete()
        await clock.advanceUntilIdle()

        XCTAssertEqual(vm.draft, "first question\n\nadded later")
        XCTAssertEqual(vm.state.guestLimit, "chat")
        XCTAssertEqual(vm.state.messages.last?.usageLimit, true)
    }

    func testWithoutTextTypedMeanwhileTheRejectedTextComesBackUnchanged() {
        XCTAssertEqual(ChatViewModel.mergeRejectedDraft("hello  ", ""), "hello  ")
        XCTAssertEqual(ChatViewModel.mergeRejectedDraft("hello  ", "  \n"), "hello  ")
        XCTAssertEqual(ChatViewModel.mergeRejectedDraft("hello \n", "more"), "hello\n\nmore")
    }

    @MainActor
    func testRejectedPagesComeBackFirstWithoutDroppingPagesPickedMeanwhile() async {
        let clock = ChatTestClock()
        let release = ChatTestBox(ChatDeferred<Void>())
        let vm = await newViewModel(limitedBackend(chatUsageLimit(tier: "member"), release), clock)
        let plan = ChatProjectNote(id: "n1", title: "Plan")
        let todo = ChatProjectNote(id: "n2", title: "Todo")

        vm.setAttachedPages([plan])
        vm.send("summarize")
        await clock.settle()
        XCTAssertTrue(vm.state.attachedPages.isEmpty)
        vm.setAttachedPages([todo])
        release.value.complete()
        await clock.advanceUntilIdle()

        XCTAssertEqual(vm.state.attachedPages, [plan, todo])
        XCTAssertEqual(vm.state.upgradeLimit, "chat")
    }

    @MainActor
    func testRejectedAttachmentsAreRestoredFirstAndTheSentBubbleDropsItsLocalImagePreview() async {
        let clock = ChatTestClock()
        let release = ChatTestBox(ChatDeferred<Void>())
        let vm = await newViewModel(limitedBackend(chatUsageLimit(tier: "member"), release), clock)

        vm.addFiles([photo])
        vm.send("look")
        await clock.settle()
        XCTAssertTrue(vm.state.files.isEmpty)
        XCTAssertEqual(vm.state.messages.first?.attachments.first?.dataUrl, "content://photo")
        vm.addFiles([notes])
        release.value.complete()
        await clock.advanceUntilIdle()

        XCTAssertEqual(vm.state.files, [photo, notes])
        let sent = vm.state.messages.first { $0.role == .user }
        XCTAssertEqual(sent?.attachments.count, 1)
        XCTAssertNil(sent?.attachments.first?.dataUrl)
        // 已登录用户撞到上限不显示登录提示。
        XCTAssertNil(vm.state.guestLimit)
    }

    @MainActor
    func testAnImageLimitForAGuestShowsTheImagePromptClosingItOrChangingIdentityHidesIt() async {
        let clock = ChatTestClock()
        let release = ChatTestBox(ChatDeferred<Void>())
        let vm = await newViewModel(limitedBackend(chatUsageLimit(tier: "guest", kind: "image"), release), clock)

        vm.setImageMode(true)
        vm.send("a cat")
        release.value.complete()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.guestLimit, "image")
        XCTAssertEqual(vm.draft, "a cat")

        vm.dismissGuestLimit()
        XCTAssertNil(vm.state.guestLimit)

        release.value = ChatDeferred<Void>()
        vm.addFiles([photo])
        vm.send(vm.draft)
        release.value.complete()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.state.guestLimit, "image")

        // 登录后：草稿留着，附件和网页一样不跨登录保留，提示关闭。
        vm.onIdentityChanged()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.draft, "a cat")
        XCTAssertTrue(vm.state.files.isEmpty)
        XCTAssertNil(vm.state.guestLimit)
    }

    @MainActor
    func testOtherFailuresDoNotTouchTheComposer() async {
        let clock = ChatTestClock()
        let release = ChatTestBox(ChatDeferred<Void>())
        let vm = await newViewModel(limitedBackend(ChatTestError("offline"), release), clock)

        vm.send("hi")
        release.value.complete()
        await clock.advanceUntilIdle()
        XCTAssertEqual(vm.draft, "")
        XCTAssertNil(vm.state.guestLimit)
        XCTAssertEqual(vm.state.messages.last?.errorDetail, "offline")
    }
}
