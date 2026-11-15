package com.kakumine.notefable.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChatLinkTest {
    private val base = "https://notefable.example"

    @Test
    fun `opens the chat and message from the saved-answer link and its forwarded forms`() {
        assertEquals(ChatLink.Open("sess123", "msg_1-a"), ChatLink.parse("https://notefable.example/?chat=sess123&message=msg_1-a", base))
        assertEquals(ChatLink.Open("sess123", null), ChatLink.parse("https://notefable.example/?chat=sess123", base))
        assertEquals(ChatLink.Open("s", "m"), ChatLink.parse("https://notefable.example/app?chat=s&message=m", base))
        assertEquals(ChatLink.Open("s", null), ChatLink.parse("https://notefable.example/ja/app?chat=s", base))
    }

    @Test
    fun `a bad chat id is invalid and a bad message id is dropped like the web`() {
        assertEquals(ChatLink.Invalid, ChatLink.parse("https://notefable.example/?chat=a%2Fb", base))
        assertEquals(ChatLink.Invalid, ChatLink.parse("https://notefable.example/?chat=" + "x".repeat(65), base))
        assertEquals(ChatLink.Open("ok", null), ChatLink.parse("https://notefable.example/?chat=ok&message=a.b", base))
    }

    @Test
    fun `ignores other sites, other pages and links without a chat`() {
        assertNull(ChatLink.parse("https://evil.example/?chat=s", base))
        assertNull(ChatLink.parse("http://notefable.example/?chat=s", base))
        assertNull(ChatLink.parse("https://notefable.example:8443/?chat=s", base))
        assertNull(ChatLink.parse("https://notefable.example/note-embed?chat=s", base))
        assertNull(ChatLink.parse("https://notefable.example/?view=pages&page=p", base))
        assertNull(ChatLink.parse("https://notefable.example/?chat=", base))
        assertNull(ChatLink.parse("not a url", base))
    }

    @Test
    fun `treats notefable_com and www as the same site`() {
        val base = "https://notefable.com"
        assertEquals(ChatLink.Open("c1", "m1"), ChatLink.parse("https://www.notefable.com/?chat=c1&message=m1", base))
        assertNull(ChatLink.parse("https://notefable.com.evil.example/?chat=c1", base))
    }
}
