package com.kakumine.notefable.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatStreamParserTest {
    @Test
    fun `plain JSON string is a text delta`() {
        val event = ChatStreamParser.parseLine("data: \"Hello\\n世界\"")
        assertEquals(ChatStreamEvent.Delta("Hello\n世界"), event)
    }

    @Test
    fun `activity object is surfaced as an activity event`() {
        val event = ChatStreamParser.parseLine("""data: {"activity":{"type":"thought","id":"t1","delta":"hmm"}}""")
        assertTrue(event is ChatStreamEvent.Activity)
        assertEquals("\"thought\"", (event as ChatStreamEvent.Activity).payload["type"].toString())
    }

    @Test
    fun `done marker, blank lines, comments and non data lines are ignored`() {
        listOf("data: [DONE]", "", "   ", ": keep-alive", "event: message", "data:").forEach {
            assertNull("'$it' should be ignored", ChatStreamParser.parseLine(it))
        }
    }

    @Test
    fun `unreadable payloads are ignored instead of ending the stream`() {
        listOf("data: {not json", "data: 42", "data: {\"other\":1}", "data: [1,2]").forEach {
            assertNull("'$it' should be ignored", ChatStreamParser.parseLine(it))
        }
    }

    @Test
    fun `data prefix without a space and trailing carriage return both work`() {
        assertEquals(ChatStreamEvent.Delta("a"), ChatStreamParser.parseLine("data:\"a\"\r"))
    }
}
