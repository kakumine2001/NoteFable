package com.kakumine.studymate.data

import java.text.Normalizer

/**
 * 横断检索的"折叠"，逐条移植自网页 `src/lib/search-fold.ts`（只移植客户端用到的部分：折叠、命中范围、计数、摘录）。
 * 规则：NFKC（全角英数→半角、半角假名→全角、兼容字符统一）→ 小写 → 平假名→片假名 → 排版用引号、破折号→ASCII。
 * 规则只在 search-fold.ts 里改；改了以后运行 `npx tsx scripts/gen-native-search-fold-cases.ts` 重新生成对照用例，
 * SearchFoldParityTest 会用它核对两边结果一致。位置都是 UTF-16 下标（和 JS 一样）。
 */
object SearchFold {
    private const val KANA_OFFSET = 0x60

    private fun isHiragana(code: Int) = code in 0x3041..0x3096 || code == 0x309d || code == 0x309e

    private val TYPOGRAPHY: Map<Char, Char> = buildMap {
        listOf(0x2018, 0x2019, 0x201a, 0x201b, 0x2032).forEach { put(it.toChar(), '\'') }
        listOf(0x201c, 0x201d, 0x201e, 0x201f, 0x2033).forEach { put(it.toChar(), '"') }
        listOf(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212).forEach { put(it.toChar(), '-') }
    }

    /** NFKC 下会和前一个字合成的字：组合记号、半角浊点 / 半浊点、谚文字母的元音 / 收音（search-fold.ts 的 CONTINUATION）。 */
    private fun isContinuation(codePoint: Int): Boolean {
        when (Character.getType(codePoint)) {
            Character.NON_SPACING_MARK.toInt(), Character.ENCLOSING_MARK.toInt(), Character.COMBINING_SPACING_MARK.toInt() -> return true
        }
        return codePoint in 0x1160..0x11ff || codePoint in 0xd7b0..0xd7ff || codePoint == 0xff9e || codePoint == 0xff9f
    }

    private fun foldCluster(cluster: String): String {
        // ASCII 单字 NFKC 不变（长英文不必逐字 normalize）。
        if (cluster.length == 1 && cluster[0].code < 0x80) return cluster.lowercase()
        val lowered = Normalizer.normalize(cluster, Normalizer.Form.NFKC).lowercase()
        val out = StringBuilder(lowered.length)
        for (char in lowered) {
            val code = char.code
            out.append(
                when {
                    isHiragana(code) -> (code + KANA_OFFSET).toChar()
                    else -> TYPOGRAPHY[char] ?: char
                },
            )
        }
        return out.toString()
    }

    /** folded[i] 来自原文的 [starts[i], ends[i])（UTF-16 位置）。 */
    class FoldMap(val folded: String, val starts: IntArray, val ends: IntArray)

    fun foldWithMap(text: String): FoldMap {
        val starts = ArrayList<Int>(text.length)
        val ends = ArrayList<Int>(text.length)
        val folded = StringBuilder(text.length)
        fun flush(from: Int, to: Int) {
            val piece = foldCluster(text.substring(from, to))
            folded.append(piece)
            repeat(piece.length) {
                starts.add(from)
                ends.add(to)
            }
        }
        var from = 0
        var at = 0
        while (at < text.length) {
            val codePoint = text.codePointAt(at)
            if (at > from && !isContinuation(codePoint)) {
                flush(from, at)
                from = at
            }
            at += Character.charCount(codePoint)
        }
        if (at > from) flush(from, at)
        return FoldMap(folded.toString(), starts.toIntArray(), ends.toIntArray())
    }

    /** 检索词的折叠。去掉 NUL（和网页一致）。 */
    fun foldSearchText(text: String): String = foldWithMap(text).folded.replace("\u0000", "")

    const val MAX_SEARCH_QUERY_CHARS = 100
    const val MAX_SEARCH_TERMS = 8

    /** 网页 src/types/search.ts 的 parseSearchTerms：折叠、按空白切开、去重，最多 8 个词。 */
    fun parseSearchTerms(query: String): List<String> =
        foldSearchText(query).split(JS_WHITESPACE).filter { it.isNotEmpty() }.distinct().take(MAX_SEARCH_TERMS)

    private val SHORT_TERM = Regex("^[a-z0-9]{1,2}$")

    /** 1~2 个字符的英数字词只在词首命中（"detail" 里的 "ai" 不算）。 */
    fun isShortAsciiTerm(term: String) = SHORT_TERM.matches(term)

    private fun isAsciiWordChar(char: Char) = char in 'a'..'z' || char in '0'..'9'

    private fun acceptsMatch(folded: String, at: Int, term: String) =
        !isShortAsciiTerm(term) || at == 0 || !isAsciiWordChar(folded[at - 1])

    fun countMatchedTerms(text: String, terms: List<String>): Int {
        if (text.isEmpty()) return 0
        val folded = foldSearchText(text)
        var count = 0
        for (term in terms) {
            if (term.isEmpty()) continue
            var from = folded.indexOf(term)
            while (from >= 0) {
                if (acceptsMatch(folded, from, term)) {
                    count++
                    break
                }
                from = folded.indexOf(term, from + 1)
            }
        }
        return count
    }

    data class TextRange(val start: Int, val end: Int)

    /** 原文里命中的范围，从左到右、不重叠；同一位置优先长的词。terms 是折叠过的。 */
    fun findTermRanges(text: String, terms: List<String>): List<TextRange> {
        val needles = terms.distinct().filter { it.isNotEmpty() }
        if (text.isEmpty() || needles.isEmpty()) return emptyList()
        val map = foldWithMap(text)
        val folded = map.folded
        val found = ArrayList<TextRange>()
        for (needle in needles) {
            var at = folded.indexOf(needle)
            while (at >= 0) {
                if (acceptsMatch(folded, at, needle)) found.add(TextRange(at, at + needle.length))
                at = folded.indexOf(needle, at + 1)
            }
        }
        found.sortWith(compareBy<TextRange> { it.start }.thenByDescending { it.end })
        val ranges = ArrayList<TextRange>()
        var cursor = 0
        for (match in found) {
            if (match.start < cursor) continue
            cursor = match.end
            val start = map.starts[match.start]
            val end = map.ends[match.end - 1]
            val last = ranges.lastOrNull()
            // 一个原字（㌔）展开出的两处命中，在原文上是同一段。
            if (last != null && start < last.end) ranges[ranges.size - 1] = last.copy(end = maxOf(last.end, end))
            else ranges.add(TextRange(start, end))
        }
        return ranges
    }

    private const val SNIPPET_CHARS = 160

    fun buildSearchSnippet(body: String?, terms: List<String>): String {
        val text = (body ?: "").replace(JS_WHITESPACE, " ").trim(::isJsWhitespace)
        val at = findTermRanges(text, terms).firstOrNull()?.start ?: 0
        var start = maxOf(0, at - SNIPPET_CHARS / 4)
        var end = start + SNIPPET_CHARS
        if (start > 0 && start < text.length && text[start].isLowSurrogate()) start--
        if (end < text.length && text[end].isLowSurrogate()) end++
        val sliceEnd = minOf(end, text.length)
        return (if (start > 0) "…" else "") + text.substring(minOf(start, text.length), sliceEnd) + (if (end < text.length) "…" else "")
    }

    /** 高亮用：把文字切成"命中 / 不命中"的片段（网页 search-dialog.tsx 的 splitHighlight）。 */
    fun splitHighlight(text: String, terms: List<String>): List<Pair<String, Boolean>> {
        if (text.isEmpty()) return emptyList()
        val parts = ArrayList<Pair<String, Boolean>>()
        var last = 0
        for (range in findTermRanges(text, terms)) {
            if (range.start > last) parts.add(text.substring(last, range.start) to false)
            parts.add(text.substring(range.start, range.end) to true)
            last = range.end
        }
        if (last < text.length) parts.add(text.substring(last) to false)
        return parts
    }

    // JS 的 \s：空白、行终止符、NBSP、BOM 和 Unicode Zs。
    private fun isJsWhitespace(char: Char): Boolean = JS_WHITESPACE.matches(char.toString())

    private val JS_WHITESPACE = Regex("[\\t\\n\\u000B\\u000C\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")
}
