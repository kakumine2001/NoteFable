#if DEBUG
import Foundation
import UIKit

/// Debug 截图启动器：解析 `-NFFixtures` 等启动参数，构造完全离线的 [AppEnvironment]，
/// 驱动导航到达目标场景并在画面稳定后向 stderr 输出一行 `NF_FIXTURE_READY`。
@MainActor
final class FixtureLaunch {
    private static let suiteName = "com.kakumine.notefable.fixtures"
    private(set) static var current: FixtureLaunch?

    let scenes: [ScreenshotScene]
    let ackDirectory: URL?
    let account: FixtureCatalog.Account
    let appLanguage: String?
    let searchQuery: String
    let forceSolidChrome: Bool

    var scene: ScreenshotScene { scenes[0] }

    private init(
        scenes: [ScreenshotScene],
        ackDirectory: URL?,
        account: FixtureCatalog.Account,
        appLanguage: String?,
        searchQuery: String,
        forceSolidChrome: Bool
    ) {
        self.scenes = scenes
        self.ackDirectory = ackDirectory
        self.account = account
        self.appLanguage = appLanguage
        self.searchQuery = searchQuery
        self.forceSolidChrome = forceSolidChrome
    }

    static func fromProcess() -> FixtureLaunch? {
        let args = UserDefaults.standard
        guard args.bool(forKey: "NFFixtures") else { return nil }
        let rawBatch = args.string(forKey: "NFFixtureBatch")?
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .compactMap(ScreenshotScene.init(rawValue:)) ?? []
        let singleScene = args.string(forKey: "NFFixtureScene").flatMap(ScreenshotScene.init(rawValue:)) ?? .chatEmpty
        let scenes = rawBatch.isEmpty ? [singleScene] : rawBatch
        let rawAckDir = args.string(forKey: "NFFixtureAckDir")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let ackDirectory = (rawAckDir?.isEmpty == false) ? URL(fileURLWithPath: rawAckDir!, isDirectory: true) : nil
        let defaultAccount: FixtureCatalog.Account = (scenes == [.signIn]) ? .guest : .signedIn
        let account = args.string(forKey: "NFFixtureAccount").flatMap(FixtureCatalog.Account.init(rawValue:)) ?? defaultAccount
        let rawLang = args.string(forKey: "NFFixtureAppLanguage")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let appLanguage = (rawLang?.isEmpty == false) ? rawLang : nil
        let rawQuery = args.string(forKey: "NFFixtureSearch")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let searchQuery = (rawQuery?.isEmpty == false) ? rawQuery! : "kyoto"
        let forceSolid = args.bool(forKey: "NFForceSolidChrome")

        let launch = FixtureLaunch(
            scenes: scenes,
            ackDirectory: ackDirectory,
            account: account,
            appLanguage: appLanguage,
            searchQuery: searchQuery,
            forceSolidChrome: forceSolid
        )
        current = launch
        return launch
    }

    func makeEnvironment() -> AppEnvironment {
        ScreenshotHooks.configure(scene: scenes[0], searchQuery: searchQuery, forceSolidChrome: forceSolidChrome)

        let defaults = UserDefaults(suiteName: Self.suiteName) ?? .standard
        defaults.removePersistentDomain(forName: Self.suiteName)
        if let appLanguage {
            // 必须在构造 AppEnvironment（及其 LanguageController）之前写入，保持首帧即目标语言。
            defaults.set(appLanguage, forKey: "notefable.language")
        }

        let dataDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("NoteFableFixtures", isDirectory: true)
        try? FileManager.default.removeItem(at: dataDirectory)
        try? FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true)

        let modelsData = AppEnvironment.resourceData("models", "json", in: .main)
        let kindsData = AppEnvironment.resourceData("page-kinds", "json", in: .main)
        let catalog = FixtureCatalog(
            account: account,
            now: Date(),
            models: modelsData,
            kinds: kindsData,
            image: Self.renderSampleImage(),
            streamHoldsOpen: scenes.contains(.chatStreaming),
            appLanguage: appLanguage
        )
        let transport = FixtureTransport(catalog: catalog) { miss in
            Self.writeStderr("NF_FIXTURE_MISS \(miss)\n")
        }

        let bundleConfig = AppConfig()
        let config = AppConfig(
            baseURL: FixtureMode.baseURL,
            siteURL: FixtureMode.siteURL,
            googleIOSClientId: "fixture-ios-client",
            appVersion: bundleConfig.appVersion,
            buildNumber: bundleConfig.buildNumber
        )
        return AppEnvironment(
            config: config,
            resources: .main,
            defaults: defaults,
            dataDirectory: dataDirectory,
            transport: transport
        )
    }

    func apply(app: AppEnvironment, router: AppRouter) async {
        let baseDeadline = Date().addingTimeInterval(30)
        let baseReady = await poll(until: baseDeadline) {
            app.account.state.loaded && !app.chat.state.sessionsLoading && !app.chat.state.models.isEmpty
        }

        for (idx, target) in scenes.enumerated() {
            if idx > 0 {
                await resetBefore(target: target, previous: scenes[idx - 1], app: app, router: router)
                ScreenshotHooks.setScene(target)
            }

            let sceneDeadline = Date().addingTimeInterval((target == .editor || target == .pageMenu) ? 45 : 30)
            var sceneReady = baseReady
            if baseReady {
                sceneReady = await prepareScene(target, app: app, router: router, deadline: sceneDeadline)
            }

            // 等动画、图片解码与 WKWebView 首帧绘制落下。
            let settleMs = (target == .editor) ? 700 : 500
            try? await Task.sleep(for: .milliseconds(settleMs))
            let idxPart = (ackDirectory != nil) ? " idx=\(idx)" : ""
            let line = "NF_FIXTURE_READY\(idxPart) scene=\(target.rawValue) reduceTransparency=\(UIAccessibility.isReduceTransparencyEnabled) forcedSolid=\(forceSolidChrome) rtl=\(app.language.isRightToLeft) locale=\(app.language.uiLocale) timeout=\(!sceneReady)\n"
            Self.writeStderr(line)

            if let ackDir = ackDirectory {
                let keepGoing = await waitForAck(idx: idx, in: ackDir)
                if !keepGoing { return }
            }
        }
    }

    private func resetBefore(
        target: ScreenshotScene,
        previous: ScreenshotScene,
        app: AppEnvironment,
        router: AppRouter
    ) async {
        if previous == .modelSheet || previous == .attachSheet || previous == .pageMenu {
            ScreenshotHooks.dismissOverlays()
            try? await Task.sleep(for: .milliseconds(350))
        }
        if router.drawerOpen {
            router.closeDrawer()
            try? await Task.sleep(for: .milliseconds(350))
        }
        if router.searchOpen {
            router.searchOpen = false
            try? await Task.sleep(for: .milliseconds(350))
        }
        if router.settingsOpen {
            router.settingsOpen = false
            try? await Task.sleep(for: .milliseconds(350))
        }
        if router.signInOpen {
            router.signInOpen = false
            try? await Task.sleep(for: .milliseconds(350))
        }
        let targetUsesNotes = (target == .workspace || target == .editor || target == .pageMenu)
        if app.notes.state.workspace == .notes && !targetUsesNotes {
            app.notes.setWorkspace(.chat)
            let leaveDeadline = Date().addingTimeInterval(5)
            _ = await poll(until: leaveDeadline) {
                app.notes.state.workspace == .chat && app.notes.state.open == nil
            }
        }
    }

    private func prepareScene(
        _ target: ScreenshotScene,
        app: AppEnvironment,
        router: AppRouter,
        deadline: Date
    ) async -> Bool {
        switch target {
        case .chatEmpty:
            if app.chat.state.activeSessionId != nil {
                app.chat.newChat()
            }
            return app.chat.state.activeSessionId == nil && app.chat.state.messages.isEmpty

        case .chat:
            app.chat.openSession(FixtureCatalog.IDs.kyotoSession)
            return await poll(until: deadline) {
                app.chat.state.activeSessionId == FixtureCatalog.IDs.kyotoSession
                    && !app.chat.state.messagesLoading
                    && !app.chat.state.messages.isEmpty
            }

        case .chatStreaming:
            app.chat.newChat()
            app.chat.send("Compare Liquid Glass and earlier blur materials on iOS.")
            return await poll(until: deadline) {
                app.chat.state.sending && app.chat.state.messages.contains {
                    $0.role == .assistant && !$0.content.isEmpty
                }
            }

        case .drawer:
            if app.chat.state.activeSessionId != FixtureCatalog.IDs.kyotoSession || app.chat.state.messages.isEmpty {
                app.chat.openSession(FixtureCatalog.IDs.kyotoSession)
            }
            let chatLoaded = await poll(until: deadline) {
                app.chat.state.activeSessionId == FixtureCatalog.IDs.kyotoSession
                    && !app.chat.state.messagesLoading
                    && !app.chat.state.messages.isEmpty
            }
            router.openDrawer()
            return chatLoaded && router.drawerOpen

        case .workspace:
            if app.notes.state.workspace != .notes {
                app.notes.setWorkspace(.notes)
            } else if app.notes.state.open != nil {
                app.notes.closeNote()
            }
            return await poll(until: deadline) {
                app.notes.state.workspace == .notes
                    && app.notes.state.open == nil
                    && app.notes.state.loaded
                    && !app.notes.state.pages.isEmpty
            }

        case .editor:
            if !app.notes.state.loaded || app.notes.state.pages.isEmpty {
                app.notes.refresh()
            }
            let listLoaded = await poll(until: deadline) {
                app.notes.state.loaded && !app.notes.state.pages.isEmpty
            }
            router.openNote(FixtureCatalog.IDs.tripPage, title: "Kyoto trip plan", icon: "🗺️", kind: .note)
            let editorLoaded = await poll(until: deadline) {
                app.notes.state.open?.id == FixtureCatalog.IDs.tripPage
                    && app.notes.state.saveState == "saved"
            }
            return listLoaded && editorLoaded

        case .pageMenu:
            if app.notes.state.open?.id == FixtureCatalog.IDs.tripPage && app.notes.state.saveState == "saved" {
                return await poll(until: deadline) {
                    app.notes.state.open?.id == FixtureCatalog.IDs.tripPage
                        && app.notes.state.saveState == "saved"
                        && ScreenshotHooks.isReady(.pageMenu)
                }
            }
            if !app.notes.state.loaded || app.notes.state.pages.isEmpty {
                app.notes.refresh()
            }
            let listLoaded = await poll(until: deadline) {
                app.notes.state.loaded && !app.notes.state.pages.isEmpty
            }
            router.openNote(FixtureCatalog.IDs.tripPage, title: "Kyoto trip plan", icon: "🗺️", kind: .note)
            let menuReady = await poll(until: deadline) {
                app.notes.state.open?.id == FixtureCatalog.IDs.tripPage
                    && app.notes.state.saveState == "saved"
                    && ScreenshotHooks.isReady(.pageMenu)
            }
            return listLoaded && menuReady

        case .search:
            router.openSearch()
            return await poll(until: deadline) {
                router.searchOpen && ScreenshotHooks.isReady(.search)
            }

        case .modelSheet:
            if app.chat.state.activeSessionId != FixtureCatalog.IDs.kyotoSession || app.chat.state.messages.isEmpty {
                app.chat.openSession(FixtureCatalog.IDs.kyotoSession)
            }
            return await poll(until: deadline) {
                app.chat.state.activeSessionId == FixtureCatalog.IDs.kyotoSession
                    && !app.chat.state.messages.isEmpty
                    && ScreenshotHooks.isReady(.modelSheet)
            }

        case .attachSheet:
            if app.chat.state.activeSessionId != FixtureCatalog.IDs.kyotoSession || app.chat.state.messages.isEmpty {
                app.chat.openSession(FixtureCatalog.IDs.kyotoSession)
            }
            return await poll(until: deadline) {
                app.chat.state.activeSessionId == FixtureCatalog.IDs.kyotoSession
                    && !app.chat.state.messages.isEmpty
                    && ScreenshotHooks.isReady(.attachSheet)
            }

        case .settings:
            router.openSettings()
            return await poll(until: deadline) {
                router.settingsOpen && app.account.state.user != nil
            }

        case .signIn:
            router.openSignIn()
            return await poll(until: deadline) {
                router.signInOpen && app.account.state.configured && app.account.state.user == nil
            }
        }
    }

    private func waitForAck(idx: Int, in ackDir: URL) async -> Bool {
        let ackFile = ackDir.appendingPathComponent("ack-\(idx)")
        let abortFile = ackDir.appendingPathComponent("abort")
        let deadline = Date().addingTimeInterval(180)
        while Date() < deadline {
            if FileManager.default.fileExists(atPath: abortFile.path) { return false }
            if FileManager.default.fileExists(atPath: ackFile.path) { return true }
            try? await Task.sleep(for: .milliseconds(25))
        }
        return false
    }

    private func poll(until deadline: Date, condition: () -> Bool) async -> Bool {
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return condition()
    }

    nonisolated static func writeStderr(_ text: String) {
        try? FileHandle.standardError.write(contentsOf: Data(text.utf8))
    }

    private static func renderSampleImage() -> Data {
        let size = CGSize(width: 320, height: 200)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.pngData { context in
            let cg = context.cgContext
            let space = CGColorSpaceCreateDeviceRGB()
            let colors = [
                UIColor(red: 0.96, green: 0.48, blue: 0.36, alpha: 1).cgColor,
                UIColor(red: 0.27, green: 0.42, blue: 0.72, alpha: 1).cgColor,
            ] as CFArray
            if let gradient = CGGradient(colorsSpace: space, colors: colors, locations: [0, 1]) {
                cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            }
            UIColor(white: 1, alpha: 0.22).setFill()
            UIBezierPath(ovalIn: CGRect(x: 206, y: 26, width: 64, height: 64)).fill()
            UIColor(red: 0.11, green: 0.15, blue: 0.24, alpha: 0.75).setFill()
            let hills = UIBezierPath()
            hills.move(to: CGPoint(x: 0, y: 200))
            hills.addLine(to: CGPoint(x: 0, y: 145))
            hills.addQuadCurve(to: CGPoint(x: 165, y: 132), controlPoint: CGPoint(x: 82, y: 108))
            hills.addQuadCurve(to: CGPoint(x: 320, y: 148), controlPoint: CGPoint(x: 245, y: 155))
            hills.addLine(to: CGPoint(x: 320, y: 200))
            hills.close()
            hills.fill()
        }
    }
}
#endif
