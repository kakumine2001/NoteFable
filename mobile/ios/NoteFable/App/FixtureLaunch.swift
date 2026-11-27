#if DEBUG
import Foundation
import UIKit

/// Debug 截图启动器：解析 `-NFFixtures` 等启动参数，构造完全离线的 [AppEnvironment]，
/// 驱动导航到达目标场景并在画面稳定后向 stderr 输出一行 `NF_FIXTURE_READY`。
@MainActor
final class FixtureLaunch {
    private static let suiteName = "com.kakumine.notefable.fixtures"
    private static let editorScenes: Set<ScreenshotScene> = [
        .editor, .pageMenu, .editorScrolled, .editorLocked, .editorWhiteboard, .editorSlides,
    ]
    private(set) static var current: FixtureLaunch?

    let scenes: [ScreenshotScene]
    let ackDirectory: URL?
    let account: FixtureCatalog.Account
    let appLanguage: String?
    let searchQuery: String
    let forceSolidChrome: Bool
    private var sampleImageURL: URL?
    private var sampleImageSize = 0

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

        let sampleImage = Self.renderSampleImage()
        let imageURL = dataDirectory.appendingPathComponent("route-sketch.png")
        do {
            try sampleImage.write(to: imageURL, options: .atomic)
            sampleImageURL = imageURL
            sampleImageSize = sampleImage.count
        } catch {
            Self.writeStderr("NF_FIXTURE_IMAGE_WRITE_FAILED \(error.localizedDescription)\n")
        }

        let modelsData = AppEnvironment.resourceData("models", "json", in: .main)
        let kindsData = AppEnvironment.resourceData("page-kinds", "json", in: .main)
        let catalog = FixtureCatalog(
            account: account,
            now: Date(),
            models: modelsData,
            kinds: kindsData,
            image: sampleImage,
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
            app.account.state.loaded
                && !app.chat.state.sessionsLoading
                && !app.chat.state.models.isEmpty
                && (!router.isSidebarVisible || app.notes.state.loaded)
        }

        for (idx, target) in scenes.enumerated() {
            if idx > 0 {
                await resetBefore(target: target, previous: scenes[idx - 1], app: app, router: router)
                ScreenshotHooks.setScene(target)
            }

            let usesEditor = Self.editorScenes.contains(target)
            let sceneDeadline = Date().addingTimeInterval(usesEditor ? 45 : 30)
            var sceneReady = baseReady
            if baseReady {
                sceneReady = await prepareScene(
                    target,
                    previous: idx > 0 ? scenes[idx - 1] : nil,
                    app: app,
                    router: router,
                    deadline: sceneDeadline
                )
            }

            // 等动画、图片解码与 WKWebView 首帧绘制落下。
            let settleMs = target == .chatKeyboard ? 800 : (usesEditor ? 700 : 500)
            try? await Task.sleep(for: .milliseconds(settleMs))
            let idxPart = (ackDirectory != nil) ? " idx=\(idx)" : ""
            let reduceTransparency = UIAccessibility.isReduceTransparencyEnabled
            let increaseContrast = UIAccessibility.isDarkerSystemColorsEnabled
            let keyboard = KeyboardObserver.shared.top.isFinite ? "up" : "down"
            // 浮动外观走的是哪条路（native / material / solid）：和界面上的玻璃组件用同一个判断，脚本按系统版本和变体核对。
            let glass = NFChromePath.resolve(reduceTransparency: reduceTransparency, forceSolid: forceSolidChrome)
            let line = "NF_FIXTURE_READY\(idxPart) scene=\(target.rawValue) reduceTransparency=\(reduceTransparency) forcedSolid=\(forceSolidChrome) rtl=\(app.language.isRightToLeft) locale=\(app.language.uiLocale) glass=\(glass.rawValue) keyboard=\(keyboard) increaseContrast=\(increaseContrast) timeout=\(!sceneReady)\n"
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
        if previous == .chatComposer {
            app.chat.setAttachedPages([])
            if let sampleImageURL {
                app.chat.removeFile(sampleImageURL.absoluteString)
            }
            app.chat.updateDraft("")
        }
        if previous == .chatKeyboard {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            app.chat.clearQuote()
            app.chat.updateDraft("")
            _ = await poll(until: Date().addingTimeInterval(2)) {
                !KeyboardObserver.shared.top.isFinite
            }
        }
        if previous == .editorScrolled && (target == .editor || target == .pageMenu) {
            app.notes.closeNote()
            _ = await poll(until: Date().addingTimeInterval(5)) { app.notes.state.open == nil }
        }
        if previous == .toast {
            // 长提示条要 3.5 秒才自己收起：马上收掉，免得留到下一个场景。
            ToastCenter.shared.hide()
        }
        let overlayScenes: Set<ScreenshotScene> = [
            .modelSheet, .attachSheet, .pageMenu, .emojiPicker, .toast, .settingsPage,
        ]
        if overlayScenes.contains(previous) {
            ScreenshotHooks.dismissOverlays()
            try? await Task.sleep(for: .milliseconds(450))
        }
        if previous == .chatScrolled {
            // chat-scrolled 把京都聊天滚上去并停止跟随底部。先换到新聊天（列表被拿掉）再打开京都聊天，
            // 新建的列表从最底部开始，后面的菜单、抽屉、底部弹层、提示条场景和原来的截图一样贴底。
            app.chat.newChat()
            try? await Task.sleep(for: .milliseconds(250))
            app.chat.openSession(FixtureCatalog.IDs.kyotoSession)
            let repinDeadline = Date().addingTimeInterval(5)
            _ = await poll(until: repinDeadline) {
                app.chat.state.activeSessionId == FixtureCatalog.IDs.kyotoSession
                    && !app.chat.state.messagesLoading
                    && !app.chat.state.messages.isEmpty
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
        if router.drawerOpen {
            router.dismissDrawer()
            try? await Task.sleep(for: .milliseconds(350))
        }
        if router.sidebarDocked && !router.dockedSidebarVisible && target != .sidebarCollapsed {
            router.openSidebar()
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
        let targetUsesNotes = target == .workspace || target == .workspaceScrolled || Self.editorScenes.contains(target)
        let targetUsesSearch = (target == .search || target == .searchScrolled)
        if !targetUsesNotes && !targetUsesSearch && router.selectedTab != .chat {
            router.selectTab(.chat)
            let leaveDeadline = Date().addingTimeInterval(5)
            _ = await poll(until: leaveDeadline) {
                app.notes.state.workspace == .chat && app.notes.state.open == nil && router.selectedTab == .chat
            }
        }
    }

    private func prepareScene(
        _ target: ScreenshotScene,
        previous: ScreenshotScene?,
        app: AppEnvironment,
        router: AppRouter,
        deadline: Date
    ) async -> Bool {
        switch target {
        case .chatEmpty:
            router.selectTab(.chat)
            if app.chat.state.activeSessionId != nil {
                app.chat.newChat()
            }
            return router.selectedTab == .chat && app.chat.state.activeSessionId == nil && app.chat.state.messages.isEmpty

        case .chat:
            router.selectTab(.chat)
            app.chat.openSession(FixtureCatalog.IDs.kyotoSession)
            return await poll(until: deadline) {
                router.selectedTab == .chat
                    && app.chat.state.activeSessionId == FixtureCatalog.IDs.kyotoSession
                    && !app.chat.state.messagesLoading
                    && !app.chat.state.messages.isEmpty
            }

        case .chatStreaming:
            router.selectTab(.chat)
            app.chat.newChat()
            app.chat.send(FixtureCatalog.Prompts.streaming)
            return await poll(until: deadline) {
                router.selectedTab == .chat
                    && app.chat.state.sending
                    && app.chat.state.messages.contains {
                        $0.role == .assistant && !$0.content.isEmpty
                    }
            }

        case .chatComposer:
            guard await openKyoto(app: app, router: router, deadline: deadline),
                  let sampleImageURL,
                  let page = FixtureCatalog.editorPages[FixtureCatalog.IDs.glassPage]
            else { return false }
            app.chat.setAttachedPages([
                ChatProjectNote(id: FixtureCatalog.IDs.glassPage, title: page.title, icon: page.icon, kind: page.kind),
            ])
            app.chat.addFiles([
                LocalFile(uri: sampleImageURL.absoluteString, name: sampleImageURL.lastPathComponent, mimeType: "image/png", size: sampleImageSize),
            ])
            app.chat.updateDraft("Check the walking route against this sketch.\nKeep Day 2 flexible in case it rains.")
            return await poll(until: deadline) {
                app.chat.state.files.count == 1 && app.chat.state.attachedPages.count == 1
            }

        case .chatKeyboard:
            guard await openKyoto(app: app, router: router, deadline: deadline) else { return false }
            // 走产品里的引用聚焦路径；无软键盘的模拟器仍拍照，由脚本按 READY 标记报告。
            app.chat.setQuote("Keep water and small coins for shrine entry gates along the Philosopher's Path.")
            _ = await poll(until: min(deadline, Date().addingTimeInterval(4))) {
                KeyboardObserver.shared.top.isFinite
            }
            return app.chat.state.quote != nil

        case .chatStreamed:
            router.selectTab(.chat)
            app.chat.newChat()
            app.chat.send(FixtureCatalog.Prompts.streamed)
            return await poll(until: deadline) {
                router.selectedTab == .chat
                    && !app.chat.state.sending
                    && app.chat.state.messages.last.map { $0.role == .assistant && !$0.content.isEmpty } == true
            }

        case .chatRegenerate:
            // 很长的最后回答停在底部时重新生成：条数不变、内容一下子变短，新回答保持生成中。
            // 就绪只看状态；消息区有没有画出来看截图。
            router.selectTab(.chat)
            app.chat.openSession(FixtureCatalog.IDs.longSession)
            let opened = await poll(until: deadline) {
                router.selectedTab == .chat
                    && app.chat.state.activeSessionId == FixtureCatalog.IDs.longSession
                    && !app.chat.state.messagesLoading
                    && !app.chat.state.messages.isEmpty
            }
            // 等消息列表建好、停在底部。
            try? await Task.sleep(for: .milliseconds(800))
            guard opened, let answer = app.chat.state.messages.last else { return false }
            app.chat.regenerate(answer.id)
            let replaced = await poll(until: deadline) {
                app.chat.state.messages.last.map { $0.id != answer.id && !$0.content.isEmpty } == true
            }
            try? await Task.sleep(for: .milliseconds(1000))
            return replaced && app.chat.state.sending

        case .drawer:
            router.selectTab(.chat)
            if app.chat.state.activeSessionId != FixtureCatalog.IDs.kyotoSession || app.chat.state.messages.isEmpty {
                app.chat.openSession(FixtureCatalog.IDs.kyotoSession)
            }
            let chatLoaded = await poll(until: deadline) {
                router.selectedTab == .chat
                    && app.chat.state.activeSessionId == FixtureCatalog.IDs.kyotoSession
                    && !app.chat.state.messagesLoading
                    && !app.chat.state.messages.isEmpty
            }
            router.openSidebar()
            return chatLoaded && router.isSidebarVisible

        case .sidebarCollapsed:
            let shown = await openKyoto(app: app, router: router, deadline: deadline)
            router.closeSidebar()
            try? await Task.sleep(for: .milliseconds(350))
            return shown && !router.isSidebarVisible

        case .workspace, .workspaceScrolled:
            router.selectTab(.workspace)
            if app.notes.state.open != nil {
                app.notes.closeNote()
            }
            let shown = {
                router.selectedTab == .workspace
                    && app.notes.state.workspace == .notes
                    && app.notes.state.open == nil
                    && app.notes.state.loaded
                    && !app.notes.state.pages.isEmpty
            }
            if target == .workspaceScrolled {
                return await awaitHook(target, deadline: deadline, shown: shown)
            }
            return await poll(until: deadline, condition: shown)

        case .editor, .pageMenu:
            return await openEditor(FixtureCatalog.IDs.tripPage, scene: target, app: app, router: router, deadline: deadline)

        case .editorScrolled:
            return await openEditor(FixtureCatalog.IDs.tripPage, scene: target, reveal: "fx-block-day2", app: app, router: router, deadline: deadline)

        case .editorLocked:
            return await openEditor(FixtureCatalog.IDs.glassPage, scene: target, app: app, router: router, deadline: deadline)

        case .editorWhiteboard:
            return await openEditor(FixtureCatalog.IDs.boardPage, scene: target, app: app, router: router, deadline: deadline)

        case .editorSlides:
            return await openEditor(FixtureCatalog.IDs.roadmapPage, scene: target, app: app, router: router, deadline: deadline)

        case .search:
            router.openSearch()
            return await poll(until: deadline) {
                router.selectedTab == .search && ScreenshotHooks.isReady(.search)
            }

        case .modelSheet:
            router.selectTab(.chat)
            if app.chat.state.activeSessionId != FixtureCatalog.IDs.kyotoSession || app.chat.state.messages.isEmpty {
                app.chat.openSession(FixtureCatalog.IDs.kyotoSession)
            }
            return await poll(until: deadline) {
                router.selectedTab == .chat
                    && app.chat.state.activeSessionId == FixtureCatalog.IDs.kyotoSession
                    && !app.chat.state.messages.isEmpty
                    && ScreenshotHooks.isReady(.modelSheet)
            }

        case .attachSheet:
            router.selectTab(.chat)
            if app.chat.state.activeSessionId != FixtureCatalog.IDs.kyotoSession || app.chat.state.messages.isEmpty {
                app.chat.openSession(FixtureCatalog.IDs.kyotoSession)
            }
            return await poll(until: deadline) {
                router.selectedTab == .chat
                    && app.chat.state.activeSessionId == FixtureCatalog.IDs.kyotoSession
                    && !app.chat.state.messages.isEmpty
                    && ScreenshotHooks.isReady(.attachSheet)
            }

        case .settings, .settingsPlan:
            router.openSettings(page: target == .settingsPlan ? .plan : nil)
            return await poll(until: deadline) {
                router.settingsOpen && app.account.state.user != nil
            }

        case .signIn:
            router.openSignIn()
            return await poll(until: deadline) {
                router.signInOpen && app.account.state.configured && app.account.state.user == nil
            }

        case .chatScrolled, .emojiPicker:
            // 京都聊天显示出来后，界面里的钩子（消息列表 / 顶栏）滚动列表或打开换图标的选择器，再报告就绪。
            _ = await openKyoto(app: app, router: router, deadline: deadline)
            return await awaitHook(target, deadline: deadline) {
                kyotoShown(app: app, router: router)
            }

        case .toast:
            // 提示条完全由这里驱动：在京都聊天上显示一条已有文案的长提示条（3.5 秒），等它滑入。
            let shown = await openKyoto(app: app, router: router, deadline: deadline)
            Toast.show(L("export_file_saved"), long: true)
            try? await Task.sleep(for: .milliseconds(400))
            return shown && ToastCenter.shared.current != nil

        case .searchScrolled:
            // 先走 search 的准备：检索界面里的 search 钩子输入固定的检索词，结果出来后报告就绪。
            // 上一个场景就是 search 时结果已经在界面上，直接用（同样的词不会重新检索，search 钩子也不会再报告）；
            // 别的情况下结果也可能早就在了，所以只等一小段时间。
            // 再切回 search-scrolled：结果列表里的钩子把结果往上滚一段后报告就绪。
            let primed = previous == .search && router.selectedTab == .search
            if !primed {
                ScreenshotHooks.setScene(.search)
                router.openSearch()
                let searchGrace = min(deadline, Date().addingTimeInterval(10))
                _ = await poll(until: searchGrace) {
                    router.selectedTab == .search && ScreenshotHooks.isReady(.search)
                }
                ScreenshotHooks.setScene(.searchScrolled)
            }
            router.openSearch()
            return await awaitHook(.searchScrolled, deadline: deadline) {
                router.selectedTab == .search
            }

        case .settingsPage:
            // 和 settings 一样打开设置；设置界面里的钩子换到「通用」页、往上滚一段后报告就绪。
            router.openSettings()
            return await awaitHook(.settingsPage, deadline: deadline) {
                router.settingsOpen && app.account.state.user != nil
            }
        }
    }

    private func openEditor(
        _ id: String,
        scene: ScreenshotScene,
        reveal: String? = nil,
        app: AppEnvironment,
        router: AppRouter,
        deadline: Date
    ) async -> Bool {
        guard let page = FixtureCatalog.editorPages[id] else { return false }
        if !app.notes.state.loaded || app.notes.state.pages.isEmpty {
            app.notes.refresh()
        }
        guard await poll(until: deadline, condition: {
            app.notes.state.loaded && app.notes.state.pages.contains { $0.id == id }
        }) else { return false }

        router.openNote(id, title: page.title, icon: page.icon, kind: page.kind, reveal: reveal)
        let ready = await poll(until: deadline) {
            router.selectedTab == .workspace
                && app.notes.state.open?.id == id
                && app.notes.state.open?.kind == page.kind
                && app.notes.state.saveState == "saved"
                && (scene != .pageMenu || ScreenshotHooks.isReady(.pageMenu))
        }
        // loadHTMLString 的 base URL 不一定出现在 location.search；就绪后再就地定位一次。
        if ready, let reveal { app.editorBridge?.reveal(reveal) }
        return ready
    }

    /// 切到聊天并打开京都聊天（已经开着就不重开），等消息显示出来。
    private func openKyoto(app: AppEnvironment, router: AppRouter, deadline: Date) async -> Bool {
        router.selectTab(.chat)
        if app.chat.state.activeSessionId != FixtureCatalog.IDs.kyotoSession || app.chat.state.messages.isEmpty {
            app.chat.openSession(FixtureCatalog.IDs.kyotoSession)
        }
        return await poll(until: deadline) {
            kyotoShown(app: app, router: router)
        }
    }

    private func kyotoShown(app: AppEnvironment, router: AppRouter) -> Bool {
        router.selectedTab == .chat
            && app.chat.state.activeSessionId == FixtureCatalog.IDs.kyotoSession
            && !app.chat.state.messagesLoading
            && !app.chat.state.messages.isEmpty
    }

    /// 等界面里的钩子报告 [target] 就绪：先等它所在的界面显示出来（[shown]），再等钩子。
    /// 钩子跟着 `sceneTick` 跑；场景切过去时界面还没内容（例如聊天还是空的），钩子可能已经跑过一次、之后不再跑，
    /// 所以一段时间内没就绪就重新设一次场景（新的 tick，清掉已消费 / 已就绪），让钩子在有内容时再跑一次。
    private func awaitHook(_ target: ScreenshotScene, deadline: Date, shown: () -> Bool) async -> Bool {
        guard await poll(until: deadline, condition: shown) else { return false }
        let grace = min(deadline, Date().addingTimeInterval(5))
        if await poll(until: grace, condition: { ScreenshotHooks.isReady(target) }) { return true }
        ScreenshotHooks.setScene(target)
        return await poll(until: deadline) {
            shown() && ScreenshotHooks.isReady(target)
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
