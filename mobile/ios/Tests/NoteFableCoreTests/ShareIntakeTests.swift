import Foundation
import XCTest
@testable import NoteFableCore

/// 系统「分享」交来的内容：文字的组合、`notefable://share` 地址、共享目录里的取走，以及放进新聊天输入栏的行为
/// （Android 的 `ShareIntakeTest` / `ChatViewModelShareTest` 的对应）。
final class ShareIntakeTests: XCTestCase {
    private var directory: URL!
    private var store: ShareInboxStore!
    private var destination: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("nf-share-\(UUID().uuidString)", isDirectory: true)
        destination = directory.appendingPathComponent("attachments", isDirectory: true)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        store = ShareInboxStore(containerURL: directory.appendingPathComponent("group", isDirectory: true))
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    // MARK: - 文字

    func testComposeJoinsTitleTextAndUrl() {
        XCTAssertEqual(
            ShareIntake.composeText(title: "Article", text: "Read this", url: "https://example.com/a"),
            "Article\nRead this\nhttps://example.com/a"
        )
    }

    func testComposeDoesNotRepeatWhatIsAlreadyThere() {
        XCTAssertEqual(ShareIntake.composeText(title: "T", text: "see https://example.com/a", url: "https://example.com/a"), "T\nsee https://example.com/a")
        XCTAssertEqual(ShareIntake.composeText(title: "https://example.com/a", text: nil, url: "https://example.com/a"), "https://example.com/a")
        XCTAssertEqual(ShareIntake.composeText(title: "Hello", text: "Hello world", url: nil), "Hello world")
    }

    func testComposeKeepsMultilineUnicodeAndIgnoresBlanks() {
        XCTAssertEqual(ShareIntake.composeText(title: "  ", text: "  一行目\n二行目 🎉  ", url: nil), "一行目\n二行目 🎉")
        XCTAssertEqual(ShareIntake.composeText(title: nil, text: nil, url: nil), "")
    }

    func testMergeDraftAppendsAfterWhatWasTyped() {
        XCTAssertEqual(ShareIntake.mergeDraft(existing: "draft", shared: "shared"), "draft\n\nshared")
        XCTAssertEqual(ShareIntake.mergeDraft(existing: "  ", shared: "shared"), "shared")
        XCTAssertEqual(ShareIntake.mergeDraft(existing: "draft", shared: " "), "draft")
    }

    // MARK: - 地址

    func testShareUrlRoundTrips() {
        let id = UUID().uuidString
        let url = ShareIntake.shareURL(id: id)
        XCTAssertEqual(url.absoluteString, "notefable://share?id=\(id)")
        XCTAssertEqual(ShareIntake.parseShareURL(url), id)
    }

    func testParseShareUrlRejectsOtherAddresses() throws {
        XCTAssertNil(ShareIntake.parseShareURL(try XCTUnwrap(URL(string: "https://app.notefable.com/c/abc"))))
        XCTAssertNil(ShareIntake.parseShareURL(try XCTUnwrap(URL(string: "notefable://other?id=abcdef12"))))
        XCTAssertNil(ShareIntake.parseShareURL(try XCTUnwrap(URL(string: "notefable://share"))))
        XCTAssertNil(ShareIntake.parseShareURL(try XCTUnwrap(URL(string: "notefable://share?id=short"))))
        XCTAssertNil(ShareIntake.parseShareURL(try XCTUnwrap(URL(string: "notefable://share?id=..%2F..%2Fsecrets"))))
    }

    // MARK: - 共享目录

    func testWriteThenConsumeCopiesFilesAndRemovesTheShare() throws {
        let source = directory.appendingPathComponent("source.txt")
        try Data("from disk".utf8).write(to: source)
        let payload = try store.write(
            text: "hello",
            files: [
                SharedFileInput(name: "notes.txt", mimeType: "text/plain", size: 4, data: Data("abcd".utf8)),
                SharedFileInput(name: "disk.txt", mimeType: "text/plain", size: 9, fileURL: source),
                SharedFileInput(name: "huge.pdf", mimeType: "application/pdf", size: 30 * 1024 * 1024),
            ]
        )

        let consumed = try XCTUnwrap(store.consume(id: payload.id, copyFilesTo: destination))
        XCTAssertEqual(consumed.text, "hello")
        XCTAssertEqual(consumed.files.map(\.name), ["notes.txt", "disk.txt", "huge.pdf"])
        XCTAssertEqual(consumed.files.map(\.size), [4, 9, 30 * 1024 * 1024])
        let first = try XCTUnwrap(URL(string: consumed.files[0].uri))
        XCTAssertEqual(try String(contentsOf: first, encoding: .utf8), "abcd")
        XCTAssertEqual(first.pathExtension, "txt")
        XCTAssertTrue(first.path.hasPrefix(destination.path))
        XCTAssertEqual(try String(contentsOf: try XCTUnwrap(URL(string: consumed.files[1].uri)), encoding: .utf8), "from disk")
        // 太大没有拷贝的文件：不是能打开的文件，大小是真实的。
        XCTAssertTrue(consumed.files[2].uri.hasPrefix("share-oversize:"))

        // 取走就删：不能取第二次。
        XCTAssertNil(store.consume(id: payload.id, copyFilesTo: destination))
        XCTAssertTrue(store.consumeAllPending(copyFilesTo: destination).isEmpty)
    }

    func testConsumeAllPendingTakesEveryUnexpiredShareInOrder() throws {
        let now = Date()
        try store.write(text: "first", files: [], now: now.addingTimeInterval(-30))
        try store.write(text: "second", files: [], now: now.addingTimeInterval(-10))
        XCTAssertTrue(store.hasPending(now: now))

        let all = store.consumeAllPending(copyFilesTo: destination, now: now)
        XCTAssertEqual(all.map(\.text), ["first", "second"])
        XCTAssertFalse(store.hasPending(now: now))
        XCTAssertTrue(store.consumeAllPending(copyFilesTo: destination, now: now).isEmpty)

        let stale = try store.write(text: "stale", files: [], now: now.addingTimeInterval(-(25 * 60 * 60)))
        XCTAssertFalse(store.hasPending(now: now))
        XCTAssertTrue(store.consumeAllPending(copyFilesTo: destination, now: now).isEmpty)
        XCTAssertNil(store.consume(id: stale.id, copyFilesTo: destination, now: now))
    }

    func testWritingPrunesExpiredShares() throws {
        let now = Date()
        let stale = try store.write(text: "stale", files: [], now: now.addingTimeInterval(-(25 * 60 * 60)))
        try store.write(text: "fresh", files: [], now: now)
        XCTAssertNil(store.consume(id: stale.id, copyFilesTo: destination, now: now))
    }

    func testCopyFailureRetainsInboxForRetry() throws {
        let payload = try store.write(
            text: "keep me",
            files: [SharedFileInput(name: "notes.txt", mimeType: "text/plain", size: 4, data: Data("abcd".utf8))]
        )
        // 用一个普通文件冒充目标目录，使拷贝必然失败。
        let notADir = directory.appendingPathComponent("blocker")
        try Data("x".utf8).write(to: notADir)

        XCTAssertNil(store.consume(id: payload.id, copyFilesTo: notADir))
        // 共享目录必须保留，换成正常目录后仍能成功取走。
        XCTAssertTrue(store.hasPending(id: payload.id))
        let retried = try XCTUnwrap(store.consume(id: payload.id, copyFilesTo: destination))
        XCTAssertEqual(retried.text, "keep me")
        XCTAssertEqual(retried.files.count, 1)
    }

    func testConsumeRejectsUnsafeIds() {
        XCTAssertNil(store.consume(id: "../escape", copyFilesTo: destination))
        XCTAssertNil(store.consume(id: "missing-id-1234", copyFilesTo: destination))
    }

    // MARK: - 放进新聊天

    private let notes = LocalFile(uri: "file:///notes", name: "notes.txt", mimeType: "text/plain", size: 1200)
    private let photo = LocalFile(uri: "file:///photo", name: "photo.png", mimeType: "image/png", size: 3400)

    @MainActor
    func testShareFromAnOpenedChatStartsANewChatDropsTheQuoteAndFillsTheComposer() async {
        let clock = ChatTestClock()
        let backend = ChatFakeBackend()
        backend.stored = [chatDto("m1", "USER", "old")]
        let vm = makeChatViewModel(backend, clock: clock)
        await clock.advanceUntilIdle()
        vm.openSession("s1")
        await clock.advanceUntilIdle()
        vm.setQuote("quoted text")
        XCTAssertEqual(vm.state.activeSessionId, "s1")

        let (notes, photo) = (self.notes, self.photo)
        vm.applyIncomingShare(text: "shared link", loadFiles: { [notes, photo] })
        await clock.advanceUntilIdle()

        XCTAssertNil(vm.state.activeSessionId)
        XCTAssertTrue(vm.state.messages.isEmpty)
        XCTAssertNil(vm.state.quote)
        XCTAssertEqual(vm.draft, "shared link")
        XCTAssertEqual(vm.state.files, [notes, photo])
        XCTAssertEqual(vm.state.importing, 0)
        XCTAssertFalse(vm.state.sending)
    }

    @MainActor
    func testShareInAnEmptyNewChatKeepsWhatWasTypedAndTheQuote() async {
        let clock = ChatTestClock()
        let vm = makeChatViewModel(ChatFakeBackend(), clock: clock)
        await clock.advanceUntilIdle()
        vm.updateDraft("half written")
        vm.setQuote("kept quote")
        vm.addFiles([notes])

        let photo = self.photo
        vm.applyIncomingShare(text: "shared", loadFiles: { [photo] })
        await clock.advanceUntilIdle()

        XCTAssertEqual(vm.draft, "half written\n\nshared")
        XCTAssertEqual(vm.state.quote, "kept quote")
        XCTAssertEqual(vm.state.files, [notes, photo])
    }

    @MainActor
    func testTextOnlyShareAddsNoFiles() async {
        let clock = ChatTestClock()
        let vm = makeChatViewModel(ChatFakeBackend(), clock: clock)
        await clock.advanceUntilIdle()

        vm.applyIncomingShare(text: "just text")
        await clock.advanceUntilIdle()

        XCTAssertEqual(vm.draft, "just text")
        XCTAssertTrue(vm.state.files.isEmpty)
    }

    @MainActor
    func testAnOversizeSharedFileIsRejectedAsAWholeWithTheUsualNotice() async {
        let clock = ChatTestClock()
        let vm = makeChatViewModel(ChatFakeBackend(), clock: clock)
        await clock.advanceUntilIdle()
        let huge = LocalFile(uri: "share-oversize:1", name: "huge.pdf", mimeType: "application/pdf", size: MAX_UPLOAD_FILE_BYTES + 1)

        let notes = self.notes
        vm.applyIncomingShare(text: "", loadFiles: { [notes, huge] })
        await clock.advanceUntilIdle()

        XCTAssertTrue(vm.state.files.isEmpty)
        XCTAssertEqual(vm.state.notice, .rejected(.notAdded(cause: .fileTooLarge(name: "huge.pdf", limitBytes: MAX_UPLOAD_FILE_BYTES))))
    }
}
