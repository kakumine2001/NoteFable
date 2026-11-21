import SwiftUI
import UIKit

// 笔记的对话框（网页 note-group-dialogs.tsx：GroupNameDialog / ConfirmDialog / MoveNoteDialog；Android ui/NotesUi.kt 的同名部分和
// NoteFableRoot.kt 的 NotesDialogs）。外框是 DesignSystem 的 `.nfDialog`（网页 .notes-dialog）。
// 操作失败时窗口不关，原因显示在窗口里；请求进行中点遮罩不关（网页 run() 锁住窗口）。

/// 开着的笔记对话框（Android NotesDialogState）。
enum NotesDialogState: Identifiable, Equatable {
    case move(pageId: String)
    case newGroup
    case renameGroup(NoteGroupSummary)
    case deleteGroup(NoteGroupSummary)
    case trashNote(NotePageSummary)

    var id: String {
        switch self {
        case .move(let pageId): return "move:" + pageId
        case .newGroup: return "new-group"
        case .renameGroup(let group): return "rename-group:" + group.id
        case .deleteGroup(let group): return "delete-group:" + group.id
        case .trashNote(let page): return "trash-note:" + page.id
        }
    }
}

extension View {
    /// 按 `dialog` 显示笔记的对话框。侧栏和笔记页各挂一个（各自的状态），关闭时清掉上一次的项目错误。
    func notesDialogs(_ dialog: Binding<NotesDialogState?>) -> some View {
        modifier(NotesDialogsModifier(dialog: dialog))
    }
}

private struct NotesDialogsModifier: ViewModifier {
    @Binding var dialog: NotesDialogState?
    /// 窗口里的请求进行中：这时点遮罩不关。
    @State private var busy = false
    /// 每换一个窗口（包括关掉）加一。和 Android / 网页一样请求中也能点“取消”，那个请求晚回来时
    /// 只认它自己的那一代：不改新窗口的 `busy`，也不关掉新窗口。
    @State private var generation = 0
    @Environment(AppEnvironment.self) private var app

    func body(content: Content) -> some View {
        let notes = app.notes
        let source = $dialog
        let item = Binding<NotesDialogState?>(
            get: { source.wrappedValue },
            set: { next in
                if next == nil { notes.clearGroupError() }
                source.wrappedValue = next
            }
        )
        let current = generation
        let busyBinding = $busy
        let generationBinding = $generation
        let ownBusy = Binding<Bool>(
            get: { busyBinding.wrappedValue },
            set: { if generationBinding.wrappedValue == current { busyBinding.wrappedValue = $0 } }
        )
        content
            .nfDialog(item: item, dismissDisabled: busy) { state in
                NotesDialogContent(state: state, busy: ownBusy, close: {
                    if generationBinding.wrappedValue == current { item.wrappedValue = nil }
                })
            }
            .onChange(of: dialog?.id) { _, _ in
                generation += 1
                busy = false
            }
    }
}

@MainActor
private struct NotesDialogContent: View {
    let state: NotesDialogState
    @Binding var busy: Bool
    let close: () -> Void
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let notes = app.notes
        switch state {
        case .move(let pageId):
            if let page = notes.state.pages.first(where: { $0.id == pageId }) {
                MoveNoteDialog(page: page, busy: $busy, close: close)
            } else {
                // 这篇笔记不在列表里了（别处删掉了）：关掉窗口。
                Color.clear
                    .frame(height: 0)
                    .onAppear(perform: close)
            }
        case .newGroup:
            GroupNameDialog(
                title: L("new_project"), initial: "", submitLabel: L("create"), busy: $busy, close: close,
                onSubmit: { name in await notes.createGroup(name) != nil }
            )
        case .renameGroup(let group):
            GroupNameDialog(
                title: L("rename_project"), initial: group.name, submitLabel: L("save"), busy: $busy, close: close,
                onSubmit: { name in await notes.renameGroup(group.id, name: name) }
            )
        case .deleteGroup(let group):
            NotesConfirmDialog(
                title: L("delete_project_title"),
                message: L("delete_project_body", group.name),
                confirmLabel: L("delete_project"),
                error: notes.state.groupError,
                busy: $busy,
                close: close,
                onConfirm: { await notes.deleteGroup(group.id) }
            )
        case .trashNote(let page):
            NotesConfirmDialog(
                title: L("trash_note_title"),
                message: L("trash_note_body", page.title, TRASH_RETENTION_DAYS)
                    + (notes.state.children(page.id).isEmpty ? "" : " " + L("pg_subpages_to_trash")),
                confirmLabel: L("move_to_trash"),
                error: notes.state.error,
                busy: $busy,
                close: close,
                onConfirm: { await notes.trashNote(page.id) }
            )
        }
    }
}

// MARK: - 新建 / 重命名项目

/// 新建 / 重命名项目（网页 GroupNameDialog）。`onSubmit` 成功返回 true 时关闭。
@MainActor
private struct GroupNameDialog: View {
    private let title: String
    private let submitLabel: String
    private let close: () -> Void
    private let onSubmit: @MainActor (String) async -> Bool
    @Binding private var busy: Bool
    @State private var name: String
    /// 提交过才显示错误（上一个窗口留下的错误不显示）。
    @State private var tried = false
    @Environment(AppEnvironment.self) private var app

    init(
        title: String,
        initial: String,
        submitLabel: String,
        busy: Binding<Bool>,
        close: @escaping () -> Void,
        onSubmit: @escaping @MainActor (String) async -> Bool
    ) {
        self.title = title
        self.submitLabel = submitLabel
        self.close = close
        self.onSubmit = onSubmit
        self._busy = busy
        self._name = State(initialValue: initial)
    }

    private func submit() {
        if busy || ApiText.isBlank(name) { return }
        busy = true
        tried = true
        let value = name
        let onSubmit = self.onSubmit
        let close = self.close
        let busyBinding = $busy
        Task { @MainActor in
            let ok = await onSubmit(value)
            busyBinding.wrappedValue = false
            if ok { close() }
        }
    }

    var body: some View {
        NFDialogTitle(title)
        NFDialogTextField(text: $name, label: L("project_name"), placeholder: L("project_name"), maxLength: 60) { submit() }
        if tried, let error = app.notes.state.groupError {
            NFDialogError(notesErrorText(error, app.systemText))
        }
        NFDialogButtons {
            NotionButton(L("cancel")) { close() }
            NotionButton(submitLabel, kind: .primary) { submit() }
                .disabled(busy || ApiText.isBlank(name))
        }
    }
}

// MARK: - 确认

/// 确认框（网页 ConfirmDialog 和“移到回收站？”）：取消 + 红字确认。`onConfirm` 成功返回 true 时关闭。
@MainActor
private struct NotesConfirmDialog: View {
    let title: String
    let message: String
    let confirmLabel: String
    let error: NotesError?
    @Binding var busy: Bool
    let close: () -> Void
    let onConfirm: @MainActor () async -> Bool
    @State private var tried = false
    @Environment(AppEnvironment.self) private var app

    private func confirm() {
        if busy { return }
        busy = true
        tried = true
        let onConfirm = self.onConfirm
        let close = self.close
        let busyBinding = $busy
        Task { @MainActor in
            let ok = await onConfirm()
            busyBinding.wrappedValue = false
            if ok { close() }
        }
    }

    var body: some View {
        NFDialogTitle(title)
        NFDialogDescription(message)
        if tried, let error {
            NFDialogError(notesErrorText(error, app.systemText))
        }
        NFDialogButtons {
            NotionButton(L("cancel")) { close() }
            NotionButton(confirmLabel, kind: .danger) { confirm() }
                .disabled(busy)
        }
    }
}

// MARK: - 移动

/// 选择移到哪里（网页 MoveNoteDialog）：未分组、已有项目、当场新建一个项目再移进去，或移到另一页面之下
/// （页面树可筛选；自己和自己的子孙不列出）。
@MainActor
private struct MoveNoteDialog: View {
    let page: NotePageSummary
    @Binding var busy: Bool
    let close: () -> Void
    @State private var creating = false
    @State private var filter = ""
    @State private var name = ""
    @State private var tried = false
    @Environment(AppEnvironment.self) private var app

    /// 发一个移动请求，成功就关窗口。忙的时候点了不算（Android 的 enabled = !busy，行不变灰）。
    private func run(_ work: @escaping @MainActor (NotesViewModel) async -> Bool) {
        if busy { return }
        busy = true
        tried = true
        let notes = app.notes
        let close = self.close
        let busyBinding = $busy
        Task { @MainActor in
            let ok = await work(notes)
            busyBinding.wrappedValue = false
            if ok { close() }
        }
    }

    private func move(_ groupId: String?) {
        let pageId = page.id
        run { notes in await notes.moveNote(pageId, groupId: groupId) }
    }

    private func moveToPage(_ parentId: String) {
        let pageId = page.id
        run { notes in await notes.moveToPage(pageId, parentId: parentId) }
    }

    private func createAndMove() {
        if ApiText.isBlank(name) { return }
        let pageId = page.id
        let value = name
        run { notes in
            guard let group = await notes.createGroup(value) else { return false }
            return await notes.moveNote(pageId, groupId: group.id)
        }
    }

    var body: some View {
        let state = app.notes.state
        NFDialogTitle(L("move_note_to", page.title))
        VStack(spacing: 2) {
            // 子页面不在任何项目的最上层，所以项目都不打勾（noteMoveGroupChecked）。
            NFOptionRow(L("no_project"), isSelected: noteMoveGroupChecked(page, groupId: nil)) { move(nil) }
            ForEach(state.groups) { group in
                NFOptionRow(group.name, isSelected: noteMoveGroupChecked(page, groupId: group.id)) { move(group.id) }
            }
        }
        .padding(.top, 12)
        newProject
        pages(state)
        if tried, let error = state.groupError {
            NFDialogError(notesErrorText(error, app.systemText))
        }
        NFDialogButtons(topSpacing: 16) {
            NotionButton(L("close")) { close() }
        }
    }

    @ViewBuilder
    private var newProject: some View {
        if creating {
            NFDialogTextField(
                text: $name, label: L("new_project_name"), placeholder: L("new_project_name"), maxLength: 60
            ) { createAndMove() }
            NotionButton(L("create_and_move"), kind: .primary) { createAndMove() }
                .disabled(busy || ApiText.isBlank(name))
                .padding(.top, 8)
        } else {
            NFOptionRow(L("new_project_ellipsis"), icon: Lucide.folderPlus) {
                if !busy { creating = true }
            }
            .padding(.top, 4)
        }
    }

    /// 页面树（网页 Move to 的 Pages）：按树的顺序，筛选时只平铺列出匹配的页面。
    @ViewBuilder
    private func pages(_ state: NotesUiState) -> some View {
        let targets = noteMoveTargets(state, moving: page.id)
        if !targets.isEmpty {
            let shown = filterNoteMoveTargets(targets, filter)
            NFDialogSubtitle(L("pg_pages"))
            NFDialogTextField(
                text: $filter, label: L("pg_search_pages"), placeholder: L("pg_search_pages"), maxLength: 200,
                autoFocus: false
            )
            // .notes-move-pages：最高 40dvh。
            FittingScrollView(maxHeight: UIScreen.main.bounds.height * 0.4) {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(shown) { target in
                        pageRow(target)
                    }
                    if shown.isEmpty {
                        Text(L("pg_no_matching_pages"))
                            .font(.nf(14))
                            .foregroundStyle(Sm.muted)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.top, 8)
        }
    }

    /// 一个目标页面：最小高 40、圆角 6、左距 12 + 每层 16、右距 9.6；图标 15（格宽 20）+ 间距 8 + 15 的标题；现在的父页面灰底、600、✓ 16。
    private func pageRow(_ target: NoteMoveTarget) -> some View {
        let checked = page.parentId == target.page.id
        return Button {
            moveToPage(target.page.id)
        } label: {
            HStack(spacing: 8) {
                NFIconTile(emoji: target.page.icon, fallback: Lucide.fileText, box: 20, glyph: 15)
                Text(target.page.title)
                    .font(.nf(15, weight: checked ? 600 : 400))
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if checked {
                    LucideIcon(Lucide.check, size: 16, color: Sm.text)
                }
            }
            .padding(.leading, 12 + CGFloat(target.depth) * 16)
            .padding(.trailing, 9.6)
            .frame(minHeight: 40)
        }
        .buttonStyle(.pressable(background: checked ? Sm.hover : .clear, cornerRadius: 6))
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}
