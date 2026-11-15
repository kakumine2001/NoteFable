package com.kakumine.notefable.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
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

/** 子页面、收藏、页面设置、复制的请求和应答（网页 src/app/api/pages/[pageId] 下的各接口）。 */
class NotesTreeApiTest {
    private fun MockWebServer.api() = NoteFableApi(url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)
    private fun MockWebServer.next() = takeRequest(1, TimeUnit.SECONDS)!!
    private fun body(server: MockWebServer) = server.next().let { it.method to (it.path to Json.parseToJsonElement(it.body.readUtf8().ifEmpty { "{}" }).jsonObject) }

    @Test
    fun `creates a page inside another and reads tree fields`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"page":{"id":"c","title":"Untitled","parentId":"p","groupId":"g","favoritedAt":null,"fullWidth":true,"font":"serif","locked":true}}"""))
            val page = server.api().createNote("p")
            assertEquals("p", page.parentId)
            assertTrue(page.fullWidth)
            assertEquals("serif", page.font)
            assertTrue(page.locked)
            val (method, request) = body(server)
            assertEquals("POST", method)
            assertEquals(JsonPrimitive("p"), request.second["parentId"])
        }
    }

    @Test
    fun `trash, move and delete forever return the affected ids`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"ok":true,"ids":["p","c"]}"""))
            server.enqueue(MockResponse().setBody("""{"id":"p","groupId":"g","parentId":null,"ids":["p","c"]}"""))
            server.enqueue(MockResponse().setBody("""{"ok":true}"""))
            val api = server.api()
            assertEquals(listOf("p", "c"), api.trashNote("p"))
            assertEquals(listOf("p", "c"), api.moveNote("p", "g"))
            // 旧服务端没有 ids：至少是这一篇。
            assertEquals(listOf("t"), api.deleteForever("t"))
            assertEquals("/api/pages/p", server.next().path)
            assertEquals("/api/pages/p/group", server.next().path)
            assertEquals("/api/pages/trash/t", server.next().path)
        }
    }

    @Test
    fun `moves under a page, favorites and changes only the sent settings`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"pages":[{"id":"c","parentId":"p","groupId":"g"}]}"""))
            server.enqueue(MockResponse().setBody("""{"page":{"id":"c","favoritedAt":"2026-11-16T00:00:00.000Z"}}"""))
            server.enqueue(MockResponse().setBody("""{"page":{"id":"c","smallText":true}}"""))
            val api = server.api()
            assertEquals("p", api.moveToPage("c", "p").single().parentId)
            assertEquals("2026-11-16T00:00:00.000Z", api.setFavorite("c", true).favoritedAt)
            assertTrue(api.updateSettings("c", NotePageSettings(smallText = true)).smallText)
            val parent = body(server)
            assertEquals("/api/pages/c/parent" to JsonPrimitive("p"), parent.second.first to parent.second.second["parentId"])
            val favorite = body(server)
            assertEquals(JsonPrimitive(true), favorite.second.second["favorite"])
            val settings = body(server)
            assertEquals("/api/pages/c/settings", settings.second.first)
            assertEquals(setOf("smallText"), settings.second.second.keys)
        }
    }

    @Test
    fun `duplicates and restores with every affected page`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody(
                """{"page":{"id":"x","title":"P (1)"},"pages":[{"id":"x","title":"P (1)"},{"id":"y","parentId":"x"}],"items":[{"id":"p","position":1},{"id":"x","position":2}]}""",
            ))
            server.enqueue(MockResponse().setBody("""{"page":{"id":"p"},"pages":[{"id":"c","parentId":"p"},{"id":"p"}]}"""))
            val api = server.api()
            val copy = api.duplicate("p")
            assertEquals("x", copy.page.id)
            assertEquals(listOf("x", "y"), copy.pages.map { it.id })
            assertEquals(listOf(1, 2), copy.order.map { it.position })
            assertFalse(copy.order.any { it.movedGroup })
            // 这一篇排在最前面。
            assertEquals(listOf("p", "c"), api.restoreNote("p").map { it.id })
            assertEquals("/api/pages/p/duplicate", server.next().path)
            assertEquals("/api/pages/trash/p", server.next().path)
        }
    }
}
