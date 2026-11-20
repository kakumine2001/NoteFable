import Foundation
import XCTest
@testable import NoteFableCore

/// ChatViewModel 里侧栏用到的那一小部分（会话列表、当前聊天、换聊天的计数），行为照 Android 的 ChatViewModel。
@MainActor
private final class FakeChat: SidebarChatHost {
    var sessions: [SessionSummary]
    var activeSessionId: String?
    var generating: Set<String> = []
    var messagesEmpty = true
    private(set) var navigationCount = 0

    init(_ sessions: [SessionSummary]) {
        self.sessions = sessions
    }

    var sidebarChat: SidebarChatSnapshot {
        SidebarChatSnapshot(
            sessions: sessions, activeSessionId: activeSessionId, generatingSessionIds: generating,
            messagesEmpty: messagesEmpty, sending: false, messagesLoading: false
        )
    }

    func openSession(_ id: String?) {
        navigationCount += 1
        activeSessionId = id
    }

    func patchSessions(_ transform: ([SessionSummary]) -> [SessionSummary]) {
        sessions = transform(sessions)
    }

    func onSessionDeleted(_ id: String) {
        if activeSessionId == id { openSession(nil) }
        patchSessions { list in list.filter { $0.id != id } }
    }

    func openCreatedSession(_ session: SessionSummary) {
        addCreatedSession(session)
        openSession(session.id)
    }

    func addCreatedSession(_ session: SessionSummary) {
        patchSessions { list in [session] + list.filter { $0.id != session.id } }
    }
}

@MainActor
private final class FakeSessions: SessionsBackend {
    struct Update: Equatable {
        var id: String
        var pinned: Bool?
        var project: ProjectChange?
    }

    var updates: [Update] = []
    var titles: [String?] = []
    var deleted: [String] = []
    var created: [String?] = []
    var fail = false
    var reorderResult: [SessionOrderUpdate] = []
    /// 设了以后新建聊天要等它：模拟慢请求。
    var createGate: TestGate?
    /// 设了以后排序要等它。
    var reorderGate: TestGate?

    func updateSession(id: String, title: String?, pinned: Bool?, project: ProjectChange?) async throws {
        if fail { throw TestIOError() }
        updates.append(Update(id: id, pinned: pinned, project: project))
        titles.append(title)
    }

    func deleteSession(id: String) async throws {
        deleted.append(id)
    }

    func createSession(projectId: String?) async throws -> SessionSummary {
        created.append(projectId)
        await createGate?.pass()
        return SessionSummary(id: "created", title: "New chat", projectId: projectId)
    }

    func reorderSession(id: String, targetId: String, after: Bool) async throws -> [SessionOrderUpdate] {
        await reorderGate?.pass()
        return reorderResult
    }
}

@MainActor
private final class FakeProjects: ProjectsBackend {
    var list: [ChatProjectSummary]
    /// 设了以后 GET 先读好列表再等它：模拟改动之前就读到的旧结果。
    var gate: TestGate?
    var notesFail = false
    var detailFail: Error?
    var settingsSaves: [ProjectSettingsChanges] = []

    init(_ list: [ChatProjectSummary]) {
        self.list = list
    }

    func projects() async throws -> [ChatProjectSummary] {
        let snapshot = list
        await gate?.pass()
        return snapshot
    }

    func createProject(name: String) async throws -> ChatProjectSummary {
        let project = ChatProjectSummary(id: "new", name: name)
        list.append(project)
        return project
    }

    func renameProject(id: String, name: String) async throws -> ChatProjectSummary {
        ChatProjectSummary(id: id, name: name)
    }

    func deleteProject(id: String) async throws {}

    func projectDetail(id: String) async throws -> ChatProjectDetail {
        if let detailFail { throw detailFail }
        return ChatProjectDetail(id: id, name: "P", instructions: "Be brief", notes: [ChatProjectNote(id: "n1", title: "Kanji")])
    }

    func updateProjectSettings(id: String, instructions: String?, noteIds: [String]?) async throws -> ChatProjectSummary {
        settingsSaves.append(ProjectSettingsChanges(instructions: instructions, noteIds: noteIds))
        return ChatProjectSummary(id: id, name: "P", noteCount: noteIds?.count ?? 0, hasInstructions: !(instructions ?? "").isEmpty)
    }

    func notesForPicker() async throws -> [NotePageSummary] {
        if notesFail { throw TestIOError() }
        return []
    }
}

final class SidebarViewModelTests: XCTestCase {
    private let p1 = ChatProjectSummary(id: "p1", name: "One")
    private let p2 = ChatProjectSummary(id: "p2", name: "Two")

    private var projectsApi: FakeProjects!

    @MainActor
    private func setup(
        _ sessions: [SessionSummary], projects: [ChatProjectSummary]? = nil
    ) async -> (chat: FakeChat, sidebar: SidebarViewModel, api: FakeSessions) {
        let chat = FakeChat(sessions)
        let api = FakeSessions()
        projectsApi = FakeProjects(projects ?? [p1, p2])
        let sidebar = SidebarViewModel(sessions: api, projectsApi: projectsApi, chat: chat)
        await sidebar.idle()
        return (chat, sidebar, api)
    }

    func testGroupsPinnedPerProjectAndLooseChatsLikeTheWebSidebar() {
        let sessions = [
            SessionSummary(id: "a", title: "A", pinned: true, position: 1, projectId: "p1"),
            SessionSummary(id: "b", title: "B", projectId: "p1"),
            SessionSummary(id: "c", title: "C", projectId: "gone"),
            SessionSummary(id: "d", title: "D", pinned: true, position: 0),
            SessionSummary(id: "e", title: "E", pinned: true, projectId: "p2"),
        ]
        let groups = SidebarGroups.of(sessions, [p1, p2])
        XCTAssertEqual(groups.pinned.map(\.id), ["d", "e", "a"])
        XCTAssertEqual(groups.byProject["p1"]?.map(\.id), ["b"])
        XCTAssertEqual(groups.byProject["p2"], [])
        XCTAssertEqual(groups.allPinned, ["p2"])
        XCTAssertEqual(groups.loose.map(\.id), ["c"])
        XCTAssertEqual(emptyProjectNoteKey("p2", groups), "sb_all_chats_pinned")
        XCTAssertEqual(emptyProjectNoteKey("p1", groups), "sb_no_chats")
    }

    func testOrdersByPinnedThenPositionThenNewest() {
        let ordered = orderedSessions([
            SessionSummary(id: "old", title: "o", position: 0, updatedAt: "2026-01-01"),
            SessionSummary(id: "new", title: "n", position: 0, updatedAt: "2026-02-01"),
            SessionSummary(id: "pin", title: "p", pinned: true, position: 5),
            SessionSummary(id: "later", title: "l", position: 1),
        ])
        XCTAssertEqual(ordered.map(\.id), ["pin", "new", "old", "later"])
    }

    func testProjectSettingsSendOnlyWhatChanged() {
        let initial = ChatProjectDetail(id: "p", name: "P", instructions: "Be brief", notes: [ChatProjectNote(id: "n1")])
        XCTAssertNil(projectSettingsChanges(initial, "  Be brief ", [ChatProjectNote(id: "n1")]))
        XCTAssertEqual(
            projectSettingsChanges(initial, "Be kind", [ChatProjectNote(id: "n1")]),
            ProjectSettingsChanges(instructions: "Be kind", noteIds: nil)
        )
        XCTAssertEqual(projectSettingsChanges(initial, "Be brief", []), ProjectSettingsChanges(instructions: nil, noteIds: []))
    }

    func testNotePickerFiltersByTitleAndStopsAtTheLimit() {
        let pages = [ChatProjectNote(id: "a", title: "Kanji"), ChatProjectNote(id: "b", title: ""), ChatProjectNote(id: "c", title: "Grammar")]
        XCTAssertEqual(filterProjectNotes(pages, " kan ", "Untitled").map(\.id), ["a"])
        XCTAssertEqual(filterProjectNotes(pages, "untit", "Untitled").map(\.id), ["b"])
        XCTAssertEqual(filterProjectNotes(pages, "  ", "Untitled").map(\.id), ["a", "b", "c"])
        var selected: [ChatProjectNote] = []
        for index in 1...7 { selected = toggleProjectNote(selected, ChatProjectNote(id: "n\(index)")) }
        XCTAssertEqual(selected.count, 5)
        XCTAssertEqual(toggleProjectNote(selected, ChatProjectNote(id: "n1")).count, 4)
    }

    @MainActor
    func testPinChangesLocallyAfterTheServerSavesAndAFailureIsReported() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "A")])
        let saved = await sidebar.setPinned("a", true)
        XCTAssertNil(saved)
        XCTAssertEqual(chat.sessions.map(\.pinned), [true])
        api.fail = true
        let failed = await sidebar.setPinned("a", false)
        XCTAssertEqual(failed, SidebarError(detail: nil, fallback: "sb_err_save_change"))
        XCTAssertEqual(chat.sessions.map(\.pinned), [true])
    }

    @MainActor
    func testRenameTrimsTheTitleAndKeepsTheServerSentenceOnFailure() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "A")])
        let saved = await sidebar.rename("a", "  Plans  ")
        XCTAssertNil(saved)
        XCTAssertEqual(api.titles, ["Plans"])
        XCTAssertEqual(chat.sessions.first?.title, "Plans")
        XCTAssertEqual(
            SidebarError.of(ApiException(status: 400, message: "Title is too long."), "sb_err_save_chat"),
            SidebarError(detail: "Title is too long.", fallback: "sb_err_save_chat")
        )
        XCTAssertEqual(sidebarErrorText(SidebarError(detail: nil, fallback: "sb_err_save_chat"), SystemText.empty.translator("en")), "sb_err_save_chat")
    }

    @MainActor
    func testDeletingTheOpenChatGoesBackToANewChat() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "A"), SessionSummary(id: "b", title: "B")])
        chat.openSession("a")
        let error = await sidebar.delete("a")
        XCTAssertNil(error)
        XCTAssertEqual(api.deleted, ["a"])
        XCTAssertNil(chat.activeSessionId)
        XCTAssertEqual(chat.sessions.map(\.id), ["b"])
    }

    @MainActor
    func testAChatThatIsStillGeneratingCannotBeDeleted() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "A")])
        chat.generating = ["a"]
        let error = await sidebar.delete("a")
        XCTAssertEqual(error?.fallback, "sb_err_wait_reply_delete")
        XCTAssertEqual(api.deleted, [])
    }

    @MainActor
    func testNewChatInAProjectReusesAnEmptyOpenChatByMovingIt() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "New chat")])
        chat.openSession("a")
        let opened = await sidebar.newChatInProject("p1")
        XCTAssertTrue(opened)
        XCTAssertEqual(api.updates, [FakeSessions.Update(id: "a", pinned: nil, project: ProjectChange(projectId: "p1"))])
        XCTAssertTrue(api.created.isEmpty)
        XCTAssertEqual(chat.sessions.map(\.projectId), ["p1"])
    }

    @MainActor
    func testNewChatInAProjectCreatesAndOpensOneWhenNothingReusableIsOpen() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "Real title")])
        chat.openSession("a")
        let opened = await sidebar.newChatInProject("p2")
        XCTAssertTrue(opened)
        XCTAssertEqual(api.created, ["p2"])
        XCTAssertEqual(chat.activeSessionId, "created")
        XCTAssertEqual(chat.sessions.first?.id, "created")
    }

    @MainActor
    func testASlowProjectChatDoesNotPullTheUserAwayFromAChatOpenedMeanwhile() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "Real title"), SessionSummary(id: "b", title: "Other")])
        chat.openSession("a")
        let gate = TestGate()
        api.createGate = gate
        let result = Task { await sidebar.newChatInProject("p2") }
        await gate.entered()
        chat.openSession("b")
        gate.open()
        let opened = await result.value
        XCTAssertFalse(opened)
        XCTAssertEqual(chat.activeSessionId, "b")
        XCTAssertEqual(chat.sessions.first?.id, "created")
    }

    @MainActor
    func testReorderAppliesTheServerPositionsAndADropOnAProjectUnpinsIt() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "A", pinned: true), SessionSummary(id: "b", title: "B")])
        api.reorderResult = [
            SessionOrderUpdate(id: "a", position: 1, pinned: false, projectId: nil, movedGroup: true),
            SessionOrderUpdate(id: "b", position: 0),
        ]
        sidebar.drop("a", on: .row(id: "b", after: true))
        await sidebar.idle()
        let a = chat.sessions.first { $0.id == "a" }
        XCTAssertEqual(a?.pinned, false)
        XCTAssertEqual(a?.position, 1)
        sidebar.toggleProject("p1")
        XCTAssertTrue(sidebar.state.collapsed.contains("p1"))
        sidebar.drop("b", on: .into(containerId: "p1"))
        await sidebar.idle()
        XCTAssertEqual(api.updates.last, FakeSessions.Update(id: "b", pinned: false, project: ProjectChange(projectId: "p1")))
        XCTAssertEqual(chat.sessions.first { $0.id == "b" }?.projectId, "p1")
        XCTAssertFalse(sidebar.state.collapsed.contains("p1"))
    }

    @MainActor
    func testDeletingAProjectKeepsItsChatsUnderChats() async {
        let (chat, sidebar, _) = await setup([SessionSummary(id: "a", title: "A", projectId: "p1")])
        let error = await sidebar.deleteProject("p1")
        XCTAssertNil(error)
        XCTAssertEqual(sidebar.state.projects.map(\.id), ["p2"])
        XCTAssertEqual(chat.sessions.map(\.projectId), [nil])
    }

    @MainActor
    func testABusyReorderReportsTheWaitMessage() async {
        let (_, sidebar, api) = await setup([SessionSummary(id: "a", title: "A"), SessionSummary(id: "b", title: "B")])
        let gate = TestGate()
        api.reorderGate = gate
        sidebar.reorder(ReorderMove(id: "a", targetId: "b", after: true))
        sidebar.reorder(ReorderMove(id: "b", targetId: "a", after: true))
        XCTAssertEqual(sidebar.state.reorderError, SidebarReorderError(id: "b", error: SidebarError(detail: nil, fallback: "sb_err_wait_move")))
        gate.open()
        await sidebar.idle()
        XCTAssertFalse(sidebar.state.reorderBusy)
        sidebar.dismissReorderError()
        XCTAssertNil(sidebar.state.reorderError)
    }

    @MainActor
    func testARefreshThatStartedBeforeAProjectChangeDoesNotUndoIt() async {
        let (_, sidebar, _) = await setup([])
        let gate = TestGate()
        projectsApi.gate = gate
        sidebar.refreshProjects()
        await gate.entered()
        let created = await sidebar.createProject("Three")
        XCTAssertNil(created.error)
        gate.open()
        await sidebar.idle()
        XCTAssertEqual(sidebar.state.projects.map(\.id), ["p1", "p2", "new"])
    }

    @MainActor
    func testMovingTheEmptyOpenChatIntoAProjectKeepsTheDrawerOpenOnFailure() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "New chat")])
        chat.openSession("a")
        api.fail = true
        let opened = await sidebar.newChatInProject("p1")
        XCTAssertFalse(opened)
        XCTAssertEqual(sidebar.state.createError?.fallback, "sb_err_save_chat")
        sidebar.dismissCreateError()
        XCTAssertNil(sidebar.state.createError)
    }

    @MainActor
    func testProjectSettingsReportANotesFailureWithTheNotesMessage() async {
        let (_, sidebar, _) = await setup([])
        projectsApi.notesFail = true
        guard case .failure(let error) = await sidebar.loadProjectSettings("p1") else { return XCTFail("expected a failure") }
        XCTAssertEqual(sidebar.projectSettingsLoadError(error).fallback, "sb_err_load_your_notes")
        XCTAssertEqual(sidebar.projectSettingsLoadError(TestIOError()).fallback, "sb_err_load_project_settings")
        // 两个都读不到时先报项目详情的原因。
        projectsApi.detailFail = ApiException(status: 404, message: "Project not found.")
        guard case .failure(let both) = await sidebar.loadProjectSettings("p1") else { return XCTFail("expected a failure") }
        XCTAssertEqual(
            sidebar.projectSettingsLoadError(both), SidebarError(detail: "Project not found.", fallback: "sb_err_load_project_settings")
        )
    }

    @MainActor
    func testOnlyTheMovingChatIsLockedAndADropIntoAProjectIgnoresTheReorderLock() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "A"), SessionSummary(id: "b", title: "B")])
        let gate = TestGate()
        api.reorderGate = gate
        sidebar.reorder(ReorderMove(id: "a", targetId: "b", after: true))
        XCTAssertEqual(sidebar.state.moveBusy, ["a"])
        sidebar.dropIntoProject("b", "p1")
        XCTAssertEqual(sidebar.state.moveBusy, ["a", "b"])
        gate.open()
        await sidebar.idle()
        XCTAssertTrue(sidebar.state.moveBusy.isEmpty)
        XCTAssertFalse(sidebar.state.reorderBusy)
        XCTAssertEqual(chat.sessions.first { $0.id == "b" }?.projectId, "p1")
    }

    @MainActor
    func testAnIdentityChangeDropsTheOldProjectsAndLateAnswers() async {
        let (_, sidebar, _) = await setup([])
        sidebar.toggleProject("p1")
        let gate = TestGate()
        projectsApi.gate = gate
        sidebar.refreshProjects()
        await gate.entered()
        projectsApi.list = [p2]
        sidebar.onIdentityChanged()
        XCTAssertEqual(sidebar.state, SidebarUiState())
        gate.open()
        await sidebar.idle()
        XCTAssertEqual(sidebar.state.projects.map(\.id), ["p2"])
    }

    // ---- 菜单 / 对话框的小状态机 ----

    @MainActor
    func testTheRunnerRunsOneActionAtATimeClosesOnSuccessAndKeepsTheErrorOnFailure() async {
        let (_, sidebar, api) = await setup([SessionSummary(id: "a", title: "A")])
        var closed = 0
        let runner = SidebarActionRunner(onClose: { closed += 1 })
        api.fail = true
        runner.run { await sidebar.setPinned("a", true) }
        XCTAssertTrue(runner.busy)
        runner.close()
        XCTAssertEqual(closed, 0, "busy: the dialog stays open")
        runner.run { await sidebar.setPinned("a", true) }
        await runner.idle()
        XCTAssertFalse(runner.busy)
        XCTAssertEqual(runner.error?.fallback, "sb_err_save_change")
        XCTAssertEqual(closed, 0)
        api.fail = false
        runner.run { await sidebar.setPinned("a", true) }
        XCTAssertNil(runner.error)
        await runner.idle()
        XCTAssertEqual(closed, 1)
        XCTAssertEqual(api.updates.count, 1)
    }

    @MainActor
    func testCreateAndMoveKeepsTheNewProjectWhenTheMoveFails() async {
        let (chat, sidebar, api) = await setup([SessionSummary(id: "a", title: "A")])
        var closed = 0
        var created = 0
        let runner = SidebarActionRunner(onClose: { closed += 1 })
        api.fail = true
        runner.createAndMove(sidebar, sessionId: "a", name: " Three ", onCreated: { created += 1 })
        await runner.idle()
        XCTAssertEqual(created, 1)
        XCTAssertEqual(closed, 0)
        XCTAssertEqual(runner.error?.fallback, "sb_err_save_chat")
        XCTAssertEqual(sidebar.state.projects.map(\.name), ["One", "Two", "Three"])
        XCTAssertNil(chat.sessions.first?.projectId)
        let options = moveOptions(chat.sessions[0], sidebar.state.projects)
        XCTAssertEqual(options.map(\.projectId), [nil, "p1", "p2", "new"])
        XCTAssertEqual(options.map(\.checked), [true, false, false, false])
    }

    @MainActor
    func testProjectSettingsLoadSaveOnlyChangesAndCloseWhenNothingChanged() async {
        let (_, sidebar, _) = await setup([])
        var closed = 0
        let model = ProjectSettingsModel(project: p1, sidebar: sidebar, onClose: { closed += 1 })
        XCTAssertFalse(model.canSave)
        await model.idle()
        XCTAssertEqual(model.state.instructions, "Be brief")
        XCTAssertEqual(model.state.selected.map(\.id), ["n1"])
        XCTAssertEqual(model.instructionsCount, "8/4000")
        XCTAssertEqual(model.notesCount, "1/5")
        XCTAssertEqual(model.emptyNotesKey, "sb_no_notes_yet")
        // 没改：直接关，不发请求。
        model.save()
        XCTAssertEqual(closed, 1)
        XCTAssertTrue(projectsApi.settingsSaves.isEmpty)
        model.setInstructions("Be kind ")
        model.toggle(ChatProjectNote(id: "n1", title: "Kanji"))
        model.save()
        XCTAssertTrue(model.state.busy)
        model.close()
        XCTAssertEqual(closed, 1, "saving: the dialog stays open")
        await model.idle()
        XCTAssertEqual(projectsApi.settingsSaves, [ProjectSettingsChanges(instructions: "Be kind", noteIds: [])])
        XCTAssertEqual(closed, 2)
        XCTAssertEqual(sidebar.state.projects.first, ChatProjectSummary(id: "p1", name: "P", noteCount: 0, hasInstructions: true))
    }

    @MainActor
    func testProjectSettingsShowTheLoadFailureAndRetry() async {
        let (_, sidebar, _) = await setup([])
        projectsApi.notesFail = true
        let model = ProjectSettingsModel(project: p1, sidebar: sidebar, onClose: {})
        await model.idle()
        XCTAssertEqual(model.state.loadError?.fallback, "sb_err_load_your_notes")
        XCTAssertNil(model.state.loaded)
        projectsApi.notesFail = false
        model.retry()
        XCTAssertNil(model.state.loadError)
        await model.idle()
        XCTAssertNotNil(model.state.loaded)
    }

    func testProjectHintListsInstructionsAndReferenceNotes() {
        XCTAssertEqual(projectHint(ChatProjectSummary(id: "p", name: "P")), "")
        XCTAssertEqual(projectHint(ChatProjectSummary(id: "p", name: "P", noteCount: 1)), "sb_one_reference_note")
        XCTAssertEqual(
            projectHint(ChatProjectSummary(id: "p", name: "P", noteCount: 3, hasInstructions: true)),
            "sb_hint_instructions + sb_n_reference_notes"
        )
    }

    // ---- 拖动的目标 ----

    func testDropZonesWinOverRowsAndTheRowHalfDecidesBeforeOrAfter() {
        let rows = ["a": CGRect(x: 0, y: 100, width: 300, height: 44), "b": CGRect(x: 0, y: 144, width: 300, height: 44)]
        let zones = ["p1": CGRect(x: 0, y: 50, width: 300, height: 44), "": CGRect(x: 0, y: 200, width: 300, height: 30)]
        XCTAssertEqual(dropTargetAt(CGPoint(x: 10, y: 60), dragging: "a", zones: zones, rows: rows), .into(containerId: "p1"))
        XCTAssertEqual(dropTargetAt(CGPoint(x: 10, y: 210), dragging: "a", zones: zones, rows: rows), .into(containerId: nil))
        XCTAssertEqual(dropTargetAt(CGPoint(x: 10, y: 150), dragging: "a", zones: zones, rows: rows), .row(id: "b", after: false))
        XCTAssertEqual(dropTargetAt(CGPoint(x: 10, y: 180), dragging: "a", zones: zones, rows: rows), .row(id: "b", after: true))
        // 自己那一行不算目标；什么都没碰到是 nil。
        XCTAssertNil(dropTargetAt(CGPoint(x: 10, y: 110), dragging: "a", zones: zones, rows: rows))
        XCTAssertNil(dropTargetAt(CGPoint(x: 10, y: 400), dragging: "a", zones: zones, rows: rows))
        XCTAssertEqual(dropZoneAt(CGPoint(x: 10, y: 210), zones), "")
    }

    func testTheListScrollsOnlyNearItsEdges() {
        XCTAssertEqual(reorderScrollDelta(pointerY: 110, listTop: 100, listBottom: 600), -12)
        XCTAssertEqual(reorderScrollDelta(pointerY: 300, listTop: 100, listBottom: 600), 0)
        XCTAssertEqual(reorderScrollDelta(pointerY: 580, listTop: 100, listBottom: 600), 12)
    }
}
