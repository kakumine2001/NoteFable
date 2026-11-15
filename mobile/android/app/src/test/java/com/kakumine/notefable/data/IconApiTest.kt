package com.kakumine.notefable.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.CookieJar
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class IconApiTest {
    private fun MockWebServer.http() = NoteFableApi(url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES).http
    private fun MockWebServer.next() = takeRequest(1, TimeUnit.SECONDS)!!
    private fun body(request: okhttp3.mockwebserver.RecordedRequest) = Json.parseToJsonElement(request.body.readUtf8()).jsonObject

    @Test
    fun `chat icon patch sends the emoji or null and reports failures as false`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{}"))
            server.enqueue(MockResponse().setBody("{}"))
            server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"Chat icon must be a single emoji."}"""))
            val api = SessionsApi(server.http())
            assertTrue(api.updateSessionIcon("s1", "📚"))
            assertTrue(api.updateSessionIcon("s1", null))
            assertFalse(api.updateSessionIcon("s1", "x"))
            val first = server.next()
            assertEquals("PATCH", first.method)
            assertEquals("/api/sessions/s1", first.path)
            assertEquals(JsonPrimitive("📚"), body(first)["icon"])
            assertEquals(JsonNull, body(server.next())["icon"])
        }
    }

    @Test
    fun `note icon put returns the updated page`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"page":{"id":"p1","title":"Bio","icon":"🧬","version":4}}"""))
            val page = NoteIconApi(server.http()).setNoteIcon("p1", "🧬")
            assertEquals("🧬", page.icon)
            assertEquals(4, page.version)
            val request = server.next()
            assertEquals("PUT", request.method)
            assertEquals("/api/pages/p1/icon", request.path)
            assertEquals(JsonPrimitive("🧬"), body(request)["icon"])
        }
    }
}
