import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

/// 记下假服务端收到的请求路径。
private final class PathLog: @unchecked Sendable {
    private let lock = NSLock()
    private var paths: [String] = []

    func add(_ path: String) {
        lock.withLock { paths.append(path) }
    }

    func count(_ path: String) -> Int {
        lock.withLock { paths.filter { $0 == path }.count }
    }
}

private struct TestProposal: ProposalTarget {
    var id: String
    var status: String? = nil
    var editedPageId: String? = nil
    var appliedPageId: String? = nil
}

@MainActor
final class AppEnvironmentTests: XCTestCase {
    private var directory: URL!
    private var suiteName: String!
    private var defaults: UserDefaults!
    private var log: PathLog!
    private var transport: FakeTransport!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("nf-env-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        suiteName = "nf-env-\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let log = PathLog()
        self.log = log
        transport = FakeTransport()
        transport.respond { request in
            log.add(request.path)
            switch request.path {
            case "/api/proposals/pr1/apply": return FakeTransport.Reply(#"{"page":{"id":"p1","title":"T"}}"#)
            case "/api/attachments/a1/image": return FakeTransport.Reply("image-bytes", headers: ["Content-Type": "image/png"])
            default: return FakeTransport.Reply("{}", status: 503)
            }
        }
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: directory)
    }

    /// 一个空目录当作资源包（没有 lproj，也没有打包的 JSON）。
    private func emptyBundle(_ name: String = "resources") throws -> Bundle {
        let root = directory.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return try XCTUnwrap(Bundle(path: root.path))
    }

    private func makeEnvironment(
        config: AppConfig = AppConfig(info: ["NoteFableBaseURL": testBaseUrl]),
        resources: Bundle? = nil,
        l10n: L10n = L10n()
    ) throws -> AppEnvironment {
        AppEnvironment(
            config: config,
            resources: try resources ?? emptyBundle(),
            defaults: defaults,
            dataDirectory: directory.appendingPathComponent("data/nested", isDirectory: true),
            transport: transport,
            systemLanguages: { ["en"] },
            l10n: l10n
        )
    }

    private func eventually(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<400 {
            if condition() { return }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTFail("condition was not met in time", file: file, line: line)
    }

    // MARK: - AppConfig

    func testConfigFallsBackToProduction() async {
        for info in [nil, [:], ["NoteFableBaseURL": "", "NoteFableSiteURL": "  ", "GIDClientID": ""], ["NoteFableBaseURL": "$(NOTEFABLE_BASE_URL)"]] as [[String: Any]?] {
            let config = AppConfig(info: info)
            XCTAssertEqual(config.baseURL, "https://app.notefable.com")
            XCTAssertEqual(config.siteURL, "https://notefable.com")
            XCTAssertNil(config.googleIOSClientId)
            XCTAssertEqual(config.appVersion, "")
        }
    }

    func testConfigReadsInfoDictionaryAndTrimsTrailingSlashes() async {
        let config = AppConfig(info: [
            "NoteFableBaseURL": " https://staging.notefable.test// ",
            "NoteFableSiteURL": "https://site.notefable.test/",
            "GIDClientID": "123.apps.googleusercontent.com",
            "CFBundleShortVersionString": "1.2.3",
            "CFBundleVersion": "45",
        ])
        XCTAssertEqual(config.baseURL, "https://staging.notefable.test")
        XCTAssertEqual(config.siteURL, "https://site.notefable.test")
        XCTAssertEqual(config.googleIOSClientId, "123.apps.googleusercontent.com")
        XCTAssertEqual(config.appVersion, "1.2.3")
        XCTAssertEqual(config.buildNumber, "45")
    }

    // MARK: - 装配

    func testBuildsTheObjectGraphFromAnEmptyBundle() async throws {
        let environment = try makeEnvironment()

        XCTAssertEqual(environment.absoluteUrl("/api/x"), testBaseUrl + "/api/x")
        XCTAssertEqual(environment.absoluteUrl("https://elsewhere.test/a.png"), "https://elsewhere.test/a.png")
        XCTAssertEqual(environment.siteUrl, "https://notefable.com")
        // 放 Cookie 的目录不存在就建。
        var isDirectory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent("data/nested").path, isDirectory: &isDirectory))
        XCTAssertTrue(isDirectory.boolValue)
        XCTAssertTrue(environment.cookies(for: try XCTUnwrap(URL(string: testBaseUrl))).isEmpty)

        // 没有打包资源：系统文显示英文原句，没有上限数值，表情目录读不到。
        XCTAssertEqual(environment.systemText.t("Could not save."), "Could not save.")
        XCTAssertNil(environment.usageLimits)
        XCTAssertNil(environment.appIcon.icon)
        XCTAssertTrue(environment.recentEmoji.load().isEmpty)
        XCTAssertEqual(environment.language.active, .english)

        // 没配 Google 客户端 ID：只有邮箱验证码。
        XCTAssertFalse(environment.googleSignInConfigured)
        XCTAssertFalse(environment.account.state.googleEnabled)

        XCTAssertTrue(environment.chat.state.messages.isEmpty)
        XCTAssertNil(environment.notes.state.open)
        XCTAssertTrue(environment.proposals.states.isEmpty)
        XCTAssertTrue(environment.answerExports.saves.isEmpty)
        XCTAssertNil(environment.editorBridge)
        // 每次打开检索是新的 ViewModel。
        XCTAssertFalse(environment.makeSearchViewModel() === environment.makeSearchViewModel())
    }

    func testGoogleSignInIsOfferedOnlyWithAClientId() async throws {
        let config = AppConfig(info: ["NoteFableBaseURL": testBaseUrl, "GIDClientID": "ios-client"])
        let environment = try makeEnvironment(config: config)
        XCTAssertTrue(environment.googleSignInConfigured)
        XCTAssertTrue(environment.account.state.googleEnabled)

        XCTAssertNil(environment.requestGoogleIdToken)
        environment.requestGoogleIdToken = { _, _ in "token" }
        XCTAssertNotNil(environment.requestGoogleIdToken)
    }

    func testChatDraftAndIconSurviveARestart() async throws {
        let first = try makeEnvironment()
        first.chat.updateDraft("half a question")
        XCTAssertTrue(first.appIcon.save("character:piko"))

        let second = try makeEnvironment()
        XCTAssertEqual(second.chat.draft, "half a question")
        XCTAssertEqual(second.appIcon.icon, first.appIcon.icon)
        XCTAssertEqual(second.appIcon.icon, "character:piko")
    }

    func testIdentityChangeReloadsEverythingAndForgetsCachedImages() async throws {
        let environment = try makeEnvironment()
        let image = "/api/attachments/a1/image"

        let data = try await environment.fetchData(image)
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "image-bytes")
        _ = try await environment.fetchData(image)
        _ = try await environment.fetchData(testBaseUrl + image)
        XCTAssertEqual(log.count(image), 1, "the second read comes from the cache")

        await environment.beforeIdentityChange()
        environment.onIdentityChanged()
        XCTAssertEqual(environment.identityGeneration, 1)
        environment.onIdentityChanged()
        XCTAssertEqual(environment.identityGeneration, 2)

        _ = try await environment.fetchData(image)
        XCTAssertEqual(log.count(image), 2, "the other identity's images are not reused")
    }

    func testFailedImageReadsAreNotCached() async throws {
        let environment = try makeEnvironment()
        for _ in 0..<2 {
            do {
                _ = try await environment.fetchData("/api/attachments/missing/image")
                XCTFail("expected an error")
            } catch let error as ApiException {
                XCTAssertEqual(error.status, 503)
            }
        }
        XCTAssertEqual(log.count("/api/attachments/missing/image"), 2)
    }

    func testAppliedProposalRefreshesNotesOnceStarted() async throws {
        let environment = try makeEnvironment()
        environment.start()
        environment.start()
        defer { environment.stop() }

        let before = log.count("/api/pages")
        let task = try XCTUnwrap(environment.proposals.apply(TestProposal(id: "pr1", editedPageId: "p1")))
        await task.value
        XCTAssertEqual(environment.proposals.states["pr1"]?.status, .applied)
        // start() 调了两次也只听一次：只多一次刷新。
        await eventually { self.log.count("/api/pages") > before }
        await settleMainActor()
        XCTAssertEqual(log.count("/api/pages"), before + 1)
    }

    // MARK: - AppRouter

    func testOpeningANoteSearchResultFromChatOpensTheNote() async throws {
        let environment = try makeEnvironment()
        let router = AppRouter(app: environment)
        XCTAssertEqual(environment.notes.state.workspace, .chat)
        router.searchOpen = true

        router.openNote("n9", title: "Found", icon: "📘")
        XCTAssertFalse(router.searchOpen)
        // 不只是切到笔记列表：那篇笔记要打开（Android NoteFableRoot 的 onOpenNote）。
        await eventually { environment.notes.state.open?.id == "n9" }
        XCTAssertEqual(environment.notes.state.workspace, .notes)
        XCTAssertEqual(environment.notes.state.open?.title, "Found")
    }

    // MARK: - 系统分享

    func testShareUrlPutsTheSharedContentIntoANewChatAndClosesPanels() async throws {
        let environment = try makeEnvironment()
        let router = AppRouter(app: environment)
        router.searchOpen = true
        router.settingsOpen = true
        router.drawerOpen = true
        let photo = LocalFile(uri: "file:///photo", name: "photo.png", mimeType: "image/png", size: 10)
        var requested: [String?] = []
        environment.consumeSharePayloads = { id in
            requested.append(id)
            return [("from share", [photo])]
        }

        let handled = router.handleIncomingURL(try XCTUnwrap(URL(string: "notefable://share?id=abcdef12-3456")))
        XCTAssertTrue(handled)
        await eventually { environment.chat.draft == "from share" && environment.chat.state.files == [photo] }
        XCTAssertEqual(requested, ["abcdef12-3456"])
        XCTAssertFalse(router.searchOpen)
        XCTAssertFalse(router.settingsOpen)
        XCTAssertFalse(router.drawerOpen)
        XCTAssertEqual(environment.notes.state.workspace, .chat)
        XCTAssertNil(environment.chat.state.activeSessionId)
    }

    func testPendingSharesAreTakenOnceEvenWhenRequestedTwiceAtTheSameTime() async throws {
        let environment = try makeEnvironment()
        let router = AppRouter(app: environment)
        var calls = 0
        environment.consumeSharePayloads = { _ in
            calls += 1
            // 第一次取到两份按先后顺序排列的分享，之后没有（取走就删）。
            return calls == 1 ? [("first share", []), ("second share", [])] : []
        }

        router.consumePendingShares()
        router.consumePendingShares()
        await eventually { calls == 2 }
        await settleMainActor()
        XCTAssertEqual(environment.chat.draft, "first share\n\nsecond share")
    }

    func testShareUrlWithBadIdIsNotHandledAsAShare() async throws {
        let environment = try makeEnvironment()
        let router = AppRouter(app: environment)
        var called = false
        environment.consumeSharePayloads = { _ in
            called = true
            return []
        }
        XCTAssertFalse(router.handleIncomingURL(try XCTUnwrap(URL(string: "notefable://share?id=../x"))))
        await settleMainActor()
        XCTAssertFalse(called)
    }

    // MARK: - 打包的资源

    func testLoadsBundledAssets() async throws {
        let resources = directory.appendingPathComponent("assets", isDirectory: true)
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        for name in ["system-text.json", "usage-limits.json", "models.json", "emoji.json"] {
            try TextTestSupport.androidAsset(name).write(to: resources.appendingPathComponent(name))
        }
        let l10n = L10n()
        let environment = try makeEnvironment(resources: try XCTUnwrap(Bundle(path: resources.path)), l10n: l10n)

        XCTAssertEqual(environment.usageLimits?.member.chat, try UsageLimits.parse(TextTestSupport.androidAsset("usage-limits.json")).member.chat)

        // 系统文跟着界面语言换。
        let asset = try XCTUnwrap(JSONValue.parse(try TextTestSupport.androidAsset("system-text.json")))
        let japanese = try XCTUnwrap(asset["messages"]?["ja"]?.objectValue)
        let (english, translated) = try XCTUnwrap(
            japanese.compactMap { key, value in value.stringValue.map { (key, $0) } }
                .first { !$0.0.contains("{") && $0.0 != $0.1 }
        )
        XCTAssertEqual(environment.systemText.t(english), english)
        l10n.use(bundle: .main, locale: "ja")
        XCTAssertEqual(environment.systemText.t(english), translated)
        l10n.use(bundle: .main, locale: "en")
        XCTAssertEqual(environment.systemText.t(english), english)

        // 表情目录：界面层给的"画得出来吗"在这里生效。
        environment.emojiGlyphSupported = { $0 != "😀" }
        let catalog = try await environment.loadEmojiCatalog()
        XCTAssertFalse(catalog.emojis.isEmpty)
        XCTAssertNil(catalog.find("1f600"))
    }

    // MARK: - 小实现

    func testDataCacheDropsTheLeastRecentlyUsed() async {
        var cache = DataCache(maxEntries: 2, maxBytes: 10)
        cache.put("a", Data(count: 3))
        cache.put("b", Data(count: 3))
        XCTAssertNotNil(cache.get("a"))
        cache.put("c", Data(count: 3))
        XCTAssertNil(cache.get("b"))
        XCTAssertNotNil(cache.get("a"))
        XCTAssertNotNil(cache.get("c"))
        XCTAssertEqual(cache.totalBytes, 6)

        // 超过总字节数时也丢最久没用的；单个就超限的不存。
        cache.put("d", Data(count: 8))
        XCTAssertEqual(cache.count, 1)
        XCTAssertNotNil(cache.get("d"))
        cache.put("e", Data(count: 11))
        XCTAssertNil(cache.get("e"))
        XCTAssertEqual(cache.totalBytes, 8)

        cache.removeAll()
        XCTAssertEqual(cache.count, 0)
        XCTAssertEqual(cache.totalBytes, 0)
    }

    func testChatSavedStateKeepsDraftAndQuoteInUserDefaults() async {
        let saved = UserDefaultsChatSavedState(defaults: defaults)
        XCTAssertNil(saved.draft)
        saved.draft = "draft"
        saved.quote = "quote"
        let reopened = UserDefaultsChatSavedState(defaults: defaults)
        XCTAssertEqual(reopened.draft, "draft")
        XCTAssertEqual(reopened.quote, "quote")
        reopened.draft = ""
        reopened.quote = nil
        XCTAssertNil(saved.draft)
        XCTAssertNil(saved.quote)
    }
}
