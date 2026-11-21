import Foundation

/// 让回答里的提案能交给 `ProposalStore`（应用 / 放弃）。编辑提案带要改的笔记 ID，新建提案没有。
extension Proposal: ProposalTarget {
    var editedPageId: String? {
        if case .edit(let edit) = self { return edit.pageId }
        return nil
    }
}
