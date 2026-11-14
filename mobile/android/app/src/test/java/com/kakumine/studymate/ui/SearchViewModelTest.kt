package com.kakumine.studymate.ui

import com.kakumine.studymate.data.ChatProjectSummary
import com.kakumine.studymate.data.ChatSearchResult
import com.kakumine.studymate.data.NoteSearchResult
import com.kakumine.studymate.data.SearchResponse
import com.kakumine.studymate.data.SearchScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class SearchViewModelTest {
    private data class Call(val query: String, val scope: SearchScope, val projectId: String?)

    private val projects = listOf(ChatProjectSummary("p1", "One"), ChatProjectSummary("p2", "Two"))
    private fun response(query: String) = SearchResponse(
        query,
        notes = listOf(NoteSearchResult("n1", "Note $query")),
        chats = listOf(ChatSearchResult("c1", "Chat $query", projectId = "p2")),
    )

    @Test
    fun `waits 250ms after typing stops and searches only the latest input`() = runTest {
        val calls = mutableListOf<Call>()
        val vm = SearchViewModel(backgroundScope, { q, s, p -> calls += Call(q, s, p); response(q) })
        vm.setInput("ap")
        advanceTimeBy(200)
        vm.setInput("  api  ")
        advanceTimeBy(249)
        runCurrent()
        assertTrue(calls.isEmpty())
        assertTrue(vm.state.value.view(projects, null, true).loading)
        advanceTimeBy(2)
        runCurrent()
        assertEquals(listOf(Call("api", SearchScope.All, null)), calls)
        val view = vm.state.value.view(projects, null, true)
        assertFalse(view.loading)
        assertEquals(listOf(true, false), view.groups.map { it.isChats })
        assertEquals(listOf("api"), view.terms)
        // 在笔记界面时 Notes 在前。
        assertEquals(listOf(false, true), vm.state.value.view(projects, null, false).groups.map { it.isChats })
    }

    @Test
    fun `keeps the previous results while a new search runs and drops late stale answers`() = runTest {
        val gates = mutableMapOf<String, CompletableDeferred<SearchResponse>>()
        val vm = SearchViewModel(backgroundScope, { q, _, _ -> gates.getOrPut(q) { CompletableDeferred() }.await() })
        vm.setInput("a")
        advanceTimeBy(300)
        gates["a"]!!.complete(response("a"))
        runCurrent()
        vm.setInput("ab")
        advanceTimeBy(300)
        runCurrent()
        val stale = vm.state.value.view(projects, null, true)
        assertTrue(stale.loading)
        assertEquals("a", stale.data?.query)
        vm.setInput("abc")
        // "ab" 的请求被取消；即使晚到也不会写回。
        gates["ab"]!!.complete(response("ab"))
        advanceTimeBy(300)
        gates["abc"]!!.complete(response("abc"))
        runCurrent()
        assertEquals("abc", vm.state.value.view(projects, null, true).data?.query)
    }

    @Test
    fun `a failed search shows the failure and retry searches again`() = runTest {
        var fail = true
        var count = 0
        val vm = SearchViewModel(backgroundScope, { q, _, _ -> count++; if (fail) throw IOException("down") else response(q) })
        vm.setInput("x")
        advanceTimeBy(300)
        runCurrent()
        val failed = vm.state.value.view(projects, null, true)
        assertTrue(failed.failed)
        assertNull(failed.data)
        fail = false
        vm.retry()
        advanceTimeBy(300)
        runCurrent()
        assertEquals(2, count)
        assertFalse(vm.state.value.view(projects, null, true).failed)
    }

    @Test
    fun `the project filter applies only on the Chats tab and only to existing projects`() = runTest {
        val calls = mutableListOf<Call>()
        val vm = SearchViewModel(backgroundScope, { q, s, p -> calls += Call(q, s, p); response(q) })
        vm.setProjects(projects)
        vm.setInput("x")
        vm.setProject("p1")
        advanceTimeBy(300)
        runCurrent()
        vm.setScope(SearchScope.Chats)
        advanceTimeBy(300)
        runCurrent()
        vm.setProject("gone")
        advanceTimeBy(300)
        runCurrent()
        assertEquals(
            listOf(Call("x", SearchScope.All, null), Call("x", SearchScope.Chats, "p1"), Call("x", SearchScope.Chats, null)),
            calls,
        )
        val view = vm.state.value.view(projects, "p2", true)
        assertEquals(listOf("p2", "p1"), view.projectOptions.map { it.id })
        assertEquals(listOf(true), view.groups.map { it.isChats })
        assertEquals("Two", view.projectNames["p2"])
    }

    @Test
    fun `empty input stays idle without a request`() = runTest {
        var count = 0
        val vm = SearchViewModel(backgroundScope, { q, _, _ -> count++; response(q) })
        vm.setInput("   ")
        advanceTimeBy(1000)
        runCurrent()
        assertEquals(0, count)
        assertTrue(vm.state.value.view(projects, null, true).idle)
    }
}
