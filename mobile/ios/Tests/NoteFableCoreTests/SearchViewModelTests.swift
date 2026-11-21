import Foundation
import Observation
import XCTest
@testable import NoteFableCore

@MainActor
private final class FakeSearch: SearchBackend {
    struct Call: Equatable {
        var query: String
        var scope: SearchScope
        var projectId: String?
    }

    var calls: [Call] = []
    var fail = false
    /// 设了以后每个检索词的请求在自己的门口等。
    var gated = false
    private var gates: [String: TestGate] = [:]

    func gate(_ query: String) -> TestGate {
        if let gate = gates[query] { return gate }
        let gate = TestGate()
        gates[query] = gate
        return gate
    }

    static func response(_ query: String) -> SearchResponse {
        SearchResponse(
            query: query,
            notes: [NoteSearchResult(id: "n1", title: "Note \(query)")],
            chats: [ChatSearchResult(id: "c1", title: "Chat \(query)", projectId: "p2")]
        )
    }

    func search(query: String, scope: SearchScope, projectId: String?) async throws -> SearchResponse {
        calls.append(Call(query: query, scope: scope, projectId: projectId))
        if gated { await gate(query).pass() }
        if fail { throw TestIOError(message: "down") }
        return Self.response(query)
    }
}

final class SearchViewModelTests: XCTestCase {
    private let projects = [ChatProjectSummary(id: "p1", name: "One"), ChatProjectSummary(id: "p2", name: "Two")]

    @MainActor
    private func model(_ backend: FakeSearch, _ clock: ManualClock) -> SearchViewModel {
        SearchViewModel(backend: backend, sleep: { try await clock.sleep($0) })
    }

    @MainActor
    func testWaits250msAfterTypingStopsAndSearchesOnlyTheLatestInput() async {
        let backend = FakeSearch()
        let clock = ManualClock()
        let vm = model(backend, clock)
        vm.setInput("ap")
        await clock.registered(1)
        clock.advance(200)
        vm.setInput("  api  ")
        await clock.registered(2)
        clock.advance(249)
        await settleMainActor()
        XCTAssertTrue(backend.calls.isEmpty)
        XCTAssertTrue(vm.state.view(projects, nil, true).loading)
        clock.advance(2)
        await vm.job?.value
        XCTAssertEqual(backend.calls, [FakeSearch.Call(query: "api", scope: .all, projectId: nil)])
        let view = vm.state.view(projects, nil, true)
        XCTAssertFalse(view.loading)
        XCTAssertEqual(view.groups.map(\.isChats), [true, false])
        XCTAssertEqual(view.terms, ["api"])
        XCTAssertEqual(view.content, .results)
        // 在笔记界面时 Notes 在前。
        XCTAssertEqual(vm.state.view(projects, nil, false).groups.map(\.isChats), [false, true])
    }

    @MainActor
    func testKeepsThePreviousResultsWhileANewSearchRunsAndDropsLateStaleAnswers() async {
        let backend = FakeSearch()
        backend.gated = true
        let clock = ManualClock()
        let vm = model(backend, clock)
        vm.setInput("a")
        await clock.registered(1)
        clock.advance(300)
        await backend.gate("a").entered()
        XCTAssertEqual(vm.state.view(projects, nil, true).content, .searching)
        backend.gate("a").open()
        await vm.job?.value
        vm.setInput("ab")
        await clock.registered(2)
        clock.advance(300)
        await backend.gate("ab").entered()
        let stale = vm.state.view(projects, nil, true)
        XCTAssertTrue(stale.loading)
        XCTAssertEqual(stale.data?.query, "a")
        XCTAssertEqual(stale.content, .results)
        XCTAssertNil(stale.submitTarget(0), "stale results do not open on Enter")
        let abandoned = vm.job
        vm.setInput("abc")
        // "ab" 的请求被取消；即使晚到也不会写回。
        backend.gate("ab").open()
        await abandoned?.value
        XCTAssertEqual(vm.state.view(projects, nil, true).data?.query, "a")
        await clock.registered(3)
        clock.advance(300)
        await backend.gate("abc").entered()
        backend.gate("abc").open()
        await vm.job?.value
        XCTAssertEqual(vm.state.view(projects, nil, true).data?.query, "abc")
    }

    @MainActor
    func testAFailedSearchShowsTheFailureAndRetrySearchesAgain() async {
        let backend = FakeSearch()
        backend.fail = true
        let clock = ManualClock()
        let vm = model(backend, clock)
        vm.setInput("x")
        await clock.registered(1)
        clock.advance(300)
        await vm.job?.value
        let failed = vm.state.view(projects, nil, true)
        XCTAssertTrue(failed.failed)
        XCTAssertNil(failed.data)
        XCTAssertEqual(failed.content, .failed)
        backend.fail = false
        vm.retry()
        await clock.registered(2)
        clock.advance(300)
        await vm.job?.value
        XCTAssertEqual(backend.calls.count, 2)
        XCTAssertFalse(vm.state.view(projects, nil, true).failed)
    }

    @MainActor
    func testProjectsArrivingLaterRedrawTheViewEvenWithoutANewSearch() async {
        let backend = FakeSearch()
        let clock = ManualClock()
        let vm = model(backend, clock)
        let changed = Collected<Bool>()
        withObservationTracking {
            _ = vm.view(currentProjectId: nil, chatFirst: true)
        } onChange: {
            changed.add(true)
        }
        // 检索条件没变（不重新检索），但项目筛选和项目名要跟着列表出来（Android 是 Compose 参数，变了就重组）。
        vm.setProjects(projects)
        XCTAssertEqual(changed.values, [true])
        XCTAssertNil(vm.job)
    }

    @MainActor
    func testTheProjectFilterAppliesOnlyOnTheChatsTabAndOnlyToExistingProjects() async {
        let backend = FakeSearch()
        let clock = ManualClock()
        let vm = model(backend, clock)
        vm.setProjects(projects)
        vm.setInput("x")
        await clock.registered(1)
        // 不在 Chats 标签页：筛选不算检索条件，不重新排请求。
        vm.setProject("p1")
        clock.advance(300)
        await vm.job?.value
        vm.setScope(.chats)
        await clock.registered(2)
        clock.advance(300)
        await vm.job?.value
        vm.setProject("gone")
        await clock.registered(3)
        clock.advance(300)
        await vm.job?.value
        XCTAssertEqual(backend.calls, [
            FakeSearch.Call(query: "x", scope: .all, projectId: nil),
            FakeSearch.Call(query: "x", scope: .chats, projectId: "p1"),
            FakeSearch.Call(query: "x", scope: .chats, projectId: nil),
        ])
        let view = vm.state.view(projects, "p2", true)
        XCTAssertEqual(view.projectOptions.map(\.id), ["p2", "p1"])
        XCTAssertEqual(view.groups.map(\.isChats), [true])
        XCTAssertEqual(view.projectNames["p2"], "Two")
        XCTAssertEqual(view.rows.first?.projectName(view.projectNames), "Two")
        XCTAssertEqual(vm.view(currentProjectId: "p2", chatFirst: true), view)
    }

    @MainActor
    func testEmptyInputStaysIdleWithoutARequest() async {
        let backend = FakeSearch()
        let clock = ManualClock()
        let vm = model(backend, clock)
        vm.setInput("   ")
        clock.advance(1000)
        await settleMainActor()
        XCTAssertNil(vm.job)
        XCTAssertEqual(clock.registrations, 0)
        XCTAssertEqual(backend.calls, [])
        let view = vm.state.view(projects, nil, true)
        XCTAssertTrue(view.idle)
        XCTAssertEqual(view.content, .idle)
    }

    @MainActor
    func testClosingTheSearchDropsThePendingRequest() async {
        let backend = FakeSearch()
        let clock = ManualClock()
        let vm = model(backend, clock)
        vm.setInput("x")
        await clock.registered(1)
        let pending = vm.job
        vm.close()
        clock.advance(300)
        await pending?.value
        XCTAssertEqual(backend.calls, [])
        XCTAssertNil(vm.state.loaded)
    }

    // ---- 画面的规则 ----

    func testInputIsCappedAtTheQueryLimitAndTheActiveRowIsClamped() {
        var state = SearchUiState()
        state.input = String(repeating: "a", count: 150)
        XCTAssertEqual(state.view([], nil, true).query.count, SearchFold.MAX_SEARCH_QUERY_CHARS)

        state.input = "kanji"
        let key = state.view([], nil, true).key
        state.loaded = SearchLoaded(key: key, data: SearchResponse(
            query: "kanji",
            notes: [NoteSearchResult(id: "n1", title: "Kanji")],
            chats: [ChatSearchResult(id: "c1", title: "Chat"), ChatSearchResult(id: "c2", title: "Other")]
        ))
        let view = state.view([], nil, false)
        XCTAssertEqual(view.rows.map(\.key), ["note:n1", "chat:c1", "chat:c2"])
        XCTAssertEqual(view.activeIndex(-3), 0)
        XCTAssertEqual(view.activeIndex(9), 2)
        XCTAssertEqual(view.submitTarget(9)?.key, "chat:c2")

        state.loaded = SearchLoaded(key: key, data: SearchResponse(query: "kanji"))
        XCTAssertEqual(state.view([], nil, true).content, .noResults(query: "kanji"))
    }

    func testSnippetsLeadWithTheFileNameOrTheSpeaker() {
        XCTAssertEqual(SearchHit.note(NoteSearchResult(id: "n")).snippetLead, .none)
        XCTAssertEqual(SearchHit.chat(ChatSearchResult(id: "c", role: "USER")).snippetLead, .you)
        XCTAssertEqual(SearchHit.chat(ChatSearchResult(id: "c", role: "ASSISTANT")).snippetLead, .notefable)
        XCTAssertEqual(SearchHit.chat(ChatSearchResult(id: "c")).snippetLead, .none)
        // 命中附件正文时显示文件名，不显示说话人。
        XCTAssertEqual(SearchHit.chat(ChatSearchResult(id: "c", role: "USER", attachmentName: "plan.pdf")).snippetLead, .file("plan.pdf"))
    }

    func testDatesInTheCurrentYearOmitTheYear() throws {
        let utc = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let now = try XCTUnwrap(parseIsoInstant("2026-11-20T08:00:00Z"))
        let english = Locale(identifier: "en")
        XCTAssertEqual(formatSearchDate("2026-11-14T03:04:05.678Z", locale: english, now: now, timeZone: utc), "Nov 14")
        XCTAssertEqual(formatSearchDate("2024-02-03T03:04:05Z", locale: english, now: now, timeZone: utc), "Feb 3, 2024")
        XCTAssertEqual(formatSearchDate("2026-11-14T03:04:05Z", locale: Locale(identifier: "ja"), now: now, timeZone: utc), "11月14日")
        XCTAssertEqual(formatSearchDate("yesterday", locale: english, now: now, timeZone: utc), "")
        XCTAssertEqual(formatSearchDate("", locale: english, now: now, timeZone: utc), "")
        // 年份按所在时区算：UTC 的元旦零点前一小时在东京已经是新的一年。
        let tokyo = try XCTUnwrap(TimeZone(identifier: "Asia/Tokyo"))
        let newYear = try XCTUnwrap(parseIsoInstant("2027-01-01T03:00:00Z"))
        XCTAssertEqual(formatSearchDate("2026-12-31T23:00:00Z", locale: english, now: newYear, timeZone: tokyo), "Jan 1")
    }
}
