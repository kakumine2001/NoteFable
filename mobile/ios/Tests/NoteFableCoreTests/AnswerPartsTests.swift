import XCTest
@testable import NoteFableCore

/// 对应 Android 的 `AnswerPartsTest`（生成图片的保存属于附件 / 图片模块，不在这里）。
final class AnswerPartsTests: XCTestCase {
    private func text(_ code: String, _ token: CodeToken) -> String {
        String(decoding: Array(code.utf16)[token.start..<token.end], as: UTF16.self)
    }

    /// 记号的文字 → 类别（同样的文字后面的盖住前面的，和 Kotlin 的 associate 一样）。
    private func kinds(_ code: String, _ language: String) -> [String: CodeTokenKind] {
        var out: [String: CodeTokenKind] = [:]
        for token in CodeHighlighter.tokenize(code, language) { out[text(code, token)] = token.kind }
        return out
    }

    private func has(_ code: String, _ language: String, _ piece: String, _ kind: CodeTokenKind) -> Bool {
        CodeHighlighter.tokenize(code, language).contains { text(code, $0) == piece && $0.kind == kind }
    }

    // ---- 代码块：语言选择与网页 assistant-markdown.tsx 一致 ----

    func testPatternsCompile() {
        XCTAssertTrue(CodeHighlighter.patternsAreValid)
    }

    func testLanguageComesFromTheFenceWithWebAliasesThenThePythonGuessThenDetection() {
        XCTAssertEqual(CodeHighlighter.highlight("const a = 1", "tsx").language, "typescript")
        XCTAssertEqual(CodeHighlighter.highlight("int x;", "C++").language, "cpp")
        XCTAssertEqual(CodeHighlighter.highlight("<p>x</p>", "language-html").language, "xml")
        XCTAssertEqual(CodeHighlighter.highlight("name = input()\nprint(name)", nil).language, "python")
        XCTAssertEqual(CodeHighlighter.highlight("hello world", nil).language, "plaintext")
        XCTAssertEqual(CodeHighlighter.highlight("hello world", "text").language, "plaintext")
        XCTAssertEqual(
            CodeHighlighter.highlight("const total = items.map((x) => x * 2);\nconsole.log(total);", nil).language,
            "javascript"
        )
    }

    func testEveryLanguageTokenizesAndDetectsWithoutTrouble() {
        let sample = "#include <x.h>\n/* c */ // d\n# e\n-- f\n<a b=\"c\">d</a>\nkey: 'v'\n@x $y ${z} 0x1F 1.5e-3 \"s\" `t`\n> q [l](u)\n.a { b: 1px; }"
        for language in CodeHighlighter.languages {
            let tokens = CodeHighlighter.tokenize(sample, language)
            XCTAssertFalse(tokens.isEmpty, language)
            XCTAssertTrue(tokens.allSatisfy { $0.start >= 0 && $0.start < $0.end && $0.end <= sample.utf16.count }, language)
            XCTAssertNotEqual(CodeHighlighter.label(language), language)
        }
        XCTAssertEqual(CodeHighlighter.tokenize(sample, "cobol"), [])
        XCTAssertEqual(CodeHighlighter.label("cobol"), "cobol")
        XCTAssertEqual(CodeHighlighter.label("xml"), "HTML")
        XCTAssertEqual(CodeHighlighter.label(CodeHighlighter.plain), "code_label_plain")
        XCTAssertEqual(CodeHighlighter.detect("SELECT id FROM users WHERE id = 1"), "sql")
        XCTAssertNil(CodeHighlighter.detect(""))
    }

    func testPythonTokensUseTheWebThemeClasses() {
        let code = "@cache\ndef add(a, b):\n    # sum\n    return a + 1 if True else \"no\""
        let tokens = kinds(code, "python")
        XCTAssertEqual(tokens["@cache"], .meta)
        XCTAssertEqual(tokens["def"], .keyword)
        XCTAssertEqual(tokens["add"], .title)
        XCTAssertEqual(tokens["# sum"], .comment)
        XCTAssertEqual(tokens["return"], .keyword)
        XCTAssertEqual(tokens["1"], .number)
        XCTAssertEqual(tokens["True"], .number)
        XCTAssertEqual(tokens["\"no\""], .string)
    }

    func testLargeJsonIsTokenizedInLinearTimeAndKeysStillFoundAcrossSpaces() {
        // 4 万个键值对（约 1MB）：按下标找冒号，不对每个字符串复制剩余文本。平方级时这里要几十秒以上。
        let json = "{\n" + (0..<40_000).map { "\"key\($0)\" \t: \"value\($0)\"" }.joined(separator: ",\n") + "\n}"
        let started = Date()
        let tokens = CodeHighlighter.tokenize(json, "json")
        let elapsed = Date().timeIntervalSince(started)
        XCTAssertLessThan(elapsed, 10, "tokenizing took \(elapsed)s")
        XCTAssertEqual(tokens.count, 80_000)
        XCTAssertEqual(tokens.filter { $0.kind == .variable }.count, 40_000)
        XCTAssertEqual(tokens.first?.kind, .variable)
        XCTAssertEqual(tokens.last?.kind, .string)
        // 字符串在末尾、后面没有冒号时是值。
        XCTAssertEqual(CodeHighlighter.tokenize("\"tail\"  ", "json").map(\.kind), [.string])
    }

    func testJsonKeysHtmlTagsBashVariablesAndSqlKeywords() {
        let json = #"{"name": "x", "n": -2, "ok": true}"#
        let j = kinds(json, "json")
        XCTAssertEqual(j["\"name\""], .variable)
        XCTAssertEqual(j["\"x\""], .string)
        XCTAssertEqual(j["-2"], .number)
        XCTAssertEqual(j["true"], .number)

        let html = #"<a href="/x">hi</a><!-- c -->"#
        XCTAssertTrue(has(html, "xml", "<a href=\"/x\">", .tag))
        XCTAssertTrue(has(html, "xml", "a", .title))
        XCTAssertTrue(has(html, "xml", "href", .variable))
        XCTAssertTrue(has(html, "xml", "\"/x\"", .string))
        XCTAssertTrue(has(html, "xml", "<!-- c -->", .comment))

        let sh = "echo \"$HOME\" # done\nexport PATH=${PATH}"
        XCTAssertTrue(has(sh, "bash", "echo", .builtIn))
        XCTAssertTrue(has(sh, "bash", "# done", .comment))
        XCTAssertTrue(has(sh, "bash", "${PATH}", .variable))

        let sql = "SELECT id FROM users -- all"
        XCTAssertTrue(has(sql, "sql", "SELECT", .keyword))
        XCTAssertTrue(has(sql, "sql", "-- all", .comment))
    }

    func testCssAndCDirectives() {
        let css = "a.btn { color: #fff; margin: 0 4px; }"
        XCTAssertTrue(has(css, "css", "a", .keyword))
        XCTAssertTrue(has(css, "css", "color", .variable))
        XCTAssertTrue(has(css, "css", "#fff", .number))
        XCTAssertTrue(has(css, "css", "4px", .number))

        let src = "#include <stdio.h>\nint main() { return 0; }"
        XCTAssertTrue(has(src, "c", "#include <stdio.h>", .meta))
        XCTAssertTrue(has(src, "c", "<stdio.h>", .string))
        XCTAssertTrue(has(src, "c", "int", .number))
    }

    func testYamlKeysAndMarkdownLinks() {
        let yaml = "name: demo # note\nitems:\n  - id: 1\n    ok: true\n    \"quoted key\": 'v'"
        XCTAssertTrue(has(yaml, "yaml", "name", .variable))
        XCTAssertTrue(has(yaml, "yaml", "# note", .comment))
        XCTAssertTrue(has(yaml, "yaml", "id", .variable))
        XCTAssertTrue(has(yaml, "yaml", "1", .number))
        XCTAssertTrue(has(yaml, "yaml", "true", .number))
        XCTAssertTrue(has(yaml, "yaml", "\"quoted key\"", .variable))
        XCTAssertTrue(has(yaml, "yaml", "'v'", .string))
        // 键里的字不再单独上色（true: 不是字面量）。
        XCTAssertFalse(has("true: 1", "yaml", "true", .number))

        let markdown = "> quote\nsee [docs](https://example.com)"
        XCTAssertTrue(has(markdown, "markdown", "> quote", .comment))
        XCTAssertTrue(has(markdown, "markdown", "docs", .string))
    }

    func testRunsCoverTheWholeCodeAndLaterTokensWin() {
        let src = "#include <stdio.h>\nint 你好 = 1; // 😀 done"
        let result = CodeHighlighter.highlight(src, "c")
        let runs = result.runs(src)
        XCTAssertEqual(runs.map(\.text).joined(), src)
        // 指令整行是 meta，里面的文件名（后加的记号）是 string。
        XCTAssertEqual(Array(runs.prefix(2)), [CodeRun(text: "#include ", kind: .meta), CodeRun(text: "<stdio.h>", kind: .string)])
        XCTAssertTrue(runs.contains(CodeRun(text: "int", kind: .number)))
        XCTAssertTrue(runs.contains(CodeRun(text: "// 😀 done", kind: .comment)))
        XCTAssertEqual(HighlightResult(language: "plaintext", tokens: []).runs("a\nb"), [CodeRun(text: "a\nb", kind: nil)])
        XCTAssertEqual(HighlightResult(language: "plaintext", tokens: []).runs(""), [])
        // 颜色是网页 .hljs-* 的那几个。
        XCTAssertEqual(CodeTokenKind.keyword.color, 0xFF7C_3AED)
        XCTAssertEqual(CodeTokenKind.builtIn.color, CodeTokenKind.keyword.color)
        XCTAssertEqual(CodeTokenKind.title.fontWeight, 650)
        XCTAssertTrue(CodeTokenKind.comment.isItalic)
        XCTAssertEqual(Set(CodeTokenKind.allCases.map(\.color)).count, 8)
    }

    // ---- 表格：浏览器自动表格布局的列宽分配 ----

    func testTableColumnsUseTheirNaturalWidthWhenEverythingFits() {
        XCTAssertEqual(tableColumnWidths(minWidths: [88, 88], maxWidths: [100, 150], available: 400), [100, 150])
    }

    func testTableColumnsShareTheExtraWidthByHowMuchTheyWant() {
        XCTAssertEqual(tableColumnWidths(minWidths: [100, 100], maxWidths: [300, 100], available: 300), [200, 100])
        let widths = tableColumnWidths(minWidths: [90, 100, 110], maxWidths: [400, 500, 600], available: 333)
        XCTAssertEqual(widths.reduce(0, +), 333, accuracy: 0.0001)
        XCTAssertTrue(zip(widths, [90.0, 100, 110]).allSatisfy { $0 >= $1 })
    }

    func testTableColumnsKeepTheirMinimumAndScrollWhenEvenThatDoesNotFit() {
        XCTAssertEqual(
            tableColumnWidths(minWidths: [Double](repeating: 88, count: 5), maxWidths: [Double](repeating: 300, count: 5), available: 360),
            [Double](repeating: 88, count: 5)
        )
    }

    func testTableLayoutMeasuresCellsThroughTheInjectedClosure() {
        // 两行两列：第一列的词短（用最窄 88），第二列很长。
        let cells: [[AnswerTableLayout.CellWidth]] = [
            [.init(min: 20, max: 20), .init(min: 60.2, max: 400)],
            [.init(min: 30, max: 50), .init(min: 100, max: 250)],
        ]
        let measure: (Int, Int) -> AnswerTableLayout.CellWidth = { row, column in cells[row][column] }
        // 最窄：88 和 100 + 22.4 → 123；最宽：88 和 400 + 22.4 → 423。
        XCTAssertEqual(AnswerTableLayout.columnWidths(rows: 2, columns: 2, available: 600, measure: measure), [88, 423])
        XCTAssertEqual(AnswerTableLayout.columnWidths(rows: 2, columns: 2, available: 300, measure: measure), [88, 212])
        XCTAssertEqual(AnswerTableLayout.columnWidths(rows: 2, columns: 2, available: 150, measure: measure), [88, 123])
        XCTAssertEqual(AnswerTableLayout.columnWidths(rows: 0, columns: 2, available: 150, measure: measure), [])
    }

    func testOrderedListMarkersContinueFromTheSourceStartNumber() {
        XCTAssertEqual(orderedListMarker(start: 1, index: 0), "1.")
        XCTAssertEqual(orderedListMarker(start: 7, index: 2), "9.")
    }

    // ---- 来源标签（网页 chat-activity.tsx sourceLabel / shortUrl） ----

    func testSourceChipsShowTheSiteAndTheLastPathSegment() {
        XCTAssertEqual(sourceLabel("https://www.example.com/wiki/Caf%C3%A9"), "example.com › Café")
        XCTAssertEqual(sourceLabel("https://example.com/"), "example.com")
        XCTAssertEqual(shortUrl("https://example.com/docs/a%20b"), "example.com/docs/a b")
        XCTAssertEqual(shortUrl("https://example.com/"), "example.com")
        XCTAssertEqual(sourceLabel("not a url"), "not a url")
        XCTAssertEqual(shortUrl("not a url"), "not a url")
    }
}
