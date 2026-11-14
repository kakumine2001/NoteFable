package com.kakumine.studymate.ui

import com.kakumine.studymate.data.ApiException
import com.kakumine.studymate.data.NoteGroupSummary
import com.kakumine.studymate.data.NotePageSummary
import com.kakumine.studymate.data.NoteTrashItem
import com.kakumine.studymate.data.NotesBackend
import com.kakumine.studymate.data.NotesList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
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
class NotesViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class MemoryPrefs : NotesPrefs {
        override var collapsedGroups: Set<String> = emptySet()
    }

    private class FakeNotes : NotesBackend {
        var pages = mutableListOf(
            NotePageSummary("a", "Cell structure", "🧬", groupId = "g1", createdAt = "2026-11-14T00:00:01Z"),
            NotePageSummary("b", "Japanese verbs", null, createdAt = "2026-11-14T00:00:00Z"),
        )
        var groups = mutableListOf(NoteGroupSummary("g1", "Biology"))
        var trashed = mutableListOf(NoteTrashItem("t", "Old draft", null, "2026-11-14T00:00:00Z", "2026-12-14T00:00:00Z"))
        val calls = mutableListOf<String>()
        var failNext: Throwable? = null

        /** 按调用名挂起：测试里先放一个 deferred，请求就停在服务端"处理中"，直到 complete。 */
        val holds = mutableMapOf<String, CompletableDeferred<Unit>>()
        private suspend fun hold(name: String) { holds.remove(name)?.await() }

        private fun maybeFail() {
            failNext?.let { failNext = null; throw it }
        }

        override suspend fun notes(): NotesList {
            calls += "notes"; maybeFail()
            // 先取快照再等：模拟服务端在改动之前就读好了列表。
            val snapshot = NotesList(pages.toList(), groups.toList())
            hold("notes")
            return snapshot
        }
        override suspend fun createNote(): NotePageSummary {
            calls += "create"; maybeFail()
            return NotePageSummary("new", "Untitled", null, createdAt = "2026-11-15T00:00:00Z").also { pages.add(0, it) }
        }
        override suspend fun trashNote(id: String) { calls += "trash:$id"; maybeFail(); pages.removeAll { it.id == id } }
        override suspend fun moveNote(id: String, groupId: String?) { calls += "move:$id:$groupId"; maybeFail() }
        override suspend fun createGroup(name: String): NoteGroupSummary { calls += "group:$name"; maybeFail(); hold("group"); return NoteGroupSummary("g2", name, 1) }
        override suspend fun renameGroup(id: String, name: String): NoteGroupSummary { calls += "rename:$id:$name"; maybeFail(); return NoteGroupSummary(id, name) }
        override suspend fun deleteGroup(id: String) { calls += "deleteGroup:$id"; maybeFail() }
        override suspend fun trash(): List<NoteTrashItem> { calls += "trashList"; maybeFail(); return trashed.toList() }
        override suspend fun restoreNote(id: String): NotePageSummary {
            calls += "restore:$id"; maybeFail(); hold("restore")
            return NotePageSummary(id, "Old draft", null, position = 5, createdAt = "2026-11-13T00:00:00Z")
        }
        override suspend fun deleteForever(id: String) { calls += "forever:$id"; maybeFail() }
        override suspend fun emptyTrash(before: String) { calls += "empty:$before"; maybeFail() }
        override fun noteEmbedUrl(pageId: String, lang: String?, model: String?, reasoning: String?) = "https://example.test/note-embed?page=$pageId&lang=$lang"
    }

    private fun TestScope.notesVm(backend: FakeNotes = FakeNotes(), prefs: NotesPrefs = MemoryPrefs()): NotesViewModel {
        val vm = NotesViewModel(backend, prefs)
        vm.setWorkspace(Workspace.Notes)
        advanceUntilIdle()
        return vm
    }

    @Test
    fun `switching to notes loads pages and groups and splits loose notes`() = runTest(dispatcher) {
        val vm = notesVm()
        val state = vm.state.value
        assertEquals(Workspace.Notes, state.workspace)
        assertTrue(state.loaded)
        assertEquals(listOf("a"), state.members("g1").map { it.id })
        assertEquals(listOf("b"), state.loosePages.map { it.id })
    }

    @Test
    fun `notes in a group that no longer exists count as loose`() = runTest(dispatcher) {
        val backend = FakeNotes().apply { groups.clear() }
        val vm = notesVm(backend)
        assertEquals(listOf("a", "b"), vm.state.value.loosePages.map { it.id })
    }

    @Test
    fun `load failure keeps the server message`() = runTest(dispatcher) {
        val backend = FakeNotes().apply { failNext = ApiException(503, "Database is unavailable.") }
        val vm = notesVm(backend)
        assertEquals(NotesError(NotesError.Kind.Load, "Database is unavailable."), vm.state.value.error)
        assertFalse(vm.state.value.loaded)
    }

    @Test
    fun `network failure falls back to the web copy`() = runTest(dispatcher) {
        val backend = FakeNotes().apply { failNext = IOException("timeout") }
        val vm = notesVm(backend)
        assertEquals(NotesError(NotesError.Kind.Load, null), vm.state.value.error)
    }

    @Test
    fun `creating a note opens it`() = runTest(dispatcher) {
        val vm = notesVm()
        vm.createNote()
        advanceUntilIdle()
        assertEquals("new", vm.state.value.open?.id)
        assertEquals("new", vm.state.value.pages.first().id)
        assertFalse(vm.state.value.busy)
    }

    @Test
    fun `leaving a note waits for the editor to save`() = runTest(dispatcher) {
        val vm = notesVm()
        vm.openNote("a")
        advanceUntilIdle()
        var flushes = 0
        vm.flushEditor = { flushes++; FlushResult(true) }
        vm.closeNote()
        advanceUntilIdle()
        assertEquals(1, flushes)
        assertNull(vm.state.value.open)
    }

    @Test
    fun `an unsaved draft keeps the note open and shows the notice`() = runTest(dispatcher) {
        val vm = notesVm()
        vm.openNote("a")
        advanceUntilIdle()
        vm.flushEditor = { FlushResult(false) }
        vm.openNote("b")
        advanceUntilIdle()
        assertEquals("a", vm.state.value.open?.id)
        assertEquals(NotesError.Kind.UnsavedDraft, vm.state.value.notice?.kind)

        vm.setWorkspace(Workspace.Chat)
        advanceUntilIdle()
        assertEquals(Workspace.Notes, vm.state.value.workspace)

        vm.flushEditor = { throw IOException("webview gone") }
        vm.closeNote()
        advanceUntilIdle()
        assertEquals("a", vm.state.value.open?.id)
    }

    @Test
    fun `switching to chat after saving closes the note`() = runTest(dispatcher) {
        val vm = notesVm()
        vm.openNote("b")
        advanceUntilIdle()
        vm.flushEditor = { FlushResult(true) }
        vm.setWorkspace(Workspace.Chat)
        advanceUntilIdle()
        assertEquals(Workspace.Chat, vm.state.value.workspace)
        assertNull(vm.state.value.open)
    }

    @Test
    fun `setWorkspace runs its continuation only after actually switching`() = runTest(dispatcher) {
        val vm = notesVm()
        var ran = 0
        // 已在目标工作区：立即执行。
        vm.setWorkspace(vm.state.value.workspace) { ran++ }
        assertEquals(1, ran)

        vm.openNote("a")
        advanceUntilIdle()
        vm.flushEditor = { FlushResult(false) }
        vm.setWorkspace(Workspace.Chat) { ran++ }
        advanceUntilIdle()
        assertEquals(Workspace.Notes, vm.state.value.workspace)
        assertEquals(1, ran)

        vm.flushEditor = { FlushResult(true) }
        vm.setWorkspace(Workspace.Chat) { ran++ }
        advanceUntilIdle()
        assertEquals(Workspace.Chat, vm.state.value.workspace)
        assertEquals(2, ran)
    }

    @Test
    fun `editor meta updates the open note and the list live`() = runTest(dispatcher) {
        val vm = notesVm()
        vm.openNote("b")
        advanceUntilIdle()
        vm.onEditorMeta("b", "動詞", "📘")
        vm.onEditorSaveState("b", "saving")
        assertEquals(OpenNote("b", "動詞", "📘"), vm.state.value.open)
        assertEquals("動詞", vm.state.value.pages.first { it.id == "b" }.title)
        assertEquals("saving", vm.state.value.saveState)

        // 别的笔记发来的状态不算。
        vm.onEditorSaveState("a", "error")
        assertEquals("saving", vm.state.value.saveState)
    }

    @Test
    fun `missing page closes the editor without flushing and refreshes`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.openNote("a")
        advanceUntilIdle()
        vm.flushEditor = { error("must not flush a missing page") }
        backend.calls.clear()
        vm.onEditorMissing("a")
        advanceUntilIdle()
        assertNull(vm.state.value.open)
        assertEquals(listOf("notes"), backend.calls)
    }

    @Test
    fun `trashing the open note saves it first and refuses when it cannot`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.openNote("a")
        advanceUntilIdle()
        vm.flushEditor = { FlushResult(false) }
        assertFalse(vm.trashNote("a"))
        assertEquals(NotesError.Kind.TrashUnsaved, vm.state.value.error?.kind)
        assertFalse("trash:a" in backend.calls)

        vm.flushEditor = { FlushResult(true) }
        assertTrue(vm.trashNote("a"))
        assertNull(vm.state.value.open)
        assertEquals(listOf("b"), vm.state.value.pages.map { it.id })
    }

    @Test
    fun `group actions update the list and report failures without changing it`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)

        assertEquals("g2", vm.createGroup("Language")?.id)
        assertTrue(vm.moveNote("b", "g2"))
        assertEquals(listOf("b"), vm.state.value.members("g2").map { it.id })
        assertTrue(vm.renameGroup("g2", "Japanese"))
        assertEquals("Japanese", vm.state.value.groups.last().name)

        backend.failNext = ApiException(400, "You can have at most 30 groups.")
        assertNull(vm.createGroup("Too many"))
        assertEquals("You can have at most 30 groups.", vm.state.value.groupError?.detail)
        assertEquals(2, vm.state.value.groups.size)

        assertTrue(vm.deleteGroup("g1"))
        assertNull(vm.state.value.groupError)
        assertNull(vm.state.value.pages.first { it.id == "a" }.groupId)
    }

    @Test
    fun `collapsed groups are remembered`() = runTest(dispatcher) {
        val prefs = MemoryPrefs()
        val vm = notesVm(prefs = prefs)
        vm.toggleGroup("g1")
        assertEquals(setOf("g1"), prefs.collapsedGroups)
        assertEquals(setOf("g1"), NotesViewModel(FakeNotes(), prefs).state.value.collapsed)
        vm.toggleGroup("g1")
        assertTrue(prefs.collapsedGroups.isEmpty())
    }

    @Test
    fun `trash restore, delete forever and empty use the server contract`() = runTest(dispatcher) {
        val backend = FakeNotes().apply {
            trashed.add(0, NoteTrashItem("t2", "Newer", null, "2026-11-14T05:00:00Z", "2026-12-14T05:00:00Z"))
        }
        val vm = notesVm(backend)
        vm.openTrash()
        advanceUntilIdle()
        assertEquals(listOf("t2", "t"), vm.state.value.trash?.items?.map { it.id })

        vm.restore("t")
        advanceUntilIdle()
        assertEquals(listOf("t2"), vm.state.value.trash?.items?.map { it.id })
        assertTrue(vm.state.value.pages.any { it.id == "t" })

        vm.confirmDeleteForever("t2")
        vm.deleteForever("t2")
        advanceUntilIdle()
        assertNull(vm.state.value.trash?.confirmId)
        assertEquals(emptyList<NoteTrashItem>(), vm.state.value.trash?.items)

        vm.closeTrash()
        vm.openTrash()
        advanceUntilIdle()
        vm.emptyTrash()
        advanceUntilIdle()
        assertTrue("empty:2026-11-14T05:00:00Z" in backend.calls)
        assertEquals(emptyList<NoteTrashItem>(), vm.state.value.trash?.items)
    }

    @Test
    fun `trash load failure can be retried`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        backend.failNext = IOException("offline")
        vm.openTrash()
        advanceUntilIdle()
        assertEquals(NotesError.Kind.TrashLoad, vm.state.value.trash?.loadError?.kind)
        vm.loadTrash()
        advanceUntilIdle()
        assertNull(vm.state.value.trash?.loadError)
        assertEquals(1, vm.state.value.trash?.items?.size)
    }

    @Test
    fun `a kept draft lets the user leave on the second try but a conflict does not`() = runTest(dispatcher) {
        val vm = notesVm()
        vm.openNote("a")
        advanceUntilIdle()
        vm.flushEditor = { FlushResult(false, draftKept = true) }
        vm.setWorkspace(Workspace.Chat)
        advanceUntilIdle()
        assertEquals("a", vm.state.value.open?.id)
        assertEquals(NotesError.Kind.UnsavedDraft, vm.state.value.notice?.kind)
        vm.setWorkspace(Workspace.Chat)
        advanceUntilIdle()
        assertEquals(Workspace.Chat, vm.state.value.workspace)
        assertNull(vm.state.value.open)

        vm.setWorkspace(Workspace.Notes)
        advanceUntilIdle()
        vm.openNote("a")
        advanceUntilIdle()
        vm.flushEditor = { FlushResult(false) }
        vm.closeNote()
        advanceUntilIdle()
        vm.closeNote()
        advanceUntilIdle()
        assertEquals("a", vm.state.value.open?.id)
    }

    @Test
    fun `leaving goes ahead when the editor closed itself while saving`() = runTest(dispatcher) {
        val vm = notesVm()
        vm.openNote("a")
        advanceUntilIdle()
        vm.flushEditor = { vm.onEditorMissing("a"); FlushResult(false) }
        vm.openNote("b")
        advanceUntilIdle()
        assertEquals("b", vm.state.value.open?.id)
    }

    @Test
    fun `ready with another page id follows the saved copy without touching the original`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.openNote("a")
        advanceUntilIdle()
        val originalTitle = vm.state.value.pages.first { it.id == "a" }.title
        backend.pages.add(NotePageSummary("copy", "A (copy)", null, createdAt = "2026-11-16T00:00:00Z"))
        vm.onEditorReady("a", "copy", "A (copy)", null)
        assertEquals(OpenNote("copy", "A (copy)", null, editor = "a"), vm.state.value.open)
        assertEquals(originalTitle, vm.state.value.pages.first { it.id == "a" }.title)

        // 之后同一个编辑器发来的消息都算到副本上。
        vm.onEditorMeta("a", "Renamed copy", null)
        vm.onEditorSaveState("a", "saved")
        advanceUntilIdle()
        assertEquals("Renamed copy", vm.state.value.open?.title)
        assertEquals(originalTitle, vm.state.value.pages.first { it.id == "a" }.title)
        assertTrue(vm.state.value.pages.any { it.id == "copy" })
        assertEquals("saved", vm.state.value.saveState)

        // 打开原来那篇不再被当成"已经开着"。
        vm.flushEditor = { FlushResult(true) }
        vm.openNote("a")
        advanceUntilIdle()
        assertEquals(OpenNote("a", originalTitle, vm.state.value.pages.first { it.id == "a" }.icon), vm.state.value.open)
    }

    @Test
    fun `identity change saves the open note first and drops a pending navigation`() = runTest(dispatcher) {
        val vm = notesVm()
        vm.openNote("a")
        advanceUntilIdle()
        var flushes = 0
        vm.flushEditor = { flushes++; FlushResult(true) }
        vm.flushBeforeIdentityChange()
        assertEquals(1, flushes)

        val gate = kotlinx.coroutines.CompletableDeferred<FlushResult>()
        vm.flushEditor = { gate.await() }
        vm.openNote("b")
        runCurrent()
        vm.onIdentityChanged()
        gate.complete(FlushResult(true))
        advanceUntilIdle()
        assertNull(vm.state.value.open)
    }

    @Test
    fun `identity change clears the open note and reloads`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.openNote("a")
        advanceUntilIdle()
        backend.pages.clear()
        vm.onIdentityChanged()
        advanceUntilIdle()
        assertNull(vm.state.value.open)
        assertTrue(vm.state.value.pages.isEmpty())
        assertEquals(Workspace.Notes, vm.state.value.workspace)
    }

    @Test
    fun `a trash restore that finishes after an identity change is dropped`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.openTrash()
        advanceUntilIdle()
        backend.holds["restore"] = CompletableDeferred()
        vm.restore("t")
        runCurrent()
        assertTrue(vm.state.value.trash!!.busy)

        vm.onIdentityChanged()
        advanceUntilIdle()
        assertNull(vm.state.value.trash)
        assertFalse(vm.state.value.pages.any { it.id == "t" })
    }

    @Test
    fun `a project created under the old identity is not added to the new one`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        val gate = CompletableDeferred<Unit>()
        backend.holds["group"] = gate
        val created = async { vm.createGroup("Physics") }
        runCurrent()

        vm.onIdentityChanged()
        advanceUntilIdle()
        gate.complete(Unit)
        advanceUntilIdle()

        assertNull(created.await())
        assertEquals(listOf("g1"), vm.state.value.groups.map { it.id })
        assertNull(vm.state.value.groupError)
    }

    @Test
    fun `a refresh that started before a new note was created reads the list again`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        val gate = CompletableDeferred<Unit>()
        backend.holds["notes"] = gate
        vm.refresh()
        runCurrent()

        vm.createNote()
        advanceUntilIdle()
        assertEquals("new", vm.state.value.open?.id)

        gate.complete(Unit)
        advanceUntilIdle()
        assertTrue(vm.state.value.pages.any { it.id == "new" })
        assertEquals(3, backend.calls.count { it == "notes" })
    }

    @Test
    fun `a refresh without mutations in between is used as is`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.refresh()
        advanceUntilIdle()
        assertEquals(2, backend.calls.count { it == "notes" })
    }
}
