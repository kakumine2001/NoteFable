import Foundation
import XCTest
#if canImport(CoreGraphics)
import CoreGraphics
#endif
@testable import NoteFableCore

/// 工作区的分区与新建（#168；网页 src/lib/workspace-sections.ts、page-kinds.ts，Android `NotesViewModelTest` / `PageKindTest` /
/// `ReorderDragTest` 里对应的几条）：服务端的类型开关表、分区、按类型和项目新建、拖动只能进同一分区。
final class WorkspaceSectionsTests: XCTestCase {
    private let allOn = #"{"note":{"editor":true,"markdownExport":true,"typography":true,"publicShare":true,"aiEdit":true},"whiteboard":{"editor":true,"publicShare":true,"future":1},"slides":{"editor":true},"mindmap":{"editor":true}}"#

    override func tearDown() {
        PageKindTable.shared.reset()
        super.tearDown()
    }

    func testTheServerKindsTableSwitchesKindsOnInSectionOrderAndBadTablesAreIgnored() throws {
        XCTAssertEqual(PageKindTable.creatable(in: PageKindTable.shared.snapshot), [.note])
        let table = try XCTUnwrap(PageKindTable.parse(try XCTUnwrap(JSONValue.parse(allOn))))
        XCTAssertEqual(PageKindTable.creatable(in: table), [.note, .slides, .whiteboard])
        XCTAssertTrue(PageKindTable.features(.whiteboard, in: table).publicShare)
        XCTAssertFalse(PageKindTable.features(.slides, in: table).markdownExport)
        // 不是对象的表不动；表里缺了笔记也照样能用笔记。
        XCTAssertNil(PageKindTable.parse(.string("x")))
        let notesMissing = try XCTUnwrap(PageKindTable.parse(try XCTUnwrap(JSONValue.parse(#"{"slides":{"editor":true}}"#))))
        XCTAssertEqual(PageKindTable.creatable(in: notesMissing), [.note, .slides])
        XCTAssertTrue(PageKindTable.features(.note, in: notesMissing).markdownExport)
        // 全局的表（页面菜单等）也跟着换。
        PageKindTable.shared.update(table)
        XCTAssertTrue(PageKind.whiteboard.features.editor)
    }

    func testPageListsCarryTheKindsTableAndOldServersOrBrokenTablesKeepTheList() throws {
        let decoder = JSONDecoder()
        let list = try decoder.decode(NotesList.self, from: Data(#"{"pages":[{"id":"a","title":"A"}],"groups":[],"kinds":\#(allOn)}"#.utf8))
        XCTAssertEqual(list.pages.map(\.id), ["a"])
        XCTAssertEqual(list.kinds.map { PageKindTable.creatable(in: $0) }, [.note, .slides, .whiteboard])
        XCTAssertNil(try decoder.decode(NotesList.self, from: Data(#"{"pages":[],"groups":[]}"#.utf8)).kinds)
        let broken = try decoder.decode(NotesList.self, from: Data(#"{"pages":[{"id":"a","title":"A"}],"groups":[],"kinds":"x"}"#.utf8))
        XCTAssertEqual(broken.pages.map(\.id), ["a"])
        XCTAssertNil(broken.kinds)
    }

    func testTheBundledPageKindsJsonIsTheWebTable() throws {
        let data = try TextTestSupport.androidAsset("page-kinds.json")
        let table = try XCTUnwrap(PageKindTable.parse(try XCTUnwrap(JSONValue.parse(data))))
        // 网页现在的表：编辑器上线前只有笔记能新建。
        XCTAssertEqual(PageKindTable.creatable(in: table).first, .note)
        XCTAssertEqual(table[.note], .note)
    }

    func testPagesOutsideProjectsAreSplitIntoSectionsOnceThoseKindsCanBeCreated() throws {
        var state = NotesUiState()
        state.groups = [NoteGroupSummary(id: "g1", name: "Biology")]
        var board = NotePageSummary(id: "w", title: "Board", icon: nil, createdAt: "2026-11-13T00:00:00Z")
        board.kind = .whiteboard
        var deck = NotePageSummary(id: "s", title: "Deck", icon: nil, createdAt: "2026-11-12T00:00:00Z")
        deck.kind = .slides
        var child = NotePageSummary(id: "child", title: "Sub board", icon: nil, createdAt: "2026-11-11T00:00:00Z", parentId: "b")
        child.kind = .whiteboard
        state.pages = [
            NotePageSummary(id: "a", title: "Cell", icon: nil, groupId: "g1", createdAt: "2026-11-14T00:00:01Z"),
            NotePageSummary(id: "b", title: "Verbs", icon: nil, createdAt: "2026-11-14T00:00:00Z"),
            board, deck, child,
        ]
        state.kindFeatures = PageKindTable.fallback
        // 开关关着：只有笔记的分区，白板和幻灯片的页面也放在里面（不会看不到）。
        XCTAssertEqual(state.sections.map(\.kind), [.note])
        XCTAssertEqual(state.sections.first?.roots.map(\.id), ["b", "w", "s"])
        state.kindFeatures = try XCTUnwrap(PageKindTable.parse(try XCTUnwrap(JSONValue.parse(allOn))))
        XCTAssertEqual(state.sections.map(\.kind), [.note, .slides, .whiteboard])
        // 子页面跟着父页面，数量含子页面；项目里的页面不在分区里。
        XCTAssertEqual(state.sections.map { $0.roots.map(\.id) }, [["b"], ["s"], ["w"]])
        XCTAssertEqual(state.sections.map(\.count), [2, 1, 1])
        XCTAssertEqual(state.sectionKind(of: child), .whiteboard)
    }

    @MainActor
    func testNewPagesOfAnyKindGoIntoTheChosenProjectOrSectionWhichOpensIfFolded() async throws {
        PageKindTable.shared.update(try XCTUnwrap(PageKindTable.parse(try XCTUnwrap(JSONValue.parse(allOn)))))
        let backend = NotesTestBackend()
        let prefs = MemoryNotesPrefs(collapsedGroups: ["g1"], collapsedSections: ["slides"])
        let vm = NotesViewModel(backend: backend, prefs: prefs)
        vm.setWorkspace(.notes)
        await notesSettle()
        XCTAssertEqual(vm.state.collapsedSections, [.slides])
        vm.createNote(kind: .whiteboard, groupId: "g1")
        await notesSettle()
        XCTAssertEqual(backend.calls.last, "create:whiteboard@g1")
        XCTAssertEqual(vm.state.pages.first { $0.id == "new" }?.groupId, "g1")
        XCTAssertFalse(vm.state.collapsed.contains("g1"))
        vm.createNote(kind: .slides)
        await notesSettle()
        XCTAssertEqual(backend.calls.last, "create:slides")
        XCTAssertTrue(vm.state.collapsedSections.isEmpty)
        XCTAssertTrue(prefs.collapsedSections.isEmpty)
        // 子页面的项目随父页面，不发 groupId。
        vm.createNote(parentId: "b", kind: .slides, groupId: "g1")
        await notesSettle()
        XCTAssertEqual(backend.calls.last, "create:b:slides")
    }

    @MainActor
    func testSectionsFoldAndTheChoiceIsKeptOnTheDevice() async {
        let prefs = MemoryNotesPrefs()
        let vm = NotesViewModel(backend: NotesTestBackend(), prefs: prefs)
        vm.toggleSection(.note)
        XCTAssertEqual(vm.state.collapsedSections, [.note])
        XCTAssertEqual(prefs.collapsedSections, ["note"])
        vm.toggleSection(.note)
        XCTAssertTrue(vm.state.collapsedSections.isEmpty)
        // 换身份（登录 / 退出）时折叠状态是这台设备的，保留（和项目的折叠一样）。
        vm.toggleSection(.slides)
        vm.onIdentityChanged()
        XCTAssertEqual(vm.state.collapsedSections, [.slides])
    }

    func testAPageGoesOnlyIntoItsOwnSectionButIntoAnyProjectOrSubPageList() {
        let zones: [String: CGRect] = [
            "g1": CGRect(x: 0, y: 0, width: 100, height: 40), "section:note": CGRect(x: 0, y: 50, width: 100, height: 40),
            "": CGRect(x: 0, y: 300, width: 100, height: 40),
        ]
        let rows: [String: CGRect] = [
            "n1": CGRect(x: 0, y: 100, width: 100, height: 40), "w1": CGRect(x: 0, y: 150, width: 100, height: 40),
            "child": CGRect(x: 0, y: 200, width: 100, height: 40),
        ]
        func at(_ y: CGFloat, _ dragging: String, _ tag: String) -> DropTarget? {
            dropTargetAt(CGPoint(x: 50, y: y), dragging: dragging, zones: zones, rows: rows, zoneContainers: ["section:note": nil],
                         zoneAccepts: ["section:note": "note"], rowAccepts: ["n1": "note", "w1": "whiteboard"], tag: tag)
        }
        // 分区标题 = 移出项目（无项目）。
        XCTAssertEqual(at(70, "w2", "note"), .into(containerId: nil))
        XCTAssertNil(at(70, "w2", "whiteboard"))
        // 分区里最上层的行：同一分区才能放在前后。
        XCTAssertEqual(at(110, "n2", "note"), .row(id: "n1", after: false))
        XCTAssertNil(at(110, "w2", "whiteboard"))
        XCTAssertEqual(at(185, "w2", "whiteboard"), .row(id: "w1", after: true))
        // 项目、子页面的行、首页标题什么都接受。
        XCTAssertEqual(at(20, "w2", "whiteboard"), .into(containerId: "g1"))
        XCTAssertEqual(at(205, "w2", "whiteboard"), .row(id: "child", after: false))
        XCTAssertEqual(at(320, "w2", "whiteboard"), .into(containerId: nil))
    }

    func testTheNoteListDropRulesComeFromTheSections() throws {
        var state = NotesUiState()
        var board = NotePageSummary(id: "w", title: "Board", icon: nil, createdAt: "2026-11-13T00:00:00Z")
        board.kind = .whiteboard
        state.pages = [NotePageSummary(id: "b", title: "Verbs", icon: nil, createdAt: "2026-11-14T00:00:00Z"), board]
        state.kindFeatures = try XCTUnwrap(PageKindTable.parse(try XCTUnwrap(JSONValue.parse(allOn))))
        let rules = noteDropRules(state)
        XCTAssertEqual(rules.zoneAccepts[noteSectionZone(.whiteboard)], "whiteboard")
        XCTAssertEqual(rules.zoneContainers[noteSectionZone(.slides)], .some(nil))
        XCTAssertEqual(rules.rowAccepts, ["b": "note", "w": "whiteboard"])
        XCTAssertEqual(rules.tag("w"), "whiteboard")
        XCTAssertNil(rules.tag("missing"))
    }
}
