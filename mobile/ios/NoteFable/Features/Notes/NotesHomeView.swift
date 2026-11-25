import SwiftUI

// 工作区首页（网页 NotesHome，手机；Android ui/NotesUi.kt 的 NotesHome）：左右 20、下 96；顶部 Chat / Workspace 切换（上距 4）；
// Studio 头部（"Workspace" 30 / 750 + 胶囊按钮 New project / Import Markdown）→ Studio Quick-Create Deck 卡片 →
// 类型筛选栏（All | Notes | Slides | Whiteboards）→ 圆角卡片分组列表（带语义色图标块、Favorites 类型标签）。
// 笔记行长按后可以拖动排序；标题"Workspace"和分区小标题是"移出项目"的投放区，项目小标题是"移进项目"的。

@MainActor
struct NotesHomeView: View {
    @Binding private var dialog: NotesDialogState?
    @State private var reorder = ReorderDragController()
    @State private var importing = false
    @Environment(AppEnvironment.self) private var app

    init(dialog: Binding<NotesDialogState?>) {
        self._dialog = dialog
    }

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let busy = state.busy || state.loading
        let nothing = state.pages.isEmpty && state.groups.isEmpty
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                if let error = state.error {
                    NotesErrorBar(notesErrorText(error, app.systemText), onRetry: { notes.refresh() })
                        .padding(.top, 12)
                }
                if state.loading && nothing {
                    Text(L("loading_notes"))
                        .font(.nf(14))
                        .foregroundStyle(Sm.muted)
                        .padding(.top, 96)
                        .padding(.bottom, 16)
                } else if nothing {
                    if state.error == nil && state.loaded {
                        NotesEmptyView(kinds: state.kinds, busy: busy, onCreate: { notes.createNote(kind: $0) }, onImport: { importing = true })
                    }
                } else {
                    NotesHomeList(busy: busy, reorder: reorder, onImport: { importing = true }, dialog: $dialog)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.bottom, 96)
            .reorderContainer(reorder, onStart: { [reorder] _ in
                NoteReorderOrigin.shared.surface = .home
                reorder.rules = { noteDropRules(notes.state) }
                notes.dismissReorderError()
            }) { id, target in
                notes.drop(id, on: target)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .noteMarkdownImporter(isPresented: $importing)
    }
}

// MARK: - 列表

private struct HomeGroupEntry: Identifiable {
    let group: NoteGroupSummary
    let members: [NotePageSummary]
    let total: Int
    var id: String { group.id }
}

private struct HomeSectionEntry: Identifiable {
    let kind: PageKind
    let roots: [NotePageSummary]
    let count: Int
    var id: PageKind { kind }
}

@MainActor
private struct NotesHomeList: View {
    let busy: Bool
    let reorder: ReorderDragController
    let onImport: () -> Void
    @Binding var dialog: NotesDialogState?
    @State private var kindFilter: PageKind? = nil
    @Environment(AppEnvironment.self) private var app
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let kinds = state.kinds
        let multiKind = kinds.count > 1
        let activeFilter: PageKind? = multiKind ? kindFilter : nil
        let groupIds = Set(state.groups.map(\.id))
        let matches: (NotePageSummary) -> Bool = { page in
            activeFilter == nil || state.sectionKind(of: page) == activeFilter
        }
        let visibleFavorites = state.favorites.filter(matches)
        let visibleGroups: [HomeGroupEntry] = {
            if activeFilter != nil {
                return state.groups.compactMap { group in
                    let members = state.pages.filter { $0.groupId == group.id && matches($0) }
                    return members.isEmpty ? nil : HomeGroupEntry(group: group, members: members, total: members.count)
                }
            }
            return state.groups.map { group in
                HomeGroupEntry(group: group, members: state.members(group.id), total: state.memberCount(group.id))
            }
        }()
        let visibleSections: [HomeSectionEntry] = {
            if let filter = activeFilter {
                let items = state.pages.filter { page in
                    let loose = page.groupId.map { !groupIds.contains($0) } ?? true
                    return loose && matches(page)
                }
                return items.isEmpty ? [] : [HomeSectionEntry(kind: filter, roots: items, count: items.count)]
            }
            return state.sections.filter { !$0.roots.isEmpty }.map {
                HomeSectionEntry(kind: $0.kind, roots: $0.roots, count: $0.count)
            }
        }()
        let filterEmpty = activeFilter != nil && visibleFavorites.isEmpty && visibleGroups.isEmpty && visibleSections.isEmpty

        // Studio 头部：Workspace 标题（移出项目投放区）+ 胶囊按钮 New project / Import Markdown
        VStack(alignment: .leading, spacing: 10) {
            Text(L("workspace"))
                .font(.nf(30, weight: 750))
                .tracking(layoutDirection == .rightToLeft ? 0 : -1.2)
                .nfLineHeight(36, fontSize: 30)
                .foregroundStyle(Sm.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .reorderDropZone("", in: reorder)
                .accessibilityAddTraits(.isHeader)
            ChatFlowLayout(spacing: 8, lineSpacing: 8) {
                NotesHomeUtilPill(icon: Lucide.folderPlus, title: L("new_project"), busy: busy) {
                    dialog = .newGroup
                }
                NotesHomeUtilPill(icon: Lucide.upload, title: L("import_markdown"), busy: busy, action: onImport)
            }
        }
        .padding(.top, 12)
        .padding(.bottom, 14)

        // Studio Quick-Create Deck 卡片
        CreateDeckCards(kinds: kinds, busy: busy) { notes.createNote(kind: $0) }
            .padding(.bottom, 18)

        // 类型筛选栏（All | Notes | Slides | Whiteboards）
        if multiKind {
            KindFilterBar(kinds: kinds, active: activeFilter) { kindFilter = $0 }
                .padding(.bottom, 14)
        }

        // Favorites（圆角卡片 + 类型胶囊标签）
        if !visibleFavorites.isEmpty {
            let firstFavId = visibleFavorites.first?.id
            NotesHomeHeading(name: L("pg_favorites"), count: visibleFavorites.count, icon: Lucide.star, iconColor: Sm.kindFav)
                .notesHomeHeadingMargins()
            NotesHomeCard {
                ForEach(visibleFavorites) { page in
                    NotesHomeFavoriteItem(page: page, busy: busy, multiKind: multiKind, showTopDivider: page.id != firstFavId)
                }
            }
        }

        // Projects
        ForEach(visibleGroups) { entry in
            NotesHomeHeading(name: entry.group.name, count: entry.total, icon: Lucide.folder, iconColor: Sm.muted)
                .reorderDropZone(entry.group.id, in: reorder)
                .notesHomeHeadingMargins()
            if entry.members.isEmpty {
                NotesHomeEmptyCard(L("no_notes_in_project"))
            } else {
                let firstMemberId = entry.members.first?.id
                NotesHomeCard {
                    ForEach(entry.members) { page in
                        NotesHomeTree(page: page, busy: busy, flat: activeFilter != nil, showTopDivider: page.id != firstMemberId, reorder: reorder, dialog: $dialog)
                    }
                }
            }
        }

        // 不在项目里的页面分区（Notes / Slides / Whiteboards）
        ForEach(visibleSections) { section in
            if multiKind || !state.groups.isEmpty {
                NotesHomeHeading(
                    name: multiKind ? L(pageKindSectionLabel(section.kind)) : L("no_project"),
                    count: section.count,
                    icon: multiKind ? pageKindIcon(section.kind) : nil,
                    iconColor: multiKind ? pageKindColor(section.kind) : Sm.muted
                )
                .reorderDropZone(noteSectionZone(section.kind), in: reorder)
                .notesHomeHeadingMargins()
            }
            let firstRootId = section.roots.first?.id
            NotesHomeCard {
                ForEach(section.roots) { page in
                    NotesHomeTree(page: page, busy: busy, flat: activeFilter != nil, showTopDivider: page.id != firstRootId, reorder: reorder, dialog: $dialog)
                }
            }
        }

        if filterEmpty {
            NotesHomeEmptyCard(L("sb_no_notes_match"))
        }
    }
}

// MARK: - Studio 组件（工具胶囊、快速创建卡、筛选栏、卡片容器）

private struct NotesHomeUtilPill: View {
    let icon: [String]
    let title: String
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                LucideIcon(icon, size: 14, color: Sm.faint)
                Text(title)
                    .font(.nf(13, weight: 520))
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, 11.2)
            .frame(height: 34.4)
        }
        .buttonStyle(.pressable(background: Sm.surface, cornerRadius: 17.2, scale: 0.98, disabledOpacity: 0.5))
        .overlay { Capsule().strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
        .disabled(busy)
    }
}

private struct CreateDeckCards: View {
    let kinds: [PageKind]
    let busy: Bool
    let onCreate: (PageKind) -> Void

    var body: some View {
        VStack(spacing: 8) {
            ForEach(kinds, id: \.self) { kind in
                let cardShape = RoundedRectangle(cornerRadius: 14)
                let iconShape = RoundedRectangle(cornerRadius: 9)
                Button {
                    onCreate(kind)
                } label: {
                    HStack(spacing: 10) {
                        LucideIcon(pageKindIcon(kind), size: 17, color: pageKindColor(kind))
                            .frame(width: 32, height: 32)
                            .background(pageKindSoft(kind), in: iconShape)
                            .overlay { iconShape.strokeBorder(pageKindBorder(kind), lineWidth: 1) }
                        Text(L(pageKindNewLabel(kind)))
                            .font(.nf(14, weight: 580))
                            .nfLineHeight(19, fontSize: 14)
                            .foregroundStyle(Sm.ink)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        LucideIcon(Lucide.plus, size: 14, color: Sm.muted)
                            .frame(width: 26, height: 26)
                            .background(Sm.hover, in: Circle())
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                }
                .buttonStyle(.pressable(background: Sm.surface, cornerRadius: 14, scale: 0.99, disabledOpacity: 0.55))
                .overlay { cardShape.strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
                .shadow(color: Color(argb: 0x0A0F172A), radius: 1, x: 0, y: 1)
                .disabled(busy)
            }
        }
    }
}

private struct KindFilterBar: View {
    let kinds: [PageKind]
    let active: PageKind?
    let onSelect: (PageKind?) -> Void

    var body: some View {
        let trackShape = RoundedRectangle(cornerRadius: 10)
        ScrollView(.horizontal) {
            HStack(spacing: 2) {
                FilterPill(title: L("search_tab_all"), icon: nil, iconColor: Sm.muted, selected: active == nil) {
                    onSelect(nil)
                }
                ForEach(kinds, id: \.self) { kind in
                    FilterPill(
                        title: L(pageKindSectionLabel(kind)),
                        icon: pageKindIcon(kind),
                        iconColor: active == kind ? pageKindColor(kind) : Sm.muted,
                        selected: active == kind
                    ) {
                        onSelect(kind)
                    }
                }
            }
            .padding(3)
        }
        .scrollIndicators(.hidden)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Sm.hover, in: trackShape)
        .overlay { trackShape.strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("ws_page_type"))
    }
}

private struct FilterPill: View {
    let title: String
    let icon: [String]?
    let iconColor: Color
    let selected: Bool
    let action: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 7.2)
        Button(action: action) {
            HStack(spacing: 5) {
                if let icon {
                    LucideIcon(icon, size: 13, color: iconColor)
                }
                Text(title)
                    .font(.nf(13, weight: 540))
                    .foregroundStyle(selected ? Sm.ink : Sm.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10.4)
            .frame(height: 32)
            .background {
                if selected {
                    shape.fill(Sm.surface)
                        .overlay { shape.strokeBorder(Sm.border, lineWidth: 1) }
                }
            }
        }
        .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 7.2, scale: 0.98))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct NotesHomeCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14)
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Sm.surface, in: shape)
        .overlay { shape.strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
        .clipShape(shape)
        .shadow(color: Color(argb: 0x0A0F172A), radius: 1, x: 0, y: 1)
        .padding(.bottom, 18)
    }
}

private struct NotesHomeEmptyCard: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14)
        Text(text)
            .font(.nf(13.5))
            .foregroundStyle(Sm.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Sm.sidebar.opacity(0.55), in: shape)
            .overlay { shape.strokeBorder(Sm.borderStrong, lineWidth: 1) }
            .padding(.bottom, 18)
    }
}

private struct NotesHomeKindBadge: View {
    let kind: PageKind

    var body: some View {
        Text(L(pageKindLabel(kind)))
            .font(.nf(11, weight: 550))
            .nfLineHeight(14, fontSize: 11)
            .foregroundStyle(pageKindTextColor(kind))
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(pageKindSoft(kind), in: Capsule())
            .layoutPriority(1)
    }
}

private struct NotesHomeIconTile: View {
    let icon: String?
    let kind: PageKind

    var body: some View {
        let bg = (icon != nil && !(icon?.isEmpty ?? true)) ? Sm.hover : pageKindSoft(kind)
        NFIconTile(emoji: icon, fallback: pageKindIcon(kind), box: 30, glyph: 16, color: pageKindColor(kind))
            .background(bg, in: RoundedRectangle(cornerRadius: 8))
    }
}

/// 分组小标题：图标 + 名称 13 / 600 灰 + 数量胶囊。只有文字那么宽（拖到上面时高亮框只包住这一行）。
private struct NotesHomeHeading: View {
    let name: String
    let count: Int
    var icon: [String]? = nil
    var iconColor: Color = Sm.muted

    var body: some View {
        HStack(spacing: 6) {
            if let icon {
                LucideIcon(icon, size: 13.5, color: iconColor)
            }
            Text(name)
                .font(.nf(13, weight: 600))
                .nfLineHeight(19, fontSize: 13)
                .foregroundStyle(Sm.muted)
                .lineLimit(1)
            NotesCountPill(count: count)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private extension View {
    /// 小标题的外边距放在投放区外面：高亮框不包住它。
    func notesHomeHeadingMargins() -> some View {
        self
            .padding(.horizontal, 4)
            .padding(.top, 4)
            .padding(.bottom, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - 子页面的树

/// 一篇笔记和它展开的子页面（网页 notes-home）：子页面在展开的父页面下缩进并带竖线；筛选时平铺显示。
@MainActor
private struct NotesHomeTree: View {
    let page: NotePageSummary
    let busy: Bool
    let flat: Bool
    let showTopDivider: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let state = app.notes.state
        let kids = state.children(page.id)
        let isOpen = !flat && state.expanded.contains(page.id)
        NotesHomeItem(page: page, busy: busy, expanded: isOpen, flat: flat, showTopDivider: showTopDivider, reorder: reorder, dialog: $dialog)
        if isOpen {
            VStack(alignment: .leading, spacing: 0) {
                if kids.isEmpty {
                    Text(L("pg_no_pages_inside"))
                        .font(.nf(13.5))
                        .foregroundStyle(Sm.faint)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .overlay(alignment: .top) { NFDivider() }
                } else {
                    ForEach(kids) { child in
                        NotesHomeTree(page: child, busy: busy, flat: false, showTopDivider: true, reorder: reorder, dialog: $dialog)
                    }
                }
            }
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(Sm.border)
                    .frame(width: 1)
                    .accessibilityHidden(true)
            }
            .padding(.leading, 22)
        }
    }
}

// MARK: - 行

/// 首页卡片内的一行：展开箭头 26×40（筛选时隐藏）；主体最小高 52（30 语义色图标块、15.5/530 标题、12.5 浅灰日期）；右侧 36×40 移到项目。
@MainActor
private struct NotesHomeItem: View {
    let page: NotePageSummary
    let busy: Bool
    let expanded: Bool
    let flat: Bool
    let showTopDivider: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let pageId = page.id
        HStack(spacing: 0) {
            if !flat {
                Button {
                    notes.toggleExpanded(pageId)
                } label: {
                    LucideIcon(expanded ? Lucide.chevronDown : Lucide.chevronRight, size: 15, color: Sm.faint)
                        .frame(width: 26, height: 40)
                }
                .buttonStyle(.pressable(cornerRadius: 6))
                .padding(.leading, 4)
                .accessibilityLabel(expanded ? L("pg_collapse_title", page.title) : L("pg_expand_title", page.title))
            }
            Button {
                if !reorder.swallowsTap() { notes.openNote(pageId) }
            } label: {
                HStack(spacing: 10) {
                    NotesHomeIconTile(icon: page.icon, kind: page.kind)
                    Text(page.title)
                        .font(.nf(15.5, weight: 530))
                        .nfLineHeight(22, fontSize: 15.5)
                        .foregroundStyle(Sm.text)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(noteShortDate(page.updatedAt))
                        .font(.nf(12.5))
                        .nfLineHeight(18, fontSize: 12.5)
                        .foregroundStyle(Sm.faint)
                        .lineLimit(1)
                        .layoutPriority(1)
                }
                .padding(.leading, flat ? 12 : 4)
                .padding(.trailing, 6)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            }
            .buttonStyle(.pressable(cornerRadius: 0))
            .disabled(busy)
            .reorderHandle(pageId, in: reorder, locked: busy || flat || state.moveBusy.contains(pageId))
            Button {
                dialog = .move(pageId: pageId)
            } label: {
                LucideIcon(Lucide.folderInput, size: 16, color: Sm.faint)
                    .frame(width: 36, height: 40)
            }
            .buttonStyle(.pressable(cornerRadius: 7))
            .padding(.trailing, 4)
            .disabled(busy)
            .accessibilityLabel(L("move_title_to_project", page.title))
        }
        .overlay(alignment: .top) {
            if showTopDivider { NFDivider() }
        }
        .reorderRow(pageId, in: reorder)
        .reorderError(errorText(state), rowHeight: 52) { notes.dismissReorderError() }
    }

    /// 这一篇的拖动失败提示（只在发起拖动的列表里显示）。
    private func errorText(_ state: NotesUiState) -> String? {
        guard let failure = state.reorderError, failure.id == page.id,
              NoteReorderOrigin.shared.surface == .home else { return nil }
        return reorderFailureText(failure, app.systemText)
    }
}

/// 收藏的行（圆角卡片内）：最小高 52、图标块 30、间距 10、标题 15.5 / 530、多类型时右侧类型胶囊。
@MainActor
private struct NotesHomeFavoriteItem: View {
    let page: NotePageSummary
    let busy: Bool
    let multiKind: Bool
    let showTopDivider: Bool
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let notes = app.notes
        let pageId = page.id
        Button {
            notes.openNote(pageId)
        } label: {
            HStack(spacing: 10) {
                NotesHomeIconTile(icon: page.icon, kind: page.kind)
                Text(page.title)
                    .font(.nf(15.5, weight: 530))
                    .nfLineHeight(22, fontSize: 15.5)
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if multiKind {
                    NotesHomeKindBadge(kind: page.kind)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        }
        .buttonStyle(.pressable(cornerRadius: 0))
        .disabled(busy)
        .overlay(alignment: .top) {
            if showTopDivider { NFDivider() }
        }
    }
}

// MARK: - 空状态

/// 一篇笔记都没有（网页 NotesWorkspace 的空状态，手机）：居中 Studio 徽章（LayoutGrid）、标题、说明、Quick-Create Deck 卡片、Import 胶囊。
@MainActor
private struct NotesEmptyView: View {
    let kinds: [PageKind]
    let busy: Bool
    let onCreate: (PageKind) -> Void
    let onImport: () -> Void
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        let emblemShape = RoundedRectangle(cornerRadius: 16)
        VStack(alignment: .center, spacing: 0) {
            LucideIcon(Lucide.layoutGrid, size: 26, strokeWidth: 1.6, color: Sm.ink)
                .frame(width: 56, height: 56)
                .background(Sm.accentSoft, in: emblemShape)
                .overlay { emblemShape.strokeBorder(Sm.border, lineWidth: 1) }
            Text(L("workspace"))
                .font(.nf(32, weight: 750))
                .tracking(layoutDirection == .rightToLeft ? 0 : -1.2)
                .nfLineHeight(38, fontSize: 32)
                .foregroundStyle(Sm.ink)
                .padding(.top, 18)
                .accessibilityAddTraits(.isHeader)
            Text(intro)
                .font(.nf(14.5))
                .nfLineHeight(22, fontSize: 14.5)
                .foregroundStyle(Sm.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            CreateDeckCards(kinds: kinds, busy: busy, onCreate: onCreate)
                .padding(.top, 24)
            NotesHomeUtilPill(icon: Lucide.upload, title: L("import_markdown"), busy: busy, action: onImport)
                .padding(.top, 14)
            Text(L("notes_storage_hint"))
                .font(.nf(12))
                .nfLineHeight(19, fontSize: 12)
                .foregroundStyle(Sm.faint)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 384)
                .padding(.top, 36)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 56)
    }

    /// 说明文里的占位符换成“/”键帽：等宽 13、浅灰底（--notes-code-bg）。
    private var intro: AttributedString {
        var key = AttributedString(" / ")
        // 显式写出类型：UIKit 也有同名的 font / backgroundColor 属性（UIFont / UIColor）。
        let keyFont: Font = .nfMono(13)
        let keyBackground: Color = Sm.codeBackground
        key.font = keyFont
        key.backgroundColor = keyBackground
        var text = AttributedString()
        let parts = L("notes_intro").components(separatedBy: "%1$s")
        for (index, part) in parts.enumerated() {
            if index > 0 { text.append(key) }
            text.append(AttributedString(part))
        }
        return text
    }
}
