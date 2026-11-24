import XCTest
@testable import NoteFableCore

/// 提案卡片选哪一句文案（网页 page-proposal.tsx 的 PageEditProposal / PageCreateProposal / changeLabel）。
/// 测试里 `L` 返回键本身，所以这里比的是选中的键。
final class ProposalCopyTests: XCTestCase {
    private let kinds: [PageKind] = [.note, .whiteboard, .slides]

    private func edit(_ kind: PageKind = .note, autoApplied: Bool = false) -> Proposal {
        .edit(Proposal.Edit(id: "pr", pageId: "p", pageTitle: "Deck", baseVersion: 1, pageKind: kind, autoApplied: autoApplied))
    }

    private func create(_ kind: PageKind = .note, autoApplied: Bool = false) -> Proposal {
        .create(Proposal.Create(id: "np", title: "Plan", content: "", pageKind: kind, autoApplied: autoApplied))
    }

    func testTitlesLabelsAndButtonsFollowThePageKind() {
        // 编辑都是"对“…”的修改建议"；新建按类型。
        XCTAssertEqual(kinds.map { ProposalCopy.title(edit($0)) }, Array(repeating: "proposal_edit_title", count: 3))
        XCTAssertEqual(kinds.map { ProposalCopy.title(create($0)) }, ["proposal_new_title", "proposal_new_whiteboard_title", "proposal_new_slides_title"])
        // 读屏念的名字：笔记说"笔记"，别的说"页面"。
        XCTAssertEqual(kinds.map { ProposalCopy.label(edit($0)) }, ["proposal_edit_label", "proposal_edit_page_label", "proposal_edit_page_label"])
        XCTAssertEqual(kinds.map { ProposalCopy.label(create($0)) }, ["proposal_new_label", "proposal_new_page_label", "proposal_new_page_label"])
        XCTAssertEqual(kinds.map { ProposalCopy.applyLabel(edit($0)) }, Array(repeating: "proposal_apply", count: 3))
        XCTAssertEqual(kinds.map { ProposalCopy.applyLabel(create($0)) }, ["proposal_create", "proposal_create_whiteboard", "proposal_create_slides"])
        XCTAssertEqual(kinds.map { ProposalCopy.openLabel(edit($0)) }, ["proposal_open_note", "proposal_open_page", "proposal_open_page"])
        XCTAssertEqual(kinds.map { ProposalCopy.emptyContent($0) }, ["proposal_empty_note", "proposal_empty_page", "proposal_empty_page"])
    }

    func testBadgesSayWhetherTheChangeWasMadeAutomatically() {
        let applied = ProposalState(status: .applied)
        XCTAssertEqual(ProposalCopy.badge(edit(), applied), "proposal_applied")
        XCTAssertEqual(ProposalCopy.badge(edit(autoApplied: true), applied), "proposal_applied_auto")
        XCTAssertEqual(ProposalCopy.badge(create(), applied), "proposal_created")
        XCTAssertEqual(ProposalCopy.badge(create(autoApplied: true), applied), "proposal_created_auto")
        XCTAssertEqual(ProposalCopy.badge(edit(), ProposalState(status: .discarded)), "proposal_discarded")
        XCTAssertEqual(ProposalCopy.badge(create(autoApplied: true), ProposalState(status: .undone)), "proposal_undone")
        // 撤销中还是"已应用"。
        XCTAssertEqual(ProposalCopy.badge(edit(autoApplied: true), ProposalState(status: .undoing)), "proposal_applied_auto")
        XCTAssertEqual(ProposalCopy.badge(create(), ProposalState(status: .undoing)), "proposal_created")
        for status in [ProposalState.Status.idle, .applying, .discarding] {
            XCTAssertNil(ProposalCopy.badge(edit(), ProposalState(status: status)), "\(status)")
        }
    }

    func testChangeLabelsNameTheBlockTheSlideOrTheElements() {
        XCTAssertEqual(ProposalCopy.changeLabel(ProposalChange(op: .replace, block: 3), kind: .note), "proposal_op_block")
        XCTAssertEqual(ProposalCopy.changeLabel(ProposalChange(op: .insertAfter, block: 0), kind: .note), "proposal_op_start")
        XCTAssertEqual(ProposalCopy.changeLabel(ProposalChange(op: .update, block: 0, target: .slide(number: 2)), kind: .slides), "proposal_op_slide")
        XCTAssertEqual(
            ProposalCopy.changeLabel(ProposalChange(op: .add, block: 0, target: .elements(count: 1, name: "Sticky")), kind: .whiteboard),
            "proposal_op_named"
        )
        XCTAssertEqual(ProposalCopy.changeLabel(ProposalChange(op: .move, block: 0, target: .elements(count: 3)), kind: .whiteboard), "proposal_op_elements")
        // 不是笔记又没有对象：只写操作，不写"开头"。
        XCTAssertEqual(ProposalCopy.changeLabel(ProposalChange(op: .reorder, block: 0), kind: .slides), "proposal_op_reorder")
        XCTAssertEqual(
            ProposalOp.allCases.map(ProposalCopy.opKey),
            ["proposal_op_replace", "proposal_op_insert", "proposal_op_delete", "proposal_op_add", "proposal_op_update", "proposal_op_move", "proposal_op_reorder"]
        )
    }

    func testANewSubpageSaysWhichPageItGoesInside() {
        XCTAssertNil(ProposalCopy.inside(Proposal.Create(id: "np", title: "Plan", content: "")))
        XCTAssertEqual(ProposalCopy.inside(Proposal.Create(id: "np", title: "Plan", content: "", parentTitle: "Projects")), "proposal_inside")
        // 父页面没有标题时也显示（写 Untitled）。
        XCTAssertEqual(ProposalCopy.inside(Proposal.Create(id: "np", title: "Plan", content: "", parentTitle: "")), "proposal_inside")
    }

    func testFailuresShowTheServerSentenceOrTheLocalFallback() {
        let system = SystemText.empty.translator("en")
        let sentence = "Only an applied change can be undone."
        XCTAssertEqual(ProposalCopy.errorText(ProposalError(action: .undo, serverMessage: sentence), system), sentence)
        XCTAssertEqual(ProposalCopy.errorText(ProposalError(action: .undo, serverMessage: nil), system), "proposal_undo_failed")
        XCTAssertEqual(ProposalCopy.errorText(ProposalError(action: .apply, serverMessage: nil), system), "proposal_apply_failed")
    }
}
