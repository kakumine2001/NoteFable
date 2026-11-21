import XCTest
@testable import NoteFableCore

/// 回答的 Markdown → 值树（`MarkdownDocument`）。Android 由渲染库完成，没有对应的测试；语法范围对照网页的 react-markdown + remark-gfm。
final class MarkdownDocumentTests: XCTestCase {
    private func parse(_ markdown: String, math: Bool = true) -> [MarkdownBlock] {
        MarkdownDocument.parse(markdown, math: math).blocks
    }

    private func contents(_ markdown: String) -> [MarkdownBlock.Content] {
        parse(markdown).map(\.content)
    }

    private func paragraph(_ markdown: String, file: StaticString = #filePath, line: UInt = #line) -> [MarkdownInline] {
        let blocks = parse(markdown)
        guard blocks.count == 1, case .paragraph(let inlines) = blocks[0].content else {
            XCTFail("expected one paragraph, got \(blocks)", file: file, line: line)
            return []
        }
        return inlines
    }

    private func list(_ block: MarkdownBlock?, file: StaticString = #filePath, line: UInt = #line) -> MarkdownList {
        guard case .list(let list)? = block?.content else {
            XCTFail("expected a list, got \(String(describing: block))", file: file, line: line)
            return MarkdownList(ordered: false, start: 1, tight: true, items: [])
        }
        return list
    }

    private func text(_ string: String) -> [MarkdownInline] { [.text(string)] }

    // ---- 行内 ----

    func testInlineStyles() {
        XCTAssertEqual(
            paragraph("Hello **bold** *em* ~~del~~ `code` end"),
            [
                .text("Hello "), .strong(text("bold")), .text(" "), .emphasis(text("em")), .text(" "),
                .strikethrough(text("del")), .text(" "), .code("code"), .text(" end"),
            ]
        )
        XCTAssertEqual(paragraph("***both*** and ~one~"), [.emphasis([.strong(text("both"))]), .text(" and "), .strikethrough(text("one"))])
    }

    func testSoftAndHardBreaks() {
        XCTAssertEqual(paragraph("a\nb  \nc\\\nd"), [.text("a"), .softBreak, .text("b"), .lineBreak, .text("c"), .lineBreak, .text("d")])
        XCTAssertEqual(MarkdownInline.plainText(paragraph("a\nb  \n**c** `d`")), "a b\nc d")
    }

    func testKeepsPunctuationAsWritten() {
        // cmark 的"智能标点"关着：网页不把 -- 换成破折号、引号换成弯引号。
        XCTAssertEqual(paragraph("a -- b --- c \"q\" 'r' ..."), text("a -- b --- c \"q\" 'r' ..."))
        XCTAssertEqual(paragraph("5 &lt; 6 &amp; \\*not em\\*"), text("5 < 6 & *not em*"))
    }

    func testLinksAndTheirSafety() {
        // 地址里有空格的不是链接语法；里面的裸网址照 GFM 的规则单独成链接。
        XCTAssertEqual(
            paragraph("[site](https://example.com/a b)"),
            [.text("[site]("), .link(destination: "https://example.com/a", children: text("https://example.com/a")), .text(" b)")]
        )
        XCTAssertEqual(
            paragraph("[site](https://example.com/a?b=1#c \"title\") and [**mail**](mailto:a@b.co)"),
            [
                .link(destination: "https://example.com/a?b=1#c", children: text("site")), .text(" and "),
                .link(destination: "mailto:a@b.co", children: [.strong(text("mail"))]),
            ]
        )
        // 不安全的协议不做成链接，文字照常显示（网页 defaultUrlTransform）。
        XCTAssertEqual(paragraph("[x](javascript:alert(1)) [y](data:text/html,hi) [z](FILE:///etc/passwd)"), text("x y z"))
        XCTAssertEqual(paragraph("[empty]()"), text("empty"))
        // 相对地址和冒号不在协议位置的地址放行。
        XCTAssertEqual(
            paragraph("[a](/c/abc?message=m1) [b](#top) [c](docs/a:b) [d](HTTPS://EXAMPLE.com)"),
            [
                .link(destination: "/c/abc?message=m1", children: text("a")), .text(" "),
                .link(destination: "#top", children: text("b")), .text(" "),
                .link(destination: "docs/a:b", children: text("c")), .text(" "),
                .link(destination: "HTTPS://EXAMPLE.com", children: text("d")),
            ]
        )
        // 地址里不能直接出现的字符编码好（micromark normalizeUri），已有的 %XX 不动。
        XCTAssertEqual(
            paragraph("[w](<https://ja.wikipedia.org/wiki/日本 語?q=%E3%81%82>)"),
            [.link(destination: "https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%20%E8%AA%9E?q=%E3%81%82", children: text("w"))]
        )
        XCTAssertEqual(MarkdownLinks.safeUrl("irc://chat"), "irc://chat")
        XCTAssertEqual(MarkdownLinks.safeUrl("xmpp:a@b"), "xmpp:a@b")
        XCTAssertNil(MarkdownLinks.safeUrl("vbscript:x"))
        XCTAssertNil(MarkdownLinks.safeUrl(nil))
        XCTAssertNil(MarkdownLinks.safeUrl(""))
    }

    func testAutolinks() {
        // CommonMark 的 <…>。
        XCTAssertEqual(
            paragraph("<https://example.com/x> <me@example.com>"),
            [
                .link(destination: "https://example.com/x", children: text("https://example.com/x")), .text(" "),
                .link(destination: "mailto:me@example.com", children: text("me@example.com")),
            ]
        )
        // GFM 的裸网址：末尾的标点不算在内。
        XCTAssertEqual(
            paragraph("See https://example.com/a_b?c=1. Then (www.example.org/x) or http://localhost:3000/p, ok"),
            [
                .text("See "), .link(destination: "https://example.com/a_b?c=1", children: text("https://example.com/a_b?c=1")),
                .text(". Then ("), .link(destination: "http://www.example.org/x", children: text("www.example.org/x")),
                .text(") or "), .link(destination: "http://localhost:3000/p", children: text("http://localhost:3000/p")), .text(", ok"),
            ]
        )
        // 成对的括号留着；邮箱；星号里的网址。
        XCTAssertEqual(
            paragraph("https://en.wikipedia.org/wiki/Mercury_(planet) mail a.b+c@example.co.jp. **https://x.dev**"),
            [
                .link(destination: "https://en.wikipedia.org/wiki/Mercury_(planet)", children: text("https://en.wikipedia.org/wiki/Mercury_(planet)")),
                .text(" mail "), .link(destination: "mailto:a.b+c@example.co.jp", children: text("a.b+c@example.co.jp")), .text(". "),
                .strong([.link(destination: "https://x.dev", children: text("https://x.dev"))]),
            ]
        )
        // 不是网址的：别的协议、域名最后两段有下划线、只有 www.、前面紧挨着字的 www、行内代码和已有链接里的文字。
        let plain = "ftp://example.com xhttps://example.com https://a_b.com www. xwww.example.com user@host"
        XCTAssertEqual(paragraph(plain), text(plain))
        XCTAssertEqual(paragraph("`https://example.com`"), [.code("https://example.com")])
        XCTAssertEqual(
            paragraph("[go to https://example.com now](https://other.example)"),
            [.link(destination: "https://other.example", children: text("go to https://example.com now"))]
        )
        XCTAssertEqual(MarkdownAutolink.split("plain text"), text("plain text"))
        XCTAssertEqual(MarkdownAutolink.split("x https://example.com/a&amp; y"), [.text("x "), .link(destination: "https://example.com/a", children: text("https://example.com/a")), .text("&amp; y")])
    }

    func testImages() {
        XCTAssertEqual(
            paragraph("![a *cat*](https://example.com/cat.png \"t\") ![rel](/api/attachments/x/image)"),
            [.image(source: "https://example.com/cat.png", alt: "a cat"), .text(" "), .image(source: "/api/attachments/x/image", alt: "rel")]
        )
        // 不安全的地址：不加载图片，只留替代文字。
        XCTAssertEqual(paragraph("![alt](javascript:alert(1)) ![](data:image/png;base64,AAAA)x"), text("alt x"))
    }

    func testInlineHtmlIsPlainText() {
        XCTAssertEqual(paragraph("a <b>bold</b> c<br>d"), text("a <b>bold</b> c<br>d"))
    }

    // ---- 块 ----

    func testHeadingsParagraphsRulesAndQuotes() {
        XCTAssertEqual(
            contents("# One\n\n### Three *x*\n\nSetext\n---\n\npara\n\n***\n\n> quote **a**\n>\n> - item"),
            [
                .heading(level: 1, text("One")),
                .heading(level: 3, [.text("Three "), .emphasis(text("x"))]),
                .heading(level: 2, text("Setext")),
                .paragraph(text("para")),
                .thematicBreak,
                .blockQuote([
                    MarkdownBlock(id: "5.0:p", content: .paragraph([.text("quote "), .strong(text("a"))])),
                    MarkdownBlock(
                        id: "5.1:ul",
                        content: .list(
                            MarkdownList(
                                ordered: false, start: 1, tight: true,
                                items: [MarkdownListItem(id: "5.1.0", checkbox: nil, blocks: [MarkdownBlock(id: "5.1.0.0:p", content: .paragraph(text("item")))])]
                            )
                        )
                    ),
                ]),
            ]
        )
        XCTAssertEqual(parse("# One\n\npara\n\n---").map(\.id), ["0:h", "1:p", "2:hr"])
        XCTAssertEqual(MarkdownDocument.parse(""), .empty)
        XCTAssertEqual(parse("   \n\n"), [])
    }

    func testOrderedListsKeepTheirStartNumber() {
        let first = list(parse("3. three\n4. four\n5. five").first)
        XCTAssertTrue(first.ordered)
        XCTAssertEqual(first.start, 3)
        XCTAssertEqual(first.items.count, 3)
        XCTAssertEqual(first.items.indices.map { orderedListMarker(start: first.start, index: $0) }, ["3.", "4.", "5."])
        XCTAssertEqual(first.items[1].blocks.map(\.content), [.paragraph(text("four"))])
        XCTAssertEqual(list(parse("1. a\n1. b").first).start, 1)
        XCTAssertEqual(list(parse("0) zero").first).start, 0)
        let bullets = list(parse("- a\n- b").first)
        XCTAssertFalse(bullets.ordered)
        XCTAssertEqual(bullets.start, 1)
        XCTAssertEqual(parse("7. a").map(\.id), ["0:ol"])
        XCTAssertEqual(parse("- a").map(\.id), ["0:ul"])
    }

    func testNestedLists() {
        let outer = list(parse("- a\n  - b\n    1. c\n    2. d\n  - e\n- f").first)
        XCTAssertEqual(outer.items.count, 2)
        XCTAssertEqual(outer.items.map(\.id), ["0.0", "0.1"])
        XCTAssertEqual(outer.items[0].blocks.map(\.id), ["0.0.0:p", "0.0.1:ul"])
        XCTAssertEqual(outer.items[0].blocks[0].content, .paragraph(text("a")))
        let middle = list(outer.items[0].blocks[1])
        XCTAssertEqual(middle.items.count, 2)
        XCTAssertEqual(middle.items[0].blocks.map(\.id), ["0.0.1.0.0:p", "0.0.1.0.1:ol"])
        let inner = list(middle.items[0].blocks[1])
        XCTAssertTrue(inner.ordered)
        XCTAssertEqual(inner.items.map { $0.blocks.map(\.content) }, [[.paragraph(text("c"))], [.paragraph(text("d"))]])
        XCTAssertEqual(middle.items[1].blocks.map(\.content), [.paragraph(text("e"))])
        XCTAssertEqual(outer.items[1].blocks.map(\.content), [.paragraph(text("f"))])
    }

    func testTaskLists() {
        let tasks = list(parse("- [x] done\n- [ ] todo\n- plain\n- [X] also done").first)
        XCTAssertEqual(tasks.items.map(\.checkbox), [true, false, nil, true])
        XCTAssertEqual(tasks.items[0].blocks.map(\.content), [.paragraph(text("done"))])
        XCTAssertEqual(tasks.items[1].blocks.map(\.content), [.paragraph(text("todo"))])
    }

    func testTightAndLooseLists() {
        XCTAssertTrue(list(parse("- a\n- b\n- c").first).tight)
        XCTAssertFalse(list(parse("- a\n\n- b\n- c").first).tight)
        // 一项里两个段落之间有空行。
        XCTAssertFalse(list(parse("1. a\n\n   more\n2. b").first).tight)
        // 空行在子列表里面：外层还是紧凑的，子列表是松散的（CommonMark 的例子）。
        let outer = list(parse("- a\n  - b\n\n    c\n- d").first)
        XCTAssertTrue(outer.tight)
        XCTAssertFalse(list(outer.items[0].blocks[1]).tight)
        // 子列表后面隔一个空行才是下一项：外层是松散的。
        XCTAssertFalse(list(parse("- a\n  - b\n\n- c").first).tight)
        XCTAssertTrue(list(parse("- a\n  ```\n  code\n\n  more\n  ```\n- b").first).tight)
    }

    func testTables() {
        let blocks = parse("| Name | Qty | Note |\n|:--|--:|:-:|\n| **A** | 1 | `x` |\n| B |\n| C | 2 | y | extra |\n\nafter")
        XCTAssertEqual(blocks.map(\.id), ["0:table", "1:p"])
        guard case .table(let table) = blocks[0].content else { return XCTFail("not a table") }
        XCTAssertEqual(table.columnCount, 3)
        XCTAssertEqual(table.alignments, [.left, .right, .center])
        XCTAssertEqual(table.header, [text("Name"), text("Qty"), text("Note")])
        XCTAssertEqual(
            table.rows,
            [
                [[.strong(text("A"))], text("1"), [.code("x")]],
                [text("B"), [], []],
                [text("C"), text("2"), text("y")],
            ]
        )
        // 没写对齐的列是 nil；单元格里的竖线要转义；只写了 ^ 或留空的单元格照原样（不合并单元格）。
        guard case .table(let plain)? = parse("a | b\n--- | ---\nx \\| y | ^\n1 || 2").first?.content else { return XCTFail("not a table") }
        XCTAssertEqual(plain.alignments, [nil, nil])
        XCTAssertEqual(plain.rows, [[text("x | y"), text("^")], [text("1"), []]])
        // 还没写到分隔行（生成途中）：先是普通段落。
        XCTAssertEqual(parse("| a | b |").map(\.id), ["0:p"])
    }

    func testCodeBlocks() {
        XCTAssertEqual(
            contents("```swift title=x\nlet a = 1\n\nprint(a)\n```\n\n~~~\nplain\n~~~\n\n    indented\n    code\n\n```c++\n```"),
            [
                .codeBlock(language: "swift", code: "let a = 1\n\nprint(a)"),
                .codeBlock(language: nil, code: "plain"),
                .codeBlock(language: nil, code: "indented\ncode"),
                .codeBlock(language: "c++", code: ""),
            ]
        )
        // 没写完的围栏（生成途中）：到文末都是代码，里面的 Markdown 不解析。
        XCTAssertEqual(contents("before\n\n```py\nprint(1)\n# not a heading\n**x**"), [.paragraph(text("before")), .codeBlock(language: "py", code: "print(1)\n# not a heading\n**x**")])
        XCTAssertEqual(contents("```"), [.codeBlock(language: nil, code: "")])
        XCTAssertEqual(contents("```js"), [.codeBlock(language: "js", code: "")])
        // 围栏上写的不是语言名（网页 `language-([\w#+.-]+)` 取不到）。
        XCTAssertEqual(contents("```{python}\nx\n```"), [.codeBlock(language: nil, code: "x")])
        XCTAssertEqual(contents("```c#,linenos\nx\n```"), [.codeBlock(language: "c#", code: "x")])
        // Windows 换行。
        XCTAssertEqual(contents("```js\r\nlet a\r\n```\r\n"), [.codeBlock(language: "js", code: "let a")])
    }

    func testHtmlBlocks() {
        XCTAssertEqual(
            contents("<div class=\"x\">\n<b>hi</b>\n</div>\n\ntext"),
            [.html("<div class=\"x\">\n<b>hi</b>\n</div>"), .paragraph(text("text"))]
        )
    }

    // ---- 数学公式 ----

    func testInlineMath() {
        XCTAssertEqual(
            paragraph("Euler $e^{i\\pi} + 1 = 0$ and \\( a < b \\) cost \\$5"),
            [.text("Euler "), .math("e^{i\\pi} + 1 = 0"), .text(" and "), .math("a < b"), .text(" cost $5")]
        )
        // 标题、列表、表格、强调里的公式一样。
        XCTAssertEqual(contents("## Area $\\pi r^2$"), [.heading(level: 2, [.text("Area "), .math("\\pi r^2")])])
        XCTAssertEqual(paragraph("**bold $x$**"), [.strong([.text("bold "), .math("x")])])
        guard case .table(let table)? = parse("| f |\n|---|\n| $a_1$ |").first?.content else { return XCTFail("not a table") }
        XCTAssertEqual(table.rows, [[[.math("a_1")]]])
        // 没有公式的金额原样显示。
        XCTAssertEqual(paragraph("It costs $5 and $10."), text("It costs $5 and $10."))
        // 关掉公式（笔记历史的预览）。
        XCTAssertEqual(parse("$x$ and \\(y\\)", math: false).map(\.content), [.paragraph(text("$x$ and (y)"))])
    }

    func testDisplayMath() {
        XCTAssertEqual(
            contents("Then\n\\[\n  x = \\frac{-b}{2a}\n\\]\ndone"),
            [.paragraph(text("Then")), .math(latex: "x = \\frac{-b}{2a}"), .paragraph(text("done"))]
        )
        XCTAssertEqual(contents("$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$"), [.math(latex: "\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}")])
        XCTAssertEqual(parse("$$E = mc^2$$").map(\.id), ["0:math"])
        // 夹在句子中间的 $$…$$ 是行内公式。
        XCTAssertEqual(paragraph("so $$y$$ here"), [.text("so "), .math("y"), .text(" here")])
        // 列表项和引用里的独立公式留在原处。
        let steps = list(parse("1. Start:\n   $$\n   x = 1\n   $$\n   Done.\n2. Next").first)
        XCTAssertEqual(steps.items.count, 2)
        XCTAssertEqual(steps.items[0].blocks.map(\.content), [.paragraph(text("Start:")), .math(latex: "x = 1"), .paragraph(text("Done."))])
        XCTAssertEqual(
            contents("> Note:\n> \\[\n> x > 1\n> \\]"),
            [.blockQuote([
                MarkdownBlock(id: "0.0:p", content: .paragraph(text("Note:"))),
                MarkdownBlock(id: "0.1:math", content: .math(latex: "x > 1")),
            ])]
        )
        // ```math 代码块也是独立公式；空的、或关掉公式时还是代码块。
        XCTAssertEqual(contents("```math\n\\int_0^1 x\\,dx\n```"), [.math(latex: "\\int_0^1 x\\,dx")])
        XCTAssertEqual(contents("```math\n```"), [.codeBlock(language: "math", code: "")])
        XCTAssertEqual(parse("```math\nx\n```", math: false).map(\.content), [.codeBlock(language: "math", code: "x")])
        // 没写完的公式（生成途中）先按原文显示。
        XCTAssertEqual(contents("see $$\n a + b"), [.paragraph([.text("see $$"), .softBreak, .text("a + b")])])
    }

    // ---- 生成途中 ----

    func testIdsStayStableWhileTheAnswerGrows() {
        let before = parse("# Title\n\nFirst paragraph.\n\n- one\n- two\n\nLast para")
        let after = parse("# Title\n\nFirst paragraph.\n\n- one\n- two\n\nLast paragraph grows **here**\n\n```js\nlet a")
        XCTAssertEqual(before.map(\.id), ["0:h", "1:p", "2:ul", "3:p"])
        XCTAssertEqual(after.map(\.id), ["0:h", "1:p", "2:ul", "3:p", "4:code"])
        // 没变的块相等（不用重画），变长的那块 id 不变、内容不同。
        XCTAssertEqual(Array(after.prefix(3)), Array(before.prefix(3)))
        XCTAssertEqual(after[3].id, before[3].id)
        XCTAssertNotEqual(after[3], before[3])

        // 列表一项一项长出来：已有的项 id 不变。
        let short = list(parse("1. a\n2. b").first)
        let long = list(parse("1. a\n2. b\n3. c\n   - d").first)
        XCTAssertEqual(Array(long.items.prefix(2)), short.items)
        XCTAssertEqual(long.items.map(\.id), ["0.0", "0.1", "0.2"])

        // 同一个位置换了种类（段落写完分隔行变成表格）：id 跟着变。
        XCTAssertEqual(parse("| a |").map(\.id), ["0:p"])
        XCTAssertEqual(parse("| a |\n|---|").map(\.id), ["0:table"])
    }

    func testEveryPrefixOfAnAnswerParses() {
        let answer = """
        # Title with `code` and $x^2$

        Intro **bold** [link](https://example.com) and https://example.org/a_(b).

        1. First
           - nested [ ] not a task
           - [x] task
        2. Second:
           $$
           a - b = c
           $$

        > quote
        > ```swift
        > let a = "b"
        > ```

        | A | B |
        |---|:-:|
        | 1 | \\( y \\) |

        ```python
        print("$5")
        ```

        <details><summary>x</summary></details>

        Final ~~line~~ ![img](https://example.com/i.png)\\[ z \\]
        """
        let scalars = Array(answer.unicodeScalars)
        var previousFirst: MarkdownBlock?
        for end in 0...scalars.count {
            let prefix = String(String.UnicodeScalarView(scalars[..<end]))
            let blocks = parse(prefix)
            // 同一层里 id 不重复。
            XCTAssertEqual(Set(blocks.map(\.id)).count, blocks.count, prefix)
            // 第一块写完以后（后面已经有别的块）就不再变。
            if blocks.count > 2, let first = blocks.first {
                if let previousFirst { XCTAssertEqual(first, previousFirst, prefix) }
                previousFirst = first
            }
        }
        let full = parse(answer)
        XCTAssertEqual(full.map(\.id), ["0:h", "1:p", "2:ol", "3:quote", "4:table", "5:code", "6:html", "7:p"])
    }

    func testDeeplyNestedInputDoesNotCrash() {
        let quotes = parse(String(repeating: "> ", count: 120) + "deep")
        XCTAssertEqual(quotes.map(\.id), ["0:quote"])
        let lists = parse((0..<60).map { String(repeating: "  ", count: $0) + "- level \($0)" }.joined(separator: "\n"))
        XCTAssertEqual(lists.map(\.id), ["0:ul"])
        _ = parse(String(repeating: "*", count: 2_000) + "a" + String(repeating: "_", count: 2_000))
        _ = parse(String(repeating: "[", count: 2_000) + "a" + String(repeating: "](x)", count: 2_000))
        _ = parse(String(repeating: "|", count: 500) + "\n" + String(repeating: "|-", count: 500))
        _ = parse("\u{0}\u{E000}\u{E001}\u{FEFF}\r\n\r\t```\r")
    }
}
