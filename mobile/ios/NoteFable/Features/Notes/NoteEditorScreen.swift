import SwiftUI
import UniformTypeIdentifiers

// 笔记编辑页（Android ui/NoteEditor.kt 的 NoteEditorScreen）：原生顶栏 + WebView 里的网页编辑器。
// 顶栏与网页手机版笔记页一致（高 56、左右 10.4）：菜单 40（图标 20）、间距 12、“<”返回列表 40（图标 22）、间距 12、
// 笔记图标（表情 15 / 文件图标 15）+ 间距 6 + 标题 14 灰；右侧搜索 40、间距 8、（锁定时）锁按钮高 32（Lock 14）、间距 8、
// 版本历史 40、间距 8、保存状态 14 灰（出错 / 冲突时 #b45309）、间距 8、“…”页面菜单 40（菜单宽 248）。
// “…”菜单的“导出 Markdown”：先让网页保存，再向服务端要 `{ fileName, markdown }`，交给系统的“存储到文件”（UTF-8 的 .md）。

@MainActor
struct NoteEditorScreen: View {
    private let open: OpenNote
    @Binding private var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    /// 编辑页现在显示的外观（设置里选的，或跟随系统）：原样交给网页编辑器。
    @Environment(\.colorScheme) private var colorScheme
    /// 等着写进用户选的位置的笔记 Markdown。
    @State private var exportDocument: MarkdownExportDocument? = nil
    @State private var exportName = ""
    @State private var exporting = false

    /// `dialog` 是笔记页的对话框状态：“…”菜单的“移动到”“移到回收站”经它打开窗口。
    init(open: OpenNote, dialog: Binding<NotesDialogState?>) {
        self.open = open
        self._dialog = dialog
    }

    var body: some View {
        let notes = app.notes
        let state = notes.state
        // 列表里这一篇（收藏、显示设置、锁定）；不在列表里时没有“…”菜单。
        let page = state.pages.first(where: { $0.id == open.id })
        VStack(spacing: 0) {
            topBar(state, page: page)
            if let notice = state.notice ?? state.error {
                // 离开时没能保存等提示：点一下收起。
                Button {
                    notes.dismissNotice()
                } label: {
                    NotesErrorBar(notesErrorText(notice, app.systemText))
                }
                .buttonStyle(.pressable(pressedBackground: nil))
                .padding(.horizontal, 24)
                .padding(.vertical, 8)
            }
            if let storage = state.storageLimit {
                // 上传因存储空间不够被拒绝（网页 StorageLimitPrompt）：说明原因和用量，未登录时给登录入口。
                GuestLimitPrompt(storage: storage, attachmentsLost: false) { notes.dismissStorageLimit() }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
            NoteEditorWebView(
                editor: open.editor, app: app, router: router,
                appIcon: app.appIcon.icon, language: app.language.uiLocale,
                theme: (colorScheme == .dark ? ResolvedTheme.dark : ResolvedTheme.light).rawValue
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Sm.background)
        .fileExporter(
            isPresented: $exporting,
            document: exportDocument,
            contentType: MarkdownExportDocument.markdown,
            defaultFilename: exportName
        ) { result in
            exportDocument = nil
            // 存好了不另外提示（网页是浏览器自己的下载）；取消选择什么也不做。
            guard case .failure(let failure) = result else { return }
            if (failure as? CocoaError)?.code == .userCancelled { return }
            Toast.show(L("note_export_failed"), long: true)
        }
    }

    /// 导出这一篇（网页 exportPage）。失败的原因由 ViewModel 写进顶栏下面的提示条；读到之前离开了这篇笔记就不再弹出保存位置的选择。
    private func exportMarkdown(_ id: String) {
        let notes = app.notes
        Task { @MainActor in
            guard let note = await notes.exportPage(id), notes.state.open?.id == id else { return }
            exportDocument = MarkdownExportDocument(text: note.markdown)
            exportName = noteExportBaseName(note.fileName)
            exporting = true
        }
    }

    private func topBar(_ state: NotesUiState, page: NotePageSummary?) -> some View {
        let notes = app.notes
        let actions = menuActions(state)
        return HStack(spacing: 0) {
            NFIconButton(Lucide.menu, label: L("open_menu")) { router.openDrawer() }
            NFIconButton(Lucide.chevronLeft, label: L("all_notes"), iconSize: 22) { notes.closeNote() }
                .padding(.leading, 12)
            NFIconTile(emoji: open.icon, fallback: Lucide.fileText, box: 20, glyph: 15)
                .padding(.leading, 12)
            Text(open.title.isEmpty ? L("workspace") : open.title)
                .font(.nf(14))
                .nfLineHeight(20, fontSize: 14)
                .foregroundStyle(Sm.muted)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 6)
            NFIconButton(Lucide.search, label: L("search_chats_and_notes")) { router.openSearch() }
                .padding(.leading, 8)
            if page?.locked == true {
                lockButton(actions)
                    .padding(.leading, 8)
            }
            if let page {
                shareButton(page)
                    .padding(.leading, 8)
            }
            NFIconButton(Lucide.history, label: L("version_history")) { app.editorBridge?.openHistory() }
                .padding(.leading, 8)
            Text(noteSaveStateText(state.saveState))
                .font(.nf(14))
                .foregroundStyle(noteSaveStateIsWarning(state.saveState) ? Color(argb: 0xFFB45309) : Sm.muted)
                .lineLimit(1)
                .layoutPriority(1)
                .padding(.leading, 8)
            if let page {
                NotePageMenuButton(pageId: page.id, actions: actions)
                    .padding(.leading, 8)
            }
        }
        .padding(.horizontal, 10.4)
        .frame(height: 56)
    }

    private func shareButton(_ page: NotePageSummary) -> some View {
        let dialogBinding = $dialog
        return Button {
            dialogBinding.wrappedValue = .share(pageId: page.id)
        } label: {
            LucideIcon(Lucide.globe, size: 15, color: page.isShared() ? Sm.blue : Sm.muted)
                .padding(.horizontal, 8)
                .frame(height: 32)
        }
        .buttonStyle(.pressable(cornerRadius: 6))
        .accessibilityLabel(L("share_action"))
    }

    /// 锁定中（网页 .notes-locked-button，手机只有锁的图标）：高 32、左右 8、圆角 6、Lock 14 灰；点一下解锁。
    private func lockButton(_ actions: NotePageMenuActions) -> some View {
        Button {
            actions.onSettings(NotePageSettings(locked: false))
        } label: {
            LucideIcon(Lucide.lock, size: 14, color: Sm.muted)
                .padding(.horizontal, 8)
                .frame(height: 32)
        }
        .buttonStyle(.pressable(cornerRadius: 6))
        .accessibilityLabel(L("pg_unlock_page"))
    }

    /// “…”菜单各项的动作（Android NoteFableRoot.kt 里传给 NoteEditorScreen 的 NotePageMenuActions）。
    private func menuActions(_ state: NotesUiState) -> NotePageMenuActions {
        let notes = app.notes
        let id = open.id
        let dialogBinding = $dialog
        return NotePageMenuActions(
            error: state.groupError,
            busy: state.busy,
            onSettings: { settings in
                Task { @MainActor in _ = await notes.updateSettings(id, settings) }
            },
            onFavorite: { favorite in
                Task { @MainActor in _ = await notes.setFavorite(id, favorite) }
            },
            onDuplicate: { notes.duplicate(id) },
            onAddInside: { notes.createNote(parentId: id) },
            onMove: { dialogBinding.wrappedValue = .move(pageId: id) },
            onExport: { exportMarkdown(id) },
            onTrash: {
                if let page = notes.state.pages.first(where: { $0.id == id }) {
                    dialogBinding.wrappedValue = .trashNote(page)
                }
            }
        )
    }
}
