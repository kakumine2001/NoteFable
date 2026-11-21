import XCTest
@testable import NoteFableCore

/// 用网页实现算出的用例（scripts/gen-native-search-fold-cases.ts 生成的 Fixtures/search-fold-cases.json，和 Android 的那份相同）
/// 核对 Swift 版折叠。输入和 src/lib/search-fold.test.ts 相同。Android 的 SearchFoldParityTest 的移植。
///
/// 字符串一律按 UTF-16 码元比较（`TextTestSupport.assertSameUnits`）：Swift 的 `==` 会把 "が" 和 "か" + 浊点当成相等。
final class SearchFoldParityTests: XCTestCase {
    private struct Cases: Decodable {
        struct Fold: Decodable {
            let input: String
            let folded: String
            let mapped: String
            let starts: [Int]
            let ends: [Int]
        }

        struct Range: Decodable, Equatable {
            let start: Int
            let end: Int
        }

        struct Ranges: Decodable {
            let text: String
            let terms: [String]
            let ranges: [Range]
        }

        struct Count: Decodable {
            let text: String
            let terms: [String]
            let count: Int
        }

        struct Snippet: Decodable {
            let body: String?
            let terms: [String]
            let snippet: String
        }

        struct Terms: Decodable {
            let query: String
            let terms: [String]
        }

        let fold: [Fold]
        let ranges: [Ranges]
        let counts: [Count]
        let snippets: [Snippet]
        let terms: [Terms]
    }

    private func loadCases() throws -> Cases {
        try JSONDecoder().decode(Cases.self, from: TextTestSupport.fixture("search-fold-cases.json"))
    }

    private func units(_ strings: [String]) -> [[UInt16]] {
        strings.map { Array($0.utf16) }
    }

    func testFoldingAndThePositionMapMatchTheWeb() throws {
        let fold = try loadCases().fold
        XCTAssertGreaterThan(fold.count, 20)
        for item in fold {
            let label = item.input.debugDescription
            // 用例里的输入本身要原样读出来（NUL、代理对、组合记号）。
            TextTestSupport.assertSameUnits(SearchFold.foldSearchText(item.input), item.folded, label)
            let map = SearchFold.foldWithMap(item.input)
            TextTestSupport.assertSameUnits(map.folded, item.mapped, label)
            XCTAssertEqual(map.starts, item.starts, label)
            XCTAssertEqual(map.ends, item.ends, label)
            XCTAssertEqual(map.starts.count, map.folded.utf16.count, label)
        }
    }

    func testMatchRangesAndTermCountsMatchTheWeb() throws {
        let cases = try loadCases()
        XCTAssertGreaterThan(cases.ranges.count, 15)
        for item in cases.ranges {
            let actual = SearchFold.findTermRanges(item.text, item.terms).map { Cases.Range(start: $0.start, end: $0.end) }
            XCTAssertEqual(actual, item.ranges, "\(item.text.debugDescription) \(item.terms)")
        }
        for item in cases.counts {
            XCTAssertEqual(SearchFold.countMatchedTerms(item.text, item.terms), item.count, "\(item.text.debugDescription) \(item.terms)")
        }
    }

    func testSnippetsAndParsedTermsMatchTheWeb() throws {
        let cases = try loadCases()
        XCTAssertGreaterThan(cases.snippets.count, 5)
        for item in cases.snippets {
            TextTestSupport.assertSameUnits(SearchFold.buildSearchSnippet(item.body, item.terms), item.snippet, "\(String(describing: item.body)) \(item.terms)")
        }
        for item in cases.terms {
            XCTAssertEqual(units(SearchFold.parseSearchTerms(item.query)), units(item.terms), item.query.debugDescription)
        }
    }

    func testSplitHighlightKeepsTheOriginalCharacters() {
        XCTAssertEqual(
            SearchFold.splitHighlight("ＡＰＩ設計と Api", ["api"]),
            [
                SearchFold.HighlightPart(text: "ＡＰＩ", isMatch: true),
                SearchFold.HighlightPart(text: "設計と ", isMatch: false),
                SearchFold.HighlightPart(text: "Api", isMatch: true),
            ]
        )
        XCTAssertEqual(SearchFold.splitHighlight("", ["a"]), [])
        XCTAssertEqual(SearchFold.splitHighlight("abc", []), [SearchFold.HighlightPart(text: "abc", isMatch: false)])
        // 片段接起来就是原文（表情、半角假名 + 浊点、展开的 ㌔ 都不被切坏）。
        for (text, terms) in [("😀 ﾃﾞｰﾀ と 単位は㌔ 😀", ["データ", "キロ"]), ("e\u{301}cole École", ["école"]), ("กินข้าว", ["ก"])] {
            let parts = SearchFold.splitHighlight(text, terms)
            TextTestSupport.assertSameUnits(parts.map(\.text).joined(), text, text)
            XCTAssertTrue(parts.contains { $0.isMatch }, text)
        }
    }

    func testShortAsciiTermsOnlyMatchAtTheStartOfAWord() {
        XCTAssertTrue(SearchFold.isShortAsciiTerm("ai"))
        XCTAssertTrue(SearchFold.isShortAsciiTerm("a1"))
        XCTAssertFalse(SearchFold.isShortAsciiTerm("api"))
        XCTAssertFalse(SearchFold.isShortAsciiTerm("あ"))
        XCTAssertFalse(SearchFold.isShortAsciiTerm(""))
        XCTAssertEqual(SearchFold.countMatchedTerms("detail sustainable", ["ai"]), 0)
        XCTAssertEqual(SearchFold.countMatchedTerms("detail AI活用", ["ai"]), 1)
    }

    /// 汉字、谚文音节单独一个字时不经过 NFKC（`isStable`）：在这个平台上它们确实折叠后不变。
    func testTheBlocksSkippedByTheFastPathAreStableUnderNfkcAndLowercasing() {
        for range in [0x4e00...0x9fff, 0x3400...0x4dbf, 0xac00...0xd7a3] {
            for value in stride(from: range.lowerBound, through: range.upperBound, by: 53) {
                guard let scalar = Unicode.Scalar(UInt32(value)) else { continue }
                let text = String(Character(scalar))
                XCTAssertEqual(Array(SearchFold.nfkc(text).lowercased().utf16), Array(text.utf16), String(value, radix: 16))
                TextTestSupport.assertSameUnits(SearchFold.foldSearchText(text), text)
            }
        }
        // 后面跟着收音字母时照常合成（不是"单独一个字"）。
        TextTestSupport.assertSameUnits(SearchFold.foldSearchText("\u{ac00}\u{11a8}"), "\u{ac01}")
    }
}
