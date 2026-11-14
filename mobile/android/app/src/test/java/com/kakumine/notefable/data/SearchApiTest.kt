package com.kakumine.notefable.data

import kotlinx.coroutines.runBlocking
import okhttp3.CookieJar
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.TimeUnit

class SearchApiTest {
    private fun MockWebServer.http() = NoteFableApi(url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES).http

    @Test
    fun `sends the query, scope and project filter and parses both result kinds`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"query":"a b","notes":[{"kind":"note","id":"n1","title":"N","icon":null,"snippet":"s","blockId":"b1","updatedAt":"2026-01-02T03:04:05.000Z"}],
                    "chats":[{"kind":"chat","id":"c1","title":"C","icon":"x","snippet":"x","messageId":"m1","role":"USER","attachmentName":"f.pdf","projectId":"p1","titleMatch":false,"updatedAt":""}]}""",
                ),
            )
            server.enqueue(MockResponse().setBody("""{"query":"x","notes":[],"chats":[]}"""))
            val api = SearchApi(server.http())
            val result = api.search("a b&c", SearchScope.Chats, "p1")
            val first = server.takeRequest(1, TimeUnit.SECONDS)!!
            assertEquals("/api/search?q=a%20b%26c&scope=chats&projectId=p1", first.path)
            assertEquals("b1", result.notes.single().blockId)
            assertEquals("m1", result.chats.single().messageId)
            assertEquals("f.pdf", result.chats.single().attachmentName)
            api.search("x", SearchScope.All, null)
            assertEquals("/api/search?q=x&scope=all", server.takeRequest(1, TimeUnit.SECONDS)!!.path)
        }
    }

    @Test(expected = ApiException::class)
    fun `a server error throws`() = runBlocking<Unit> {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"Database is unavailable.","notes":[],"chats":[]}"""))
            SearchApi(server.http()).search("x", SearchScope.All, null)
        }
    }
}
