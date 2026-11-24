import SwiftUI
import UIKit

// AI 的页面提案卡片（网页 page-proposal.tsx + globals.css 的 .page-edit*，Android `ProposalCard.kt`）。
// 笔记、白板、幻灯片同一张卡片：改动的文字和缩略图是服务端各类型的适配器做好的（`ProposalChange`），这里照着画，不分类型。
//  - 外框：上距 13.6、1px --notion-border-strong、圆角 8；字 13.6 / 行高 1.55；已处理（应用 / 放弃 / 撤销）的卡片透明度 .72；
//  - 标题行：内边距 8×12、--notion-sidebar 底、600、正文色；箭头 14（描边 2，--notion-faint），展开转 90°，图标 14
//    （笔记 FilePenLine / FilePlus2 描边 1.9，白板、幻灯片是页面类型的图标、描边 2），间距 7.2；最右是"报告 AI 内容"的旗子
//    （24 见方、圆角 4、Flag 13 / 1.9、--notion-faint，按下灰底）；
//    最小化时：上距 8、边框换成 --notion-border、内边距 4×9.6、透明底、12.8 / 500 / 灰色；
//  - 徽标：圆角 4、--notion-hover 底、左右 6.4、灰色 12 / 500；
//  - 正文：最高 352 可滚动、改动之间 9.6、内边距 10.4×12；操作名灰色 12、下距 3.2；
//    改前：红 .1 底、删除线（红 .45）；改后：绿 .14 底；都圆角 4、内边距 4.8×8、下距 3.2；警告 #cb912f 12、上距 2.4；
//    缩略图（.page-edit-images / .page-edit-image）：改前、改后并排（间距 6.4、下距 3.2），各占一半宽、高按图片比例最高 176，
//    圆角 4、--notion-sidebar 底、1px 边框（改前 rgba(224,62,62,.45)、改后 rgba(68,131,97,.55)），图片按比例放在框里；
//  - 错误：#e03e3e，左右 12、下 8；
//  - 按钮行：上边线 --notion-border、内边距 8×12、间距 8；按钮圆角 6、内边距 4×11.2、13.12 / 500、图标 13、间距 4.8；
//    应用键 --nf-ink 底白字；放弃 / 撤销键 1px --notion-border-strong 边框；忙时 .6 透明；链接 --notion-blue 带下划线。
//    待确认：应用 + 放弃；已应用："打开…" + 撤销（服务端说能撤销，或刚在这台设备上应用过）；撤销中：撤销键转圈；
//    撤销过的编辑提案："打开…"；撤销过的新建提案：正文下面一行"页面已移到回收站"（#cb912f 12，左右 12、下 8）。
// 文案在 `ProposalCopy`，状态（应用中 / 已应用 / 撤销中 / 已撤销 / 已放弃 / 出错）在 `ProposalStore` 里按提案 ID 存着，回答重读历史后也不丢。
// 撤销中和网页一样算已处理：徽章还是"已应用"，不显示"应用 / 放弃"，只有撤销键转圈；编辑提案的"打开…"还在（新建的页面要进回收站，不给）。

private let cardFontSize: CGFloat = 13.6
private let cardLineHeight: CGFloat = 21.08
// 深色（:root[data-theme="dark"] .page-edit-before / .page-edit-after）：rgba(248,113,113,.16)、删除线 .55、rgba(52,211,153,.16)。
private let beforeBackground = Color(light: 0x1AE03E3E, dark: 0x29F87171)
private let beforeStrike = Color(light: 0x73E03E3E, dark: 0x8CF87171)
private let afterBackground = Color(light: 0x24448361, dark: 0x2934D399)
// .page-edit-image.is-before / .is-after 的边框（深色没有另设）。
private let beforeImageBorder = Color(argb: 0x73E03E3E)
private let afterImageBorder = Color(argb: 0x8C448361)
private let warningInk = Color(argb: 0xFFCB912F)
private let cardErrorInk = Color(light: 0xFFE03E3E, dark: 0xFFF87171) // .page-edit-error；深色是 --nf-danger

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
    /// "报告 AI 内容"的窗口（网页 Card 的 reporting）。
    @State private var reporting = false

    private var isEdit: Bool {
        if case .edit = proposal { return true }
        return false
    }

    var body: some View {
        // 读 `ProposalStore.states`：应用 / 放弃 / 撤销的进度变了卡片跟着变。
        let state = app.proposals.stateOf(proposal)
        // 处理中、有错误时一定展开，结果看得见。
        let open = state.busy || state.error != nil || (manualOpen ?? !state.settled)
        let openPageId = state.openPageId(isEdit: isEdit)
        let shape = RoundedRectangle(cornerRadius: 8)
        VStack(alignment: .leading, spacing: 0) {
            header(state: state, open: open, openPageId: openPageId)
            if open {
                FittingScrollView(maxHeight: 352) {
                    VStack(alignment: .leading, spacing: 9.6) {
                        content
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10.4)
                }
                if let error = state.error {
                    cardText(ProposalCopy.errorText(error, app.systemText), color: cardErrorInk)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                }
                if state.pending {
                    footer {
                        ProposalActionButton(
                            title: ProposalCopy.applyLabel(proposal), icon: Lucide.check, primary: true,
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
                if openPageId != nil || state.showsUndo {
                    footer {
                        if let openPageId {
                            ProposalLink(title: ProposalCopy.openLabel(proposal), size: cardFontSize) { router.openNote(openPageId) }
                        }
                        if state.showsUndo {
                            ProposalActionButton(
                                title: L("proposal_undo"), icon: Lucide.undo2, primary: false,
                                busy: state.busy, spinning: state.status == .undoing
                            ) {
                                app.proposals.undo(proposal)
                            }
                        }
                    }
                }
                if state.status == .undone && !isEdit {
                    Text(L("proposal_moved_to_trash"))
                        .font(.nf(12))
                        .nfLineHeight(18.6, fontSize: 12)
                        .foregroundStyle(warningInk)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(shape)
        .overlay { shape.strokeBorder(open ? Sm.borderStrong : Sm.border, lineWidth: 1) }
        .opacity(state.settled ? 0.72 : 1)
        .padding(.top, open ? 13.6 : 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(ProposalCopy.label(proposal))
        .reportDialog(.proposal(proposalId: proposal.id), isPresented: $reporting)
    }

    // MARK: 标题行

    private func header(state: ProposalState, open: Bool, openPageId: String?) -> some View {
        let ink = open ? Sm.text : Sm.muted
        return HStack(spacing: 7.2) {
            Button {
                manualOpen = !open
            } label: {
                HStack(spacing: 7.2) {
                    LucideIcon(Lucide.chevronRight, size: 14, strokeWidth: 2, color: Sm.faint)
                        .rotationEffect(.degrees(open ? (layoutDirection == .rightToLeft ? -90 : 90) : 0))
                    LucideIcon(headerIcon, size: 14, strokeWidth: proposal.pageKind == .note ? 1.9 : 2, color: ink)
                    Text(ProposalCopy.title(proposal))
                        .font(.nf(open ? cardFontSize : 12.8, weight: open ? 600 : 500))
                        .nfLineHeight(open ? cardLineHeight : 19.84, fontSize: open ? cardFontSize : 12.8)
                        .foregroundStyle(ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let badge = ProposalCopy.badge(proposal, state) {
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
            if !open, let openPageId {
                ProposalLink(title: L("proposal_open"), size: 12.48) { router.openNote(openPageId) }
            }
            // AI 做的内容，卡片上也能报告（应用商店对 AI 生成内容的要求）。
            NFIconButton(
                Lucide.flag, label: L("proposal_report"), size: 24, iconSize: 13, strokeWidth: 1.9,
                color: Sm.faint, cornerRadius: 4
            ) {
                reporting = true
            }
        }
        .padding(.horizontal, open ? 12 : 9.6)
        .padding(.vertical, open ? 8 : 4)
        .background(open ? Sm.sidebar : Color.clear)
    }

    /// 笔记是"改页面 / 加页面"的图标；白板、幻灯片用页面类型的图标（网页 PageKindIcon）。
    private var headerIcon: [String] {
        switch proposal.pageKind {
        case .note: return isEdit ? Lucide.filePenLine : Lucide.filePlus2
        case .whiteboard, .slides: return pageKindIcon(proposal.pageKind)
        }
    }

    // MARK: 正文

    @ViewBuilder
    private var content: some View {
        switch proposal {
        case .edit(let edit):
            if edit.titleBefore != nil || edit.titleAfter != nil {
                VStack(alignment: .leading, spacing: 0) {
                    opLabel(L("proposal_rename"))
                    beforeText(edit.titleBefore ?? "")
                    afterText(edit.titleAfter ?? "")
                }
            }
            changeList(edit.changes)
        case .create(let create):
            if let inside = ProposalCopy.inside(create) {
                opLabel(inside)
            }
            // 空のページの一行は、本文も改动（缩略图）も無いときだけ（网页と同じ）。
            if !create.content.isEmpty || create.changes.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    if create.content.isEmpty {
                        opLabel(ProposalCopy.emptyContent(create.pageKind))
                    } else {
                        afterText(create.content)
                    }
                }
            }
            changeList(create.changes)
        }
    }

    private func changeList(_ changes: [ProposalChange]) -> some View {
        ForEach(Array(changes.enumerated()), id: \.offset) { _, change in
            VStack(alignment: .leading, spacing: 0) {
                opLabel(ProposalCopy.changeLabel(change, kind: proposal.pageKind))
                if change.beforeImage != nil || change.afterImage != nil {
                    thumbnails(change)
                }
                if let before = change.before { beforeText(before) }
                if let after = change.after { afterText(after) }
                if change.dropsMedia { warning(L("proposal_drops_media")) }
                if change.dropsFormatting { warning(L("proposal_drops_formatting")) }
            }
        }
    }

    /// 改前、改后的缩略图并排；只有一张时占满一行（网页 grid 的 auto-fit）。
    private func thumbnails(_ change: ProposalChange) -> some View {
        HStack(alignment: .top, spacing: 6.4) {
            if let before = change.beforeImage {
                ProposalThumbnail(path: before, border: beforeImageBorder, label: L("proposal_before"))
            }
            if let after = change.afterImage {
                ProposalThumbnail(path: after, border: afterImageBorder, label: L("proposal_after"))
            }
        }
        .padding(.bottom, 3.2)
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

/// 应用 / 放弃 / 撤销：圆角 6、内边距 4×11.2、13.12 / 500、图标 13（忙时"应用""撤销"的图标换成转圈）。
private struct ProposalActionButton: View {
    let title: String
    let icon: [String]
    let primary: Bool
    let busy: Bool
    let spinning: Bool
    let action: () -> Void

    var body: some View {
        let ink: Color = primary ? Sm.onInk : Sm.text
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

/// 蓝色带下划线的文字链接（"打开笔记 / 打开页面"）。
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

/// 改前 / 改后的一张缩略图（.page-edit-image）：宽是分到的宽度，高按图片的比例、最高 176；圆角 4、--notion-sidebar 底、
/// 1px 边框，图片按比例放在边框里面（object-fit: contain）。地址是本站的 `/api/proposals/:id/image?…`，
/// 只给提案的主人，所以带着 App 的 Cookie 读（`RemoteImageLoader`）。读到之前（和读不到时）按 16:9 留一块底色。
private struct ProposalThumbnail: View {
    let path: String
    let border: Color
    /// 读屏念的"改前 / 改后"。
    let label: String

    @Environment(AppEnvironment.self) private var app
    @State private var loaded: LoadedImage? = nil

    var body: some View {
        let image = loaded?.current(path, app: app) ?? RemoteImageLoader.cachedImage(path, app: app)
        let shape = RoundedRectangle(cornerRadius: 4)
        ProposalThumbnailLayout(aspect: image.map(Self.aspect) ?? 16.0 / 9.0) {
            Sm.sidebar
                .overlay {
                    if let image {
                        Image(uiImage: image)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .padding(1)
                    }
                }
        }
        .frame(maxWidth: .infinity)
        .clipShape(shape)
        .overlay { shape.strokeBorder(border, lineWidth: 1) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isImage)
        .task(id: RemoteImageRequest(path: path, generation: app.identityGeneration)) {
            let result = await RemoteImageLoader.image(path, app: app)
            if Task.isCancelled { return }
            loaded = result.map { LoadedImage(path: path, generation: app.identityGeneration, image: $0) }
        }
    }

    private static func aspect(_ image: UIImage) -> CGFloat {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return 16.0 / 9.0 }
        return size.width / size.height
    }
}

/// 缩略图的框：宽是给的宽度，高是边框里面按比例算的高加上下两条 1px 边（网页 border-box），最高 [maxHeight]。
private struct ProposalThumbnailLayout: Layout {
    let aspect: CGFloat
    var maxHeight: CGFloat = 176

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = max(0, proposal.width ?? maxHeight * aspect)
        return CGSize(width: width, height: min(maxHeight, max(0, width - 2) / aspect + 2))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for subview in subviews {
            subview.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
        }
    }
}
