import XCTest
@testable import NoteFableCore

/// 对应 Android 的 `ChatQuoteTest`（网页 `src/lib/chat-quote.test.ts`）。
final class ChatQuoteTests: XCTestCase {
    func testNormalizesTheSelection() {
        XCTAssertEqual(ChatQuote.normalize("  hello  \r\n\r\n\r\nworld \n\n"), "hello\n\nworld")
        let long = ChatQuote.normalize(String(repeating: "😀", count: ChatQuote.maxChars + 5))
        XCTAssertTrue(long.hasSuffix("…"))
        XCTAssertEqual(long.unicodeScalars.count, ChatQuote.maxChars + 1)
    }

    func testComposesABlockquote() {
        XCTAssertEqual(ChatQuote.compose(quote: "a\n\nb", body: " why? "), "> a\n>\n> b\n\nwhy?")
        XCTAssertEqual(ChatQuote.compose(quote: nil, body: " why? "), "why?")
        XCTAssertEqual(ChatQuote.compose(quote: "  ", body: "why?"), "why?")
    }

    func testSplitsWhatItComposed() {
        for (quote, body) in [("a\n\nb", "why?"), ("> nested", "line 1\n\nline 2"), ("x", "> not a quote")] {
            let split = ChatQuote.split(ChatQuote.compose(quote: quote, body: body))
            XCTAssertEqual(split.quote, quote)
            XCTAssertEqual(split.body, body)
        }
    }

    func testLeavesOtherMessagesAlone() {
        for content in ["plain", "> only a quote", "> quote\nno blank line", "text\n\n> later quote", ">\n\nbody", ">not a quote\n\nbody"] {
            let split = ChatQuote.split(content)
            XCTAssertNil(split.quote, content)
            XCTAssertEqual(split.body, content)
        }
    }

    func testSplitsAQuoteWrittenWithWindowsLineEndings() {
        let split = ChatQuote.split("> a\r\n> b\r\n\r\nwhy?")
        XCTAssertEqual(split.quote, "a\nb")
        XCTAssertEqual(split.body, "why?")
    }
}
