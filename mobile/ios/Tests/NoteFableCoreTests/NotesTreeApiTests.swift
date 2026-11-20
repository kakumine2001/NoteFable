import Foundation
import XCTest
@testable import NoteFableCore

/// 子页面、收藏、页面设置、复制的请求和应答（网页 src/app/api/pages/[pageId] 下的各接口）。
final class NotesTreeApiTests: XCTestCase {
    func testCreatesAPageInsideAnotherAndReadsTreeFields() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"page":{"id":"c","title":"Untitled","parentId":"p","groupId":"g","favoritedAt":null,"fullWidth":true,"font":"serif","locked":true}}"#, status: 201)
        let page = try await makeApi(server).createNote(parentId: "p")
        XCTAssertEqual(page.parentId, "p")
        XCTAssertTrue(page.fullWidth)
        XCTAssertEqual(page.font, "serif")
        XCTAssertTrue(page.locked)
        let request = server.next()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.json?["parentId"]?.stringValue, "p")
    }

    func testTrashMoveAndDeleteForeverReturnTheAffectedIds() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"ok":true,"ids":["p","c"]}"#)
        server.enqueue(#"{"id":"p","groupId":"g","parentId":null,"ids":["p","c"]}"#)
        server.enqueue(#"{"ok":true}"#)
        let api = makeApi(server)
        let trashed = try await api.trashNote(id: "p")
        XCTAssertEqual(trashed, ["p", "c"])
        let moved = try await api.moveNote(id: "p", groupId: "g")
        XCTAssertEqual(moved, ["p", "c"])
        // 旧服务端没有 ids：至少是这一篇。
        let deleted = try await api.deleteForever(id: "t")
        XCTAssertEqual(deleted, ["t"])
        XCTAssertEqual(server.next().path, "/api/pages/p")
        XCTAssertEqual(server.next().path, "/api/pages/p/group")
        XCTAssertEqual(server.next().path, "/api/pages/trash/t")
    }

    func testMovesUnderAPageFavoritesAndChangesOnlyTheSentSettings() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"pages":[{"id":"c","parentId":"p","groupId":"g"}]}"#)
        server.enqueue(#"{"page":{"id":"c","favoritedAt":"2026-11-16T00:00:00.000Z"}}"#)
        server.enqueue(#"{"page":{"id":"c","smallText":true}}"#)
        let api = makeApi(server)
        let moved = try await api.moveToPage(id: "c", parentId: "p")
        XCTAssertEqual(moved.map(\.parentId), ["p"])
        let favorite = try await api.setFavorite(id: "c", favorite: true)
        XCTAssertEqual(favorite.favoritedAt, "2026-11-16T00:00:00.000Z")
        let settings = try await api.updateSettings(id: "c", settings: NotePageSettings(smallText: true))
        XCTAssertTrue(settings.smallText)
        let parentRequest = server.next()
        XCTAssertEqual(parentRequest.path, "/api/pages/c/parent")
        XCTAssertEqual(parentRequest.json?["parentId"]?.stringValue, "p")
        XCTAssertEqual(server.next().json?["favorite"]?.boolValue, true)
        let settingsRequest = server.next()
        XCTAssertEqual(settingsRequest.path, "/api/pages/c/settings")
        XCTAssertEqual(settingsRequest.jsonKeys, ["smallText"])
    }

    func testDuplicatesAndRestoresWithEveryAffectedPage() async throws {
        let server = FakeTransport()
        server.enqueue(
            #"{"page":{"id":"x","title":"P (1)"},"pages":[{"id":"x","title":"P (1)"},{"id":"y","parentId":"x"}],"items":[{"id":"p","position":1},{"id":"x","position":2}]}"#,
            status: 201
        )
        server.enqueue(#"{"page":{"id":"p"},"pages":[{"id":"c","parentId":"p"},{"id":"p"}]}"#)
        let api = makeApi(server)
        let copy = try await api.duplicate(id: "p")
        XCTAssertEqual(copy.page.id, "x")
        XCTAssertEqual(copy.pages.map(\.id), ["x", "y"])
        XCTAssertEqual(copy.order.map(\.position), [1, 2])
        XCTAssertFalse(copy.order.contains { $0.movedGroup })
        // 这一篇排在最前面。
        let restored = try await api.restoreNote(id: "p")
        XCTAssertEqual(restored.map(\.id), ["p", "c"])
        XCTAssertEqual(server.next().path, "/api/pages/p/duplicate")
        XCTAssertEqual(server.next().path, "/api/pages/trash/p")
    }
}
