import Foundation
import XCTest
@testable import NoteFableCore

final class ChatStreamParserTests: XCTestCase {
    func testPlainJSONStringIsATextDelta() {
        XCTAssertEqual(ChatStreamParser.parseLine("data: \"Hello\\n世界\""), .delta(text: "Hello\n世界"))
    }

    func testActivityObjectIsSurfacedAsAnActivityEvent() {
        let event = ChatStreamParser.parseLine(#"data: {"activity":{"type":"thought","id":"t1","delta":"hmm"}}"#)
        guard case .activity(let payload)? = event else { return XCTFail("expected an activity event") }
        XCTAssertEqual(payload["type"]?.stringValue, "thought")
    }

    func testDoneMarkerBlankLinesCommentsAndNonDataLinesAreIgnored() {
        for line in ["data: [DONE]", "", "   ", ": keep-alive", "event: message", "data:"] {
            XCTAssertNil(ChatStreamParser.parseLine(line), "'\(line)' should be ignored")
        }
    }

    func testUnreadablePayloadsAreIgnoredInsteadOfEndingTheStream() {
        for line in ["data: {not json", "data: 42", "data: {\"other\":1}", "data: [1,2]", "data: {\"activity\":\"x\"}"] {
            XCTAssertNil(ChatStreamParser.parseLine(line), "'\(line)' should be ignored")
        }
    }

    func testDataPrefixWithoutASpaceAndTrailingCarriageReturnBothWork() {
        XCTAssertEqual(ChatStreamParser.parseLine("data:\"a\"\r"), .delta(text: "a"))
    }

    func testTheLineBufferSplitsOnNewlinesAcrossChunksAndKeepsTheLastLine() {
        var buffer = ChatStreamLineBuffer()
        let bytes = Data("a\r\nb世\n\nlast".utf8)
        var lines: [String] = []
        // 一个字节一个字节地喂：多字节字符和 \r\n 都会被切开。
        for byte in bytes { lines += buffer.append(Data([byte])) }
        XCTAssertEqual(lines, ["a", "b世", ""])
        XCTAssertEqual(buffer.finish(), "last")
        XCTAssertNil(buffer.finish())
    }
}
