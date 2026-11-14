package com.kakumine.studymate.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test

// 网页 page-edit-proposal.tsx 的状态规则：按提案 ID 记在卡片外，服务端已确定的状态优先，失败回到未处理并带错误。
@OptIn(ExperimentalCoroutinesApi::class)
class ProposalStoreTest {
    private val edit = Proposal.Edit("pr1", "p1", "Notes", 2)
    private val create = Proposal.Create("np1", "Plan", null, "- a")

    private class FakeBackend : ProposalBackend {
        val calls = mutableListOf<String>()
        var gate: CompletableDeferred<Unit>? = null
        var fail: Throwable? = null
        var createdId: String? = "new-page"

        override suspend fun apply(proposalId: String): AppliedPage {
            calls += "apply:$proposalId"
            gate?.await()
            fail?.let { throw it }
            return AppliedPage(createdId, createdId?.let { """{"id":"$it","version":3}""" })
        }

        override suspend fun discard(proposalId: String) {
            calls += "discard:$proposalId"
            gate?.await()
            fail?.let { throw it }
        }
    }

    @Test
    fun `applying shows a spinner, then Applied with the note to open, and announces the change`() = runTest {
        val backend = FakeBackend().apply { gate = CompletableDeferred() }
        val store = ProposalStore(backend, this)
        val changes = mutableListOf<ProposalChangeEvent>()
        val collector = backgroundScope.launchCollect(store, changes)
        store.apply(edit)
        assertEquals(ProposalState.Status.Applying, store.stateOf(edit).status)
        // 处理中再点不会重复请求。
        store.apply(edit)
        store.discard(edit)
        backend.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("apply:pr1"), backend.calls)
        assertEquals(ProposalState(ProposalState.Status.Applied, pageId = "p1"), store.stateOf(edit))
        // 服务端返回的新版本跟着事件走，打开着的编辑器用它换成新版本。
        assertEquals(listOf(ProposalChangeEvent("p1", created = false, page = """{"id":"new-page","version":3}""")), changes)
        collector.cancel()
    }

    @Test
    fun `a created note opens the page the server made`() = runTest {
        val store = ProposalStore(FakeBackend(), this)
        store.apply(create)
        advanceUntilIdle()
        assertEquals(ProposalState(ProposalState.Status.Applied, pageId = "new-page"), store.stateOf(create))
    }

    @Test
    fun `a failure goes back to idle with the server message`() = runTest {
        val backend = FakeBackend().apply { fail = ProposalException("The note changed since this edit was proposed.") }
        val store = ProposalStore(backend, this)
        store.apply(edit)
        advanceUntilIdle()
        val state = store.stateOf(edit)
        assertEquals(ProposalState.Status.Idle, state.status)
        assertEquals(ProposalError(ProposalError.Action.Apply, "The note changed since this edit was proposed."), state.error)
        // 网络错误没有服务端原句，界面用本地的"无法应用"。
        backend.fail = java.io.IOException("offline")
        store.discard(edit)
        advanceUntilIdle()
        assertEquals(ProposalError(ProposalError.Action.Discard, null), store.stateOf(edit).error)
    }

    @Test
    fun `the status saved on the server wins over local state`() = runTest {
        val backend = FakeBackend().apply { fail = ProposalException("x") }
        val store = ProposalStore(backend, this)
        store.apply(edit)
        advanceUntilIdle()
        val reloaded = edit.copy(status = "discarded")
        assertEquals(ProposalState(ProposalState.Status.Discarded, pageId = "p1"), store.stateOf(reloaded))
        // 已确定的提案不再发请求。
        store.apply(reloaded)
        advanceUntilIdle()
        assertEquals(listOf("apply:pr1"), backend.calls)
        assertEquals("np2", ProposalStore.initialState(Proposal.Create("c", "t", null, "", status = "applied", appliedPageId = "np2")).pageId)
    }

    @Test
    fun `api posts to apply and discard and reads the created page id`() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"status":"applied","page":{"id":"pg9","title":"Plan","version":4}}"""))
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"The note changed."}"""))
        server.enqueue(MockResponse().setBody("{}"))
        server.start()
        try {
            val api = ProposalApi(OkHttpClient()) { server.url(it).toString() }
            val applied = api.apply("np 1")
            assertEquals("pg9", applied.id)
            assertEquals("""{"id":"pg9","title":"Plan","version":4}""", applied.json)
            val first = server.takeRequest()
            assertEquals("POST", first.method)
            assertEquals("/api/proposals/np%201/apply", first.path)
            val error = runCatching { api.apply("pr1") }.exceptionOrNull() as ProposalException
            assertEquals("The note changed.", error.serverMessage)
            api.discard("pr1")
            server.takeRequest()
            assertEquals("/api/proposals/pr1/discard", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    private fun kotlinx.coroutines.CoroutineScope.launchCollect(store: ProposalStore, into: MutableList<ProposalChangeEvent>) =
        launch(kotlinx.coroutines.Dispatchers.Unconfined) { store.changes.collect { into += it } }
}
