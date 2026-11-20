package com.kakumine.notefable.data

/**
 * 回答的一部分选中后点「问 NoteFable」引用：引用作为 Markdown 引用块（"> "）放在发言正文前面发出去。
 * 和网页 src/lib/chat-quote.ts 是同一个格式，两边的逻辑要保持一致。
 */
object ChatQuote {
    /** 引用最多带多少个字符（按码位数），更长的截掉末尾并加 "…"。 */
    const val MAX_CHARS = 2_000

    /** 把选中的文字整理成引用：去掉首尾空白，连续空行合成一行，太长就截断。 */
    fun normalize(selection: String): String {
        val compact = mutableListOf<String>()
        for (raw in selection.replace("\r\n", "\n").replace('\r', '\n').split('\n')) {
            val line = raw.trimEnd()
            if (line.isBlank() && (compact.isEmpty() || compact.last().isBlank())) continue
            compact += line
        }
        val text = compact.joinToString("\n").trim()
        val count = text.codePointCount(0, text.length)
        if (count <= MAX_CHARS) return text
        return text.substring(0, text.offsetByCodePoints(0, MAX_CHARS)).trimEnd() + "…"
    }

    /** 引用和正文合成要发出的一条发言；引用为空时只有正文。 */
    fun compose(quote: String?, body: String): String {
        val text = body.trim()
        val quoted = quote?.trim().orEmpty()
        if (quoted.isEmpty()) return text
        val block = quoted.split('\n').joinToString("\n") { if (it.isBlank()) ">" else "> $it" }
        return if (text.isEmpty()) block else "$block\n\n$text"
    }

    /** 把发言开头的引用块和正文分开（[compose] 的反过程）。只有引用后面隔一个空行还有正文时才分开。 */
    fun split(content: String): Pair<String?, String> {
        val lines = content.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        var end = 0
        while (end < lines.size && (lines[end] == ">" || lines[end].startsWith("> "))) end++
        if (end == 0 || end >= lines.size || lines[end].isNotBlank()) return null to content
        val body = lines.drop(end + 1).joinToString("\n").trim()
        if (body.isEmpty()) return null to content
        val quote = lines.take(end).joinToString("\n") { it.removePrefix(">").removePrefix(" ") }.trim()
        if (quote.isEmpty()) return null to content
        return quote to body
    }
}
