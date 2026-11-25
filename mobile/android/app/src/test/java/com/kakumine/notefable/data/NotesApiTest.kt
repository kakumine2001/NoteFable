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
import org.junit.Assert.assertNotNull
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
            server.enqueue(MockResponse().setBody(
                """{"pages":[{"id":"a","title":"T","icon":null,"version":2,"groupId":"g","position":0,"createdAt":"x","updatedAt":"y","aiUpdatedAt":null},""" +
                    """{"id":"b","title":"AI","version":1,"position":1,"createdAt":"x","updatedAt":"y","aiUpdatedAt":"2026-11-23T09:00:00.000Z"}],""" +
                    """"groups":[{"id":"g","name":"G","position":0}]}""",
            ))
            val list = server.api().notes()
            assertEquals("g", list.pages.first().groupId)
            assertEquals("G", list.groups.single().name)
            // AI 写过内容的页面带 aiUpdatedAt（页面菜单的"报告 AI 内容"），没写过的是 null；旧服务端不返回也是 null。
            assertEquals(listOf(null, "2026-11-23T09:00:00.000Z"), list.pages.map { it.aiUpdatedAt })
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
        // 外观（App 实际的 light / dark）放在模型之后。
        assertEquals("https://example.test/note-embed?page=abc&lang=ja&theme=dark", api.noteEmbedUrl("abc", "ja", theme = "dark"))
    }

    @Test
    fun `embed url carries the search hit to reveal last, encoded, and leaves out an empty one`() {
        val api = NoteFableApi("https://example.test", CookieJar.NO_COOKIES)
        assertEquals(
            "https://example.test/note-embed?page=w&lang=ja&model=gpt-5.5&reasoning=high&theme=dark&reveal=el_1-A",
            api.noteEmbedUrl("w", "ja", "gpt-5.5", "high", "dark", "el_1-A"),
        )
        assertEquals("https://example.test/note-embed?page=n&reveal=a%26b%3Dc", api.noteEmbedUrl("n", null, reveal = "a&b=c"))
        assertEquals("https://example.test/note-embed?page=n", api.noteEmbedUrl("n", null, reveal = ""))
        assertEquals("https://example.test/note-embed?page=n", api.noteEmbedUrl("n", null, reveal = null))
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
    fun `importing into a project sends its groupId`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"pages":[{"id":"n1","title":"Plan","icon":null,"version":0,"groupId":"g1"}]}"""))
            val created = server.api().importMarkdown(listOf(ImportMarkdownFile("Plan.md", "# Plan")), "g1")
            assertEquals(listOf("g1"), created.map { it.groupId })
            assertEquals("""{"files":[{"name":"Plan.md","markdown":"# Plan"}],"groupId":"g1"}""", server.next().body.readUtf8())
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
        assertEquals(EmbedMessage.Ready("p", "Title", null, version = 7), EmbedMessage.parse("""{"type":"ready","page":{"id":"p","title":"Title","icon":null,"version":7}}"""))
        assertEquals(EmbedMessage.Meta("T", "📘"), EmbedMessage.parse("""{"type":"meta","title":"T","icon":"📘"}"""))
        assertEquals(EmbedMessage.Meta("T", "📘", version = 8), EmbedMessage.parse("""{"type":"meta","title":"T","icon":"📘","version":8}"""))
        assertEquals(EmbedMessage.SaveState("conflict"), EmbedMessage.parse("""{"type":"saveState","state":"conflict"}"""))
        assertEquals(EmbedMessage.Missing(), EmbedMessage.parse("""{"type":"missing"}"""))
        assertEquals(EmbedMessage.Missing("p1"), EmbedMessage.parse("""{"type":"missing","id":"p1"}"""))
        assertEquals(EmbedMessage.Missing(null), EmbedMessage.parse("""{"type":"missing","id":""}"""))
        assertEquals(EmbedMessage.Trashed, EmbedMessage.parse("""{"type":"trashed"}"""))
        assertEquals(EmbedMessage.OpenPage("p2"), EmbedMessage.parse("""{"type":"openPage","id":"p2"}"""))
        assertEquals(null, EmbedMessage.parse("""{"type":"openPage","id":""}"""))
        assertEquals(EmbedMessage.PagesChanged, EmbedMessage.parse("""{"type":"pagesChanged"}"""))
        assertEquals(EmbedMessage.Flushed("r1", true), EmbedMessage.parse("""{"type":"flushed","requestId":"r1","ok":true}"""))
        assertEquals(EmbedMessage.Flushed("r2", false), EmbedMessage.parse("""{"type":"flushed","requestId":"r2","ok":false}"""))
        assertEquals(EmbedMessage.Flushed("r3", false, kept = true), EmbedMessage.parse("""{"type":"flushed","requestId":"r3","ok":false,"kept":true}"""))
        assertNull(EmbedMessage.parse("""{"type":"later-feature"}"""))
        assertNull(EmbedMessage.parse("""{"type":"ready"}"""))
        assertNull(EmbedMessage.parse("not json"))
    }

    @Test
    fun `parses the whiteboard drawing message and drops malformed ones`() {
        assertEquals(EmbedMessage.Drawing(true), EmbedMessage.parse("""{"type":"drawing","active":true}"""))
        assertEquals(EmbedMessage.Drawing(false), EmbedMessage.parse("""{"type":"drawing","active":false}"""))
        for (active in listOf("", ""","active":null""", ""","active":"true"""", ""","active":1""")) {
            assertNull(active, EmbedMessage.parse("""{"type":"drawing"$active}"""))
        }
    }

    @Test
    fun `parses the file save messages and drops malformed ones`() {
        assertEquals(
            EmbedMessage.FileStart("f1", "Board.png", "image/png", 1234),
            EmbedMessage.parse("""{"type":"fileStart","id":"f1","name":"Board.png","mime":"image/png","size":1234}"""),
        )
        assertEquals(EmbedMessage.FileChunk("f1", 0, "AAEC"), EmbedMessage.parse("""{"type":"fileChunk","id":"f1","index":0,"data":"AAEC"}"""))
        assertEquals(EmbedMessage.FileChunk("f1", 7, ""), EmbedMessage.parse("""{"type":"fileChunk","id":"f1","index":7,"data":""}"""))
        assertEquals(EmbedMessage.FileEnd("f1"), EmbedMessage.parse("""{"type":"fileEnd","id":"f1"}"""))
        assertEquals(EmbedMessage.FileAbort("f1"), EmbedMessage.parse("""{"type":"fileAbort","id":"f1"}"""))
        val malformed = listOf(
            // 没有 id、id 是空的或不是字符串
            """{"type":"fileStart","name":"a.png","mime":"image/png","size":1}""",
            """{"type":"fileStart","id":"","name":"a.png","mime":"image/png","size":1}""",
            """{"type":"fileEnd","id":3}""",
            """{"type":"fileAbort"}""",
            // 文件名、类型不是字符串；大小是负数、小数、字符串或缺了
            """{"type":"fileStart","id":"f","name":null,"mime":"image/png","size":1}""",
            """{"type":"fileStart","id":"f","name":"a.png","mime":4,"size":1}""",
            """{"type":"fileStart","id":"f","name":"a.png","mime":"image/png","size":-1}""",
            """{"type":"fileStart","id":"f","name":"a.png","mime":"image/png","size":1.5}""",
            """{"type":"fileStart","id":"f","name":"a.png","mime":"image/png","size":"1"}""",
            """{"type":"fileStart","id":"f","name":"a.png","mime":"image/png"}""",
            // 块的序号是负数、太大、字符串；数据不是字符串或缺了
            """{"type":"fileChunk","id":"f","index":-1,"data":"AA=="}""",
            """{"type":"fileChunk","id":"f","index":4294967296,"data":"AA=="}""",
            """{"type":"fileChunk","id":"f","index":"0","data":"AA=="}""",
            """{"type":"fileChunk","id":"f","index":0,"data":12}""",
            """{"type":"fileChunk","id":"f","index":0}""",
        )
        for (json in malformed) assertNull(json, EmbedMessage.parse(json))
    }

    @Test
    fun `reads uploaded image icons and keeps emoji icons as text`() {
        val key = "upload:page-covers/user1/0e111e3a-9e25-4944-ade7-b460580fa921.png"
        assertEquals("/api/pages/covers?key=page-covers%2Fuser1%2F0e111e3a-9e25-4944-ade7-b460580fa921.png", NoteIcons.imagePath(key))
        assertEquals(null, NoteIcons.imagePath("📄"))
        assertEquals(null, NoteIcons.imagePath("upload:page-covers/user1/../x.png"))
        assertEquals(null, NoteIcons.text(key))
        assertEquals("📄", NoteIcons.text("📄"))
    }

    @Test
    fun `renames a page via PUT title and decodes cover fields on recent notes`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"pages":[{"id":"r","title":"Plan","cover":"gradient-ocean","coverPosition":35}]}"""))
            server.enqueue(MockResponse().setBody("""{"page":{"id":"r","title":"Renamed plan","version":4,"cover":"gradient-ocean","coverPosition":35}}"""))
            val api = server.api()
            val recent = api.recentNotes()
            assertEquals("gradient-ocean", recent[0].cover)
            assertEquals(35, recent[0].coverPosition)
            assertNotNull(NoteCovers.preset(recent[0].cover))
            assertNull(NoteCovers.imagePath(recent[0].cover))

            val written = api.renameNote("r", "Renamed plan", 3)
            assertEquals("Renamed plan", written.page.title)
            assertEquals(4, written.page.version)
            assertTrue(written.json?.contains("Renamed plan") == true)
            assertEquals("/api/pages?recent=1", server.next().path)
            val renameReq = server.next()
            assertEquals("PUT", renameReq.method)
            assertEquals("/api/pages/r/title", renameReq.path)
            assertEquals("""{"title":"Renamed plan","version":3}""", renameReq.body.readUtf8())
        }
    }
}
