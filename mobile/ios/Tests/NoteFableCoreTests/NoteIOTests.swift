import Foundation
import XCTest
@testable import NoteFableCore

/// 笔记的 Markdown 导出 / 导入：本机的检查（网页 src/lib/note-io.ts、use-note-pages.ts）、接口和 ViewModel。
final class NoteIOTests: XCTestCase {
    private struct ReadError: Error {}

    private func source(_ name: String, _ text: String = "# Title\n", size: Int? = nil) -> NoteImportSource {
        let data = Data(text.utf8)
        return NoteImportSource(name: name, size: size ?? data.count, read: { data })
    }

    @MainActor
    private func notesVm(_ backend: NotesTestBackend) async -> NotesViewModel {
        let vm = NotesViewModel(backend: backend)
        vm.setWorkspace(.notes)
        await notesSettle()
        return vm
    }

    // ---- 本机的检查 ----

    func testLimitsMatchTheWeb() {
        XCTAssertEqual(MAX_IMPORT_FILES, 20)
        XCTAssertEqual(MAX_IMPORT_FILE_BYTES, 1_048_576)
        XCTAssertEqual(MAX_IMPORT_TOTAL_BYTES, 4_194_304)
        XCTAssertEqual(IMPORT_FILE_EXTENSIONS, [".md", ".markdown", ".txt"])
    }

    func testOnlyMarkdownAndTextFilesAreImportable() {
        XCTAssertTrue(isImportableMarkdownFile("notes.md"))
        XCTAssertTrue(isImportableMarkdownFile("Notes.MARKDOWN"))
        XCTAssertTrue(isImportableMarkdownFile("  readme.txt  "))
        XCTAssertTrue(isImportableMarkdownFile("a.b.md"))
        XCTAssertFalse(isImportableMarkdownFile("notes.pdf"))
        XCTAssertFalse(isImportableMarkdownFile("notes.md.docx"))
        XCTAssertFalse(isImportableMarkdownFile("md"))
        XCTAssertFalse(isImportableMarkdownFile(""))
    }

    func testProblemsAreReportedInTheWebOrder() {
        XCTAssertNil(noteImportProblem([(name: "a.md", size: 10), (name: "b.txt", size: MAX_IMPORT_FILE_BYTES)]))
        XCTAssertNil(noteImportProblem([]))
        // 数量先于其它检查。
        let many = (0...MAX_IMPORT_FILES).map { (name: "n\($0).pdf", size: 1) }
        XCTAssertEqual(noteImportProblem(many), .importTooMany)
        XCTAssertNil(noteImportProblem((0..<MAX_IMPORT_FILES).map { (name: "n\($0).md", size: 1) }))
        // 逐个文件：先看到哪个问题就报哪个。
        XCTAssertEqual(noteImportProblem([(name: "a.md", size: 1), (name: "b.png", size: 1)]), .importBadType)
        XCTAssertEqual(noteImportProblem([(name: "a.md", size: MAX_IMPORT_FILE_BYTES + 1), (name: "b.png", size: 1)]), .importFileTooLarge)
        XCTAssertEqual(noteImportProblem([(name: "b.png", size: 1), (name: "a.md", size: MAX_IMPORT_FILE_BYTES + 1)]), .importBadType)
        // 每个都不超、加起来超 4 MB。
        let heavy = (0..<5).map { (name: "n\($0).md", size: MAX_IMPORT_FILE_BYTES) }
        XCTAssertEqual(noteImportProblem(heavy), .importTooLarge)
        XCTAssertNil(noteImportProblem(Array(heavy.prefix(4))))
    }

    func testFileBytesAreReadAsLossyUtf8() {
        XCTAssertEqual(noteImportText(Data("# 标题\n本文".utf8)), "# 标题\n本文")
        XCTAssertEqual(noteImportText(Data([0x61, 0xFF, 0x62])), "a\u{FFFD}b")
        XCTAssertEqual(noteImportText(Data()), "")
    }

    func testTheExportNameDropsTheExtensionTheSystemAddsBack() {
        XCTAssertEqual(noteExportBaseName("Cell structure.md"), "Cell structure")
        XCTAssertEqual(noteExportBaseName("NOTES.MD"), "NOTES")
        XCTAssertEqual(noteExportBaseName("plain"), "plain")
        XCTAssertEqual(noteExportBaseName(".md"), "note")
        XCTAssertEqual(noteExportBaseName(""), "note")
    }

    func testErrorKindsHaveTheirOwnCopy() {
        let system = SystemText.empty.translator("en")
        XCTAssertEqual(notesErrorText(NotesError(.export), system), "note_export_failed")
        XCTAssertEqual(notesErrorText(NotesError(.exportUnsaved), system), "note_export_unsaved")
        XCTAssertEqual(notesErrorText(NotesError(.importFailed), system), "note_import_failed")
        XCTAssertEqual(notesErrorText(NotesError(.importTooMany), system), "note_import_too_many")
        XCTAssertEqual(notesErrorText(NotesError(.importBadType), system), "note_import_bad_type")
        XCTAssertEqual(notesErrorText(NotesError(.importFileTooLarge), system), "note_import_file_too_large")
        XCTAssertEqual(notesErrorText(NotesError(.importTooLarge), system), "note_import_too_large")
        // 服务端的原句优先。
        XCTAssertEqual(notesErrorText(NotesError(.importFailed, "Import exceeds 4 MB."), system), "Import exceeds 4 MB.")
    }

    // ---- 接口 ----

    func testExportReadsTheFileNameAndMarkdown() async throws {
        let server = FakeTransport()
        server.enqueue(##"{"fileName":"Cell structure.md","markdown":"# Cell structure\n\nBody\n"}"##)
        let note = try await makeApi(server).exportNote(id: "a/b")
        XCTAssertEqual(note, ExportedNote(fileName: "Cell structure.md", markdown: "# Cell structure\n\nBody\n"))
        let request = server.next()
        XCTAssertEqual(request.method, "GET")
        XCTAssertEqual(request.path, "/api/pages/a%2Fb/export")

        // 网页：没有 fileName 叫 note.md，没有 markdown 当空串。
        server.enqueue("{}")
        let empty = try await makeApi(server).exportNote(id: "a")
        XCTAssertEqual(empty, ExportedNote(fileName: "note.md", markdown: ""))

        server.enqueue(#"{"error":"Note not found."}"#, status: 404)
        let error = await errorThrown(try await makeApi(server).exportNote(id: "gone")) as? ApiException
        XCTAssertEqual(error?.message, "Note not found.")
    }

    func testImportPostsTheFilesLikeTheWebAndReturnsTheNewPages() async throws {
        let server = FakeTransport()
        server.enqueue(#"{"pages":[{"id":"n1","title":"One","icon":null,"position":-2},{"id":"n2","title":"Two","icon":null,"position":-1}]}"#, status: 201)
        let pages = try await makeApi(server).importMarkdown(files: [
            ImportMarkdownFile(name: "one.md", markdown: "# One\n"),
            ImportMarkdownFile(name: "two.txt", markdown: "plain \"text\""),
        ])
        XCTAssertEqual(pages.map(\.id), ["n1", "n2"])
        let request = server.next()
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/api/pages/import")
        XCTAssertEqual(request.jsonKeys, ["files"])
        XCTAssertEqual(request.json?["files"]?[0], JSONValue.object(["name": .string("one.md"), "markdown": .string("# One\n")]))
        XCTAssertEqual(request.json?["files"]?[1]?["markdown"]?.stringValue, "plain \"text\"")
        XCTAssertNil(request.json?["files"]?[2])

        server.enqueue(#"{"error":"Note content exceeds 1 MiB."}"#, status: 413)
        let error = await errorThrown(
            try await makeApi(server).importMarkdown(files: [ImportMarkdownFile(name: "big.md", markdown: "x")])
        ) as? ApiException
        XCTAssertEqual(error?.status, 413)
        XCTAssertEqual(error?.message, "Note content exceeds 1 MiB.")
    }

    // ---- ViewModel：导出 ----

    @MainActor
    func testExportReturnsTheServerFileWithoutTouchingTheList() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let before = vm.state.pages
        let note = await vm.exportPage("a")
        XCTAssertEqual(note, backend.exported)
        XCTAssertEqual(backend.count("export:a"), 1)
        XCTAssertEqual(vm.state.pages, before)
        XCTAssertNil(vm.state.notice)
        XCTAssertFalse(vm.state.busy)
    }

    @MainActor
    func testExportSavesTheOpenNoteFirstAndRefusesWhenItCannot() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        vm.openNote("a")
        await notesSettle()
        var flushes = 0
        vm.flushEditor = {
            flushes += 1
            return FlushResult(false, draftKept: true)
        }
        let refused = await vm.exportPage("a")
        XCTAssertNil(refused)
        XCTAssertEqual(flushes, 1)
        XCTAssertFalse(backend.calls.contains("export:a"))
        XCTAssertEqual(vm.state.notice, NotesError(.exportUnsaved))

        // 别的笔记不用等打开着的这一篇保存。
        let other = await vm.exportPage("b")
        XCTAssertEqual(other, backend.exported)
        XCTAssertEqual(flushes, 1)
        XCTAssertNil(vm.state.notice)

        // 存上了就导出，上一次的提示收掉。
        vm.flushEditor = { FlushResult(false) }
        _ = await vm.exportPage("a")
        XCTAssertEqual(vm.state.notice, NotesError(.exportUnsaved))
        vm.flushEditor = { FlushResult(true) }
        let saved = await vm.exportPage("a")
        XCTAssertEqual(saved, backend.exported)
        XCTAssertNil(vm.state.notice)
        XCTAssertEqual(vm.state.open?.id, "a")
    }

    @MainActor
    func testExportFailureShowsTheServerMessageOrTheWebCopy() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        backend.failNext = ApiException(status: 404, message: "Note not found.")
        let missing = await vm.exportPage("a")
        XCTAssertNil(missing)
        XCTAssertEqual(vm.state.notice, NotesError(.export, "Note not found."))
        backend.failNext = NotesTestIOError()
        let offline = await vm.exportPage("a")
        XCTAssertNil(offline)
        XCTAssertEqual(vm.state.notice, NotesError(.export, nil))
    }

    @MainActor
    func testOnlyOneExportRunsAtATime() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let gate = NoteDeferred<Bool>()
        backend.holds["export"] = gate
        let first = Task { await vm.exportPage("a") }
        await notesSettle()
        let second = await vm.exportPage("a")
        XCTAssertNil(second)
        gate.complete(true)
        let result = await first.value
        XCTAssertEqual(result, backend.exported)
        XCTAssertEqual(backend.count("export:a"), 1)
    }

    // ---- ViewModel：导入 ----

    @MainActor
    func testImportCreatesTheNotesAndOpensTheFirstOne() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        await vm.importMarkdown([source("one.md", "# One\n"), source("two.txt", "plain")])
        await notesSettle()
        XCTAssertEqual(backend.imported, [[
            ImportMarkdownFile(name: "one.md", markdown: "# One\n"),
            ImportMarkdownFile(name: "two.txt", markdown: "plain"),
        ]])
        XCTAssertEqual(vm.state.pages.map(\.id), ["imported-2", "imported-1", "a", "b"])
        XCTAssertEqual(vm.state.open?.id, "imported-1")
        XCTAssertEqual(vm.state.open?.title, "one")
        XCTAssertEqual(vm.state.workspace, .notes)
        XCTAssertFalse(vm.state.busy)
        XCTAssertNil(vm.state.error)
    }

    @MainActor
    func testImportChecksTheSelectionBeforeReadingOrUploading() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let unread: @Sendable () throws -> Data = { Data() }

        await vm.importMarkdown([])
        XCTAssertNil(vm.state.error)

        await vm.importMarkdown((0...MAX_IMPORT_FILES).map { NoteImportSource(name: "n\($0).md", size: 1, read: unread) })
        XCTAssertEqual(vm.state.error, NotesError(.importTooMany))

        await vm.importMarkdown([NoteImportSource(name: "photo.png", size: 1, read: unread)])
        XCTAssertEqual(vm.state.error, NotesError(.importBadType))

        await vm.importMarkdown([NoteImportSource(name: "big.md", size: MAX_IMPORT_FILE_BYTES + 1, read: unread)])
        XCTAssertEqual(vm.state.error, NotesError(.importFileTooLarge))

        await vm.importMarkdown((0..<5).map { NoteImportSource(name: "n\($0).md", size: MAX_IMPORT_FILE_BYTES, read: unread) })
        XCTAssertEqual(vm.state.error, NotesError(.importTooLarge))

        XCTAssertFalse(backend.calls.contains { $0.hasPrefix("import") })
        XCTAssertFalse(vm.state.busy)
        XCTAssertNil(vm.state.open)

        // 合格的一次把上一次的提示收掉。
        await vm.importMarkdown([source("ok.md")])
        await notesSettle()
        XCTAssertNil(vm.state.error)
        XCTAssertEqual(vm.state.open?.id, "imported-1")
    }

    @MainActor
    func testImportChecksTheBytesActuallyReadWhenTheSizeWasUnknown() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let big = Data(count: MAX_IMPORT_FILE_BYTES + 1)
        await vm.importMarkdown([NoteImportSource(name: "grew.md", size: 0, read: { big })])
        XCTAssertEqual(vm.state.error, NotesError(.importFileTooLarge))
        XCTAssertFalse(backend.calls.contains { $0.hasPrefix("import") })
        XCTAssertFalse(vm.state.busy)
    }

    @MainActor
    func testImportFailuresKeepTheListAndShowTheReason() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let before = vm.state.pages

        // 读不出文件。
        await vm.importMarkdown([NoteImportSource(name: "gone.md", size: 3, read: { throw ReadError() })])
        XCTAssertEqual(vm.state.error, NotesError(.importFailed, nil))
        XCTAssertFalse(backend.calls.contains { $0.hasPrefix("import") })

        // 服务端拒绝：原句。
        backend.failNext = ApiException(status: 413, message: "Import exceeds 4 MB.")
        await vm.importMarkdown([source("a.md")])
        XCTAssertEqual(vm.state.error, NotesError(.importFailed, "Import exceeds 4 MB."))

        // 网络错误：网页文案。
        backend.failNext = NotesTestIOError()
        await vm.importMarkdown([source("a.md")])
        XCTAssertEqual(vm.state.error, NotesError(.importFailed, nil))

        XCTAssertEqual(vm.state.pages, before)
        XCTAssertNil(vm.state.open)
        XCTAssertFalse(vm.state.busy)
    }

    /// 文件在后台线程读，所以请求不是让出几次主线程就一定发出去了：等到假后端收到为止。
    @MainActor
    private func waitForImportCall(_ backend: NotesTestBackend) async {
        for _ in 0..<5000 {
            if backend.calls.contains(where: { $0.hasPrefix("import") }) { return }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTFail("the import request was never sent")
    }

    @MainActor
    func testASecondImportIsIgnoredWhileOneIsRunning() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let gate = NoteDeferred<Bool>()
        backend.holds["import"] = gate
        let first = Task { await vm.importMarkdown([source("one.md")]) }
        await waitForImportCall(backend)
        XCTAssertTrue(vm.state.busy)
        await vm.importMarkdown([source("two.md")])
        XCTAssertEqual(backend.calls.filter { $0.hasPrefix("import") }, ["import:one.md"])
        gate.complete(true)
        await first.value
        await notesSettle()
        XCTAssertEqual(vm.state.open?.id, "imported-1")
        XCTAssertFalse(vm.state.busy)
    }

    @MainActor
    func testAnImportThatFinishesAfterSigningOutIsDropped() async {
        let backend = NotesTestBackend()
        let vm = await notesVm(backend)
        let gate = NoteDeferred<Bool>()
        backend.holds["import"] = gate
        let running = Task { await vm.importMarkdown([source("one.md")]) }
        await waitForImportCall(backend)
        vm.onIdentityChanged()
        await notesSettle()
        gate.complete(true)
        await running.value
        await notesSettle()
        // 旧身份的导入结果不写进新身份的列表，也不打开。
        XCTAssertEqual(vm.state.pages.map(\.id), ["a", "b"])
        XCTAssertNil(vm.state.open)
        XCTAssertFalse(vm.state.busy)
    }
}
