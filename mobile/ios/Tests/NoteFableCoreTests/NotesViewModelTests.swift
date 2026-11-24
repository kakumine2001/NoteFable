import Foundation
import XCTest
@testable import NoteFableCore

/// Android `NotesViewModelTest` 的移植。
final class NotesViewModelTests: XCTestCase {
    @MainActor
    private func notesVm(_ backend: NotesTestBackend? = nil, prefs: NotesPrefs = MemoryNotesPrefs()) async -> NotesViewModel {
        let vm = NotesViewModel(backend: backend ?? NotesTestBackend(), prefs: prefs)
        vm.setWorkspace(.notes)
        await notesSettle()
        return vm
    }

    @MainActor
    private func page(_ vm: NotesViewModel, _ id: String) -> NotePageSummary? {
        vm.state.pages.first { $0.id == id }
    }

    @MainActor
    func testSwitchingToNotesLoadsPagesAndGroupsAndSplitsLooseNotes() async {
        let vm = await notesVm()
        let state = vm.state
        XCTAssertEqual(state.workspace, .notes)
        XCTAssertTrue(state.loaded)
        XCTAssertFalse(state.loading)
        XCTAssertEqual(state.members("g1").map(\.id), ["a"])
        XCTAssertEqual(state.loosePages.map(\.id), ["b"])
    }

    @MainActor
    func testNotesInAGroupThatNoLongerExistsCountAsLoose() async {
        let backend = NotesTestBackend()
        backend.groups.removeAll()
        let vm = await notesVm(backend)
        XCTAssertEqual(vm.state.loosePages.map(\.id), ["a", "b"])
        XCTAssertEqual(vm.state.looseCount, 2)
    }

    @MainActor
    func testLoadFailureKeepsTheServerMessage() async {
        let backend = NotesTestBackend()
        backend.failNext = ApiException(status: 503, message: "Database is unavailable.")
        let vm = await notesVm(backend)
        XCTAssertEqual(vm.state.error, NotesError(.load, "Database is unavailable."))
        XCTAssertFalse(vm.state.loaded)
    }

    @MainActor
    func testNetworkFailureFallsBackToTheWebCopy() async {
        let backend = NotesTestBackend()
        backend.failNext = NotesTestIOError()
        let vm = await notesVm(backend)
        XCTAssertEqual(vm.state.error, NotesError(.load, nil))
        // 读不到错误文的服务端错误（"HTTP 500"）也不当原句显示。
        backend.failNext = ApiException(status: 500, message: "HTTP 500")
        vm.refresh()
        await notesSettle()
        XCTAssertEqual(vm.state.error, NotesError(.load, nil))
    }

    @MainActor
    func testCreatingANoteOpensIt() async {
        let vm = await notesVm()
        vm.createNote()
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "new")
        XCTAssertEqual(vm.state.pages.first?.id, "new")
        XCTAssertFalse(vm.state.busy)
    }

    @MainActor
    func testCreateFailureShowsTheErrorAndStaysOnTheList() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        backend.failNext = ApiException(status: 400, message: "You can have at most 1000 notes.")
        vm.createNote()
        await notesSettle()
        XCTAssertNil(vm.state.open)
        XCTAssertFalse(vm.state.busy)
        XCTAssertEqual(vm.state.error, NotesError(.create, "You can have at most 1000 notes."))
    }

    @MainActor
    func testLeavingANoteWaitsForTheEditorToSave() async {
        let vm = await notesVm()
        vm.openNote("a")
        await notesSettle()
        var flushes = 0
        vm.flushEditor = {
            flushes += 1
            return FlushResult(true)
        }
        vm.closeNote()
        await notesSettle()
        XCTAssertEqual(flushes, 1)
        XCTAssertNil(vm.state.open)
    }

    @MainActor
    func testAnUnsavedDraftKeepsTheNoteOpenAndShowsTheNotice() async {
        let vm = await notesVm()
        vm.openNote("a")
        await notesSettle()
        vm.flushEditor = { FlushResult(false) }
        vm.openNote("b")
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "a")
        XCTAssertEqual(vm.state.notice?.kind, .unsavedDraft)

        vm.setWorkspace(.chat)
        await notesSettle()
        XCTAssertEqual(vm.state.workspace, .notes)

        vm.flushEditor = { throw NotesTestIOError() }
        vm.closeNote()
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "a")

        vm.dismissNotice()
        XCTAssertNil(vm.state.notice)
    }

    @MainActor
    func testSwitchingToChatAfterSavingClosesTheNote() async {
        let vm = await notesVm()
        vm.openNote("b")
        await notesSettle()
        vm.flushEditor = { FlushResult(true) }
        vm.setWorkspace(.chat)
        await notesSettle()
        XCTAssertEqual(vm.state.workspace, .chat)
        XCTAssertNil(vm.state.open)
    }

    @MainActor
    func testSetWorkspaceRunsItsContinuationOnlyAfterActuallySwitching() async {
        let vm = await notesVm()
        var ran = 0
        // 已在目标工作区：立即执行。
        vm.setWorkspace(vm.state.workspace) { ran += 1 }
        XCTAssertEqual(ran, 1)

        vm.openNote("a")
        await notesSettle()
        vm.flushEditor = { FlushResult(false) }
        vm.setWorkspace(.chat) { ran += 1 }
        await notesSettle()
        XCTAssertEqual(vm.state.workspace, .notes)
        XCTAssertEqual(ran, 1)

        vm.flushEditor = { FlushResult(true) }
        vm.setWorkspace(.chat) { ran += 1 }
        await notesSettle()
        XCTAssertEqual(vm.state.workspace, .chat)
        XCTAssertEqual(ran, 2)
    }

    @MainActor
    func testEditorMetaUpdatesTheOpenNoteAndTheListLive() async {
        let vm = await notesVm()
        vm.openNote("b")
        await notesSettle()
        vm.onEditorMessage("b", .meta(title: "動詞", icon: "📘"))
        vm.onEditorMessage("b", .saveState(state: "saving"))
        XCTAssertEqual(vm.state.open, OpenNote("b", "動詞", "📘"))
        XCTAssertEqual(vm.state.pages.first { $0.id == "b" }?.title, "動詞")
        XCTAssertEqual(vm.state.saveState, "saving")

        // 别的笔记发来的状态不算。
        vm.onEditorSaveState("a", "error")
        XCTAssertEqual(vm.state.saveState, "saving")
    }

    @MainActor
    func testMissingPageClosesTheEditorWithoutFlushingAndRefreshes() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        vm.openNote("a")
        await notesSettle()
        vm.flushEditor = {
            XCTFail("must not flush a missing page")
            return FlushResult(false)
        }
        backend.calls.removeAll()
        vm.onEditorMessage("a", .missing)
        await notesSettle()
        XCTAssertNil(vm.state.open)
        XCTAssertEqual(backend.calls, ["notes"])
    }

    @MainActor
    func testTheEditorMovingItsNoteToTheTrashRemovesItFromTheList() async {
        let vm = await notesVm()
        vm.openNote("a")
        await notesSettle()
        vm.onEditorSaveState("a", "saved")
        vm.onEditorMessage("a", .trashed)
        XCTAssertNil(vm.state.open)
        XCTAssertNil(vm.state.saveState)
        XCTAssertEqual(vm.state.pages.map(\.id), ["b"])
    }

    @MainActor
    func testPagesTrashedFromAProposalCardLeaveTheListAndCloseTheOpenOne() async {
        let vm = await notesVm()
        vm.openNote("a")
        await notesSettle()
        vm.flushEditor = {
            XCTFail("the page is already in the trash: nothing to save")
            return FlushResult(false)
        }
        vm.onEditorSaveState("a", "saved")
        // 聊天里撤销了 AI 新建的页面：建的那篇和它的子页面一起进了回收站（子页面可能不在列表里）。
        vm.onPagesTrashed(["a", "child"])
        XCTAssertNil(vm.state.open)
        XCTAssertNil(vm.state.saveState)
        XCTAssertEqual(vm.state.pages.map(\.id), ["b"])
        // 别的页面开着时不关；没有页面时什么也不变。
        vm.openNote("b")
        await notesSettle()
        vm.onPagesTrashed(["gone"])
        vm.onPagesTrashed([])
        XCTAssertEqual(vm.state.open?.id, "b")
        XCTAssertEqual(vm.state.pages.map(\.id), ["b"])
    }

    @MainActor
    func testTrashingTheOpenNoteSavesItFirstAndRefusesWhenItCannot() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        vm.openNote("a")
        await notesSettle()
        vm.flushEditor = { FlushResult(false) }
        let refused = await vm.trashNote("a")
        XCTAssertFalse(refused)
        XCTAssertEqual(vm.state.error?.kind, .trashUnsaved)
        XCTAssertFalse(backend.calls.contains("trash:a"))
        XCTAssertFalse(vm.state.busy)

        vm.flushEditor = { FlushResult(true) }
        let trashed = await vm.trashNote("a")
        XCTAssertTrue(trashed)
        XCTAssertNil(vm.state.open)
        XCTAssertEqual(vm.state.pages.map(\.id), ["b"])
    }

    @MainActor
    func testGroupActionsUpdateTheListAndReportFailuresWithoutChangingIt() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)

        let created = await vm.createGroup("Language")
        XCTAssertEqual(created?.id, "g2")
        let moved = await vm.moveNote("b", groupId: "g2")
        XCTAssertTrue(moved)
        XCTAssertEqual(vm.state.members("g2").map(\.id), ["b"])
        let renamed = await vm.renameGroup("g2", name: "Japanese")
        XCTAssertTrue(renamed)
        XCTAssertEqual(vm.state.groups.last?.name, "Japanese")

        backend.failNext = ApiException(status: 400, message: "You can have at most 30 groups.")
        let tooMany = await vm.createGroup("Too many")
        XCTAssertNil(tooMany)
        XCTAssertEqual(vm.state.groupError?.detail, "You can have at most 30 groups.")
        XCTAssertEqual(vm.state.groups.count, 2)

        let deleted = await vm.deleteGroup("g1")
        XCTAssertTrue(deleted)
        XCTAssertNil(vm.state.groupError)
        let a = page(vm, "a")
        XCTAssertNotNil(a)
        XCTAssertNil(a?.groupId)

        backend.failNext = NotesTestIOError()
        let failed = await vm.deleteGroup("g2")
        XCTAssertFalse(failed)
        XCTAssertEqual(vm.state.groupError, NotesError(.group))
        vm.clearGroupError()
        XCTAssertNil(vm.state.groupError)
    }

    @MainActor
    func testCollapsedGroupsAreRemembered() async {
        let prefs = MemoryNotesPrefs()
        let vm = await notesVm(prefs: prefs)
        vm.toggleGroup("g1")
        XCTAssertEqual(prefs.collapsedGroups, ["g1"])
        XCTAssertEqual(NotesViewModel(backend: NotesTestBackend(), prefs: prefs).state.collapsed, ["g1"])
        vm.toggleGroup("g1")
        XCTAssertTrue(prefs.collapsedGroups.isEmpty)
    }

    @MainActor
    func testTrashRestoreDeleteForeverAndEmptyUseTheServerContract() async {
        let backend = NotesTestBackend()
        backend.trashed.insert(
            NoteTrashItem(id: "t2", title: "Newer", icon: nil, deletedAt: "2026-11-14T05:00:00Z", purgeAt: "2026-12-14T05:00:00Z"), at: 0
        )
        let vm = await notesVm(backend)
        vm.openTrash()
        XCTAssertNil(vm.state.trash?.items)
        await notesSettle()
        XCTAssertEqual(vm.state.trash?.items?.map(\.id), ["t2", "t"])

        vm.restore("t")
        await notesSettle()
        XCTAssertEqual(vm.state.trash?.items?.map(\.id), ["t2"])
        XCTAssertTrue(vm.state.pages.contains { $0.id == "t" })
        XCTAssertEqual(vm.state.trash?.busy, false)

        vm.confirmDeleteForever("t2")
        XCTAssertEqual(vm.state.trash?.confirmId, "t2")
        vm.deleteForever("t2")
        await notesSettle()
        XCTAssertNil(vm.state.trash?.confirmId)
        XCTAssertEqual(vm.state.trash?.items, [])

        vm.closeTrash()
        XCTAssertNil(vm.state.trash)
        vm.openTrash()
        await notesSettle()
        vm.confirmEmptyTrash(true)
        XCTAssertEqual(vm.state.trash?.confirmAll, true)
        vm.emptyTrash()
        await notesSettle()
        XCTAssertTrue(backend.calls.contains("empty:2026-11-14T05:00:00Z"))
        XCTAssertEqual(vm.state.trash?.items, [])
        XCTAssertEqual(vm.state.trash?.confirmAll, false)
    }

    @MainActor
    func testTrashLoadFailureCanBeRetried() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        backend.failNext = NotesTestIOError()
        vm.openTrash()
        await notesSettle()
        XCTAssertEqual(vm.state.trash?.loadError?.kind, .trashLoad)
        vm.loadTrash()
        await notesSettle()
        XCTAssertNil(vm.state.trash?.loadError)
        XCTAssertEqual(vm.state.trash?.items?.count, 1)
    }

    @MainActor
    func testAFailedTrashActionShowsTheErrorAndOnlyOneRunsAtATime() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        vm.openTrash()
        await notesSettle()
        let gate = NoteDeferred<Bool>()
        backend.holds["restore"] = gate
        vm.restore("t")
        vm.deleteForever("t")
        await notesSettle()
        // 上一个操作没完：第二个不发。
        XCTAssertFalse(backend.calls.contains("forever:t"))
        gate.complete(true)
        await notesSettle()

        backend.trashed = [NoteTrashItem(id: "u", title: "", icon: nil, deletedAt: "2026-11-14T00:00:00Z", purgeAt: "2026-12-14T00:00:00Z")]
        vm.loadTrash()
        await notesSettle()
        backend.failNext = ApiException(status: 404, message: "Note not found.")
        vm.deleteForever("u")
        await notesSettle()
        XCTAssertEqual(vm.state.trash?.error, NotesError(.trashAction, "Note not found."))
        XCTAssertEqual(vm.state.trash?.busy, false)
        XCTAssertEqual(vm.state.trash?.items?.map(\.id), ["u"])
    }

    @MainActor
    func testAKeptDraftLetsTheUserLeaveOnTheSecondTryButAConflictDoesNot() async {
        let vm = await notesVm()
        vm.openNote("a")
        await notesSettle()
        vm.flushEditor = { FlushResult(false, draftKept: true) }
        vm.setWorkspace(.chat)
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "a")
        XCTAssertEqual(vm.state.notice?.kind, .unsavedDraft)
        vm.setWorkspace(.chat)
        await notesSettle()
        XCTAssertEqual(vm.state.workspace, .chat)
        XCTAssertNil(vm.state.open)

        vm.setWorkspace(.notes)
        await notesSettle()
        vm.openNote("a")
        await notesSettle()
        vm.flushEditor = { FlushResult(false) }
        vm.closeNote()
        await notesSettle()
        vm.closeNote()
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "a")
    }

    @MainActor
    func testLeavingGoesAheadWhenTheEditorClosedItselfWhileSaving() async {
        let vm = await notesVm()
        vm.openNote("a")
        await notesSettle()
        vm.flushEditor = {
            vm.onEditorMissing("a")
            return FlushResult(false)
        }
        vm.openNote("b")
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "b")
    }

    @MainActor
    func testOnlyOneNavigationRunsAtATime() async {
        let vm = await notesVm()
        vm.openNote("a")
        await notesSettle()
        let gate = NoteDeferred<FlushResult>()
        var flushes = 0
        vm.flushEditor = {
            flushes += 1
            return await gate.wait()
        }
        vm.openNote("b")
        await notesSettle()
        // 还在保存：连点的第二次不叠加。
        vm.closeNote()
        vm.setWorkspace(.chat)
        await notesSettle()
        XCTAssertEqual(flushes, 1)
        gate.complete(FlushResult(true))
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "b")
        XCTAssertEqual(vm.state.workspace, .notes)
    }

    @MainActor
    func testReadyWithAnotherPageIdFollowsTheSavedCopyWithoutTouchingTheOriginal() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        vm.openNote("a")
        await notesSettle()
        let originalTitle = vm.state.pages.first { $0.id == "a" }?.title
        backend.pages.append(NotePageSummary(id: "copy", title: "A (copy)", icon: nil, createdAt: "2026-11-16T00:00:00Z"))
        vm.onEditorMessage("a", .ready(id: "copy", title: "A (copy)", icon: nil))
        XCTAssertEqual(vm.state.open, OpenNote("copy", "A (copy)", nil, editor: "a"))
        XCTAssertEqual(vm.state.pages.first { $0.id == "a" }?.title, originalTitle)

        // 之后同一个编辑器发来的消息都算到副本上。
        vm.onEditorMeta("a", title: "Renamed copy", icon: nil)
        vm.onEditorSaveState("a", "saved")
        await notesSettle()
        XCTAssertEqual(vm.state.open?.title, "Renamed copy")
        XCTAssertEqual(vm.state.pages.first { $0.id == "a" }?.title, originalTitle)
        XCTAssertTrue(vm.state.pages.contains { $0.id == "copy" })
        XCTAssertEqual(vm.state.saveState, "saved")

        // 打开原来那篇不再被当成"已经开着"，而且换一个 editor：编辑器重新加载，不再显示副本（和 Android 一样）。
        vm.flushEditor = { FlushResult(true) }
        vm.openNote("a", reveal: "block-1")
        await notesSettle()
        let reopened = vm.state.open
        XCTAssertEqual(reopened?.id, "a")
        XCTAssertEqual(reopened?.title, originalTitle ?? "")
        XCTAssertEqual(reopened?.reveal, "block-1")
        XCTAssertNotEqual(reopened?.editor, "a")
        XCTAssertTrue(reopened?.editor.hasPrefix("a#") ?? false)
    }

    @MainActor
    func testTheOpenPageTakesItsKindFromTheListASearchResultOrTheEditor() async {
        let backend = NotesTestBackend()
        backend.pages.append(NotePageSummary(id: "w", title: "Board", icon: nil, createdAt: "2026-11-13T00:00:00Z", kind: .whiteboard))
        let vm = await notesVm(backend)
        vm.flushEditor = { FlushResult(true) }
        vm.openNote("w")
        await notesSettle()
        XCTAssertEqual(vm.state.open, OpenNote("w", "Board", nil, kind: .whiteboard))

        // 列表里没有（检索结果，列表可能还没读过）：用结果带的类型。
        vm.openNote("s", title: "Deck", icon: nil, kind: .slides)
        await notesSettle()
        XCTAssertEqual(vm.state.open, OpenNote("s", "Deck", nil, kind: .slides))
        // 网页的 ready 不带类型（旧网页）时保留已知的；带着时以它为准。
        vm.onEditorMessage("s", .ready(id: "s", title: "Deck", icon: nil))
        XCTAssertEqual(vm.state.open?.kind, .slides)
        vm.onEditorMessage("s", .ready(id: "s", title: "Deck", icon: nil, kind: .whiteboard))
        XCTAssertEqual(vm.state.open?.kind, .whiteboard)
        // 别的编辑器（已经换掉的 WebView）发来的不算。
        vm.onEditorMessage("other", .ready(id: "s", title: "Deck", icon: nil, kind: .slides))
        XCTAssertEqual(vm.state.open?.kind, .whiteboard)

        // 复制白板：打开的复制件也是白板。
        vm.openNote("w")
        await notesSettle()
        vm.duplicate("w")
        await notesSettle()
        XCTAssertEqual(vm.state.open, OpenNote("copy", "Copy (1)", nil, kind: .whiteboard))
    }

    @MainActor
    func testASearchHitOpensThePageWithTheBlockToRevealOnlyForThatOpen() async {
        let vm = await notesVm()
        vm.flushEditor = { FlushResult(true) }
        // 列表里有：标题、图标、类型取列表的，命中的块带着。
        vm.openNote("a", title: "Old title", icon: nil, kind: .note, reveal: "block-7")
        await notesSettle()
        XCTAssertEqual(vm.state.open, OpenNote("a", "Cell structure", "🧬", reveal: "block-7"))
        // 列表里没有（检索结果，列表可能还没读过）。
        vm.openNote("w", title: "Board", icon: nil, kind: .whiteboard, reveal: "element-1")
        await notesSettle()
        XCTAssertEqual(vm.state.open, OpenNote("w", "Board", nil, kind: .whiteboard, reveal: "element-1"))
        // 冲突后换到副本（不重新加载）、普通的打开都不再定位。
        vm.onEditorMessage("w", .ready(id: "w-copy", title: "Board (1)", icon: nil, kind: .whiteboard))
        XCTAssertEqual(vm.state.open, OpenNote("w-copy", "Board (1)", nil, editor: "w", kind: .whiteboard))
        await notesSettle()
        vm.openNote("b")
        await notesSettle()
        XCTAssertEqual(vm.state.open, OpenNote("b", "Japanese verbs", nil))
    }

    @MainActor
    func testTheReadyMessageCorrectsTheKindOfTheListEntryToo() async {
        // 旧服务端没返回类型的列表（仍是笔记）也按网页 ready 带来的类型改正；别的编辑器的 ready 不改。
        let backend = NotesTestBackend()
        backend.pages.append(NotePageSummary(id: "w", title: "Board", icon: nil, createdAt: "2026-11-13T00:00:00Z"))
        let vm = await notesVm(backend)
        vm.flushEditor = { FlushResult(true) }
        vm.openNote("w")
        await notesSettle()
        vm.onEditorMessage("other", .ready(id: "w", title: "Board", icon: nil, kind: .whiteboard))
        XCTAssertEqual(vm.state.pages.first { $0.id == "w" }?.kind, .note)
        vm.onEditorMessage("w", .ready(id: "w", title: "Board", icon: nil, kind: .whiteboard))
        XCTAssertEqual(vm.state.open?.kind, .whiteboard)
        XCTAssertEqual(vm.state.pages.first { $0.id == "w" }?.kind, .whiteboard)
    }

    @MainActor
    func testAPageOpenedFromALinkKeepsItsKindAndAConflictCopyKeepsItOrTakesTheEditors() async {
        let backend = NotesTestBackend()
        backend.pages.append(NotePageSummary(id: "s", title: "Deck", icon: nil, createdAt: "2026-11-13T00:00:00Z", kind: .slides))
        backend.pages.append(NotePageSummary(id: "old", title: "Board", icon: nil, createdAt: "2026-11-13T00:00:00Z"))
        let vm = await notesVm(backend)
        vm.flushEditor = { FlushResult(true) }
        // 点回答里的页面链接打开幻灯片：类型取列表的。
        vm.openNoteFromLink("s")
        await notesSettle()
        XCTAssertEqual(vm.state.open, OpenNote("s", "Deck", nil, kind: .slides))
        // 冲突后网页把内容另存成新页面（ready 的 id 变了）：旧网页不带类型时保留打开时的类型。
        vm.onEditorMessage("s", .ready(id: "s-copy", title: "Deck (1)", icon: nil))
        XCTAssertEqual(vm.state.open, OpenNote("s-copy", "Deck (1)", nil, editor: "s", kind: .slides))
        await notesSettle()
        // 带类型时以网页的为准（列表是旧服务端读的、仍是笔记时也一样）。
        vm.openNote("old")
        await notesSettle()
        vm.onEditorMessage("old", .ready(id: "old-copy", title: "Board (1)", icon: nil, kind: .whiteboard))
        XCTAssertEqual(vm.state.open, OpenNote("old-copy", "Board (1)", nil, editor: "old", kind: .whiteboard))
    }

    @MainActor
    func testIdentityChangeSavesTheOpenNoteFirstAndDropsAPendingNavigation() async {
        let vm = await notesVm()
        vm.openNote("a")
        await notesSettle()
        var flushes = 0
        vm.flushEditor = {
            flushes += 1
            return FlushResult(true)
        }
        await vm.flushBeforeIdentityChange()
        XCTAssertEqual(flushes, 1)

        let gate = NoteDeferred<FlushResult>()
        vm.flushEditor = { await gate.wait() }
        vm.openNote("b")
        await notesSettle()
        vm.onIdentityChanged()
        gate.complete(FlushResult(true))
        await notesSettle()
        XCTAssertNil(vm.state.open)

        // 作废的导航不挡住新身份下的操作。
        vm.flushEditor = nil
        vm.openNote("b")
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "b")
    }

    @MainActor
    func testIdentityChangeClearsTheOpenNoteAndReloads() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        vm.openNote("a")
        await notesSettle()
        backend.pages.removeAll()
        vm.onIdentityChanged()
        await notesSettle()
        XCTAssertNil(vm.state.open)
        XCTAssertTrue(vm.state.pages.isEmpty)
        XCTAssertEqual(vm.state.workspace, .notes)
    }

    @MainActor
    func testATrashRestoreThatFinishesAfterAnIdentityChangeIsDropped() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        vm.openTrash()
        await notesSettle()
        let gate = NoteDeferred<Bool>()
        backend.holds["restore"] = gate
        vm.restore("t")
        await notesSettle()
        XCTAssertEqual(vm.state.trash?.busy, true)

        vm.onIdentityChanged()
        await notesSettle()
        gate.complete(true)
        await notesSettle()
        XCTAssertNil(vm.state.trash)
        XCTAssertFalse(vm.state.pages.contains { $0.id == "t" })
    }

    @MainActor
    func testAProjectCreatedUnderTheOldIdentityIsNotAddedToTheNewOne() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let gate = NoteDeferred<Bool>()
        backend.holds["group"] = gate
        let created = Task { await vm.createGroup("Physics") }
        await notesSettle()

        vm.onIdentityChanged()
        await notesSettle()
        gate.complete(true)
        await notesSettle()

        let group = await created.value
        XCTAssertNil(group)
        XCTAssertEqual(vm.state.groups.map(\.id), ["g1"])
        XCTAssertNil(vm.state.groupError)
    }

    @MainActor
    func testANoteCreatedUnderTheOldIdentityIsNotOpenedInTheNewOne() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let gate = NoteDeferred<FlushResult>()
        vm.openNote("a")
        await notesSettle()
        vm.flushEditor = { await gate.wait() }
        vm.createNote()
        await notesSettle()
        vm.onIdentityChanged()
        gate.complete(FlushResult(true))
        await notesSettle()
        XCTAssertNil(vm.state.open)
        XCTAssertFalse(backend.calls.contains("create"))
        XCTAssertFalse(vm.state.busy)
    }

    @MainActor
    func testARefreshThatStartedBeforeANewNoteWasCreatedReadsTheListAgain() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let gate = NoteDeferred<Bool>()
        backend.holds["notes"] = gate
        vm.refresh()
        await notesSettle()

        vm.createNote()
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "new")

        gate.complete(true)
        await notesSettle()
        XCTAssertTrue(vm.state.pages.contains { $0.id == "new" })
        XCTAssertEqual(backend.count("notes"), 3)
    }

    @MainActor
    func testARefreshWithoutMutationsInBetweenIsUsedAsIs() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        vm.refresh()
        await notesSettle()
        XCTAssertEqual(backend.count("notes"), 2)
    }

    @MainActor
    func testOnlyTheLatestRefreshIsUsed() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let gate = NoteDeferred<Bool>()
        backend.holds["notes"] = gate
        vm.refresh()
        await notesSettle()
        // 旧请求读到的是这时的列表；之后服务端多了一篇，新的刷新读到它。
        backend.pages.append(NotePageSummary(id: "c", title: "Later", icon: nil, position: 9))
        vm.refresh()
        await notesSettle()
        XCTAssertEqual(vm.state.pages.map(\.id), ["a", "b", "c"])
        gate.complete(true)
        await notesSettle()
        XCTAssertEqual(vm.state.pages.map(\.id), ["a", "b", "c"])
    }

    @MainActor
    func testOpeningANoteFromALinkRefreshesTheListFirstAndStaysOnTheListWhenItIsGone() async {
        let backend = NotesTestBackend()
        let vm = NotesViewModel(backend: backend)
        // 列表还没读过（在聊天里点了回答里的笔记链接）。
        vm.openNoteFromLink("b")
        await notesSettle()
        XCTAssertEqual(vm.state.workspace, .notes)
        XCTAssertEqual(vm.state.open, OpenNote("b", "Japanese verbs", nil))

        vm.flushEditor = { FlushResult(true) }
        vm.openNoteFromLink("gone")
        await notesSettle()
        XCTAssertEqual(vm.state.workspace, .notes)
        XCTAssertNil(vm.state.open)

        // 等刷新期间用户回了聊天：不再打开。
        let gate = NoteDeferred<Bool>()
        backend.holds["notes"] = gate
        vm.openNoteFromLink("a")
        await notesSettle()
        vm.setWorkspace(.chat)
        await notesSettle()
        gate.complete(true)
        await notesSettle()
        XCTAssertEqual(vm.state.workspace, .chat)
        XCTAssertNil(vm.state.open)
    }

    @MainActor
    func testOpeningANoteThatIsNotInTheListNeedsATitle() async {
        let vm = await notesVm()
        vm.openNote("x")
        await notesSettle()
        XCTAssertNil(vm.state.open)
        // 检索结果：列表里没有，用结果带来的标题和图标。
        vm.openNote("x", title: "Found", icon: "🔎")
        await notesSettle()
        XCTAssertEqual(vm.state.open, OpenNote("x", "Found", "🔎"))
        // 已经开着：只切回笔记工作区。
        vm.openNote("x")
        XCTAssertEqual(vm.state.open?.id, "x")
    }

    @MainActor
    func testReorderAppliesTheServerOrderAndMovesTheDraggedNoteIntoTheTargetProject() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        vm.drop("b", on: .row(id: "a", after: false))
        XCTAssertTrue(vm.state.reorderBusy)
        XCTAssertTrue(vm.state.moveBusy.contains("b"))
        await notesSettle()
        let state = vm.state
        XCTAssertEqual(state.pages.map(\.id), ["b", "a"])
        XCTAssertEqual(state.pages.first { $0.id == "b" }?.groupId, "g1")
        XCTAssertEqual(state.members("g1").map(\.id), ["b", "a"])
        XCTAssertFalse(state.reorderBusy)
        XCTAssertTrue(state.moveBusy.isEmpty)
        XCTAssertNil(state.reorderError)
        XCTAssertTrue(backend.calls.contains("reorder:b:a:false"))
    }

    @MainActor
    func testASecondReorderWhileOneIsRunningAsksToWait() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let gate = NoteDeferred<Bool>()
        backend.holds["reorder"] = gate
        vm.reorder(ReorderMove(id: "b", targetId: "a", after: false))
        await notesSettle()
        vm.reorder(ReorderMove(id: "a", targetId: "b", after: true))
        XCTAssertEqual(vm.state.reorderError, ReorderFailure("a", wait: true))
        XCTAssertEqual(backend.calls.filter { $0.hasPrefix("reorder:") }.count, 1)
        gate.complete(true)
        await notesSettle()
        XCTAssertFalse(vm.state.reorderBusy)
    }

    @MainActor
    func testFailedReorderKeepsTheListAndShowsTheServerMessageOnThatRow() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let before = vm.state.pages
        backend.failNext = ApiException(status: 404, message: "Item not found.")
        vm.reorder(ReorderMove(id: "b", targetId: "a", after: false))
        await notesSettle()
        XCTAssertEqual(vm.state.pages, before)
        XCTAssertEqual(vm.state.reorderError, ReorderFailure("b", "Item not found."))
        vm.dismissReorderError()
        XCTAssertNil(vm.state.reorderError)
    }

    @MainActor
    func testNetworkFailureWhileReorderingUsesTheGenericMessage() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        backend.failNext = NotesTestIOError()
        vm.reorder(ReorderMove(id: "b", targetId: "a", after: true))
        await notesSettle()
        XCTAssertEqual(vm.state.reorderError, ReorderFailure("b"))
    }

    @MainActor
    func testDroppingOnAProjectMovesTheNoteAndExpandsACollapsedProject() async {
        let backend = NotesTestBackend()
        let prefs = MemoryNotesPrefs(collapsedGroups: ["g1"])
        let vm = await notesVm(backend, prefs: prefs)
        vm.drop("b", on: .into(containerId: "g1"))
        await notesSettle()
        XCTAssertEqual(vm.state.pages.first { $0.id == "b" }?.groupId, "g1")
        XCTAssertFalse(vm.state.collapsed.contains("g1"))
        XCTAssertTrue(backend.calls.contains("move:b:g1"))
        // 已经在那个项目里：不发请求。
        vm.dropIntoGroup("b", groupId: "g1")
        await notesSettle()
        XCTAssertEqual(backend.count("move:b:g1"), 1)
        // 拖到 Notes 标签上：移出项目。
        vm.dropIntoGroup("a", groupId: nil)
        await notesSettle()
        let a = page(vm, "a")
        XCTAssertNotNil(a)
        XCTAssertNil(a?.groupId)
        // 没有目标：什么都不做。
        vm.drop("a", on: nil)
        XCTAssertTrue(vm.state.moveBusy.isEmpty)
    }

    @MainActor
    func testFailedDropIntoAProjectLeavesTheNoteWhereItWas() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        backend.failNext = NotesTestIOError()
        vm.dropIntoGroup("b", groupId: "g1")
        await notesSettle()
        let b = page(vm, "b")
        XCTAssertNotNil(b)
        XCTAssertNil(b?.groupId)
        XCTAssertEqual(vm.state.reorderError, ReorderFailure("b"))
        XCTAssertTrue(vm.state.moveBusy.isEmpty)
    }

    func testApplyOrderSortsLikeTheWebAndOnlyMovesTheDraggedNoteBetweenProjects() {
        let pages = [
            NotePageSummary(id: "x", groupId: "g", position: 1, createdAt: "2026-01-01"),
            NotePageSummary(id: "y", position: 2, createdAt: "2026-01-02"),
            NotePageSummary(id: "z", groupId: "g", position: 3, createdAt: "2026-01-03"),
        ]
        let sorted = NotesViewModel.applyOrder(pages, [
            NoteOrderUpdate(id: "z", position: 1, groupId: nil, movedGroup: true),
            NoteOrderUpdate(id: "x", position: 2),
            NoteOrderUpdate(id: "y", position: 3),
        ])
        XCTAssertEqual(sorted.map(\.id), ["z", "x", "y"])
        XCTAssertNil(sorted[0].groupId)
        XCTAssertEqual(sorted[1].groupId, "g")
    }

    func testUpsertAndApplyOrderBreakTiesLikeTheServer() {
        let pages = [
            NotePageSummary(id: "old", position: 0, createdAt: "2026-01-01"),
            NotePageSummary(id: "new", position: 0, createdAt: "2026-01-03"),
        ]
        // position 相同：新建的在前；替换同一条不重复。
        let inserted = NotesViewModel.upsert(pages, NotePageSummary(id: "mid", position: 0, createdAt: "2026-01-02"))
        XCTAssertEqual(inserted.map(\.id), ["new", "mid", "old"])
        XCTAssertEqual(NotesViewModel.upsert(inserted, NotePageSummary(id: "old", title: "Renamed", position: 0, createdAt: "2026-01-01")).map(\.title), ["", "", "Renamed"])
        // 连创建时间也相同：id 大的在前（网页 byPosition）。
        let same = [NotePageSummary(id: "a", position: 1), NotePageSummary(id: "b", position: 1)]
        XCTAssertEqual(NotesViewModel.applyOrder(same, []).map(\.id), ["b", "a"])
    }

    @MainActor
    func testSubPagesShowUnderTheirParentCountInTheProjectAndGoToTheTrashWithIt() async {
        let backend = NotesTestBackend()
        backend.pages.append(NotePageSummary(id: "c", title: "Mitosis", icon: nil, groupId: "g1", createdAt: "2026-11-14T00:00:02Z", parentId: "a"))
        let vm = await notesVm(backend)
        let state = vm.state
        XCTAssertEqual(state.members("g1").map(\.id), ["a"])
        XCTAssertEqual(state.memberCount("g1"), 2)
        XCTAssertEqual(state.children("a").map(\.id), ["c"])
        XCTAssertEqual(state.ancestors("c").map(\.id), ["a"])
        XCTAssertEqual(state.descendants("a"), ["c"])
        vm.flushEditor = { FlushResult(true) }
        let trashed = await vm.trashNote("a")
        XCTAssertTrue(trashed)
        XCTAssertEqual(vm.state.pages.map(\.id), ["b"])
    }

    @MainActor
    func testTheTreeTreatsOrphansAsRootsStopsOnCyclesAndExpandsTheOpenNotesAncestors() async {
        let backend = NotesTestBackend()
        backend.pages = [
            NotePageSummary(id: "a", title: "A"),
            NotePageSummary(id: "b", title: "B", parentId: "a"),
            NotePageSummary(id: "c", title: "C", parentId: "b"),
            // 父页面不在列表里（回收站）：当最上层。
            NotePageSummary(id: "orphan", title: "O", parentId: "trashed"),
            // 数据坏了：互为父页面。
            NotePageSummary(id: "x", title: "X", parentId: "y"),
            NotePageSummary(id: "y", title: "Y", parentId: "x"),
        ]
        let vm = await notesVm(backend)
        XCTAssertEqual(vm.state.roots.map(\.id), ["a", "orphan"])
        XCTAssertEqual(vm.state.ancestors("c").map(\.id), ["a", "b"])
        XCTAssertEqual(vm.state.descendants("a"), ["b", "c"])
        XCTAssertEqual(vm.state.ancestors("x").map(\.id), ["y"])
        XCTAssertEqual(vm.state.descendants("x"), ["y"])

        XCTAssertFalse(vm.state.isExpanded("a"))
        vm.openNote("c")
        await notesSettle()
        // 打开着的笔记的祖先总是展开；点一下收起的是"自己展开了"的那部分。
        XCTAssertTrue(vm.state.isExpanded("a"))
        XCTAssertTrue(vm.state.isExpanded("b"))
        XCTAssertFalse(vm.state.isExpanded("c"))
        XCTAssertTrue(vm.state.expanded.isEmpty)
    }

    @MainActor
    func testExpandedPagesAreRemembered() async {
        let prefs = MemoryNotesPrefs()
        let vm = await notesVm(prefs: prefs)
        vm.toggleExpanded("a")
        XCTAssertEqual(prefs.expandedPages, ["a"])
        XCTAssertEqual(NotesViewModel(backend: NotesTestBackend(), prefs: prefs).state.expanded, ["a"])
        vm.toggleExpanded("a")
        XCTAssertTrue(prefs.expandedPages.isEmpty)
        XCTAssertFalse(vm.state.isExpanded("a"))
    }

    @MainActor
    func testAPageInsideAnotherIsCreatedUnderItAndTheParentIsExpandedAndRemembered() async {
        let prefs = MemoryNotesPrefs()
        let vm = await notesVm(prefs: prefs)
        vm.createNote(parentId: "a")
        await notesSettle()
        let created = page(vm, "new")
        XCTAssertEqual(created?.parentId, "a")
        XCTAssertEqual(created?.groupId, "g1")
        XCTAssertEqual(vm.state.open?.id, "new")
        XCTAssertTrue(vm.state.expanded.contains("a"))
        XCTAssertEqual(prefs.expandedPages, ["a"])
    }

    @MainActor
    func testMovingIntoAProjectDetachesThePageAndMovesItsSubPages() async {
        let backend = NotesTestBackend()
        backend.pages.append(NotePageSummary(id: "c", title: "Mitosis", icon: nil, groupId: "g1", parentId: "a"))
        backend.pages.append(NotePageSummary(id: "d", title: "Meiosis", icon: nil, groupId: "g1", parentId: "c"))
        let vm = await notesVm(backend)
        let moved = await vm.moveNote("c", groupId: nil)
        XCTAssertTrue(moved)
        let c = page(vm, "c")
        let d = page(vm, "d")
        XCTAssertNotNil(c)
        XCTAssertNil(c?.parentId)
        XCTAssertNil(c?.groupId)
        XCTAssertNotNil(d)
        XCTAssertNil(d?.groupId)
        XCTAssertEqual(d?.parentId, "c")
    }

    @MainActor
    func testMovingIntoAPageFollowsTheParentsProject() async {
        let vm = await notesVm()
        let moved = await vm.moveToPage("b", parentId: "a")
        XCTAssertTrue(moved)
        let b = page(vm, "b")
        XCTAssertEqual(b?.parentId, "a")
        XCTAssertEqual(b?.groupId, "g1")
        XCTAssertTrue(vm.state.expanded.contains("a"))
    }

    @MainActor
    func testSettingsAndFavoritesUpdateTheListAndReachTheOpenEditor() async {
        let vm = await notesVm()
        vm.openNote("a")
        await notesSettle()
        var pushed: [NotePageSummary] = []
        vm.pushPageSettings = { pushed.append($0) }
        let updated = await vm.updateSettings("a", NotePageSettings(fullWidth: true, font: "mono", locked: true))
        XCTAssertTrue(updated)
        let favorited = await vm.setFavorite("b", true)
        XCTAssertTrue(favorited)
        let a = page(vm, "a")
        XCTAssertEqual(a?.fullWidth, true)
        XCTAssertEqual(a?.font, "mono")
        XCTAssertEqual(a?.locked, true)
        XCTAssertEqual(vm.state.favorites.map(\.id), ["b"])
        // 只把打开着的那篇交给编辑器。
        XCTAssertEqual(pushed.map(\.id), ["a"])
    }

    @MainActor
    func testDuplicatingSavesTheOpenPageFirstAddsTheCopyInTheServersOrderAndOpensIt() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        vm.openNote("a")
        await notesSettle()
        vm.flushEditor = { FlushResult(false) }
        vm.duplicate("a")
        await notesSettle()
        XCTAssertFalse(backend.calls.contains("duplicate:a"))
        XCTAssertEqual(vm.state.notice?.kind, .unsavedDraft)
        XCTAssertFalse(vm.state.busy)
        vm.flushEditor = { FlushResult(true) }
        vm.duplicate("a")
        await notesSettle()
        XCTAssertEqual(vm.state.pages.map(\.id), ["a", "copy", "b"])
        XCTAssertEqual(vm.state.open?.id, "copy")
        XCTAssertFalse(vm.state.busy)
    }

    func testReorderResultsCanMoveAPageUnderAnotherParent() {
        let pages = [
            NotePageSummary(id: "x", title: "X", icon: nil, position: 1),
            NotePageSummary(id: "y", title: "Y", icon: nil, position: 2, parentId: "p"),
        ]
        let next = NotesViewModel.applyOrder(pages, [
            NoteOrderUpdate(id: "x", position: 2, groupId: nil, movedGroup: true, parentId: "p", movedParent: true),
            NoteOrderUpdate(id: "y", position: 1),
        ])
        XCTAssertEqual(next.map(\.id), ["y", "x"])
        XCTAssertEqual(next[1].parentId, "p")
    }

    @MainActor
    func testSettingsForOnePageAreSentOneAtATimeSoALateAnswerCannotUndoANewerChoice() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let first = NoteDeferred<Bool>()
        backend.holds["settings:serif"] = first
        let a = Task { await vm.updateSettings("a", NotePageSettings(font: "serif")) }
        let b = Task { await vm.updateSettings("a", NotePageSettings(font: "mono")) }
        await notesSettle()
        // 第二个请求要等第一个回来才发。
        XCTAssertEqual(backend.calls.filter { $0.hasPrefix("settings") }, ["settings:a"])
        first.complete(true)
        _ = await a.value
        _ = await b.value
        XCTAssertEqual(page(vm, "a")?.font, "mono")
        XCTAssertEqual(backend.count("settings:a"), 2)
    }

    @MainActor
    func testTrashingNotesNotifiesTheWarmWebViewCacheEvenWhenClosed() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        var notified: [Set<String>] = []
        vm.notifyPagesTrashed = { notified.append(Set($0)) }

        let trashed = await vm.trashNote("a")
        XCTAssertTrue(trashed)
        vm.onPagesTrashed(["b"])

        XCTAssertEqual(notified, [Set(["a"]), Set(["b"])])
    }
}
