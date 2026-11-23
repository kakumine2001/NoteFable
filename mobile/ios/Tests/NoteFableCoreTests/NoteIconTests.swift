import Foundation
import XCTest
@testable import NoteFableCore

/// Android `NoteIconTest` 的移植：侧栏里改没打开的笔记的图标。
final class NoteIconTests: XCTestCase {
    @MainActor
    private func backend() -> NotesTestBackend {
        let backend = NotesTestBackend()
        backend.pages = [NotePageSummary(id: "a", title: "Bio", icon: nil, version: 3)]
        backend.groups = []
        return backend
    }

    @MainActor
    private func notesVm(_ icons: NotesTestIcons) async -> NotesViewModel {
        let vm = NotesViewModel(backend: backend(), prefs: MemoryNotesPrefs(), noteIcons: icons)
        vm.setWorkspace(.notes)
        await notesSettle()
        return vm
    }

    @MainActor
    func testChangingAClosedNotesIconUpdatesTheRowWithTheServersIconAndVersion() async {
        let calls = NotesTestBox<[String]>([])
        let vm = await notesVm(NotesTestIcons { id, icon in
            calls.value.append("\(id):\(icon ?? "null")")
            return NotePageSummary(id: id, title: "Bio", icon: icon, version: 4)
        })

        let changed = await vm.changeIcon("a", "🧬")
        XCTAssertTrue(changed)
        XCTAssertEqual(calls.value, ["a:🧬"])
        XCTAssertEqual(vm.state.pages.map(\.icon), ["🧬"])
        XCTAssertEqual(vm.state.pages.map(\.version), [4])
        XCTAssertFalse(vm.state.iconError)
    }

    @MainActor
    func testAFailedChangeKeepsTheIconAndShowsTheSidebarErrorUntilTheNextTry() async {
        let fail = NotesTestBox(true)
        let vm = await notesVm(NotesTestIcons { id, icon in
            if fail.value { throw NotesTestIOError() }
            return NotePageSummary(id: id, title: "Bio", icon: icon)
        })

        let failed = await vm.changeIcon("a", "🧬")
        XCTAssertFalse(failed)
        XCTAssertEqual(vm.state.pages.map(\.icon), [nil])
        XCTAssertTrue(vm.state.iconError)

        fail.value = false
        let changed = await vm.changeIcon("a", nil)
        XCTAssertTrue(changed)
        XCTAssertFalse(vm.state.iconError)

        // 抽屉重新打开时清掉提示。
        fail.value = true
        _ = await vm.changeIcon("a", "🎲")
        XCTAssertTrue(vm.state.iconError)
        vm.dismissIconError()
        XCTAssertFalse(vm.state.iconError)
    }

    @MainActor
    func testWithoutAnIconBackendTheChangeFails() async {
        let vm = NotesViewModel(backend: backend())
        vm.setWorkspace(.notes)
        await notesSettle()
        let changed = await vm.changeIcon("a", "🧬")
        XCTAssertFalse(changed)
        XCTAssertTrue(vm.state.iconError)
    }

    @MainActor
    func testIconWritesForOneNoteRunOneAtATimeAndALaterPickWins() async {
        let calls = NotesTestBox<[String?]>([])
        let gates = NotesTestBox<[NoteDeferred<Bool>]>([])
        let version = NotesTestBox(3)
        let vm = await notesVm(NotesTestIcons { id, icon in
            calls.value.append(icon)
            let gate = NoteDeferred<Bool>()
            gates.value.append(gate)
            _ = await gate.wait()
            version.value += 1
            return NotePageSummary(id: id, title: "Bio", icon: icon, version: version.value)
        })

        let results = NotesTestBox<[Bool]>([])
        Task { results.value.append(await vm.changeIcon("a", "🧬")) }
        await notesSettle()
        Task { results.value.append(await vm.changeIcon("a", "🎲")) }
        Task { results.value.append(await vm.changeIcon("a", "📚")) }
        await notesSettle()
        // 第一个还没回来：后面两次只记下最后的选择，不另发请求。
        XCTAssertEqual(calls.value, ["🧬"])

        gates.value[0].complete(true)
        await notesSettle()
        XCTAssertEqual(calls.value, ["🧬", "📚"])
        XCTAssertEqual(vm.state.pages.map(\.icon), ["🧬"])

        gates.value[1].complete(true)
        await notesSettle()
        XCTAssertEqual(vm.state.pages.map(\.icon), ["📚"])
        XCTAssertEqual(vm.state.pages.map(\.version), [5])
        XCTAssertEqual(results.value, [true, true, true])
    }

    @MainActor
    func testOpeningANoteWaitsForItsPendingIconWrite() async {
        let gate = NoteDeferred<Bool>()
        let vm = await notesVm(NotesTestIcons { id, icon in
            _ = await gate.wait()
            return NotePageSummary(id: id, title: "Bio", icon: icon, version: 4)
        })

        Task { _ = await vm.changeIcon("a", "🧬") }
        await notesSettle()
        vm.openNote("a")
        await notesSettle()
        // PUT 还没回来：编辑器不能先读旧版本。
        XCTAssertNil(vm.state.open)

        gate.complete(true)
        await notesSettle()
        XCTAssertEqual(vm.state.open, OpenNote("a", "Bio", "🧬"))
        XCTAssertEqual(vm.state.pages.map(\.version), [4])
    }

    @MainActor
    func testASearchHitOpenedWhileItsIconIsSavingStillRevealsItsBlock() async {
        let gate = NoteDeferred<Bool>()
        let vm = await notesVm(NotesTestIcons { id, icon in
            _ = await gate.wait()
            return NotePageSummary(id: id, title: "Bio", icon: icon, version: 4)
        })

        Task { _ = await vm.changeIcon("a", "🧬") }
        await notesSettle()
        vm.openNote("a", title: "Bio", icon: nil, reveal: "block-2")
        await notesSettle()
        gate.complete(true)
        await notesSettle()
        // 等完写入后改用列表里的新版本（新图标），检索命中的块照样带着。
        XCTAssertEqual(vm.state.open, OpenNote("a", "Bio", "🧬", reveal: "block-2"))
    }

    @MainActor
    func testAnIconWriteFromTheOldIdentityIsDroppedAndDoesNotBlockTheNewOne() async {
        let gates = NotesTestBox<[NoteDeferred<Bool>]>([])
        let vm = await notesVm(NotesTestIcons { id, icon in
            let gate = NoteDeferred<Bool>()
            gates.value.append(gate)
            _ = await gate.wait()
            return NotePageSummary(id: id, title: "Bio", icon: icon, version: 9)
        })

        let old = Task { await vm.changeIcon("a", "🧬") }
        await notesSettle()
        // 等着这次写入的打开操作：换身份后放行，但已经作废。
        vm.openNote("a")
        await notesSettle()
        vm.onIdentityChanged()
        await notesSettle()
        XCTAssertNil(vm.state.open)

        // 新身份同一篇笔记的选择重新排队，不并进旧的那次。
        let fresh = Task { await vm.changeIcon("a", "🎲") }
        await notesSettle()
        XCTAssertEqual(gates.value.count, 2)

        gates.value[0].complete(true)
        let oldResult = await old.value
        XCTAssertFalse(oldResult)
        XCTAssertEqual(vm.state.pages.map(\.icon), [nil])
        XCTAssertFalse(vm.state.iconError)

        gates.value[1].complete(true)
        let freshResult = await fresh.value
        XCTAssertTrue(freshResult)
        XCTAssertEqual(vm.state.pages.map(\.icon), ["🎲"])
    }
}
