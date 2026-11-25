import SwiftUI

// 侧栏的笔记部分（网页 NotesSidebar，手机尺寸；Android ui/NotesUi.kt 的 NotesDrawerBody）。头部、Chat / Note 切换和底部的账号由 Root 放。
// 从上到下：“新建”、Search 行、可滚动的列表（FAVORITES → PROJECTS 和各项目 → 分区：笔记 / 幻灯片 / 白板）、最下面的“导入 Markdown”和回收站两行。
// 笔记行长按标题后可以拖动排序（Features/Shared/ReorderDragUI.swift）：放到别的笔记前 / 后是排序，放到项目行上移进项目，
// 放到分区标题上移出项目（只接受同一分区的页面，Core 的 noteDropRules）。

/// 抽屉里的笔记部分。
@MainActor
struct NotesDrawerBody: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @State private var dialog: NotesDialogState?
    @State private var reorder = ReorderDragController()
    @State private var importing = false

    init() {}

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let busy = state.busy || state.loading
        let router = self.router
        let kinds = state.kinds
        VStack(spacing: 0) {
            // 顶部固定操作区（.sidebar-top-actions）：新建 + 搜索，下方 1pt 细线分隔可滚动列表。
            VStack(spacing: 0) {
                // “新建”（.sidebar-primary-action）：上距 10、左右 10、下距 6。能建几种类型时右侧显示下拉箭头并先选类型。
                NewPageMenuAnchor(kinds: kinds, label: L("ws_new_page"), onCreate: { kind in
                    router.closeDrawer()
                    notes.createNote(kind: kind)
                }) { open in
                    SidebarPrimaryButton(
                        L(kinds.count > 1 ? "ws_new" : "new_note"),
                        trailingIcon: kinds.count > 1 ? Lucide.chevronDown : nil,
                        action: open
                    )
                }
                .disabled(busy)
                .padding(.horizontal, 10)
                .padding(.top, 10)
                .padding(.bottom, 6)
                // Search 行：网页侧栏里在“新建”按钮正下方（左右 10 已经带在里面）。
                SidebarSearchRow { router.openSearch() }
            }
            .padding(.bottom, 10)
            .overlay(alignment: .bottom) { NFDivider() }
            ScrollView(.vertical) {
                NotesDrawerList(busy: busy, reorder: reorder, dialog: $dialog)
                    .padding(.horizontal, 10)
                    .padding(.bottom, 16)
                    .reorderContainer(reorder, onStart: { [reorder] _ in
                        NoteReorderOrigin.shared.surface = .drawer
                        reorder.rules = { noteDropRules(notes.state) }
                        notes.dismissReorderError()
                    }) { id, target in
                        notes.drop(id, on: target)
                    }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // 工具区（.sidebar-utility-footer）：上方 1pt 细线，导入 Markdown、回收站。
            VStack(spacing: 1) {
                NotesSidebarActionRow(icon: Lucide.upload, title: L("import_markdown")) { importing = true }
                    .disabled(busy)
                NotesSidebarActionRow(icon: Lucide.trash2, title: L("trash")) { notes.openTrash() }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .overlay(alignment: .top) { NFDivider() }
        }
        // 选好文件就收起抽屉（网页 importMarkdownFiles 的 setSidebarOpen(false)），导入完打开第一篇。
        .noteMarkdownImporter(isPresented: $importing) { router.closeDrawer() }
        // 打开抽屉时的刷新（列表、清掉上次改图标失败的提示）由 Root 统一做（RootView.refreshDrawerLists）。
        .notesDialogs($dialog)
        // 登录 / 退出后：旧身份的笔记对话框关掉（网页换身份会重新加载页面）。
        .onChange(of: app.identityGeneration) { _, _ in dialog = nil }
    }
}

// MARK: - 列表

@MainActor
private struct NotesDrawerList: View {
    let busy: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        let state = app.notes.state
        let favorites = state.favorites
        VStack(alignment: .leading, spacing: 0) {
            // Favorites（在 Projects 上面，带琥珀星标徽章 + 数量胶囊）：收藏的页面，平铺、不能拖，右侧“从收藏中移除”。
            if !favorites.isEmpty {
                HStack(spacing: 6) {
                    SidebarSectionBadge(icon: Lucide.star, background: Sm.kindFavSoft, iconColor: Sm.kindFav)
                    NotesSectionLabel(L("pg_favorites"))
                    NotesCountPill(count: favorites.count)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 6)
                .padding(.top, 12)
                .padding(.bottom, 6)
                ForEach(favorites) { page in
                    NotesDrawerFavoriteRow(page: page, busy: busy, dialog: $dialog)
                }
            }
            if !favorites.isEmpty {
                SidebarSectionDivider()
            }
            // “Projects”分区标题（文件夹徽章 + 高对比标题 + 数量胶囊 + 右侧 40 的“新项目”按钮）。
            HStack(spacing: 6) {
                SidebarSectionBadge(icon: Lucide.folder, background: Sm.countBg, iconColor: Sm.sectionTitle)
                NotesSectionLabel(L("projects"))
                if !state.groups.isEmpty {
                    NotesCountPill(count: state.groups.count)
                }
                Spacer(minLength: 0)
                NFIconButton(Lucide.plus, label: L("new_project"), iconSize: 15, color: Sm.tabMuted) { dialog = .newGroup }
            }
            .padding(.leading, 6)
            .padding(.trailing, 2)
            .padding(.top, favorites.isEmpty ? 12 : 0)
            .padding(.bottom, 4)
            ForEach(state.groups) { group in
                groupSection(group, state)
            }
            // 改图标失败的提示在 NOTES 标签上方，左右 8、12 红字。
            if state.iconError {
                Text(L("em_note_icon_failed"))
                    .font(.nf(12))
                    .nfLineHeight(16, fontSize: 12)
                    .foregroundStyle(Sm.danger)
                    .padding(.horizontal, 8)
            }
            // 分区（网页 notes-sidebar 的分区）：不在项目里的最上层页面按类型分开。标题是“移出项目”的投放区，只接受同一分区的页面。
            ForEach(state.sections, id: \.kind) { section in
                sectionView(section, state)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 一个分区：标题（折叠箭头、“+”），展开时下面是它最上层的页面。
    @ViewBuilder
    private func sectionView(_ section: WorkspaceSection, _ state: NotesUiState) -> some View {
        let notes = app.notes
        let isOpen = !state.collapsedSections.contains(section.kind)
        SidebarSectionDivider()
        NotesSectionHeading(kind: section.kind, count: section.count, isOpen: isOpen, busy: busy, onToggle: { notes.toggleSection(section.kind) }) {
            router.closeDrawer()
            notes.createNote(kind: section.kind)
        }
        .reorderDropZone(noteSectionZone(section.kind), in: reorder)
        if isOpen {
            ForEach(section.roots) { page in
                NotesDrawerTree(page: page, busy: busy, reorder: reorder, dialog: $dialog)
            }
            if section.kind == .note && state.pages.isEmpty && state.loaded {
                Text(L("notes_list_empty"))
                    .font(.nf(12))
                    .nfLineHeight(20, fontSize: 12)
                    .foregroundStyle(Sm.muted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 12)
            }
        }
    }

    /// 一个项目：项目行（同时是“移进这个项目”的投放区），展开时下面是它最上层的笔记。
    @ViewBuilder
    private func groupSection(_ group: NoteGroupSummary, _ state: NotesUiState) -> some View {
        let members = state.members(group.id)
        let isOpen = !state.collapsed.contains(group.id)
        groupRow(group, count: state.memberCount(group.id), isOpen: isOpen)
            .reorderDropZone(group.id, in: reorder)
        if isOpen {
            VStack(alignment: .leading, spacing: 0) {
                if members.isEmpty {
                    Text(L("no_notes_in_project"))
                        .font(.nf(12))
                        .nfLineHeight(16, fontSize: 12)
                        .foregroundStyle(Sm.faint)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                }
                ForEach(members) { page in
                    NotesDrawerTree(page: page, busy: busy, reorder: reorder, dialog: $dialog)
                }
            }
            .notesIndentedMembers()
        }
    }

    /// 项目行（.notion-session-row + .chat-project-toggle）：高 44；展开箭头 14、文件夹 15、名称 14 / 500、数量 12 浅灰；
    /// 右侧重命名（铅笔 13）和删除（垃圾桶 14）两个 25.6 的小按钮，触屏上常显。
    private func groupRow(_ group: NoteGroupSummary, count: Int, isOpen: Bool) -> some View {
        let notes = app.notes
        return HStack(spacing: 0) {
            Button {
                notes.toggleGroup(group.id)
            } label: {
                HStack(spacing: 6) {
                    LucideIcon(isOpen ? Lucide.chevronDown : Lucide.chevronRight, size: 13.5, color: Sm.faint)
                    LucideIcon(Lucide.folder, size: 14.5, color: Sm.text)
                    Text(group.name)
                        .font(.nf(14, weight: 500))
                        .nfLineHeight(20, fontSize: 14)
                        .foregroundStyle(Sm.text)
                        .lineLimit(1)
                    NotesCountPill(count: count)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
            }
            .buttonStyle(.pressable(cornerRadius: 8))
            // 项目的“+”（网页项目行的 NewPageButton）：在这个项目的最上层新建，能建几种类型时先选类型。
            let newLabel = L("ws_new_page_in", group.name)
            NewPageMenuAnchor(kinds: notes.state.kinds, label: newLabel, onCreate: { kind in
                router.closeDrawer()
                notes.createNote(kind: kind, groupId: group.id)
            }) { open in
                NoteRowAction(icon: Lucide.plus, iconSize: 14, label: newLabel, action: open)
            }
            .disabled(busy)
            NoteRowAction(icon: Lucide.pencil, iconSize: 13, label: L("rename_name", group.name)) {
                dialog = .renameGroup(group)
            }
            NoteRowAction(icon: Lucide.trash2, iconSize: 14, label: L("delete_project_name", group.name)) {
                dialog = .deleteGroup(group)
            }
        }
        .frame(minHeight: 44)
    }
}

// MARK: - 子页面的树

/// 一篇笔记和它展开的子页面（网页 .notes-subpages = .notes-group-members）：展开时子页面在父页面下，左距 12、1px 竖线、内左距 4；
/// 没有子页面时是“No pages inside”（13 浅灰，内边距 6×8）。打开着的笔记的祖先总是展开（`NotesUiState.isExpanded`）。
@MainActor
private struct NotesDrawerTree: View {
    let page: NotePageSummary
    let busy: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let state = app.notes.state
        let kids = state.children(page.id)
        let isOpen = state.isExpanded(page.id)
        NotesDrawerRow(page: page, busy: busy, expanded: isOpen, reorder: reorder, dialog: $dialog)
        if isOpen {
            VStack(alignment: .leading, spacing: 0) {
                if kids.isEmpty {
                    Text(L("pg_no_pages_inside"))
                        .font(.nf(13))
                        .nfLineHeight(19.5, fontSize: 13)
                        .foregroundStyle(Sm.faint)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                }
                ForEach(kids) { child in
                    NotesDrawerTree(page: child, busy: busy, reorder: reorder, dialog: $dialog)
                }
            }
            .notesIndentedMembers()
        }
    }
}

// MARK: - 笔记行

/// 笔记行：高 44、圆角 6.4；展开箭头（20×28、左距 2、Chevron 14 浅灰）；图标按钮 40（表情 15 或页面类型图标 15 灰，点开表情选择器）；
/// 标题 14（长按它拖动排序）；右侧“在里面新建”“移到项目”“移到回收站”三个 25.6 的小按钮。当前打开的行浅蓝底加行首的蓝条。
/// 拖动中被拖的行半透明，目标行上 / 下 2px 蓝线（这时不画蓝条）。
@MainActor
private struct NotesDrawerRow: View {
    let page: NotePageSummary
    let busy: Bool
    let expanded: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @State private var picking = false
    @State private var menuOpen = false
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let active = state.open?.id == page.id
        let line = reorder.dropLine(page.id)
        let shape = RoundedRectangle(cornerRadius: 8)
        let iconTint = pageKindColor(page.kind)
        HStack(spacing: 0) {
            toggle
            if active || page.locked {
                // 打开着的笔记：图标由编辑器保存，这里只显示，点它和点行一样。锁定的页面也不能在这里改图标。
                Button {
                    openNote()
                } label: {
                    NFIconTile(emoji: page.icon, fallback: pageKindIcon(page.kind), box: 30, glyph: 15, color: iconTint)
                }
                .buttonStyle(.pressable(pressedBackground: nil))
                .disabled(busy)
                .accessibilityHidden(true)
            } else {
                iconButton
            }
            title(active: active, locked: busy || state.moveBusy.contains(page.id))
            NewPageMenuAnchor(kinds: state.kinds, label: L("pg_add_page_inside_title", page.title), onCreate: { kind in
                router.closeDrawer()
                notes.createNote(parentId: page.id, kind: kind)
            }) { open in
                NoteRowAction(icon: Lucide.plus, iconSize: 14, label: L("pg_add_page_inside_title", page.title), action: open)
            }
            .disabled(busy)
            let menuLabel = L("sb_actions_for_title", page.title)
            NoteRowAction(icon: Lucide.ellipsis, iconSize: 14, label: menuLabel) {
                menuOpen = true
            }
            .disabled(busy)
            .actionsMenu(isPresented: $menuOpen, label: menuLabel) {
                NoteRowMenu(page: page, dialog: $dialog) {
                    menuOpen = false
                }
            }
        }
        .padding(.leading, 4)
        .frame(minHeight: 42)
        // 插入线自己画在圆角里面（和聊天行一样）。
        .overlay(alignment: .top) {
            if line.before { ReorderDropLine() }
        }
        .overlay(alignment: .bottom) {
            if line.after { ReorderDropLine() }
        }
        .clipShape(shape)
        .sidebarActiveRow(active: active, accent: iconTint, cornerRadius: 8)
        .reorderRow(page.id, in: reorder, showsDropLine: false)
        .reorderError(errorText(state)) { notes.dismissReorderError() }
    }

    private func openNote() {
        router.closeDrawer()
        app.notes.openNote(page.id)
    }

    /// 展开箭头（.notes-row-toggle）。
    private var toggle: some View {
        let notes = app.notes
        return Button {
            notes.toggleExpanded(page.id)
        } label: {
            LucideIcon(expanded ? Lucide.chevronDown : Lucide.chevronRight, size: 13.5, color: Sm.faint)
                .frame(width: 18, height: 28)
        }
        .buttonStyle(.pressable(cornerRadius: 4))
        .padding(.leading, 1)
        .accessibilityLabel(expanded ? L("pg_collapse_title", page.title) : L("pg_expand_title", page.title))
    }

    /// 图标按钮 30×36（圆角 4），点开表情选择器（aria-label "Change icon of {title}"）；忙时禁用。
    /// 只用于没打开的笔记（`NotesViewModel.changeIcon`，PUT /api/pages/:id/icon）。
    private var iconButton: some View {
        let notes = app.notes
        let pageId = page.id
        return Button {
            picking.toggle()
        } label: {
            NFIconTile(emoji: page.icon, fallback: pageKindIcon(page.kind), box: 30, glyph: 15, color: pageKindColor(page.kind))
        }
        .buttonStyle(.pressable(background: picking ? Sm.hover : Color.clear, cornerRadius: 4))
        .disabled(busy)
        .accessibilityLabel(L("em_change_icon_of", page.title))
        .emojiPicker(isPresented: $picking, current: page.icon) { icon in
            Task { @MainActor in _ = await notes.changeIcon(pageId, icon) }
        }
    }

    /// 标题：点一下打开，长按后拖动排序（网页的拖动元是标题按钮，图标按钮在它外面）。
    private func title(active: Bool, locked: Bool) -> some View {
        Button {
            if !reorder.swallowsTap() { openNote() }
        } label: {
            Text(page.title)
                .font(.nf(14, weight: active ? 600 : 400))
                .nfLineHeight(20, fontSize: 14)
                .foregroundStyle(active ? Sm.ink : Sm.text)
                .lineLimit(1)
                .padding(.leading, 4)
                .padding(.trailing, 6)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
        }
        .buttonStyle(.pressable(cornerRadius: 0))
        .disabled(busy)
        .accessibilityAddTraits(active ? .isSelected : [])
        .reorderHandle(page.id, in: reorder, locked: locked)
    }

    /// 这一篇的拖动失败提示（只在发起拖动的列表里显示）。
    private func errorText(_ state: NotesUiState) -> String? {
        guard let failure = state.reorderError, failure.id == page.id,
              NoteReorderOrigin.shared.surface == .drawer else { return nil }
        return reorderFailureText(failure, app.systemText)
    }
}

// MARK: - 收藏的行

/// Favorites 的行：高 42；图标区 28（左距 4，语义色页面类型图标 15）；标题 14；
/// 笔记行的“...”操作菜单（网页 NotesSidebar 的 AnswerMenu）：改名、收藏/取消收藏、移到项目、移到回收站。
@MainActor
private struct NoteRowMenu: View {
    let page: NotePageSummary
    @Binding var dialog: NotesDialogState?
    let onClose: () -> Void
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let fav = page.favoritedAt != nil
        VStack(alignment: .leading, spacing: 0) {
            if !page.locked {
                ActionsMenuItem(L("sb_rename"), icon: Lucide.pencil) {
                    onClose()
                    dialog = .renamePage(page)
                }
            }
            ActionsMenuItem(L(fav ? "pg_remove_from_favorites" : "pg_add_to_favorites"), icon: fav ? Lucide.starOff : Lucide.star) {
                onClose()
                let notes = app.notes
                let id = page.id
                Task { @MainActor in _ = await notes.setFavorite(id, !fav) }
            }
            ActionsMenuItem(L("pg_move_to"), icon: Lucide.folderInput) {
                onClose()
                dialog = .move(pageId: page.id)
            }
            ActionsMenuDivider()
            ActionsMenuItem(L("move_to_trash"), icon: Lucide.trash2, role: .danger) {
                onClose()
                dialog = .trashNote(page)
            }
        }
    }
}

/// 右侧重命名（非锁定时）与“从收藏中移除”小按钮（Pencil 13 + StarOff 14）。当前打开的行浮起圆角卡。
@MainActor
private struct NotesDrawerFavoriteRow: View {
    let page: NotePageSummary
    let busy: Bool
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        let notes = app.notes
        let active = notes.state.open?.id == page.id
        let pageId = page.id
        let shape = RoundedRectangle(cornerRadius: 8)
        HStack(spacing: 0) {
            Button {
                router.closeDrawer()
                notes.openNote(pageId)
            } label: {
                HStack(spacing: 0) {
                    NFIconTile(emoji: page.icon, fallback: pageKindIcon(page.kind), box: 28, glyph: 15, color: pageKindColor(page.kind))
                        .padding(.leading, 4)
                    Text(page.title)
                        .font(.nf(14, weight: active ? 600 : 400))
                        .nfLineHeight(20, fontSize: 14)
                        .foregroundStyle(active ? Sm.ink : Sm.text)
                        .lineLimit(1)
                        .padding(.leading, 4)
                        .padding(.trailing, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
            }
            .buttonStyle(.pressable(cornerRadius: 0))
            .disabled(busy)
            if !page.locked {
                NoteRowAction(icon: Lucide.pencil, iconSize: 13, label: L("rename_name", page.title)) {
                    dialog = .renamePage(page)
                }
                .disabled(busy)
            }
            NoteRowAction(icon: Lucide.starOff, iconSize: 14, label: L("pg_remove_title_from_favorites", page.title)) {
                Task { @MainActor in _ = await notes.setFavorite(pageId, false) }
            }
            .disabled(busy)
        }
        .padding(.leading, 4)
        .frame(minHeight: 42)
        .clipShape(shape)
        .sidebarActiveRow(active: active, accent: pageKindColor(page.kind), cornerRadius: 8)
    }
}
