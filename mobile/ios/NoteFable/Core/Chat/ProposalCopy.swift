import Foundation

/// 提案卡片上的文字（网页 page-proposal.tsx 的 PageEditProposal / PageCreateProposal / changeLabel，Android `ProposalCard.kt`）。
/// 卡片不分页面类型，只按提案里的页面类型（`pageKind`）和卡片状态选文案；界面（Features/Chat/Answer/ProposalCard.swift）只管画。
/// 放在 Core 里是为了能单元测试选的是哪一句（测试里 `L` 返回键本身）。
enum ProposalCopy {
    /// 标题行：编辑都是"对“…”的修改建议"；新建按类型（笔记前面带它的表情）。
    static func title(_ proposal: Proposal) -> String {
        switch proposal {
        case .edit(let edit):
            return L("proposal_edit_title", edit.pageTitle)
        case .create(let create):
            switch create.pageKind {
            case .whiteboard:
                return L("proposal_new_whiteboard_title", create.title)
            case .slides:
                return L("proposal_new_slides_title", create.title)
            case .note:
                // 上传的图片图标写不进文字（网页 noteIconText）。
                let icon = NoteIcons.text(create.icon).flatMap { $0.isEmpty ? nil : " \($0)" } ?? ""
                return L("proposal_new_title", icon, create.title)
            }
        }
    }

    /// 读屏念的卡片名：笔记说"笔记"，别的类型说"页面"。
    static func label(_ proposal: Proposal) -> String {
        let note = proposal.pageKind == .note
        switch proposal {
        case .edit: return L(note ? "proposal_edit_label" : "proposal_edit_page_label")
        case .create: return L(note ? "proposal_new_label" : "proposal_new_page_label")
        }
    }

    /// 主按钮：编辑是"应用"，新建按类型是"建笔记 / 建白板 / 建幻灯片"。
    static func applyLabel(_ proposal: Proposal) -> String {
        switch proposal {
        case .edit:
            return L("proposal_apply")
        case .create(let create):
            switch create.pageKind {
            case .note: return L("proposal_create")
            case .whiteboard: return L("proposal_create_whiteboard")
            case .slides: return L("proposal_create_slides")
            }
        }
    }

    /// 标题行右边的徽标；没处理完的没有。自动应用的写"已自动应用 / 已自动创建"。
    static func badge(_ proposal: Proposal, _ state: ProposalState) -> String? {
        let created = proposal.editedPageId == nil
        switch state.status {
        case .applied:
            if proposal.autoApplied { return L(created ? "proposal_created_auto" : "proposal_applied_auto") }
            return L(created ? "proposal_created" : "proposal_applied")
        case .discarded:
            return L("proposal_discarded")
        case .undone:
            return L("proposal_undone")
        case .idle, .applying, .discarding, .undoing:
            return nil
        }
    }

    /// 按钮行里"打开"的链接文字。
    static func openLabel(_ proposal: Proposal) -> String {
        L(proposal.pageKind == .note ? "proposal_open_note" : "proposal_open_page")
    }

    /// 新建提案没有正文时那一行。
    static func emptyContent(_ kind: PageKind) -> String {
        L(kind == .note ? "proposal_empty_note" : "proposal_empty_page")
    }

    /// 建成子页面时正文上面的"在“…”里"（父页面没有标题时写 Untitled）；不是子页面是 nil。
    static func inside(_ create: Proposal.Create) -> String? {
        guard let parent = create.parentTitle else { return nil }
        return L("proposal_inside", parent.isEmpty ? L("sb_untitled") : parent)
    }

    /// 一处改动的小标题（操作和对象）：笔记是第几块 / 开头，幻灯片是第几张，白板是元素（一个时写它的文字，几个时写个数）。
    /// 不是笔记又没有对象时只写操作。
    static func changeLabel(_ change: ProposalChange, kind: PageKind) -> String {
        let op = L(opKey(change.op))
        switch change.target {
        case .slide(let number)?:
            return L("proposal_op_slide", op, String(number))
        case .elements(let count, let name)?:
            if let name { return L("proposal_op_named", op, name) }
            return L("proposal_op_elements", op, String(count))
        case nil:
            if kind != .note { return op }
            return change.block != 0 ? L("proposal_op_block", op, String(change.block)) : L("proposal_op_start", op)
        }
    }

    static func opKey(_ op: ProposalOp) -> String {
        switch op {
        case .replace: return "proposal_op_replace"
        case .insertAfter: return "proposal_op_insert"
        case .delete: return "proposal_op_delete"
        case .add: return "proposal_op_add"
        case .update: return "proposal_op_update"
        case .move: return "proposal_op_move"
        case .reorder: return "proposal_op_reorder"
        }
    }

    /// 操作失败的原因：服务端原句经系统文词典翻译，没有时用本地的"无法应用 / 放弃 / 撤销"。
    static func errorText(_ error: ProposalError, _ system: SystemTextTranslator) -> String {
        error.serverMessage.map { system.localize($0) } ?? L(error.fallbackKey)
    }
}
