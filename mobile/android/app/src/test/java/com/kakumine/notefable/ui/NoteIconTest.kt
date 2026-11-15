package com.kakumine.notefable.ui

import com.kakumine.notefable.data.NoteGroupSummary
import com.kakumine.notefable.data.NoteIconBackend
import com.kakumine.notefable.data.NotePageSummary
import com.kakumine.notefable.data.NoteTrashItem
import com.kakumine.notefable.data.NotesBackend
import com.kakumine.notefable.data.NotesList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
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
class NoteIconTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class Prefs : NotesPrefs {
        override var collapsedGroups: Set<String> = emptySet()
        override var expandedPages: Set<String> = emptySet()
    }

    private class Notes : NotesBackend {
        override suspend fun notes() = NotesList(listOf(NotePageSummary("a", "Bio", null, version = 3)), emptyList())
        override suspend fun createNote(parentId: String?) = error("unused")
        override suspend fun trashNote(id: String) = listOf(id)
        override suspend fun moveNote(id: String, groupId: String?) = listOf(id)
        override suspend fun moveToPage(id: String, parentId: String?) = emptyList<NotePageSummary>()
        override suspend fun setFavorite(id: String, favorite: Boolean) = error("unused")
        override suspend fun updateSettings(id: String, settings: com.kakumine.notefable.data.NotePageSettings) = error("unused")
        override suspend fun duplicate(id: String) = error("unused")
        override suspend fun reorderNote(id: String, targetId: String, after: Boolean) = emptyList<com.kakumine.notefable.data.NoteOrderUpdate>()
        override suspend fun createGroup(name: String) = NoteGroupSummary("g", name)
        override suspend fun renameGroup(id: String, name: String) = NoteGroupSummary(id, name)
        override suspend fun deleteGroup(id: String) = Unit
        override suspend fun trash() = emptyList<NoteTrashItem>()
        override suspend fun restoreNote(id: String) = error("unused")
        override suspend fun deleteForever(id: String) = listOf(id)
        override suspend fun emptyTrash(before: String) = Unit
        override fun noteEmbedUrl(pageId: String, lang: String?, model: String?, reasoning: String?) = ""
    }

    @Test
    fun `changing a closed note's icon updates the row with the server's icon and version`() = runTest(dispatcher) {
        val calls = mutableListOf<Pair<String, String?>>()
        val vm = NotesViewModel(Notes(), Prefs(), NoteIconBackend { id, icon ->
            calls += id to icon
            NotePageSummary(id, "Bio", icon, version = 4)
        })
        vm.setWorkspace(Workspace.Notes)
        advanceUntilIdle()

        assertTrue(vm.changeIcon("a", "🧬"))
        assertEquals(listOf("a" to "🧬"), calls)
        assertEquals("🧬", vm.state.value.pages.single().icon)
        assertEquals(4, vm.state.value.pages.single().version)
        assertFalse(vm.state.value.iconError)
    }

    @Test
    fun `a failed change keeps the icon and shows the sidebar error until the next try`() = runTest(dispatcher) {
        var fail = true
        val vm = NotesViewModel(Notes(), Prefs(), NoteIconBackend { id, icon ->
            if (fail) throw IOException("offline") else NotePageSummary(id, "Bio", icon)
        })
        vm.setWorkspace(Workspace.Notes)
        advanceUntilIdle()

        assertFalse(vm.changeIcon("a", "🧬"))
        assertEquals(null, vm.state.value.pages.single().icon)
        assertTrue(vm.state.value.iconError)

        fail = false
        assertTrue(vm.changeIcon("a", null))
        assertFalse(vm.state.value.iconError)
    }

    @Test
    fun `icon writes for one note run one at a time and a later pick wins`() = runTest(dispatcher) {
        val calls = mutableListOf<String?>()
        val gates = mutableListOf<CompletableDeferred<Unit>>()
        var version = 3
        val vm = NotesViewModel(Notes(), Prefs(), NoteIconBackend { id, icon ->
            calls += icon
            val gate = CompletableDeferred<Unit>().also { gates += it }
            gate.await()
            NotePageSummary(id, "Bio", icon, version = ++version)
        })
        vm.setWorkspace(Workspace.Notes)
        advanceUntilIdle()

        val results = mutableListOf<Boolean>()
        launch { results += vm.changeIcon("a", "🧬") }
        advanceUntilIdle()
        launch { results += vm.changeIcon("a", "🎲") }
        launch { results += vm.changeIcon("a", "📚") }
        advanceUntilIdle()
        // 第一个还没回来：后面两次只记下最后的选择，不另发请求。
        assertEquals(listOf<String?>("🧬"), calls)

        gates[0].complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf<String?>("🧬", "📚"), calls)
        assertEquals("🧬", vm.state.value.pages.single().icon)

        gates[1].complete(Unit)
        advanceUntilIdle()
        assertEquals("📚", vm.state.value.pages.single().icon)
        assertEquals(5, vm.state.value.pages.single().version)
        assertEquals(listOf(true, true, true), results)
    }

    @Test
    fun `opening a note waits for its pending icon write`() = runTest(dispatcher) {
        val gate = CompletableDeferred<Unit>()
        val vm = NotesViewModel(Notes(), Prefs(), NoteIconBackend { id, icon ->
            gate.await()
            NotePageSummary(id, "Bio", icon, version = 4)
        })
        vm.setWorkspace(Workspace.Notes)
        advanceUntilIdle()

        launch { vm.changeIcon("a", "🧬") }
        advanceUntilIdle()
        vm.openNote("a")
        advanceUntilIdle()
        // PUT 还没回来：编辑器不能先读旧版本。
        assertNull(vm.state.value.open)

        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(OpenNote("a", "Bio", "🧬"), vm.state.value.open)
        assertEquals(4, vm.state.value.pages.single().version)
    }
}
