import SwiftUI

// 侧栏的笔记部分（网页 NotesSidebar，手机尺寸；Android ui/NotesUi.kt 的 NotesDrawerBody）。头部、Chat / Note 切换和底部的账号由 Root 放。
// 从上到下：“新笔记”、Search 行、可滚动的列表（FAVORITES → PROJECTS 和各项目 → NOTES）、最下面的回收站行。
// 笔记行长按标题后可以拖动排序（Features/Shared/ReorderDragUI.swift）：放到别的笔记前 / 后是排序，放到项目行上移进项目，
// 放到 NOTES 标签上移出项目。

/// 抽屉里的笔记部分。
@MainActor
struct NotesDrawerBody: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @State private var dialog: NotesDialogState?
    @State private var reorder = ReorderDragController()

    init() {}

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let busy = state.busy || state.loading
        VStack(spacing: 0) {
            // “新笔记”（.sidebar-primary-action）：上距 12、左右 8、下距 4。
            SidebarPrimaryButton(L("new_note")) {
                router.closeDrawer()
                notes.createNote()
            }
            .disabled(busy)
            .padding(.horizontal, 8)
            .padding(.top, 12)
            .padding(.bottom, 4)
            // Search 行：网页侧栏里在“新建”按钮正下方（聊天和笔记两边共用，左右 8 已经带在里面）。
            SidebarSearchRow { router.openSearch() }
            ScrollView(.vertical) {
                NotesDrawerList(busy: busy, reorder: reorder, dialog: $dialog)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 16)
                    .reorderContainer(reorder, onStart: { _ in
                        NoteReorderOrigin.shared.surface = .drawer
                        notes.dismissReorderError()
                    }) { id, target in
                        notes.drop(id, on: target)
                    }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // 回收站（.notion-sidebar-action）。
            NotesSidebarActionRow(icon: Lucide.trash2, title: L("trash")) { notes.openTrash() }
                .padding(.horizontal, 8)
                .padding(.bottom, 4)
        }
        // 打开抽屉时的刷新（列表、清掉上次改图标失败的提示）由 Root 统一做（RootView.refreshDrawerLists）。
        .notesDialogs($dialog)
    }
}

// MARK: - 列表

@MainActor
private struct NotesDrawerList: View {
    let busy: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let state = app.notes.state
        let favorites = state.favorites
        VStack(alignment: .leading, spacing: 0) {
            // FAVORITES（在 Projects 上面）：收藏的页面，平铺、不能拖，右侧“从收藏中移除”。
            if !favorites.isEmpty {
                NotesSectionLabel(L("pg_favorites"))
                    .padding(.horizontal, 8)
                    .padding(.top, 14.4)
                    .padding(.bottom, 4.8)
                ForEach(favorites) { page in
                    NotesDrawerFavoriteRow(page: page, busy: busy)
                }
            }
            // “PROJECTS”小标题 + 右侧 40 的“新项目”按钮。
            HStack(spacing: 0) {
                NotesSectionLabel(L("projects"))
                    .frame(maxWidth: .infinity, alignment: .leading)
                NFIconButton(Lucide.plus, label: L("new_project"), iconSize: 15) { dialog = .newGroup }
            }
            .padding(.horizontal, 8)
            .padding(.top, 9.6)
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
            // NOTES 标签同时是“移出项目”的投放区（网页 data-note-group-drop=""）。
            NotesSectionLabel(L("notes"))
                .padding(.horizontal, 8)
                .padding(.top, 14.4)
                .padding(.bottom, 4.8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .reorderDropZone("", in: reorder)
            ForEach(state.loosePages) { page in
                NotesDrawerTree(page: page, busy: busy, reorder: reorder, dialog: $dialog)
            }
            if state.pages.isEmpty && state.loaded {
                Text(L("notes_list_empty"))
                    .font(.nf(12))
                    .nfLineHeight(20, fontSize: 12)
                    .foregroundStyle(Sm.muted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
                HStack(spacing: 6.4) {
                    LucideIcon(isOpen ? Lucide.chevronDown : Lucide.chevronRight, size: 14, color: Sm.text)
                    LucideIcon(Lucide.folder, size: 15, color: Sm.text)
                    Text(group.name)
                        .font(.nf(14, weight: 500))
                        .nfLineHeight(20, fontSize: 14)
                        .foregroundStyle(Sm.text)
                        .lineLimit(1)
                    Text(String(count))
                        .font(.nf(12))
                        .foregroundStyle(Sm.faint)
                        .lineLimit(1)
                        .layoutPriority(1)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 3.2)
                .padding(.vertical, 6.4)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.pressable(cornerRadius: 6.4))
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

/// 笔记行：高 44、圆角 6.4；展开箭头（20×28、左距 2、Chevron 14 浅灰）；图标按钮 40（表情 15 或文件图标 15 灰，点开表情选择器）；
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
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let active = state.open?.id == page.id
        let line = reorder.dropLine(page.id)
        HStack(spacing: 0) {
            toggle
            if active || page.locked {
                // 打开着的笔记：图标由编辑器保存，这里只显示，点它和点行一样。锁定的页面也不能在这里改图标。
                Button {
                    openNote()
                } label: {
                    NFIconTile(emoji: page.icon, fallback: Lucide.fileText, box: 40, glyph: 15)
                }
                .buttonStyle(.pressable(pressedBackground: nil))
                .disabled(busy)
                .accessibilityHidden(true)
            } else {
                iconButton
            }
            title(active: active, locked: busy || state.moveBusy.contains(page.id))
            NoteRowAction(icon: Lucide.plus, iconSize: 14, label: L("pg_add_page_inside_title", page.title)) {
                router.closeDrawer()
                notes.createNote(parentId: page.id)
            }
            .disabled(busy)
            NoteRowAction(icon: Lucide.folderInput, iconSize: 14, label: L("move_title_to_project", page.title)) {
                dialog = .move(pageId: page.id)
            }
            .disabled(busy)
            NoteRowAction(icon: Lucide.trash2, iconSize: 14, label: L("move_title_to_trash", page.title)) {
                dialog = .trashNote(page)
            }
            .disabled(busy)
        }
        .frame(minHeight: 44)
        .background(active ? Sm.accentSoft : Color.clear)
        // 插入线自己画在圆角里面（和聊天行一样）。
        .overlay(alignment: .top) {
            if line.before { ReorderDropLine() }
        }
        .overlay(alignment: .bottom) {
            if line.after { ReorderDropLine() }
        }
        .overlay(alignment: .leading) {
            if active && !line.before && !line.after {
                // 行首的蓝条：宽 3、上下各缩 7.2、圆角 1.5。
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(Sm.blue)
                    .frame(width: 3)
                    .padding(.vertical, 7.2)
                    .allowsHitTesting(false)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6.4))
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
            LucideIcon(expanded ? Lucide.chevronDown : Lucide.chevronRight, size: 14, color: Sm.faint)
                .frame(width: 20, height: 28)
        }
        .buttonStyle(.pressable(cornerRadius: 4))
        .padding(.leading, 2)
        .accessibilityLabel(expanded ? L("pg_collapse_title", page.title) : L("pg_expand_title", page.title))
    }

    /// 图标按钮 40×40（圆角 4），点开表情选择器（aria-label "Change icon of {title}"）；忙时禁用。
    /// 只用于没打开的笔记（`NotesViewModel.changeIcon`，PUT /api/pages/:id/icon）。
    private var iconButton: some View {
        let notes = app.notes
        let pageId = page.id
        return Button {
            picking.toggle()
        } label: {
            NFIconTile(emoji: page.icon, fallback: Lucide.fileText, box: 40, glyph: 15)
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
                .font(.nf(14, weight: active ? 550 : 400))
                .nfLineHeight(20, fontSize: 14)
                .foregroundStyle(active ? Sm.ink : Sm.text)
                .lineLimit(1)
                .padding(.leading, 4)
                .padding(.trailing, 8)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
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

/// Favorites 的行：高 44；图标区 28（左距 4，表情 / 文件图标 15 灰，不能点）；标题 14；
/// 右侧“从收藏中移除”25.6 的小按钮（StarOff 14）。当前打开的行浅蓝底。
@MainActor
private struct NotesDrawerFavoriteRow: View {
    let page: NotePageSummary
    let busy: Bool
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        let notes = app.notes
        let active = notes.state.open?.id == page.id
        let pageId = page.id
        HStack(spacing: 0) {
            Button {
                router.closeDrawer()
                notes.openNote(pageId)
            } label: {
                HStack(spacing: 0) {
                    NFIconTile(emoji: page.icon, fallback: Lucide.fileText, box: 28, glyph: 15)
                        .padding(.leading, 4)
                    Text(page.title)
                        .font(.nf(14, weight: active ? 550 : 400))
                        .nfLineHeight(20, fontSize: 14)
                        .foregroundStyle(active ? Sm.ink : Sm.text)
                        .lineLimit(1)
                        .padding(.leading, 4)
                        .padding(.trailing, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.pressable(cornerRadius: 0))
            .disabled(busy)
            NoteRowAction(icon: Lucide.starOff, iconSize: 14, label: L("pg_remove_title_from_favorites", page.title)) {
                Task { @MainActor in _ = await notes.setFavorite(pageId, false) }
            }
            .disabled(busy)
        }
        .frame(minHeight: 44)
        .background(active ? Sm.accentSoft : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 6.4))
    }
}
