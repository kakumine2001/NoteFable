import Foundation

/// 让回答里的提案能交给 `ProposalStore`（应用 / 放弃 / 撤销）。编辑提案带要改的页面 ID，新建提案没有。
/// `id`、`status`、`appliedPageId`、`undoable` 在 Activity.swift 的 Proposal 上。
extension Proposal: ProposalTarget {
    var editedPageId: String? {
        if case .edit(let edit) = self { return edit.pageId }
        return nil
    }
}
