package com.kakumine.notefable.ui

import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.ExportedNote
import com.kakumine.notefable.data.ImportCandidate
import com.kakumine.notefable.data.ImportMarkdownFile
import com.kakumine.notefable.data.NoteImport
import com.kakumine.notefable.data.NoteGroupSummary
import com.kakumine.notefable.data.NotePageSummary
import com.kakumine.notefable.data.NoteTrashItem
import com.kakumine.notefable.data.NotesBackend
import com.kakumine.notefable.data.NotesList
import com.kakumine.notefable.data.PageKind
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
        override var expandedPages: Set<String> = emptySet()
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
        override suspend fun createNote(parentId: String?): NotePageSummary {
            calls += if (parentId == null) "create" else "create:$parentId"; maybeFail()
            val group = parentId?.let { id -> pages.firstOrNull { it.id == id }?.groupId }
            return NotePageSummary("new", "Untitled", null, createdAt = "2026-11-15T00:00:00Z", parentId = parentId, groupId = group).also { pages.add(0, it) }
        }
        /** 子页面一起移进回收站（服务端的 ids）。 */
        override suspend fun trashNote(id: String): List<String> {
            calls += "trash:$id"; maybeFail()
            val ids = mutableListOf(id)
            var index = 0
            while (index < ids.size) { val parent = ids[index++]; ids += pages.filter { it.parentId == parent }.map { it.id } }
            pages.removeAll { it.id in ids }
            return ids
        }
        override suspend fun moveNote(id: String, groupId: String?): List<String> {
            calls += "move:$id:$groupId"; maybeFail()
            return listOf(id) + pages.filter { it.parentId == id }.map { it.id }
        }
        override suspend fun moveToPage(id: String, parentId: String?): List<NotePageSummary> {
            calls += "parent:$id:$parentId"; maybeFail()
            val group = pages.firstOrNull { it.id == parentId }?.groupId
            return pages.filter { it.id == id || it.parentId == id }.map { if (it.id == id) it.copy(parentId = parentId, groupId = group) else it.copy(groupId = group) }
        }
        override suspend fun setFavorite(id: String, favorite: Boolean): NotePageSummary {
            calls += "favorite:$id:$favorite"; maybeFail()
            return pages.first { it.id == id }.copy(favoritedAt = if (favorite) "2026-11-16T00:00:00Z" else null)
        }
        override suspend fun updateSettings(id: String, settings: com.kakumine.notefable.data.NotePageSettings): NotePageSummary {
            calls += "settings:$id"; maybeFail(); hold("settings:${settings.font ?: ""}")
            val page = pages.first { it.id == id }
            return page.copy(fullWidth = settings.fullWidth ?: page.fullWidth, smallText = settings.smallText ?: page.smallText,
                font = settings.font ?: page.font, locked = settings.locked ?: page.locked)
        }
        override suspend fun duplicate(id: String): com.kakumine.notefable.data.DuplicateResult {
            calls += "duplicate:$id"; maybeFail()
            val copy = pages.first { it.id == id }.copy(id = "copy", title = "Copy (1)")
            return com.kakumine.notefable.data.DuplicateResult(copy, listOf(copy), listOf(
                com.kakumine.notefable.data.NoteOrderUpdate("a", 1), com.kakumine.notefable.data.NoteOrderUpdate("copy", 2), com.kakumine.notefable.data.NoteOrderUpdate("b", 3),
            ))
        }
        /** 模拟服务端：b 放到 a 前面，b 跟着 a 进 g1。 */
        override suspend fun reorderNote(id: String, targetId: String, after: Boolean): List<com.kakumine.notefable.data.NoteOrderUpdate> {
            calls += "reorder:$id:$targetId:$after"; maybeFail(); hold("reorder")
            return listOf(
                com.kakumine.notefable.data.NoteOrderUpdate("b", 1, "g1", movedGroup = true),
                com.kakumine.notefable.data.NoteOrderUpdate("a", 2),
            )
        }
        override suspend fun createGroup(name: String): NoteGroupSummary { calls += "group:$name"; maybeFail(); hold("group"); return NoteGroupSummary("g2", name, 1) }
        override suspend fun renameGroup(id: String, name: String): NoteGroupSummary { calls += "rename:$id:$name"; maybeFail(); return NoteGroupSummary(id, name) }
        override suspend fun deleteGroup(id: String) { calls += "deleteGroup:$id"; maybeFail() }
        override suspend fun trash(): List<NoteTrashItem> { calls += "trashList"; maybeFail(); return trashed.toList() }
        override suspend fun restoreNote(id: String): List<NotePageSummary> {
            calls += "restore:$id"; maybeFail(); hold("restore")
            return listOf(NotePageSummary(id, "Old draft", null, position = 5, createdAt = "2026-11-13T00:00:00Z"))
        }
        override suspend fun deleteForever(id: String): List<String> { calls += "forever:$id"; maybeFail(); return listOf(id) }
        override suspend fun emptyTrash(before: String) { calls += "empty:$before"; maybeFail() }
        var exported = ExportedNote("Cell structure.md", "# Cell structure\n\nBody\n")
        override suspend fun exportNote(id: String): ExportedNote { calls += "export:$id"; maybeFail(); return exported }
        var imported: List<ImportMarkdownFile> = emptyList()
        /** 最近一次导入请求带的 groupId；"unset" 表示还没导入过。 */
        var importedGroup: String? = "unset"
        /** 模拟服务端：每个文件一篇，新建的排在最前面（position 更小），放进请求指定的项目。 */
        override suspend fun importMarkdown(files: List<ImportMarkdownFile>, groupId: String?): List<NotePageSummary> {
            calls += "import:" + files.joinToString(",") { it.name }; maybeFail(); hold("import")
            imported = files
            importedGroup = groupId
            return files.mapIndexed { index, file ->
                NotePageSummary("imp$index", file.name.substringBeforeLast('.'), null, position = index - files.size, createdAt = "2026-11-20T00:00:0${index}Z", groupId = groupId)
            }.also { pages.addAll(0, it) }
        }
        override fun noteEmbedUrl(pageId: String, lang: String?, model: String?, reasoning: String?, theme: String?) = "https://example.test/note-embed?page=$pageId&lang=$lang"
    }

    private fun markdownFile(name: String, text: String = "# $name", size: Long? = text.toByteArray().size.toLong()) = ImportCandidate(name, size) { text }

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
    fun `the open page takes its kind from the list, a search result or the editor`() = runTest(dispatcher) {
        val backend = FakeNotes().apply {
            pages.add(NotePageSummary("w", "Board", null, createdAt = "2026-11-13T00:00:00Z", kind = PageKind.Whiteboard))
        }
        val vm = notesVm(backend)
        vm.flushEditor = { FlushResult(true) }
        vm.openNote("w")
        advanceUntilIdle()
        assertEquals(OpenNote("w", "Board", null, kind = PageKind.Whiteboard), vm.state.value.open)

        // 列表里没有（检索结果，列表可能还没读过）：用结果带的类型。
        vm.openNote("s", "Deck", null, PageKind.Slides)
        advanceUntilIdle()
        assertEquals(OpenNote("s", "Deck", null, kind = PageKind.Slides), vm.state.value.open)
        // 网页的 ready 不带类型（旧网页）时保留已知的；带着时以它为准。
        vm.onEditorReady("s", "s", "Deck", null)
        assertEquals(PageKind.Slides, vm.state.value.open?.kind)
        vm.onEditorReady("s", "s", "Deck", null, PageKind.Whiteboard)
        assertEquals(PageKind.Whiteboard, vm.state.value.open?.kind)

        // 复制白板：打开的复制件也是白板。
        vm.openNote("w")
        advanceUntilIdle()
        vm.duplicate("w")
        advanceUntilIdle()
        assertEquals(OpenNote("copy", "Copy (1)", null, kind = PageKind.Whiteboard), vm.state.value.open)
    }

    @Test
    fun `the ready message corrects the kind of the list entry too, and a stale editor changes nothing`() = runTest(dispatcher) {
        // 旧服务端没返回类型的列表（仍是 Note）也按网页 ready 带来的类型改正；别的编辑器的 ready 不改。
        val backend = FakeNotes().apply { pages.add(NotePageSummary("w", "Board", null, createdAt = "2026-11-13T00:00:00Z")) }
        val vm = notesVm(backend)
        vm.flushEditor = { FlushResult(true) }
        vm.openNote("w")
        advanceUntilIdle()
        vm.onEditorReady("other", "w", "Board", null, PageKind.Whiteboard)
        assertEquals(PageKind.Note, vm.state.value.open?.kind)
        assertEquals(PageKind.Note, vm.state.value.pages.single { it.id == "w" }.kind)
        vm.onEditorReady("w", "w", "Board", null, PageKind.Whiteboard)
        assertEquals(PageKind.Whiteboard, vm.state.value.open?.kind)
        assertEquals(PageKind.Whiteboard, vm.state.value.pages.single { it.id == "w" }.kind)
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

    @Test
    fun `reorder applies the server order and moves the dragged note into the target project`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.reorder(ReorderMove("b", "a", after = false))
        assertTrue(vm.state.value.reorderBusy)
        assertTrue("b" in vm.state.value.moveBusy)
        advanceUntilIdle()
        val state = vm.state.value
        assertEquals(listOf("b", "a"), state.pages.map { it.id })
        assertEquals("g1", state.pages.first { it.id == "b" }.groupId)
        assertEquals(listOf("b", "a"), state.members("g1").map { it.id })
        assertFalse(state.reorderBusy)
        assertTrue(state.moveBusy.isEmpty())
        assertNull(state.reorderError)
        assertTrue("reorder:b:a:false" in backend.calls)
    }

    @Test
    fun `a second reorder while one is running asks to wait`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        val gate = CompletableDeferred<Unit>()
        backend.holds["reorder"] = gate
        vm.reorder(ReorderMove("b", "a", after = false))
        runCurrent()
        vm.reorder(ReorderMove("a", "b", after = true))
        assertEquals(ReorderFailure("a", wait = true), vm.state.value.reorderError)
        assertEquals(1, backend.calls.count { it.startsWith("reorder:") })
        gate.complete(Unit)
        advanceUntilIdle()
        assertFalse(vm.state.value.reorderBusy)
    }

    @Test
    fun `failed reorder keeps the list and shows the server message on that row`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        val before = vm.state.value.pages
        backend.failNext = ApiException(404, "Item not found.")
        vm.reorder(ReorderMove("b", "a", after = false))
        advanceUntilIdle()
        assertEquals(before, vm.state.value.pages)
        assertEquals(ReorderFailure("b", "Item not found."), vm.state.value.reorderError)
        vm.dismissReorderError()
        assertNull(vm.state.value.reorderError)
    }

    @Test
    fun `network failure while reordering uses the generic message`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        backend.failNext = IOException("offline")
        vm.reorder(ReorderMove("b", "a", after = true))
        advanceUntilIdle()
        assertEquals(ReorderFailure("b"), vm.state.value.reorderError)
    }

    @Test
    fun `dropping on a project moves the note and expands a collapsed project`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val prefs = MemoryPrefs().apply { collapsedGroups = setOf("g1") }
        val vm = notesVm(backend, prefs)
        vm.dropIntoGroup("b", "g1")
        advanceUntilIdle()
        assertEquals("g1", vm.state.value.pages.first { it.id == "b" }.groupId)
        assertFalse("g1" in vm.state.value.collapsed)
        assertTrue("move:b:g1" in backend.calls)
        // 已经在那个项目里：不发请求。
        vm.dropIntoGroup("b", "g1")
        advanceUntilIdle()
        assertEquals(1, backend.calls.count { it == "move:b:g1" })
        // 拖到 Notes 标签上：移出项目。
        vm.dropIntoGroup("a", null)
        advanceUntilIdle()
        assertNull(vm.state.value.pages.first { it.id == "a" }.groupId)
    }

    @Test
    fun `failed drop into a project leaves the note where it was`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        backend.failNext = IOException("offline")
        vm.dropIntoGroup("b", "g1")
        advanceUntilIdle()
        assertNull(vm.state.value.pages.first { it.id == "b" }.groupId)
        assertEquals(ReorderFailure("b"), vm.state.value.reorderError)
        assertTrue(vm.state.value.moveBusy.isEmpty())
    }

    @Test
    fun `apply order sorts like the web and only moves the dragged note between projects`() {
        val pages = listOf(
            NotePageSummary("x", position = 1, groupId = "g", createdAt = "2026-01-01"),
            NotePageSummary("y", position = 2, createdAt = "2026-01-02"),
            NotePageSummary("z", position = 3, groupId = "g", createdAt = "2026-01-03"),
        )
        val sorted = NotesViewModel.applyOrder(
            pages,
            listOf(
                com.kakumine.notefable.data.NoteOrderUpdate("z", 1, null, movedGroup = true),
                com.kakumine.notefable.data.NoteOrderUpdate("x", 2),
                com.kakumine.notefable.data.NoteOrderUpdate("y", 3),
            ),
        )
        assertEquals(listOf("z", "x", "y"), sorted.map { it.id })
        assertNull(sorted[0].groupId)
        assertEquals("g", sorted[1].groupId)
    }

    @Test
    fun `sub-pages show under their parent, count in the project and go to the trash with it`() = runTest(dispatcher) {
        val backend = FakeNotes()
        backend.pages.add(NotePageSummary("c", "Mitosis", null, groupId = "g1", parentId = "a", createdAt = "2026-11-14T00:00:02Z"))
        val vm = notesVm(backend)
        val state = vm.state.value
        assertEquals(listOf("a"), state.members("g1").map { it.id })
        assertEquals(2, state.memberCount("g1"))
        assertEquals(listOf("c"), state.children("a").map { it.id })
        assertEquals(listOf("a"), state.ancestors("c").map { it.id })
        assertEquals(setOf("c"), state.descendants("a"))
        vm.flushEditor = { FlushResult(true) }
        assertTrue(vm.trashNote("a"))
        assertEquals(listOf("b"), vm.state.value.pages.map { it.id })
    }

    @Test
    fun `a page inside another is created under it and the parent is expanded and remembered`() = runTest(dispatcher) {
        val prefs = MemoryPrefs()
        val vm = notesVm(prefs = prefs)
        vm.createNote("a")
        advanceUntilIdle()
        val page = vm.state.value.pages.first { it.id == "new" }
        assertEquals("a", page.parentId)
        assertEquals("g1", page.groupId)
        assertEquals("new", vm.state.value.open?.id)
        assertTrue("a" in vm.state.value.expanded)
        assertEquals(setOf("a"), prefs.expandedPages)
    }

    @Test
    fun `moving into a project detaches the page and moves its sub-pages`() = runTest(dispatcher) {
        val backend = FakeNotes()
        backend.pages.add(NotePageSummary("c", "Mitosis", null, groupId = "g1", parentId = "a"))
        backend.pages.add(NotePageSummary("d", "Meiosis", null, groupId = "g1", parentId = "c"))
        val vm = notesVm(backend)
        assertTrue(vm.moveNote("c", null))
        val pages = vm.state.value.pages.associateBy { it.id }
        assertNull(pages.getValue("c").parentId)
        assertNull(pages.getValue("c").groupId)
        assertNull(pages.getValue("d").groupId)
        assertEquals("c", pages.getValue("d").parentId)
    }

    @Test
    fun `moving into a page follows the parent's project`() = runTest(dispatcher) {
        val vm = notesVm()
        assertTrue(vm.moveToPage("b", "a"))
        val b = vm.state.value.pages.first { it.id == "b" }
        assertEquals("a", b.parentId)
        assertEquals("g1", b.groupId)
        assertTrue("a" in vm.state.value.expanded)
    }

    @Test
    fun `settings and favorites update the list and reach the open editor`() = runTest(dispatcher) {
        val vm = notesVm()
        vm.openNote("a")
        advanceUntilIdle()
        val pushed = mutableListOf<NotePageSummary>()
        vm.pushPageSettings = { pushed += it }
        assertTrue(vm.updateSettings("a", com.kakumine.notefable.data.NotePageSettings(fullWidth = true, font = "mono", locked = true)))
        assertTrue(vm.setFavorite("b", true))
        val pages = vm.state.value.pages.associateBy { it.id }
        assertTrue(pages.getValue("a").fullWidth)
        assertEquals("mono", pages.getValue("a").font)
        assertTrue(pages.getValue("a").locked)
        assertEquals(listOf("b"), vm.state.value.favorites.map { it.id })
        // 只把打开着的那篇交给编辑器。
        assertEquals(listOf("a"), pushed.map { it.id })
    }

    @Test
    fun `duplicating saves the open page first, adds the copy in the server's order and opens it`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.openNote("a")
        advanceUntilIdle()
        vm.flushEditor = { FlushResult(false) }
        vm.duplicate("a")
        advanceUntilIdle()
        assertFalse("duplicate:a" in backend.calls)
        vm.flushEditor = { FlushResult(true) }
        vm.duplicate("a")
        advanceUntilIdle()
        assertEquals(listOf("a", "copy", "b"), vm.state.value.pages.map { it.id })
        assertEquals("copy", vm.state.value.open?.id)
    }

    @Test
    fun `reorder results can move a page under another parent`() {
        val pages = listOf(NotePageSummary("x", "X", null, position = 1), NotePageSummary("y", "Y", null, position = 2, parentId = "p"))
        val next = NotesViewModel.applyOrder(pages, listOf(
            com.kakumine.notefable.data.NoteOrderUpdate("x", 2, groupId = null, movedGroup = true, parentId = "p", movedParent = true),
            com.kakumine.notefable.data.NoteOrderUpdate("y", 1),
        ))
        assertEquals(listOf("y", "x"), next.map { it.id })
        assertEquals("p", next[1].parentId)
    }

    @Test
    fun `settings for one page are sent one at a time so a late answer cannot undo a newer choice`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        val first = CompletableDeferred<Unit>()
        backend.holds["settings:serif"] = first
        val a = async { vm.updateSettings("a", com.kakumine.notefable.data.NotePageSettings(font = "serif")) }
        val b = async { vm.updateSettings("a", com.kakumine.notefable.data.NotePageSettings(font = "mono")) }
        runCurrent()
        // 第二个请求要等第一个回来才发。
        assertEquals(listOf("settings:a"), backend.calls.filter { it.startsWith("settings") })
        first.complete(Unit)
        a.await(); b.await()
        assertEquals("mono", vm.state.value.pages.first { it.id == "a" }.font)
        assertEquals(2, backend.calls.count { it == "settings:a" })
    }

    // ---- Markdown 导出 / 导入（网页 use-note-pages.ts 的 exportPage / importMarkdown） ----

    @Test
    fun `exporting saves the open page first and refuses while its draft cannot be saved`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.openNote("a")
        advanceUntilIdle()
        vm.flushEditor = { FlushResult(false) }
        assertNull(vm.exportNote("a"))
        assertFalse("export:a" in backend.calls)
        assertEquals(NotesError(NotesError.Kind.ExportUnsaved), vm.state.value.notice)

        var flushed = 0
        vm.flushEditor = { flushed++; FlushResult(true) }
        val exported = vm.exportNote("a")
        assertEquals(1, flushed)
        assertEquals(ExportedNote("Cell structure.md", "# Cell structure\n\nBody\n"), exported)
        assertNull(vm.state.value.notice)
        // 内容留给保存位置选择器：取走一次就没了，别的页面取不到。
        assertNull(vm.takeExport("b"))
        vm.exportNote("a")
        assertEquals("# Cell structure\n\nBody\n", vm.takeExport("a"))
        assertNull(vm.takeExport("a"))
    }

    @Test
    fun `exporting a page that is not open does not touch the editor and falls back to note md`() = runTest(dispatcher) {
        val backend = FakeNotes().apply { exported = ExportedNote("", "# Untitled\n") }
        val vm = notesVm(backend)
        vm.openNote("a")
        advanceUntilIdle()
        vm.flushEditor = { error("must not flush another page") }
        assertEquals("note.md", vm.exportNote("b")?.fileName)
        assertEquals(listOf("export:b"), backend.calls.filter { it.startsWith("export") })
    }

    @Test
    fun `a failed export shows the server's reason or the web sentence`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        backend.failNext = ApiException(404, "Note not found.")
        assertNull(vm.exportNote("a"))
        assertEquals(NotesError(NotesError.Kind.Export, "Note not found."), vm.state.value.notice)
        backend.failNext = IOException("offline")
        assertNull(vm.exportNote("a"))
        assertEquals(NotesError(NotesError.Kind.Export), vm.state.value.notice)
        // 写文件失败是同一句。读不到内容时重新读一次。
        vm.dismissNotice()
        vm.exportFailed()
        assertEquals(NotesError(NotesError.Kind.Export), vm.state.value.notice)
        assertEquals("kept", vm.exportedMarkdown("a", "kept"))
        assertEquals("# Cell structure\n\nBody\n", vm.exportedMarkdown("a", null))
    }

    @Test
    fun `importing adds the new notes to the list and opens the first one`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        val wait = CompletableDeferred<Unit>()
        backend.holds["import"] = wait
        vm.importMarkdown(listOf(markdownFile("Plan.md", "# Plan\n\n- a"), markdownFile("ideas.TXT", "idea")))
        runCurrent()
        // 请求期间和新建一样禁用列表操作。
        assertTrue(vm.state.value.busy)
        wait.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf(ImportMarkdownFile("Plan.md", "# Plan\n\n- a"), ImportMarkdownFile("ideas.TXT", "idea")), backend.imported)
        assertFalse(vm.state.value.busy)
        assertNull(vm.state.value.error)
        assertEquals(listOf("imp0", "imp1", "a", "b"), vm.state.value.pages.map { it.id })
        assertEquals("imp0", vm.state.value.open?.id)
        assertEquals(Workspace.Notes, vm.state.value.workspace)
    }

    @Test
    fun `import limits are checked before anything is read or sent`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        fun unread(name: String, size: Long?) = ImportCandidate(name, size) { error("must not read") }

        vm.importMarkdown(List(NoteImport.MAX_FILES + 1) { unread("n$it.md", 1) })
        assertEquals(NotesError(NotesError.Kind.ImportTooMany), vm.state.value.error)
        vm.importMarkdown(listOf(unread("a.md", 1), unread("photo.png", 1)))
        assertEquals(NotesError(NotesError.Kind.ImportBadType), vm.state.value.error)
        vm.importMarkdown(listOf(unread("big.md", NoteImport.MAX_FILE_BYTES + 1)))
        assertEquals(NotesError(NotesError.Kind.ImportFileTooLarge), vm.state.value.error)
        vm.importMarkdown(List(5) { unread("n$it.markdown", NoteImport.MAX_FILE_BYTES) })
        assertEquals(NotesError(NotesError.Kind.ImportTooLarge), vm.state.value.error)
        advanceUntilIdle()
        assertFalse(vm.state.value.busy)
        assertTrue(backend.calls.none { it.startsWith("import") })
        // 什么都没选：不动。
        vm.importMarkdown(emptyList())
        assertEquals(NotesError(NotesError.Kind.ImportTooLarge), vm.state.value.error)
    }

    @Test
    fun `a file whose size the picker cannot tell is checked after reading`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.importMarkdown(listOf(markdownFile("huge.md", "x".repeat(NoteImport.MAX_FILE_BYTES.toInt() + 1), size = null)))
        advanceUntilIdle()
        assertEquals(NotesError(NotesError.Kind.ImportFileTooLarge), vm.state.value.error)
        assertFalse(vm.state.value.busy)
        assertTrue(backend.calls.none { it.startsWith("import") })
    }

    @Test
    fun `an import whose JSON request is over the limit is not sent`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        // 每个文件、文件合计都没超，但换行在 JSON 里是 2 个字节（网页也在发送前按请求体量）。
        vm.importMarkdown(List(3) { markdownFile("n$it.md", "\n".repeat(NoteImport.MAX_FILE_BYTES.toInt())) })
        advanceUntilIdle()
        assertEquals(NotesError(NotesError.Kind.ImportTooLarge), vm.state.value.error)
        assertFalse(vm.state.value.busy)
        assertTrue(backend.calls.none { it.startsWith("import") })
    }

    @Test
    fun `an import error shown above an open note can be dismissed`() = runTest(dispatcher) {
        val vm = notesVm()
        vm.openNote("a")
        advanceUntilIdle()
        vm.importMarkdown(listOf(markdownFile("photo.png")))
        assertEquals(NotesError(NotesError.Kind.ImportBadType), vm.state.value.error)
        // 提示条先显示 notice：点一次只去掉正在显示的那一条。
        vm.exportFailed()
        vm.dismissNotice()
        assertNull(vm.state.value.notice)
        assertEquals(NotesError(NotesError.Kind.ImportBadType), vm.state.value.error)
        vm.dismissNotice()
        assertNull(vm.state.value.error)
        assertEquals("a", vm.state.value.open?.id)
    }

    @Test
    fun `a failed import keeps the list and shows the reason`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        backend.failNext = ApiException(413, "Import exceeds 4 MB.")
        vm.importMarkdown(listOf(markdownFile("a.md")))
        advanceUntilIdle()
        assertEquals(NotesError(NotesError.Kind.Import, "Import exceeds 4 MB."), vm.state.value.error)
        assertEquals(listOf("a", "b"), vm.state.value.pages.map { it.id })
        assertNull(vm.state.value.open)
        assertFalse(vm.state.value.busy)
        // 文件读不出来也是这句通用的提示，不发请求。
        vm.importMarkdown(listOf(ImportCandidate("gone.md", 3) { throw IOException("revoked") }))
        advanceUntilIdle()
        assertEquals(NotesError(NotesError.Kind.Import), vm.state.value.error)
        assertEquals(1, backend.calls.count { it.startsWith("import") })
    }

    // ---- 导入到哪个项目（网页 page.tsx 的 importMarkdownFiles + ImportTargetDialog） ----

    @Test
    fun `without any project the picked files are imported directly with no groupId`() = runTest(dispatcher) {
        val backend = FakeNotes().apply { groups.clear() }
        val vm = notesVm(backend)
        vm.pickedForImport(listOf(markdownFile("Plan.md")))
        assertFalse(vm.state.value.importTarget)
        advanceUntilIdle()
        assertEquals(listOf("import:Plan.md"), backend.calls.filter { it.startsWith("import") })
        assertNull(backend.importedGroup)
        assertEquals("imp0", vm.state.value.open?.id)
    }

    @Test
    fun `with a project the picked files wait for a destination and the chosen project is sent`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.pickedForImport(listOf(markdownFile("Plan.md"), markdownFile("ideas.txt")))
        advanceUntilIdle()
        // 窗口开着，还没读、没发。
        assertTrue(vm.state.value.importTarget)
        assertNull(vm.state.value.error)
        assertTrue(backend.calls.none { it.startsWith("import") })

        vm.chooseImportTarget("g1")
        assertFalse(vm.state.value.importTarget)
        advanceUntilIdle()
        assertEquals(listOf("import:Plan.md,ideas.txt"), backend.calls.filter { it.startsWith("import") })
        assertEquals("g1", backend.importedGroup)
        assertEquals(listOf("imp0", "imp1", "a"), vm.state.value.members("g1").map { it.id })
        assertEquals("imp0", vm.state.value.open?.id)
    }

    @Test
    fun `choosing No project imports without a groupId and Cancel imports nothing`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.pickedForImport(listOf(markdownFile("a.md")))
        vm.cancelImportTarget()
        assertFalse(vm.state.value.importTarget)
        // 取消后文件不留着：再"选"也不会导入上一次的。
        vm.chooseImportTarget("g1")
        advanceUntilIdle()
        assertTrue(backend.calls.none { it.startsWith("import") })

        vm.pickedForImport(listOf(markdownFile("b.md")))
        vm.chooseImportTarget(null)
        advanceUntilIdle()
        assertEquals(listOf("import:b.md"), backend.calls.filter { it.startsWith("import") })
        assertNull(backend.importedGroup)
        assertEquals(listOf("imp0", "b"), vm.state.value.loosePages.map { it.id })
    }

    @Test
    fun `invalid files show the error and never open the destination dialog`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        fun unread(name: String, size: Long?) = ImportCandidate(name, size) { error("must not read") }

        vm.pickedForImport(List(NoteImport.MAX_FILES + 1) { unread("n$it.md", 1) })
        assertEquals(NotesError(NotesError.Kind.ImportTooMany), vm.state.value.error)
        assertFalse(vm.state.value.importTarget)
        vm.pickedForImport(listOf(unread("photo.png", 1)))
        assertEquals(NotesError(NotesError.Kind.ImportBadType), vm.state.value.error)
        assertFalse(vm.state.value.importTarget)
        vm.pickedForImport(listOf(unread("big.md", NoteImport.MAX_FILE_BYTES + 1)))
        assertEquals(NotesError(NotesError.Kind.ImportFileTooLarge), vm.state.value.error)
        assertFalse(vm.state.value.importTarget)
        // 什么都没选：不出窗口。
        vm.pickedForImport(emptyList())
        assertFalse(vm.state.value.importTarget)
        advanceUntilIdle()
        assertTrue(backend.calls.none { it.startsWith("import") })
        // 合规定的一选，之前的提示清掉、窗口打开（网页 checkImportFiles）。
        vm.pickedForImport(listOf(unread("ok.md", 1)))
        assertNull(vm.state.value.error)
        assertTrue(vm.state.value.importTarget)
    }

    @Test
    fun `files waiting for a destination are dropped when the identity changes`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        vm.pickedForImport(listOf(markdownFile("a.md")))
        assertTrue(vm.state.value.importTarget)
        vm.onIdentityChanged()
        assertFalse(vm.state.value.importTarget)
        advanceUntilIdle()
        vm.chooseImportTarget("g1")
        advanceUntilIdle()
        assertTrue(backend.calls.none { it.startsWith("import") })
    }

    @Test
    fun `an import that finishes after the identity changed is dropped`() = runTest(dispatcher) {
        val backend = FakeNotes()
        val vm = notesVm(backend)
        val wait = CompletableDeferred<Unit>()
        backend.holds["import"] = wait
        vm.importMarkdown(listOf(markdownFile("a.md")))
        runCurrent()
        backend.pages.clear()
        vm.onIdentityChanged()
        wait.complete(Unit)
        advanceUntilIdle()
        assertNull(vm.state.value.open)
        assertFalse(vm.state.value.busy)
    }
}
