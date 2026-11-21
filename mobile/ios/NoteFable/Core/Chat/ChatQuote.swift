import Foundation

/// 回答的一部分选中后点「问 NoteFable」引用：引用作为 Markdown 引用块（"> "）放在发言正文前面发出去。
/// 和网页 `src/lib/chat-quote.ts`、Android `data/ChatQuote.kt` 是同一个格式，三边的逻辑要保持一致。
enum ChatQuote {
    /// 引用最多带多少个字符（按码位数），更长的截掉末尾并加 "…"。
    static let maxChars = 2_000

    /// 把选中的文字整理成引用：去掉首尾空白，连续空行合成一行，太长就截断。
    static func normalize(_ selection: String) -> String {
        var compact: [String] = []
        for raw in ChatText.lines(selection) {
            let line = ChatText.trimEnd(raw)
            if line.isEmpty, compact.isEmpty || compact[compact.count - 1].isEmpty { continue }
            compact.append(line)
        }
        let text = ChatText.trim(compact.joined(separator: "\n"))
        let scalars = text.unicodeScalars
        if scalars.count <= maxChars { return text }
        return ChatText.trimEnd(String(scalars.prefix(maxChars))) + "…"
    }

    /// 引用和正文合成要发出的一条发言；引用为空时只有正文。
    static func compose(quote: String?, body: String) -> String {
        let text = ChatText.trim(body)
        let quoted = ChatText.trim(quote ?? "")
        if quoted.isEmpty { return text }
        let block = ChatText.splitLines(quoted)
            .map { ChatText.isBlank($0) ? ">" : "> \($0)" }
            .joined(separator: "\n")
        return text.isEmpty ? block : "\(block)\n\n\(text)"
    }

    /// 把发言开头的引用块和正文分开（`compose` 的反过程）。只有引用后面隔一个空行还有正文时才分开。
    static func split(_ content: String) -> (quote: String?, body: String) {
        let lines = ChatText.lines(content)
        var end = 0
        while end < lines.count, lines[end] == ">" || lines[end].hasPrefix("> ") { end += 1 }
        if end == 0 || end >= lines.count || !ChatText.isBlank(lines[end]) { return (nil, content) }
        let body = ChatText.trim(lines[(end + 1)...].joined(separator: "\n"))
        if body.isEmpty { return (nil, content) }
        let quote = ChatText.trim(
            lines[..<end].map { line -> String in
                var rest = Substring(line)
                if rest.hasPrefix(">") { rest = rest.dropFirst() }
                if rest.hasPrefix(" ") { rest = rest.dropFirst() }
                return String(rest)
            }.joined(separator: "\n")
        )
        if quote.isEmpty { return (nil, content) }
        return (quote, body)
    }
}
