import Foundation
import XCTest
@testable import NoteFableCore

/// 页面类型（网页 src/lib/page-kinds.ts；Android `PageKindTest` 的移植）：服务端 JSON 的读法、旧服务端 / 不认识的值按笔记、
/// 各类型能用的功能，以及按类型决定的页面菜单和检索结果的类型名。
final class PageKindTests: XCTestCase {
    func testWireValuesMapToKindsAndAnythingElseIsANoteLikeTheWebPageKindOf() {
        XCTAssertEqual(PageKind.of("note"), .note)
        XCTAssertEqual(PageKind.of("whiteboard"), .whiteboard)
        XCTAssertEqual(PageKind.of("slides"), .slides)
        XCTAssertEqual(PageKind.of(nil), .note)
        XCTAssertEqual(PageKind.of("mindmap"), .note)
        XCTAssertEqual(PageKind.of("Whiteboard"), .note)
        XCTAssertFalse(PageKind.note.isCanvas)
        XCTAssertTrue(PageKind.whiteboard.isCanvas)
        XCTAssertTrue(PageKind.slides.isCanvas)
        XCTAssertEqual(PageKind.allCases.map(\.wire), ["note", "whiteboard", "slides"])
    }

    func testFeaturesFollowTheWebFeatureTableAndSlidesHaveAnEditorAndAPublicPresentation() throws {
        // 表は服務端の kinds / 安装包の page-kinds.json（網頁 PAGE_KIND_FEATURES から生成）から読む。
        PageKindTable.shared.loadBundled(try TextTestSupport.androidAsset("page-kinds.json"))
        defer { PageKindTable.shared.reset() }
        XCTAssertEqual(
            PageKind.note.features,
            PageKindFeatures(editor: true, markdownExport: true, typography: true, publicShare: true, aiEdit: true)
        )
        XCTAssertEqual(PageKind.whiteboard.features, PageKindFeatures(editor: false, markdownExport: false, typography: false, publicShare: false, aiEdit: false))
        XCTAssertEqual(PageKind.slides.features, PageKindFeatures(editor: true, markdownExport: false, typography: false, publicShare: true, aiEdit: false))
    }

    func testPageListsReadTheKindAndTreatMissingNullUnknownAndMalformedKindsAsNotes() async throws {
        let body = #"""
        {"pages":[
            {"id":"n","title":"Note","kind":"note"},
            {"id":"w","title":"Board","kind":"whiteboard"},
            {"id":"s","title":"Deck","kind":"slides"},
            {"id":"old","title":"Old server"},
            {"id":"null","title":"Null","kind":null},
            {"id":"future","title":"Future","kind":"mindmap"},
            {"id":"number","title":"Number","kind":3},
            {"id":"object","title":"Object","kind":{"type":"slides"}}
        ],"groups":[]}
        """#
        let server = FakeTransport()
        server.enqueue(body)
        server.enqueue(body)
        let api = makeApi(server)
        let expected: [PageKind] = [.note, .whiteboard, .slides, .note, .note, .note, .note, .note]
        let pages = try await api.notes().pages
        XCTAssertEqual(pages.map(\.kind), expected)
        XCTAssertEqual(pages.map(\.title).last, "Object")
        XCTAssertEqual(server.next().path, "/api/pages")
        let recent = try await api.recentNotes()
        XCTAssertEqual(recent.map(\.kind), expected)
        XCTAssertEqual(server.next().path, "/api/pages?recent=1")
    }

    func testTrashItemsReadTheirKindAndDefaultToNote() async throws {
        let server = FakeTransport()
        server.enqueue(#"""
        {"pages":[
            {"id":"t1","kind":"whiteboard","title":"Board","icon":null,"deletedAt":"2026-11-14T00:00:00.000Z","purgeAt":"2026-12-14T00:00:00.000Z"},
            {"id":"t2","kind":"slides","title":"Deck","icon":null,"deletedAt":"2026-11-14T00:00:00.000Z","purgeAt":"2026-12-14T00:00:00.000Z"},
            {"id":"t3","title":"Old","icon":null,"deletedAt":"2026-11-14T00:00:00.000Z","purgeAt":"2026-12-14T00:00:00.000Z"},
            {"id":"t4","kind":"timeline","title":"Future","icon":null,"deletedAt":"2026-11-14T00:00:00.000Z","purgeAt":"2026-12-14T00:00:00.000Z"}
        ]}
        """#)
        let trash = try await makeApi(server).trash()
        XCTAssertEqual(trash.map(\.kind), [.whiteboard, .slides, .note, .note])
    }

    func testSearchResultsReadPageKindNotTheResultKind() async throws {
        let server = FakeTransport()
        server.enqueue(#"""
        {"query":"x","notes":[
            {"kind":"note","pageKind":"slides","id":"s","title":"Deck","icon":null,"snippet":"x","blockId":"slide-2","updatedAt":""},
            {"kind":"note","pageKind":"whiteboard","id":"w","title":"Board","icon":null,"snippet":"","blockId":null,"updatedAt":""},
            {"kind":"note","id":"old","title":"Old server","icon":null,"snippet":"","blockId":null,"updatedAt":""},
            {"kind":"note","pageKind":"timeline","id":"future","title":"Future","icon":null,"snippet":"","blockId":null,"updatedAt":""}
        ],"chats":[]}
        """#)
        let notes = try await SearchApi(http: makeApi(server).http).search(query: "x", scope: .notes, projectId: nil, kind: nil).notes
        XCTAssertEqual(notes.map(\.pageKind), [.slides, .whiteboard, .note, .note])
        XCTAssertEqual(notes.first?.blockId, "slide-2")
    }

    func testAttachedPagesAndProjectReferenceNotesCarryTheirKind() async throws {
        let server = FakeTransport()
        server.enqueue(#"""
        {"messages":[{"id":"m","role":"USER","content":"hi","pages":[
            {"id":"w","kind":"whiteboard","title":"Board","icon":null},
            {"id":"n","title":"Old server","icon":"📘"}
        ]}]}
        """#)
        server.enqueue(#"""
        {"project":{"id":"p","name":"P","instructions":null,"notes":[
            {"id":"s","kind":"slides","title":"Deck","icon":null},
            {"id":"n","title":"Old server","icon":null}
        ]}}
        """#)
        let api = makeApi(server)
        let messages = try await api.messages(sessionId: "c")
        XCTAssertEqual(messages.first?.pages.map(\.kind), [.whiteboard, .note])
        let project = try await ProjectsApi(http: api.http).projectDetail(id: "p")
        XCTAssertEqual(project.notes.map(\.kind), [.slides, .note])
    }

    func testListPagesKeepTheirKindWhenAttachedOrPickedAsReferenceNotes() {
        let page = NotePageSummary(id: "w", title: "Board", icon: "🎨", kind: .whiteboard)
        XCTAssertEqual(ChatProjectNote(page: page), ChatProjectNote(id: "w", title: "Board", icon: "🎨", kind: .whiteboard))
        XCTAssertEqual(OpenNote(page: page), OpenNote("w", "Board", "🎨", kind: .whiteboard))
    }

    func testKindsAreWrittenBackWithTheirWireValue() throws {
        // 页面菜单把一览项交给网页（notefableEmbed.pageSettings）时也带着类型。
        let json = NoteFableJson.encodeToString(NotePageSummary(id: "w", title: "Board", kind: .whiteboard))
        XCTAssertTrue(json.contains(#""kind":"whiteboard""#), json)
        XCTAssertEqual(try NoteFableJson.decodeFromString(NotePageSummary.self, json).kind, .whiteboard)
    }

    func testTheEditorsReadyMessageMayCarryThePageKind() {
        XCTAssertEqual(
            EmbedMessage.parse(#"{"type":"ready","page":{"id":"p","title":"Board","icon":null,"kind":"whiteboard"}}"#),
            .ready(id: "p", title: "Board", icon: nil, kind: .whiteboard)
        )
        // 旧网页不发：nil（App 保留已知的类型）；不认识的值按笔记；不是字符串时当作没发，消息本身照常收下。
        XCTAssertEqual(
            EmbedMessage.parse(#"{"type":"ready","page":{"id":"p","title":"T","icon":null}}"#),
            .ready(id: "p", title: "T", icon: nil, kind: nil)
        )
        XCTAssertEqual(
            EmbedMessage.parse(#"{"type":"ready","page":{"id":"p","title":"T","icon":null,"kind":"mindmap"}}"#),
            .ready(id: "p", title: "T", icon: nil, kind: .note)
        )
        XCTAssertEqual(
            EmbedMessage.parse(#"{"type":"ready","page":{"id":"p","title":"T","icon":null,"kind":{"x":1}}}"#),
            .ready(id: "p", title: "T", icon: nil, kind: nil)
        )
        for raw in ["null", "3", "true"] {
            XCTAssertEqual(
                EmbedMessage.parse(#"{"type":"ready","page":{"id":"p","title":"T","icon":null,"kind":"# + raw + "}}"),
                .ready(id: "p", title: "T", icon: nil, kind: nil),
                raw
            )
        }
    }

    func testThePageMenuOffersOnlyTheLockToggleForWhiteboardsAndSlides() {
        // 网页 note-page-menu.tsx：Style、Small text、Full width 只给笔记（features.typography），Lock page 所有类型都有。
        XCTAssertEqual(NotePageToggle.visible(for: .note), [.smallText, .fullWidth, .locked])
        XCTAssertEqual(NotePageToggle.visible(for: .whiteboard), [.locked])
        XCTAssertEqual(NotePageToggle.visible(for: .slides), [.locked])
    }

    func testSearchLabelsWhiteboardsAndSlidesButNotNotesOrChats() {
        XCTAssertEqual(SearchHit.note(NoteSearchResult(id: "w", pageKind: .whiteboard)).kindLabel, "page_kind_whiteboard")
        XCTAssertEqual(SearchHit.note(NoteSearchResult(id: "s", pageKind: .slides)).kindLabel, "page_kind_slides")
        XCTAssertNil(SearchHit.note(NoteSearchResult(id: "n")).kindLabel)
        XCTAssertNil(SearchHit.chat(ChatSearchResult(id: "c")).kindLabel)
        // 图标按类型画：笔记结果带类型，聊天没有。
        XCTAssertEqual(SearchHit.note(NoteSearchResult(id: "s", pageKind: .slides)).pageKind, .slides)
        XCTAssertNil(SearchHit.chat(ChatSearchResult(id: "c")).pageKind)
        XCTAssertEqual(PageKind.allCases.map { pageKindLabel($0) }, ["page_kind_note", "page_kind_whiteboard", "page_kind_slides"])
    }
}
