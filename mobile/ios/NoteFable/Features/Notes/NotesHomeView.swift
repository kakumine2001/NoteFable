import SwiftUI

// 笔记首页（网页 NotesHome，手机；Android ui/NotesUi.kt 的 NotesHome）：没有打开笔记时显示。左右 24、下 96；顶部 Chat / Note 切换（上距 4）；
// “Notes”32 / 750、行高 48、字距 −0.04em，上 8 下 12；项目小标题 13 / 600 灰 + 数量 13 浅灰，外边距 20 / 4 / 4；
// 每行最小高 56、下边 1px 线；图标区 28（表情 20 / 文件图标 20 浅灰）、间距 13.6、标题 17 / 500、日期 13 灰；
// 右侧 44×48 的“移到项目”（图标 18 浅灰）。下面“新笔记”（高 40、圆角 8、墨色）和“新项目”（高 40 文字按钮）。
// 笔记行长按后可以拖动排序；标题“Notes”和“No project”小标题是“移出项目”的投放区，项目小标题是“移进项目”的。

@MainActor
struct NotesHomeView: View {
    @Binding private var dialog: NotesDialogState?
    @State private var reorder = ReorderDragController()
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
                WorkspaceSwitch()
                    .padding(.top, 4)
                if let error = state.error {
                    NotesErrorBar(notesErrorText(error, app.systemText), onRetry: { notes.refresh() })
                        .padding(.top, 24)
                }
                if state.loading && nothing {
                    Text(L("loading_notes"))
                        .font(.nf(14))
                        .foregroundStyle(Sm.muted)
                        .padding(.top, 96)
                        .padding(.bottom, 16)
                } else if nothing {
                    if state.error == nil && state.loaded {
                        NotesEmptyView(busy: busy) { notes.createNote() }
                    }
                } else {
                    NotesHomeList(busy: busy, reorder: reorder, dialog: $dialog)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.bottom, 96)
            .reorderContainer(reorder, onStart: { _ in
                NoteReorderOrigin.shared.surface = .home
                notes.dismissReorderError()
            }) { id, target in
                notes.drop(id, on: target)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - 列表

@MainActor
private struct NotesHomeList: View {
    let busy: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let favorites = state.favorites
        let loose = state.loosePages
        // 标题“Notes”：也是“移出项目”的投放区。字距 −0.04em（从右到左的文字不加字距）。
        Text(L("notes"))
            .font(.nf(32, weight: 750))
            .tracking(layoutDirection == .rightToLeft ? 0 : -1.28)
            .nfLineHeight(48, fontSize: 32)
            .foregroundStyle(Sm.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .reorderDropZone("", in: reorder)
            .padding(.top, 8)
            .padding(.bottom, 12)
            .accessibilityAddTraits(.isHeader)
        // Favorites：小标题 + 平铺的行（不能拖，没有日期和移动键）。
        if !favorites.isEmpty {
            NotesHomeHeading(name: L("pg_favorites"), count: favorites.count)
                .notesHomeHeadingMargins()
            VStack(alignment: .leading, spacing: 0) {
                ForEach(favorites) { page in
                    NotesHomeFavoriteItem(page: page, busy: busy)
                }
            }
            .padding(.bottom, 16)
        }
        ForEach(state.groups) { group in
            groupSection(group, state)
        }
        // “No project”小标题的键是 " "（空白键都表示无项目），和标题“Notes”的 "" 分开登记、分开高亮。
        if !state.groups.isEmpty && !loose.isEmpty {
            NotesHomeHeading(name: L("no_project"), count: state.looseCount)
                .reorderDropZone(" ", in: reorder)
                .notesHomeHeadingMargins()
        }
        if !loose.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(loose) { page in
                    NotesHomeTree(page: page, busy: busy, reorder: reorder, dialog: $dialog)
                }
            }
            .padding(.bottom, 16)
        }
        buttons
    }

    /// 一个项目：小标题（“移进项目”的投放区）和它最上层的笔记。
    @ViewBuilder
    private func groupSection(_ group: NoteGroupSummary, _ state: NotesUiState) -> some View {
        let members = state.members(group.id)
        NotesHomeHeading(name: group.name, count: state.memberCount(group.id))
            .reorderDropZone(group.id, in: reorder)
            .notesHomeHeadingMargins()
        if members.isEmpty {
            Text(L("no_notes_in_project"))
                .font(.nf(14))
                .foregroundStyle(Sm.faint)
                .padding(4)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(members) { page in
                    NotesHomeTree(page: page, busy: busy, reorder: reorder, dialog: $dialog)
                }
            }
            .padding(.bottom, 16)
        }
    }

    /// “新笔记”和“新项目”：上距 8、间距 8。
    private var buttons: some View {
        let notes = app.notes
        return HStack(spacing: 8) {
            NotesInkButton(L("new_note"), height: 40) { notes.createNote() }
                .disabled(busy)
            Button {
                dialog = .newGroup
            } label: {
                HStack(spacing: 6.4) {
                    LucideIcon(Lucide.folderPlus, size: 16, color: Sm.text)
                    Text(L("new_project"))
                        .font(.nf(12.8, weight: 500))
                        .foregroundStyle(Sm.text)
                        .lineLimit(1)
                }
                .padding(.horizontal, 12)
                .frame(height: 40)
            }
            .buttonStyle(.pressable(scale: 0.97))
            .disabled(busy)
        }
        .padding(.top, 8)
    }
}

/// 项目小标题：名称 13 / 600 灰 + 间距 8 + 数量 13 浅灰。只有文字那么宽（拖到上面时高亮框只包住这一行）。
private struct NotesHomeHeading: View {
    let name: String
    let count: Int

    var body: some View {
        HStack(spacing: 8) {
            Text(name)
                .font(.nf(13, weight: 600))
                .nfLineHeight(19.5, fontSize: 13)
                .foregroundStyle(Sm.muted)
                .lineLimit(1)
            Text(String(count))
                .font(.nf(13))
                .nfLineHeight(19.5, fontSize: 13)
                .foregroundStyle(Sm.faint)
                .lineLimit(1)
                .layoutPriority(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private extension View {
    /// 小标题的外边距 20 / 4 / 4，放在投放区外面：高亮框不包住它（网页 h2 的 margin 不在背景里）。
    func notesHomeHeadingMargins() -> some View {
        self
            .padding(.horizontal, 4)
            .padding(.top, 20)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - 子页面的树

/// 一篇笔记和它展开的子页面（网页 notes-home）：子页面在展开的父页面下缩进 24；没有子页面时是“No pages inside”。
@MainActor
private struct NotesHomeTree: View {
    let page: NotePageSummary
    let busy: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let state = app.notes.state
        let kids = state.children(page.id)
        let isOpen = state.expanded.contains(page.id)
        NotesHomeItem(page: page, busy: busy, expanded: isOpen, reorder: reorder, dialog: $dialog)
        if isOpen {
            if kids.isEmpty {
                Text(L("pg_no_pages_inside"))
                    .font(.nf(14))
                    .foregroundStyle(Sm.faint)
                    .padding(.leading, 28)
                    .padding(.trailing, 4)
                    .padding(.vertical, 4)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(kids) { child in
                        NotesHomeTree(page: child, busy: busy, reorder: reorder, dialog: $dialog)
                    }
                }
                .padding(.leading, 24)
            }
        }
    }
}

// MARK: - 行

/// 首页的一行（网页 .notes-home-item > .notes-home-row）：展开箭头 28×48（Chevron 18 浅灰）；主体最小高 56（点一下打开、长按拖动）；
/// 右侧 44×48 的“移到项目”；下边 1px 线。
@MainActor
private struct NotesHomeItem: View {
    let page: NotePageSummary
    let busy: Bool
    let expanded: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let pageId = page.id
        HStack(spacing: 0) {
            Button {
                notes.toggleExpanded(pageId)
            } label: {
                LucideIcon(expanded ? Lucide.chevronDown : Lucide.chevronRight, size: 18, color: Sm.faint)
                    .frame(width: 28, height: 48)
            }
            .buttonStyle(.pressable())
            .accessibilityLabel(expanded ? L("pg_collapse_title", page.title) : L("pg_expand_title", page.title))
            Button {
                if !reorder.swallowsTap() { notes.openNote(pageId) }
            } label: {
                HStack(spacing: 13.6) {
                    NFIconTile(emoji: page.icon, fallback: Lucide.fileText, box: 28, glyph: 20, color: Sm.faint)
                    Text(page.title)
                        .font(.nf(17, weight: 500))
                        .nfLineHeight(25.5, fontSize: 17)
                        .foregroundStyle(Sm.text)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(noteShortDate(page.updatedAt))
                        .font(.nf(13))
                        .nfLineHeight(19.5, fontSize: 13)
                        .foregroundStyle(Sm.muted)
                        .lineLimit(1)
                        .layoutPriority(1)
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 6.4)
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            }
            .buttonStyle(.pressable(cornerRadius: 0))
            .disabled(busy)
            .reorderHandle(pageId, in: reorder, locked: busy || state.moveBusy.contains(pageId))
            Button {
                dialog = .move(pageId: pageId)
            } label: {
                LucideIcon(Lucide.folderInput, size: 18, color: Sm.faint)
                    .frame(width: 44, height: 48)
            }
            .buttonStyle(.pressable())
            .disabled(busy)
            .accessibilityLabel(L("move_title_to_project", page.title))
        }
        // 行高 57 = 56 + 下边的 1px 线。
        .padding(.bottom, 1)
        .overlay(alignment: .bottom) { NFDivider() }
        .reorderRow(pageId, in: reorder)
        .reorderError(errorText(state), rowHeight: 57) { notes.dismissReorderError() }
    }

    /// 这一篇的拖动失败提示（只在发起拖动的列表里显示）。
    private func errorText(_ state: NotesUiState) -> String? {
        guard let failure = state.reorderError, failure.id == page.id,
              NoteReorderOrigin.shared.surface == .home else { return nil }
        return reorderFailureText(failure, app.systemText)
    }
}

/// 收藏的行：最小高 56、下边 1px 线；图标区 28、间距 13.6、标题 17 / 500。
@MainActor
private struct NotesHomeFavoriteItem: View {
    let page: NotePageSummary
    let busy: Bool
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let notes = app.notes
        let pageId = page.id
        Button {
            notes.openNote(pageId)
        } label: {
            HStack(spacing: 13.6) {
                NFIconTile(emoji: page.icon, fallback: Lucide.fileText, box: 28, glyph: 20, color: Sm.faint)
                Text(page.title)
                    .font(.nf(17, weight: 500))
                    .nfLineHeight(25.5, fontSize: 17)
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 6.4)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        }
        .buttonStyle(.pressable(cornerRadius: 0))
        .disabled(busy)
        .padding(.bottom, 1)
        .overlay(alignment: .bottom) { NFDivider() }
    }
}

// MARK: - 空状态

/// 一篇笔记都没有（网页 NotesWorkspace 的空状态，手机）：上距 120；文件图标 28（线宽 1.4，浅灰）；
/// “Notes”40 / 750、行高 50、字距 −0.04em，上距 16；说明 15 / 24 灰（“/”是等宽小键帽），上距 8；
/// “新笔记”高 32、圆角 8、上距 24；最下面 12 / 20 浅灰的存储说明，上距 40、最宽 384。
@MainActor
private struct NotesEmptyView: View {
    let busy: Bool
    let onCreate: () -> Void
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            LucideIcon(Lucide.fileText, size: 28, strokeWidth: 1.4, color: Sm.faint)
            Text(L("notes"))
                .font(.nf(40, weight: 750))
                .tracking(layoutDirection == .rightToLeft ? 0 : -1.6)
                .nfLineHeight(50, fontSize: 40)
                .foregroundStyle(Sm.ink)
                .padding(.top, 16)
                .accessibilityAddTraits(.isHeader)
            Text(intro)
                .font(.nf(15))
                .nfLineHeight(24, fontSize: 15)
                .foregroundStyle(Sm.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            NotesInkButton(L("new_note"), height: 32, action: onCreate)
                .disabled(busy)
                .padding(.top, 24)
            Text(L("notes_storage_hint"))
                .font(.nf(12))
                .nfLineHeight(20, fontSize: 12)
                .foregroundStyle(Sm.faint)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 384, alignment: .leading)
                .padding(.top, 40)
        }
        .padding(.top, 120)
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
