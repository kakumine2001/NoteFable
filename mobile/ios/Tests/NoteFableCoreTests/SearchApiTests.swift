import Foundation
import XCTest
@testable import NoteFableCore

final class SearchApiTests: XCTestCase {
    func testSendsTheQueryScopeAndProjectFilterAndParsesBothResultKinds() async throws {
        let server = FakeTransport()
        server.enqueue(#"""
        {"query":"a b","notes":[{"kind":"note","id":"n1","title":"N","icon":null,"snippet":"s","blockId":"b1","updatedAt":"2026-01-02T03:04:05.000Z"}],
        "chats":[{"kind":"chat","id":"c1","title":"C","icon":"x","snippet":"x","messageId":"m1","role":"USER","attachmentName":"f.pdf","projectId":"p1","titleMatch":false,"updatedAt":""}]}
        """#)
        server.enqueue(#"{"query":"x","notes":[],"chats":[]}"#)
        let api = SearchApi(http: makeApi(server).http)
        let result = try await api.search(query: "a b&c", scope: .chats, projectId: "p1", kind: nil)
        XCTAssertEqual(server.next().path, "/api/search?q=a%20b%26c&scope=chats&projectId=p1")
        XCTAssertEqual(result.notes.map(\.blockId), ["b1"])
        XCTAssertEqual(result.chats.map(\.messageId), ["m1"])
        XCTAssertEqual(result.chats.first?.attachmentName, "f.pdf")
        _ = try await api.search(query: "x", scope: .all, projectId: nil, kind: nil)
        XCTAssertEqual(server.next().path, "/api/search?q=x&scope=all")
    }

    func testAServerErrorThrows() async {
        let server = FakeTransport()
        server.enqueue(#"{"error":"Database is unavailable.","notes":[],"chats":[]}"#, status: 503)
        let error = await errorThrown(try await SearchApi(http: makeApi(server).http).search(query: "x", scope: .all, projectId: nil, kind: nil))
        XCTAssertTrue(error is ApiException)
    }
}
