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
            FixtureCatalog.IDs.longSession,
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

    func testEditorPagesMatchWorkspacePayload() async throws {
        let catalog = FixtureCatalog(now: Self.fixedNow, image: Self.samplePNG)
        let api = makeApi(FixtureTransport(catalog: catalog), baseUrl: FixtureMode.baseURL)
        let notes = try await api.notes()

        XCTAssertEqual(Set(FixtureCatalog.editorPages.keys), Set(notes.pages.map(\.id)))
        for page in notes.pages {
            let editorPage = try XCTUnwrap(FixtureCatalog.editorPages[page.id])
            XCTAssertEqual(editorPage.title, page.title, page.id)
            XCTAssertEqual(editorPage.icon, page.icon, page.id)
            XCTAssertEqual(editorPage.kind, page.kind, page.id)
        }

        let locked = try XCTUnwrap(notes.pages.first { $0.id == FixtureCatalog.IDs.glassPage })
        XCTAssertTrue(locked.locked)
        XCTAssertTrue(locked.shareEnabled)
        let share = try await api.getShare(id: locked.id)
        XCTAssertTrue(share.enabled)
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
            let request = ChatRequest(message: FixtureCatalog.Prompts.streaming, sessionId: nil, model: "gpt-6-luna", reasoning: "medium")
            for try await event in api.streamChat(request) {
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

    func testStreamedPromptCompletesWhileHoldOpenEnabled() async throws {
        let catalog = FixtureCatalog(now: Self.fixedNow, image: Self.samplePNG, streamHoldsOpen: true)
        let api = makeApi(FixtureTransport(catalog: catalog), baseUrl: FixtureMode.baseURL)
        let request = ChatRequest(message: FixtureCatalog.Prompts.streamed, sessionId: nil, model: "gpt-6-luna", reasoning: "medium")
        var streamedText = ""
        var finished = false
        let streamTask = Task {
            for try await event in api.streamChat(request) {
                if case .delta(let chunk) = event { streamedText += chunk }
            }
            finished = true
        }
        defer { streamTask.cancel() }

        for _ in 0..<200 {
            if finished { break }
            try await Task.sleep(for: .milliseconds(25))
        }
        guard finished else {
            XCTFail("The completed-stream prompt did not finish.")
            return
        }
        try await streamTask.value

        XCTAssertTrue(streamedText.contains("Liquid Glass"))
        let history = try await api.messages(sessionId: FixtureCatalog.IDs.liveSession)
        XCTAssertEqual(history.first?.content, FixtureCatalog.Prompts.streamed)
        XCTAssertEqual(history.last?.content, streamedText)
    }

    /// iOS 27 空白聊天的对照场景（App/FixtureChatControl）依赖的行为：读过的聊天直接换进来、拿到会话 ID 不算换对话、
    /// 重新生成长回答时条数不变并保持生成中、`onIdentityChanged` 回到空白首页。
    func testChatControlSceneAssumptions() async throws {
        let misses = MissRecorder()
        let catalog = FixtureCatalog(account: .signedIn, now: Self.fixedNow, image: Self.samplePNG)
        let transport = FixtureTransport(catalog: catalog) { misses.add($0) }
        let resourcesDir = directory.appendingPathComponent("res", isDirectory: true)
        try FileManager.default.createDirectory(at: resourcesDir, withIntermediateDirectories: true)
        let env = AppEnvironment(
            config: AppConfig(baseURL: FixtureMode.baseURL, siteURL: FixtureMode.siteURL, googleIOSClientId: "fixture"),
            resources: try XCTUnwrap(Bundle(path: resourcesDir.path)),
            defaults: defaults,
            dataDirectory: directory.appendingPathComponent("data", isDirectory: true),
            transport: transport,
            systemLanguages: { ["en"] },
            l10n: L10n()
        )
        env.start()
        defer { env.stop() }
        let chat = env.chat
        try await waitUntil { !chat.state.sessionsLoading }

        chat.openSession(FixtureCatalog.IDs.glassSession)
        try await waitUntil { !chat.state.messagesLoading && !chat.state.messages.isEmpty }
        chat.openSession(FixtureCatalog.IDs.kyotoSession)
        try await waitUntil { !chat.state.messagesLoading && chat.state.messages.count == 6 }
        let kyoto = chat.state.debugConversationId
        chat.openSession(FixtureCatalog.IDs.kyotoSession)
        XCTAssertEqual(chat.state.debugConversationId, kyoto)
        chat.openSession(FixtureCatalog.IDs.glassSession)
        XCTAssertFalse(chat.state.messagesLoading)
        XCTAssertEqual(chat.state.messages.count, 2)
        XCTAssertNotEqual(chat.state.debugConversationId, kyoto)

        chat.newChat()
        let fresh = chat.state.debugConversationId
        chat.send(FixtureCatalog.Prompts.streamed)
        try await waitUntil { chat.state.activeSessionId == FixtureCatalog.IDs.liveSession && !chat.state.sending }
        XCTAssertEqual(chat.state.debugConversationId, fresh)
        // 追加、新聊天拿到会话 ID、回答结束后的对账（换 ID 沿用 key）都不算换行。
        try await waitUntil { chat.state.messages.last.map { !$0.id.hasPrefix("local-") } == true }
        XCTAssertEqual(chat.state.debugBranchId, 0)

        chat.openSession(FixtureCatalog.IDs.longSession)
        try await waitUntil { !chat.state.messagesLoading && chat.state.messages.count == 4 }
        // 换对话不算换行。
        XCTAssertEqual(chat.state.debugBranchId, 0)
        let answer = try XCTUnwrap(chat.state.messages.last)
        XCTAssertGreaterThan(answer.content.split(separator: "\n").count, 40)
        chat.regenerate(answer.id)
        try await waitUntil { chat.state.messages.last.map { $0.id != answer.id && $0.content.contains("Liquid Glass") } == true }
        XCTAssertEqual(chat.state.messages.count, 4)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertTrue(chat.state.sending)
        // 重新生成换掉了最后一行：只记一次（之后的流式文字不算），指着换上来的行。
        XCTAssertEqual(chat.state.debugBranchId, 1)
        XCTAssertEqual(chat.state.debugBranchRowKey, chat.state.messages.last?.key)

        chat.onIdentityChanged()
        XCTAssertNil(chat.state.activeSessionId)
        XCTAssertTrue(chat.state.messages.isEmpty)
        XCTAssertFalse(chat.state.sending)
        chat.openSession(FixtureCatalog.IDs.longSession)
        try await waitUntil { !chat.state.messagesLoading && chat.state.messages.count == 4 }
        XCTAssertEqual(chat.state.messages.last?.id, answer.id)
        XCTAssertTrue(misses.items.isEmpty, "unexpected fixture misses: \(misses.items)")
    }

    private func waitUntil(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<400 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("condition was not met in time", file: file, line: line)
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
