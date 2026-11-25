import Foundation
import XCTest
@testable import NoteFableCore

final class NotesApiTests: XCTestCase {
    func testReadsPagesAndGroups() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"pages":[{"id":"a","title":"T","icon":null,"version":2,"groupId":"g","position":0,"createdAt":"x","updatedAt":"y"}],"groups":[{"id":"g","name":"G","position":0}]}"#)
        let list = try await makeApi(server).notes()
        XCTAssertEqual(list.pages.first?.groupId, "g")
        XCTAssertEqual(list.pages.count, 1)
        XCTAssertEqual(list.groups.first?.name, "G")
        XCTAssertEqual(server.next().path, "/api/pages")
    }

    func testCreatesAnUntitledNoteLikeTheWeb() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"page":{"id":"n","title":"Untitled","icon":null,"version":0,"groupId":null}}"#, status: 201)
        let page = try await makeApi(server).createNote()
        XCTAssertEqual(page.id, "n")
        let request = server.next()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.json?["title"]?.stringValue, "Untitled")
        XCTAssertEqual(request.json?["icon"], JSONValue.null)
        XCTAssertEqual(request.json?["blocks"], JSONValue.array([]))
        XCTAssertFalse(request.jsonKeys.contains("parentId"))
    }

    func testMovesANoteOutOfItsProjectWithANullGroup() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"id":"a","groupId":null}"#)
        _ = try await makeApi(server).moveNote(id: "a", groupId: nil)
        let request = server.next()
        XCTAssertEqual(request.method, "PUT")
        XCTAssertEqual(request.path, "/api/pages/a/group")
        XCTAssertEqual(request.json?["groupId"], JSONValue.null)
    }

    func testReordersANoteAndReadsWhichNoteChangedProject() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"items":[{"id":"b","position":1,"groupId":null},{"id":"a","position":2},{"id":"c","position":3}]}"#)
        let updates = try await makeApi(server).reorderNote(id: "b", targetId: "a", after: false)
        let request = server.next()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/api/pages/reorder")
        XCTAssertEqual(request.json, ["id": "b", "targetId": "a", "after": false])
        XCTAssertEqual(updates, [
            NoteOrderUpdate(id: "b", position: 1, groupId: nil, movedGroup: true),
            NoteOrderUpdate(id: "a", position: 2),
            NoteOrderUpdate(id: "c", position: 3),
        ])
    }

    func testTrashEndpointsAndServerErrors() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"pages":[{"id":"t","title":"Old","icon":null,"deletedAt":"2026-11-14T00:00:00.000Z","purgeAt":"2026-12-14T00:00:00.000Z"}]}"#)
        server.enqueue(#"{"ok":true,"count":1}"#)
        server.enqueue(#"{"error":"Note not found in the trash."}"#, status: 404)
        let api = makeApi(server)
        let trash = try await api.trash()
        XCTAssertEqual(trash.map(\.id), ["t"])
        XCTAssertEqual(server.next().path, "/api/pages/trash")

        try await api.emptyTrash(before: "2026-11-14T00:00:00.000Z")
        let empty = server.next()
        XCTAssertEqual(empty.method, "DELETE")
        XCTAssertEqual(empty.path, "/api/pages/trash?before=2026-11-14T00%3A00%3A00.000Z")

        let error = await errorThrown(try await api.restoreNote(id: "t")) as? ApiException
        XCTAssertEqual(error?.message, "Note not found in the trash.")
        XCTAssertEqual(server.next().method, "POST")
    }

    func testEmbedUrlCarriesPageAndLanguage() {
        let api = makeApi(FakeTransport(), baseUrl: "https://example.test")
        XCTAssertEqual(api.noteEmbedUrl(pageId: "abc", lang: "ja"), "https://example.test/note-embed?page=abc&lang=ja")
        XCTAssertEqual(api.noteEmbedUrl(pageId: "a/b", lang: nil), "https://example.test/note-embed?page=a%2Fb")
        XCTAssertEqual(
            api.noteEmbedUrl(pageId: "abc", lang: "zh", model: "gpt-5.5", reasoning: "high"),
            "https://example.test/note-embed?page=abc&lang=zh&model=gpt-5.5&reasoning=high"
        )
        XCTAssertEqual(api.noteEmbedUrl(pageId: "abc", lang: nil, model: "a&b", reasoning: nil), "https://example.test/note-embed?page=abc&model=a%26b")
    }

    func testParsesTheBridgeMessagesAndIgnoresUnknownOnes() {
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"ready","page":{"id":"p","title":"Title","icon":null}}"#), .ready(id: "p", title: "Title", icon: nil))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"ready","page":{"id":"p","title":"Title","icon":null,"version":7}}"#), .ready(id: "p", title: "Title", icon: nil, version: 7))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"meta","title":"T","icon":"📘"}"#), .meta(title: "T", icon: "📘"))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"meta","title":"T","icon":"📘","version":8}"#), .meta(title: "T", icon: "📘", version: 8))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"saveState","state":"conflict"}"#), .saveState(state: "conflict"))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"missing"}"#), .missing(id: nil))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"missing","id":"p1"}"#), .missing(id: "p1"))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"missing","id":""}"#), .missing(id: nil))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"trashed"}"#), .trashed)
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"openPage","id":"p2"}"#), .openPage(id: "p2"))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"openPage","id":""}"#))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"pagesChanged"}"#), .pagesChanged)
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"flushed","requestId":"r1","ok":true}"#), .flushed(requestId: "r1", ok: true))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"flushed","requestId":"r2","ok":false}"#), .flushed(requestId: "r2", ok: false))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"flushed","requestId":"r3","ok":false,"kept":true}"#), .flushed(requestId: "r3", ok: false, kept: true))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"later-feature"}"#))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"ready"}"#))
        XCTAssertNil(EmbedMessage.parse("not json"))
    }

    func testRecentNotesAndThePageSummaryRoundTripForTheEditor() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"pages":[{"id":"r","locked":true,"font":"mono"}]}"#)
        let recent = try await makeApi(server).recentNotes()
        XCTAssertEqual(server.next().path, "/api/pages?recent=1")
        // 页面菜单把这一项交给网页的 notefableEmbed.pageSettings。
        let json = JSONValue.parse(NoteFableJson.encodeToString(recent[0]))
        XCTAssertEqual(json?["id"]?.stringValue, "r")
        XCTAssertEqual(json?["locked"]?.boolValue, true)
        XCTAssertEqual(json?["font"]?.stringValue, "mono")
        XCTAssertNil(json?["favoritedAt"])
    }

    func testOnlyPagesTheAIWroteOfferReportingFromTheirMenu() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"pages":[{"id":"ai","aiUpdatedAt":"2026-11-23T09:00:00.000Z"},{"id":"own","aiUpdatedAt":null},{"id":"old"}],"groups":[]}"#)
        let list = try await makeApi(server).notes()
        XCTAssertEqual(list.pages.map(\.aiUpdatedAt), ["2026-11-23T09:00:00.000Z", nil, nil])
        XCTAssertEqual(list.pages.map(notePageReportable), [true, false, false])
    }

    func testNoteIconsReadUploadedImagesAndKeepEmojiAsText() {
        let key = "upload:page-covers/user1/0e111e3a-9e25-4944-ade7-b460580fa921.png"
        XCTAssertEqual(NoteIcons.imagePath(key), "/api/pages/covers?key=page-covers%2Fuser1%2F0e111e3a-9e25-4944-ade7-b460580fa921.png")
        XCTAssertNil(NoteIcons.imagePath("📄"))
        XCTAssertNil(NoteIcons.imagePath("upload:page-covers/user1/../x.png"))
        XCTAssertNil(NoteIcons.text(key))
        XCTAssertEqual(NoteIcons.text("📄"), "📄")
    }

    func testRenamesPageAndDecodesCoverFields() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"pages":[{"id":"r","title":"Plan","cover":"gradient-ocean","coverPosition":40}]}"#)
        server.enqueue(#"{"page":{"id":"r","title":"Renamed plan","version":5,"cover":"gradient-ocean","coverPosition":40}}"#)
        let api = makeApi(server)
        let recent = try await api.recentNotes()
        XCTAssertEqual(recent[0].cover, "gradient-ocean")
        XCTAssertEqual(recent[0].coverPosition, 40)
        XCTAssertNotNil(NoteCovers.preset(recent[0].cover))
        XCTAssertEqual(
            NoteCovers.imagePath("upload:page-covers/user1/0e111e3a-9e25-4944-ade7-b460580fa921.png"),
            "/api/pages/covers?key=page-covers%2Fuser1%2F0e111e3a-9e25-4944-ade7-b460580fa921.png"
        )

        let written = try await api.renameNote(id: "r", title: "Renamed plan", version: 4)
        XCTAssertEqual(written.page.title, "Renamed plan")
        XCTAssertEqual(written.page.version, 5)
        XCTAssertEqual(JSONValue.parse(written.json ?? "")?["title"]?.stringValue, "Renamed plan")

        _ = server.next()
        let renameReq = server.next()
        XCTAssertEqual(renameReq.method, "PUT")
        XCTAssertEqual(renameReq.path, "/api/pages/r/title")
        XCTAssertEqual(renameReq.json?["title"]?.stringValue, "Renamed plan")
        XCTAssertEqual(renameReq.json?["version"]?.intValue, 4)
    }
}
