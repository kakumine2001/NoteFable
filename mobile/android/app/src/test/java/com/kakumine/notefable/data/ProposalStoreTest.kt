package com.kakumine.notefable.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// 网页 page-proposal.tsx 的状态规则：按提案 ID 记在卡片外，服务端已确定的状态优先，失败回到处理前的状态并带错误。
@OptIn(ExperimentalCoroutinesApi::class)
class ProposalStoreTest {
    private val edit = Proposal.Edit("pr1", "p1", "Notes", 2)
    private val create = Proposal.Create("np1", "Plan", null, "- a")

    private class FakeBackend : ProposalBackend {
        val calls = mutableListOf<String>()
        var gate: CompletableDeferred<Unit>? = null
        var fail: Throwable? = null
        var createdId: String? = "new-page"
        var undone = UndoneProposal()

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

        override suspend fun undo(proposalId: String): UndoneProposal {
            calls += "undo:$proposalId"
            gate?.await()
            fail?.let { throw it }
            return undone
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
        // 刚在这里应用的提案可以撤销（网页同样）。
        assertEquals(ProposalState(ProposalState.Status.Applied, pageId = "p1", undoable = true), store.stateOf(edit))
        // 服务端返回的新版本跟着事件走，打开着的编辑器用它换成新版本。
        assertEquals(listOf(ProposalChangeEvent("p1", created = false, page = """{"id":"new-page","version":3}""")), changes)
        collector.cancel()
    }

    @Test
    fun `a created note opens the page the server made`() = runTest {
        val store = ProposalStore(FakeBackend(), this)
        store.apply(create)
        advanceUntilIdle()
        assertEquals(ProposalState(ProposalState.Status.Applied, pageId = "new-page", undoable = true), store.stateOf(create))
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
    fun `a proposal settled elsewhere shows the server's state instead of offering Apply again`() = runTest {
        val backend = FakeBackend().apply { fail = ProposalException("This change was undone.", "undone", "p1") }
        val store = ProposalStore(backend, this)
        store.apply(edit)
        advanceUntilIdle()
        assertEquals(ProposalState(ProposalState.Status.Undone, pageId = "p1"), store.stateOf(edit))
        backend.fail = ProposalException("This proposal was already applied.", "applied", "new-page")
        store.discard(create)
        advanceUntilIdle()
        assertEquals(ProposalState(ProposalState.Status.Applied, pageId = "new-page"), store.stateOf(create))
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
        // 别处先应用了：本机"未应用 + 错误"不会盖过服务端的已应用；服务端说能不能撤销就按它。
        val appliedElsewhere = edit.copy(status = "applied", undoable = true)
        assertEquals(ProposalState(ProposalState.Status.Applied, pageId = "p1", undoable = true), store.stateOf(appliedElsewhere))
        assertEquals(false, store.stateOf(edit.copy(status = "applied")).undoable)
    }

    @Test
    fun `undoing an edit turns it into Undone and hands the restored page to the editor`() = runTest {
        val backend = FakeBackend().apply {
            undone = UndoneProposal(AppliedPage("p1", """{"id":"p1","version":5}"""))
        }
        val store = ProposalStore(backend, this)
        val changes = mutableListOf<ProposalChangeEvent>()
        val collector = backgroundScope.launchCollect(store, changes)
        val applied = edit.copy(status = "applied", appliedPageId = "p1", undoable = true)
        // 还没应用的不能撤销。
        store.undo(edit)
        advanceUntilIdle()
        assertEquals(emptyList<String>(), backend.calls)

        backend.gate = CompletableDeferred()
        store.undo(applied)
        assertEquals(ProposalState(ProposalState.Status.Undoing, pageId = "p1", undoable = true), store.stateOf(applied))
        // 撤销中再点不会重复请求，也不能应用 / 放弃。
        store.undo(applied)
        store.apply(applied)
        store.discard(applied)
        backend.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("undo:pr1"), backend.calls)
        // 服务端还说"已应用"（历史没重读）时，本机的已撤销优先；之后重读到 undone 也一样是已撤销。
        assertEquals(ProposalState(ProposalState.Status.Undone, pageId = "p1"), store.stateOf(applied))
        assertEquals(ProposalState(ProposalState.Status.Undone, pageId = "p1"), store.stateOf(applied.copy(status = "undone", undoable = false)))
        assertEquals(listOf(ProposalChangeEvent("p1", created = false, page = """{"id":"p1","version":5}""")), changes)
        collector.cancel()
    }

    @Test
    fun `undoing a created page reports the pages moved to the trash`() = runTest {
        val backend = FakeBackend().apply { undone = UndoneProposal(trashedIds = listOf("new-page", "child")) }
        val store = ProposalStore(backend, this)
        val changes = mutableListOf<ProposalChangeEvent>()
        val collector = backgroundScope.launchCollect(store, changes)
        store.apply(create)
        advanceUntilIdle()
        store.undo(create)
        advanceUntilIdle()
        assertEquals(listOf("apply:np1", "undo:np1"), backend.calls)
        assertEquals(ProposalState(ProposalState.Status.Undone, pageId = "new-page"), store.stateOf(create))
        assertEquals(
            listOf(
                ProposalChangeEvent("new-page", created = true, page = """{"id":"new-page","version":3}"""),
                ProposalChangeEvent("new-page", created = true, trashed = listOf("new-page", "child")),
            ),
            changes,
        )
        collector.cancel()
    }

    @Test
    fun `a failed undo stays applied with the server message or the local fallback`() = runTest {
        val backend = FakeBackend().apply {
            fail = ProposalException("This page changed after the AI edit. Restore an earlier version from the page history.")
        }
        val store = ProposalStore(backend, this)
        val applied = edit.copy(status = "applied", undoable = true)
        store.undo(applied)
        advanceUntilIdle()
        val state = store.stateOf(applied)
        assertEquals(ProposalState.Status.Applied, state.status)
        assertEquals(true, state.undoable)
        assertEquals(
            ProposalError(ProposalError.Action.Undo, "This page changed after the AI edit. Restore an earlier version from the page history."),
            state.error,
        )
        // 再试一次可以；没有服务端原句时界面用"无法撤销这项修改。"。
        backend.fail = java.io.IOException("offline")
        store.undo(applied)
        advanceUntilIdle()
        assertEquals(ProposalError(ProposalError.Action.Undo, null), store.stateOf(applied).error)
        assertEquals(listOf("undo:pr1", "undo:pr1"), backend.calls)
        // 别处已经撤销了：服务端的 undone 盖过本机的错误。
        assertEquals(ProposalState(ProposalState.Status.Undone, pageId = "p1"), store.stateOf(applied.copy(status = "undone", undoable = false)))
    }

    @Test
    fun `a discarded or undone proposal is settled and an applied one is not pending`() {
        val discarded = ProposalStore.initialState(edit.copy(status = "discarded"))
        val undone = ProposalStore.initialState(create.copy(status = "undone", appliedPageId = "np9"))
        assertEquals(ProposalState.Status.Undone, undone.status)
        assertEquals("np9", undone.pageId)
        assertEquals(true, discarded.settled && undone.settled)
        assertEquals(false, ProposalState(ProposalState.Status.Applied).pending)
        assertEquals(true, ProposalState(ProposalState.Status.Undoing).busy)
        // 撤销中也算已处理（和网页一样：不出"应用 / 放弃"，卡片变淡）。
        assertEquals(true, ProposalState(ProposalState.Status.Undoing).settled)
        assertEquals(false, ProposalState(ProposalState.Status.Undoing).pending)
    }

    @Test
    fun `the card's badge, open target and undo button follow the state`() {
        fun state(status: ProposalState.Status, undoable: Boolean = false) = ProposalState(status, pageId = "p1", undoable = undoable)
        val all = ProposalState.Status.entries
        assertEquals(
            listOf(null, null, null, ProposalState.Badge.Done, ProposalState.Badge.Discarded, ProposalState.Badge.Done, ProposalState.Badge.Undone),
            all.map { state(it).badge },
        )
        // 编辑：已应用、撤销中、撤销了都能打开；新建：只有已应用的能打开（撤销中 / 撤销了的在回收站里）。
        assertEquals(listOf(null, null, null, "p1", null, "p1", "p1"), all.map { state(it).openPageId(isEdit = true) })
        assertEquals(listOf(null, null, null, "p1", null, null, null), all.map { state(it).openPageId(isEdit = false) })
        assertNull(ProposalState(ProposalState.Status.Applied).openPageId(isEdit = true))
        // 撤销键：能撤销的已应用，和撤销中（转圈）。
        assertEquals(listOf(false, false, false, false, false, true, false), all.map { state(it).showsUndo })
        assertEquals(true, state(ProposalState.Status.Applied, undoable = true).showsUndo)
    }

    @Test
    fun `api posts to apply and discard and reads the created page id`() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"status":"applied","page":{"id":"pg9","title":"Plan","version":4}}"""))
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"The note changed."}"""))
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"This change was undone.","status":"undone","pageId":"p1"}"""))
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
            assertEquals(null, error.finalStatus)
            val settled = runCatching { api.apply("pr1") }.exceptionOrNull() as ProposalException
            assertEquals(Triple("This change was undone.", "undone", "p1"), Triple(settled.serverMessage, settled.finalStatus, settled.pageId))
            api.discard("pr1")
            server.takeRequest()
            server.takeRequest()
            assertEquals("/api/proposals/pr1/discard", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `api posts to undo and reads the restored page or the trashed ids`() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"status":"undone","kind":"edit","page":{"id":"p1","title":"Notes","version":6}}"""))
        server.enqueue(MockResponse().setBody("""{"status":"undone","kind":"create","ids":["np","child",3]}"""))
        server.enqueue(MockResponse().setBody("""{"status":"undone","kind":"create","ids":[]}"""))
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"Only an applied change can be undone."}"""))
        server.enqueue(MockResponse().setResponseCode(503).setBody("not json"))
        server.start()
        try {
            val api = ProposalApi(OkHttpClient()) { server.url(it).toString() }
            assertEquals(UndoneProposal(AppliedPage("p1", """{"id":"p1","title":"Notes","version":6}""")), api.undo("pr 1"))
            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/api/proposals/pr%201/undo", request.path)
            assertEquals(0L, request.bodySize)
            // 新建提案：移进回收站的页面（含子页面）；已撤销过时为空。
            assertEquals(UndoneProposal(trashedIds = listOf("np", "child")), api.undo("np1"))
            assertEquals(UndoneProposal(), api.undo("np1"))
            val conflict = runCatching { api.undo("pr2") }.exceptionOrNull() as ProposalException
            assertEquals("Only an applied change can be undone.", conflict.serverMessage)
            val broken = runCatching { api.undo("pr3") }.exceptionOrNull() as ProposalException
            assertNull(broken.serverMessage)
        } finally {
            server.shutdown()
        }
    }

    private fun kotlinx.coroutines.CoroutineScope.launchCollect(store: ProposalStore, into: MutableList<ProposalChangeEvent>) =
        launch(kotlinx.coroutines.Dispatchers.Unconfined) { store.changes.collect { into += it } }
}
