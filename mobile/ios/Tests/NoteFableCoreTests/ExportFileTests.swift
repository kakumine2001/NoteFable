import Foundation
import XCTest
@testable import NoteFableCore

/// 编辑器导出的文件（网页 src/lib/export-file.ts 分块送来，src/lib/native-bridge.ts 的 fileStart / fileChunk / fileEnd / fileAbort）：
/// 桥消息的读法、拼临时文件、文件名的整理，以及 NotesViewModel 收下、交给界面、用完删掉。
final class ExportFileTests: XCTestCase {
    private func makeRoot() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nf-export-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }

    /// 和网页一样按 [size] 字节切开，各自 base64。
    private func chunks(_ bytes: Data, size: Int) -> [String] {
        stride(from: 0, to: bytes.count, by: size).map { bytes.subdata(in: $0..<min($0 + size, bytes.count)).base64EncodedString() }
    }

    private func base64(_ bytes: [UInt8]) -> String {
        Data(bytes).base64EncodedString()
    }

    /// [root] 里的子目录（每个文件一个）。
    private func folders(_ root: URL) -> [String] {
        (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
    }

    private func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    private func assertFailure(
        _ expected: ExportFileAssembler.Failure, file: StaticString = #filePath, line: UInt = #line, _ run: () throws -> Void
    ) {
        XCTAssertThrowsError(try run(), file: file, line: line) { error in
            XCTAssertEqual(error as? ExportFileAssembler.Failure, expected, file: file, line: line)
        }
    }

    // ---- 桥消息 ----

    func testTheFileMessagesParseAndMalformedOnesAreIgnored() {
        XCTAssertEqual(
            EmbedMessage.parse(#"{"type":"fileStart","id":"f1","name":"Board.png","mime":"image/png","size":1024}"#),
            .fileStart(id: "f1", name: "Board.png", mime: "image/png", size: 1024)
        )
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileChunk","id":"f1","index":0,"data":"AAEC"}"#), .fileChunk(id: "f1", index: 0, data: "AAEC"))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileEnd","id":"f1"}"#), .fileEnd(id: "f1"))
        XCTAssertEqual(EmbedMessage.parse(#"{"type":"fileAbort","id":"f1"}"#), .fileAbort(id: "f1"))
        // 空文件（没有块）也是合法的开始。
        XCTAssertEqual(
            EmbedMessage.parse(#"{"type":"fileStart","id":"f2","name":"","mime":"application/pdf","size":0}"#),
            .fileStart(id: "f2", name: "", mime: "application/pdf", size: 0)
        )
        for malformed in [
            #"{"type":"fileStart","name":"a.png","mime":"image/png","size":1}"#,
            #"{"type":"fileStart","id":"","name":"a.png","mime":"image/png","size":1}"#,
            #"{"type":"fileStart","id":{"x":1},"name":"a.png","mime":"image/png","size":1}"#,
            #"{"type":"fileStart","id":"f","mime":"image/png","size":1}"#,
            #"{"type":"fileStart","id":"f","name":"a.png","size":1}"#,
            #"{"type":"fileStart","id":"f","name":"a.png","mime":"image/png"}"#,
            #"{"type":"fileStart","id":"f","name":"a.png","mime":"image/png","size":-1}"#,
            #"{"type":"fileStart","id":"f","name":"a.png","mime":"image/png","size":1.5}"#,
            #"{"type":"fileStart","id":"f","name":"a.png","mime":"image/png","size":"1"}"#,
            #"{"type":"fileChunk","index":0,"data":"AA=="}"#,
            #"{"type":"fileChunk","id":"f","data":"AA=="}"#,
            #"{"type":"fileChunk","id":"f","index":-1,"data":"AA=="}"#,
            #"{"type":"fileChunk","id":"f","index":0.5,"data":"AA=="}"#,
            #"{"type":"fileChunk","id":"f","index":0}"#,
            #"{"type":"fileChunk","id":"f","index":0,"data":12}"#,
            #"{"type":"fileEnd"}"#,
            #"{"type":"fileEnd","id":""}"#,
            #"{"type":"fileAbort","id":["f"]}"#,
        ] {
            XCTAssertNil(EmbedMessage.parse(malformed), malformed)
        }
    }

    func testTheAppTellsThePageItCanSaveFiles() {
        // 没有 canSaveFile() 的旧 App，网页不送文件、提示先更新 App（src/lib/export-file.ts 的 unsupported）。
        XCTAssertTrue(NoteEmbedScripts.bootstrap(handler: "h", appIcon: nil, language: "en").contains("canSaveFile:function(){return true}"))
    }

    // ---- 拼文件 ----

    func testChunksAreWrittenInOrderToATemporaryFileThatStaysUntilDiscarded() throws {
        let root = makeRoot()
        let assembler = ExportFileAssembler(directory: root)
        let bytes = Data((0..<10).map { UInt8($0) })
        try assembler.start(id: "f1", name: "Board.png", mime: "image/png", size: bytes.count)
        XCTAssertEqual(assembler.receivingId, "f1")
        for (index, data) in chunks(bytes, size: 4).enumerated() {
            try assembler.append(id: "f1", index: index, data: data)
        }
        let file = try XCTUnwrap(assembler.finish(id: "f1"))
        XCTAssertNil(assembler.receivingId)
        XCTAssertEqual(file.name, "Board.png")
        XCTAssertEqual(file.mime, "image/png")
        XCTAssertEqual(file.fileExtension, "png")
        XCTAssertEqual(file.baseName, "Board")
        // 每个文件在目录里自己的子目录，文件名就是给用户看的名字。
        XCTAssertEqual(file.url.lastPathComponent, "Board.png")
        XCTAssertEqual(file.url.deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL.path, root.standardizedFileURL.path)
        XCTAssertEqual(try Data(contentsOf: file.url), bytes)

        assembler.discard(file)
        XCTAssertFalse(exists(file.url))
        XCTAssertEqual(folders(root), [])

        // 空文件：没有块，直接结束。
        try assembler.start(id: "e", name: "Empty", mime: "application/pdf", size: 0)
        let empty = try XCTUnwrap(assembler.finish(id: "e"))
        XCTAssertEqual(empty.name, "Empty.pdf")
        XCTAssertEqual(try Data(contentsOf: empty.url), Data())
    }

    func testAChunkOutOfOrderNotBase64OrPastTheDeclaredSizeDropsTheFile() throws {
        let root = makeRoot()
        let assembler = ExportFileAssembler(directory: root)

        // 漏了一块。
        try assembler.start(id: "a", name: "a", mime: "image/png", size: 8)
        try assembler.append(id: "a", index: 0, data: base64([1, 2]))
        assertFailure(.outOfOrder) { try assembler.append(id: "a", index: 2, data: self.base64([3])) }
        XCTAssertNil(assembler.receivingId)
        XCTAssertEqual(folders(root), [])
        // 作废以后同一个 id 的块和结束都不理。
        XCTAssertNoThrow(try assembler.append(id: "a", index: 1, data: base64([3])))
        XCTAssertNil(try assembler.finish(id: "a"))

        // 同一块送了两次。
        try assembler.start(id: "b", name: "b", mime: "image/png", size: 8)
        try assembler.append(id: "b", index: 0, data: base64([1]))
        assertFailure(.outOfOrder) { try assembler.append(id: "b", index: 0, data: self.base64([1])) }

        // 不是 base64。
        try assembler.start(id: "c", name: "c", mime: "image/png", size: 8)
        assertFailure(.badData) { try assembler.append(id: "c", index: 0, data: "not base64!") }

        // 比声明的多。
        try assembler.start(id: "d", name: "d", mime: "image/png", size: 2)
        assertFailure(.tooLarge) { try assembler.append(id: "d", index: 0, data: self.base64([1, 2, 3])) }

        // 结束时比声明的少。
        try assembler.start(id: "e", name: "e", mime: "image/png", size: 4)
        try assembler.append(id: "e", index: 0, data: base64([1, 2]))
        assertFailure(.incomplete) { _ = try assembler.finish(id: "e") }
        XCTAssertNil(assembler.receivingId)
        XCTAssertEqual(folders(root), [])
    }

    func testOnlyTheWhiteboardAndSlideTypesUpTo64MiBAreAccepted() throws {
        let root = makeRoot()
        let assembler = ExportFileAssembler(directory: root)
        assertFailure(.unsupportedType) { try assembler.start(id: "x", name: "x.exe", mime: "application/octet-stream", size: 1) }
        assertFailure(.unsupportedType) { try assembler.start(id: "x", name: "x.html", mime: "text/html", size: 1) }
        assertFailure(.unsupportedType) { try assembler.start(id: "x", name: "x", mime: "", size: 1) }
        assertFailure(.tooLarge) {
            try assembler.start(id: "x", name: "x.png", mime: "image/png", size: ExportFileAssembler.MAX_BYTES + 1)
        }
        XCTAssertNil(assembler.receivingId)
        XCTAssertEqual(folders(root), [])

        // 不分大小写、不看参数；正好 64 MiB 可以。
        try assembler.start(id: "s", name: "Board", mime: " Image/SVG+XML; charset=utf-8", size: ExportFileAssembler.MAX_BYTES)
        XCTAssertEqual(assembler.receivingId, "s")
        assembler.cancel()
        let pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        XCTAssertEqual(ExportFileTypes.normalized(pptx), pptx)
        XCTAssertEqual(ExportFileTypes.normalized("APPLICATION/PDF"), "application/pdf")
        XCTAssertNil(ExportFileTypes.normalized("image/jpeg"))
        // 幻灯片的多页 PNG 是 ZIP。
        XCTAssertEqual(ExportFileTypes.normalized("application/zip"), "application/zip")
        XCTAssertEqual(ExportFileAssembler.sanitizedName("Deck", mime: "application/zip"), "Deck.zip")
        try assembler.start(id: "p", name: "Deck", mime: pptx, size: 1)
        try assembler.append(id: "p", index: 0, data: base64([7]))
        let deck = try XCTUnwrap(assembler.finish(id: "p"))
        XCTAssertEqual(deck.name, "Deck.pptx")
        XCTAssertEqual(deck.mime, pptx)
        XCTAssertEqual(deck.baseName, "Deck")
    }

    func testAbortCancelAndANewStartDropTheUnfinishedFileWhileOtherIdsAreIgnored() throws {
        let root = makeRoot()
        let assembler = ExportFileAssembler(directory: root)
        try assembler.start(id: "a", name: "a", mime: "image/png", size: 4)
        try assembler.append(id: "a", index: 0, data: base64([1, 2]))
        // 别的 id：不理，也不打断正在收的。
        XCTAssertNoThrow(try assembler.append(id: "other", index: 5, data: "!!"))
        XCTAssertNil(try assembler.finish(id: "other"))
        assembler.abort(id: "other")
        XCTAssertEqual(assembler.receivingId, "a")
        XCTAssertEqual(folders(root).count, 1)
        // 网页放弃了：删掉写了一半的。
        assembler.abort(id: "a")
        XCTAssertNil(assembler.receivingId)
        XCTAssertEqual(folders(root), [])

        // 没收完就来了新的开始（网页中途出错、没送 fileAbort）：旧的作废，新的照常。
        try assembler.start(id: "b", name: "b", mime: "image/png", size: 2)
        try assembler.append(id: "b", index: 0, data: base64([1]))
        try assembler.start(id: "c", name: "c", mime: "image/png", size: 1)
        XCTAssertEqual(folders(root).count, 1)
        XCTAssertNil(try assembler.finish(id: "b"))
        try assembler.append(id: "c", index: 0, data: base64([9]))
        let file = try XCTUnwrap(assembler.finish(id: "c"))
        XCTAssertEqual(try Data(contentsOf: file.url), Data([9]))

        // 换了编辑器、换了身份：正在收的作废，收齐的不动（由 discard 删）。
        try assembler.start(id: "d", name: "d", mime: "image/png", size: 1)
        XCTAssertEqual(folders(root).count, 2)
        assembler.cancel()
        XCTAssertNil(assembler.receivingId)
        XCTAssertEqual(folders(root).count, 1)
        XCTAssertTrue(exists(file.url))

        // 只删自己目录里的。
        let elsewhere = makeRoot().appendingPathComponent("keep", isDirectory: true)
        try FileManager.default.createDirectory(at: elsewhere, withIntermediateDirectories: true)
        let kept = elsewhere.appendingPathComponent("Board.png")
        try Data([1]).write(to: kept)
        assembler.discard(ExportedFile(url: kept, name: "Board.png", mime: "image/png"))
        XCTAssertTrue(exists(kept))
    }

    func testFilesLeftByAnEarlierRunAreClearedOnTheFirstStartOnly() throws {
        let root = makeRoot()
        let stale = root.appendingPathComponent("earlier-run", isDirectory: true)
        try FileManager.default.createDirectory(at: stale, withIntermediateDirectories: true)
        try Data([1]).write(to: stale.appendingPathComponent("Board.png"))
        let assembler = ExportFileAssembler(directory: root)
        // 建的时候不碰磁盘。
        XCTAssertTrue(exists(stale))
        try assembler.start(id: "a", name: "a", mime: "image/png", size: 0)
        XCTAssertFalse(exists(stale))
        let first = try XCTUnwrap(assembler.finish(id: "a"))
        // 之后的开始不清：收齐的这个还在等着保存。
        try assembler.start(id: "b", name: "b", mime: "image/png", size: 0)
        XCTAssertTrue(exists(first.url))
    }

    func testNamesLoseSeparatorsAndControlsKeepTheRightExtensionAndFitTheLimits() {
        func name(_ raw: String, _ mime: String = "image/png") -> String {
            ExportFileAssembler.sanitizedName(raw, mime: mime)
        }
        XCTAssertEqual(name("Board.png"), "Board.png")
        XCTAssertEqual(name("Board.PNG"), "Board.png")
        XCTAssertEqual(name("Board"), "Board.png")
        XCTAssertEqual(name("Board.svg"), "Board.svg.png")
        XCTAssertEqual(name("report.final", "application/pdf"), "report.final.pdf")
        XCTAssertEqual(name("Deck", "application/vnd.openxmlformats-officedocument.presentationml.presentation"), "Deck.pptx")
        XCTAssertEqual(name("Mind map", "image/svg+xml"), "Mind map.svg")
        // 路径分隔符、控制字符、改变文字方向的字符去掉；空白并成一个空格。
        XCTAssertEqual(name("../../etc/passwd"), "etcpasswd.png")
        XCTAssertEqual(name(#"a\b:c/d.png"#), "abcd.png")
        XCTAssertEqual(name("Line\nbreak\tand\u{0}nul\u{7F}.png"), "Linebreakandnul.png")
        XCTAssertEqual(name("\u{202E}gnp.exe"), "gnp.exe.png")
        XCTAssertEqual(name("  many   spaces\u{3000}here  .png"), "many spaces here.png")
        // 不变成隐藏文件；什么都不剩时有个名字。
        XCTAssertEqual(name(".hidden.png"), "hidden.png")
        XCTAssertEqual(name(".png"), "NoteFable.png")
        XCTAssertEqual(name(" . . "), "NoteFable.png")
        XCTAssertEqual(name(""), "NoteFable.png")
        XCTAssertEqual(name("白板 🧬"), "白板 🧬.png")
        // 连扩展名 120 个字符，扩展名留着；截完不留结尾的空格。
        let long = name(String(repeating: "a", count: 200) + ".png")
        XCTAssertEqual(long.count, 120)
        XCTAssertEqual(long, String(repeating: "a", count: 116) + ".png")
        XCTAssertEqual(name(String(repeating: "a", count: 115) + " bcdef"), String(repeating: "a", count: 115) + ".png")
        // UTF-8 最多 255 字节，按整个字符截。
        let wide = name(String(repeating: "漢", count: 150))
        XCTAssertEqual(wide, String(repeating: "漢", count: 83) + ".png")
        XCTAssertLessThanOrEqual(wide.utf8.count, 255)
    }

    // ---- ViewModel ----

    @MainActor
    private func whiteboardVm(_ root: URL) async -> NotesViewModel {
        let backend = NotesTestBackend()
        backend.pages.append(NotePageSummary(id: "w", title: "Board", icon: nil, createdAt: "2026-11-13T00:00:00Z", kind: .whiteboard))
        let vm = NotesViewModel(backend: backend, exportFiles: ExportFileAssembler(directory: root))
        vm.setWorkspace(.notes)
        await notesSettle()
        vm.flushEditor = { FlushResult(true) }
        vm.openNote("w")
        await notesSettle()
        return vm
    }

    @MainActor
    func testTheViewModelHandsAFinishedFileToTheScreenAndDeletesItWhenTheSaveSheetIsDone() async throws {
        let root = makeRoot()
        let vm = await whiteboardVm(root)
        let bytes = Data(#"<svg xmlns="http://www.w3.org/2000/svg"/>"#.utf8)
        vm.onEditorMessage("w", .fileStart(id: "f1", name: "Board.svg", mime: "image/svg+xml", size: bytes.count))
        for (index, data) in chunks(bytes, size: 16).enumerated() {
            vm.onEditorMessage("w", .fileChunk(id: "f1", index: index, data: data))
        }
        XCTAssertNil(vm.state.exportFile)
        vm.onEditorMessage("w", .fileEnd(id: "f1"))
        let file = try XCTUnwrap(vm.state.exportFile)
        XCTAssertEqual(file.name, "Board.svg")
        XCTAssertEqual(file.mime, "image/svg+xml")
        XCTAssertEqual(try Data(contentsOf: file.url), bytes)
        XCTAssertFalse(vm.state.exportFileFailed)

        // 存好、取消或失败都一样：删掉临时文件。
        vm.finishExportFile(file)
        XCTAssertNil(vm.state.exportFile)
        XCTAssertFalse(exists(file.url))
        XCTAssertEqual(folders(root), [])
    }

    @MainActor
    func testASecondFileWhileTheSaveSheetIsOpenIsRefusedAndTheOpenOneKept() async throws {
        let root = makeRoot()
        let vm = await whiteboardVm(root)
        vm.onEditorMessage("w", .fileStart(id: "a", name: "A.png", mime: "image/png", size: 0))
        vm.onEditorMessage("w", .fileEnd(id: "a"))
        let first = try XCTUnwrap(vm.state.exportFile)

        // 保存窗口开着时第二个到了：第二个不存并提示，开着的第一个不删。
        vm.onEditorMessage("w", .fileStart(id: "b", name: "B.png", mime: "image/png", size: 0))
        vm.onEditorMessage("w", .fileEnd(id: "b"))
        XCTAssertEqual(vm.state.exportFile, first)
        XCTAssertTrue(exists(first.url))
        XCTAssertTrue(vm.state.exportFileFailed)
        XCTAssertEqual(folders(root).count, 1)
        vm.finishExportFile(first)
        XCTAssertEqual(folders(root), [])
    }

    @MainActor
    func testAWebProcessCrashDropsTheUnfinishedFile() async {
        let root = makeRoot()
        let vm = await whiteboardVm(root)
        vm.onEditorMessage("w", .fileStart(id: "f", name: "f", mime: "image/png", size: 4))
        vm.onEditorMessage("w", .fileChunk(id: "f", index: 0, data: base64([1, 2])))
        XCTAssertEqual(folders(root).count, 1)
        // 别的编辑器来的通知什么也不做。
        vm.cancelExportTransfer(editor: "other")
        XCTAssertEqual(folders(root).count, 1)
        vm.cancelExportTransfer(editor: "w")
        XCTAssertEqual(folders(root), [])
        // 作废之后剩下的块和结束什么也不做。
        vm.onEditorMessage("w", .fileChunk(id: "f", index: 1, data: base64([3, 4])))
        vm.onEditorMessage("w", .fileEnd(id: "f"))
        XCTAssertNil(vm.state.exportFile)
    }

    @MainActor
    func testAFileThatCannotBeTakenIsReportedOnceAndTheEditorsOwnAbortIsNot() async {
        let root = makeRoot()
        let vm = await whiteboardVm(root)

        // 类型不对：提示一次，后面的块和结束不再提示。
        vm.onEditorMessage("w", .fileStart(id: "x", name: "x.html", mime: "text/html", size: 3))
        XCTAssertTrue(vm.state.exportFileFailed)
        vm.dismissExportFileFailure()
        vm.onEditorMessage("w", .fileChunk(id: "x", index: 0, data: "AAAA"))
        vm.onEditorMessage("w", .fileEnd(id: "x"))
        XCTAssertFalse(vm.state.exportFileFailed)
        XCTAssertNil(vm.state.exportFile)

        // 缺了块。
        vm.onEditorMessage("w", .fileStart(id: "y", name: "y", mime: "image/png", size: 4))
        vm.onEditorMessage("w", .fileChunk(id: "y", index: 0, data: base64([1, 2])))
        vm.onEditorMessage("w", .fileEnd(id: "y"))
        XCTAssertTrue(vm.state.exportFileFailed)
        XCTAssertNil(vm.state.exportFile)
        vm.dismissExportFileFailure()
        XCTAssertFalse(vm.state.exportFileFailed)

        // 网页自己放弃（它在编辑器里说明原因）：不提示。
        vm.onEditorMessage("w", .fileStart(id: "z", name: "z", mime: "image/png", size: 4))
        vm.onEditorMessage("w", .fileAbort(id: "z"))
        vm.onEditorMessage("w", .fileEnd(id: "z"))
        XCTAssertFalse(vm.state.exportFileFailed)
        XCTAssertNil(vm.state.exportFile)

        // 已经换掉的编辑器发来的不收。
        vm.onEditorMessage("other", .fileStart(id: "o", name: "o", mime: "image/png", size: 0))
        vm.onEditorMessage("other", .fileEnd(id: "o"))
        XCTAssertNil(vm.state.exportFile)
        XCTAssertEqual(folders(root), [])

        // drawing 收下，什么也不变（iOS 在白板页一直关着边缘手势）。
        let before = vm.state
        vm.onEditorMessage("w", .drawing(active: true))
        vm.onEditorMessage("w", .drawing(active: false))
        XCTAssertEqual(vm.state, before)
        XCTAssertTrue(vm.state.editorCapturesEdgeSwipes)
    }

    @MainActor
    func testLeavingTheEditorOrChangingIdentityDropsItsUnfinishedAndUnsavedFiles() async throws {
        let root = makeRoot()
        let vm = await whiteboardVm(root)

        // 收到一半关掉笔记。
        vm.onEditorMessage("w", .fileStart(id: "f", name: "f", mime: "image/png", size: 4))
        vm.onEditorMessage("w", .fileChunk(id: "f", index: 0, data: base64([1, 2])))
        vm.closeNote()
        await notesSettle()
        XCTAssertNil(vm.state.open)
        XCTAssertEqual(folders(root), [])

        // 收齐了、还没存就打开了别的笔记。
        vm.openNote("w")
        await notesSettle()
        vm.onEditorMessage("w", .fileStart(id: "g", name: "g", mime: "image/png", size: 0))
        vm.onEditorMessage("w", .fileEnd(id: "g"))
        let unsaved = try XCTUnwrap(vm.state.exportFile)
        vm.openNote("a")
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "a")
        XCTAssertNil(vm.state.exportFile)
        XCTAssertFalse(exists(unsaved.url))

        // 换了身份。
        vm.openNote("w")
        await notesSettle()
        vm.onEditorMessage("w", .fileStart(id: "h", name: "h", mime: "image/png", size: 0))
        vm.onEditorMessage("w", .fileEnd(id: "h"))
        let other = try XCTUnwrap(vm.state.exportFile)
        vm.onIdentityChanged()
        XCTAssertNil(vm.state.exportFile)
        XCTAssertFalse(exists(other.url))
        XCTAssertEqual(folders(root), [])
    }
}
