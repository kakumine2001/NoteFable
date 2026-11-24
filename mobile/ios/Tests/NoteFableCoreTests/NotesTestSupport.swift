import Foundation
import XCTest
@testable import NoteFableCore

// 笔记 ViewModel 测试的假后端和等待工具（Kotlin 测试里的 FakeNotes、StandardTestDispatcher）。
// 假后端都标 @MainActor：ViewModel 调它们不离开主线程，所以让出主线程若干次就等于 Kotlin 的 advanceUntilIdle()，不用真等。

/// 让排着的主线程任务都跑完（跑到结束，或停在测试握着的闸门上）。
@MainActor
func notesSettle(_ turns: Int = 200) async {
    for _ in 0..<turns { await Task.yield() }
}

struct NotesTestIOError: Error {}

/// Task 里要改的局部量（Task 的闭包不能直接改捕获的 var）。
@MainActor
final class NotesTestBox<Value> {
    var value: Value

    init(_ value: Value) {
        self.value = value
    }
}

@MainActor
final class NotesTestBackend: NotesBackend {
    var pages = [
        NotePageSummary(id: "a", title: "Cell structure", icon: "🧬", groupId: "g1", createdAt: "2026-11-14T00:00:01Z"),
        NotePageSummary(id: "b", title: "Japanese verbs", icon: nil, createdAt: "2026-11-14T00:00:00Z"),
    ]
    var groups = [NoteGroupSummary(id: "g1", name: "Biology")]
    var trashed = [NoteTrashItem(id: "t", title: "Old draft", icon: nil, deletedAt: "2026-11-14T00:00:00Z", purgeAt: "2026-12-14T00:00:00Z")]
    var calls: [String] = []
    var failNext: Error?

    /// 按调用名挂起：测试里先放一个闸门，请求就停在服务端"处理中"，直到 complete。
    var holds: [String: NoteDeferred<Bool>] = [:]

    private func hold(_ name: String) async {
        if let gate = holds.removeValue(forKey: name) { _ = await gate.wait() }
    }

    private func maybeFail() throws {
        if let error = failNext {
            failNext = nil
            throw error
        }
    }

    func count(_ call: String) -> Int {
        calls.filter { $0 == call }.count
    }

    func notes() async throws -> NotesList {
        calls.append("notes")
        try maybeFail()
        // 先取快照再等：模拟服务端在改动之前就读好了列表。
        let snapshot = NotesList(pages: pages, groups: groups)
        await hold("notes")
        return snapshot
    }

    func createNote(parentId: String?, kind: PageKind, groupId: String?) async throws -> NotePageSummary {
        var call = parentId.map { "create:\($0)" } ?? "create"
        if kind != .note { call += ":\(kind.wire)" }
        if let groupId { call += "@\(groupId)" }
        calls.append(call)
        try maybeFail()
        let group = parentId.flatMap { id in pages.first { $0.id == id }?.groupId } ?? groupId
        var page = NotePageSummary(id: "new", title: "Untitled", icon: nil, groupId: group, createdAt: "2026-11-15T00:00:00Z", parentId: parentId)
        page.kind = kind
        pages.insert(page, at: 0)
        return page
    }

    /// 子页面一起移进回收站（服务端的 ids）。
    func trashNote(id: String) async throws -> [String] {
        calls.append("trash:\(id)")
        try maybeFail()
        var ids = [id]
        var index = 0
        while index < ids.count {
            let parent = ids[index]
            index += 1
            ids += pages.filter { $0.parentId == parent }.map(\.id)
        }
        pages.removeAll { ids.contains($0.id) }
        return ids
    }

    func moveNote(id: String, groupId: String?) async throws -> [String] {
        calls.append("move:\(id):\(groupId ?? "null")")
        try maybeFail()
        return [id] + pages.filter { $0.parentId == id }.map(\.id)
    }

    func moveToPage(id: String, parentId: String?) async throws -> [NotePageSummary] {
        calls.append("parent:\(id):\(parentId ?? "null")")
        try maybeFail()
        let group = pages.first { $0.id == parentId }?.groupId
        return pages.filter { $0.id == id || $0.parentId == id }.map { page in
            var next = page
            if page.id == id { next.parentId = parentId }
            next.groupId = group
            return next
        }
    }

    func setFavorite(id: String, favorite: Bool) async throws -> NotePageSummary {
        calls.append("favorite:\(id):\(favorite)")
        try maybeFail()
        var page = try XCTUnwrap(pages.first { $0.id == id })
        page.favoritedAt = favorite ? "2026-11-16T00:00:00Z" : nil
        return page
    }

    func updateSettings(id: String, settings: NotePageSettings) async throws -> NotePageSummary {
        calls.append("settings:\(id)")
        try maybeFail()
        await hold("settings:\(settings.font ?? "")")
        var page = try XCTUnwrap(pages.first { $0.id == id })
        page.fullWidth = settings.fullWidth ?? page.fullWidth
        page.smallText = settings.smallText ?? page.smallText
        page.font = settings.font ?? page.font
        page.locked = settings.locked ?? page.locked
        return page
    }

    func duplicate(id: String) async throws -> DuplicateResult {
        calls.append("duplicate:\(id)")
        try maybeFail()
        var copy = try XCTUnwrap(pages.first { $0.id == id })
        copy.id = "copy"
        copy.title = "Copy (1)"
        return DuplicateResult(page: copy, pages: [copy], order: [
            NoteOrderUpdate(id: "a", position: 1), NoteOrderUpdate(id: "copy", position: 2), NoteOrderUpdate(id: "b", position: 3),
        ])
    }

    /// 模拟服务端：b 放到 a 前面，b 跟着 a 进 g1。
    func reorderNote(id: String, targetId: String, after: Bool) async throws -> [NoteOrderUpdate] {
        calls.append("reorder:\(id):\(targetId):\(after)")
        try maybeFail()
        await hold("reorder")
        return [
            NoteOrderUpdate(id: "b", position: 1, groupId: "g1", movedGroup: true),
            NoteOrderUpdate(id: "a", position: 2),
        ]
    }

    func createGroup(name: String) async throws -> NoteGroupSummary {
        calls.append("group:\(name)")
        try maybeFail()
        await hold("group")
        return NoteGroupSummary(id: "g2", name: name, position: 1)
    }

    func renameGroup(id: String, name: String) async throws -> NoteGroupSummary {
        calls.append("rename:\(id):\(name)")
        try maybeFail()
        return NoteGroupSummary(id: id, name: name)
    }

    func deleteGroup(id: String) async throws {
        calls.append("deleteGroup:\(id)")
        try maybeFail()
    }

    func trash() async throws -> [NoteTrashItem] {
        calls.append("trashList")
        try maybeFail()
        await hold("trashList")
        return trashed
    }

    func restoreNote(id: String) async throws -> [NotePageSummary] {
        calls.append("restore:\(id)")
        try maybeFail()
        await hold("restore")
        return [NotePageSummary(id: id, title: "Old draft", icon: nil, position: 5, createdAt: "2026-11-13T00:00:00Z")]
    }

    func deleteForever(id: String) async throws -> [String] {
        calls.append("forever:\(id)")
        try maybeFail()
        return [id]
    }

    func emptyTrash(before: String) async throws {
        calls.append("empty:\(before)")
        try maybeFail()
    }

    /// 导出的内容；导入时每个文件建一篇 `imported-N`（题名是去掉扩展名的文件名）。
    var exported = ExportedNote(fileName: "Cell structure.md", markdown: "# Cell structure\n")
    var imported: [[ImportMarkdownFile]] = []
    /// 每次导入带的项目（nil 是"无项目"）。
    var importedGroupIds: [String?] = []

    func exportNote(id: String) async throws -> ExportedNote {
        calls.append("export:\(id)")
        try maybeFail()
        await hold("export")
        return exported
    }

    func importMarkdown(files: [ImportMarkdownFile], groupId: String?) async throws -> [NotePageSummary] {
        calls.append("import:\(files.map(\.name).joined(separator: ","))")
        try maybeFail()
        await hold("import")
        imported.append(files)
        importedGroupIds.append(groupId)
        let created = files.enumerated().map { index, file in
            NotePageSummary(
                id: "imported-\(index + 1)", title: String(file.name.split(separator: ".").first ?? ""), icon: nil,
                position: -(index + 1), createdAt: "2026-11-20T00:00:0\(index)Z"
            )
        }
        pages = created + pages
        return created
    }

    nonisolated func noteEmbedUrl(pageId: String, lang: String?, model: String?, reasoning: String?, theme: String?, reveal: String?) -> String {
        "https://example.test/note-embed?page=\(pageId)&lang=\(lang ?? "null")"
    }
}

/// 改图标的假接口：每次调用交给 [handler]。
@MainActor
final class NotesTestIcons: NoteIconBackend {
    private let handler: @MainActor (String, String?) async throws -> NotePageSummary

    init(_ handler: @escaping @MainActor (String, String?) async throws -> NotePageSummary) {
        self.handler = handler
    }

    func setNoteIcon(id: String, icon: String?) async throws -> NotePageSummary {
        try await handler(id, icon)
    }
}

/// 界面层编辑器的替身：记下收到的调用；flush 的结果由测试决定（[mounted]，或握在 [flushGate] 上）。
@MainActor
final class NotesTestEditor: NoteEditorBridge {
    var calls: [String] = []
    var mounted = true
    var flushGate: NoteDeferred<Bool>?
    /// 网页收到 flush 后要做的事（一般是回一条 flushed 消息）。
    var onFlush: (@MainActor (String) -> Void)?

    func flush(requestId: String) async -> Bool {
        calls.append("flush:\(requestId)")
        if let flushGate { return await flushGate.wait() }
        if mounted { onFlush?(requestId) }
        return mounted
    }

    func openHistory() { calls.append("history") }
    func pageUpdated(_ pageJson: String) { calls.append("updated:\(pageJson)") }
    func pageSettings(_ pageJson: String) { calls.append("settings:\(pageJson)") }
    func appIcon(_ value: String?) { calls.append("icon:\(value ?? "null")") }
    func language(_ code: String) { calls.append("lang:\(code)") }
    func theme(_ value: String) { calls.append("theme:\(value)") }
    func reveal(_ id: String) { calls.append("reveal:\(id)") }
    func slides(_ command: String) { calls.append("slides:\(command)") }
}
