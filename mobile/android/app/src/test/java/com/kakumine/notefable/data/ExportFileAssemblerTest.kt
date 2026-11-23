package com.kakumine.notefable.data

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.Base64

/** 网页导出的文件分块送来、拼成临时文件（src/lib/export-file.ts 的 fileStart / fileChunk / fileEnd / fileAbort）。 */
class ExportFileAssemblerTest {
    @get:Rule
    val temp = TemporaryFolder()

    private val dir: File get() = File(temp.root, "exports")
    private fun assembler(maxBytes: Long = ExportFileAssembler.MAX_BYTES, now: Long = System.currentTimeMillis()) =
        ExportFileAssembler(dir, maxBytes) { now }

    private fun base64(bytes: ByteArray) = Base64.getEncoder().encodeToString(bytes)
    private fun leftovers() = dir.listFiles().orEmpty().toList()

    @Test
    fun `chunks are joined in order into a temp file under the exports dir`() {
        val bytes = ByteArray(1500) { (it % 251).toByte() }
        val files = assembler()
        assertTrue(files.start("f1", "Board.png", "image/png", bytes.size.toLong()))
        assertTrue(files.chunk("f1", 0, base64(bytes.copyOfRange(0, 700))))
        assertTrue(files.chunk("f1", 1, base64(bytes.copyOfRange(700, 1400))))
        assertTrue(files.chunk("f1", 2, base64(bytes.copyOfRange(1400, 1500))))
        val done = files.finish("f1")!!
        assertEquals("Board.png", done.name)
        assertEquals("image/png", done.mime)
        assertEquals(dir.canonicalFile, done.file.parentFile!!.canonicalFile)
        assertArrayEquals(bytes, done.file.readBytes())
        // 交出去的文件由调用方删；拼接器手里已经没有了。
        assertNull(files.finish("f1"))
        assertTrue(done.file.exists())
    }

    @Test
    fun `an empty file has no chunks`() {
        val files = assembler()
        assertTrue(files.start("e", "Empty.svg", "image/svg+xml", 0))
        assertEquals(0L, files.finish("e")!!.file.length())
    }

    @Test
    fun `only the export types are accepted, and parameters and case do not matter`() {
        val files = assembler()
        for (mime in listOf("image/png", "IMAGE/SVG+XML; charset=utf-8", "application/pdf", "application/vnd.openxmlformats-officedocument.presentationml.presentation")) {
            assertTrue(mime, files.start("ok", "a", mime, 1))
        }
        for (mime in listOf("text/html", "application/octet-stream", "image/jpeg", "", "image/png+evil")) {
            assertFalse(mime, files.start("bad", "a.png", mime, 1))
            assertFalse(files.chunk("bad", 0, base64(byteArrayOf(1))))
            assertNull(files.finish("bad"))
        }
        assertEquals(emptyList<File>(), leftovers())
        assertEquals("image/svg+xml", ExportFileAssembler.mimeType(" Image/SVG+xml ;charset=UTF-8"))
        // 幻灯片的多页 PNG 是 ZIP。
        assertEquals("application/zip", ExportFileAssembler.mimeType("application/zip"))
        assertEquals("Deck.zip", ExportFileAssembler.fileName("Deck", "application/zip"))
    }

    @Test
    fun `files over the cap or a negative size are refused`() {
        val files = assembler(maxBytes = 10)
        assertFalse(files.start("big", "a.pdf", "application/pdf", 11))
        assertFalse(files.start("neg", "a.pdf", "application/pdf", -1))
        assertFalse(files.start(" ", "a.pdf", "application/pdf", 1))
        assertTrue(files.start("fits", "a.pdf", "application/pdf", 10))
        assertEquals(64L * 1024 * 1024, ExportFileAssembler.MAX_BYTES)
    }

    @Test
    fun `more bytes than declared drops the transfer and deletes the temp file`() {
        val files = assembler()
        assertTrue(files.start("f", "a.png", "image/png", 3))
        assertTrue(files.chunk("f", 0, base64(byteArrayOf(1, 2))))
        assertFalse(files.chunk("f", 1, base64(byteArrayOf(3, 4))))
        // 作废之后的块和结束都落空。
        assertFalse(files.chunk("f", 2, base64(byteArrayOf(5))))
        assertNull(files.finish("f"))
        assertEquals(emptyList<File>(), leftovers())
    }

    @Test
    fun `fewer bytes than declared fails at the end`() {
        val files = assembler()
        assertTrue(files.start("f", "a.png", "image/png", 4))
        assertTrue(files.chunk("f", 0, base64(byteArrayOf(1, 2))))
        assertNull(files.finish("f"))
        assertEquals(emptyList<File>(), leftovers())
    }

    @Test
    fun `a chunk out of order or with bad base64 drops the transfer`() {
        val files = assembler()
        assertTrue(files.start("skip", "a.png", "image/png", 4))
        assertTrue(files.chunk("skip", 0, base64(byteArrayOf(1, 2))))
        assertFalse(files.chunk("skip", 2, base64(byteArrayOf(3, 4))))
        assertNull(files.finish("skip"))

        assertTrue(files.start("again", "a.png", "image/png", 4))
        assertTrue(files.chunk("again", 0, base64(byteArrayOf(1, 2))))
        assertFalse(files.chunk("again", 0, base64(byteArrayOf(1, 2))))
        assertNull(files.finish("again"))

        assertTrue(files.start("bad", "a.png", "image/png", 4))
        assertFalse(files.chunk("bad", 0, "not base64!"))
        assertNull(files.finish("bad"))
        assertEquals(emptyList<File>(), leftovers())
    }

    @Test
    fun `chunks of another id are ignored without dropping the current one`() {
        val files = assembler()
        assertTrue(files.start("mine", "a.png", "image/png", 2))
        assertFalse(files.chunk("other", 0, base64(byteArrayOf(9))))
        files.abort("other")
        assertNull(files.finish("other"))
        assertTrue(files.chunk("mine", 0, base64(byteArrayOf(1, 2))))
        assertArrayEquals(byteArrayOf(1, 2), files.finish("mine")!!.file.readBytes())
    }

    @Test
    fun `a new start discards the unfinished transfer`() {
        val files = assembler()
        assertTrue(files.start("old", "a.png", "image/png", 4))
        assertTrue(files.chunk("old", 0, base64(byteArrayOf(1, 2))))
        assertTrue(files.start("new", "b.png", "image/png", 1))
        assertEquals(1, leftovers().size)
        assertFalse(files.chunk("old", 1, base64(byteArrayOf(3, 4))))
        assertNull(files.finish("old"))
        assertTrue(files.chunk("new", 0, base64(byteArrayOf(7))))
        assertEquals("b.png", files.finish("new")!!.name)
    }

    @Test
    fun `abort and discard delete the temp file`() {
        val files = assembler()
        assertTrue(files.start("a", "a.png", "image/png", 4))
        assertTrue(files.chunk("a", 0, base64(byteArrayOf(1))))
        files.abort("a")
        assertNull(files.finish("a"))
        assertEquals(emptyList<File>(), leftovers())

        assertTrue(files.start("b", "b.png", "image/png", 4))
        assertTrue(files.chunk("b", 0, base64(byteArrayOf(1))))
        files.discard()
        assertNull(files.finish("b"))
        assertEquals(emptyList<File>(), leftovers())
    }

    @Test
    fun `leftovers older than a day are cleared when the next transfer starts`() {
        val now = 10L * 24 * 60 * 60 * 1000
        dir.mkdirs()
        val stale = File(dir, "export-stale.part").apply { writeBytes(byteArrayOf(1)); setLastModified(now - 25L * 60 * 60 * 1000) }
        val recent = File(dir, "export-recent.part").apply { writeBytes(byteArrayOf(1)); setLastModified(now - 60L * 60 * 1000) }
        assertTrue(assembler(now = now).start("f", "a.png", "image/png", 1))
        assertFalse(stale.exists())
        assertTrue(recent.exists())
    }

    @Test
    fun `file names lose path separators and control characters but keep their extension`() {
        val png = "image/png"
        assertEquals("Board.png", ExportFileAssembler.fileName("Board.png", png))
        assertEquals("abc.svg", ExportFileAssembler.fileName("a/b\\c.svg", "image/svg+xml"))
        assertEquals("evil.pdf", ExportFileAssembler.fileName("../../evil.pdf", "application/pdf"))
        // 控制字符（tab、换行、NUL、C1 的 NEL）去掉（和网页 exportFileName 一样不换成空格），连续空白合成一个。
        assertEquals("tabname.png", ExportFileAssembler.fileName("tab\tname\u0000\u0085.png", png))
        assertEquals("a b c.png", ExportFileAssembler.fileName("  a   b \n c .png", png))
        assertEquals("What.png", ExportFileAssembler.fileName("Wh:*?\"<>|at.png", png))
        assertEquals("日本語のボード.pdf", ExportFileAssembler.fileName("日本語のボード.pdf", "application/pdf"))
        // 扩展名没有时按类型补上；名字部分空了叫 export，开头结尾的点去掉。
        assertEquals("Board.png", ExportFileAssembler.fileName("Board", png))
        assertEquals("Deck.pptx", ExportFileAssembler.fileName("Deck", "application/vnd.openxmlformats-officedocument.presentationml.presentation"))
        assertEquals("export.png", ExportFileAssembler.fileName(".png", png))
        assertEquals("export.png", ExportFileAssembler.fileName("..", png))
        assertEquals("export.png", ExportFileAssembler.fileName("", png))
        assertEquals("export.svg", ExportFileAssembler.fileName("\u0001/\\", "image/svg+xml"))
        assertEquals("name.png", ExportFileAssembler.fileName("name.", png))
        assertEquals("hidden.png", ExportFileAssembler.fileName(".hidden.png", png))
    }

    @Test
    fun `the extension always follows the type`() {
        val png = "image/png"
        // 别的扩展名是名字的一部分，后面补上类型的扩展名。
        assertEquals("board.apk.png", ExportFileAssembler.fileName("board.apk", png))
        assertEquals("board.html.svg", ExportFileAssembler.fileName("board.html", "image/svg+xml"))
        assertEquals("Plan v1.2.png", ExportFileAssembler.fileName("Plan v1.2", png))
        // 已经以类型的扩展名结尾（不分大小写）就不重复。
        assertEquals("Board.png", ExportFileAssembler.fileName("Board.PNG", png))
        // 改变文字方向的字符去掉（不能把扩展名显示成别的样子）。
        assertEquals("reportgnp.apk.png", ExportFileAssembler.fileName("report‮gnp.apk", png))
        assertEquals("ab.png", ExportFileAssembler.fileName("a⁦‏b⁩.png", png))
    }

    @Test
    fun `long file names are cut to 120 characters and 255 bytes keeping the extension and whole surrogate pairs`() {
        val long = ExportFileAssembler.fileName("a".repeat(200) + ".png", "image/png")
        assertEquals(ExportFileAssembler.MAX_NAME_LENGTH, long.length)
        assertEquals("a".repeat(116) + ".png", long)
        // 中日韩的字是 3 个字节：按 255 字节截（83 个字 + .png）。
        val cjk = ExportFileAssembler.fileName("あ".repeat(200) + ".png", "image/png")
        assertEquals("あ".repeat(83) + ".png", cjk)
        assertTrue(cjk.toByteArray(Charsets.UTF_8).size <= ExportFileAssembler.MAX_NAME_BYTES)
        // 第 116 个字符是表情的前半：整个表情去掉，不留半个。
        val emoji = ExportFileAssembler.fileName("a".repeat(115) + "😀😀.png", "image/png")
        assertEquals("a".repeat(115) + ".png", emoji)
        // 按字节截时也不切开表情（4 个字节）：83 个字（249 字节）之后的表情放不下，整个去掉。
        val emojiBytes = ExportFileAssembler.fileName("あ".repeat(83) + "😀.png", "image/png")
        assertEquals("あ".repeat(83) + ".png", emojiBytes)
        // 网页的名字部分最长 120（加扩展名 124）：照样截到 120。
        assertEquals(120, ExportFileAssembler.fileName("b".repeat(120) + ".pdf", "application/pdf").length)
    }

    @Test
    fun `the transfer keeps the cleaned name`() {
        val files = assembler()
        assertTrue(files.start("f", "../a/b.png", "image/png", 0))
        assertEquals("ab.png", files.finish("f")!!.name)
    }
}
