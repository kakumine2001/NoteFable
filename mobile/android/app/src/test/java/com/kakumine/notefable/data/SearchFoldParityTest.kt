package com.kakumine.notefable.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 用网页实现算出的用例（scripts/gen-native-search-fold-cases.ts 生成的 search-fold-cases.json）核对 Kotlin 版折叠。
 * 输入和 src/lib/search-fold.test.ts 相同。
 */
class SearchFoldParityTest {
    private val cases: JsonObject by lazy {
        val text = javaClass.classLoader!!.getResourceAsStream("search-fold-cases.json")!!.readBytes().decodeToString()
        Json.parseToJsonElement(text).jsonObject
    }

    private fun JsonObject.str(key: String) = this[key]!!.jsonPrimitive.content
    private fun JsonObject.strings(key: String) = this[key]!!.jsonArray.map { it.jsonPrimitive.content }
    private fun JsonObject.ints(key: String) = this[key]!!.jsonArray.map { it.jsonPrimitive.int }
    private fun list(key: String) = (cases[key] as JsonArray).map { it.jsonObject }

    @Test
    fun `folding and the position map match the web`() {
        val fold = list("fold")
        assertTrue(fold.size > 20)
        for (case in fold) {
            val input = case.str("input")
            assertEquals(input, case.str("folded"), SearchFold.foldSearchText(input))
            val map = SearchFold.foldWithMap(input)
            assertEquals(input, case.str("mapped"), map.folded)
            assertEquals(input, case.ints("starts"), map.starts.toList())
            assertEquals(input, case.ints("ends"), map.ends.toList())
        }
    }

    @Test
    fun `match ranges and term counts match the web`() {
        for (case in list("ranges")) {
            val text = case.str("text")
            val expected = case["ranges"]!!.jsonArray.map { it.jsonObject.let { r -> SearchFold.TextRange(r["start"]!!.jsonPrimitive.int, r["end"]!!.jsonPrimitive.int) } }
            assertEquals(text, expected, SearchFold.findTermRanges(text, case.strings("terms")))
        }
        for (case in list("counts")) {
            assertEquals(case.str("text"), case["count"]!!.jsonPrimitive.int, SearchFold.countMatchedTerms(case.str("text"), case.strings("terms")))
        }
    }

    @Test
    fun `snippets and parsed terms match the web`() {
        for (case in list("snippets")) {
            val body = case["body"].takeIf { it != JsonNull }?.jsonPrimitive?.content
            assertEquals(body, case.str("snippet"), SearchFold.buildSearchSnippet(body, case.strings("terms")))
        }
        for (case in list("terms")) {
            assertEquals(case.str("query"), case.strings("terms"), SearchFold.parseSearchTerms(case.str("query")))
        }
    }

    @Test
    fun `split highlight keeps the original characters`() {
        assertEquals(
            listOf("ＡＰＩ" to true, "設計と " to false, "Api" to true),
            SearchFold.splitHighlight("ＡＰＩ設計と Api", listOf("api")),
        )
        assertEquals(emptyList<Pair<String, Boolean>>(), SearchFold.splitHighlight("", listOf("a")))
    }
}
