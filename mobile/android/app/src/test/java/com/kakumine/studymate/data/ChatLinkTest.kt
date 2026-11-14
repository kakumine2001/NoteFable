package com.kakumine.studymate.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChatLinkTest {
    private val base = "https://studymate.example"

    @Test
    fun `opens the chat and message from the saved-answer link and its forwarded forms`() {
        assertEquals(ChatLink.Open("sess123", "msg_1-a"), ChatLink.parse("https://studymate.example/?chat=sess123&message=msg_1-a", base))
        assertEquals(ChatLink.Open("sess123", null), ChatLink.parse("https://studymate.example/?chat=sess123", base))
        assertEquals(ChatLink.Open("s", "m"), ChatLink.parse("https://studymate.example/app?chat=s&message=m", base))
        assertEquals(ChatLink.Open("s", null), ChatLink.parse("https://studymate.example/ja/app?chat=s", base))
    }

    @Test
    fun `a bad chat id is invalid and a bad message id is dropped like the web`() {
        assertEquals(ChatLink.Invalid, ChatLink.parse("https://studymate.example/?chat=a%2Fb", base))
        assertEquals(ChatLink.Invalid, ChatLink.parse("https://studymate.example/?chat=" + "x".repeat(65), base))
        assertEquals(ChatLink.Open("ok", null), ChatLink.parse("https://studymate.example/?chat=ok&message=a.b", base))
    }

    @Test
    fun `ignores other sites, other pages and links without a chat`() {
        assertNull(ChatLink.parse("https://evil.example/?chat=s", base))
        assertNull(ChatLink.parse("http://studymate.example/?chat=s", base))
        assertNull(ChatLink.parse("https://studymate.example:8443/?chat=s", base))
        assertNull(ChatLink.parse("https://studymate.example/note-embed?chat=s", base))
        assertNull(ChatLink.parse("https://studymate.example/?view=pages&page=p", base))
        assertNull(ChatLink.parse("https://studymate.example/?chat=", base))
        assertNull(ChatLink.parse("not a url", base))
    }

    @Test
    fun `treats the new domain and the old vercel address as the same site`() {
        val old = "https://studymate-lab-ai.vercel.app"
        assertEquals(ChatLink.Open("c1", "m1"), ChatLink.parse("https://notefable.com/?chat=c1&message=m1", old))
        assertEquals(ChatLink.Open("c1", null), ChatLink.parse("https://studymate-lab-ai.vercel.app/?chat=c1", "https://notefable.com"))
        assertNull(ChatLink.parse("https://notefable.com.evil.example/?chat=c1", old))
    }
}
