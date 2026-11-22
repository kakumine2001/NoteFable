package com.kakumine.notefable.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 和网页 src/lib/note-io.ts（isImportableMarkdownFile、上限）以及 use-note-pages.ts 的 importMarkdown 的检查顺序对应。 */
class NoteImportTest {
    private fun file(name: String, bytes: Long = 10) = NoteImport.Entry(name, bytes)

    @Test
    fun `limits match the web`() {
        assertEquals(20, NoteImport.MAX_FILES)
        assertEquals(1_048_576L, NoteImport.MAX_FILE_BYTES)
        assertEquals(4_194_304L, NoteImport.MAX_TOTAL_BYTES)
    }

    @Test
    fun `accepts md, markdown and txt whatever the case or surrounding spaces`() {
        listOf("a.md", "Plan.MARKDOWN", " notes.txt ", "dir/x.Md", ".md").forEach { assertTrue(it, NoteImport.isImportable(it)) }
        listOf("a.pdf", "md", "a.md.png", "a.mdx", "", "a.txt.bak").forEach { assertFalse(it, NoteImport.isImportable(it)) }
    }

    @Test
    fun `passes a selection inside every limit`() {
        assertNull(NoteImport.check(emptyList()))
        assertNull(NoteImport.check(List(NoteImport.MAX_FILES) { file("n$it.md") }))
        assertNull(NoteImport.check(listOf(file("a.md", NoteImport.MAX_FILE_BYTES))))
        assertNull(NoteImport.check(List(4) { file("n$it.txt", NoteImport.MAX_FILE_BYTES) }))
    }

    @Test
    fun `reports the first problem in the web's order`() {
        assertEquals(NoteImport.Problem.TooMany, NoteImport.check(List(NoteImport.MAX_FILES + 1) { file("n$it.png", Long.MAX_VALUE / 100) }))
        assertEquals(NoteImport.Problem.BadType, NoteImport.check(listOf(file("a.md"), file("b.docx"))))
        assertEquals(NoteImport.Problem.FileTooLarge, NoteImport.check(listOf(file("a.md", NoteImport.MAX_FILE_BYTES + 1))))
        // 前面的文件先报：太大的排在类型不对的前面时报太大。
        assertEquals(NoteImport.Problem.FileTooLarge, NoteImport.check(listOf(file("a.md", NoteImport.MAX_FILE_BYTES + 1), file("b.docx"))))
        assertEquals(NoteImport.Problem.TooLarge, NoteImport.check(List(4) { file("n$it.md", NoteImport.MAX_FILE_BYTES) } + file("last.md", 1)))
    }

    @Test
    fun `the request is measured as the JSON that is sent`() {
        assertEquals(
            """{"files":[{"name":"a.md","markdown":"x\n\"y\""},{"name":"b.txt","markdown":""}]}""",
            NoteImport.requestBody(listOf(ImportMarkdownFile("a.md", "x\n\"y\""), ImportMarkdownFile("b.txt", ""))),
        )
        // 换行转义后每个是 2 个字节：文件合计没超，请求体也可能超。
        val half = NoteImport.MAX_FILE_BYTES.toInt() / 2
        assertFalse(NoteImport.requestTooLarge(List(3) { ImportMarkdownFile("n$it.md", "x".repeat(half) + "\n".repeat(half / 2)) }))
        assertTrue(NoteImport.requestTooLarge(List(4) { ImportMarkdownFile("n$it.md", "\n".repeat(NoteImport.MAX_FILE_BYTES.toInt())) }))
        // 正好 4 个 1 MiB 的文件：加上 JSON 的外框就超了（网页、服务端也一样）。
        assertTrue(NoteImport.requestTooLarge(List(4) { ImportMarkdownFile("n$it.md", "x".repeat(NoteImport.MAX_FILE_BYTES.toInt())) }))
    }
}
