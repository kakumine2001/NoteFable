import Foundation
import XCTest
@testable import NoteFableCore

/// 编辑器的 JS 桥（Android ui/NoteEditor.kt 的 NoteEmbedBridge）、拖动状态和笔记界面的文案规则。
final class NoteEditorTests: XCTestCase {
    /// 计时用的假 sleep：一直等到测试放行（[fire]），不真等。
    private final class Timer: @unchecked Sendable {
        let gate = NoteDeferred<Bool>()
        private let lock = NSLock()
        private var asked: [Duration] = []

        var requested: [Duration] { lock.withLock { asked } }

        func sleep(_ duration: Duration) async throws {
            lock.withLock { asked.append(duration) }
            if !(await gate.wait()) { throw CancellationError() }
        }

        func fire() { gate.complete(true) }
    }

    @MainActor
    private func makeBridge(_ timer: Timer = Timer(), messages: NotesTestBox<[EmbedMessage]>? = nil) -> NoteEmbedBridge {
        var next = 0
        return NoteEmbedBridge(
            currentLanguage: { "ja" },
            sleep: { try await timer.sleep($0) },
            makeRequestId: {
                next += 1
                return "r\(next)"
            },
            onMessage: { messages?.value.append($0) }
        )
    }

    // ---- 保存后再离开 ----

    @MainActor
    func testFlushAsksThePageToSaveAndReturnsItsAnswer() async {
        let editor = NotesTestEditor()
        let bridge = makeBridge()
        bridge.attach(editor)
        editor.onFlush = { id in bridge.postMessage(#"{"type":"flushed","requestId":"\#(id)","ok":true}"#) }
        let saved = await bridge.flush()
        XCTAssertEqual(saved, FlushResult(true))
        XCTAssertEqual(editor.calls, ["flush:r1"])

        // 没保存成功但草稿留在 WebView 里：kept。
        editor.onFlush = { id in bridge.postMessage(#"{"type":"flushed","requestId":"\#(id)","ok":false,"kept":true}"#) }
        let kept = await bridge.flush()
        XCTAssertEqual(kept, FlushResult(false, draftKept: true))

        // 冲突：不 ok 也没有 kept。
        editor.onFlush = { id in bridge.postMessage(#"{"type":"flushed","requestId":"\#(id)","ok":false}"#) }
        let conflict = await bridge.flush()
        XCTAssertEqual(conflict, FlushResult(false))
    }

    @MainActor
    func testFlushWithoutAnEditorOrBeforeThePageMountedCountsAsSaved() async {
        let bridge = makeBridge()
        let none = await bridge.flush()
        XCTAssertEqual(none, FlushResult(true))

        let editor = NotesTestEditor()
        editor.mounted = false
        bridge.attach(editor)
        let unmounted = await bridge.flush()
        XCTAssertEqual(unmounted, FlushResult(true))
    }

    @MainActor
    func testAnAnswerForAnotherRequestDoesNotFinishTheFlushAndTheTimeoutFailsIt() async {
        let timer = Timer()
        let editor = NotesTestEditor()
        let bridge = makeBridge(timer)
        bridge.attach(editor)
        let result = Task { await bridge.flush() }
        await notesSettle()
        bridge.postMessage(#"{"type":"flushed","requestId":"other","ok":true}"#)
        await notesSettle()
        XCTAssertEqual(editor.calls, ["flush:r1"])

        // 15 秒没结果：算失败（留在笔记里）。
        timer.fire()
        let flushed = await result.value
        XCTAssertEqual(flushed, FlushResult(false))
        XCTAssertEqual(timer.requested, [.seconds(15)])

        // 迟到的回答没人等了，不出错。
        bridge.postMessage(#"{"type":"flushed","requestId":"r1","ok":true}"#)
    }

    @MainActor
    func testReleasingTheEditorFailsThePendingFlush() async {
        let editor = NotesTestEditor()
        let bridge = makeBridge()
        bridge.attach(editor)
        let result = Task { await bridge.flush() }
        await notesSettle()

        // 别的（旧的）WebView 销毁不影响现在这个。
        bridge.release(NotesTestEditor())
        XCTAssertTrue(bridge.editor === editor)

        bridge.release(editor)
        let flushed = await result.value
        XCTAssertEqual(flushed, FlushResult(false))
        XCTAssertNil(bridge.editor)
    }

    @MainActor
    func testAnEditorDestroyedWhileTheScriptRunsFailsTheFlush() async {
        let editor = NotesTestEditor()
        editor.flushGate = NoteDeferred<Bool>()
        let bridge = makeBridge()
        bridge.attach(editor)
        let result = Task { await bridge.flush() }
        await notesSettle()
        bridge.release(editor)
        editor.flushGate?.complete(false)
        let flushed = await result.value
        XCTAssertEqual(flushed, FlushResult(false))
    }

    // ---- 消息 ----

    @MainActor
    func testMessagesAreForwardedAndReadyPushesTheLanguage() async {
        let messages = NotesTestBox<[EmbedMessage]>([])
        let editor = NotesTestEditor()
        let bridge = makeBridge(messages: messages)
        bridge.attach(editor)
        bridge.postMessage(#"{"type":"ready","page":{"id":"p1","title":"Bio","icon":null}}"#)
        bridge.postMessage(#"{"type":"saveState","state":"saving"}"#)
        bridge.postMessage(#"{"type":"something-new"}"#)
        bridge.postMessage("not json")
        XCTAssertEqual(messages.value, [.ready(id: "p1", title: "Bio", icon: nil), .saveState(state: "saving")])
        XCTAssertEqual(editor.calls, ["lang:ja"])
    }

    @MainActor
    func testCallsReachTheAttachedEditor() async {
        let editor = NotesTestEditor()
        let bridge = makeBridge()
        // 还没有 WebView：什么都不做。
        bridge.openHistory()
        bridge.attach(editor)
        bridge.openHistory()
        bridge.pageUpdated(#"{"id":"p1"}"#)
        bridge.pushAppIcon(nil)
        bridge.pushAppIcon("character:piko")
        bridge.pushLanguage("zh-Hant")
        XCTAssertEqual(editor.calls, ["history", #"updated:{"id":"p1"}"#, "icon:null", "icon:character:piko", "lang:zh-Hant"])
    }

    @MainActor
    func testTheViewModelSavesThroughTheRegisteredBridgeAndPushesPageSettings() async throws {
        let backend = NotesTestBackend()
        let vm = NotesViewModel(backend: backend)
        vm.setWorkspace(.notes)
        await notesSettle()
        vm.openNote("a")
        await notesSettle()

        let editor = NotesTestEditor()
        let bridge = NoteEmbedBridge(sleep: { _ in try await Task.sleep(for: .seconds(3600)) }) { vm.onEditorMessage("a", $0) }
        bridge.attach(editor)
        vm.registerEditor(bridge)
        editor.onFlush = { id in bridge.postMessage(#"{"type":"flushed","requestId":"\#(id)","ok":false,"kept":true}"#) }

        bridge.postMessage(#"{"type":"meta","title":"Cells","icon":"🦠"}"#)
        XCTAssertEqual(vm.state.open, OpenNote("a", "Cells", "🦠"))

        // 草稿留在 WebView 里：第一次提示并留下，第二次放行。
        vm.closeNote()
        await notesSettle()
        XCTAssertEqual(vm.state.notice?.kind, .unsavedDraft)
        XCTAssertEqual(vm.state.open?.id, "a")

        let updated = await vm.updateSettings("a", NotePageSettings(locked: true))
        XCTAssertTrue(updated)
        let pushed = try XCTUnwrap(editor.calls.last { $0.hasPrefix("settings:") })
        let json = try XCTUnwrap(JSONValue.parse(String(pushed.dropFirst("settings:".count))))
        XCTAssertEqual(json["id"], "a")
        XCTAssertEqual(json["locked"], true)

        vm.closeNote()
        await notesSettle()
        XCTAssertNil(vm.state.open)

        // 编辑器关掉后不再经它保存。
        vm.registerEditor(nil)
        XCTAssertNil(vm.flushEditor)
        XCTAssertNil(vm.pushPageSettings)
    }

    // ---- 脚本 ----

    func testScriptsMatchTheAndroidOnes() {
        XCTAssertEqual(
            NoteEmbedScripts.flush("r1"),
            #"(function(){var e=window.notefableEmbed;if(e&&typeof e.flush==='function'){e.flush("r1");return true}return false})()"#
        )
        XCTAssertEqual(
            NoteEmbedScripts.pageUpdated(#"{"id":"p1","title":"a\"b"}"#),
            #"(function(){var e=window.notefableEmbed;if(e&&typeof e.pageUpdated==='function')e.pageUpdated("{\"id\":\"p1\",\"title\":\"a\\\"b\"}")})()"#
        )
        XCTAssertEqual(
            NoteEmbedScripts.pageSettings(#"{"id":"p1"}"#),
            #"(function(){var e=window.notefableEmbed;if(e&&typeof e.pageSettings==='function')e.pageSettings("{\"id\":\"p1\"}")})()"#
        )
        XCTAssertEqual(
            NoteEmbedScripts.appIcon(nil),
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.appIcon==='function')e.appIcon(null)})()"
        )
        XCTAssertEqual(
            NoteEmbedScripts.appIcon("character:piko"),
            #"(function(){var e=window.notefableEmbed;if(e&&typeof e.appIcon==='function')e.appIcon("character:piko")})()"#
        )
        XCTAssertEqual(
            NoteEmbedScripts.language("zh-Hant"),
            #"(function(){var e=window.notefableEmbed;if(e&&typeof e.language==='function')e.language("zh-Hant")})()"#
        )
    }

    func testQuoteEscapesLikeJsonObjectQuote() {
        XCTAssertEqual(NoteEmbedScripts.quote("a\"b\\c"), #""a\"b\\c""#)
        XCTAssertEqual(NoteEmbedScripts.quote("line\nbreak\ttab\r"), #""line\nbreak\ttab\r""#)
        XCTAssertEqual(NoteEmbedScripts.quote("</script> a/b"), #""<\/script> a/b""#)
        XCTAssertEqual(NoteEmbedScripts.quote("\u{01}\u{2028}\u{2029}"), "\"\\u0001\\u" + "2028\\u" + "2029\"")
        XCTAssertEqual(NoteEmbedScripts.quote("笔记 🧬"), "\"笔记 🧬\"")
    }

    func testBootstrapDefinesTheNativeHostWithTheIconAndLanguage() {
        let script = NoteEmbedScripts.bootstrap(handler: "notefable", appIcon: nil, language: "ja")
        XCTAssertTrue(script.contains(#"var icon="",lang="ja""#))
        XCTAssertTrue(script.contains(#"window.webkit.messageHandlers["notefable"].postMessage(String(json))"#))
        XCTAssertTrue(script.contains("appIcon:function(){return icon}"))
        XCTAssertTrue(script.contains("language:function(){return lang}"))
        XCTAssertTrue(NoteEmbedScripts.bootstrap(handler: "h", appIcon: "character:piko", language: "en").contains(#"var icon="character:piko""#))
    }

    // ---- 拖动 ----

    func testDragStateFindsTheTargetUnderTheFingerAndScrollsNearTheEdges() {
        var drag = DragState()
        drag.listBounds = CGRect(x: 0, y: 100, width: 240, height: 400)
        drag.rows = [
            "a": CGRect(x: 0, y: 100, width: 240, height: 44),
            "b": CGRect(x: 0, y: 144, width: 240, height: 44),
            "c": CGRect(x: 0, y: 188, width: 240, height: 44),
        ]
        drag.zones = ["g1": CGRect(x: 0, y: 300, width: 240, height: 44), " ": CGRect(x: 0, y: 350, width: 240, height: 30)]

        // 没在拖：只记位置。
        drag.update(CGPoint(x: 10, y: 150))
        XCTAssertNil(drag.target)

        drag.start("a", at: CGPoint(x: 10, y: 110))
        // 自己那一行不算目标。
        XCTAssertNil(drag.target)
        XCTAssertEqual(drag.dragging, "a")

        // 行的上半是前面，下半是后面。
        XCTAssertEqual(drag.move(CGPoint(x: 10, y: 150)), 0)
        XCTAssertEqual(drag.target, .row(id: "b", after: false))
        XCTAssertTrue(drag.dropLine("b").before)
        XCTAssertFalse(drag.dropLine("b").after)
        XCTAssertFalse(drag.dropLine("c").before)
        _ = drag.move(CGPoint(x: 10, y: 180))
        XCTAssertEqual(drag.target, .row(id: "b", after: true))
        XCTAssertTrue(drag.dropLine("b").after)

        // 投放区：项目，空白键是"无项目"；只高亮手指下的那个。
        _ = drag.move(CGPoint(x: 10, y: 310))
        XCTAssertEqual(drag.target, .into(containerId: "g1"))
        XCTAssertTrue(drag.isDropZoneActive("g1"))
        XCTAssertFalse(drag.isDropZoneActive(" "))
        _ = drag.move(CGPoint(x: 10, y: 360))
        XCTAssertEqual(drag.target, .into(containerId: nil))
        XCTAssertEqual(drag.targetZone, " ")

        // 列表上下边 30 以内每次移动滚 12。
        XCTAssertEqual(drag.move(CGPoint(x: 10, y: 120)), -12)
        XCTAssertEqual(drag.move(CGPoint(x: 10, y: 480)), 12)
        XCTAssertNil(drag.target)

        drag.clear()
        XCTAssertNil(drag.dragging)
        XCTAssertNil(drag.targetZone)
        XCTAssertFalse(drag.isDropZoneActive("g1"))
        XCTAssertEqual(drag.rows.count, 3)
    }

    func testRowsThatAreBusyCannotBeDragged() {
        var state = NotesUiState()
        XCTAssertFalse(noteReorderLocked(state, pageId: "a"))
        state.moveBusy = ["a"]
        XCTAssertTrue(noteReorderLocked(state, pageId: "a"))
        XCTAssertFalse(noteReorderLocked(state, pageId: "b"))
        state.busy = true
        XCTAssertTrue(noteReorderLocked(state, pageId: "b"))
    }

    // ---- 文案和列表规则 ----

    func testErrorTextsUseTheServerSentenceOrTheWebCopy() {
        let system = SystemText(templates: [], messages: ["ja": ["Item not found.": "項目が見つかりません。"]]).translator("ja")
        XCTAssertEqual(notesErrorText(NotesError(.trash, "Item not found."), system), "項目が見つかりません。")
        // 没有资源时 L() 返回键本身。
        XCTAssertEqual(notesErrorText(NotesError(.load), system), "err_load_notes")
        XCTAssertEqual(notesErrorText(NotesError(.create), system), "err_create_note")
        XCTAssertEqual(notesErrorText(NotesError(.trash), system), "err_trash_note")
        XCTAssertEqual(notesErrorText(NotesError(.trashUnsaved), system), "err_trash_unsaved")
        XCTAssertEqual(notesErrorText(NotesError(.group), system), "err_group")
        XCTAssertEqual(notesErrorText(NotesError(.trashLoad), system), "err_trash_load")
        XCTAssertEqual(notesErrorText(NotesError(.trashAction), system), "err_trash_request")
        XCTAssertEqual(notesErrorText(NotesError(.unsavedDraft), system), "err_save_draft")

        XCTAssertEqual(reorderFailureText(ReorderFailure("a", wait: true), system), "sb_err_wait_move")
        XCTAssertEqual(reorderFailureText(ReorderFailure("a", "Item not found."), system), "項目が見つかりません。")
        XCTAssertEqual(reorderFailureText(ReorderFailure("a"), system), "sb_err_move_item")
    }

    func testSaveStateText() {
        XCTAssertEqual(noteSaveStateText("saved"), "save_saved")
        XCTAssertEqual(noteSaveStateText("saving"), "save_saving")
        XCTAssertEqual(noteSaveStateText("unsaved"), "save_saving")
        XCTAssertEqual(noteSaveStateText("error"), "save_not_saved")
        XCTAssertEqual(noteSaveStateText("conflict"), "save_conflict")
        XCTAssertEqual(noteSaveStateText(nil), "")
        XCTAssertEqual(noteSaveStateText("later"), "")
        XCTAssertTrue(noteSaveStateIsWarning("error"))
        XCTAssertTrue(noteSaveStateIsWarning("conflict"))
        XCTAssertFalse(noteSaveStateIsWarning("saving"))
        XCTAssertFalse(noteSaveStateIsWarning(nil))
    }

    func testTrashTimeLabelRoundsElapsedDaysDownAndRemainingDaysUp() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-17T12:00:00Z"))
        func label(_ deletedAt: String, _ purgeAt: String) -> String {
            trashTimeLabel(NoteTrashItem(id: "t", deletedAt: deletedAt, purgeAt: purgeAt), now: now)
        }
        XCTAssertEqual(label("2026-11-17T01:00:00Z", "2026-12-17T01:00:00Z"), "deleted_today · days_left")
        XCTAssertEqual(label("2026-11-16T01:00:00.000Z", "2026-12-16T01:00:00.000Z"), "deleted_one_day · days_left")
        XCTAssertEqual(label("2026-11-14T13:00:00Z", "2026-11-18T11:00:00Z"), "deleted_days · one_day_left")
        XCTAssertEqual(label("2026-10-18T11:00:00Z", "2026-11-17T11:00:00Z"), "deleted_days · removing_soon")
        // 读不出时间：当成现在。
        XCTAssertEqual(label("?", "?"), "deleted_today · removing_soon")
    }

    func testShortDateFollowsTheUiLanguage() {
        let utc = TimeZone(identifier: "UTC") ?? .current
        XCTAssertEqual(noteShortDate("2026-11-14T00:00:01Z", uiLocale: "en", timeZone: utc), "Nov 14")
        XCTAssertEqual(noteShortDate("2026-11-14T00:00:01.250Z", uiLocale: "ja", timeZone: utc), "11月14日")
        XCTAssertEqual(noteShortDate("2026-11-14T00:00:01Z", uiLocale: "zh", timeZone: utc), "11月14日")
        // 时区：按设备所在地的日期。
        XCTAssertEqual(noteShortDate("2026-11-14T20:00:00Z", uiLocale: "en", timeZone: TimeZone(identifier: "Asia/Tokyo") ?? utc), "Nov 15")
        XCTAssertEqual(noteShortDate("", uiLocale: "en", timeZone: utc), "")
    }

    func testMoveTargetsFollowTheTreeAndLeaveOutThePageAndItsDescendants() {
        var state = NotesUiState()
        state.pages = [
            NotePageSummary(id: "a", title: "Biology"),
            NotePageSummary(id: "b", title: "Cells", parentId: "a"),
            NotePageSummary(id: "c", title: "Mitosis", parentId: "b"),
            NotePageSummary(id: "d", title: "Japanese"),
            NotePageSummary(id: "e", title: "Verbs", groupId: "g1", parentId: "d"),
        ]
        let targets = noteMoveTargets(state, moving: "b")
        XCTAssertEqual(targets.map(\.id), ["a", "d", "e"])
        XCTAssertEqual(targets.map(\.depth), [0, 0, 1])
        XCTAssertEqual(noteMoveTargets(state, moving: "d").map(\.depth), [0, 1, 2])

        // 筛选时平铺、不分大小写。
        let filtered = filterNoteMoveTargets(targets, " VERB ")
        XCTAssertEqual(filtered.map(\.id), ["e"])
        XCTAssertEqual(filtered.map(\.depth), [0])
        XCTAssertEqual(filterNoteMoveTargets(targets, "  "), targets)
        XCTAssertTrue(filterNoteMoveTargets(targets, "none").isEmpty)

        // 子页面不在任何项目的最上层：项目都不打勾。
        XCTAssertTrue(noteMoveGroupChecked(state.pages[0], groupId: nil))
        XCTAssertFalse(noteMoveGroupChecked(state.pages[4], groupId: "g1"))
        XCTAssertTrue(noteMoveGroupChecked(NotePageSummary(id: "f", groupId: "g1"), groupId: "g1"))
    }

    func testPageMenuOptions() {
        var page = NotePageSummary(id: "a", smallText: true)
        XCTAssertEqual(NotePageFontOption.all.map(\.key), ["default", "serif", "mono"])
        XCTAssertTrue(NotePageToggle.smallText.isOn(page))
        XCTAssertEqual(NotePageToggle.smallText.toggled(page), NotePageSettings(smallText: false))
        XCTAssertEqual(NotePageToggle.fullWidth.toggled(page), NotePageSettings(fullWidth: true))
        XCTAssertEqual(NotePageToggle.locked.toggled(page), NotePageSettings(locked: true))
        XCTAssertEqual(notePageFavoriteLabel(page), "pg_add_to_favorites")
        page.favoritedAt = "2026-11-16T00:00:00Z"
        XCTAssertEqual(notePageFavoriteLabel(page), "pg_remove_from_favorites")
    }

    func testPrefsInUserDefaultsSurviveANewInstance() throws {
        let suite = "notefable.notes.tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let prefs = UserDefaultsNotesPrefs(defaults: defaults)
        XCTAssertTrue(prefs.collapsedGroups.isEmpty)
        prefs.collapsedGroups = ["g1", "g2"]
        prefs.expandedPages = ["a"]
        let again = UserDefaultsNotesPrefs(defaults: defaults)
        XCTAssertEqual(again.collapsedGroups, ["g1", "g2"])
        XCTAssertEqual(again.expandedPages, ["a"])
    }
}
