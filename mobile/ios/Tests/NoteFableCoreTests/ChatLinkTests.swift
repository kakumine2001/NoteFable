import XCTest
@testable import NoteFableCore

/// 对应 Android 的 `ChatLinkTest`，加上地址解析（Android 用 OkHttp，这里是 `HttpUrl`）的几条。
final class ChatLinkTests: XCTestCase {
    private let base = "https://notefable.example"

    func testOpensTheChatAndMessageFromTheSavedAnswerLinkAndItsForwardedForms() {
        XCTAssertEqual(ChatLink.parse("https://notefable.example/?chat=sess123&message=msg_1-a", baseUrl: base), .open(chatId: "sess123", messageId: "msg_1-a"))
        XCTAssertEqual(ChatLink.parse("https://notefable.example/?chat=sess123", baseUrl: base), .open(chatId: "sess123", messageId: nil))
        XCTAssertEqual(ChatLink.parse("https://notefable.example/app?chat=s&message=m", baseUrl: base), .open(chatId: "s", messageId: "m"))
        XCTAssertEqual(ChatLink.parse("https://notefable.example/ja/app?chat=s", baseUrl: base), .open(chatId: "s", messageId: nil))
        XCTAssertEqual(ChatLink.parse("https://notefable.example/zh-Hant/app/?chat=s", baseUrl: base), .open(chatId: "s", messageId: nil))
    }

    func testABadChatIdIsInvalidAndABadMessageIdIsDroppedLikeTheWeb() {
        XCTAssertEqual(ChatLink.parse("https://notefable.example/?chat=a%2Fb", baseUrl: base), .invalid)
        XCTAssertEqual(ChatLink.parse("https://notefable.example/?chat=" + String(repeating: "x", count: 65), baseUrl: base), .invalid)
        XCTAssertEqual(ChatLink.parse("https://notefable.example/?chat=ok&message=a.b", baseUrl: base), .open(chatId: "ok", messageId: nil))
    }

    func testIgnoresOtherSitesOtherPagesAndLinksWithoutAChat() {
        XCTAssertNil(ChatLink.parse("https://evil.example/?chat=s", baseUrl: base))
        XCTAssertNil(ChatLink.parse("http://notefable.example/?chat=s", baseUrl: base))
        XCTAssertNil(ChatLink.parse("https://notefable.example:8443/?chat=s", baseUrl: base))
        XCTAssertNil(ChatLink.parse("https://notefable.example/note-embed?chat=s", baseUrl: base))
        XCTAssertNil(ChatLink.parse("https://notefable.example/?view=pages&page=p", baseUrl: base))
        XCTAssertNil(ChatLink.parse("https://notefable.example/?chat=", baseUrl: base))
        XCTAssertNil(ChatLink.parse("not a url", baseUrl: base))
        XCTAssertNil(ChatLink.parse("https://notefable.example/toolong-locale/app?chat=s", baseUrl: base))
    }

    func testTreatsNotefableComAndWwwAsTheSameSite() {
        let base = "https://notefable.com"
        XCTAssertEqual(ChatLink.parse("https://www.notefable.com/?chat=c1&message=m1", baseUrl: base), .open(chatId: "c1", messageId: "m1"))
        XCTAssertNil(ChatLink.parse("https://notefable.com.evil.example/?chat=c1", baseUrl: base))
    }

    func testAcceptsOldNotefableComLinksWhenTheServerIsTheWorkspaceHost() {
        let base = "https://app.notefable.com"
        XCTAssertEqual(ChatLink.parse("https://app.notefable.com/?chat=c1&message=m1", baseUrl: base), .open(chatId: "c1", messageId: "m1"))
        XCTAssertEqual(ChatLink.parse("https://notefable.com/app?chat=c1", baseUrl: base), .open(chatId: "c1", messageId: nil))
        XCTAssertEqual(ChatLink.parse("https://www.notefable.com/?chat=c1", baseUrl: base), .open(chatId: "c1", messageId: nil))
        XCTAssertNil(ChatLink.parse("https://evil.notefable.com/?chat=c1", baseUrl: base))
    }

    func testOpensSharedConversationLinks() {
        let base = "https://app.notefable.com"
        XCTAssertEqual(ChatLink.parse("https://app.notefable.com/c/c1?message=m1", baseUrl: base), .open(chatId: "c1", messageId: "m1"))
        XCTAssertEqual(ChatLink.parse("https://app.notefable.com/c/c1/", baseUrl: base), .open(chatId: "c1", messageId: nil))
        XCTAssertEqual(ChatLink.parse("https://app.notefable.com/c/bad%20id", baseUrl: base), .invalid)
        XCTAssertNil(ChatLink.parse("https://app.notefable.com/c/", baseUrl: base))
        XCTAssertNil(ChatLink.parse("https://app.notefable.com/c/c1/extra", baseUrl: base))
    }

    // ---- HttpUrl ----

    func testParsesHttpUrlsLikeOkHttp() throws {
        let url = try XCTUnwrap(HttpUrl.parse("  HTTPS://User@Example.COM:8443/a/./b/../c%20d/?q=1+2&x=%E4%B8%AD&flag#frag  "))
        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "example.com")
        XCTAssertEqual(url.port, 8443)
        XCTAssertEqual(url.encodedPath, "/a/c%20d/")
        XCTAssertEqual(url.pathSegments, ["a", "c d", ""])
        XCTAssertEqual(url.queryParameter("q"), "1 2")
        XCTAssertEqual(url.queryParameter("x"), "中")
        XCTAssertNil(url.queryParameter("flag"))
        XCTAssertNil(url.queryParameter("missing"))
        XCTAssertEqual(url.absoluteString, "https://User@example.com:8443/a/c%20d/?q=1+2&x=%E4%B8%AD&flag#frag")

        let bare = try XCTUnwrap(HttpUrl.parse("http://example.com"))
        XCTAssertEqual(bare.port, 80)
        XCTAssertEqual(bare.encodedPath, "/")
        XCTAssertEqual(bare.pathSegments, [""])
        XCTAssertEqual(bare.absoluteString, "http://example.com/")
        XCTAssertEqual(HttpUrl.parse("https://example.com:443/x")?.absoluteString, "https://example.com/x")
        XCTAssertEqual(HttpUrl.parse("https://example.com/日本 語?q=あ")?.absoluteString, "https://example.com/%E6%97%A5%E6%9C%AC%20%E8%AA%9E?q=%E3%81%82")
        XCTAssertEqual(HttpUrl.parse("http://[::1]:3000/x")?.host, "::1")
        XCTAssertEqual(HttpUrl.parse("http://[::1]:3000/x")?.absoluteString, "http://[::1]:3000/x")
    }

    func testRejectsWhatIsNotAnHttpUrl() {
        for bad in ["", "not a url", "javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/", "https://", "https://?chat=x",
                    "https://exa mple.com/", "https://example.com:99999/", "https://example.com:8a/", "mailto:a@b.c", "//example.com/x"] {
            XCTAssertNil(HttpUrl.parse(bad), bad)
        }
    }
}
