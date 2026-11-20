import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import NoteFableCore

// Android 靠 OkHttp 做的那几件事（Cookie、重定向）在这边是自己写的：NoteFableHttp 的流程和 Cookie 存储。
final class NoteFableHttpTests: XCTestCase {
    private let site = URL(string: testBaseUrl + "/api/sessions")!

    private func cookie(_ line: String, url: String = testBaseUrl + "/api/sessions", now: Int64 = 1_000_000) -> StoredCookie? {
        StoredCookie.parse(line, url: URL(string: url)!, now: now)
    }

    func testResponseCookiesAreStoredAndSentBackToTheSameSiteOnly() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"sessions":[]}"#, headers: [
            "set-cookie": "notefable_device=abc.sig; Path=/; Expires=Wed, 21 Oct 2099 07:28:00 GMT; HttpOnly; SameSite=Lax, authjs.session-token=jwt; Path=/; HttpOnly",
        ])
        server.enqueue(#"{"sessions":[]}"#)
        server.enqueue("ok")
        let jar = MemoryCookieStore()
        let api = makeApi(server, cookies: jar)
        _ = try await api.sessions()
        _ = try await api.sessions()
        _ = try await api.fetchData("https://other.example/image.png")
        XCTAssertNil(server.next().header("Cookie"))
        XCTAssertEqual(server.next().header("Cookie"), "notefable_device=abc.sig; authjs.session-token=jwt")
        XCTAssertNil(server.next().header("Cookie"))
        // 交给 WKWebView 的形式。
        let forWebView = jar.cookies(for: URL(string: testBaseUrl + "/note-embed")!)
        XCTAssertEqual(forWebView.map(\.name), ["notefable_device", "authjs.session-token"])
        XCTAssertEqual(forWebView.first?.value, "abc.sig")
        XCTAssertEqual(forWebView.first?.domain, "notefable.test")
        XCTAssertNotNil(forWebView.first?.expiresDate)
        XCTAssertNil(forWebView.last?.expiresDate)
    }

    func testRedirectsAreFollowedWithCookiesForTheNewAddressAndNeverLeakToAnotherSite() async throws {
        let server = FakeTransport()
        server.enqueue("", status: 307, headers: ["Location": "https://blob.example/x.png?sig=1", "Set-Cookie": "seen=1; Path=/"])
        server.enqueue("PNG", headers: ["Content-Type": "image/png; charset=binary"])
        let jar = MemoryCookieStore()
        jar.saveFromResponse(site, [StoredCookie(name: "notefable_device", value: "me", domain: "notefable.test")])
        let api = makeApi(server, cookies: jar)
        let image = try await api.fetchData("/api/attachments/a1/image")
        XCTAssertEqual(String(decoding: image.data, as: UTF8.self), "PNG")
        XCTAssertEqual(image.mimeType, "image/png")
        XCTAssertEqual(server.next().header("Cookie"), "notefable_device=me")
        let followed = server.next()
        XCTAssertEqual(followed.request.url.absoluteString, "https://blob.example/x.png?sig=1")
        XCTAssertNil(followed.header("Cookie"))
        XCTAssertEqual(followed.header("User-Agent"), NoteFableHttp.USER_AGENT)
        // 跳转那一步下发的 Cookie 也存下了。
        XCTAssertEqual(jar.loadForRequest(site).map(\.name), ["notefable_device", "seen"])
    }

    func testRedirectRulesMatchOkHttp() throws {
        var post = HTTPRequest(method: "POST", url: site, body: .data(Data("x".utf8)))
        post.setHeader("Content-Type", "application/json")
        post.setHeader("Authorization", "Bearer t")
        func response(_ status: Int, _ location: String?) -> HTTPURLResponse {
            HTTPURLResponse(url: site, statusCode: status, httpVersion: nil, headerFields: location.map { ["Location": $0] } ?? [:])!
        }
        let seeOther = try XCTUnwrap(NoteFableHttp.redirect(from: post, response: response(302, "/done?x=1")))
        XCTAssertEqual(seeOther.method, "GET")
        XCTAssertNil(seeOther.body)
        XCTAssertNil(seeOther.header("content-type"))
        XCTAssertEqual(seeOther.url.absoluteString, testBaseUrl + "/done?x=1")
        XCTAssertEqual(seeOther.header("Authorization"), "Bearer t")

        let temporary = try XCTUnwrap(NoteFableHttp.redirect(from: post, response: response(307, "https://other.example/up")))
        XCTAssertEqual(temporary.method, "POST")
        XCTAssertEqual(temporary.body, .data(Data("x".utf8)))
        XCTAssertNil(temporary.header("Authorization"))

        XCTAssertNil(NoteFableHttp.redirect(from: post, response: response(302, nil)))
        XCTAssertNil(NoteFableHttp.redirect(from: post, response: response(200, "/x")))
        XCTAssertNil(NoteFableHttp.redirect(from: post, response: response(302, "mailto:a@b.c")))
    }

    func testARedirectLoopStopsAndHandsBackTheLastResponse() async throws {
        let server = FakeTransport()
        server.respond { _ in .init("", status: 302, headers: ["Location": "/again"]) }
        let http = makeApi(server).http
        let (_, response) = try await http.execute(try http.request("GET", "/start"))
        XCTAssertEqual(response.statusCode, 302)
        XCTAssertEqual(server.requestCount, 21)
    }

    func testParsesSetCookieLikeOkHttp() {
        let device = cookie("notefable_device=abc=; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax")
        XCTAssertEqual(device, StoredCookie(
            name: "notefable_device", value: "abc=", expiresAt: 1_060_000, domain: "notefable.test", path: "/",
            secure: true, httpOnly: true, hostOnly: true, sameSite: "Lax"
        ))
        // Max-Age 优先于 Expires；0 是删除。
        XCTAssertEqual(cookie("a=1; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Max-Age=0")?.expiresAt, Int64.min)
        XCTAssertEqual(cookie("a=1; Expires=Thu, 01 Jan 1970 00:00:10 GMT")?.expiresAt, 10_000)
        // 没有期限的会话 Cookie。
        XCTAssertEqual(cookie("a=1")?.expiresAt, StoredCookie.MAX_DATE)
        // 没写 Path：用请求地址的目录。
        XCTAssertEqual(cookie("a=1")?.path, "/api")
        XCTAssertEqual(cookie("a=1", url: testBaseUrl + "/x")?.path, "/")
        // Domain：对子域也有效；不属于这个地址的域名拒收。
        let wide = cookie("a=1; Domain=.NoteFable.test", url: "https://app.notefable.test/x")
        XCTAssertEqual(wide?.domain, "notefable.test")
        XCTAssertEqual(wide?.hostOnly, false)
        XCTAssertNil(cookie("a=1; Domain=evil.example"))
        XCTAssertNil(cookie("no-equals-sign; Path=/"))
        XCTAssertNil(cookie("=empty"))
    }

    func testCookiesMatchByHostPathAndScheme() {
        let hostOnly = StoredCookie(name: "a", value: "1", domain: "notefable.test")
        XCTAssertTrue(hostOnly.matches(URL(string: "https://notefable.test/any")!))
        XCTAssertTrue(hostOnly.matches(URL(string: "https://NOTEFABLE.test")!))
        XCTAssertFalse(hostOnly.matches(URL(string: "https://app.notefable.test/")!))
        XCTAssertFalse(hostOnly.matches(URL(string: "https://evilnotefable.test/")!))
        let wide = StoredCookie(name: "a", value: "1", domain: "notefable.test", hostOnly: false)
        XCTAssertTrue(wide.matches(URL(string: "https://app.notefable.test/")!))
        XCTAssertFalse(wide.matches(URL(string: "https://evilnotefable.test/")!))
        let scoped = StoredCookie(name: "a", value: "1", domain: "notefable.test", path: "/api")
        XCTAssertTrue(scoped.matches(URL(string: "https://notefable.test/api")!))
        XCTAssertTrue(scoped.matches(URL(string: "https://notefable.test/api/x")!))
        XCTAssertFalse(scoped.matches(URL(string: "https://notefable.test/apix")!))
        let secure = StoredCookie(name: "a", value: "1", domain: "notefable.test", secure: true)
        XCTAssertFalse(secure.matches(URL(string: "http://notefable.test/")!))
    }

    func testSplitsFoldedSetCookieHeadersWithoutBreakingDates() {
        XCTAssertEqual(
            StoredCookie.splitSetCookieHeader("a=1; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=/, b=2; Path=/,c=x,y; HttpOnly"),
            ["a=1; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=/", "b=2; Path=/", "c=x,y; HttpOnly"]
        )
        XCTAssertEqual(StoredCookie.splitSetCookieHeader("a=1"), ["a=1"])
    }

    func testThePersistentJarKeepsEveryCookieAcrossLaunchesIncludingSessionCookies() throws {
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("nf-cookies-\(UUID().uuidString)").appendingPathComponent("cookies.json")
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let now = Int64(Date().timeIntervalSince1970 * 1000)

        let jar = PersistentCookieJar(fileURL: file)
        jar.saveFromResponse(site, [
            StoredCookie(name: "notefable_device", value: "me", expiresAt: now + 60_000, domain: "notefable.test", httpOnly: true),
            StoredCookie(name: "authjs.session-token", value: "jwt", domain: "notefable.test", secure: true),
            StoredCookie(name: "gone", value: "x", expiresAt: now - 1, domain: "notefable.test"),
        ])
        XCTAssertEqual(jar.loadForRequest(site).map(\.name), ["notefable_device", "authjs.session-token"])

        // 重开 App。
        let reopened = PersistentCookieJar(fileURL: file)
        XCTAssertEqual(reopened.loadForRequest(site).map(\.value), ["me", "jwt"])
        // 同名的后到的覆盖先到的，位置不变；过期的等于删除。
        reopened.saveFromResponse(site, [StoredCookie(name: "notefable_device", value: "new", domain: "notefable.test")])
        XCTAssertEqual(reopened.cookieHeader(for: site), "notefable_device=new; authjs.session-token=jwt")
        reopened.removeWhere { $0.name.contains("authjs.") }
        XCTAssertEqual(PersistentCookieJar(fileURL: file).loadForRequest(site).map(\.name), ["notefable_device"])
        reopened.saveFromResponse(site, [StoredCookie(name: "notefable_device", value: "", expiresAt: Int64.min, domain: "notefable.test")])
        XCTAssertNil(PersistentCookieJar(fileURL: file).cookieHeader(for: site))
        reopened.saveFromResponse(site, [StoredCookie(name: "a", value: "1", domain: "notefable.test")])
        reopened.clear()
        XCTAssertTrue(PersistentCookieJar(fileURL: file).loadForRequest(site).isEmpty)
    }

    func testEncodesPathAndQueryValuesAndBuildsMultipartBodies() {
        XCTAssertEqual(ApiUrl.encode("a b/c&d=é.-*_~+"), "a%20b%2Fc%26d%3D%C3%A9.-*_%7E%2B")
        var form = MultipartBody(boundary: "B")
        form.addFormDataPart("message", "hi\r\n你")
        form.addFormDataPart("fi\"le", filename: "a\nb.png", contentType: "image/png", data: Data([0, 255]))
        XCTAssertEqual(form.contentType, "multipart/form-data; boundary=B")
        var expected = Data("--B\r\nContent-Disposition: form-data; name=\"message\"\r\n\r\nhi\r\n你\r\n".utf8)
        expected.append(Data("--B\r\nContent-Disposition: form-data; name=\"fi%22le\"; filename=\"a%0Ab.png\"\r\nContent-Type: image/png\r\n\r\n".utf8))
        expected.append(Data([0, 255]))
        expected.append(Data("\r\n--B--\r\n".utf8))
        XCTAssertEqual(form.encoded(), expected)
        let parts = MultipartParts(contentType: form.contentType, body: form.encoded())
        XCTAssertEqual(parts.parts.last?.data, Data([0, 255]))
    }

    func testRequestHeadersAreCaseInsensitive() {
        var request = HTTPRequest(url: site, headers: ["content-type": "a"])
        request.setHeader("Content-Type", "b")
        XCTAssertEqual(request.headers, ["Content-Type": "b"])
        XCTAssertEqual(request.header("CONTENT-TYPE"), "b")
        request.setHeader("content-TYPE", nil)
        XCTAssertTrue(request.headers.isEmpty)
    }
}
