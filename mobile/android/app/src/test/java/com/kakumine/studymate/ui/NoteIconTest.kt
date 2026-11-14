package com.kakumine.studymate.ui

import com.kakumine.studymate.data.NoteGroupSummary
import com.kakumine.studymate.data.NoteIconBackend
import com.kakumine.studymate.data.NotePageSummary
import com.kakumine.studymate.data.NoteTrashItem
import com.kakumine.studymate.data.NotesBackend
import com.kakumine.studymate.data.NotesList
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    }

    private class Notes : NotesBackend {
        override suspend fun notes() = NotesList(listOf(NotePageSummary("a", "Bio", null, version = 3)), emptyList())
        override suspend fun createNote() = error("unused")
        override suspend fun trashNote(id: String) = Unit
        override suspend fun moveNote(id: String, groupId: String?) = Unit
        override suspend fun createGroup(name: String) = NoteGroupSummary("g", name)
        override suspend fun renameGroup(id: String, name: String) = NoteGroupSummary(id, name)
        override suspend fun deleteGroup(id: String) = Unit
        override suspend fun trash() = emptyList<NoteTrashItem>()
        override suspend fun restoreNote(id: String) = error("unused")
        override suspend fun deleteForever(id: String) = Unit
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
}
