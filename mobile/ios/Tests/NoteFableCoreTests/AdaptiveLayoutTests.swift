import Foundation
import XCTest
@testable import NoteFableCore

@MainActor
final class AdaptiveLayoutTests: XCTestCase {
    private var directory: URL!
    private var suiteName: String!
    private var defaults: UserDefaults!
    private var transport: FakeTransport!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("nf-adaptive-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        suiteName = "nf-adaptive-\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        transport = FakeTransport()
        transport.respond { request in
            switch (request.method, request.path) {
            case ("PATCH", "/api/sessions/s1"):
                return FakeTransport.Reply(#"{"id":"s1","title":"Renamed"}"#)
            case ("DELETE", "/api/sessions/s1"):
                return FakeTransport.Reply(#"{"ok":true}"#)
            default:
                return FakeTransport.Reply("{}", status: 200)
            }
        }
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: directory)
    }

    private func makeEnvironment() throws -> AppEnvironment {
        let root = directory.appendingPathComponent("resources", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let bundle = try XCTUnwrap(Bundle(path: root.path))
        return AppEnvironment(
            config: AppConfig(info: ["NoteFableBaseURL": testBaseUrl]),
            resources: bundle,
            defaults: defaults,
            dataDirectory: directory.appendingPathComponent("data", isDirectory: true),
            transport: transport,
            systemLanguages: { ["en"] },
            l10n: L10n()
        )
    }

    // MARK: - AdaptiveLayout

    func testDockedSidebarThresholdMatchesCompactAndWideWindows() async {
        // 标准手机竖屏（412×915）、折叠态 iPhone Duo 竖屏（~402×874）与窄分屏（585×820）保持单栏推入抽屉。
        for (width, height) in [(0.0, 915.0), (320.0, 820.0), (412.0, 915.0), (585.0, 820.0), (639.5, 951.0)] {
            XCTAssertFalse(AdaptiveLayout.supportsDockedSidebar(windowWidth: width, windowHeight: height, presenting: false))
        }
        // 横屏手机（852×393、956×440）与折叠态横屏 iPhone Duo（678×466）高度不足，不强行拆成常驻双栏。
        for (width, height) in [(852.0, 393.0), (956.0, 440.0), (678.0, 466.0), (820.0, 559.5)] {
            XCTAssertFalse(AdaptiveLayout.supportsDockedSidebar(windowWidth: width, windowHeight: height, presenting: false))
        }
        // 展开态 iPhone Duo 竖屏（669×951）与横屏（951×669）、iPad mini（744×1133）、iPad 11 寸（820×1180 / 1180×820）、
        // iPad 13 寸半屏（683×1024）与全屏启用常驻侧栏。
        for (width, height) in [(640.0, 560.0), (669.0, 951.0), (951.0, 669.0), (683.0, 1024.0), (744.0, 1133.0), (820.0, 1180.0), (1180.0, 820.0), (1366.0, 1024.0)] {
            XCTAssertTrue(AdaptiveLayout.supportsDockedSidebar(windowWidth: width, windowHeight: height, presenting: false))
        }
        // 幻灯片放映中无论窗口多宽多高都收起常驻侧栏。
        XCTAssertFalse(AdaptiveLayout.supportsDockedSidebar(windowWidth: 1180.0, windowHeight: 820.0, presenting: true))
        XCTAssertFalse(AdaptiveLayout.supportsDockedSidebar(windowWidth: .nan, windowHeight: 900.0, presenting: false))
        XCTAssertFalse(AdaptiveLayout.supportsDockedSidebar(windowWidth: 900.0, windowHeight: .infinity, presenting: false))
    }

    func testDetailWidthSubtractsSidebarOnlyWhenDockedAndVisible() async {
        // 标准宽屏（>= 720）用 280pt 侧栏；较紧双栏窗口（640..<720，如竖屏展开的 iPhone Duo 669pt）收窄为 260pt。
        XCTAssertEqual(AdaptiveLayout.sidebarWidth(forWindowWidth: 669), 260)
        XCTAssertEqual(AdaptiveLayout.sidebarWidth(forWindowWidth: 720), 280)
        XCTAssertEqual(AdaptiveLayout.detailWidth(windowWidth: 669, docked: true, dockedVisible: true), 409)
        XCTAssertEqual(AdaptiveLayout.detailWidth(windowWidth: 820, docked: true, dockedVisible: true), 540)
        XCTAssertEqual(AdaptiveLayout.detailWidth(windowWidth: 820, docked: true, dockedVisible: false), 820)
        XCTAssertEqual(AdaptiveLayout.detailWidth(windowWidth: 412, docked: false, dockedVisible: true), 412)
        XCTAssertEqual(AdaptiveLayout.detailWidth(windowWidth: 200, docked: true, dockedVisible: true), 0)
        XCTAssertEqual(AdaptiveLayout.detailWidth(windowWidth: .nan, docked: true, dockedVisible: true), 0)
    }

    // MARK: - AppRouter 常驻侧栏状态

    func testDockedSidebarStaysOpenAcrossNavigationAndSupportsManualCollapse() async throws {
        let env = try makeEnvironment()
        let router = AppRouter(app: env)

        XCTAssertFalse(router.sidebarDocked)
        XCTAssertFalse(router.isSidebarDockedVisible)
        XCTAssertFalse(router.isSidebarVisible)

        // 切入宽窗口：侧栏默认常驻展开。
        router.setSidebarDocked(true)
        XCTAssertTrue(router.sidebarDocked)
        XCTAssertTrue(router.dockedSidebarVisible)
        XCTAssertTrue(router.isSidebarDockedVisible)
        XCTAssertTrue(router.isSidebarVisible)
        XCTAssertFalse(router.drawerOpen)

        // 在常驻侧栏中切换标签、打开搜索、新建聊天、打开页面或调用 dismissDrawer 都不收起常驻侧栏。
        router.selectTab(.workspace)
        XCTAssertTrue(router.isSidebarDockedVisible)
        router.openSearch()
        XCTAssertTrue(router.isSidebarDockedVisible)
        router.openNewChat()
        XCTAssertTrue(router.isSidebarDockedVisible)
        router.openNote("p1", title: "Note", icon: nil)
        XCTAssertTrue(router.isSidebarDockedVisible)
        router.dismissDrawer()
        XCTAssertTrue(router.isSidebarDockedVisible)

        // 只有显式点击收起按钮才收起常驻侧栏，点击菜单按钮再展开。
        router.closeSidebar()
        XCTAssertFalse(router.dockedSidebarVisible)
        XCTAssertFalse(router.isSidebarDockedVisible)
        XCTAssertFalse(router.isSidebarVisible)

        router.openSidebar()
        XCTAssertTrue(router.dockedSidebarVisible)
        XCTAssertTrue(router.isSidebarDockedVisible)
        XCTAssertTrue(router.isSidebarVisible)
    }

    func testLayoutTransitionsPreserveSelectionAndAvoidTrappingInCompactDrawer() async throws {
        let env = try makeEnvironment()
        let router = AppRouter(app: env)

        // 宽屏手动收起后切回窄屏再切回宽屏，保留收起偏好，且缩窄时不弹出覆盖抽屉。
        router.setSidebarDocked(true)
        router.selectTab(.search)
        router.closeSidebar()
        XCTAssertFalse(router.dockedSidebarVisible)

        router.setSidebarDocked(false)
        XCTAssertFalse(router.sidebarDocked)
        XCTAssertFalse(router.drawerOpen)
        XCTAssertEqual(router.selectedTab, .search)

        router.setSidebarDocked(true)
        XCTAssertTrue(router.sidebarDocked)
        XCTAssertFalse(router.dockedSidebarVisible)
        XCTAssertEqual(router.selectedTab, .search)

        // 若用户在窄屏里主动打开了抽屉后展开成宽屏，抽屉无缝转为常驻展开并清掉 drawerOpen。
        router.setSidebarDocked(false)
        router.openSidebar()
        XCTAssertTrue(router.drawerOpen)

        router.setSidebarDocked(true)
        XCTAssertTrue(router.sidebarDocked)
        XCTAssertTrue(router.dockedSidebarVisible)
        XCTAssertFalse(router.drawerOpen)

        // 再次缩回窄屏（分屏 / 折叠）时停留在当前详情页，不强行打开覆盖抽屉。
        router.setSidebarDocked(false)
        XCTAssertFalse(router.drawerOpen)
        XCTAssertEqual(router.selectedTab, .search)
    }

    func testSidebarRenameAndDeleteRefreshOpenNoteBacklinksWithoutClosingDrawer() async throws {
        let env = try makeEnvironment()
        let editor = RecordingBacklinkEditor()
        let bridge = NoteEmbedBridge(onMessage: { _ in })
        bridge.attach(editor)
        env.registerEditor(bridge)

        let renameErr = await env.sidebar.rename("s1", "Renamed")
        XCTAssertNil(renameErr)
        XCTAssertEqual(editor.backlinkRefreshCount, 1)

        let deleteErr = await env.sidebar.delete("s1")
        XCTAssertNil(deleteErr)
        XCTAssertEqual(editor.backlinkRefreshCount, 2)
    }
}

@MainActor
private final class RecordingBacklinkEditor: NoteEditorBridge {
    var backlinkRefreshCount = 0

    func flush(requestId: String) async -> Bool { true }
    func openHistory() {}
    func pageUpdated(_ pageJson: String) {}
    func pageSettings(_ pageJson: String) {}
    func appIcon(_ value: String?) {}
    func language(_ code: String) {}
    func theme(_ value: String) {}
    func reveal(_ id: String) {}
    func slides(_ command: String) {}
    func refreshBacklinks() { backlinkRefreshCount += 1 }
}
