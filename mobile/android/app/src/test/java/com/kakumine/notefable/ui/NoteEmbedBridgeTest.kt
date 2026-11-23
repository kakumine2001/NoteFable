package com.kakumine.notefable.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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
}
