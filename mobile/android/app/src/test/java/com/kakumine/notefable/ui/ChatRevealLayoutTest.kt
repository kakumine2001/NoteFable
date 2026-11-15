package com.kakumine.notefable.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 定位到消息时的纯逻辑：正常顺序的下标、旧布局的判断、闪烁强度。 */
class ChatRevealLayoutTest {
    private fun msg(id: String) = UiMessage(id, MessageRole.User, "")

    @Test
    fun indexFollowsNormalOrder() {
        val messages = listOf(msg("a"), msg("b"), msg("c"))
        assertEquals(0, revealIndex(messages, "a"))
        assertEquals(2, revealIndex(messages, "c"))
        assertEquals(-1, revealIndex(messages, "gone"))
    }

    @Test
    fun layoutOfThePreviousChatIsStaleEvenWithTheSameItemCount() {
        val ids = setOf("n1", "n2")
        // 上一段聊天也有两条消息：项数一样，但 key 不是这段聊天的。
        assertFalse(layoutIsCurrent(2, listOf("o1", "o2"), 2, ids))
        assertFalse(layoutIsCurrent(3, listOf("n1", "n2"), 2, ids))
        assertFalse(layoutIsCurrent(2, emptyList(), 2, ids))
        assertTrue(layoutIsCurrent(2, listOf("n1", "n2"), 2, ids))
    }

    @Test
    fun flashLevelResumesFromElapsedTimeInsteadOfRestarting() {
        assertEquals(1f, revealFlashLevel(0), 0f)
        assertEquals(1f, revealFlashLevel(1199), 0f)
        val fading = revealFlashLevel(1600)
        assertTrue(fading > 0f && fading < 1f)
        // 滚出屏幕再回来时按开始时间算：已经过了 2 秒就不再画。
        assertEquals(0f, revealFlashLevel(2000), 0f)
        assertEquals(0f, revealFlashLevel(5000), 0f)
    }
}
