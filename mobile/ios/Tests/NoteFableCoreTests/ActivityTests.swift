import XCTest
@testable import NoteFableCore

// 与网页 src/lib/chat-activity.test.ts、Android 的 ActivityTest 逐条对应。原生收到的是服务端已整理好的 {activity: ActivityEvent}，
// 所以这里从 ActivityEvent 的 JSON 形状开始（网页测试里 parseActivityEvent 之后的那一步）。
final class ActivityTests: XCTestCase {
    private func event(_ json: String) -> ActivityEvent? {
        JSONValue.parse(json).flatMap { Activity.parseEvent($0) }
    }

    private func apply(_ json: String...) -> [ActivityStep] {
        Activity.apply([], json.compactMap { event($0) })
    }

    func testMergesReasoningDeltasFromOpenAISummariesAndDeepSeekReasoningText() {
        let steps = apply(
            #"{"type":"thought","id":"rs:0","delta":"**Plan**\n\n"}"#,
            #"{"type":"thought","id":"rs:0","delta":"Check docs."}"#,
            #"{"type":"thought","id":"ds:0","delta":"嗯，"}"#
        )
        XCTAssertEqual(steps, [.thought(id: "rs:0", text: "**Plan**\n\nCheck docs."), .thought(id: "ds:0", text: "嗯，")])
        guard case .thought(_, let text) = steps[0] else { return XCTFail("not a thought") }
        let split = Activity.splitThought(text)
        XCTAssertEqual(split.title, "Plan")
        XCTAssertEqual(split.body, "Check docs.")
        let plain = Activity.splitThought("  plain  ")
        XCTAssertEqual(plain.title, "")
        XCTAssertEqual(plain.body, "plain")
    }

    func testTurnsARunningWebSearchIntoItsFinishedAction() {
        let steps = apply(
            #"{"type":"web","id":"ws","status":"running"}"#,
            #"{"type":"web","id":"ws","status":"done","action":{"kind":"open_page","url":"https://nextjs.org/docs"}}"#
        )
        XCTAssertEqual(steps, [.web(id: "ws", done: true, action: .openPage(url: "https://nextjs.org/docs"))])
    }

    func testTurnsAPageEditProposalIntoAStepAndIgnoresMalformedOnes() {
        let json = #"{"type":"proposal","id":"pr1","pageId":"p1","pageTitle":"Notes","baseVersion":2,"changes":[{"op":"delete","block":1,"before":"x"}],"proposed":{"title":"Notes","blocks":[]}}"#
        let expected = Proposal.Edit(
            id: "pr1", pageId: "p1", pageTitle: "Notes", baseVersion: 2,
            changes: [ProposalChange(op: .delete, block: 1, before: "x")]
        )
        XCTAssertEqual(apply(json), [.proposal(.edit(expected))])
        // 旧服务端没有的字段：按笔记、没有自动应用、不能撤销。
        XCTAssertEqual(expected.pageKind, .note)
        XCTAssertFalse(expected.autoApplied)
        XCTAssertFalse(expected.undoable)
        XCTAssertNil(event(json.replacingOccurrences(of: #""baseVersion":2"#, with: #""baseVersion":"2""#)))
        XCTAssertNil(event(json.replacingOccurrences(of: #"{"title":"Notes","blocks":[]}"#, with: #"{"title":"x"}"#)))
    }

    func testTurnsANewPageProposalIntoAStepAndIgnoresMalformedOnes() {
        let json = #"{"type":"create_proposal","id":"np1","title":"Plan","icon":null,"content":"- a","proposed":{"title":"Plan","icon":null,"blocks":[]}}"#
        XCTAssertEqual(apply(json), [.proposal(.create(Proposal.Create(id: "np1", title: "Plan", icon: nil, content: "- a")))])
        XCTAssertNil(event(json.replacingOccurrences(of: #""content":"- a""#, with: #""content":1"#)))
        XCTAssertNil(event(json.replacingOccurrences(of: #","blocks":[]}"#, with: "}")))
    }

    // ---- 不分页面类型的提案（白板、幻灯片、自动应用、撤销；src/lib/page-ai/types.ts） ----

    func testReadsTheTargetsThumbnailsAndStateOfAnEditToAnyKindOfPage() {
        let json = #"{"type":"proposal","id":"pr2","pageId":"s1","pageTitle":"Deck","baseVersion":7,"# +
            #""pageKind":"slides","status":"applied","appliedPageId":"s1","autoApplied":true,"undoable":true,"# +
            #""changes":[{"op":"update","block":0,"target":{"type":"slide","number":2},"before":"Old","after":"New","# +
            #""beforeImage":"/api/proposals/pr2/image?change=0&side=before","afterImage":"/api/proposals/pr2/image?change=0&side=after"},"# +
            #"{"op":"add","block":0,"target":{"type":"elements","count":1,"name":"Sticky"}},"# +
            #"{"op":"move","block":0,"target":{"type":"elements","count":3,"name":""}},"# +
            #"{"op":"reorder","block":0,"target":{"type":"slide","number":"3"}},"# +
            #"{"op":"transmogrify","block":0,"target":{"type":"galaxy"},"afterImage":"https://elsewhere.test/x.png"},"# +
            #"{"op":"delete","block":0,"beforeImage":"//elsewhere.test/x.png","afterImage":5},"# +
            #"{"block":1},"nope"],"proposed":{"title":"Deck","blocks":[]}}"#
        let expected = Proposal.Edit(
            id: "pr2", pageId: "s1", pageTitle: "Deck", baseVersion: 7,
            changes: [
                ProposalChange(
                    op: .update, block: 0, target: .slide(number: 2), before: "Old", after: "New",
                    beforeImage: "/api/proposals/pr2/image?change=0&side=before", afterImage: "/api/proposals/pr2/image?change=0&side=after"
                ),
                ProposalChange(op: .add, block: 0, target: .elements(count: 1, name: "Sticky")),
                // 空的名字和没有一样。
                ProposalChange(op: .move, block: 0, target: .elements(count: 3)),
                // 对象的形状不对：只剩操作。
                ProposalChange(op: .reorder, block: 0),
                // 不认识的操作按 update；别的站点的缩略图不收（要带 Cookie 读）。
                ProposalChange(op: .update, block: 0),
                ProposalChange(op: .delete, block: 0),
            ],
            status: "applied", appliedPageId: "s1", pageKind: .slides, autoApplied: true, undoable: true
        )
        XCTAssertEqual(apply(json), [.proposal(.edit(expected))])
        let proposal = Proposal.edit(expected)
        XCTAssertEqual(proposal.pageKind, .slides)
        XCTAssertTrue(proposal.autoApplied)
        XCTAssertTrue(proposal.undoable)
        XCTAssertEqual(proposal.changes.count, 6)
        // 不认识的页面类型按笔记。
        XCTAssertEqual(Activity.parseEditProposal(JSONValue.parse(json.replacingOccurrences(of: #""slides""#, with: #""spreadsheet""#))!)?.pageKind, .note)
        XCTAssertEqual(ProposalOp.allCases.map(\.rawValue), ["replace", "insert_after", "delete", "add", "update", "move", "reorder"])
    }

    func testReadsANewPageInsideAParentWithItsThumbnails() {
        let json = #"{"type":"create_proposal","id":"np2","title":"Board","icon":"🎨","content":"Ideas","parentId":"p9","parentTitle":"","# +
            #""pageKind":"whiteboard","status":"undone","appliedPageId":"w1","# +
            #""changes":[{"op":"add","block":0,"target":{"type":"elements","count":4},"afterImage":"/api/proposals/np2/image?change=0&side=after"}],"# +
            #""proposed":{"title":"Board","icon":"🎨","blocks":[]}}"#
        let expected = Proposal.Create(
            id: "np2", title: "Board", icon: "🎨", content: "Ideas", status: "undone", appliedPageId: "w1",
            parentId: "p9", parentTitle: "",
            changes: [
                ProposalChange(op: .add, block: 0, target: .elements(count: 4), afterImage: "/api/proposals/np2/image?change=0&side=after"),
            ],
            pageKind: .whiteboard
        )
        XCTAssertEqual(apply(json), [.proposal(.create(expected))])
        // 不是数组的 changes 当没有；旧的新建提案没有父页面。
        let plain = Activity.parseCreateProposal(JSONValue.parse(json.replacingOccurrences(of: #""changes":["#, with: #""changes":5,"x":["#))!)
        XCTAssertEqual(plain?.changes, [])
        let old = Activity.parseCreateProposal(
            JSONValue.parse(#"{"id":"np3","title":"Plan","content":"","proposed":{"title":"Plan","blocks":[]}}"#)!
        )
        XCTAssertNil(old?.parentTitle)
        XCTAssertEqual(old?.pageKind, .note)
        XCTAssertFalse(old?.undoable ?? true)
    }

    func testStoredProposalsKeepTheUndoneStatusAndTheNewFields() {
        let stored = Activity.parseStoredProposals(
            JSONValue.parse(
                #"[{"kind":"proposal","id":"pr1","pageId":"w1","pageTitle":"Board","baseVersion":3,"changes":[],"# +
                    #""proposed":{"title":"Board","blocks":[]},"status":"undone","appliedPageId":"w1","pageKind":"whiteboard"},"# +
                    #"{"kind":"create_proposal","id":"np1","title":"Deck","icon":null,"content":"","# +
                    #""proposed":{"title":"Deck","icon":null,"blocks":[]},"status":"applied","appliedPageId":"s2","pageKind":"slides","autoApplied":true,"undoable":true}]"#
            )
        )
        XCTAssertEqual(stored.map(\.status), ["undone", "applied"])
        XCTAssertEqual(stored.map(\.pageKind), [.whiteboard, .slides])
        XCTAssertEqual(stored.map(\.autoApplied), [false, true])
        XCTAssertEqual(stored.map(\.undoable), [false, true])
        XCTAssertEqual(stored.map(\.editedPageId), ["w1", nil])
        XCTAssertEqual(stored.map(\.appliedPageId), ["w1", "s2"])
    }

    func testTracksAPageToolFromRunningToItsFinishedLabel() {
        let steps = apply(
            #"{"type":"tool","id":"call1","name":"read_note","status":"running"}"#,
            #"{"type":"tool","id":"call1","name":"read_note","status":"done","label":"Read “Notes”"}"#
        )
        XCTAssertEqual(steps, [.tool(id: "call1", done: true, name: "read_note", label: "Read “Notes”")])
        XCTAssertNil(event(#"{"type":"tool","name":"read_note"}"#))
    }

    func testKeepsOnlySafeSearchSources() {
        let steps = apply(
            #"{"type":"web","id":"ws","status":"done","action":{"kind":"search","queries":["a","b"],"sources":["https://example.com/x","javascript:alert(1)"]}}"#
        )
        XCTAssertEqual(steps, [.web(id: "ws", done: true, action: .search(queries: ["a", "b"], sources: ["https://example.com/x"]))])
    }

    func testRestoresStoredProgressSteps() {
        let raw = #"[{"id":"rs:0","kind":"thought","text":"**Plan**\n\nCheck docs."},"# +
            #"{"id":"ws","kind":"web","status":"done","action":{"kind":"search","queries":["a"],"sources":["https://example.com/x"]}},"# +
            #"{"id":"call1","kind":"tool","status":"done","name":"read_note","label":"Read “Notes”"}]"#
        XCTAssertEqual(
            Activity.parseStored(raw: raw),
            [
                .thought(id: "rs:0", text: "**Plan**\n\nCheck docs."),
                .web(id: "ws", done: true, action: .search(queries: ["a"], sources: ["https://example.com/x"])),
                .tool(id: "call1", done: true, name: "read_note", label: "Read “Notes”"),
            ]
        )
    }

    func testDropsBrokenOrUnsafeStoredActivity() {
        XCTAssertEqual(Activity.parseStored(raw: nil), [])
        XCTAssertEqual(Activity.parseStored(raw: "not json"), [])
        XCTAssertEqual(Activity.parseStored(raw: #"{"a":1}"#), [])
        XCTAssertEqual(
            Activity.parseStored(
                raw: #"[{"id":"x","kind":"thought"},{"kind":"thought","text":"no id"},"# +
                    #"{"id":"ws","kind":"web","status":"running","action":{"kind":"open_page","url":"javascript:alert(1)"}},"# +
                    #"{"id":"t","kind":"tool","status":"running","name":"search_notes"}]"#
            ),
            [.tool(id: "t", done: true, name: "search_notes")]
        )
    }

    func testDoesNotRestoreASearchThatNeverFinished() {
        XCTAssertEqual(Activity.parseStored(raw: #"[{"id":"ws","kind":"web","status":"done"}]"#), [])
    }

    func testIgnoresEventsThatAreNotActivity() {
        XCTAssertNil(event(#"{"type":"response.output_text.delta","delta":"hi"}"#))
        XCTAssertNil(event(#"{"type":"thought","id":"x","delta":""}"#))
        // 不安全的地址：搜索步骤保留，但没有 action。
        XCTAssertEqual(
            apply(#"{"type":"web","id":"ws","status":"done","action":{"kind":"open_page","url":"file:///etc/passwd"}}"#),
            [.web(id: "ws", done: true, action: nil)]
        )
    }

    func testStoresTheRequestFailurePosition() {
        let steps = apply(#"{"type":"failure","id":"request-failure","offset":5,"detail":"Boom"}"#)
        XCTAssertEqual(steps, [.failure(id: "request-failure", offset: 5, detail: "Boom")])
        XCTAssertEqual(steps.progressSteps(), [])
    }

    // Android SystemTextTest 里 FailureInfo.from 的那几条（这里是 Activity.parseFailure）。
    func testReadsTheFailurePositionOnlyFromWellFormedFailures() {
        func failure(_ json: String) -> String? {
            Activity.parseFailure(JSONValue.parse(json)).map { "\($0.offset):\($0.detail)" }
        }
        XCTAssertEqual(failure(#"{"type":"failure","id":"f","offset":3,"detail":"Boom"}"#), "3:Boom")
        XCTAssertEqual(failure(#"{"id":"f","kind":"failure","offset":0,"detail":"Boom"}"#), "0:Boom")
        XCTAssertNil(failure(#"{"type":"failure","offset":"3","detail":"Boom"}"#))
        XCTAssertNil(failure(#"{"type":"tool","offset":3,"detail":"Boom"}"#))
        XCTAssertNil(failure(#"{"type":"failure","offset":-1,"detail":"Boom"}"#))
        XCTAssertNil(failure(#"[1]"#))
    }

    // ---- 项目上下文 ----

    private let context = #"{"type":"context","id":"project-context","projectName":"Mail","hasInstructions":true,"# +
        #""notes":[{"id":"n1","title":"Style guide"},{"id":"n2","title":"Long note","truncated":true}]}"#
    private let contextStep = ActivityStep.context(
        id: "project-context",
        info: ContextInfo(
            projectName: "Mail", hasInstructions: true,
            notes: [ContextNote(id: "n1", title: "Style guide"), ContextNote(id: "n2", title: "Long note", truncated: true)]
        )
    )

    func testTurnsTheProjectContextIntoAStepThatIsRestoredWithTheAnswer() {
        let steps = apply(context, #"{"type":"thought","id":"rs:0","delta":"Plan"}"#)
        XCTAssertEqual(steps, [contextStep, .thought(id: "rs:0", text: "Plan")])
        XCTAssertEqual(contextStep.id, Activity.contextStepId)
        let stored = #"[{"id":"project-context","kind":"context","projectName":"Mail","hasInstructions":true,"# +
            #""notes":[{"id":"n1","title":"Style guide"},{"id":"n2","title":"Long note","truncated":true}]},{"id":"rs:0","kind":"thought","text":"Plan"}]"#
        XCTAssertEqual(Activity.parseStored(raw: stored), steps)
    }

    func testReplacesTheStepWhenTheSameContextArrivesAgain() {
        let steps = apply(
            context,
            #"{"type":"context","id":"project-context","projectName":"Mail","hasInstructions":true,"notes":[{"id":"n3","title":"New"}]}"#
        )
        XCTAssertEqual(steps.count, 1)
        guard case .context(_, let info) = steps[0] else { return XCTFail("not a context") }
        XCTAssertEqual(info.notes, [ContextNote(id: "n3", title: "New")])
    }

    func testCapsStringsAndTheNumberOfNotesAndDropsMalformedNotes() {
        var notes = [
            #"{"id":"a","title":"\#(String(repeating: "T", count: 500))"}"#,
            #"{"id":"a","title":"duplicate"}"#,
            #"{"id":"","title":"no id"}"#,
            #"{"id":"b","title":5}"#,
            #"{"id":"\#(String(repeating: "c", count: 101))","title":"long id"}"#,
            #"{"id":"d","title":"","truncated":"yes"}"#,
        ]
        for index in 0..<20 { notes.append(#"{"id":"n\#(index)","title":"Note \#(index)"}"#) }
        let steps = apply(
            #"{"type":"context","id":"project-context","projectName":"\#(String(repeating: "P", count: 500))","hasInstructions":false,"notes":[\#(notes.joined(separator: ","))]}"#
        )
        XCTAssertEqual(steps.count, 1)
        guard case .context(_, let info)? = steps.first else { return XCTFail("not a context") }
        XCTAssertEqual(info.projectName.count, 300)
        XCTAssertEqual(info.notes.count, 10)
        XCTAssertEqual(
            Array(info.notes.prefix(2)),
            [ContextNote(id: "a", title: String(repeating: "T", count: 300)), ContextNote(id: "d", title: "Untitled")]
        )
    }

    func testIgnoresAContextWithNothingToShow() {
        XCTAssertNil(event(#"{"type":"context","id":"project-context","projectName":"Mail","hasInstructions":false,"notes":[]}"#))
        XCTAssertNil(event(#"{"type":"context","id":"project-context","projectName":" ","hasInstructions":true,"notes":[]}"#))
    }

    func testDropsMalformedStoredContextButKeepsWhatIsValid() {
        let raw = #"[{"id":"project-context","kind":"context","projectName":5,"hasInstructions":true,"notes":[]},"# +
            #"{"id":"x","kind":"context","projectName":"A","hasInstructions":false,"notes":"none"},"# +
            #"{"id":"y","kind":"context","projectName":"B","hasInstructions":true,"notes":"none"},"# +
            #"{"id":"z","kind":"context","projectName":"C","hasInstructions":false,"notes":[{"id":"n1","title":"Ok","truncated":true},null,{"id":3}]}]"#
        XCTAssertEqual(
            Activity.parseStored(raw: raw),
            [
                .context(id: "y", info: ContextInfo(projectName: "B", hasInstructions: true, notes: [])),
                .context(
                    id: "z",
                    info: ContextInfo(projectName: "C", hasInstructions: false, notes: [ContextNote(id: "n1", title: "Ok", truncated: true)])
                ),
            ]
        )
    }

    func testSummarizesSearchesSourcesNoteLookupsAndProjectContext() {
        let steps = apply(
            context,
            #"{"type":"web","id":"w1","status":"done","action":{"kind":"search","queries":["a","b"],"sources":["https://x.com/1","https://x.com/2"]}}"#,
            #"{"type":"web","id":"w2","status":"done","action":{"kind":"open_page","url":"https://x.com/1"}}"#,
            #"{"type":"web","id":"w3","status":"done","action":{"kind":"search","queries":[],"sources":[]}}"#,
            #"{"type":"tool","id":"t1","name":"search_notes","status":"done"}"#
        )
        XCTAssertEqual(
            ActivitySummary.of(steps),
            ActivitySummary(searches: 3, sources: 2, noteLookups: 1, projectNotes: 2, projectInstructions: true)
        )
    }

    func testStoredProposalsComeFirstAndLiveOnesAreAddedOnce() {
        let stored = Activity.parseStoredProposals(
            JSONValue.parse(
                #"[{"kind":"proposal","id":"pr1","pageId":"p1","pageTitle":"Notes","baseVersion":2,"changes":[],"proposed":{"title":"Notes","blocks":[]},"status":"applied"}]"#
            )
        )
        XCTAssertEqual(stored.count, 1)
        XCTAssertEqual(stored.first?.status, "applied")
        let live = apply(
            #"{"type":"proposal","id":"pr1","pageId":"p1","pageTitle":"Notes","baseVersion":2,"changes":[],"proposed":{"title":"Notes","blocks":[]}}"#,
            #"{"type":"create_proposal","id":"np1","title":"Plan","content":"","proposed":{"title":"Plan","blocks":[]}}"#
        )
        let merged = mergeProposals(stored, live)
        XCTAssertEqual(merged.map(\.id), ["pr1", "np1"])
        XCTAssertEqual(merged[0].status, "applied")
        XCTAssertTrue(live.progressSteps().isEmpty)
    }

    func testHostDropsWww() {
        XCTAssertEqual(Activity.hostOf("https://www.example.com/a"), "example.com")
        XCTAssertEqual(Activity.hostOf("not a url"), "not a url")
    }
}
