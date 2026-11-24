import Foundation
import XCTest
@testable import NoteFableCore

/// 文件存储上限（网页 src/lib/stored-files.ts 的 413 storage_limit、usage-plans.ts 的 formatStorageSize）。
/// Android `StorageLimitTest` 和 `ChatViewModelUsageLimitTest` 里存储空间那几条的移植。
final class StorageLimitTests: XCTestCase {
    func testTheStorageLimitErrorCarriesTheTierAndByteCounts() {
        let error = ApiException.from(status: 413, body: #"{"error":"full","code":"storage_limit","tier":"member","used":11811160064,"limit":10737418240}"#)
        XCTAssertTrue(error.isStorageLimit)
        XCTAssertFalse(error.isUsageLimit)
        XCTAssertEqual(error.storageLimitInfo, StorageLimitInfo(tier: "member", used: 11_811_160_064, limit: 10_737_418_240))
        XCTAssertEqual(error.message, "full")
    }

    func testOther413ErrorsAreNotStorageLimits() {
        let tooLarge = ApiException.from(status: 413, body: #"{"error":"Files must be 4 MB or smaller."}"#)
        XCTAssertFalse(tooLarge.isStorageLimit)
        XCTAssertNil(tooLarge.storageLimitInfo)
    }

    func testSizesAreShownLikeTheWebAndNeverRoundedUp() {
        XCTAssertEqual(formatStorageSize(0), "0 KB")
        XCTAssertEqual(formatStorageSize(100 * 1024 * 1024), "100 MB")
        XCTAssertEqual(formatStorageSize(500 * 1024 * 1024 - 1), "499 MB")
        XCTAssertEqual(formatStorageSize(Int(2.56 * 1024 * 1024)), "2.5 MB")
        XCTAssertEqual(formatStorageSize(10 * 1024 * 1024 * 1024), "10 GB")
        XCTAssertEqual(formatStorageSize(Int(1.25 * 1024 * 1024 * 1024)), "1.2 GB")
        XCTAssertEqual(formatStorageSize(Int(2.5 * 1024 * 1024), locale: Locale(identifier: "de")), "2,5 MB")
    }

    func testTheNoteEditorTellsTheAppWhenAnUploadDidNotFit() {
        XCTAssertEqual(
            EmbedMessage.parse(#"{"type":"storageLimit","tier":"guest","used":1,"limit":104857600}"#),
            .storageLimit(tier: "guest", used: 1, limit: 104_857_600)
        )
        XCTAssertNil(EmbedMessage.parse(#"{"type":"storageLimit","tier":"guest"}"#))
        XCTAssertTrue(NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en").contains("canShowStorageLimit:function(){return true}"))
    }

    func testTheNoteEditorTellsTheAppWhenUsageLimitIsHit() {
        XCTAssertEqual(
            EmbedMessage.parse(#"{"type":"usageLimit","tier":"guest","kind":"chat"}"#),
            .usageLimit(tier: "guest", kind: "chat")
        )
        XCTAssertEqual(
            EmbedMessage.parse(#"{"type":"usageLimit","tier":"member","kind":"image","pageId":"page_1"}"#),
            .usageLimit(tier: "member", kind: "image", pageId: "page_1")
        )
        XCTAssertEqual(
            EmbedMessage.parse(#"{"type":"usageLimit","tier":"pro","kind":"chat","pageId":"  "}"#),
            .usageLimit(tier: "pro", kind: "chat", pageId: nil)
        )
        XCTAssertNil(EmbedMessage.parse(#"{"type":"usageLimit","tier":"guest"}"#))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"usageLimit","tier":"unknown","kind":"chat"}"#))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"usageLimit","tier":"guest","kind":"other"}"#))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"usageLimit","tier":1,"kind":"chat"}"#))
        XCTAssertTrue(NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en").contains("canShowUsageLimit:function(){return true}"))
    }

    func testThePlanShowsStorageUsageAfterTheOtherMeters() throws {
        let plan = try NoteFableJson.decodeFromString(
            PlanInfo.self,
            #"{"plan":"pro","usage":{"chat":{"used":1,"limit":2000,"period":"month"}},"storage":{"used":3221225472,"limit":10737418240}}"#
        )
        XCTAssertEqual(plan.storage, PlanStorage(used: 3_221_225_472, limit: 10_737_418_240))
        let meter = try XCTUnwrap(plan.meters.last)
        XCTAssertEqual(meter.labelKey, "plan_storage")
        XCTAssertEqual(meter.countText, "3 GB / 10 GB")
        XCTAssertFalse(meter.full)
        XCTAssertNil(try NoteFableJson.decodeFromString(PlanInfo.self, #"{"plan":"free"}"#).storage)
    }

    func testTheBundledLimitsCarryStorageAndOldFilesStillParse() throws {
        let limits = try UsageLimits.parse(TextTestSupport.androidAsset("usage-limits.json"))
        XCTAssertEqual(limits.member.storage, 500 * 1024 * 1024)
        XCTAssertEqual(limits.pro.storage, 10 * 1024 * 1024 * 1024)
        let old = try UsageLimits.parse(#"{"guest":{"chat":20,"image":10},"member":{"chat":40,"image":20},"pro":{"chat":2000,"image":60}}"#)
        XCTAssertNil(old.member.storage)
    }

    @MainActor
    func testAStorageRefusalWhileUploadingKeepsTheTextAndFilesAndShowsTheStoragePrompt() async {
        let clock = ChatTestClock()
        let backend = ChatFakeBackend(models: ModelsResponse(
            defaultModel: "a",
            models: [ModelInfo(id: "a", label: "Model A", supportsImageInput: true, supportsWebSearch: true, reasoningEfforts: ["low"], defaultReasoning: "low")]
        ))
        backend.uploadError = ApiException(
            status: 413, message: "There isn't enough storage space left. Delete files you no longer need to free up space.",
            code: ApiException.STORAGE_LIMIT_CODE, tier: "member", used: 500 * 1024 * 1024, limit: 500 * 1024 * 1024
        )
        let vm = makeChatViewModel(backend, clock: clock)
        await clock.advanceUntilIdle()
        let photo = LocalFile(uri: "content://photo", name: "photo.png", mimeType: "image/png", size: 3400)

        vm.updateDraft("look at this")
        vm.addFiles([photo])
        await clock.advanceUntilIdle()
        vm.send(vm.draft)
        await clock.advanceUntilIdle()

        XCTAssertEqual(vm.draft, "look at this")
        XCTAssertEqual(vm.state.files, [photo])
        XCTAssertEqual(vm.state.storageLimit, StorageLimitInfo(tier: "member", used: 500 * 1024 * 1024, limit: 500 * 1024 * 1024))
        XCTAssertNil(vm.state.notice)
        XCTAssertTrue(vm.state.messages.isEmpty)

        vm.dismissStorageLimit()
        XCTAssertNil(vm.state.storageLimit)
    }
}
