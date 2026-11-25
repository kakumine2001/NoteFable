package com.kakumine.notefable.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.util.concurrent.TimeUnit

// 画成图（#153）：POST /api/pages/diagram 的请求和回复，以及按素材存的任务（网页 draw-diagram-dialog.tsx 的 jobs）。
@OptIn(ExperimentalCoroutinesApi::class)
class DiagramApiTest {
    private fun MockWebServer.api() = DiagramApi(OkHttpClient()) { path -> url("/").toString().trimEnd('/') + path }
    private fun MockWebServer.next() = takeRequest(1, TimeUnit.SECONDS)!!

    private val whiteboardJson =
        """{"id":"w1","kind":"whiteboard","title":"Steps","icon":null,"version":1,"position":0,"groupId":null,"parentId":null,""" +
            """"aiUpdatedAt":"2026-11-25T00:00:00.000Z","createdAt":"2026-11-25T00:00:00.000Z","updatedAt":"2026-11-25T00:00:00.000Z"}"""

    @Test
    fun `an answer is sent with its message id, the model and the request id, and the whiteboard comes back`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"page":$whiteboardJson,"partial":true}"""))
            val drawn = server.api().drawDiagram(DiagramSource.Answer("s1", "m1"), "luna", "req-12345678")
            assertEquals("w1", drawn.page.id)
            assertEquals(PageKind.Whiteboard, drawn.page.kind)
            assertEquals("Steps", drawn.page.title)
            assertEquals("2026-11-25T00:00:00.000Z", drawn.page.aiUpdatedAt)
            assertTrue(drawn.partial)
            val request = server.next()
            assertEquals("POST", request.method)
            assertEquals("/api/pages/diagram", request.path)
            val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
            assertEquals(JsonPrimitive("answer"), body["source"])
            assertEquals(JsonPrimitive("m1"), body["messageId"])
            assertEquals(JsonPrimitive("luna"), body["model"])
            assertEquals(JsonPrimitive("req-12345678"), body["clientRequestId"])
            // 会话 ID 不用发（服务端按消息找）。
            assertNull(body["sessionId"])
            assertNull(body["pageId"])
        }
    }

    @Test
    fun `a note is sent with its page id, a missing model is left out, and a replay is not partial`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(200).setBody("""{"page":${whiteboardJson.replace("\"parentId\":null", "\"parentId\":\"n1\"")}}"""))
            val drawn = server.api().drawDiagram(DiagramSource.Note("n1"), null, "req-12345678")
            assertEquals("n1", drawn.page.parentId)
            assertFalse(drawn.partial)
            val body = Json.parseToJsonElement(server.next().body.readUtf8()).jsonObject
            assertEquals(JsonPrimitive("note"), body["source"])
            assertEquals(JsonPrimitive("n1"), body["pageId"])
            assertNull(body["messageId"])
            assertNull(body["model"])
        }
    }

    @Test
    fun `a diagram that cannot be converted carries its Mermaid source`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setResponseCode(422).setBody(
                    """{"error":"Could not turn this into an editable diagram.","code":"diagram_invalid","source":"flowchart TD\n  A --> B"}""",
                ),
            )
            try {
                server.api().drawDiagram(DiagramSource.Answer("s1", "m1"), null, "req-12345678")
                fail("expected failure")
            } catch (e: DiagramInvalidException) {
                assertEquals("flowchart TD\n  A --> B", e.mermaid)
                assertEquals(422, e.error.status)
                assertEquals("Could not turn this into an editable diagram.", diagramErrorMessage(e))
            }
        }
    }

    @Test
    fun `the usage limit keeps its code and server text, and a reply without a page is a failure`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":"Daily limit reached.","code":"usage_limit","tier":"guest","kind":"chat"}"""))
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"ok":true}"""))
            try {
                server.api().drawDiagram(DiagramSource.Note("n1"), null, "req-12345678")
                fail("expected failure")
            } catch (e: ApiException) {
                assertTrue(e.isUsageLimit)
                assertEquals("Daily limit reached.", diagramErrorMessage(e))
            }
            try {
                server.api().drawDiagram(DiagramSource.Note("n1"), null, "req-12345678")
                fail("expected failure")
            } catch (e: ApiException) {
                assertEquals(DIAGRAM_FAILED, diagramErrorMessage(e))
            }
        }
    }

    @Test
    fun `errors follow create page - server text for 400, 404, 413, 422 and 429, the rest generic`() {
        assertEquals("There is nothing to draw yet.", diagramErrorMessage(ApiException.from(400, """{"error":"There is nothing to draw yet."}""")))
        assertEquals("Message not found.", diagramErrorMessage(ApiException.from(404, """{"error":"Message not found."}""")))
        assertEquals("This diagram was moved to the trash.", diagramErrorMessage(ApiException.from(404, """{"error":"This diagram was moved to the trash."}""")))
        assertEquals("Request body is too large.", diagramErrorMessage(ApiException.from(413, """{"error":"Request body is too large."}""")))
        assertEquals("Could not turn this into an editable diagram.",
            diagramErrorMessage(ApiException.from(422, """{"error":"Could not turn this into an editable diagram.","code":"diagram_invalid"}""")))
        assertEquals(DIAGRAM_FAILED, diagramErrorMessage(ApiException.from(502, """{"error":"Could not draw a diagram. Try again."}""")))
        assertEquals(DIAGRAM_FAILED, diagramErrorMessage(ApiException.from(503, """{"error":"Database is unavailable."}""")))
        assertEquals(DIAGRAM_FAILED, diagramErrorMessage(ApiException.from(400, "not json")))
        assertEquals(DIAGRAM_FAILED, diagramErrorMessage(IOException("offline")))
    }

    @Test
    fun `job keys separate answers by chat and notes by page`() {
        assertEquals("answer:s1\nm1", DiagramSource.Answer("s1", "m1").key)
        assertEquals("note:n1", DiagramSource.Note("n1").key)
    }

    // ---- 任务（DiagramStore） ----

    private class FakeBackend : DiagramBackend {
        val calls = mutableListOf<Triple<DiagramSource, String?, String>>()
        var gate: CompletableDeferred<Unit>? = null
        var fail: Throwable? = null

        override suspend fun drawDiagram(source: DiagramSource, model: String?, clientRequestId: String): DrawnDiagram {
            calls += Triple(source, model, clientRequestId)
            val id = "w${calls.size}"
            gate?.await()
            fail?.let { throw it }
            val parent = (source as? DiagramSource.Note)?.pageId
            return DrawnDiagram(NotePageSummary(id, "Steps", kind = PageKind.Whiteboard, parentId = parent), partial = false)
        }
    }

    private fun ids(): () -> String {
        var next = 0
        return { "req-${++next}" }
    }

    @Test
    fun `one job per source - choosing it again reopens the same job, other sources run on their own`() = runTest {
        val backend = FakeBackend().apply { gate = CompletableDeferred() }
        val store = DiagramStore(backend, this, ids())
        val created = mutableListOf<String>()
        val collector = launch(UnconfinedTestDispatcher(testScheduler)) { store.created.collect { created += it.id } }
        val answer = DiagramSource.Answer("s1", "m1")
        val key = store.start(answer, "luna")
        assertEquals(answer.key, key)
        assertEquals(DiagramJob.Working(answer, "req-1"), store.jobs.value[key])
        // 进行中再选、关窗口：不另起，也不忘掉。
        assertEquals(key, store.start(answer, "luna"))
        store.dismiss(key)
        assertEquals(DiagramJob.Working(answer, "req-1"), store.jobs.value[key])
        // 另一份素材是另一个任务。
        store.start(DiagramSource.Note("n1"), "luna")
        backend.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf(Triple<DiagramSource, String?, String>(answer, "luna", "req-1"), Triple(DiagramSource.Note("n1"), "luna", "req-2")), backend.calls)
        val done = store.jobs.value[key] as DiagramJob.Done
        assertEquals("w1", done.page.id)
        assertEquals("n1", (store.jobs.value["note:n1"] as DiagramJob.Done).page.parentId)
        assertEquals(listOf("w1", "w2"), created)
        // 画好了再选：还是重开那个结果，不再画。
        store.start(answer, "luna")
        advanceUntilIdle()
        assertEquals(2, backend.calls.size)
        collector.cancel()
    }

    @Test
    fun `try again reuses the request id, and closing a finished job forgets it so the next one gets a new id`() = runTest {
        val backend = FakeBackend().apply {
            fail = DiagramInvalidException(ApiException.from(422, """{"error":"Could not turn this into an editable diagram.","code":"diagram_invalid"}"""), "flowchart TD")
        }
        val store = DiagramStore(backend, this, ids())
        val created = mutableListOf<String>()
        val collector = launch(UnconfinedTestDispatcher(testScheduler)) { store.created.collect { created += it.id } }
        val key = store.start(DiagramSource.Answer("s1", "m1"), "luna")
        advanceUntilIdle()
        assertEquals(
            DiagramJob.Failed(DiagramSource.Answer("s1", "m1"), "req-1", "Could not turn this into an editable diagram.", "flowchart TD"),
            store.jobs.value[key],
        )
        assertTrue(created.isEmpty())
        // 重试：同一个 clientRequestId（上次其实建好了的话服务端返回那一页，不再扣次数）。
        backend.fail = ApiException.from(503, """{"error":"Could not draw a diagram. Try again."}""")
        store.retry(key, "sonnet")
        assertTrue(store.jobs.value[key] is DiagramJob.Working)
        advanceUntilIdle()
        assertEquals(DiagramJob.Failed(DiagramSource.Answer("s1", "m1"), "req-1", DIAGRAM_FAILED), store.jobs.value[key])
        backend.fail = null
        store.retry(key, "sonnet")
        advanceUntilIdle()
        assertEquals(listOf("req-1", "req-1", "req-1"), backend.calls.map { it.third })
        assertEquals("sonnet", backend.calls.last().second)
        assertEquals("req-1", (store.jobs.value[key] as DiagramJob.Done).requestId)
        assertEquals(listOf("w3"), created)
        // 画好了的不能"重试"。
        store.retry(key, "sonnet")
        advanceUntilIdle()
        assertEquals(3, backend.calls.size)
        // 关窗口忘掉；再选是新的任务、新的 clientRequestId。
        store.dismiss(key)
        assertNull(store.jobs.value[key])
        store.start(DiagramSource.Answer("s1", "m1"), "luna")
        advanceUntilIdle()
        assertEquals("req-2", backend.calls.last().third)
        collector.cancel()
    }

    @Test
    fun `changing identity drops finished results and keeps a running job until it ends without its result`() = runTest {
        val backend = FakeBackend()
        val store = DiagramStore(backend, this, ids())
        val created = mutableListOf<String>()
        val collector = launch(UnconfinedTestDispatcher(testScheduler)) { store.created.collect { created += it.id } }
        store.start(DiagramSource.Note("n1"), null)
        advanceUntilIdle()
        backend.gate = CompletableDeferred()
        store.start(DiagramSource.Note("n2"), null)
        store.clear()
        assertNull(store.jobs.value["note:n1"])
        // 进行中的留着：这期间再选同一篇不会再发一次。
        assertTrue(store.jobs.value["note:n2"] is DiagramJob.Working)
        store.start(DiagramSource.Note("n2"), null)
        backend.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(2, backend.calls.size)
        // 结束了也不留结果、不发新白板（是换身份前的）。
        assertTrue(store.jobs.value.isEmpty())
        assertEquals(listOf("w1"), created)
        collector.cancel()
    }

    @Test
    fun `a note job starts only after the note was saved`() = runTest {
        val backend = FakeBackend()
        val store = DiagramStore(backend, this, ids())
        val order = mutableListOf<String>()
        assertNull(store.startWhenReady(DiagramSource.Note("n1"), null) { order += "save"; false })
        advanceUntilIdle()
        assertTrue(backend.calls.isEmpty())
        assertTrue(store.jobs.value.isEmpty())
        val key = store.startWhenReady(DiagramSource.Note("n1"), null) {
            order += "save"
            assertTrue(backend.calls.isEmpty())
            true
        }
        assertEquals("note:n1", key)
        advanceUntilIdle()
        assertEquals(listOf("save", "save"), order)
        assertEquals(1, backend.calls.size)
    }
}
