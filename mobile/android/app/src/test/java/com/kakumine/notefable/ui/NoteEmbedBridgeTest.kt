package com.kakumine.notefable.ui

import com.kakumine.notefable.data.EmbedMessage
import com.kakumine.notefable.data.PageKind
import com.kakumine.notefable.data.PptxImportTarget
import com.kakumine.notefable.data.SlidesWizardSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** App → 网页编辑器的脚本（window.notefableEmbed.reveal，src/lib/native-bridge.ts）。 */
class NoteEmbedBridgeTest {
    @Test
    fun `reveal asks the open editor to jump to the hit`() {
        assertEquals(
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.reveal==='function')e.reveal(\"el_1-A\")})()",
            NoteEmbedBridge.revealScript("el_1-A"),
        )
        assertNotNull(NoteEmbedBridge.revealScript("a".repeat(120)))
    }

    @Test
    fun `ids the web would not accept are never sent`() {
        // 网页的 REVEAL_TARGET 是 /^[A-Za-z0-9_-]{1,120}$/：别的（空的、太长、带引号或空白、非 ASCII）都不发，也就不会拼出别的脚本。
        for (bad in listOf("", " ", "a b", "x'y", "\"); alert(1); (\"", "a/b", "日本", "a\nb", "a".repeat(121))) {
            assertNull(bad, NoteEmbedBridge.revealScript(bad))
        }
    }

    @Test
    fun `only the first load of an editor carries the hit`() {
        val open = OpenNote("w", "Board", null, reveal = "el-1")
        assertEquals("el-1", loadReveal(open, generation = 0))
        assertNull(loadReveal(open, generation = 1))
        assertNull(loadReveal(open.copy(reveal = null), generation = 0))
    }

    @Test
    fun `openPageScript encodes valid page id and optional fields`() {
        assertEquals(
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.openPage==='function')return e.openPage({\"id\":\"page_1\"})===true;return false})()",
            NoteEmbedBridge.openPageScript("page_1"),
        )
        assertEquals(
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.openPage==='function')return e.openPage({\"id\":\"page_1\",\"reveal\":\"blk-2\",\"model\":\"gpt-5\",\"reasoning\":\"high\"})===true;return false})()",
            NoteEmbedBridge.openPageScript("page_1", reveal = "blk-2", model = " gpt-5 ", reasoning = "high"),
        )
        // 非法 reveal 会被忽略，不破坏脚本；非法 id 返回 null。
        assertEquals(
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.openPage==='function')return e.openPage({\"id\":\"page_1\"})===true;return false})()",
            NoteEmbedBridge.openPageScript("page_1", reveal = "bad reveal!"),
        )
        assertNull(NoteEmbedBridge.openPageScript(""))
        assertNull(NoteEmbedBridge.openPageScript("bad/id"))
    }

    @Test
    fun `pageTrashedScript filters valid ids and returns null when empty`() {
        assertEquals(
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.pageTrashed==='function')return e.pageTrashed([\"p1\",\"p_2\"])===true;return false})()",
            NoteEmbedBridge.pageTrashedScript(listOf("p1", "bad id", "p_2")),
        )
        assertNull(NoteEmbedBridge.pageTrashedScript(emptyList()))
        assertNull(NoteEmbedBridge.pageTrashedScript(listOf("bad/id")))
        assertEquals(
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.close==='function')return e.close()===true;return false})()",
            NoteEmbedBridge.CLOSE_SCRIPT,
        )
    }

    @Test
    fun `the slides wizard opens from a chat, a note or a new page`() {
        fun script(request: String) =
            "(function(){var e=window.notefableEmbed;if(!e)return 'loading';if(typeof e.slidesWizard!=='function')return 'unsupported';" +
                "return e.slidesWizard($request)===true?'open':'rejected'})()"
        assertEquals(
            script("""{"action":"open","source":{"type":"chat","sessionId":"s_1"},"model":"gpt-5","reasoning":"high"}"""),
            NoteEmbedBridge.slidesWizardOpenScript(SlidesWizardSource.Chat("s_1"), " gpt-5 ", "high"),
        )
        assertEquals(
            script("""{"action":"open","source":{"type":"note","pageId":"p-1"}}"""),
            NoteEmbedBridge.slidesWizardOpenScript(SlidesWizardSource.Note("p-1"), "", null),
        )
        assertEquals(script("""{"action":"open","source":{"type":"new"}}"""), NoteEmbedBridge.slidesWizardOpenScript(SlidesWizardSource.New()))
        assertEquals(
            script("""{"action":"open","source":{"type":"new","groupId":"g1"}}"""),
            NoteEmbedBridge.slidesWizardOpenScript(SlidesWizardSource.New(groupId = "g1")),
        )
        assertEquals(
            script("""{"action":"open","source":{"type":"new","parentId":"p1"}}"""),
            NoteEmbedBridge.slidesWizardOpenScript(SlidesWizardSource.New(parentId = "p1")),
        )
        // 网页不认的 id 不发。
        assertNull(NoteEmbedBridge.slidesWizardOpenScript(SlidesWizardSource.Chat("a b")))
        assertNull(NoteEmbedBridge.slidesWizardOpenScript(SlidesWizardSource.Note("")))
        assertNull(NoteEmbedBridge.slidesWizardOpenScript(SlidesWizardSource.New(groupId = "g/1")))
        assertNull(NoteEmbedBridge.slidesWizardOpenScript(SlidesWizardSource.New(parentId = "x'y")))
        assertEquals(
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.slidesWizard==='function')return e.slidesWizard({\"action\":\"back\"})===true;return false})()",
            NoteEmbedBridge.SLIDES_WIZARD_BACK_SCRIPT,
        )
    }

    @Test
    fun `opening the wizard keeps asking until the page is ready`() {
        // evaluateJavascript 的结果是 JSON。
        assertEquals(true, NoteEmbedBridge.slidesWizardAnswer("\"open\""))
        assertEquals(false, NoteEmbedBridge.slidesWizardAnswer("\"unsupported\""))
        assertEquals(false, NoteEmbedBridge.slidesWizardAnswer("\"rejected\""))
        assertNull(NoteEmbedBridge.slidesWizardAnswer("\"loading\""))
        assertNull(NoteEmbedBridge.slidesWizardAnswer("null"))
        assertNull(NoteEmbedBridge.slidesWizardAnswer(null))
    }

    @Test
    fun `wizard messages reach the app with or without an open editor`() {
        val closed = EmbedMessage.SlidesWizard(open = false, busy = true)
        val openPage = EmbedMessage.OpenPage("deck")
        val limit = EmbedMessage.UsageLimit("guest", "chat")
        val storage = EmbedMessage.StorageLimit("member", 10L, 20L)
        for (editor in listOf(null, "p1", SLIDES_WIZARD_EDITOR)) {
            assertEquals(EmbedRoute.Wizard, embedRoute(closed, editor))
            assertEquals(EmbedRoute.PagesChanged, embedRoute(EmbedMessage.PagesChanged, editor))
            assertEquals(EmbedRoute.SlidesJobs, embedRoute(EmbedMessage.SlidesJobs(setOf("p1")), editor))
        }
        // 全屏向导：打开幻灯片和上限交给向导，别的（上一个页面晚到的）丢掉。
        assertEquals(EmbedRoute.Wizard, embedRoute(openPage, SLIDES_WIZARD_EDITOR))
        assertEquals(EmbedRoute.Wizard, embedRoute(limit, SLIDES_WIZARD_EDITOR))
        assertEquals(EmbedRoute.Wizard, embedRoute(storage, SLIDES_WIZARD_EDITOR))
        assertEquals(EmbedRoute.Drop, embedRoute(EmbedMessage.SaveState("saved"), SLIDES_WIZARD_EDITOR))
        assertEquals(EmbedRoute.Drop, embedRoute(EmbedMessage.Ready("p1", "T", null), SLIDES_WIZARD_EDITOR))
        // 盖在编辑器上时和编辑器的消息一样处理；停靠中的丢掉。
        assertEquals(EmbedRoute.Editor, embedRoute(openPage, "p1"))
        assertEquals(EmbedRoute.Editor, embedRoute(limit, "p1"))
        assertEquals(EmbedRoute.Editor, embedRoute(storage, "p1"))
        assertEquals(EmbedRoute.Drop, embedRoute(openPage, null))
        assertEquals(EmbedRoute.Drop, embedRoute(limit, null))
        assertEquals(EmbedRoute.Drop, embedRoute(storage, null))
    }

    @Test
    fun `notes and slide decks both expose presentation in the page menu`() {
        assertTrue(supportsPresentation(PageKind.Note))
        assertTrue(supportsPresentation(PageKind.Slides))
        assertFalse(supportsPresentation(PageKind.Whiteboard))
    }

    @Test
    fun `pptx import parses messages, builds scripts, routes events and expands file chooser mime types`() {
        assertEquals(EmbedMessage.PptxImport(open = true), EmbedMessage.parse("""{"type":"pptxImport","state":"open"}"""))
        assertEquals(EmbedMessage.PptxImport(open = false), EmbedMessage.parse("""{"type":"pptxImport","state":"closed"}"""))
        assertNull(EmbedMessage.parse("""{"type":"pptxImport","state":"other"}"""))

        fun script(request: String) =
            "(function(){var e=window.notefableEmbed;if(!e)return 'loading';if(typeof e.pptxImport!=='function')return 'unsupported';" +
                "return e.pptxImport($request)===true?'open':'rejected'})()"
        assertEquals(script("""{"action":"open"}"""), NoteEmbedBridge.pptxImportOpenScript())
        assertEquals(script("""{"action":"open","groupId":"g_1"}"""), NoteEmbedBridge.pptxImportOpenScript(PptxImportTarget(groupId = "g_1")))
        assertEquals(script("""{"action":"open","parentId":"p-2"}"""), NoteEmbedBridge.pptxImportOpenScript(PptxImportTarget(parentId = "p-2")))
        assertNull(NoteEmbedBridge.pptxImportOpenScript(PptxImportTarget(groupId = "bad/id")))
        assertNull(NoteEmbedBridge.pptxImportOpenScript(PptxImportTarget(parentId = "x'y")))
        assertEquals(
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.pptxImport==='function')return e.pptxImport({\"action\":\"back\"})===true;return false})()",
            NoteEmbedBridge.PPTX_IMPORT_BACK_SCRIPT,
        )

        val opened = EmbedMessage.PptxImport(open = true)
        val openPage = EmbedMessage.OpenPage("deck_1")
        val storage = EmbedMessage.StorageLimit("member", 10L, 20L)
        for (editor in listOf(null, "p1", PPTX_IMPORT_EDITOR)) {
            assertEquals(EmbedRoute.PptxImport, embedRoute(opened, editor))
        }
        assertEquals(EmbedRoute.PptxImport, embedRoute(openPage, PPTX_IMPORT_EDITOR))
        assertEquals(EmbedRoute.PptxImport, embedRoute(storage, PPTX_IMPORT_EDITOR))
        assertEquals(EmbedRoute.Drop, embedRoute(EmbedMessage.SaveState("saved"), PPTX_IMPORT_EDITOR))
        assertEquals(EmbedRoute.Editor, embedRoute(openPage, "p1"))
        assertEquals(EmbedRoute.Drop, embedRoute(openPage, null))

        val pptxMimes = webFileChooserMimeTypes(arrayOf(".pptx,$PPTX_MIME_TYPE"))
        assertTrue(PPTX_MIME_TYPE in pptxMimes)
        assertTrue("application/octet-stream" in pptxMimes)
        assertTrue("application/zip" in pptxMimes)
        assertEquals(listOf("application/pdf"), webFileChooserMimeTypes(arrayOf(".pdf")))
        assertEquals(emptyList<String>(), webFileChooserMimeTypes(arrayOf("*/*")))
        assertEquals(emptyList<String>(), webFileChooserMimeTypes(emptyArray()))
    }

    @Test
    fun `review quiz scripts validate ids and kinds and menu supports notes and slides only`() {
        assertTrue(supportsReviewQuiz(PageKind.Note))
        assertTrue(supportsReviewQuiz(PageKind.Slides))
        assertFalse(supportsReviewQuiz(PageKind.Whiteboard))

        val open = NoteEmbedBridge.quizOpenScript("p_1", " gpt-6-luna ", "high")
        assertNotNull(open)
        assertTrue(open!!.contains(""""action":"open""""))
        assertTrue(open.contains(""""pageId":"p_1""""))
        assertTrue(open.contains(""""model":"gpt-6-luna""""))
        assertTrue(open.contains(""""reasoning":"high""""))
        assertNull(NoteEmbedBridge.quizOpenScript("bad id"))
        assertNull(NoteEmbedBridge.quizOpenScript(""))

        assertEquals(true, NoteEmbedBridge.quizAnswer("\"open\""))
        assertEquals(false, NoteEmbedBridge.quizAnswer("\"unsupported\""))
        assertEquals(false, NoteEmbedBridge.quizAnswer("\"rejected\""))
        assertNull(NoteEmbedBridge.quizAnswer("\"loading\""))
        assertNull(NoteEmbedBridge.quizAnswer(null))
        assertEquals(
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.quiz==='function')return e.quiz({\"action\":\"back\"})===true;return false})()",
            NoteEmbedBridge.QUIZ_BACK_SCRIPT,
        )
        assertEquals(EmbedMessage.Quiz(open = true), EmbedMessage.parse("""{"type":"quiz","state":"open"}"""))
        assertEquals(EmbedMessage.Quiz(open = false), EmbedMessage.parse("""{"type":"quiz","state":"closed"}"""))
        assertNull(EmbedMessage.parse("""{"type":"quiz","state":"other"}"""))
    }
}
