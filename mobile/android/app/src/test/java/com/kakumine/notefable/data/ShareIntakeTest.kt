package com.kakumine.notefable.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ShareIntakeTest {
    @Test
    fun `joins subject and text on separate lines`() {
        assertEquals("Article\nRead this https://example.com", composeSharedText("Article", "Read this https://example.com"))
    }

    @Test
    fun `does not repeat a subject that is already in the text`() {
        assertEquals("Hello world", composeSharedText("Hello", "Hello world"))
    }

    @Test
    fun `keeps multiline text and unicode, trims the edges and ignores blanks`() {
        assertEquals("一行目\n二行目 🎉", composeSharedText("  ", "  一行目\n二行目 🎉  "))
        assertEquals("", composeSharedText(null, null))
        assertEquals("Title", composeSharedText("Title", null))
    }

    @Test
    fun `appends shared text after what the user already typed`() {
        assertEquals("draft\n\nshared", mergeDraftWithShare("draft", "shared"))
    }

    @Test
    fun `uses whichever side is not blank when merging`() {
        assertEquals("shared", mergeDraftWithShare("  ", "shared"))
        assertEquals("draft", mergeDraftWithShare("draft", " "))
    }
}
