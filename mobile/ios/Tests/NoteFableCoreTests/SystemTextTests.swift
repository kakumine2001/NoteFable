import XCTest
@testable import NoteFableCore

// Android 的 SystemTextTest 的移植；与网页 src/lib/i18n/translate.test.ts 的 localizeSystemText 用例逐条对应。
final class SystemTextTests: XCTestCase {
    private let table = SystemText(
        templates: [
            "Request failed: {detail}",
            "Searched notes for “{query}”",
            "Read “{title}”",
            "Unsupported file type: {name}",
            "File is too large: {name}",
        ],
        messages: [
            "zh": [
                "Request failed: {detail}": "请求失败：{detail}",
                "Note not found.": "找不到笔记。",
                "Searched notes for “{query}”": "搜索了笔记“{query}”",
                "Read “{title}”": "读取了“{title}”",
                "Unsupported file type: {name}": "不支持的文件类型：{name}",
                "File is too large: {name}": "文件太大：{name}",
                "Hello {name}, {count} notes": "{name}，{count} 条笔记",
            ],
        ]
    )
    private var zh: SystemTextTranslator { table.translator("zh") }

    func testTranslatesFormattedErrorsAndToolLabelsRecursingIntoDetail() {
        XCTAssertEqual(zh.localize("Request failed: Note not found."), "请求失败：找不到笔记。")
        XCTAssertEqual(zh.localize("Searched notes for “Rayleigh”"), "搜索了笔记“Rayleigh”")
        XCTAssertEqual(zh.localize("Request failed: Unsupported file type: a.txt"), "请求失败：不支持的文件类型：a.txt")
        XCTAssertEqual(zh.localize("Something else"), "Something else")
        XCTAssertEqual(zh.localize("Request failed:"), "Request failed:")
    }

    func testKeepsTitlesQueriesAndFilenamesThatHappenToBeUiSentences() {
        XCTAssertEqual(zh.localize("Read “Note not found.”"), "读取了“Note not found.”")
        XCTAssertEqual(zh.localize("Searched notes for “Note not found.”"), "搜索了笔记“Note not found.”")
        XCTAssertEqual(zh.localize("Unsupported file type: Note not found."), "不支持的文件类型：Note not found.")
        XCTAssertEqual(zh.localize("Read “”"), "读取了“”")
        XCTAssertEqual(zh.localize("File is too large: memo (only the beginning was shared)"), "文件太大：memo (only the beginning was shared)")
    }

    func testMatchesTheWholeTextIncludingATrailingNewline() {
        XCTAssertEqual(zh.localize("Read “x”\n"), "Read “x”\n")
        XCTAssertEqual(zh.localize("Searched notes for “a\nb”"), "搜索了笔记“a\nb”")
    }

    func testInterpolatesOnceAndLeavesUnknownSlotsIntact() {
        XCTAssertEqual(zh.t("Hello {name}, {count} notes", ["name": "{count}", "count": "2"]), "{count}，2 条笔记")
        XCTAssertEqual(zh.t("Use {key} for commands"), "Use {key} for commands")
        XCTAssertEqual(zh.t("Missing {name}", ["name": "$&"]), "Missing $&")
        // 不是 {\w+} 的花括号原样留着。
        XCTAssertEqual(zh.t("{} {a b} {é} {name", ["name": "x", "a": "y"]), "{} {a b} {é} {name")
        XCTAssertEqual(zh.t("{a}{b}{a}", ["a": "1", "b": "{a}"]), "1{a}1")
    }

    func testOtherLanguagesAndAMissingTableShowTheEnglishSource() {
        XCTAssertEqual(table.translator("en").localize("Note not found."), "Note not found.")
        XCTAssertEqual(table.translator(nil).localize("Note not found."), "Note not found.")
        XCTAssertEqual(SystemText.empty.translator("zh").localize("Request failed: Note not found."), "Request failed: Note not found.")
        XCTAssertEqual(table.translator("zh-Hans-CN").localize("Request failed: Note not found."), "请求失败：找不到笔记。")
    }

    func testNormalizesLanguageCodesAndTagsToDictionaryKeys() {
        XCTAssertEqual(SystemText.normalizeLanguage("zh"), "zh")
        XCTAssertEqual(SystemText.normalizeLanguage("zh-Hant"), "zh-Hant")
        XCTAssertEqual(SystemText.normalizeLanguage("zh_TW"), "zh-Hant")
        XCTAssertEqual(SystemText.normalizeLanguage("zh-Hans-HK"), "zh")
        XCTAssertEqual(SystemText.normalizeLanguage(" PT-pt "), "pt-BR")
        XCTAssertEqual(SystemText.normalizeLanguage("in-ID"), "id")
        XCTAssertEqual(SystemText.normalizeLanguage("jpn"), "ja")
        XCTAssertNil(SystemText.normalizeLanguage("en"))
        XCTAssertNil(SystemText.normalizeLanguage("nl"))
        XCTAssertNil(SystemText.normalizeLanguage(nil))
        // 17 种界面语言里，英文以外的 16 种各有自己的词典键。
        let keys = AppLanguage.Preference.allCases.compactMap { SystemText.normalizeLanguage($0.code) }
        XCTAssertEqual(keys, AppLanguage.Preference.allCases.map(\.code).filter { $0 != "auto" && $0 != "en" })
    }

    func testReplacesOnlyTheFailureTextTheServerAppendedAtTheRecordedOffset() {
        let content = "Answer\n\nRequest failed: Note not found."
        XCTAssertEqual(zh.localizeFailure(content, FailureInfo(offset: 8, detail: "Note not found.")), "Answer\n\n请求失败：找不到笔记。")
        // 位置不对、没有记录、或正文被改过：原样显示，不从措辞猜测。
        XCTAssertEqual(zh.localizeFailure(content, FailureInfo(offset: 7, detail: "Note not found.")), content)
        XCTAssertEqual(zh.localizeFailure(content, nil), content)
        XCTAssertEqual(zh.localizeFailure("Request failed: x", FailureInfo(offset: 99, detail: "x")), "Request failed: x")
        XCTAssertEqual(zh.localizeFailure(content, FailureInfo(offset: -1, detail: "Note not found.")), content)
    }

    func testFailureOffsetsAreUtf16PositionsLikeTheWeb() {
        // "😀" 在 JS 里占两个位置，所以失败文从 3 开始。
        let content = "😀\nRequest failed: Note not found."
        XCTAssertEqual(zh.localizeFailure(content, FailureInfo(offset: 3, detail: "Note not found.")), "😀\n请求失败：找不到笔记。")
        XCTAssertEqual(zh.localizeFailure(content, FailureInfo(offset: 2, detail: "Note not found.")), content)
        // 落在代理对中间的位置对不上，原样返回。
        XCTAssertEqual(zh.localizeFailure("😀", FailureInfo(offset: 1, detail: "x")), "😀")
    }

    func testReadsFailureInfoFromStreamEventsAndStoredActivity() {
        XCTAssertEqual(FailureInfo.from(JSONValue.parse(#"{"type":"failure","id":"f","offset":3,"detail":"Boom"}"#)), FailureInfo(offset: 3, detail: "Boom"))
        XCTAssertNil(FailureInfo.from(JSONValue.parse(#"{"type":"failure","offset":"3","detail":"Boom"}"#)))
        XCTAssertNil(FailureInfo.from(JSONValue.parse(#"{"type":"tool","offset":3,"detail":"Boom"}"#)))
        XCTAssertNil(FailureInfo.from(JSONValue.parse(#"{"type":"failure","offset":-1,"detail":"Boom"}"#)))
        XCTAssertNil(FailureInfo.from(JSONValue.parse(#"{"type":"failure","offset":1.5,"detail":"Boom"}"#)))
        XCTAssertNil(FailureInfo.from(JSONValue.parse(#"{"type":"failure","offset":3}"#)))
        XCTAssertNil(FailureInfo.from(nil))
        XCTAssertEqual(
            FailureInfo.fromActivity(JSONValue.parse(#"[{"id":"a","kind":"thought","text":"t"},{"id":"f","kind":"failure","offset":0,"detail":"Boom"}]"#)),
            FailureInfo(offset: 0, detail: "Boom")
        )
        XCTAssertNil(FailureInfo.fromActivity(JSONValue.parse(#"{"kind":"failure","offset":0,"detail":"Boom"}"#)))
        XCTAssertNil(FailureInfo.fromActivity(nil))
    }

    func testParsesTheAssetFormatAndRejectsOtherJson() throws {
        let parsed = try SystemText.parse(#"{"templates":["Read “{title}”"],"messages":{"ja":{"Read “{title}”":"「{title}」を読みました"}},"extra":1}"#)
        XCTAssertEqual(parsed.translator("ja").localize("Read “Plan”"), "「Plan」を読みました")
        XCTAssertEqual(try SystemText.parse("{}").translator("ja").localize("Read “Plan”"), "Read “Plan”")
        XCTAssertThrowsError(try SystemText.parse("[]"))
        XCTAssertThrowsError(try SystemText.parse("not json"))
    }

    func testTheBundledAssetTranslatesServerErrorsUsageLimitsAndTemplates() throws {
        let asset = try SystemText.parse(TextTestSupport.androidAsset("system-text.json"))
        let zh = asset.translator("zh")
        let ja = asset.translator("ja")
        XCTAssertEqual(zh.localize("Request failed: Database is unavailable."), "请求失败：数据库暂时不可用。")
        let limit = "You've used today's free messages. Sign in for more, or try again tomorrow."
        XCTAssertNotEqual(zh.localize(limit), limit)
        XCTAssertNotEqual(ja.localize(limit), limit)
        XCTAssertEqual(ja.localize("Read “Plan”"), "「Plan」を読みました")
        // 繁体中文界面（zh-Hant）用繁体词典，不退回简体；新增语言及 in-ID 别名同样命中各自词典。
        XCTAssertEqual(asset.translator("zh-Hant").localize("Request failed: Database is unavailable."), "請求失敗：資料庫暫時不可用。")
        XCTAssertNotEqual(asset.translator("ko").localize(limit), limit)
        XCTAssertNotEqual(asset.translator("ar").localize(limit), limit)
        XCTAssertNotEqual(asset.translator("in-ID").localize(limit), limit)
        XCTAssertNotEqual(asset.translator("pt-BR").localize(limit), limit)
        // 每种界面语言（英文除外）都有词典。
        for language in AppLanguage.Preference.allCases where language != .auto && language != .english {
            XCTAssertNotEqual(asset.translator(language.code).localize(limit), limit, language.code)
        }
    }
}
