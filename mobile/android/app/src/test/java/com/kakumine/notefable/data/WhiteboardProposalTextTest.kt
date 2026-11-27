package com.kakumine.notefable.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 用网页实现算出的用例（scripts/gen-native-whiteboard-proposal-cases.ts 生成的 whiteboard-proposal-cases.json）核对
 * 白板提案说明的翻译；安装包的 system-text.json 里每一句都有译文。
 */
class WhiteboardProposalTextTest {
    private val cases: JsonObject by lazy {
        val text = javaClass.classLoader!!.getResourceAsStream("whiteboard-proposal-cases.json")!!.readBytes().decodeToString()
        Json.parseToJsonElement(text).jsonObject
    }

    // 记号译文表：每一句包在 ‹› 里（和生成用例时一样）。
    private val marked by lazy {
        val keys = cases["keys"]!!.jsonArray.map { it.jsonPrimitive.content }
        SystemText(emptyList(), mapOf("zh" to keys.associateWith { "‹$it›" })).translator("zh")
    }

    private fun JsonObject.optional(key: String) = this[key]?.jsonPrimitive?.content

    private fun change(json: JsonObject) = ProposalChange(
        op = json.optional("op")!!,
        block = json["block"]!!.jsonPrimitive.int,
        before = json.optional("before"),
        after = json.optional("after"),
        target = json["target"]?.jsonObject?.let { target ->
            if (target.optional("type") == "slide") ProposalTarget.Slide(target["number"]!!.jsonPrimitive.int)
            else ProposalTarget.Elements(target["count"]!!.jsonPrimitive.int, target.optional("name"))
        },
    )

    private fun list(key: String) = (cases[key] as JsonArray).map { it.jsonObject }

    @Test
    fun `changes and summaries are translated like the web`() {
        val changes = list("changes")
        assertTrue(changes.size > 40)
        for (case in changes) {
            val input = change(case["input"]!!.jsonObject)
            assertEquals(input.toString(), change(case["expected"]!!.jsonObject), WhiteboardProposalText.change(input, marked))
        }
        for (case in list("summaries")) {
            val input = case.optional("input")!!
            assertEquals(input, case.optional("expected"), WhiteboardProposalText.summary(input, marked))
        }
    }

    @Test
    fun `the packaged system text has every sentence`() {
        val asset = SystemText.parse(File("src/main/assets/system-text.json").readText())
        for (language in listOf("zh", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt-BR", "it", "id", "vi", "th", "hi", "ar", "tr", "ru")) {
            val translator = asset.translator(language)
            // 整句一定和英文不同；单个词（颜色名等）在个别语言里可能和英文相同，不查。
            for (key in cases["keys"]!!.jsonArray.map { it.jsonPrimitive.content }.filter { it.startsWith("Arrange") || it.startsWith("Move into") }) {
                assertTrue("$language: $key", translator.t(key) != key)
            }
        }
        assertEquals("移入框“{name}”", asset.translator("zh-CN").t("Move into frame “{name}”"))
    }
}
