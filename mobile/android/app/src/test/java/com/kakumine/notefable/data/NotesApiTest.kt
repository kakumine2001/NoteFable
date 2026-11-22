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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class NotesApiTest {
    private fun MockWebServer.api() = NoteFableApi(url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)
    private fun MockWebServer.next() = takeRequest(1, TimeUnit.SECONDS)!!

    @Test
    fun `reads pages and groups`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"pages":[{"id":"a","title":"T","icon":null,"version":2,"groupId":"g","position":0,"createdAt":"x","updatedAt":"y"}],"groups":[{"id":"g","name":"G","position":0}]}"""))
            val list = server.api().notes()
            assertEquals("g", list.pages.single().groupId)
            assertEquals("G", list.groups.single().name)
            assertEquals("/api/pages", server.next().path)
        }
    }

    @Test
    fun `creates an Untitled note like the web`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"page":{"id":"n","title":"Untitled","icon":null,"version":0,"groupId":null}}"""))
            assertEquals("n", server.api().createNote().id)
            val request = server.next()
            assertEquals("POST", request.method)
            val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
            assertEquals(JsonPrimitive("Untitled"), body["title"])
            assertEquals(JsonNull, body["icon"])
            assertEquals("[]", body["blocks"].toString())
        }
    }

    @Test
    fun `moves a note out of its project with a null group`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"id":"a","groupId":null}"""))
            server.api().moveNote("a", null)
            val request = server.next()
            assertEquals("PUT", request.method)
            assertEquals("/api/pages/a/group", request.path)
            assertEquals(JsonNull, Json.parseToJsonElement(request.body.readUtf8()).jsonObject["groupId"])
        }
    }

    @Test
    fun `reorders a note and reads which note changed project`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"items":[{"id":"b","position":1,"groupId":null},{"id":"a","position":2},{"id":"c","position":3}]}"""))
            val updates = server.api().reorderNote("b", "a", after = false)
            val request = server.next()
            assertEquals("POST", request.method)
            assertEquals("/api/pages/reorder", request.path)
            val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
            assertEquals(JsonPrimitive("b"), body["id"])
            assertEquals(JsonPrimitive("a"), body["targetId"])
            assertEquals(JsonPrimitive(false), body["after"])
            assertEquals(
                listOf(NoteOrderUpdate("b", 1, null, movedGroup = true), NoteOrderUpdate("a", 2), NoteOrderUpdate("c", 3)),
                updates,
            )
        }
    }

    @Test
    fun `trash endpoints and server errors`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"pages":[{"id":"t","title":"Old","icon":null,"deletedAt":"2026-11-14T00:00:00.000Z","purgeAt":"2026-12-14T00:00:00.000Z"}]}"""))
            server.enqueue(MockResponse().setBody("""{"ok":true,"count":1}"""))
            server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"Note not found in the trash."}"""))
            val api = server.api()
            assertEquals("t", api.trash().single().id)
            assertEquals("/api/pages/trash", server.next().path)

            api.emptyTrash("2026-11-14T00:00:00.000Z")
            val empty = server.next()
            assertEquals("DELETE", empty.method)
            assertEquals("/api/pages/trash?before=2026-11-14T00%3A00%3A00.000Z", empty.path)

            val error = runCatching { api.restoreNote("t") }.exceptionOrNull()
            assertTrue(error is ApiException)
            assertEquals("Note not found in the trash.", error?.message)
            assertEquals("POST", server.next().method)
        }
    }

    @Test
    fun `embed url carries page and language`() {
        val api = NoteFableApi("https://example.test", CookieJar.NO_COOKIES)
        assertEquals("https://example.test/note-embed?page=abc&lang=ja", api.noteEmbedUrl("abc", "ja"))
        assertEquals("https://example.test/note-embed?page=a%2Fb", api.noteEmbedUrl("a/b", null))
        assertEquals(
            "https://example.test/note-embed?page=abc&lang=zh&model=gpt-5.5&reasoning=high",
            api.noteEmbedUrl("abc", "zh", "gpt-5.5", "high"),
        )
        assertEquals("https://example.test/note-embed?page=abc&model=a%26b", api.noteEmbedUrl("abc", null, "a&b", null))
        // 外观（App 实际的 light / dark）放在最后。
        assertEquals("https://example.test/note-embed?page=abc&lang=ja&theme=dark", api.noteEmbedUrl("abc", "ja", theme = "dark"))
    }

    @Test
    fun `exports a note as a markdown file`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"fileName":"Cell structure.md","markdown":"# Cell structure\n\nBody\n"}"""))
            assertEquals(ExportedNote("Cell structure.md", "# Cell structure\n\nBody\n"), server.api().exportNote("a/b"))
            val request = server.next()
            assertEquals("GET", request.method)
            assertEquals("/api/pages/a%2Fb/export", request.path)
        }
    }

    @Test
    fun `a missing note fails the export with the server's sentence`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"Note not found."}"""))
            val error = runCatching { server.api().exportNote("gone") }.exceptionOrNull() as ApiException
            assertEquals("Note not found.", error.message)
        }
    }

    @Test
    fun `imports markdown files with the same body as the web`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody(
                """{"pages":[{"id":"n1","title":"Plan","icon":null,"version":0,"groupId":null},{"id":"n2","title":"ideas","icon":null,"version":0,"groupId":null}]}""",
            ))
            val created = server.api().importMarkdown(listOf(ImportMarkdownFile("Plan.md", "# Plan\n\n日本語 \"quoted\""), ImportMarkdownFile("ideas.txt", "")))
            assertEquals(listOf("n1", "n2"), created.map { it.id })
            val request = server.next()
            assertEquals("POST", request.method)
            assertEquals("/api/pages/import", request.path)
            val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
            assertEquals(setOf("files"), body.keys)
            assertEquals(
                """[{"name":"Plan.md","markdown":"# Plan\n\n日本語 \"quoted\""},{"name":"ideas.txt","markdown":""}]""",
                body["files"].toString(),
            )
        }
    }

    @Test
    fun `an import the server rejects keeps its reason`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(413).setBody("""{"error":"Note content exceeds 1 MiB."}"""))
            val error = runCatching { server.api().importMarkdown(listOf(ImportMarkdownFile("a.md", "x"))) }.exceptionOrNull() as ApiException
            assertEquals("Note content exceeds 1 MiB.", error.message)
        }
    }

    @Test
    fun `parses the bridge messages and ignores unknown ones`() {
        assertEquals(EmbedMessage.Ready("p", "Title", null), EmbedMessage.parse("""{"type":"ready","page":{"id":"p","title":"Title","icon":null}}"""))
        assertEquals(EmbedMessage.Meta("T", "📘"), EmbedMessage.parse("""{"type":"meta","title":"T","icon":"📘"}"""))
        assertEquals(EmbedMessage.SaveState("conflict"), EmbedMessage.parse("""{"type":"saveState","state":"conflict"}"""))
        assertEquals(EmbedMessage.Missing, EmbedMessage.parse("""{"type":"missing"}"""))
        assertEquals(EmbedMessage.Trashed, EmbedMessage.parse("""{"type":"trashed"}"""))
        assertEquals(EmbedMessage.Flushed("r1", true), EmbedMessage.parse("""{"type":"flushed","requestId":"r1","ok":true}"""))
        assertEquals(EmbedMessage.Flushed("r2", false), EmbedMessage.parse("""{"type":"flushed","requestId":"r2","ok":false}"""))
        assertEquals(EmbedMessage.Flushed("r3", false, kept = true), EmbedMessage.parse("""{"type":"flushed","requestId":"r3","ok":false,"kept":true}"""))
        assertNull(EmbedMessage.parse("""{"type":"later-feature"}"""))
        assertNull(EmbedMessage.parse("""{"type":"ready"}"""))
        assertNull(EmbedMessage.parse("not json"))
    }
}
