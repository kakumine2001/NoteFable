import Foundation
import XCTest
@testable import NoteFableCore

final class IconApiTests: XCTestCase {
    func testChatIconPatchSendsTheEmojiOrNullAndReportsFailuresAsFalse() async throws {
        let server = FakeTransport()
        server.enqueue("{}")
        server.enqueue("{}")
        server.enqueue(#"{"error":"Chat icon must be a single emoji."}"#, status: 400)
        let api = SessionsApi(http: makeApi(server).http)
        let set = try await api.updateSessionIcon(id: "s1", icon: "📚")
        let cleared = try await api.updateSessionIcon(id: "s1", icon: nil)
        let refused = try await api.updateSessionIcon(id: "s1", icon: "x")
        XCTAssertTrue(set)
        XCTAssertTrue(cleared)
        XCTAssertFalse(refused)
        let first = server.next()
        XCTAssertEqual(first.method, "PATCH")
        XCTAssertEqual(first.path, "/api/sessions/s1")
        XCTAssertEqual(first.json?["icon"]?.stringValue, "📚")
        XCTAssertEqual(server.next().json?["icon"], JSONValue.null)
    }

    func testNoteIconPutReturnsTheUpdatedPage() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"page":{"id":"p1","title":"Bio","icon":"🧬","version":4}}"#)
        let page = try await NoteIconApi(http: makeApi(server).http).setNoteIcon(id: "p1", icon: "🧬")
        XCTAssertEqual(page.icon, "🧬")
        XCTAssertEqual(page.version, 4)
        let request = server.next()
        XCTAssertEqual(request.method, "PUT")
        XCTAssertEqual(request.path, "/api/pages/p1/icon")
        XCTAssertEqual(request.json?["icon"]?.stringValue, "🧬")
    }
}
