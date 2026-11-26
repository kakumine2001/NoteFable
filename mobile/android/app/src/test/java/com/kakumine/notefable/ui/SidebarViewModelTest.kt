package com.kakumine.notefable.ui

import com.kakumine.notefable.R
import com.kakumine.notefable.data.ChatBackend
import com.kakumine.notefable.data.ChatProjectDetail
import com.kakumine.notefable.data.ChatProjectNote
import com.kakumine.notefable.data.ChatProjectSummary
import com.kakumine.notefable.data.ChatRequest
import com.kakumine.notefable.data.ChatStreamEvent
import com.kakumine.notefable.data.ImageResult
import com.kakumine.notefable.data.LocalFile
import com.kakumine.notefable.data.MessageDto
import com.kakumine.notefable.data.ModelsResponse
import com.kakumine.notefable.data.NotePageSummary
import com.kakumine.notefable.data.ProjectChange
import com.kakumine.notefable.data.ProjectsBackend
import com.kakumine.notefable.data.SessionOrderUpdate
import com.kakumine.notefable.data.SessionSummary
import com.kakumine.notefable.data.SessionsBackend
import com.kakumine.notefable.data.UploadPlan
import com.kakumine.notefable.data.UploadSlot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class SidebarViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class Chat(var list: List<SessionSummary>) : ChatBackend {
        override suspend fun sessions() = list
        override suspend fun messages(sessionId: String) = emptyList<MessageDto>()
        override suspend fun models(): ModelsResponse = throw IOException("404")
        override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> = emptyFlow()
        override suspend fun generateImage(request: ChatRequest): ImageResult = throw IOException()
        override suspend fun prepareUploads(files: List<LocalFile>): UploadPlan = throw IOException()
        override suspend fun uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: (Int) -> Unit) = Unit
        override suspend fun discardUploads(tickets: List<String>) = Unit
        override fun absoluteUrl(path: String) = "https://example.test$path"
    }

    private class Sessions : SessionsBackend {
        val updates = mutableListOf<Triple<String, Boolean?, ProjectChange?>>()
        val deleted = mutableListOf<String>()
        val created = mutableListOf<String?>()
        var fail = false
        var reorderResult = listOf<SessionOrderUpdate>()
        /** 设了以后新建聊天要等它：模拟慢请求。 */
        var createGate: CompletableDeferred<Unit>? = null

        override suspend fun updateSession(id: String, title: String?, pinned: Boolean?, project: ProjectChange?) {
            if (fail) throw IOException("offline")
            updates += Triple(id, pinned, project)
        }
        override suspend fun deleteSession(id: String) {
            deleted += id
        }
        override suspend fun createSession(projectId: String?): SessionSummary {
            created += projectId
            createGate?.await()
            return SessionSummary("created", "New chat", projectId = projectId)
        }
        override suspend fun reorderSession(id: String, targetId: String, after: Boolean) = reorderResult
    }

    private class Projects(var list: List<ChatProjectSummary>) : ProjectsBackend {
        /** 设了以后 GET 先读好列表再等它：模拟改动之前就读到的旧结果。 */
        var gate: CompletableDeferred<Unit>? = null
        var notesFail = false
        override suspend fun projects(): List<ChatProjectSummary> {
            val snapshot = list
            gate?.await()
            return snapshot
        }
        override suspend fun createProject(name: String) = ChatProjectSummary("new", name).also { list = list + it }
        override suspend fun renameProject(id: String, name: String) = ChatProjectSummary(id, name)
        override suspend fun deleteProject(id: String) = Unit
        override suspend fun projectDetail(id: String) = ChatProjectDetail(id, "P")
        override suspend fun updateProjectSettings(id: String, instructions: String?, noteIds: List<String>?) =
            ChatProjectSummary(id, "P", noteCount = noteIds?.size ?: 0, hasInstructions = !instructions.isNullOrEmpty())
        override suspend fun notesForPicker(): List<NotePageSummary> = if (notesFail) throw IOException("offline") else emptyList()
    }

    private class MemorySettings : SettingsStore {
        override var modelId: String? = null
        override var reasoning: String? = null
    }

    private val p1 = ChatProjectSummary("p1", "One")
    private val p2 = ChatProjectSummary("p2", "Two")

    private var projectsApi = Projects(emptyList())

    private fun TestScope.setup(sessions: List<SessionSummary>, projects: List<ChatProjectSummary> = listOf(p1, p2)):
        Triple<ChatViewModel, SidebarViewModel, Sessions> {
        val chat = ChatViewModel(Chat(sessions), MemorySettings(), flushIntervalMs = 10)
        val api = Sessions()
        projectsApi = Projects(projects)
        val sidebar = SidebarViewModel(api, projectsApi, chat)
        advanceUntilIdle()
        return Triple(chat, sidebar, api)
    }

    @Test
    fun `groups pinned, per-project and loose chats like the web sidebar`() {
        val sessions = listOf(
            SessionSummary("a", "A", pinned = true, projectId = "p1", position = 1),
            SessionSummary("b", "B", projectId = "p1"),
            SessionSummary("c", "C", projectId = "gone"),
            SessionSummary("d", "D", pinned = true, position = 0),
            SessionSummary("e", "E", projectId = "p2", pinned = true),
        )
        val groups = SidebarGroups.of(sessions, listOf(p1, p2))
        assertEquals(listOf("d", "e", "a"), groups.pinned.map { it.id })
        assertEquals(listOf("b"), groups.byProject["p1"]!!.map { it.id })
        assertTrue(groups.byProject["p2"]!!.isEmpty())
        assertEquals(setOf("p2"), groups.allPinned)
        assertEquals(listOf("c"), groups.loose.map { it.id })
    }

    @Test
    fun `orders by pinned, then position, then newest`() {
        val ordered = orderedSessions(
            listOf(
                SessionSummary("old", "o", position = 0, updatedAt = "2026-01-01"),
                SessionSummary("new", "n", position = 0, updatedAt = "2026-02-01"),
                SessionSummary("pin", "p", pinned = true, position = 5),
                SessionSummary("later", "l", position = 1),
            ),
        )
        assertEquals(listOf("pin", "new", "old", "later"), ordered.map { it.id })
    }

    @Test
    fun `project settings send only what changed`() {
        val initial = ChatProjectDetail("p", "P", instructions = "Be brief", notes = listOf(ChatProjectNote("n1")))
        assertNull(projectSettingsChanges(initial, "  Be brief ", listOf(ChatProjectNote("n1"))))
        assertEquals(ProjectSettingsChanges("Be kind", null), projectSettingsChanges(initial, "Be kind", listOf(ChatProjectNote("n1"))))
        assertEquals(ProjectSettingsChanges(null, emptyList()), projectSettingsChanges(initial, "Be brief", emptyList()))
    }

    @Test
    fun `project settings never close while saving and confirm unsaved changes`() {
        assertEquals(ProjectSettingsDismiss.Stay, projectSettingsDismissStep(busy = true, dirty = true))
        assertEquals(ProjectSettingsDismiss.Stay, projectSettingsDismissStep(busy = true, dirty = false))
        assertEquals(ProjectSettingsDismiss.Confirm, projectSettingsDismissStep(busy = false, dirty = true))
        assertEquals(ProjectSettingsDismiss.Close, projectSettingsDismissStep(busy = false, dirty = false))
        // 撤回改动后归零，再改也不会没想关就出确认。
        assertEquals(2, projectSettingsAttention(2, dirty = true))
        assertEquals(0, projectSettingsAttention(1, dirty = false))
    }

    @Test
    fun `note picker filters by title and stops at the limit`() {
        val pages = listOf(ChatProjectNote("a", "Kanji"), ChatProjectNote("b", ""), ChatProjectNote("c", "Grammar"))
        assertEquals(listOf("a"), filterProjectNotes(pages, " kan ", "Untitled").map { it.id })
        assertEquals(listOf("b"), filterProjectNotes(pages, "untit", "Untitled").map { it.id })
        var selected = emptyList<ChatProjectNote>()
        (1..7).forEach { selected = toggleProjectNote(selected, ChatProjectNote("n$it")) }
        assertEquals(5, selected.size)
        assertEquals(4, toggleProjectNote(selected, ChatProjectNote("n1")).size)
    }

    @Test
    fun `pin changes locally after the server saves, and a failure is reported`() = runTest(dispatcher) {
        val (chat, sidebar, api) = setup(listOf(SessionSummary("a", "A")))
        assertEquals(null, sidebar.setPinned("a", true))
        assertTrue(chat.state.value.sessions.single().pinned)
        api.fail = true
        assertTrue(sidebar.setPinned("a", false) != null)
        assertTrue(chat.state.value.sessions.single().pinned)
    }

    @Test
    fun `deleting the open chat goes back to a new chat`() = runTest(dispatcher) {
        val (chat, sidebar, api) = setup(listOf(SessionSummary("a", "A"), SessionSummary("b", "B")))
        chat.openSession("a")
        advanceUntilIdle()
        assertNull(sidebar.delete("a"))
        advanceUntilIdle()
        assertEquals(listOf("a"), api.deleted)
        assertNull(chat.state.value.activeSessionId)
        assertEquals(listOf("b"), chat.state.value.sessions.map { it.id })
    }

    @Test
    fun `new chat in a project reuses an empty open chat by moving it`() = runTest(dispatcher) {
        val (chat, sidebar, api) = setup(listOf(SessionSummary("a", "New chat")))
        chat.openSession("a")
        advanceUntilIdle()
        assertTrue(sidebar.newChatInProject("p1"))
        assertEquals(Triple("a", null, ProjectChange("p1")), api.updates.single())
        assertTrue(api.created.isEmpty())
        assertEquals("p1", chat.state.value.sessions.single().projectId)
    }

    @Test
    fun `new chat in a project creates and opens one when nothing reusable is open`() = runTest(dispatcher) {
        val (chat, sidebar, api) = setup(listOf(SessionSummary("a", "Real title")))
        chat.openSession("a")
        advanceUntilIdle()
        assertTrue(sidebar.newChatInProject("p2"))
        assertEquals(listOf<String?>("p2"), api.created)
        assertEquals("created", chat.state.value.activeSessionId)
        assertEquals("created", chat.state.value.sessions.first().id)
    }

    @Test
    fun `a slow project chat does not pull the user away from a chat opened meanwhile`() = runTest(dispatcher) {
        val (chat, sidebar, api) = setup(listOf(SessionSummary("a", "Real title"), SessionSummary("b", "Other")))
        chat.openSession("a")
        advanceUntilIdle()
        val gate = CompletableDeferred<Unit>()
        api.createGate = gate
        val result = async { sidebar.newChatInProject("p2") }
        advanceUntilIdle()
        chat.openSession("b")
        gate.complete(Unit)
        advanceUntilIdle()
        assertFalse(result.await())
        assertEquals("b", chat.state.value.activeSessionId)
        assertEquals("created", chat.state.value.sessions.first().id)
    }

    @Test
    fun `reorder applies the server positions and a drop on a project unpins it`() = runTest(dispatcher) {
        val (chat, sidebar, api) = setup(listOf(SessionSummary("a", "A", pinned = true), SessionSummary("b", "B")))
        api.reorderResult = listOf(SessionOrderUpdate("a", 1, pinned = false, projectId = null, movedGroup = true), SessionOrderUpdate("b", 0))
        sidebar.reorder(ReorderMove("a", "b", after = true))
        advanceUntilIdle()
        val byId = chat.state.value.sessions.associateBy { it.id }
        assertFalse(byId["a"]!!.pinned)
        assertEquals(1, byId["a"]!!.position)
        sidebar.toggleProject("p1")
        sidebar.dropIntoProject("b", "p1")
        advanceUntilIdle()
        assertEquals(Triple("b", false, ProjectChange("p1")), api.updates.last())
        assertEquals("p1", chat.state.value.sessions.first { it.id == "b" }.projectId)
        assertFalse("p1" in sidebar.state.value.collapsed)
    }

    @Test
    fun `deleting a project keeps its chats under Chats`() = runTest(dispatcher) {
        val (chat, sidebar, _) = setup(listOf(SessionSummary("a", "A", projectId = "p1")))
        assertNull(sidebar.deleteProject("p1"))
        assertEquals(listOf("p2"), sidebar.state.value.projects.map { it.id })
        assertNull(chat.state.value.sessions.single().projectId)
    }

    @Test
    fun `a busy reorder reports the wait message`() = runTest(dispatcher) {
        val (_, sidebar, _) = setup(listOf(SessionSummary("a", "A"), SessionSummary("b", "B")))
        sidebar.reorder(ReorderMove("a", "b", after = true))
        sidebar.reorder(ReorderMove("b", "a", after = true))
        assertEquals(R.string.sb_err_wait_move, sidebar.state.value.reorderError?.second?.fallback)
        advanceUntilIdle()
    }

    @Test
    fun `a refresh that started before a project change does not undo it`() = runTest(dispatcher) {
        val (_, sidebar, _) = setup(emptyList())
        val gate = CompletableDeferred<Unit>()
        projectsApi.gate = gate
        sidebar.refreshProjects()
        advanceUntilIdle()
        assertNull(sidebar.createProject("Three").second)
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("p1", "p2", "new"), sidebar.state.value.projects.map { it.id })
    }

    @Test
    fun `moving the empty open chat into a project keeps the drawer open on failure`() = runTest(dispatcher) {
        val (chat, sidebar, api) = setup(listOf(SessionSummary("a", "New chat")))
        chat.openSession("a")
        advanceUntilIdle()
        api.fail = true
        assertFalse(sidebar.newChatInProject("p1"))
        assertEquals(R.string.sb_err_save_chat, sidebar.state.value.createError?.fallback)
        sidebar.dismissCreateError()
        assertNull(sidebar.state.value.createError)
    }

    @Test
    fun `project settings report a notes failure with the notes message`() = runTest(dispatcher) {
        val (_, sidebar, _) = setup(emptyList())
        projectsApi.notesFail = true
        val error = sidebar.loadProjectSettings("p1").exceptionOrNull()!!
        assertEquals(R.string.sb_err_load_your_notes, sidebar.projectSettingsLoadError(error).fallback)
        assertEquals(R.string.sb_err_load_project_settings, sidebar.projectSettingsLoadError(IOException()).fallback)
    }

    @Test
    fun `only the moving chat is locked and a drop into a project ignores the reorder lock`() = runTest(dispatcher) {
        val (chat, sidebar, _) = setup(listOf(SessionSummary("a", "A"), SessionSummary("b", "B")))
        sidebar.reorder(ReorderMove("a", "b", after = true))
        assertEquals(setOf("a"), sidebar.state.value.moveBusy)
        sidebar.dropIntoProject("b", "p1")
        assertEquals(setOf("a", "b"), sidebar.state.value.moveBusy)
        advanceUntilIdle()
        assertTrue(sidebar.state.value.moveBusy.isEmpty())
        assertFalse(sidebar.state.value.reorderBusy)
        assertEquals("p1", chat.state.value.sessions.first { it.id == "b" }.projectId)
    }
}
