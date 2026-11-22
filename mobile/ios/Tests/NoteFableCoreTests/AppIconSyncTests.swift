import XCTest
@testable import NoteFableCore

/// Android AppIconSyncTest 的移植。
@MainActor
final class AppIconSyncTests: XCTestCase {
    private struct Offline: Error {}
    private static let updated = "2026-11-22T00:00:00.000Z"

    /// 服务端的替身：GET 返回 remote，PUT 存下来并返回 account。
    private final class FakeBackend: AppIconBackend, @unchecked Sendable {
        var account = "acct-a"
        var remote = AppIconResponse()
        var failReads = false
        var saveError: Error?
        var reading: (@MainActor () async -> Void)?
        var saved: [String?] = []

        func accountAppIcon() async throws -> AppIconResponse {
            await reading?()
            if failReads { throw Offline() }
            var response = remote
            response.account = account
            return response
        }

        func saveAccountAppIcon(_ icon: String?) async throws -> AppIconResponse {
            saved.append(icon)
            if let saveError { throw saveError }
            remote = AppIconResponse(icon: icon, updatedAt: AppIconSyncTests.updated)
            var response = remote
            response.account = account
            return response
        }
    }

    private var stored: String?
    private var store: AppIconStore!
    private var backend: FakeBackend!
    private var memory: InMemoryAppIconSyncMemory!
    private var sync: AppIconSync!

    override func setUp() async throws {
        stored = nil
        store = AppIconStore(read: { nil }, write: { [unowned self] icon in self.stored = icon; return true })
        backend = FakeBackend()
        memory = InMemoryAppIconSyncMemory()
        sync = AppIconSync(store: store, backend: backend, memory: memory)
        sync.signedIn = true
    }

    func testAccountValueWinsOverThisDeviceAndRecordsItsOwner() async {
        store.save("character:loop")
        backend.remote = AppIconResponse(icon: "character:sora", updatedAt: Self.updated)
        await sync.pull()
        XCTAssertEqual(store.icon, "character:sora")
        XCTAssertEqual(stored, "character:sora")
        XCTAssertEqual(memory.owner, "acct-a")
        XCTAssertFalse(memory.pending)
    }

    func testAccountDefaultCharacterResetsACustomImage() async {
        store.save("data:image/png;base64,AAEC")
        backend.remote = AppIconResponse(icon: nil, updatedAt: Self.updated)
        await sync.pull()
        XCTAssertNil(store.icon)
    }

    func testUploadsAGuestChoiceOnceWhenTheAccountHasNoneYet() async {
        store.save("character:piko")
        await sync.pull()
        XCTAssertEqual(backend.saved, ["character:piko"])
        XCTAssertEqual(store.icon, "character:piko")
        XCTAssertEqual(memory.owner, "acct-a")
    }

    func testUploadsNothingWhenNeitherSideChoseAnIcon() async {
        await sync.pull()
        XCTAssertTrue(backend.saved.isEmpty)
    }

    func testKeepsThisDevicesIconWhenOffline() async {
        store.save("character:loop")
        backend.failReads = true
        await sync.pull()
        XCTAssertEqual(store.icon, "character:loop")
        XCTAssertTrue(backend.saved.isEmpty)
    }

    func testGuestsStayLocalOnlyAndTheirChoiceBelongsToNobody() async {
        memory.owner = "acct-a"
        sync.signedIn = false
        await sync.pull()
        let pushed = await sync.push("character:sora")
        XCTAssertTrue(pushed)
        XCTAssertTrue(backend.saved.isEmpty)
        XCTAssertNil(memory.owner)
    }

    func testPushReportsFailuresButNotASignOut() async {
        let first = await sync.push("character:sora")
        XCTAssertTrue(first)
        backend.saveError = Offline()
        let offline = await sync.push("character:loop")
        XCTAssertFalse(offline)
        backend.saveError = ApiException(status: 401, message: "Sign in to sync your icon.")
        let signedOut = await sync.push("character:velo")
        XCTAssertTrue(signedOut)
        XCTAssertEqual(backend.saved, ["character:sora", "character:loop", "character:velo"])
    }

    func testAChoiceMadeWhileReadingIsNotOverwrittenByTheAccountValue() async {
        backend.remote = AppIconResponse(icon: "character:sora", updatedAt: Self.updated)
        backend.reading = { [unowned self] in
            // 读的途中又在设置里选了一次。
            self.backend.reading = nil
            self.store.save("character:velo")
            _ = await self.sync.push("character:velo")
            self.backend.remote = AppIconResponse(icon: "character:sora", updatedAt: Self.updated)
        }
        await sync.pull()
        XCTAssertEqual(store.icon, "character:velo")
    }

    func testAFailedChoiceIsResentInsteadOfBeingRevertedByTheAccountsOlderValue() async {
        memory.owner = "acct-a"
        backend.remote = AppIconResponse(icon: "character:sora", updatedAt: Self.updated)
        backend.saveError = Offline()
        store.save("character:loop")
        let pushed = await sync.push("character:loop")
        XCTAssertFalse(pushed)
        XCTAssertTrue(memory.pending)

        backend.saveError = nil
        await sync.pull()
        XCTAssertEqual(store.icon, "character:loop")
        XCTAssertEqual(backend.saved.last, "character:loop")
        XCTAssertFalse(memory.pending)
        XCTAssertEqual(memory.owner, "acct-a")
    }

    func testAPendingChoiceStaysPendingWhenTheResendFailsToo() async {
        memory.owner = "acct-a"
        memory.pending = true
        store.save("character:loop")
        backend.remote = AppIconResponse(icon: "character:sora", updatedAt: Self.updated)
        backend.saveError = Offline()
        await sync.pull()
        XCTAssertEqual(store.icon, "character:loop")
        XCTAssertTrue(memory.pending)
    }

    func testAnotherAccountsPhotoIsNotSeededIntoANeverSyncedAccount() async {
        memory.owner = "acct-a"
        store.save("data:image/png;base64,PHOTO")
        backend.account = "acct-b"
        await sync.pull()
        XCTAssertTrue(backend.saved.isEmpty)
        XCTAssertNil(store.icon)
        XCTAssertNil(memory.owner)
    }

    func testAnotherAccountsPendingChoiceIsDroppedNotSent() async {
        memory.owner = "acct-a"
        memory.pending = true
        store.save("data:image/png;base64,PHOTO")
        backend.account = "acct-b"
        backend.remote = AppIconResponse(icon: "character:piko", updatedAt: Self.updated)
        await sync.pull()
        XCTAssertTrue(backend.saved.isEmpty)
        XCTAssertEqual(store.icon, "character:piko")
        XCTAssertEqual(memory.owner, "acct-b")
        XCTAssertFalse(memory.pending)
    }

    func testExplicitSignOutResetsAnAccountsIconButKeepsAGuestChoice() {
        memory.owner = "acct-a"
        store.save("data:image/png;base64,PHOTO")
        sync.forgetAccount()
        XCTAssertNil(store.icon)
        XCTAssertNil(memory.owner)
        XCTAssertFalse(sync.signedIn)

        store.save("character:piko")
        sync.forgetAccount()
        XCTAssertEqual(store.icon, "character:piko")

        memory.pending = true
        store.save("character:loop")
        sync.forgetAccount()
        XCTAssertNil(store.icon)
        XCTAssertFalse(memory.pending)
    }

    func testUserDefaultsMemoryRoundTrips() {
        let suite = "AppIconSyncTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let memory = UserDefaultsAppIconSyncMemory(defaults: defaults)
        XCTAssertNil(memory.owner)
        XCTAssertFalse(memory.pending)
        memory.owner = "acct-a"
        memory.pending = true
        let again = UserDefaultsAppIconSyncMemory(defaults: defaults)
        XCTAssertEqual(again.owner, "acct-a")
        XCTAssertTrue(again.pending)
        again.owner = nil
        XCTAssertNil(memory.owner)
    }
}
