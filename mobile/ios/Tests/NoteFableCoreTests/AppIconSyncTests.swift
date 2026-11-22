import XCTest
@testable import NoteFableCore

/// Android AppIconSyncTest 的移植。
@MainActor
final class AppIconSyncTests: XCTestCase {
    private struct Offline: Error {}

    private final class FakeBackend: AppIconBackend, @unchecked Sendable {
        var remote: () throws -> AppIconResponse = { AppIconResponse() }
        var save: (String?) throws -> AppIconResponse = { AppIconResponse(icon: $0, updatedAt: "2026-11-22T00:00:00.000Z") }
        var reading: (@MainActor () async -> Void)?
        var saved: [String?] = []

        func accountAppIcon() async throws -> AppIconResponse {
            await reading?()
            return try remote()
        }

        func saveAccountAppIcon(_ icon: String?) async throws -> AppIconResponse {
            saved.append(icon)
            return try save(icon)
        }
    }

    private var stored: String?
    private var store: AppIconStore!
    private var backend: FakeBackend!
    private var sync: AppIconSync!

    override func setUp() async throws {
        stored = nil
        store = AppIconStore(read: { nil }, write: { [unowned self] icon in self.stored = icon; return true })
        backend = FakeBackend()
        sync = AppIconSync(store: store, backend: backend)
        sync.signedIn = true
    }

    func testAccountValueWinsOverThisDevice() async {
        store.save("character:loop")
        backend.remote = { AppIconResponse(icon: "character:sora", updatedAt: "2026-11-22T00:00:00.000Z") }
        await sync.pull()
        XCTAssertEqual(store.icon, "character:sora")
        XCTAssertEqual(stored, "character:sora")
    }

    func testAccountDefaultCharacterResetsACustomImage() async {
        store.save("data:image/png;base64,AAEC")
        backend.remote = { AppIconResponse(icon: nil, updatedAt: "2026-11-22T00:00:00.000Z") }
        await sync.pull()
        XCTAssertNil(store.icon)
    }

    func testUploadsThisDevicesIconOnceWhenTheAccountHasNoneYet() async {
        store.save("character:piko")
        await sync.pull()
        XCTAssertEqual(backend.saved, ["character:piko"])
        XCTAssertEqual(store.icon, "character:piko")
    }

    func testUploadsNothingWhenNeitherSideChoseAnIcon() async {
        await sync.pull()
        XCTAssertTrue(backend.saved.isEmpty)
    }

    func testKeepsThisDevicesIconWhenOffline() async {
        store.save("character:loop")
        backend.remote = { throw Offline() }
        await sync.pull()
        XCTAssertEqual(store.icon, "character:loop")
        XCTAssertTrue(backend.saved.isEmpty)
    }

    func testGuestsStayLocalOnly() async {
        sync.signedIn = false
        await sync.pull()
        let pushed = await sync.push("character:sora")
        XCTAssertTrue(pushed)
        XCTAssertTrue(backend.saved.isEmpty)
    }

    func testPushReportsFailuresButNotASignOut() async {
        let first = await sync.push("character:sora")
        XCTAssertTrue(first)
        backend.save = { _ in throw Offline() }
        let offline = await sync.push("character:loop")
        XCTAssertFalse(offline)
        backend.save = { _ in throw ApiException(status: 401, message: "Sign in to sync your icon.") }
        let signedOut = await sync.push("character:velo")
        XCTAssertTrue(signedOut)
        XCTAssertEqual(backend.saved, ["character:sora", "character:loop", "character:velo"])
    }

    func testAChoiceMadeWhileReadingIsNotOverwrittenByTheAccountValue() async {
        backend.remote = { AppIconResponse(icon: "character:sora", updatedAt: "2026-11-22T00:00:00.000Z") }
        backend.reading = { [unowned self] in
            // 读的途中又在设置里选了一次。
            self.store.save("character:velo")
            _ = await self.sync.push("character:velo")
        }
        await sync.pull()
        XCTAssertEqual(store.icon, "character:velo")
    }
}
