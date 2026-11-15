package com.kakumine.notefable.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AttachmentsTest {
    private fun file(name: String, type: String, size: Long) = LocalFile("content://$name", name, type, size)

    @Test
    fun `sizes are written the way the web composer writes them`() {
        assertEquals("1 KiB", formatUploadSize(1))
        assertEquals("98 KiB", formatUploadSize(100_000))
        assertEquals("0.1 MiB", formatUploadSize(110_000))
        assertEquals("1.5 MiB", formatUploadSize(1_572_864))
        assertEquals("20 MiB", formatUploadSize(MAX_UPLOAD_FILE_BYTES))
    }

    @Test
    fun `accepts images, PDFs, text files and known extensions with an unhelpful type`() {
        val files = listOf(
            file("a.png", "image/png", 10),
            file("b.pdf", "application/pdf", 10),
            file("c.txt", "text/plain", 10),
            file("d.md", "application/octet-stream", 10),
        )
        assertNull(attachmentError(files, supportsImages = true))
    }

    @Test
    fun `names the first problem in the same order as the web`() {
        assertEquals(AttachError.Empty("a.txt"), attachmentError(listOf(file("a.txt", "text/plain", 0)), true))
        assertEquals(AttachError.Unsupported("a.zip"), attachmentError(listOf(file("a.zip", "application/zip", 5)), true))
        assertEquals(AttachError.ModelCannotReadImages, attachmentError(listOf(file("a.png", "image/png", 5)), false))
        assertEquals(
            AttachError.FileTooLarge("a.pdf", MAX_UPLOAD_FILE_BYTES),
            attachmentError(listOf(file("a.pdf", "application/pdf", MAX_UPLOAD_FILE_BYTES + 1)), true),
        )
        val six = (1..6).map { file("$it.pdf", "application/pdf", MAX_UPLOAD_FILE_BYTES) }
        assertEquals(AttachError.TotalTooLarge(MAX_UPLOAD_TOTAL_BYTES), attachmentError(six, true))
    }

    @Test
    fun `a selection that does not fit is refused whole`() {
        val nine = (1..9).map { file("$it.txt", "text/plain", 5) }
        val two = (1..2).map { file("new$it.txt", "text/plain", 5) }
        assertEquals(AttachError.RoomForFewer(1, MAX_UPLOAD_FILES, 2), selectionError(nine, two, true))
        assertEquals(AttachError.SlotsFull(MAX_UPLOAD_FILES), selectionError(nine + two.take(1), two, true))
        assertEquals(
            AttachError.NotAdded(AttachError.Unsupported("x.zip")),
            selectionError(nine.take(1), listOf(file("x.zip", "application/zip", 5)), true),
        )
        assertNull(selectionError(nine, two.take(1), true))
    }
}
