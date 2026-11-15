package com.kakumine.notefable.data

import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import com.kakumine.notefable.ui.answerMenuPosition
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.util.concurrent.TimeUnit

// 回答的"…"菜单：存到笔记（POST /api/pages/from-answer）与下载对话（GET /api/sessions/:id/export），规则同网页 answer-actions.tsx。
@OptIn(ExperimentalCoroutinesApi::class)
class ExportApiTest {
    private fun MockWebServer.api() = ExportApi(OkHttpClient()) { path -> url("/").toString().trimEnd('/') + path }
    private fun MockWebServer.next() = takeRequest(1, TimeUnit.SECONDS)!!

    @Test
    fun `saves the answer markdown with its chat, message and the device date`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"page":{"id":"p1","title":"Plan"}}"""))
            assertEquals("p1", server.api().saveAnswer("# Plan\n\n- a", "s1", "m1", "2026-11-14"))
            val request = server.next()
            assertEquals("POST", request.method)
            assertEquals("/api/pages/from-answer", request.path)
            val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
            assertEquals(JsonPrimitive("# Plan\n\n- a"), body["markdown"])
            assertEquals(JsonPrimitive("s1"), body["sessionId"])
            assertEquals(JsonPrimitive("m1"), body["messageId"])
            assertEquals(JsonPrimitive("2026-11-14"), body["savedOn"])
        }
    }

    @Test
    fun `a response without a page id is a failure`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"ok":true}"""))
            try {
                server.api().saveAnswer("x", "s1", "m1", "2026-11-14")
                fail("expected failure")
            } catch (e: ApiException) {
                assertEquals(AnswerSaveError(), answerSaveError(e))
            }
        }
    }

    @Test
    fun `downloads the conversation export with an encoded chat id`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"fileName":"Plan.md","markdown":"# Plan\n"}"""))
            val export = server.api().exportConversation("a b", "2026-11-14")
            assertEquals(ConversationExport("Plan.md", "# Plan\n"), export)
            assertEquals("/api/sessions/a%20b/export?date=2026-11-14", server.next().path)
        }
    }

    @Test
    fun `export errors carry the status`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"Session not found."}"""))
            try {
                server.api().exportConversation("s1", "2026-11-14")
                fail("expected failure")
            } catch (e: ApiException) {
                assertEquals(404, e.status)
            }
        }
    }

    @Test
    fun `save errors follow the web - 413 too large, 400 server text, the rest generic`() {
        assertEquals(AnswerSaveError(tooLarge = true), answerSaveError(ApiException.from(413, """{"error":"Note content exceeds 1 MiB."}""")))
        assertEquals(AnswerSaveError(serverMessage = "Invalid JSON request."), answerSaveError(ApiException.from(400, """{"error":"Invalid JSON request."}""")))
        assertEquals(AnswerSaveError(), answerSaveError(ApiException.from(400, "not json")))
        assertEquals(AnswerSaveError(), answerSaveError(ApiException.from(503, """{"error":"Database is unavailable."}""")))
        assertEquals(AnswerSaveError(), answerSaveError(IOException("offline")))
    }

    private class FakeBackend : ExportBackend {
        val saves = mutableListOf<String>()
        var gate: CompletableDeferred<Unit>? = null
        var fail: Throwable? = null

        override suspend fun saveAnswer(markdown: String, sessionId: String, messageId: String, savedOn: String): String {
            saves += "$sessionId/$messageId"
            gate?.await()
            fail?.let { throw it }
            return "page-${saves.size}"
        }

        override suspend fun exportConversation(sessionId: String, date: String) = ConversationExport("a.md", "x")
    }

    @Test
    fun `saving shows Saving, then Saved with the page, and never saves the same answer twice`() = runTest {
        val backend = FakeBackend().apply { gate = CompletableDeferred() }
        val store = AnswerExportStore(backend, this)
        val first = store.save("s1", "m1", "Hi", "2026-11-14")
        assertEquals(AnswerSave.Saving, store.saves.value[AnswerExportStore.key("s1", "m1")])
        // 保存中再点：什么也不做。
        assertEquals(AnswerSaveResult.Pending, store.save("s1", "m1", "Hi", "2026-11-14").await())
        backend.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(AnswerSaveResult.Ok, first.await())
        assertEquals(AnswerSave.Saved("page-1"), store.saves.value[AnswerExportStore.key("s1", "m1")])
        // 已保存再点：也不再建。
        assertEquals(AnswerSaveResult.Pending, store.save("s1", "m1", "Hi", "2026-11-14").await())
        assertEquals(listOf("s1/m1"), backend.saves)
        // 另一条回答各自保存。
        store.save("s1", "m2", "Other", "2026-11-14")
        advanceUntilIdle()
        assertEquals(listOf("s1/m1", "s1/m2"), backend.saves)
    }

    @Test
    fun `a failed save can be retried`() = runTest {
        val backend = FakeBackend().apply { fail = ApiException.from(413, "{}") }
        val store = AnswerExportStore(backend, this)
        val result = store.save("s1", "m1", "Hi", "2026-11-14")
        advanceUntilIdle()
        assertEquals(AnswerSaveResult.Failed(AnswerSaveError(tooLarge = true)), result.await())
        assertTrue(store.saves.value.isEmpty())
        backend.fail = null
        store.save("s1", "m1", "Hi", "2026-11-14")
        advanceUntilIdle()
        assertEquals(AnswerSave.Saved("page-2"), store.saves.value[AnswerExportStore.key("s1", "m1")])
    }

    @Test
    fun `a save keeps its state when the answer's local id is replaced by the stored id`() = runTest {
        // 已保存后换 ID：搬到新 ID 下，不能再存一次。
        val backend = FakeBackend()
        val store = AnswerExportStore(backend, this)
        store.save("s1", "local-2", "Hi", "2026-11-14")
        advanceUntilIdle()
        store.rename("s1", "local-2", "cm1")
        assertEquals(mapOf(AnswerExportStore.key("s1", "cm1") to AnswerSave.Saved("page-1")), store.saves.value)
        assertEquals(AnswerSaveResult.Pending, store.save("s1", "cm1", "Hi", "2026-11-14").await())

        // 保存中换 ID：保存完成后记在新 ID 下。
        backend.gate = CompletableDeferred()
        store.save("s1", "local-4", "Next", "2026-11-14")
        store.rename("s1", "local-4", "cm2")
        assertEquals(AnswerSave.Saving, store.saves.value[AnswerExportStore.key("s1", "cm2")])
        backend.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(AnswerSave.Saved("page-2"), store.saves.value[AnswerExportStore.key("s1", "cm2")])
        assertEquals(null, store.saves.value[AnswerExportStore.key("s1", "local-4")])
    }

    @Test
    fun `a finished save announces the new page so the notes list refreshes`() = runTest {
        val backend = FakeBackend()
        val store = AnswerExportStore(backend, this)
        val created = mutableListOf<String>()
        val collector = launch(kotlinx.coroutines.test.UnconfinedTestDispatcher(testScheduler)) { store.created.collect { created += it } }
        store.save("s1", "m1", "Hi", "2026-11-14")
        advanceUntilIdle()
        assertEquals(listOf("page-1"), created)
        // 失败不发。
        backend.fail = ApiException.from(500, "{}")
        store.save("s1", "m2", "Hi", "2026-11-14")
        advanceUntilIdle()
        assertEquals(listOf("page-1"), created)
        collector.cancel()
    }

    @Test
    fun `a held export is handed out once`() = runTest {
        val store = AnswerExportStore(FakeBackend(), this)
        store.holdExport("s1", "# Chat")
        assertEquals("# Chat", store.takeExport("s1"))
        assertEquals(null, store.takeExport("s1"))
    }

    @Test
    fun `menu opens below the button, left aligned, and flips above near the bottom`() {
        val window = IntSize(412, 915)
        val menu = IntSize(228, 101)
        // 网页实测：按钮 (51.6, 441.2)–(87.6, 477.2) → 菜单 (51.6, 481.2)。
        assertEquals(IntOffset(52, 481), answerMenuPosition(IntRect(52, 441, 88, 477), window, menu, 8, 4))
        assertEquals(IntOffset(52, 800 - 101 - 4), answerMenuPosition(IntRect(52, 800, 88, 836), window, menu, 8, 4))
        // 右侧放不下时贴着右边 8。
        assertEquals(IntOffset(412 - 228 - 8, 481), answerMenuPosition(IntRect(300, 441, 336, 477), window, menu, 8, 4))
    }
}
