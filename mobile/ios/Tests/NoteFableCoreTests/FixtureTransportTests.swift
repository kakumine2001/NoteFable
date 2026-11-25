#if DEBUG
import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

@MainActor
final class FixtureTransportTests: XCTestCase {
    private static let fixedNow = Date(timeIntervalSince1970: 1_795_575_600) // 2026-11-25T03:00:00.000Z
    private static let samplePNG = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

    private var directory: URL!
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("nf-fx-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        suiteName = "nf-fx-\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: directory)
    }

    func testAllFixtureRoutesDecodeWithZeroMisses() async throws {
        let misses = MissRecorder()
        let catalog = FixtureCatalog(account: .signedIn, now: Self.fixedNow, image: Self.samplePNG)
        let transport = FixtureTransport(catalog: catalog) { misses.add($0) }
        let api = makeApi(transport, baseUrl: FixtureMode.baseURL)
        let projectsApi = ProjectsApi(http: api.http)
        let searchApi = SearchApi(http: api.http)
        let accountApi = AccountApi(http: api.http)

        let models = try await api.models()
        XCTAssertFalse(models.models.isEmpty)

        let sessions = try await api.sessions()
        XCTAssertEqual(sessions.first?.id, FixtureCatalog.IDs.kyotoSession)

        let messages = try await api.messages(sessionId: FixtureCatalog.IDs.kyotoSession)
        XCTAssertEqual(messages.count, 6)
        XCTAssertEqual(messages[1].versions?.index, 2)
        XCTAssertFalse(Activity.parseStored(messages[1].activity).isEmpty)

        let account = try await api.account()
        XCTAssertTrue(account.configured)
        XCTAssertEqual(account.user?.icon, "🦊")
        XCTAssertEqual(account.user?.locale, nil) // nil 表示已知的 Auto，不是 LOCALE_UNKNOWN

        let projects = try await projectsApi.projects()
        XCTAssertEqual(projects.count, 2)
        let detail = try await projectsApi.projectDetail(id: FixtureCatalog.IDs.appProject)
        XCTAssertEqual(detail.notes.count, 2)

        let notes = try await api.notes()
        XCTAssertEqual(notes.pages.count, 5)
        XCTAssertEqual(notes.groups.count, 2)
        let recent = try await api.recentNotes()
        XCTAssertFalse(recent.isEmpty)
        let trash = try await api.trash()
        XCTAssertEqual(trash.count, 1)
        let share = try await api.getShare(id: FixtureCatalog.IDs.tripPage)
        XCTAssertTrue(share.enabled)

        let searchAll = try await searchApi.search(query: "kyoto", scope: .all, projectId: nil, kind: nil)
        XCTAssertEqual(searchAll.query, "kyoto")
        XCTAssertFalse(searchAll.notes.isEmpty)
        XCTAssertFalse(searchAll.chats.isEmpty)

        let searchChatsOnly = try await searchApi.search(query: "kyoto", scope: .chats, projectId: nil, kind: nil)
        XCTAssertTrue(searchChatsOnly.notes.isEmpty)
        XCTAssertFalse(searchChatsOnly.chats.isEmpty)

        let searchNotesOnly = try await searchApi.search(query: "kyoto", scope: .notes, projectId: nil, kind: nil)
        XCTAssertFalse(searchNotesOnly.notes.isEmpty)
        XCTAssertTrue(searchNotesOnly.chats.isEmpty)

        let plan = try await accountApi.plan()
        XCTAssertEqual(plan.plan, "free")
        XCTAssertNotNil(plan.storage)
        let instructions = try await accountApi.customInstructions()
        XCTAssertNotNil(instructions)
        let icon = try await accountApi.accountAppIcon()
        XCTAssertNotNil(icon.updatedAt)

        let fetched = try await api.fetchData("/api/attachments/\(FixtureCatalog.IDs.routeAttachment)/image")
        XCTAssertEqual(fetched.data, Self.samplePNG)
        XCTAssertEqual(fetched.mimeType, "image/png")

        // 日期都能解析、ID 符合链接与定位规则。
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        for s in sessions { XCTAssertNotNil(iso.date(from: s.updatedAt)) }
        for p in notes.pages { XCTAssertNotNil(iso.date(from: p.updatedAt)) }
        for t in trash {
            XCTAssertNotNil(iso.date(from: t.deletedAt))
            XCTAssertNotNil(iso.date(from: t.purgeAt))
        }
        let ids = [
            FixtureCatalog.IDs.kyotoSession,
            FixtureCatalog.IDs.glassSession,
            FixtureCatalog.IDs.ramenSession,
            FixtureCatalog.IDs.meetingSession,
            FixtureCatalog.IDs.liveSession,
            FixtureCatalog.IDs.tripPage,
            FixtureCatalog.IDs.packingPage,
            FixtureCatalog.IDs.glassPage,
            FixtureCatalog.IDs.roadmapPage,
            FixtureCatalog.IDs.boardPage,
            FixtureCatalog.IDs.meetingPage,
            FixtureCatalog.IDs.draftPage,
            FixtureCatalog.IDs.appProject,
            FixtureCatalog.IDs.studyProject,
            FixtureCatalog.IDs.travelGroup,
            FixtureCatalog.IDs.workGroup,
        ]
        for id in ids { XCTAssertTrue(ChatLink.isLinkId(id), "invalid link id: \(id)") }

        XCTAssertTrue(misses.items.isEmpty, "unexpected fixture misses: \(misses.items)")
    }

    func testGuestGets401FromAuthenticatedSettingsRoutes() async throws {
        let misses = MissRecorder()
        let catalog = FixtureCatalog(account: .guest, now: Self.fixedNow, image: Self.samplePNG)
        let transport = FixtureTransport(catalog: catalog) { misses.add($0) }
        let api = makeApi(transport, baseUrl: FixtureMode.baseURL)
        let accountApi = AccountApi(http: api.http)

        let account = try await api.account()
        XCTAssertNil(account.user)
        XCTAssertTrue(account.configured)

        let planErr = await errorThrown(try await accountApi.plan()) as? ApiException
        XCTAssertEqual(planErr?.status, 401)
        let instrErr = await errorThrown(try await accountApi.customInstructions()) as? ApiException
        XCTAssertEqual(instrErr?.status, 401)
        let iconErr = await errorThrown(try await accountApi.accountAppIcon()) as? ApiException
        XCTAssertEqual(iconErr?.status, 401)
        XCTAssertTrue(misses.items.isEmpty)
    }

    func testAppLanguageOverridePreservedInAccountResponse() async throws {
        let catalog = FixtureCatalog(account: .signedIn, now: Self.fixedNow, image: Self.samplePNG, appLanguage: "ar")
        let transport = FixtureTransport(catalog: catalog)
        let api = makeApi(transport, baseUrl: FixtureMode.baseURL)
        let account = try await api.account()
        XCTAssertEqual(account.user?.locale, "ar")
    }

    func testChatStreamYieldsEventsAndHoldsOpenUntilCancelled() async throws {
        let catalog = FixtureCatalog(account: .signedIn, now: Self.fixedNow, image: Self.samplePNG, streamHoldsOpen: true)
        let transport = FixtureTransport(catalog: catalog)
        let api = makeApi(transport, baseUrl: FixtureMode.baseURL)

        var sawStarted = false
        var sawActivity = false
        var text = ""
        var streamFinished = false
        let streamTask = Task {
            for try await event in api.streamChat(ChatRequest(message: "Hi", sessionId: nil, model: "gpt-6-luna", reasoning: "medium")) {
                switch event {
                case .started(let sid):
                    XCTAssertEqual(sid, FixtureCatalog.IDs.liveSession)
                    sawStarted = true
                case .activity:
                    sawActivity = true
                case .delta(let chunk):
                    text += chunk
                }
            }
            streamFinished = true
        }

        // 等流吐完所有分块，验证它真的保持打开不自动结束。
        for _ in 0..<100 {
            if sawStarted && sawActivity && text.contains("Liquid Glass") { break }
            try await Task.sleep(for: .milliseconds(25))
        }
        XCTAssertTrue(sawStarted)
        XCTAssertTrue(sawActivity)
        XCTAssertTrue(text.contains("Liquid Glass"))

        try await Task.sleep(for: .milliseconds(120))
        // 任务仍在等待，说明流还开着。
        XCTAssertFalse(streamFinished)
        streamTask.cancel()
        _ = await streamTask.result
    }

    func testUnknownHostTriggersOnMissAndReturns404() async throws {
        let misses = MissRecorder()
        let catalog = FixtureCatalog(account: .signedIn, now: Self.fixedNow, image: Self.samplePNG)
        let transport = FixtureTransport(catalog: catalog) { misses.add($0) }
        let request = HTTPRequest(url: URL(string: "https://app.notefable.com/api/sessions")!)
        let (_, response) = try await transport.send(request)
        XCTAssertEqual(response.statusCode, 404)
        XCTAssertEqual(misses.items, ["GET /api/sessions"])
    }

    func testAppEnvironmentStartsAndLoadsWithFixtureTransport() async throws {
        let misses = MissRecorder()
        let catalog = FixtureCatalog(account: .signedIn, now: Self.fixedNow, image: Self.samplePNG)
        let transport = FixtureTransport(catalog: catalog) { misses.add($0) }
        let resourcesDir = directory.appendingPathComponent("res", isDirectory: true)
        try FileManager.default.createDirectory(at: resourcesDir, withIntermediateDirectories: true)
        let bundle = try XCTUnwrap(Bundle(path: resourcesDir.path))
        let config = AppConfig(baseURL: FixtureMode.baseURL, siteURL: FixtureMode.siteURL, googleIOSClientId: "fixture")

        let env = AppEnvironment(
            config: config,
            resources: bundle,
            defaults: defaults,
            dataDirectory: directory.appendingPathComponent("data", isDirectory: true),
            transport: transport,
            systemLanguages: { ["en"] },
            l10n: L10n()
        )
        env.start()
        defer { env.stop() }

        for _ in 0..<200 {
            if env.account.state.loaded && !env.chat.state.sessionsLoading && !env.chat.state.models.isEmpty && !env.sidebar.state.projects.isEmpty {
                break
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        await env.sidebar.idle()
        await env.account.idle()

        XCTAssertTrue(env.account.state.loaded)
        XCTAssertEqual(env.account.state.user?.email, "fixture@example.com")
        XCTAssertFalse(env.chat.state.sessions.isEmpty)
        XCTAssertFalse(env.chat.state.models.isEmpty)
        XCTAssertFalse(env.sidebar.state.projects.isEmpty)
        XCTAssertTrue(misses.items.isEmpty, "unexpected misses during startup: \(misses.items)")
    }
}

private final class MissRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []
    var items: [String] { lock.withLock { recorded } }
    func add(_ item: String) { lock.withLock { recorded.append(item) } }
}
#endif
