import SwiftUI
import UniformTypeIdentifiers

// 笔记编辑页（Android ui/NoteEditor.kt 的 NoteEditorScreen）：原生顶栏 + WebView 里的网页编辑器。
// 原生顶栏高 56：行首玻璃组是菜单和返回，行尾是搜索、解锁（锁定时）、分享、版本历史和“…”。
// 页面图标和标题在中间，保存状态排在标题下方。顶栏仍占原来的高度，WebView 从顶栏下方开始。
// 白板和幻灯片都能公开（`PageKindFeatures.publicShare`）。白板是网页的白板编辑器，编辑页不做边缘返回（`PageKind.capturesEdgeSwipes`，
// 离开用“<”）；幻灯片打开网页的幻灯片编辑器。
// “…”菜单的“导出 Markdown”：先让网页保存，再向服务端要 `{ fileName, markdown }`，交给系统的“存储到文件”（UTF-8 的 .md）。
// 白板的导出（PNG / SVG / PDF）在网页的编辑器里：文件经桥分块送来、ViewModel 拼好（`NotesUiState.exportFile`），这里交给系统的“存储到文件”。

@MainActor
struct NoteEditorScreen: View {
    private let open: OpenNote
    @Binding private var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(NoteEditorPool.self) private var editorPool
    /// 编辑页现在显示的外观（设置里选的，或跟随系统）：原样交给网页编辑器。
    @Environment(\.colorScheme) private var colorScheme
    /// 等着写进用户选的位置的笔记 Markdown。
    @State private var exportDocument: MarkdownExportDocument? = nil
    @State private var exportName = ""
    @State private var exporting = false
    /// 网页编辑器导出、正交给“存储到文件”的文件（ViewModel 拼好的临时文件），和是否正显示着保存位置的选择。
    @State private var savingFile: ExportedFile? = nil
    @State private var savingFileOpen = false

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
        // 页面类型：列表里有这一篇就用列表的，否则用打开时知道的（检索结果、网页的 ready 消息）。
        let kind = page?.kind ?? open.kind
        let editorWizard = state.slidesWizard?.editor == open.editor ? state.slidesWizard : nil
        let wizardShown = editorWizard?.shown == true
        VStack(spacing: 0) {
            if !state.presenting && !wizardShown { topBar(state, page: page) }
            if !state.presenting && !wizardShown, let notice = state.notice ?? state.error {
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
            if !state.presenting, let storage = state.storageLimit {
                // 上传因存储空间不够被拒绝（网页 StorageLimitPrompt）：说明原因和用量，未登录时给登录入口。
                GuestLimitPrompt(storage: storage, attachmentsLost: false) { notes.dismissStorageLimit() }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            } else if !state.presenting, let usage = state.usageLimit,
                      (usage.tier == "guest" && app.account.state.configured && app.account.state.user == nil)
                          || (usage.tier == "member" && app.account.state.user != nil) {
                // AI 面板或幻灯片生图撞到使用次数上限（网页 usageLimit）：未登录给原生登录入口，已登录免费会员只读提示（无内购）。
                GuestLimitPrompt(usage: usage, attachmentsLost: false) { notes.dismissUsageLimit() }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
            NoteEditorWebView(
                open: open, pool: editorPool, app: app, router: router,
                appIcon: app.appIcon.icon, language: app.language.uiLocale,
                theme: (colorScheme == .dark ? ResolvedTheme.dark : ResolvedTheme.light).rawValue,
                edgeBack: !kind.capturesEdgeSwipes || wizardShown
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                if let editorWizard {
                    SlidesWizardOverlayLauncher(
                        wizard: editorWizard,
                        pool: editorPool,
                        model: app.chat.state.selectedModel?.id,
                        reasoning: app.chat.state.selectedReasoning,
                        onShown: { notes.onSlidesWizardShown($0) },
                        onFailed: { notes.dismissSlidesWizard($0) }
                    )
                }
            }
        }
        // 幻灯片放映中：横屏、隐藏状态栏和主屏幕指示条、屏幕常亮（Android 的 PresentationMode）。
        .background(state.presenting ? Color.black : Color.clear)
        .statusBarHidden(state.presenting)
        .persistentSystemOverlays(state.presenting ? .hidden : .automatic)
        .ignoresSafeArea(edges: state.presenting ? .all : [])
        .onChange(of: state.presenting, initial: true) { _, presenting in
            OrientationLock.set(landscape: presenting)
            UIApplication.shared.isIdleTimerDisabled = presenting
        }
        .onDisappear {
            if OrientationLock.presenting { OrientationLock.set(landscape: false) }
            UIApplication.shared.isIdleTimerDisabled = false
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
        .background {
            // 挂在自己的视图上，不和上面 Markdown 导出的“存储到文件”互相影响。
            // 取消时系统不调 onCompletion（用 iOS 17 的 onCancellation 接住），不然临时文件会一直留着。
            Color.clear.fileExporter(
                isPresented: $savingFileOpen,
                document: savingFile.map { ExportedFileDocument(url: $0.url) },
                contentTypes: [savingFile.map(ExportedFileDocument.contentType) ?? .data],
                defaultFilename: savingFile.map(ExportedFileDocument.defaultFilename),
                onCompletion: { result in finishSavingFile(result) },
                onCancellation: { cancelSavingFile() }
            )
        }
        // ViewModel 拼好了网页送来的文件：让用户选保存的位置。
        .onChange(of: state.exportFile) { _, file in
            guard let file, file != savingFile else { return }
            savingFile = file
            savingFileOpen = true
        }
        // 没能收下网页送来的文件（类型不对、太大、缺了块）：提示一次。
        .onChange(of: state.exportFileFailed) { _, failed in
            guard failed else { return }
            notes.dismissExportFileFailure()
            Toast.show(L("export_file_failed"), long: true)
        }
    }

    /// 取消了“存储到文件”：删掉临时文件，什么也不说。
    private func cancelSavingFile() {
        if let file = savingFile { app.notes.finishExportFile(file) }
        savingFile = nil
    }

    /// “存储到文件”结束了：删掉临时文件；存好了提示“File saved.”，失败提示“Could not save the file.”，取消什么也不说。
    private func finishSavingFile(_ result: Result<URL, Error>) {
        if let file = savingFile { app.notes.finishExportFile(file) }
        savingFile = nil
        switch result {
        case .success:
            Toast.show(L("export_file_saved"))
        case .failure(let failure):
            if (failure as? CocoaError)?.code == .userCancelled { return }
            Toast.show(L("export_file_failed"), long: true)
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
        // 页面类型：列表里有这一篇就用列表的，否则用打开时知道的（检索结果、网页的 ready 消息）。
        let kind = page?.kind ?? open.kind
        // 只有有公开视图的类型能公开（按服务端的 kinds 表；现在笔记、白板、幻灯片都能公开），网页同样按这张表显示分享按钮。
        let sharePage = kind.features.publicShare ? page : nil
        let locked = page?.locked == true
        let showsSidebarToggle = !router.isSidebarDockedVisible
        // 固定有返回、搜索、历史三项；侧栏未常驻展开时再加行首菜单一项。
        let buttonCount = (showsSidebarToggle ? 4 : 3) + (locked ? 1 : 0) + (sharePage == nil ? 0 : 1) + (page == nil ? 0 : 1)
        let sideInset = NFChromeMetrics.compactSideInset
        let gap = NFChromeMetrics.gap

        return GeometryReader { proxy in
            // 两组各有 4pt 内边距；窄窗口缩按钮宽度，给标题留 44pt，菜单触发器仍是同一个视图。
            let buttonSpace = proxy.size.width - 2 * sideInset - 2 * gap - 8 - 44
            let buttonWidth = min(NFChromeMetrics.groupItemWidth, max(0, buttonSpace / CGFloat(buttonCount)))
            NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
                HStack(spacing: gap) {
                    NFGlassGroup {
                        if showsSidebarToggle {
                            NFGlassBarButton(Lucide.menu, label: L("open_menu"), width: buttonWidth) {
                                router.openSidebar()
                            }
                        }
                        NFGlassBarButton(Lucide.chevronLeft, label: L("all_notes"), width: buttonWidth, iconSize: 22) {
                            notes.closeNote()
                        }
                    }
                    titleBlock(kind: kind, saveState: state.saveState)
                        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                    NFGlassGroup {
                        NFGlassBarButton(Lucide.search, label: L("search_chats_and_notes"), width: buttonWidth) {
                            router.openSearch()
                        }
                        if locked {
                            NFGlassBarButton(Lucide.lock, label: L("pg_unlock_page"), width: buttonWidth, iconSize: 14) {
                                actions.onSettings(NotePageSettings(locked: false))
                            }
                        }
                        if let sharePage {
                            let shared = sharePage.isShared()
                            NFGlassBarButton(
                                Lucide.globe, label: L("share_action"), width: buttonWidth, iconSize: 15,
                                color: shared ? Sm.blue : nil, activeFill: shared ? Sm.accentSoft : nil
                            ) {
                                dialog = .share(pageId: sharePage.id, kind: sharePage.kind)
                            }
                        }
                        NFGlassBarButton(Lucide.history, label: L("version_history"), width: buttonWidth) {
                            app.editorBridge?.openHistory()
                        }
                        if let page {
                            NotePageMenuButton(pageId: page.id, actions: actions, buttonWidth: buttonWidth)
                        }
                    }
                }
            }
            .padding(.horizontal, sideInset)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(height: NFChromeMetrics.barHeight)
        .nfBarBackdrop(.top)
    }

    private func titleBlock(kind: PageKind, saveState: String?) -> some View {
        let statusText = noteSaveStateText(saveState)
        return VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 6) {
                NFIconTile(emoji: open.icon, fallback: pageKindIcon(kind), box: 16, glyph: 13)
                Text(open.title.isEmpty ? L("workspace") : open.title)
                    .font(.nf(14.5, weight: 560))
                    .nfLineHeight(20, fontSize: 14.5)
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            if !statusText.isEmpty {
                let isWarning = noteSaveStateIsWarning(saveState)
                let dotColor: Color = isWarning
                    ? Color(argb: 0xFFD97706)
                    : (saveState == "saving" || saveState == "unsaved") ? Sm.blue : Color(argb: 0xFF10B981)
                let pillBg = isWarning ? Color(light: 0x1FD97706, dark: 0x29F59E0B) : Sm.hover
                HStack(spacing: 4) {
                    Circle()
                        .fill(dotColor)
                        .frame(width: 6, height: 6)
                        .accessibilityHidden(true)
                    Text(statusText)
                        .font(.nf(11, weight: 520))
                        .foregroundStyle(isWarning ? Sm.kindSlidesText : Sm.muted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .accessibilityAddTraits(.updatesFrequently)
                }
                .padding(.horizontal, 6)
                .frame(height: 18)
                .background(pillBg, in: Capsule())
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.16), value: statusText)
    }

    /// “…”菜单各项的动作（Android NoteFableRoot.kt 里传给 NoteEditorScreen 的 NotePageMenuActions）。
    private func menuActions(_ state: NotesUiState) -> NotePageMenuActions {
        let notes = app.notes
        let router = self.router
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
            },
            // 幻灯片的放映和导出（网页做，导出的文件再交回 App 保存）。
            onSlides: { command in notes.slidesCommand(command) },
            // 「画成图」：先让网页保存（服务端读已保存的正文），存不上就在顶栏下面提示、不开始；进度窗口挂在根上。
            onDrawDiagram: { _ = router.drawDiagramFromNote(id) },
            drawingDiagram: app.diagrams.job(.note(pageId: id)) == .working,
            // 「生成幻灯片」：盖在当前编辑器上打开向导，读这篇之前由网页自己保存。
            onGenerateSlides: { router.openSlidesWizard(.note(pageId: id)) }
        )
    }
}

/// 网页编辑器导出、已经拼在临时文件里的文件（白板的 PNG / SVG / PDF，幻灯片的 PDF / PPTX / 多页 PNG 的 ZIP），交给系统的“存储到文件”。
/// 只写不读：内容从临时文件拷过去，不整个读进内存。临时文件在“存储到文件”结束后才删（`NotesViewModel.finishExportFile`）。
struct ExportedFileDocument: FileDocument {
    private static let pptx = UTType(filenameExtension: "pptx", conformingTo: .data) ?? .data
    /// `ExportFileTypes` 里的类型（存的时候用 [contentType] 选一个），认不出来的按普通数据。
    static let readableContentTypes: [UTType] = [.png, .svg, .pdf, pptx, .zip, .data]

    let url: URL

    init(url: URL) {
        self.url = url
    }

    init(configuration: ReadConfiguration) throws {
        throw CocoaError(.featureUnsupported)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        try FileWrapper(url: url, options: [])
    }

    /// 文件的系统类型（按 MIME，系统按它给文件名加扩展名）。
    static func contentType(_ file: ExportedFile) -> UTType {
        switch file.mime {
        case "image/png": return .png
        case "image/svg+xml": return .svg
        case "application/pdf": return .pdf
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return pptx
        case "application/zip": return .zip
        default: return .data
        }
    }

    /// 保存位置的选择里预先填好的名字：系统会按类型加扩展名，所以去掉；类型没有扩展名时（认不出来）留着原来的。
    static func defaultFilename(_ file: ExportedFile) -> String {
        contentType(file).preferredFilenameExtension == nil ? file.name : file.baseName
    }
}
