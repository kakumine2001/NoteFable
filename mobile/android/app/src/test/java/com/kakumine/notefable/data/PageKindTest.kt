package com.kakumine.notefable.data

import com.kakumine.notefable.data.PageKind.Note
import com.kakumine.notefable.data.PageKind.Slides
import com.kakumine.notefable.data.PageKind.Whiteboard
import kotlinx.coroutines.runBlocking
import okhttp3.CookieJar
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

// 页面类型（网页 src/lib/page-kinds.ts）：服务端 JSON 的读法、旧服务端 / 不认识的值按笔记、各类型能用的功能。
class PageKindTest {
    private fun MockWebServer.api() = NoteFableApi(url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)

    @Test
    fun `wire values map to kinds and anything else is a note like the web pageKindOf`() {
        assertEquals(Note, PageKind.of("note"))
        assertEquals(Whiteboard, PageKind.of("whiteboard"))
        assertEquals(Slides, PageKind.of("slides"))
        assertEquals(Note, PageKind.of(null))
        assertEquals(Note, PageKind.of("mindmap"))
        assertEquals(Note, PageKind.of("Whiteboard"))
        assertFalse(Note.isCanvas)
        assertTrue(Whiteboard.isCanvas)
        assertTrue(Slides.isCanvas)
    }

    @Test
    fun `only notes have typography, Markdown export and public sharing until the server says otherwise`() {
        PageKindTable.reset()
        assertEquals(PageKindFeatures(editor = true, markdownExport = true, typography = true, publicShare = true, aiEdit = true), Note.features)
        val canvas = PageKindFeatures(editor = false, markdownExport = false, typography = false, publicShare = false, aiEdit = false)
        assertEquals(canvas, Whiteboard.features)
        assertEquals(canvas, Slides.features)
        assertEquals(listOf(Note), PageKindTable.creatable)
    }

    @Test
    fun `the server's kinds table switches whiteboards and slides on, in section order, and bad tables are ignored`() {
        try {
            PageKindTable.update(kotlinx.serialization.json.Json.parseToJsonElement(
                """{"note":{"editor":true,"markdownExport":true,"typography":true,"publicShare":true,"aiEdit":true},"whiteboard":{"editor":true,"publicShare":true,"future":1},"slides":{"editor":true},"mindmap":{"editor":true}}""",
            ))
            assertEquals(listOf(Note, Whiteboard, Slides), PageKindTable.creatable)
            assertTrue(Whiteboard.features.publicShare)
            assertFalse(Slides.features.markdownExport)
            // 不是对象的表不动；表里缺了笔记也照样能用笔记。
            PageKindTable.update(kotlinx.serialization.json.JsonPrimitive("x"))
            assertEquals(listOf(Note, Whiteboard, Slides), PageKindTable.creatable)
            PageKindTable.update(kotlinx.serialization.json.Json.parseToJsonElement("""{"slides":{"editor":true}}"""))
            assertEquals(listOf(Note, Slides), PageKindTable.creatable)
            assertTrue(Note.features.markdownExport)
        } finally {
            PageKindTable.reset()
        }
    }

    @Test
    fun `the bundled page-kinds json matches the web table (scripts gen-native-page-kinds)`() {
        val asset = java.io.File("src/main/assets/page-kinds.json").readText()
        try {
            PageKindTable.loadBundled(asset)
            // 网页现在的表（白板、幻灯片的编辑器、公开视图和 AI 编辑均已上线）。
            assertEquals(PageKindTable.parse(kotlinx.serialization.json.Json.parseToJsonElement(asset))?.filterValues { it.editor }?.keys?.let { keys -> PageKindTable.DisplayOrder.filter { it in keys } }, PageKindTable.creatable)
            assertEquals(PageKindFeatures(editor = true, markdownExport = false, typography = false, publicShare = true, aiEdit = true), Slides.features)
            // 白板（#152 / #153）：编辑器、公开只读视图和 AI 编辑。
            assertEquals(PageKindFeatures(editor = true, markdownExport = false, typography = false, publicShare = true, aiEdit = true), Whiteboard.features)
        } finally {
            PageKindTable.reset()
        }
    }

    @Test
    fun `parses the slide presentation and file-save bridge messages`() {
        assertEquals(EmbedMessage.Presentation("start", 2, 9), EmbedMessage.parse("""{"type":"presentation","state":"start","index":2,"count":9}"""))
        assertEquals(null, EmbedMessage.parse("""{"type":"presentation","state":"spin","index":2,"count":9}"""))
        assertEquals(EmbedMessage.FileStart("f1", "Deck.pdf", "application/pdf", 1234), EmbedMessage.parse("""{"type":"fileStart","id":"f1","name":"Deck.pdf","mime":"application/pdf","size":1234}"""))
        assertEquals(EmbedMessage.FileChunk("f1", 0, "AAEC"), EmbedMessage.parse("""{"type":"fileChunk","id":"f1","index":0,"data":"AAEC"}"""))
        assertEquals(EmbedMessage.FileEnd("f1"), EmbedMessage.parse("""{"type":"fileEnd","id":"f1"}"""))
        assertEquals(EmbedMessage.FileAbort("f1"), EmbedMessage.parse("""{"type":"fileAbort","id":"f1"}"""))
        assertEquals(null, EmbedMessage.parse("""{"type":"fileStart","id":"f1","name":""}"""))
    }

    @Test
    fun `page lists read the kind and treat missing, null, unknown and malformed kinds as notes`() = runBlocking {
        MockWebServer().use { server ->
            val body = """{"pages":[
                {"id":"n","title":"Note","kind":"note"},
                {"id":"w","title":"Board","kind":"whiteboard"},
                {"id":"s","title":"Deck","kind":"slides"},
                {"id":"old","title":"Old server"},
                {"id":"null","title":"Null","kind":null},
                {"id":"future","title":"Future","kind":"mindmap"},
                {"id":"number","title":"Number","kind":3},
                {"id":"object","title":"Object","kind":{"type":"slides"}}
            ],"groups":[]}"""
            server.enqueue(MockResponse().setBody(body))
            server.enqueue(MockResponse().setBody(body))
            val api = server.api()
            assertEquals(listOf(Note, Whiteboard, Slides, Note, Note, Note, Note, Note), api.notes().pages.map { it.kind })
            assertEquals("/api/pages", server.takeRequest(1, TimeUnit.SECONDS)!!.path)
            assertEquals(listOf(Note, Whiteboard, Slides, Note, Note, Note, Note, Note), api.recentNotes().map { it.kind })
            assertEquals("/api/pages?recent=1", server.takeRequest(1, TimeUnit.SECONDS)!!.path)
        }
    }

    @Test
    fun `trash items read their kind and default to note`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"pages":[
                {"id":"t1","kind":"whiteboard","title":"Board","icon":null,"deletedAt":"2026-11-14T00:00:00.000Z","purgeAt":"2026-12-14T00:00:00.000Z"},
                {"id":"t2","kind":"slides","title":"Deck","icon":null,"deletedAt":"2026-11-14T00:00:00.000Z","purgeAt":"2026-12-14T00:00:00.000Z"},
                {"id":"t3","title":"Old","icon":null,"deletedAt":"2026-11-14T00:00:00.000Z","purgeAt":"2026-12-14T00:00:00.000Z"},
                {"id":"t4","kind":"timeline","title":"Future","icon":null,"deletedAt":"2026-11-14T00:00:00.000Z","purgeAt":"2026-12-14T00:00:00.000Z"}
            ]}"""))
            assertEquals(listOf(Whiteboard, Slides, Note, Note), server.api().trash().map { it.kind })
        }
    }

    @Test
    fun `search results read pageKind, not the result kind`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"query":"x","notes":[
                {"kind":"note","pageKind":"slides","id":"s","title":"Deck","icon":null,"snippet":"x","blockId":"slide-2","updatedAt":""},
                {"kind":"note","pageKind":"whiteboard","id":"w","title":"Board","icon":null,"snippet":"","blockId":null,"updatedAt":""},
                {"kind":"note","id":"old","title":"Old server","icon":null,"snippet":"","blockId":null,"updatedAt":""},
                {"kind":"note","pageKind":"timeline","id":"future","title":"Future","icon":null,"snippet":"","blockId":null,"updatedAt":""}
            ],"chats":[]}"""))
            val notes = SearchApi(server.api().http).search("x", SearchScope.Notes, null, null).notes
            assertEquals(listOf(Slides, Whiteboard, Note, Note), notes.map { it.pageKind })
            assertEquals("slide-2", notes.first().blockId)
        }
    }

    @Test
    fun `attached pages and project reference notes carry their kind`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"messages":[{"id":"m","role":"USER","content":"hi","pages":[
                {"id":"w","kind":"whiteboard","title":"Board","icon":null},
                {"id":"n","title":"Old server","icon":"📘"}
            ]}]}"""))
            server.enqueue(MockResponse().setBody("""{"project":{"id":"p","name":"P","instructions":null,"notes":[
                {"id":"s","kind":"slides","title":"Deck","icon":null},
                {"id":"n","title":"Old server","icon":null}
            ]}}"""))
            val api = server.api()
            assertEquals(listOf(Whiteboard, Note), api.messages("c").single().pages.map { it.kind })
            assertEquals(listOf(Slides, Note), ProjectsApi(api.http).projectDetail("p").notes.map { it.kind })
        }
    }

    @Test
    fun `kinds are written back with their wire value`() {
        val json = NoteFableJson.encodeToString(NotePageSummary.serializer(), NotePageSummary("w", "Board", kind = Whiteboard))
        assertTrue(json, json.contains(""""kind":"whiteboard""""))
        assertEquals(Whiteboard, NoteFableJson.decodeFromString(NotePageSummary.serializer(), json).kind)
    }

    @Test
    fun `the editor's ready message may carry the page kind`() {
        assertEquals(
            EmbedMessage.Ready("p", "Board", null, Whiteboard),
            EmbedMessage.parse("""{"type":"ready","page":{"id":"p","title":"Board","icon":null,"kind":"whiteboard"}}"""),
        )
        // 旧网页不发：null（App 保留已知的类型）；不认识的值按笔记；不是字符串时当作没发，消息本身照常收下。
        assertEquals(EmbedMessage.Ready("p", "T", null, null), EmbedMessage.parse("""{"type":"ready","page":{"id":"p","title":"T","icon":null}}"""))
        assertEquals(EmbedMessage.Ready("p", "T", null, Note), EmbedMessage.parse("""{"type":"ready","page":{"id":"p","title":"T","icon":null,"kind":"mindmap"}}"""))
        assertEquals(EmbedMessage.Ready("p", "T", null, null), EmbedMessage.parse("""{"type":"ready","page":{"id":"p","title":"T","icon":null,"kind":{"x":1}}}"""))
        for (raw in listOf("null", "3", "true")) {
            assertEquals(raw, EmbedMessage.Ready("p", "T", null, null), EmbedMessage.parse("""{"type":"ready","page":{"id":"p","title":"T","icon":null,"kind":$raw}}"""))
        }
    }
}
