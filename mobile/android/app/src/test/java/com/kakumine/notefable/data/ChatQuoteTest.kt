package com.kakumine.notefable.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatQuoteTest {
    @Test
    fun normalizesTheSelection() {
        assertEquals("hello\n\nworld", ChatQuote.normalize("  hello  \r\n\r\n\r\nworld \n\n"))
        val long = ChatQuote.normalize("😀".repeat(ChatQuote.MAX_CHARS + 5))
        assertTrue(long.endsWith("…"))
        assertEquals(ChatQuote.MAX_CHARS + 1, long.codePointCount(0, long.length))
    }

    @Test
    fun composesABlockquote() {
        assertEquals("> a\n>\n> b\n\nwhy?", ChatQuote.compose("a\n\nb", " why? "))
        assertEquals("why?", ChatQuote.compose(null, " why? "))
        assertEquals("why?", ChatQuote.compose("  ", "why?"))
    }

    @Test
    fun splitsWhatItComposed() {
        listOf("a\n\nb" to "why?", "> nested" to "line 1\n\nline 2", "x" to "> not a quote").forEach { (quote, body) ->
            assertEquals(quote to body, ChatQuote.split(ChatQuote.compose(quote, body)))
        }
    }

    @Test
    fun leavesOtherMessagesAlone() {
        listOf("plain", "> only a quote", "> quote\nno blank line", "text\n\n> later quote", ">\n\nbody", ">not a quote\n\nbody").forEach {
            assertEquals(null to it, ChatQuote.split(it))
        }
    }
}
