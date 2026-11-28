import XCTest
@testable import NoteFableCore

// 幻灯片的桥（放映、导出文件的保存；src/lib/native-bridge.ts、Android PageKindTest 的同名用例）。
final class SlidesBridgeTests: XCTestCase {
    func testParsesThePresentationAndFileMessages() {
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"presentation","state":"start","index":2,"count":9}"#), .presentation(state: "start", index: 2, count: 9))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"presentation","state":"spin"}"#))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileStart","id":"f1","name":"Deck.pdf","mime":"application/pdf","size":12}"#), .fileStart(id: "f1", name: "Deck.pdf", mime: "application/pdf", size: 12))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileChunk","id":"f1","index":0,"data":"AAEC"}"#), .fileChunk(id: "f1", index: 0, data: "AAEC"))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileEnd","id":"f1"}"#), .fileEnd(id: "f1"))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileAbort","id":"f1"}"#), .fileAbort(id: "f1"))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"fileStart","id":"f1","name":""}"#))
    }

    func testTheBootstrapDeclaresPresentationAndFileSaving() {
        let script = NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en")
        XCTAssertTrue(script.contains("canPresent:function(){return true}"))
        XCTAssertTrue(script.contains("canSaveFile:function(){return true}"))
        XCTAssertEqual(NoteEmbedScripts.slides(#"{"action":"end"}"#), #"(function(){var e=window.notefableEmbed;if(e&&typeof e.slides==='function')e.slides("{\"action\":\"end\"}")})()"#)
    }

    // 导出文件的拼接、文件名和保存的流程见 ExportFileTests（白板和幻灯片共用一套）。

    @MainActor
    func testTheViewModelTracksThePresentationOfTheOpenEditor() async {
        let backend = NotesTestBackend()
        let vm = NotesViewModel(backend: backend)
        vm.setWorkspace(.notes)
        await notesSettle()
        vm.openNote("a")
        await notesSettle()
        let editor = NotesTestEditor()
        let bridge = NoteEmbedBridge { vm.onEditorMessage("a", $0) }
        bridge.attach(editor)
        vm.registerEditor(bridge)

        // 別的编辑器晚到的消息不收。
        vm.onEditorMessage("b", .presentation(state: "start", index: 0, count: 3))
        XCTAssertFalse(vm.state.presenting)
        bridge.postMessage(#"{"type":"presentation","state":"start","index":0,"count":3}"#)
        XCTAssertTrue(vm.state.presenting)
        vm.slidesCommand(#"{"action":"end"}"#)
        XCTAssertEqual(editor.calls.last, #"slides:{"action":"end"}"#)
        bridge.postMessage(#"{"type":"presentation","state":"end","index":0,"count":3}"#)
        XCTAssertFalse(vm.state.presenting)

        bridge.postMessage(#"{"type":"presentation","state":"start","index":0,"count":3}"#)
        vm.registerEditor(nil)
        XCTAssertFalse(vm.state.presenting)
    }

    func testNotesAndSlidesBothSupportPresentationInPageMenu() {
        XCTAssertTrue(notePageSupportsPresentation(.note))
        XCTAssertTrue(notePageSupportsPresentation(.slides))
        XCTAssertFalse(notePageSupportsPresentation(.whiteboard))
    }

    // ---- AI 生成幻灯片向导（#150） ----

    func testParsesSlidesWizardMessages() {
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"slidesWizard","state":"open"}"#), .slidesWizard(open: true, busy: false))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"slidesWizard","state":"closed","busy":true}"#), .slidesWizard(open: false, busy: true))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"slidesWizard","state":"closed","busy":false}"#), .slidesWizard(open: false, busy: false))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"slidesWizard","state":"unknown"}"#))
    }

    func testParsesTheNotesWhoseSlidesAreBeingGenerated() {
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"slidesJobs","pageIds":["p1","p2"]}"#), .slidesJobs(pageIds: ["p1", "p2"]))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"slidesJobs","pageIds":[]}"#), .slidesJobs(pageIds: []))
        // 不是字符串、空白的丢掉；pageIds 不是数组或缺了的整条丢掉。
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"slidesJobs","pageIds":["p1",""," ",3,null]}"#), .slidesJobs(pageIds: ["p1"]))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"slidesJobs","pageIds":"p1"}"#))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"slidesJobs"}"#))
    }

    @MainActor
    func testTheViewModelTracksTheNotesWhoseSlidesAreBeingGenerated() async {
        let backend = NotesTestBackend()
        let vm = NotesViewModel(backend: backend)
        vm.setWorkspace(.notes)
        await notesSettle()
        let bridge = NoteEmbedBridge { vm.onEditorMessage("a", $0) }
        bridge.postMessage(#"{"type":"slidesJobs","pageIds":["a"]}"#)
        XCTAssertEqual(vm.state.generatingSlides, ["a"])
        // 打开别的笔记不清掉：生成在网页里接着跑。
        vm.openNote("b")
        await notesSettle()
        XCTAssertEqual(vm.state.generatingSlides, ["a"])
        bridge.postMessage(#"{"type":"slidesJobs","pageIds":[]}"#)
        XCTAssertEqual(vm.state.generatingSlides, [])
    }

    func testSlidesWizardUrlAndBootstrapCapability() {
        let api = makeApi(FakeTransport(), baseUrl: "https://example.test")
        XCTAssertEqual(
            api.slidesWizardUrl(lang: "zh", model: "gpt-5.5", reasoning: "high", theme: "dark"),
            "https://example.test/note-embed?warm=1&lang=zh&model=gpt-5.5&reasoning=high&theme=dark"
        )
        XCTAssertEqual(
            api.slidesWizardUrl(lang: nil, model: nil, reasoning: nil, theme: nil),
            "https://example.test/note-embed?warm=1"
        )
        let bootstrap = NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en")
        XCTAssertTrue(bootstrap.contains("canShowSlidesWizard:function(){return true}"))
    }

    func testSlidesWizardScriptsValidateIdsAndFormatRequests() {
        let openNote = NoteEmbedScripts.slidesWizardOpen(source: .note(pageId: "p_1"), model: "m1", reasoning: "low")
        XCTAssertNotNil(openNote)
        XCTAssertTrue(openNote?.contains(#""action":"open""#) == true)
        XCTAssertTrue(openNote?.contains(#""type":"note","pageId":"p_1""#) == true)
        XCTAssertTrue(openNote?.contains(#""model":"m1""#) == true)
        XCTAssertTrue(openNote?.contains(#""reasoning":"low""#) == true)

        let openNew = NoteEmbedScripts.slidesWizardOpen(source: .new(groupId: "g_1", parentId: nil))
        XCTAssertTrue(openNew?.contains(#""type":"new","groupId":"g_1""#) == true)
        XCTAssertFalse(openNew?.contains("parentId") == true)

        let openChat = NoteEmbedScripts.slidesWizardOpen(source: .chat(sessionId: "s-9"))
        XCTAssertTrue(openChat?.contains(#""type":"chat","sessionId":"s-9""#) == true)

        // 不合法的 ID 拒绝生成脚本。
        XCTAssertNil(NoteEmbedScripts.slidesWizardOpen(source: .note(pageId: "bad id!")))
        XCTAssertNil(NoteEmbedScripts.slidesWizardOpen(source: .new(groupId: "../x")))
        XCTAssertNil(NoteEmbedScripts.slidesWizardOpen(source: .chat(sessionId: "")))

        XCTAssertEqual(NoteEmbedScripts.slidesWizardAnswer("open"), true)
        XCTAssertEqual(NoteEmbedScripts.slidesWizardAnswer("unsupported"), false)
        XCTAssertEqual(NoteEmbedScripts.slidesWizardAnswer("rejected"), false)
        XCTAssertNil(NoteEmbedScripts.slidesWizardAnswer("loading"))
        XCTAssertNil(NoteEmbedScripts.slidesWizardAnswer(nil))
        XCTAssertTrue(NoteEmbedScripts.slidesWizardBack.contains(#""action":"back""#))
    }

    @MainActor
    func testViewModelSlidesWizardLifecycle() async {
        let backend = NotesTestBackend()
        let vm = NotesViewModel(backend: backend)
        vm.setWorkspace(.notes)
        await notesSettle()

        // 没有打开页面时打开全屏向导。
        vm.openSlidesWizard(.new(), editor: nil)
        XCTAssertEqual(vm.state.slidesWizard?.source, .new())
        XCTAssertNil(vm.state.slidesWizard?.editor)
        XCTAssertEqual(vm.state.slidesWizard?.shown, false)

        // 还没 shown 之前，旧的 closed 不应该关掉新向导。
        vm.onSlidesWizardClosed()
        XCTAssertNotNil(vm.state.slidesWizard)

        // 网页报出 open → shown = true，再报 closed 关掉。
        vm.onSlidesWizardOpened(editor: nil)
        XCTAssertEqual(vm.state.slidesWizard?.shown, true)
        vm.onWizardUsageLimit(tier: "guest", kind: "chat")
        XCTAssertEqual(vm.state.wizardUsageLimit, UsageLimitInfo(tier: "guest", kind: "chat"))
        vm.onWizardStorageLimit(tier: "member", used: 100, limit: 200)
        XCTAssertNil(vm.state.wizardUsageLimit)
        XCTAssertEqual(vm.state.wizardStorageLimit, StorageLimitInfo(tier: "member", used: 100, limit: 200))
        vm.onSlidesWizardClosed()
        XCTAssertNil(vm.state.slidesWizard)
        XCTAssertNil(vm.state.wizardUsageLimit)
        XCTAssertNil(vm.state.wizardStorageLimit)

        // 编辑器打开时，AI 面板自己发 slidesWizard open。
        vm.openNote("a")
        await notesSettle()
        vm.onSlidesWizardOpened(editor: "a")
        XCTAssertEqual(vm.state.slidesWizard?.source, .note(pageId: "a"))
        XCTAssertEqual(vm.state.slidesWizard?.editor, "a")
        XCTAssertEqual(vm.state.slidesWizard?.shown, true)

        // 关掉编辑器时，盖在编辑器上的向导自动清掉。
        vm.closeNote()
        await notesSettle()
        XCTAssertNil(vm.state.slidesWizard)
    }

    @MainActor
    func testRouterSwitchesToWorkspaceWhenOpeningWizardWithOpenNoteFromSearchTab() async {
        let env = AppEnvironment(config: AppConfig(baseURL: "https://example.test", siteURL: "https://example.test"))
        let router = AppRouter(app: env)
        env.notes.openNote("n1", title: "Note 1", icon: nil)
        await notesSettle()
        router.selectTab(.search)
        XCTAssertEqual(router.selectedTab, .search)
        XCTAssertEqual(env.notes.state.visibleEditor, "n1")

        // 从搜索标签页打开向导：切回工作区并复用已打开的编辑器，不另外拉起全屏向导争抢 WKWebView。
        router.openSlidesWizard(.new())
        XCTAssertEqual(router.selectedTab, .workspace)
        XCTAssertEqual(env.notes.state.slidesWizard?.editor, "n1")
    }

    // ---- PowerPoint（.pptx）导入（#154 PR 12） ----

    func testParsesPptxImportMessagesAndBuildsScripts() {
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"pptxImport","state":"open"}"#), .pptxImport(open: true))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"pptxImport","state":"closed"}"#), .pptxImport(open: false))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"pptxImport","state":"other"}"#))

        let bootstrap = NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en")
        XCTAssertTrue(bootstrap.contains("canShowPptxImport:function(){return true}"))

        let openRoot = NoteEmbedScripts.pptxImportOpen()
        XCTAssertTrue(openRoot?.contains(#""action":"open""#) == true)
        let openGroup = NoteEmbedScripts.pptxImportOpen(target: PptxImportTarget(groupId: "g_1"))
        XCTAssertTrue(openGroup?.contains(#""groupId":"g_1""#) == true)
        let openParent = NoteEmbedScripts.pptxImportOpen(target: PptxImportTarget(parentId: "p-2"))
        XCTAssertTrue(openParent?.contains(#""parentId":"p-2""#) == true)
        XCTAssertNil(NoteEmbedScripts.pptxImportOpen(target: PptxImportTarget(groupId: "bad/id")))
        XCTAssertNil(NoteEmbedScripts.pptxImportOpen(target: PptxImportTarget(parentId: "x'y")))
        XCTAssertTrue(NoteEmbedScripts.pptxImportBack.contains(#""action":"back""#))
    }

    @MainActor
    func testViewModelAndRouterPptxImportLifecycle() async {
        let env = AppEnvironment(config: AppConfig(baseURL: "https://example.test", siteURL: "https://example.test"))
        let router = AppRouter(app: env)
        let vm = env.notes
        vm.setWorkspace(.notes)
        await notesSettle()

        // 没有打开页面时打开全屏导入画面。
        router.openPptxImport(PptxImportTarget(groupId: "g1"))
        XCTAssertEqual(vm.state.pptxImport?.target, PptxImportTarget(groupId: "g1"))
        XCTAssertNil(vm.state.pptxImport?.editor)
        XCTAssertEqual(vm.state.pptxImport?.shown, false)

        // 还没 shown 之前，旧的 closed 不关掉新的导入窗口。
        vm.onPptxImportClosed()
        XCTAssertNotNil(vm.state.pptxImport)

        vm.onPptxImportOpened(editor: nil)
        XCTAssertEqual(vm.state.pptxImport?.shown, true)
        vm.onPptxImportStorageLimit(tier: "member", used: 50, limit: 100)
        XCTAssertEqual(vm.state.pptxImportStorageLimit, StorageLimitInfo(tier: "member", used: 50, limit: 100))
        vm.onPptxImportClosed()
        XCTAssertNil(vm.state.pptxImport)
        XCTAssertNil(vm.state.pptxImportStorageLimit)

        // 编辑器打开时从搜索页打开导入：切回工作区并复用当前编辑器。
        vm.openNote("s1", title: "Deck", icon: nil, kind: .slides)
        await notesSettle()
        router.selectTab(.search)
        router.openPptxImport()
        XCTAssertEqual(router.selectedTab, .workspace)
        XCTAssertEqual(vm.state.pptxImport?.editor, "s1")

        // 关掉编辑器时，盖在编辑器上的导入窗口自动清掉。
        vm.closeNote()
        await notesSettle()
        XCTAssertNil(vm.state.pptxImport)
    }

    // ---- 复习和测验模式（PR 13） ----

    @MainActor
    func testReviewQuizBridgeScriptsMenuAndLifecycle() async {
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"quiz","state":"open"}"#), .quiz(open: true))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"quiz","state":"closed"}"#), .quiz(open: false))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"quiz","state":"other"}"#))

        XCTAssertTrue(notePageSupportsQuiz(.note))
        XCTAssertTrue(notePageSupportsQuiz(.slides))
        XCTAssertFalse(notePageSupportsQuiz(.whiteboard))

        let bootstrap = NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en")
        XCTAssertTrue(bootstrap.contains("canShowQuiz:function(){return true}"))

        let openNote = NoteEmbedScripts.quizOpen(pageId: "n_1", model: "gpt-6-luna", reasoning: "medium")
        XCTAssertNotNil(openNote)
        XCTAssertTrue(openNote?.contains(#""action":"open""#) == true)
        XCTAssertTrue(openNote?.contains(#""pageId":"n_1""#) == true)
        XCTAssertTrue(openNote?.contains(#""model":"gpt-6-luna""#) == true)
        XCTAssertTrue(openNote?.contains(#""reasoning":"medium""#) == true)
        XCTAssertNil(NoteEmbedScripts.quizOpen(pageId: ""))
        XCTAssertNil(NoteEmbedScripts.quizOpen(pageId: "bad id"))
        XCTAssertEqual(NoteEmbedScripts.quizAnswer("open"), true)
        XCTAssertEqual(NoteEmbedScripts.quizAnswer("unsupported"), false)
        XCTAssertNil(NoteEmbedScripts.quizAnswer("loading"))
        XCTAssertTrue(NoteEmbedScripts.quizBack.contains(#""action":"back""#))

        let backend = NotesTestBackend()
        let vm = NotesViewModel(backend: backend)
        vm.setWorkspace(.notes)
        await notesSettle()
        vm.openNote("a", title: "Bio", icon: nil, kind: .note)
        await notesSettle()
        vm.openReviewQuiz("a", editor: "a")
        XCTAssertEqual(vm.state.reviewQuiz?.pageId, "a")
        XCTAssertEqual(vm.state.reviewQuiz?.shown, false)
        // 还没 shown 之前，旧的 closed 不会关掉新请求。
        vm.onReviewQuizClosed()
        XCTAssertNotNil(vm.state.reviewQuiz)
        vm.onEditorMessage("a", .quiz(open: true))
        XCTAssertEqual(vm.state.reviewQuiz?.shown, true)
        vm.onEditorMessage("a", .quiz(open: false))
        XCTAssertNil(vm.state.reviewQuiz)
    }

    // ---- 工作区统一「用 AI 生成」（#254） ----

    @MainActor
    func testAiGenerateBridgeScriptsAndLifecycle() async {
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"aiGenerate","state":"open"}"#), .aiGenerate(open: true, busy: false))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"aiGenerate","state":"closed","busy":true}"#), .aiGenerate(open: false, busy: true))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"aiGenerate","state":"closed"}"#), .aiGenerate(open: false, busy: false))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"aiGenerate","state":"other"}"#))

        let bootstrap = NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en")
        XCTAssertTrue(bootstrap.contains("canShowAiGenerate:function(){return true}"))

        let open = NoteEmbedScripts.aiGenerateOpen(
            target: AiGenerateTarget(kind: .whiteboard, groupId: "g_1", prompt: "System map", autoStart: true),
            model: "gpt-6-luna",
            reasoning: "high"
        )
        XCTAssertNotNil(open)
        XCTAssertTrue(open?.contains(#""action":"open""#) == true)
        XCTAssertTrue(open?.contains(#""kind":"whiteboard""#) == true)
        XCTAssertTrue(open?.contains(#""groupId":"g_1""#) == true)
        XCTAssertTrue(open?.contains(#""prompt":"System map""#) == true)
        XCTAssertTrue(open?.contains(#""autoStart":true"#) == true)
        XCTAssertTrue(open?.contains(#""model":"gpt-6-luna""#) == true)
        XCTAssertTrue(open?.contains(#""reasoning":"high""#) == true)
        XCTAssertNil(NoteEmbedScripts.aiGenerateOpen(target: AiGenerateTarget(groupId: "bad/id")))
        XCTAssertNil(NoteEmbedScripts.aiGenerateOpen(target: AiGenerateTarget(parentId: "bad id")))
        XCTAssertTrue(NoteEmbedScripts.aiGenerateBack.contains(#""action":"back""#))

        let env = AppEnvironment(config: AppConfig(baseURL: "https://example.test", siteURL: "https://example.test"))
        let router = AppRouter(app: env)
        let vm = env.notes
        vm.setWorkspace(.notes)
        await notesSettle()

        router.openAiGenerate(AiGenerateTarget(kind: .note, prompt: "Study guide"))
        XCTAssertEqual(vm.state.aiGenerate?.target, AiGenerateTarget(kind: .note, prompt: "Study guide"))
        XCTAssertNil(vm.state.aiGenerate?.editor)
        XCTAssertEqual(vm.state.aiGenerate?.shown, false)

        // 还没 shown 之前，旧的 closed 不关掉新的面板。
        vm.onAiGenerateClosed()
        XCTAssertNotNil(vm.state.aiGenerate)

        vm.onAiGenerateOpened(editor: nil)
        XCTAssertEqual(vm.state.aiGenerate?.shown, true)
        vm.onAiGenerateUsageLimit(tier: "guest", kind: "chat")
        XCTAssertEqual(vm.state.aiGenerateUsageLimit, UsageLimitInfo(tier: "guest", kind: "chat"))
        vm.onAiGenerateStorageLimit(tier: "member", used: 50, limit: 100)
        XCTAssertNil(vm.state.aiGenerateUsageLimit)
        XCTAssertEqual(vm.state.aiGenerateStorageLimit, StorageLimitInfo(tier: "member", used: 50, limit: 100))
        vm.onAiGenerateClosed()
        XCTAssertNil(vm.state.aiGenerate)
        XCTAssertNil(vm.state.aiGenerateUsageLimit)
        XCTAssertNil(vm.state.aiGenerateStorageLimit)

        // 编辑器打开时从搜索页打开：切回工作区并复用当前编辑器。
        vm.openNote("n1", title: "Note 1", icon: nil, kind: .note)
        await notesSettle()
        router.selectTab(.search)
        router.openAiGenerate(AiGenerateTarget(kind: .slides))
        XCTAssertEqual(router.selectedTab, .workspace)
        XCTAssertEqual(vm.state.aiGenerate?.editor, "n1")

        // 关掉编辑器时，盖在编辑器上的面板自动清掉。
        vm.closeNote()
        await notesSettle()
        XCTAssertNil(vm.state.aiGenerate)
    }
}
