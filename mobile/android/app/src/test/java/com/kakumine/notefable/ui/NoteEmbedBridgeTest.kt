package com.kakumine.notefable.ui

import com.kakumine.notefable.data.PageKind
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
    fun `notes and slide decks both expose presentation in the page menu`() {
        assertTrue(supportsPresentation(PageKind.Note))
        assertTrue(supportsPresentation(PageKind.Slides))
        assertFalse(supportsPresentation(PageKind.Whiteboard))
    }
}
