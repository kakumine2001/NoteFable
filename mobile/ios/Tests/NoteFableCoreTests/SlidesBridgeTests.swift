import XCTest
@testable import NoteFableCore

// 幻灯片的桥（放映、导出文件的保存；src/lib/native-bridge.ts、Android PageKindTest 的同名用例）。
final class SlidesBridgeTests: XCTestCase {
    func testParsesThePresentationAndFileMessages() {
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"presentation","state":"start","index":2,"count":9}"#), .presentation(state: "start", index: 2, count: 9))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"presentation","state":"spin"}"#))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileStart","id":"f1","name":"Deck.pdf","mime":"application/pdf","size":12}"#), .fileStart(id: "f1", name: "Deck.pdf", mime: "application/pdf", size: 12))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileChunk","id":"f1","index":0,"data":"AAEC"}"#), .fileChunk(id: "f1", index: 0, data: "AAEC"))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileEnd","id":"f1"}"#), .fileEnd(id: "f1"))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileAbort","id":"f1"}"#), .fileAbort(id: "f1"))
        XCTAssertNil(EmbedMessage.parse(#"{"type":"fileStart","id":"f1","name":""}"#))
    }

    func testTheBootstrapDeclaresPresentationAndFileSaving() {
        let script = NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en")
        XCTAssertTrue(script.contains("canPresent:function(){return true}"))
        XCTAssertTrue(script.contains("canSaveFile:function(){return true}"))
        XCTAssertEqual(NoteEmbedScripts.slides(#"{"action":"end"}"#), #"(function(){var e=window.notefableEmbed;if(e&&typeof e.slides==='function')e.slides("{\"action\":\"end\"}")})()"#)
    }

    func testAssemblesChunksInOrderAndDropsBrokenFiles() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("slides-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let assembler = ExportFileAssembler(directory: directory)
        assembler.start(id: "a", name: "Q3/review.pdf", mime: "application/pdf")
        assembler.append(id: "a", index: 0, base64: Data([1, 2, 3]).base64EncodedString())
        assembler.append(id: "a", index: 1, base64: Data([4]).base64EncodedString())
        let ready = try XCTUnwrap(assembler.finish(id: "a"))
        XCTAssertEqual(ready.name, "Q3 review.pdf")
        XCTAssertEqual(ready.mime, "application/pdf")
        XCTAssertEqual(try Data(contentsOf: ready.url), Data([1, 2, 3, 4]))

        // 顺序不对就放弃（不交出一半的文件）。
        assembler.start(id: "b", name: "x.png", mime: "image/png")
        assembler.append(id: "b", index: 1, base64: "AA==")
        XCTAssertNil(assembler.finish(id: "b"))
    }

    @MainActor
    func testTheViewModelTracksThePresentationOfTheOpenEditor() async {
        let backend = NotesTestBackend()
        let vm = NotesViewModel(backend: backend)
        vm.setWorkspace(.notes)
        await notesSettle()
        vm.openNote("a")
        await notesSettle()
        let editor = NotesTestEditor()
        let bridge = NoteEmbedBridge { vm.onEditorMessage("a", $0) }
        bridge.attach(editor)
        vm.registerEditor(bridge)

        // 別的编辑器晚到的消息不收。
        vm.onEditorMessage("b", .presentation(state: "start", index: 0, count: 3))
        XCTAssertFalse(vm.state.presenting)
        bridge.postMessage(#"{"type":"presentation","state":"start","index":0,"count":3}"#)
        XCTAssertTrue(vm.state.presenting)
        vm.slidesCommand(#"{"action":"end"}"#)
        XCTAssertEqual(editor.calls.last, #"slides:{"action":"end"}"#)
        bridge.postMessage(#"{"type":"presentation","state":"end","index":0,"count":3}"#)
        XCTAssertFalse(vm.state.presenting)

        bridge.postMessage(#"{"type":"presentation","state":"start","index":0,"count":3}"#)
        vm.registerEditor(nil)
        XCTAssertFalse(vm.state.presenting)
    }
}
