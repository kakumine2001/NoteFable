package com.kakumine.notefable.ui

import com.kakumine.notefable.data.ImageSaver
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AnswerPartsTest {
    // ---- 代码块：语言选择与网页 assistant-markdown.tsx 一致 ----

    @Test
    fun `language comes from the fence with web aliases, then the python guess, then detection`() {
        assertEquals("typescript", CodeHighlighter.highlight("const a = 1", "tsx").language)
        assertEquals("cpp", CodeHighlighter.highlight("int x;", "C++").language)
        assertEquals("xml", CodeHighlighter.highlight("<p>x</p>", "language-html").language)
        assertEquals("python", CodeHighlighter.highlight("name = input()\nprint(name)", null).language)
        assertEquals("plaintext", CodeHighlighter.highlight("hello world", null).language)
        assertEquals("plaintext", CodeHighlighter.highlight("hello world", "text").language)
        assertEquals("javascript", CodeHighlighter.highlight("const total = items.map((x) => x * 2);\nconsole.log(total);", null).language)
    }

    @Test
    fun `python tokens use the web theme classes`() {
        val code = "@cache\ndef add(a, b):\n    # sum\n    return a + 1 if True else \"no\""
        val tokens = CodeHighlighter.tokenize(code, "python").associate { code.substring(it.start, it.end) to it.kind }
        assertEquals(CodeTokenKind.Meta, tokens["@cache"])
        assertEquals(CodeTokenKind.Keyword, tokens["def"])
        assertEquals(CodeTokenKind.Title, tokens["add"])
        assertEquals(CodeTokenKind.Comment, tokens["# sum"])
        assertEquals(CodeTokenKind.Keyword, tokens["return"])
        assertEquals(CodeTokenKind.Number, tokens["1"])
        assertEquals(CodeTokenKind.Number, tokens["True"])
        assertEquals(CodeTokenKind.String, tokens["\"no\""])
    }

    @Test
    fun `large json is tokenized in linear time and keys still found across spaces`() {
        // 4 万个键值对（约 1MB）：按下标找冒号，不对每个字符串复制剩余文本。平方级时这里要几十秒以上。
        val json = (0 until 40_000).joinToString(",\n", "{\n", "\n}") { "\"key$it\" \t: \"value$it\"" }
        val started = System.nanoTime()
        val tokens = CodeHighlighter.tokenize(json, "json")
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        assertTrue("tokenizing took ${elapsedMs}ms", elapsedMs < 5_000)
        assertEquals(80_000, tokens.size)
        assertEquals(40_000, tokens.count { it.kind == CodeTokenKind.Variable })
        assertEquals(CodeTokenKind.Variable, tokens.first().kind)
        assertEquals(CodeTokenKind.String, tokens.last().kind)
        // 字符串在末尾、后面没有冒号时是值。
        assertEquals(listOf(CodeTokenKind.String), CodeHighlighter.tokenize("\"tail\"  ", "json").map { it.kind })
    }

    @Test
    fun `json keys, html tags, bash variables and sql keywords`() {
        val json = """{"name": "x", "n": -2, "ok": true}"""
        val j = CodeHighlighter.tokenize(json, "json").associate { json.substring(it.start, it.end) to it.kind }
        assertEquals(CodeTokenKind.Variable, j["\"name\""])
        assertEquals(CodeTokenKind.String, j["\"x\""])
        assertEquals(CodeTokenKind.Number, j["-2"])
        assertEquals(CodeTokenKind.Number, j["true"])

        val html = """<a href="/x">hi</a><!-- c -->"""
        val h = CodeHighlighter.tokenize(html, "xml").map { html.substring(it.start, it.end) to it.kind }
        assertTrue(("<a href=\"/x\">" to CodeTokenKind.Tag) in h)
        assertTrue(("a" to CodeTokenKind.Title) in h)
        assertTrue(("href" to CodeTokenKind.Variable) in h)
        assertTrue(("\"/x\"" to CodeTokenKind.String) in h)
        assertTrue(("<!-- c -->" to CodeTokenKind.Comment) in h)

        val sh = "echo \"\$HOME\" # done\nexport PATH=\${PATH}"
        val b = CodeHighlighter.tokenize(sh, "bash").map { sh.substring(it.start, it.end) to it.kind }
        assertTrue(("echo" to CodeTokenKind.BuiltIn) in b)
        assertTrue(("# done" to CodeTokenKind.Comment) in b)
        assertTrue(("\${PATH}" to CodeTokenKind.Variable) in b)

        val sql = "SELECT id FROM users -- all"
        val q = CodeHighlighter.tokenize(sql, "sql").map { sql.substring(it.start, it.end) to it.kind }
        assertTrue(("SELECT" to CodeTokenKind.Keyword) in q)
        assertTrue(("-- all" to CodeTokenKind.Comment) in q)
    }

    @Test
    fun `css and c directives`() {
        val css = "a.btn { color: #fff; margin: 0 4px; }"
        val c = CodeHighlighter.tokenize(css, "css").map { css.substring(it.start, it.end) to it.kind }
        assertTrue(("a" to CodeTokenKind.Keyword) in c)
        assertTrue(("color" to CodeTokenKind.Variable) in c)
        assertTrue(("#fff" to CodeTokenKind.Number) in c)
        assertTrue(("4px" to CodeTokenKind.Number) in c)

        val src = "#include <stdio.h>\nint main() { return 0; }"
        val t = CodeHighlighter.tokenize(src, "c").map { src.substring(it.start, it.end) to it.kind }
        assertTrue(("#include <stdio.h>" to CodeTokenKind.Meta) in t)
        assertTrue(("<stdio.h>" to CodeTokenKind.String) in t)
        assertTrue(("int" to CodeTokenKind.Number) in t)
    }

    // ---- 表格：浏览器自动表格布局的列宽分配 ----

    @Test
    fun `table columns use their natural width when everything fits`() {
        assertArrayEquals(intArrayOf(100, 150), tableColumnWidths(intArrayOf(88, 88), intArrayOf(100, 150), 400))
    }

    @Test
    fun `table columns share the extra width by how much they want`() {
        assertArrayEquals(intArrayOf(200, 100), tableColumnWidths(intArrayOf(100, 100), intArrayOf(300, 100), 300))
        assertEquals(333, tableColumnWidths(intArrayOf(90, 100, 110), intArrayOf(400, 500, 600), 333).sum())
    }

    @Test
    fun `table columns keep their minimum and scroll when even that does not fit`() {
        assertArrayEquals(IntArray(5) { 88 }, tableColumnWidths(IntArray(5) { 88 }, IntArray(5) { 300 }, 360))
    }

    // ---- 来源标签（网页 chat-activity.tsx sourceLabel / shortUrl） ----

    @Test
    fun `source chips show the site and the last path segment`() {
        assertEquals("example.com › Café", sourceLabel("https://www.example.com/wiki/Caf%C3%A9"))
        assertEquals("example.com", sourceLabel("https://example.com/"))
        assertEquals("example.com/docs/a b", shortUrl("https://example.com/docs/a%20b"))
        assertEquals("example.com", shortUrl("https://example.com/"))
    }

    // ---- 生成图片的保存 ----

    @Test
    fun `saved images use the web download name and decode data urls`() {
        assertEquals("notefable-abc.png", ImageSaver.fileName("abc", "image/png"))
        assertEquals("notefable-a_b.jpg", ImageSaver.fileName("a/b", "image/jpeg"))
        val (bytes, type) = ImageSaver.decodeDataUrl("data:image/webp;base64,AQID")!!
        assertArrayEquals(byteArrayOf(1, 2, 3), bytes)
        assertEquals("image/webp", type)
        assertNull(ImageSaver.decodeDataUrl("/api/attachments/x/image"))
        assertNull(ImageSaver.decodeDataUrl("data:text/plain,hi"))
    }
}
