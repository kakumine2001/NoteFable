import XCTest
@testable import NoteFableCore

// Android 的 EmojiCatalogTest 的移植。
final class EmojiCatalogTests: XCTestCase {
    private let json = """
        {"categories":["suggested","smileys_people","animals_nature"],
         "icons":{"suggested":{"viewBox":[160,0,20,20],"shapes":[{"d":"M0 0h1","fill":true,"stroke":false,"strokeWidth":1,"round":false,"evenOdd":false}]},
                  "search":{"viewBox":[0,0,20,20],"shapes":[{"d":"M1 1h2","fill":false,"stroke":true}]}},
         "emojis":[
          {"u":"1f600","c":1,"n":{"en":["face","Grinning Face"],"zh":["笑脸"],"zh-Hant":["笑臉"],"ja":["笑顔"],"th":["หน้ายิ้ม"]}},
          {"u":"1f44b","c":1,"v":["1f44b-1f3fb","1f44b-1f3ff"],"n":{"en":["wave","waving hand"],"zh":["挥手"],"zh-Hant":["揮手"],"ja":["手を振る"],"th":["โบกมือ"]}},
          {"u":"1f408","c":2,"n":{"en":["cat"],"zh":["猫"],"zh-Hant":["貓"],"ja":["ねこ"],"th":["แมว"]}}
         ]}
        """

    func testParsesTheLocalesKeywordsAndSearchesThemLikeEmojiPickerReact() throws {
        let en = try EmojiCatalog.parse(json, locale: "en")
        XCTAssertEqual(en.categories, ["suggested", "smileys_people", "animals_nature"])
        XCTAssertEqual(en.find("1f600")?.names, ["face", "grinning face"])
        XCTAssertEqual(en.find("1f600")?.label, "grinning face")
        XCTAssertEqual(en.find("1f600")?.category, "smileys_people")
        XCTAssertEqual(en.find("1f600")?.emoji, "😀")
        let match = try XCTUnwrap(en.matcher("  GRIN "))
        XCTAssertEqual(en.emojis.filter(match).map(\.unified), ["1f600"])
        XCTAssertNil(en.matcher("   "))
        XCTAssertEqual(en.inCategory("animals_nature").map(\.unified), ["1f408"])

        let zh = try EmojiCatalog.parse(json, locale: "zh")
        XCTAssertEqual(zh.emojis.filter(try XCTUnwrap(zh.matcher("猫"))).map(\.unified), ["1f408"])
        let hant = try EmojiCatalog.parse(json, locale: "zh-Hant")
        XCTAssertEqual(hant.emojis.filter(try XCTUnwrap(hant.matcher("貓"))).map(\.unified), ["1f408"])
        // 不认识的语言或包里无关键词文件的语言（如 ar / id / tr）回退到英文关键词。
        XCTAssertEqual(try EmojiCatalog.parse(json, locale: "nl").find("1f408")?.names, ["cat"])
        XCTAssertEqual(try EmojiCatalog.parse(json, locale: "ar").find("1f408")?.names, ["cat"])
    }

    /// JS 的 includes 按码元找：泰语里辅音后面跟着元音符号（一个字形簇）时，只打辅音也要能搜到。
    func testSearchMatchesInsideGraphemeClusters() throws {
        let th = try EmojiCatalog.parse(json, locale: "th")
        // "โบกมือ" 里的 "ม" 和后面的元音符号是一个字形簇，按字形簇找会漏掉它。
        XCTAssertEqual(th.emojis.filter(try XCTUnwrap(th.matcher("ม"))).map(\.unified), ["1f600", "1f44b", "1f408"])
        XCTAssertEqual(th.emojis.filter(try XCTUnwrap(th.matcher("ยิ"))).map(\.unified), ["1f600"])
        XCTAssertEqual(th.emojis.filter(try XCTUnwrap(th.matcher("zzz"))).map(\.unified), [])
    }

    func testReadsIconShapesWithTheirDefaults() throws {
        let catalog = try EmojiCatalog.parse(json, locale: "en")
        XCTAssertEqual(catalog.icons["suggested"], EmojiIcon(viewBox: [160, 0, 20, 20], shapes: [EmojiShape(d: "M0 0h1", fill: true, stroke: false)]))
        XCTAssertEqual(catalog.icons["search"]?.shapes, [EmojiShape(d: "M1 1h2", fill: false, stroke: true, strokeWidth: 1, round: false, evenOdd: false)])
        XCTAssertThrowsError(try EmojiCatalog.parse("{}", locale: "en"))
    }

    func testSkinTonesPickTheMatchingVariationAndVariationsResolveToTheirBaseEmoji() throws {
        let catalog = try EmojiCatalog.parse(json, locale: "en")
        let wave = try XCTUnwrap(catalog.find("1f44b"))
        XCTAssertEqual(wave.unifiedFor(.neutral), "1f44b")
        XCTAssertEqual(wave.unifiedFor(.light), "1f44b-1f3fb")
        XCTAssertEqual(wave.unifiedFor(.dark), "1f44b-1f3ff")
        // 没有这个肤色的变体时用原样。
        XCTAssertEqual(wave.unifiedFor(.medium), "1f44b")
        XCTAssertEqual(catalog.find("1F44B-1F3FB"), wave)
        XCTAssertEqual(unifiedToEmoji("1f44b-1f3fb"), "👋🏻")
        XCTAssertEqual(Array(unifiedToEmoji("1f44b-1f3fb").unicodeScalars.map(\.value)), [0x1f44b, 0x1f3fb])
        XCTAssertEqual(unifiedToEmoji("zz-1f600-d800"), "😀")
        XCTAssertEqual(SkinTone.allCases.map(\.code), [nil, "1f3fb", "1f3fc", "1f3fd", "1f3fe", "1f3ff"])
        XCTAssertEqual(SkinTone.allCases.map(\.color), [0xFFD225, 0xFFDFBD, 0xE9C197, 0xC88E62, 0xA86637, 0x60463A])
    }

    func testHidesEmojiTheDeviceFontCannotDraw() throws {
        let hidden: Set<String> = [unifiedToEmoji("1f408"), unifiedToEmoji("1f44b-1f3ff")]
        let catalog = try EmojiCatalog.parse(json, locale: "en") { !hidden.contains($0) }
        XCTAssertNil(catalog.find("1f408"))
        XCTAssertEqual(catalog.find("1f44b")?.variations, ["1f44b-1f3fb"])
        XCTAssertNil(catalog.find("1f44b-1f3ff"))
    }

    func testRecentlyUsedKeepsTheNewestFirstWithoutDuplicatesAtMost14() {
        var recent: [String] = []
        for index in 1...16 { recent = pushRecentEmoji(recent, "e\(index)") }
        XCTAssertEqual(recent.count, RECENT_EMOJI_LIMIT)
        XCTAssertEqual(recent.first, "e16")
        recent = pushRecentEmoji(recent, "e10")
        XCTAssertEqual(recent.first, "e10")
        XCTAssertEqual(recent.filter { $0 == "e10" }.count, 1)
    }

    func testUserDefaultsStoreKeepsTheRecentList() throws {
        let suite = "nf-emoji-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsRecentEmojiStore(defaults: defaults)
        XCTAssertEqual(store.load(), [])
        store.save(["1f600", "1f44b-1f3fb"])
        XCTAssertEqual(UserDefaultsRecentEmojiStore(defaults: defaults).load(), ["1f600", "1f44b-1f3fb"])
        store.save([])
        XCTAssertEqual(store.load(), [])
    }

    func testLoadParsesOncePerLocale() throws {
        var reads = 0
        let read: () throws -> Data = {
            reads += 1
            return Data(self.json.utf8)
        }
        // 缓存是全局的，用别的测试不会用的语言。
        let first = try EmojiCatalog.load(locale: "zh-Hant", read: read, supported: { _ in true })
        let again = try EmojiCatalog.load(locale: "zh-Hant", read: read, supported: { _ in true })
        XCTAssertEqual(reads, 1)
        XCTAssertEqual(first.emojis, again.emojis)
        XCTAssertEqual(first.find("1f408")?.names, ["貓"])
        // 换了语言：重新解析，换掉缓存。
        XCTAssertEqual(try EmojiCatalog.load(locale: "ja", read: read, supported: { _ in true }).find("1f408")?.names, ["ねこ"])
        XCTAssertEqual(reads, 2)
    }

    func testTheBundledAssetParsesWithEveryCategoryIconAndLanguage() throws {
        let asset = try TextTestSupport.androidAsset("emoji.json")
        let catalog = try EmojiCatalog.parse(asset, locale: "ja")
        XCTAssertEqual(catalog.emojis.count, 1906)
        XCTAssertEqual(catalog.categories.first, "suggested")
        for name in catalog.categories + ["search", "clear"] { XCTAssertNotNil(catalog.icons[name], name) }
        XCTAssertFalse(catalog.emojis.filter(try XCTUnwrap(catalog.matcher("ネコ"))).isEmpty)
        XCTAssertFalse(catalog.inCategory("flags").isEmpty)
        XCTAssertFalse(try XCTUnwrap(EmojiCatalog.parse(asset, locale: "ko").find("1f600")).names.isEmpty)
        XCTAssertTrue(try XCTUnwrap(EmojiCatalog.parse(asset, locale: "ar").find("1f600")).names.contains("grinning face"))
    }
}
