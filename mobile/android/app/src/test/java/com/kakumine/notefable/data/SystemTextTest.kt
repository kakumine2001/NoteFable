package com.kakumine.notefable.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

// 与网页 src/lib/i18n/translate.test.ts 的 localizeSystemText 用例逐条对应。
class SystemTextTest {
    private val table = SystemText(
        templates = listOf(
            "Request failed: {detail}",
            "Searched notes for “{query}”",
            "Read “{title}”",
            "Unsupported file type: {name}",
            "File is too large: {name}",
        ),
        messages = mapOf(
            "zh" to mapOf(
                "Request failed: {detail}" to "请求失败：{detail}",
                "Note not found." to "找不到笔记。",
                "Searched notes for “{query}”" to "搜索了笔记“{query}”",
                "Read “{title}”" to "读取了“{title}”",
                "Unsupported file type: {name}" to "不支持的文件类型：{name}",
                "File is too large: {name}" to "文件太大：{name}",
                "Hello {name}, {count} notes" to "{name}，{count} 条笔记",
            ),
        ),
    )
    private val zh = table.translator("zh")

    @Test
    fun `translates formatted errors and tool labels, recursing into detail`() {
        assertEquals("请求失败：找不到笔记。", zh.localize("Request failed: Note not found."))
        assertEquals("搜索了笔记“Rayleigh”", zh.localize("Searched notes for “Rayleigh”"))
        assertEquals("请求失败：不支持的文件类型：a.txt", zh.localize("Request failed: Unsupported file type: a.txt"))
        assertEquals("Something else", zh.localize("Something else"))
        assertEquals("Request failed:", zh.localize("Request failed:"))
    }

    @Test
    fun `keeps titles, queries and filenames that happen to be UI sentences`() {
        assertEquals("读取了“Note not found.”", zh.localize("Read “Note not found.”"))
        assertEquals("搜索了笔记“Note not found.”", zh.localize("Searched notes for “Note not found.”"))
        assertEquals("不支持的文件类型：Note not found.", zh.localize("Unsupported file type: Note not found."))
        assertEquals("读取了“”", zh.localize("Read “”"))
        assertEquals("文件太大：memo (only the beginning was shared)", zh.localize("File is too large: memo (only the beginning was shared)"))
    }

    @Test
    fun `matches the whole text, including a trailing newline`() {
        assertEquals("Read “x”\n", zh.localize("Read “x”\n"))
        assertEquals("搜索了笔记“a\nb”", zh.localize("Searched notes for “a\nb”"))
    }

    @Test
    fun `interpolates once and leaves unknown slots intact`() {
        assertEquals("{count}，2 条笔记", zh.t("Hello {name}, {count} notes", mapOf("name" to "{count}", "count" to "2")))
        assertEquals("Use {key} for commands", zh.t("Use {key} for commands"))
        assertEquals("Missing \$&", zh.t("Missing {name}", mapOf("name" to "\$&")))
    }

    @Test
    fun `other languages and a missing table show the English source`() {
        assertEquals("Note not found.", table.translator("en").localize("Note not found."))
        assertEquals("Request failed: Note not found.", SystemText.Empty.translator("zh").localize("Request failed: Note not found."))
        assertEquals("请求失败：找不到笔记。", table.translator("zh-Hans-CN").localize("Request failed: Note not found."))
    }

    @Test
    fun `replaces only the failure text the server appended at the recorded offset`() {
        val content = "Answer\n\nRequest failed: Note not found."
        assertEquals("Answer\n\n请求失败：找不到笔记。", zh.localizeFailure(content, FailureInfo(8, "Note not found.")))
        // 位置不对、没有记录、或正文被改过：原样显示，不从措辞猜测。
        assertEquals(content, zh.localizeFailure(content, FailureInfo(7, "Note not found.")))
        assertEquals(content, zh.localizeFailure(content, null))
        assertEquals("Request failed: x", zh.localizeFailure("Request failed: x", FailureInfo(99, "x")))
    }

    @Test
    fun `reads failure info from stream events and stored activity`() {
        assertEquals(FailureInfo(3, "Boom"), FailureInfo.from(Json.parseToJsonElement("""{"type":"failure","id":"f","offset":3,"detail":"Boom"}""")))
        assertNull(FailureInfo.from(Json.parseToJsonElement("""{"type":"failure","offset":"3","detail":"Boom"}""")))
        assertNull(FailureInfo.from(Json.parseToJsonElement("""{"type":"tool","offset":3,"detail":"Boom"}""")))
        assertNull(FailureInfo.from(Json.parseToJsonElement("""{"type":"failure","offset":-1,"detail":"Boom"}""")))
        assertEquals(
            FailureInfo(0, "Boom"),
            FailureInfo.fromActivity(Json.parseToJsonElement("""[{"id":"a","kind":"thought","text":"t"},{"id":"f","kind":"failure","offset":0,"detail":"Boom"}]""")),
        )
        assertNull(FailureInfo.fromActivity(Json.parseToJsonElement("""{"kind":"failure","offset":0,"detail":"Boom"}""")))
    }

    @Test
    fun `the bundled asset translates server errors, usage limits and templates`() {
        val asset = SystemText.parse(File("src/main/assets/system-text.json").readText())
        val zh = asset.translator("zh")
        val ja = asset.translator("ja")
        assertEquals("请求失败：数据库暂时不可用。", zh.localize("Request failed: Database is unavailable."))
        val limit = "You've used today's free messages. Sign in for more, or try again tomorrow."
        assertNotEquals(limit, zh.localize(limit))
        assertNotEquals(limit, ja.localize(limit))
        assertEquals("「Plan」を読みました", ja.localize("Read “Plan”"))
        // 繁体中文界面（ui_locale = zh-Hant）用繁体词典，不退回简体；新增语言及 in-ID 别名同样命中各自词典。
        assertEquals("請求失敗：資料庫暫時不可用。", asset.translator("zh-Hant").localize("Request failed: Database is unavailable."))
        assertNotEquals(limit, asset.translator("ko").localize(limit))
        assertNotEquals(limit, asset.translator("ar").localize(limit))
        assertNotEquals(limit, asset.translator("in-ID").localize(limit))
        assertNotEquals(limit, asset.translator("pt-BR").localize(limit))
    }
}
