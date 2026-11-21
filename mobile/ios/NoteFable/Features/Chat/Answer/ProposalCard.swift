import SwiftUI

// AI 的笔记提案卡片（网页 page-edit-proposal.tsx + globals.css 的 .page-edit*，Android `ProposalCard.kt`）：
//  - 外框：上距 13.6、1px --notion-border-strong、圆角 8；字 13.6 / 行高 1.55；已处理（应用 / 放弃）的卡片透明度 .72；
//  - 标题行：内边距 8×12、--notion-sidebar 底、600、正文色；箭头 14（描边 2，--notion-faint），展开转 90°，图标 14（描边 1.9），间距 7.2；
//    最小化时：上距 8、边框换成 --notion-border、内边距 4×9.6、透明底、12.8 / 500 / 灰色；
//  - 徽标：圆角 4、--notion-hover 底、左右 6.4、灰色 12 / 500；
//  - 正文：最高 352 可滚动、改动之间 9.6、内边距 10.4×12；操作名灰色 12、下距 3.2；
//    改前：红 .1 底、删除线（红 .45）；改后：绿 .14 底；都圆角 4、内边距 4.8×8、下距 3.2；警告 #cb912f 12、上距 2.4；
//  - 错误：#e03e3e，左右 12、下 8；
//  - 按钮行：上边线 --notion-border、内边距 8×12、间距 8；按钮圆角 6、内边距 4×11.2、13.12 / 500、图标 13、间距 4.8；
//    应用键 --nf-ink 底白字；放弃键 1px --notion-border-strong 边框；忙时 .6 透明；链接 --notion-blue 带下划线。
// 状态（应用中 / 已应用 / 已放弃 / 出错）在 `ProposalStore` 里按提案 ID 存着，回答重读历史后也不丢。

private let cardFontSize: CGFloat = 13.6
private let cardLineHeight: CGFloat = 21.08
private let beforeBackground = Color(argb: 0x1AE03E3E)
private let beforeStrike = Color(argb: 0x73E03E3E)
private let afterBackground = Color(argb: 0x24448361)
private let warningInk = Color(argb: 0xFFCB912F)
private let cardErrorInk = Color(argb: 0xFFE03E3E)

/// 回答下面的提案卡片（一条回答可以有几张）。
struct ProposalCards: View {
    let proposals: [Proposal]

    var body: some View {
        ForEach(proposals) { proposal in
            ProposalCard(proposal: proposal)
        }
    }
}

struct ProposalCard: View {
    let proposal: Proposal

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.layoutDirection) private var layoutDirection
    /// nil 表示用户没点过：已处理的卡片默认最小化，待确认的展开。
    @State private var manualOpen: Bool? = nil

    var body: some View {
        // 读 `ProposalStore.states`：应用 / 放弃的进度变了卡片跟着变。
        let state = app.proposals.stateOf(proposal)
        // 应用中、有错误时一定展开，结果看得见。
        let open = state.busy || state.error != nil || (manualOpen ?? !state.settled)
        let shape = RoundedRectangle(cornerRadius: 8)
        VStack(alignment: .leading, spacing: 0) {
            header(state: state, open: open)
            if open {
                FittingScrollView(maxHeight: 352) {
                    VStack(alignment: .leading, spacing: 9.6) {
                        changes
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10.4)
                }
                if let error = state.error {
                    cardText(errorText(error), color: cardErrorInk)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                }
                if !state.settled {
                    footer {
                        ProposalActionButton(
                            title: applyLabel, icon: Lucide.check, primary: true,
                            busy: state.busy, spinning: state.status == .applying
                        ) {
                            app.proposals.apply(proposal)
                        }
                        ProposalActionButton(
                            title: L("proposal_discard"), icon: Lucide.x, primary: false,
                            busy: state.busy, spinning: false
                        ) {
                            app.proposals.discard(proposal)
                        }
                    }
                }
                if state.status == .applied, let pageId = state.pageId {
                    footer {
                        ProposalLink(title: L("proposal_open_note"), size: 13.6) { router.openNote(pageId) }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(shape)
        .overlay { shape.strokeBorder(open ? Sm.borderStrong : Sm.border, lineWidth: 1) }
        .opacity(state.settled ? 0.72 : 1)
        .padding(.top, open ? 13.6 : 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(cardLabel)
    }

    // MARK: 标题行

    private func header(state: ProposalState, open: Bool) -> some View {
        let ink = open ? Sm.text : Sm.muted
        return HStack(spacing: 7.2) {
            Button {
                manualOpen = !open
            } label: {
                HStack(spacing: 7.2) {
                    LucideIcon(Lucide.chevronRight, size: 14, strokeWidth: 2, color: Sm.faint)
                        .rotationEffect(.degrees(open ? (layoutDirection == .rightToLeft ? -90 : 90) : 0))
                    LucideIcon(icon, size: 14, strokeWidth: 1.9, color: ink)
                    Text(title)
                        .font(.nf(open ? cardFontSize : 12.8, weight: open ? 600 : 500))
                        .nfLineHeight(open ? cardLineHeight : 19.84, fontSize: open ? cardFontSize : 12.8)
                        .foregroundStyle(ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let badge = badge(state) {
                        Text(badge)
                            .font(.nf(12, weight: 500))
                            .nfLineHeight(18.6, fontSize: 12)
                            .foregroundStyle(Sm.muted)
                            .lineLimit(1)
                            .padding(.horizontal, 6.4)
                            .background(Sm.hover, in: RoundedRectangle(cornerRadius: 4))
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(open ? L("proposal_minimize") : L("proposal_expand"))
            if !open, state.status == .applied, let pageId = state.pageId {
                ProposalLink(title: L("proposal_open"), size: 12.48) { router.openNote(pageId) }
            }
        }
        .padding(.horizontal, open ? 12 : 9.6)
        .padding(.vertical, open ? 8 : 4)
        .background(open ? Sm.sidebar : Color.clear)
    }

    private func badge(_ state: ProposalState) -> String? {
        switch state.status {
        case .applied:
            if case .create = proposal { return L("proposal_created") }
            return L("proposal_applied")
        case .discarded:
            return L("proposal_discarded")
        case .idle, .applying, .discarding:
            return nil
        }
    }

    private var icon: [String] {
        switch proposal {
        case .edit: return Lucide.filePenLine
        case .create: return Lucide.filePlus2
        }
    }

    private var title: String {
        switch proposal {
        case .edit(let edit):
            return L("proposal_edit_title", edit.pageTitle)
        case .create(let create):
            return L("proposal_new_title", create.icon.map { " \($0)" } ?? "", create.title)
        }
    }

    /// 读屏念的卡片名。
    private var cardLabel: String {
        switch proposal {
        case .edit: return L("proposal_edit_label")
        case .create: return L("proposal_new_label")
        }
    }

    private var applyLabel: String {
        switch proposal {
        case .edit: return L("proposal_apply")
        case .create: return L("proposal_create")
        }
    }

    private func errorText(_ error: ProposalError) -> String {
        if let message = error.serverMessage { return app.systemText.localize(message) }
        return L(error.action == .apply ? "proposal_apply_failed" : "proposal_discard_failed")
    }

    // MARK: 正文

    @ViewBuilder
    private var changes: some View {
        switch proposal {
        case .edit(let edit):
            if edit.titleBefore != nil || edit.titleAfter != nil {
                VStack(alignment: .leading, spacing: 0) {
                    opLabel(L("proposal_rename"))
                    beforeText(edit.titleBefore ?? "")
                    afterText(edit.titleAfter ?? "")
                }
            }
            ForEach(Array(edit.changes.enumerated()), id: \.offset) { _, change in
                VStack(alignment: .leading, spacing: 0) {
                    opLabel(opText(change))
                    if let before = change.before { beforeText(before) }
                    if let after = change.after { afterText(after) }
                    if change.dropsMedia { warning(L("proposal_drops_media")) }
                    if change.dropsFormatting { warning(L("proposal_drops_formatting")) }
                }
            }
        case .create(let create):
            VStack(alignment: .leading, spacing: 0) {
                if create.content.isEmpty {
                    opLabel(L("proposal_empty_note"))
                } else {
                    afterText(create.content)
                }
            }
        }
    }

    private func opText(_ change: ProposalChange) -> String {
        let op: String
        switch change.op {
        case "insert_after": op = L("proposal_op_insert")
        case "delete": op = L("proposal_op_delete")
        default: op = L("proposal_op_replace")
        }
        return change.block != 0 ? L("proposal_op_block", op, String(change.block)) : L("proposal_op_start", op)
    }

    private func opLabel(_ text: String) -> some View {
        Text(text)
            .font(.nf(12))
            .nfLineHeight(18.6, fontSize: 12)
            .foregroundStyle(Sm.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 3.2)
    }

    private func beforeText(_ text: String) -> some View {
        Text(text)
            .font(.nf(cardFontSize))
            .strikethrough(true, color: beforeStrike)
            .nfLineHeight(cardLineHeight, fontSize: cardFontSize)
            .foregroundStyle(Sm.text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 4.8)
            .background(beforeBackground, in: RoundedRectangle(cornerRadius: 4))
            .padding(.bottom, 3.2)
    }

    private func afterText(_ text: String) -> some View {
        Text(text)
            .font(.nf(cardFontSize))
            .nfLineHeight(cardLineHeight, fontSize: cardFontSize)
            .foregroundStyle(Sm.text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 4.8)
            .background(afterBackground, in: RoundedRectangle(cornerRadius: 4))
            .padding(.bottom, 3.2)
    }

    private func warning(_ text: String) -> some View {
        Text(text)
            .font(.nf(12))
            .nfLineHeight(18.6, fontSize: 12)
            .foregroundStyle(warningInk)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 2.4)
    }

    private func cardText(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.nf(cardFontSize))
            .nfLineHeight(cardLineHeight, fontSize: cardFontSize)
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: 按钮行

    private func footer<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 8) {
            content()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .overlay(alignment: .top) { NFDivider() }
    }
}

/// 应用 / 放弃：圆角 6、内边距 4×11.2、13.12 / 500、图标 13（忙时"应用"的图标换成转圈）。
private struct ProposalActionButton: View {
    let title: String
    let icon: [String]
    let primary: Bool
    let busy: Bool
    let spinning: Bool
    let action: () -> Void

    var body: some View {
        let ink: Color = primary ? .white : Sm.text
        let shape = RoundedRectangle(cornerRadius: 6)
        Button(action: action) {
            HStack(spacing: 4.8) {
                if spinning {
                    Spinner(size: 13, color: ink, strokeWidth: 2)
                } else {
                    LucideIcon(icon, size: 13, strokeWidth: 2, color: ink)
                }
                Text(title)
                    .font(.nf(13.12, weight: 500))
                    .nfLineHeight(20.34, fontSize: 13.12)
                    .foregroundStyle(ink)
                    .lineLimit(1)
            }
            .padding(.horizontal, 11.2)
            .padding(.vertical, 4)
            .overlay { shape.strokeBorder(primary ? Color.clear : Sm.borderStrong, lineWidth: 1) }
        }
        .buttonStyle(.pressable(
            background: primary ? Sm.ink : .clear,
            pressedBackground: primary ? Sm.inkHover : Sm.hover,
            cornerRadius: 6,
            disabledOpacity: 0.6
        ))
        .disabled(busy)
    }
}

/// 蓝色带下划线的文字链接（"打开笔记"）。
private struct ProposalLink: View {
    let title: String
    let size: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.nf(size))
                .underline()
                .nfLineHeight(size * 1.55, fontSize: size)
                .foregroundStyle(Sm.blue)
                .lineLimit(1)
        }
        .buttonStyle(.plain)
    }
}
