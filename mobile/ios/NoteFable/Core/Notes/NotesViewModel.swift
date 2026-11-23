import Foundation
import Observation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// 没接图标接口时的默认实现（Kotlin 构造参数的默认值 `error("no icon backend")`）。
struct MissingNoteIconBackend: NoteIconBackend {
    func setNoteIcon(id: String, icon: String?) async throws -> NotePageSummary {
        throw UnsupportedOperationError()
    }
}

/// 笔记的列表、项目、回收站和打开着的笔记。Android 端 `ui/NotesViewModel.kt` 的移植，规则见 docs/architecture/android-native.md 的“笔记”。
///
/// Kotlin 的协程取消在这边的对应：被取消的任务（只有换身份、被新的刷新取代、关回收站会取消）在每次等待回来后
/// 看一眼 `Task.isCancelled`，取消了就什么都不写。
@MainActor
@Observable
final class NotesViewModel {
    private(set) var state: NotesUiState

    /// 编辑器打开时由界面设置：让网页立刻保存，返回是否已经没有未保存的内容。
    /// 离开、切换笔记、切到聊天之前都先调用；没有编辑器（还没加载完）时视为已保存。抛错算没保存。
    @ObservationIgnored var flushEditor: (@MainActor () async throws -> FlushResult)?

    /// 打开着的笔记的显示设置、锁定、收藏变了：交给网页编辑器（window.notefableEmbed.pageSettings），
    /// 编辑器随即变宽、换字体或变成只读。由界面在编辑器打开时设置。
    @ObservationIgnored var pushPageSettings: (@MainActor (NotePageSummary) -> Void)?

    /// 检索结果就在打开着的这一页里：让网页编辑器就地定位到命中的块 / 元素（window.notefableEmbed.reveal），不重新加载。
    /// 由界面在编辑器打开时设置（[registerEditor]）。
    @ObservationIgnored var revealInEditor: (@MainActor (String) -> Void)?
    /// 幻灯片的放映 / 导出（"…"菜单、放映中的返回）：交给网页编辑器（window.notefableEmbed.slides）。由界面在编辑器打开时设置。
    @ObservationIgnored var sendSlidesCommand: (@MainActor (String) -> Void)?

    @ObservationIgnored private let backend: NotesBackend
    @ObservationIgnored private let prefs: NotesPrefs
    /// 侧栏里改没打开的笔记的图标（PUT /api/pages/:id/icon）。
    @ObservationIgnored private let noteIcons: NoteIconBackend
    /// 编辑器分块送来的导出文件拼在这里（fileStart … fileEnd）。
    @ObservationIgnored private let exportFiles: ExportFileAssembler

    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var navigationTask: Task<Void, Never>?
    /// 有一个导航（离开笔记 → 做某事）还没跑完（Kotlin 的 navigationJob.isActive）。
    @ObservationIgnored private var navigating = false
    /// 每开始或作废一次导航加一：作废了的导航收尾时不会把新导航的 [navigating] 清掉。
    @ObservationIgnored private var navigationRun = 0
    @ObservationIgnored private var linkTask: Task<Void, Never>?
    @ObservationIgnored private var trashTask: Task<Void, Never>?
    @ObservationIgnored private var trashActionTasks: [Int: Task<Void, Never>] = [:]
    @ObservationIgnored private var nextTrashAction = 0
    /// 有一次导出还没完：连点不会重复导出（网页 exportPage 的 actionBusy）。
    @ObservationIgnored private var exporting = false

    /// 每次换身份加一。旧身份下发出、换身份后才回来的改动结果直接丢掉，不写进新身份的列表。
    @ObservationIgnored private var identity = 0

    /// 每完成一次改动（新建、移动、删除…）加一。刷新期间有改动完成的话，刷新读到的可能是改动前的列表，要重读。
    @ObservationIgnored private var mutations = 0

    init(
        backend: NotesBackend, prefs: NotesPrefs = MemoryNotesPrefs(), noteIcons: NoteIconBackend = MissingNoteIconBackend(),
        exportFiles: ExportFileAssembler = ExportFileAssembler()
    ) {
        self.backend = backend
        self.prefs = prefs
        self.noteIcons = noteIcons
        self.exportFiles = exportFiles
        state = NotesUiState(
            collapsed: prefs.collapsedGroups, expanded: prefs.expandedPages,
            collapsedSections: Set(prefs.collapsedSections.compactMap(PageKind.init(rawValue:)))
        )
    }

    /// 几个字段一起改时只发一次变更通知（Kotlin 的 `_state.update { it.copy(…) }`）。
    private func update(_ change: (inout NotesUiState) -> Void) {
        var next = state
        change(&next)
        // 换了编辑器（打开别的笔记、关掉编辑器、切到聊天）时，前一个编辑器的容量提示不再显示，
        // 它没送完的导出文件作废，收齐了还没存的也删掉（不在别的页面上弹出保存）。
        // 放映也随之结束：新的编辑器没有在放映（否则一直横屏、没有顶栏）。
        if next.open?.editor != state.open?.editor {
            next.storageLimit = nil
            discardExportFiles(next)
            next.exportFile = nil
            next.exportFileFailed = false
            next.presenting = false
        }
        state = next
    }

    /// 正在收的和 [state] 里收齐了还没存的导出文件都删掉（状态由调用的地方清）。
    private func discardExportFiles(_ state: NotesUiState) {
        exportFiles.cancel()
        if let file = state.exportFile { exportFiles.discard(file) }
    }

    /// 改动完成后调用：还是同一个身份才把结果写进界面，并记一次改动。
    @discardableResult
    private func commit(_ identityAtStart: Int, _ apply: @MainActor () -> Void) -> Bool {
        if identityAtStart != identity { return false }
        mutations += 1
        apply()
        return true
    }

    // ---- 列表 ----

    /// 同时只保留最新一次刷新，旧请求的结果丢弃。
    /// 请求期间有改动完成的话，读到的列表可能比本地的旧（少了刚建的、多了刚删的），重读一次再用。
    func refresh() {
        loadTask?.cancel()
        update {
            $0.loading = !$0.loaded
            $0.error = nil
        }
        loadTask = Task {
            var result: Result<NotesList, Error>
            while true {
                let seen = mutations
                do {
                    result = .success(try await backend.notes())
                } catch {
                    result = .failure(error)
                }
                if Task.isCancelled { return }
                if case .failure = result { break }
                if seen == mutations { break }
            }
            switch result {
            case .success(let list):
                // 页面类型的功能表（分区、新建菜单的开关）：服务端发来就用服务端的（网页 PAGE_KIND_FEATURES）。
                if let kinds = list.kinds { PageKindTable.shared.update(kinds) }
                update {
                    if let kinds = list.kinds { $0.kindFeatures = kinds }
                    $0.pages = list.pages
                    $0.groups = list.groups
                    $0.loading = false
                    $0.loaded = true
                    $0.error = nil
                }
            case .failure(let error):
                update {
                    $0.loading = false
                    $0.error = errorOf(.load, error)
                }
            }
        }
    }

    /// 登录或退出后身份变了：清掉列表和打开的笔记，按新身份重新读。
    func onIdentityChanged() {
        identity += 1
        // 旧身份的图标写入不再算数：等着它的打开操作放行，新身份同一篇笔记的选择重新排队。
        for write in iconWrites.values { write.done.complete(false) }
        iconWrites.removeAll()
        loadTask?.cancel()
        // 换身份前排着的打开 / 新建不再执行，回收站里进行中的操作也不再写回。
        navigationTask?.cancel()
        navigationTask = nil
        navigationRun += 1
        navigating = false
        linkTask?.cancel()
        trashTask?.cancel()
        for task in trashActionTasks.values { task.cancel() }
        // 旧身份的编辑器导出的文件不留。
        discardExportFiles(state)
        state = NotesUiState(workspace: state.workspace, collapsed: state.collapsed, expanded: state.expanded, collapsedSections: state.collapsedSections)
        if state.workspace == .notes { refresh() }
    }

    /// 登录、退出之前调用：趁 WebView 还带着旧身份的 Cookie，把打开的笔记存掉。
    /// 存不上也继续（草稿留在 WebView 里），只是尽量不丢。
    func flushBeforeIdentityChange() async {
        if state.open == nil { return }
        _ = try? await flushEditor?()
    }

    private func flushOpen() async -> FlushResult {
        guard let flushEditor else { return FlushResult(true) }
        do {
            return try await flushEditor()
        } catch {
            return FlushResult(false)
        }
    }

    // ---- 导航（离开笔记前先让网页保存） ----

    /// 先保存当前笔记再执行 [action]。网页回答"还有没保存的"时留在笔记里，提示"保存失败，草稿已保留"。
    /// 草稿已留在 WebView 里、只是暂时存不上（断网、服务器出错，不是冲突）时，提示过一次后再操作一次就放行，
    /// 和网页 /app 一样不把人困在笔记里（网页切走时也只是 `void flush()`，草稿留在 localStorage 之后重试）。
    /// 保存途中编辑器自己关掉了（笔记已不存在）也放行。同一时刻只跑一个导航，连点不会叠加。
    private func leaveThen(before: (@MainActor () async -> Void)? = nil, _ action: @escaping @MainActor () async -> Void) {
        if navigating { return }
        navigating = true
        navigationRun += 1
        let run = navigationRun
        navigationTask = Task {
            defer {
                if navigationRun == run { navigating = false }
            }
            // 先等（例如目标笔记的图标写入），再保存当前笔记：等待期间在旧编辑器里输入的内容也会存上。
            await before?()
            if Task.isCancelled { return }
            if state.open != nil {
                let warned = state.notice?.kind == .unsavedDraft
                let result = await flushOpen()
                if Task.isCancelled { return }
                let stillOpen = state.open != nil
                if !result.ok && stillOpen && !(result.draftKept && warned) {
                    update { $0.notice = NotesError(.unsavedDraft) }
                    return
                }
            }
            await action()
        }
    }

    /// 切换工作区。[then] 只在真的切过去之后执行（已在目标工作区时立即执行）；
    /// 笔记存不上、留在笔记里，或另一个导航正在进行时不执行。
    func setWorkspace(_ workspace: Workspace, then: (@MainActor () -> Void)? = nil) {
        if state.workspace == workspace {
            then?()
            return
        }
        leaveThen { [self] in
            // 网页手机版切到 Note 时总是先显示列表（去掉 page=）。
            update {
                $0.workspace = workspace
                $0.open = nil
                $0.saveState = nil
                $0.notice = nil
            }
            then?()
            if workspace == .notes { refresh() }
        }
    }

    /// 打开笔记。[title] / [icon] / [kind] 给不在已读列表里的笔记用（检索结果：列表可能还没读过）；
    /// 笔记已不存在时编辑器会报 missing，和网页一样回到列表。
    /// [reveal] 是检索结果命中的块 / 元素：要打开别的页面时放进 [OpenNote.reveal]（编辑器第一次加载时交给网页）；
    /// 已经开着这一篇时不重新加载，交给开着的编辑器就地定位（[revealInEditor]）。
    func openNote(_ id: String, title: String? = nil, icon: String? = nil, kind: PageKind = .note, reveal: String? = nil) {
        let current = state
        if current.open?.id == id {
            if current.workspace != .notes { update { $0.workspace = .notes } }
            if let reveal, !reveal.isEmpty { revealInEditor?(reveal) }
            return
        }
        var open: OpenNote
        if let page = current.pages.first(where: { $0.id == id }) {
            open = OpenNote(page: page)
        } else if let title {
            open = OpenNote(id, title, icon, kind: kind)
        } else {
            return
        }
        open.reveal = reveal
        // 侧栏刚改了这篇的图标、PUT 还没回来时先等它：编辑器会读到旧版本，下一次保存就会 409。
        let pending = iconWrites[id]
        leaveThen(before: { _ = await pending?.done.wait() }) { [self, open] in
            var target = open
            if pending != nil, let page = state.pages.first(where: { $0.id == id }) {
                target = OpenNote(page: page)
                target.reveal = reveal
            }
            update {
                $0.workspace = .notes
                $0.open = target
                $0.saveState = nil
                $0.notice = nil
            }
        }
    }

    /// 从回答里打开笔记（项目参考笔记、提案的 Open / Open the note），对应网页 page.tsx 的 openNoteFromLink：
    /// 马上切到笔记页（列表或读取中），再刷新列表，笔记出现了就打开；没找到（已删除、移到回收站、读取失败）就留在列表上。
    func openNoteFromLink(_ id: String) {
        linkTask?.cancel()
        let current = state
        if current.workspace == .notes && current.open?.id == id { return }
        leaveThen { [self] in
            update {
                $0.workspace = .notes
                $0.open = nil
                $0.saveState = nil
                $0.notice = nil
            }
            refresh()
            linkTask = Task {
                // 等最新的一次刷新结束（中途被新的刷新取代时等新的那次）。
                while let task = loadTask {
                    await task.value
                    if loadTask == task { break }
                }
                if Task.isCancelled { return }
                let now = state
                // 等待期间用户去了别处（回到聊天、打开了别的笔记）就不再打开。
                if now.workspace == .notes && now.open == nil && now.pages.contains(where: { $0.id == id }) { openNote(id) }
            }
        }
    }

    /// 回到笔记列表（顶栏的"<"、返回手势）。
    func closeNote() {
        if state.open == nil { return }
        leaveThen { [self] in
            update {
                $0.open = nil
                $0.saveState = nil
                $0.notice = nil
            }
            refresh()
        }
    }

    /// 新建一篇 [kind] 的空白页面并打开（网页 createNote）。[parentId] 指定时在那一篇里新建子页面（网页 "Add a page inside"），并展开父页面；
    /// 否则建在 [groupId] 项目的最上层（项目的"+"，折叠着就展开），都没有时建在那个类型的分区里（折叠着就展开）。
    func createNote(parentId: String? = nil, kind: PageKind = .note, groupId: String? = nil) {
        if state.busy { return }
        leaveThen { [self] in
            update {
                $0.busy = true
                $0.error = nil
            }
            do {
                let page = try await backend.createNote(parentId: parentId, kind: kind, groupId: parentId == nil ? groupId : nil)
                // 换身份会取消这个任务，列表已经清空：旧身份建的笔记不写进去。
                if Task.isCancelled { return }
                mutations += 1
                if let parentId {
                    expand(parentId)
                } else if let groupId {
                    if state.collapsed.contains(groupId) { toggleGroup(groupId) }
                } else {
                    openSection(state.sectionKind(of: page))
                }
                update {
                    $0.workspace = .notes
                    $0.pages = Self.upsert($0.pages, page)
                    $0.open = OpenNote(page: page)
                    $0.saveState = nil
                    $0.notice = nil
                    $0.busy = false
                }
            } catch {
                if Task.isCancelled { return }
                update {
                    $0.busy = false
                    $0.error = errorOf(.create, error)
                }
            }
        }
    }

    /// 点了编辑页顶栏下面的提示条：收起正显示的那一条（界面显示的是 `notice ?? error`，导入失败写在 error 里）。
    func dismissNotice() {
        update {
            if $0.notice != nil { $0.notice = nil } else { $0.error = nil }
        }
    }

    // ---- 网页编辑器发来的消息 ----

    /// 界面收到编辑器 [editor]（[OpenNote.editor]）发来的消息时调用。flushed 由 [NoteEmbedBridge] 自己处理。
    func onEditorMessage(_ editor: String, _ message: EmbedMessage) {
        switch message {
        case .ready(let id, let title, let icon, let kind):
            // 网页（重新）载入后不在放映：WebView 重载时收不到 end，这里把放映状态清掉（否则一直横屏、没有顶栏）。
            if state.open?.editor == editor, state.presenting { update { $0.presenting = false } }
            onEditorReady(editor, pageId: id, title: title, icon: icon, kind: kind)
        case .meta(let title, let icon): onEditorMeta(editor, title: title, icon: icon)
        case .saveState(let state): onEditorSaveState(editor, state)
        case .missing: onEditorMissing(editor)
        case .trashed: onEditorTrashed(editor)
        case .openPage(let id): openNoteFromLink(id)
        case .storageLimit(let tier, let used, let limit):
            // 已经关掉或换走的编辑器晚到的消息不收。
            guard state.open?.editor == editor else { break }
            update { $0.storageLimit = StorageLimitInfo(tier: tier, used: used, limit: limit) }
        case .drawing:
            // iOS 在白板页一直关着边缘返回和抽屉的边缘拖动（NotesUiState.editorCapturesEdgeSwipes），不用按画没画来切换。
            break
        case .presentation(let presentation, _, _):
            // 放映中：顶栏收起、横屏、屏幕常亮（界面看 state.presenting）。已经关掉或换走的编辑器晚到的消息不收。
            guard state.open?.editor == editor else { break }
            update { $0.presenting = presentation != "end" }
        case .fileStart(let id, let name, let mime, let size):
            guard state.open?.editor == editor else { break }
            receiveExportFile { try exportFiles.start(id: id, name: name, mime: mime, size: size) }
        case .fileChunk(let id, let index, let data):
            guard state.open?.editor == editor else { break }
            receiveExportFile { try exportFiles.append(id: id, index: index, data: data) }
        case .fileEnd(let id):
            guard state.open?.editor == editor else { break }
            receiveExportFile {
                guard let file = try exportFiles.finish(id: id) else { return }
                // 上一个的保存窗口还开着：同一时间只等一个保存位置（和 Android 一样），这个不存，提示没能保存。
                // 不能删掉上一个：保存窗口可能还在读它。
                if let previous = state.exportFile, previous != file {
                    exportFiles.discard(file)
                    update { $0.exportFileFailed = true }
                    return
                }
                update { $0.exportFile = file }
            }
        case .fileAbort(let id):
            // 网页自己放弃了（它在编辑器里说明原因），不另外提示。
            exportFiles.abort(id: id)
        case .flushed: break
        }
    }

    /// 编辑器关掉了：放映也随之结束（顶栏、竖屏恢复）。
    func presentationEnded() {
        if state.presenting { update { $0.presenting = false } }
    }

    /// 幻灯片的放映 / 导出（"…"菜单）。命令是网页 `parseSlidesCommand` 认的 JSON。
    func slidesCommand(_ command: String) {
        sendSlidesCommand?(command)
    }

    func dismissStorageLimit() {
        update { $0.storageLimit = nil }
    }

    // ---- 编辑器导出的文件（网页 src/lib/export-file.ts） ----

    /// 收一步；出了错（[ExportFileAssembler] 已经删掉写了一半的文件）提示保存失败。
    private func receiveExportFile(_ step: () throws -> Void) {
        do {
            try step()
        } catch {
            update { $0.exportFileFailed = true }
        }
    }

    /// 编辑器的网页进程没了（崩溃后重新加载）：拼了一半的文件不会再来，作废它（删掉写了一半的临时文件）。
    func cancelExportTransfer(editor: String) {
        guard state.open?.editor == editor else { return }
        exportFiles.cancel()
    }

    /// 系统的“存储到文件”结束了（存好、取消或失败都一样）：删掉临时文件。
    func finishExportFile(_ file: ExportedFile) {
        exportFiles.discard(file)
        if state.exportFile == file { update { $0.exportFile = nil } }
    }

    /// 界面提示过“没能保存”了。
    func dismissExportFileFailure() {
        if state.exportFileFailed { update { $0.exportFileFailed = false } }
    }

    // 下面的 [editor] 是发消息的编辑器（[OpenNote.editor]）。它就是打开着的编辑器时，换成它现在显示的页面 id。
    private func pageOf(_ editor: String) -> String {
        if let open = state.open, open.editor == editor { return open.id }
        return editor
    }

    /// 编辑器读好了页面 [pageId]。和打开着的不是同一页时，是冲突后"另存为新笔记"换到了副本：
    /// 打开着的笔记换成副本（WebView 不重新加载），原来那篇的列表项不动，重读列表把副本加进来。
    /// [kind] 是网页读到的页面类型（旧网页不发时是 nil，不改已知的类型）：从检索结果打开、列表里还没有这一篇时先按笔记显示，这里改对。
    func onEditorReady(_ editor: String, pageId: String, title: String, icon: String?, kind: PageKind? = nil) {
        if let open = state.open, open.editor == editor, open.id != pageId {
            update {
                $0.open = OpenNote(pageId, title, icon, editor: open.editor, kind: kind ?? open.kind)
                $0.saveState = nil
            }
            refresh()
            return
        }
        // 网页读到的类型，打开着的笔记和列表项两边都用（列表是旧服务端读的、没带类型时，顶栏、菜单、图标都以这里为准）。
        if let kind, let open = state.open, open.editor == editor, open.id == pageId {
            update { state in
                state.open?.kind = kind
                state.pages = state.pages.map { page in
                    guard page.id == pageId, page.kind != kind else { return page }
                    var next = page
                    next.kind = kind
                    return next
                }
            }
        }
        onEditorMeta(editor, title: title, icon: icon)
    }

    func onEditorMeta(_ editor: String, title: String, icon: String?) {
        let id = pageOf(editor)
        update { state in
            if var open = state.open, open.id == id {
                open.title = title
                open.icon = icon
                state.open = open
            }
            if state.pages.contains(where: { $0.id == id }) {
                state.pages = state.pages.map { page in
                    guard page.id == id else { return page }
                    var next = page
                    next.title = title
                    next.icon = icon
                    return next
                }
            }
        }
    }

    func onEditorSaveState(_ editor: String, _ saveState: String) {
        if state.open?.editor == editor { update { $0.saveState = saveState } }
    }

    /// 笔记不存在、不属于自己、已在回收站或保存时发现已被删：直接关掉（草稿留在 WebView 里），刷新列表。
    func onEditorMissing(_ editor: String) {
        if state.open?.editor != editor { return }
        update {
            $0.open = nil
            $0.saveState = nil
        }
        refresh()
    }

    /// 编辑器里把笔记移到了回收站。
    func onEditorTrashed(_ editor: String) {
        onPagesTrashed([pageOf(editor)])
    }

    /// 别处把这些页面移进了回收站（聊天里撤销了 AI 新建页面的提案：建的那篇和它的子页面，网页 notefable:pages-trashed）：
    /// 从列表里拿掉，开着的那篇直接关掉（不用再存，页面已经在回收站里了）。
    func onPagesTrashed(_ ids: [String]) {
        let removed = Set(ids)
        if removed.isEmpty { return }
        mutations += 1
        update { state in
            state.pages = state.pages.filter { !removed.contains($0.id) }
            if let open = state.open, removed.contains(open.id) {
                state.open = nil
                state.saveState = nil
            }
        }
    }

    // ---- 移到回收站 ----

    /// 网页的确认框"移到回收站"。打开着的那篇先保存，保存不了就不移（网页同样的提示）。成功返回 true。
    func trashNote(_ id: String) async -> Bool {
        if state.busy { return false }
        let owner = identity
        update {
            $0.busy = true
            $0.error = nil
        }
        do {
            // 子页面也一起移进回收站：打开着的是它或它的子页面时，先保存。
            let subtree = state.descendants(id).union([id])
            if let open = state.open, subtree.contains(open.id) {
                if !(await flushOpen()).ok {
                    if owner == identity {
                        update {
                            $0.busy = false
                            $0.error = NotesError(.trashUnsaved)
                        }
                    }
                    return false
                }
            }
            let removed = Set(try await backend.trashNote(id: id)).union([id])
            return commit(owner) {
                update { state in
                    let closing = state.open.map { removed.contains($0.id) } ?? false
                    state.busy = false
                    state.pages = state.pages.filter { !removed.contains($0.id) }
                    if closing {
                        state.open = nil
                        state.saveState = nil
                    }
                }
            }
        } catch {
            if owner == identity {
                let cancelled = isCancellation(error)
                update {
                    $0.busy = false
                    if !cancelled { $0.error = errorOf(.trash, error) }
                }
            }
            return false
        }
    }

    // ---- 项目（分组）：失败时不改列表，只在对话框里显示原因 ----

    /// 一次改动的结果：[apply] 把它写进界面，[value] 交还给调用者。
    private struct Applied<T> {
        let apply: @MainActor () -> Void
        let value: T
    }

    /// [run] 发请求，返回要写进界面的改动和结果；身份在请求期间换了（登录、退出）的话什么都不写，返回 nil。
    private func groupAction<T>(_ run: @MainActor () async throws -> Applied<T>) async -> T? {
        let owner = identity
        update { $0.groupError = nil }
        do {
            let result = try await run()
            return commit(owner, result.apply) ? result.value : nil
        } catch {
            if !isCancellation(error), owner == identity { update { $0.groupError = errorOf(.group, error) } }
            return nil
        }
    }

    func clearGroupError() {
        update { $0.groupError = nil }
    }

    func createGroup(_ name: String) async -> NoteGroupSummary? {
        await groupAction { [self] in
            let group = try await backend.createGroup(name: name)
            return Applied(apply: { self.update { $0.groups = $0.groups.filter { $0.id != group.id } + [group] } }, value: group)
        }
    }

    func renameGroup(_ id: String, name: String) async -> Bool {
        await groupAction { [self] in
            let group = try await backend.renameGroup(id: id, name: name)
            return Applied(apply: {
                self.update { state in
                    state.groups = state.groups.map { current in
                        guard current.id == id else { return current }
                        var next = current
                        next.name = group.name
                        return next
                    }
                }
            }, value: true)
        } ?? false
    }

    /// 项目删掉后，里面的笔记保留，变成未分组。
    func deleteGroup(_ id: String) async -> Bool {
        await groupAction { [self] in
            try await backend.deleteGroup(id: id)
            return Applied(apply: {
                self.update { state in
                    state.groups = state.groups.filter { $0.id != id }
                    state.pages = state.pages.map { page in
                        guard page.groupId == id else { return page }
                        var next = page
                        next.groupId = nil
                        return next
                    }
                }
            }, value: true)
        } ?? false
    }

    /// 移进项目（nil 是移出）。子页面会脱离父页面，成为项目的最上层，子孙一起移过去。
    func moveNote(_ pageId: String, groupId: String?) async -> Bool {
        await groupAction { [self] in
            let moved = Set(try await backend.moveNote(id: pageId, groupId: groupId)).union([pageId])
            return Applied(apply: { self.update { $0.pages = Self.movedToGroup($0.pages, pageId, moved, groupId) } }, value: true)
        } ?? false
    }

    /// 移到另一页面之下（网页 Move to 的页面）；子孙一起移动，项目跟随新的父页面。成功后展开新的父页面。
    func moveToPage(_ pageId: String, parentId: String) async -> Bool {
        await groupAction { [self] in
            var moved: [String: NotePageSummary] = [:]
            for page in try await backend.moveToPage(id: pageId, parentId: parentId) { moved[page.id] = page }
            return Applied(apply: {
                self.update { state in
                    state.pages = state.pages.map { page in
                        guard let update = moved[page.id] else { return page }
                        var next = page
                        next.parentId = update.parentId
                        next.groupId = update.groupId
                        return next
                    }
                }
                self.expand(parentId)
            }, value: true)
        } ?? false
    }

    /// 收藏、显示设置：服务端回来的这一篇的元数据写进列表；打开着的笔记还要交给编辑器。
    private func applyMeta(_ page: NotePageSummary) {
        update { state in
            state.pages = state.pages.map { current in
                guard current.id == page.id else { return current }
                var next = current
                next.favoritedAt = page.favoritedAt
                next.fullWidth = page.fullWidth
                next.smallText = page.smallText
                next.font = page.font
                next.locked = page.locked
                return next
            }
        }
        if state.open?.id == page.id { pushPageSettings?(page) }
    }

    /// 每篇页面的收藏、设置一次只发一个请求：连点几个开关时，后发的请求后回来，旧的应答不会盖掉新的设置。
    @ObservationIgnored private var metaLocks: [String: NoteDeferred<Bool>] = [:]

    private func serialMeta<T>(_ pageId: String, _ run: @MainActor () async -> T) async -> T {
        // 被叫醒后再看一遍：同时等着的几个里只有一个能拿到。
        while let held = metaLocks[pageId] { _ = await held.wait() }
        let lock = NoteDeferred<Bool>()
        metaLocks[pageId] = lock
        defer {
            metaLocks[pageId] = nil
            lock.complete(true)
        }
        return await run()
    }

    func setFavorite(_ pageId: String, _ favorite: Bool) async -> Bool {
        await serialMeta(pageId) { [self] in
            await groupAction { [self] in
                let page = try await backend.setFavorite(id: pageId, favorite: favorite)
                return Applied(apply: { self.applyMeta(page) }, value: true)
            } ?? false
        }
    }

    func updateSettings(_ pageId: String, _ settings: NotePageSettings) async -> Bool {
        await serialMeta(pageId) { [self] in
            await groupAction { [self] in
                let page = try await backend.updateSettings(id: pageId, settings: settings)
                return Applied(apply: { self.applyMeta(page) }, value: true)
            } ?? false
        }
    }

    func loadShare(_ pageId: String) async throws -> NoteShareState {
        try await backend.getShare(id: pageId)
    }

    func updateShare(_ pageId: String, _ patch: NoteSharePatch) async throws -> NoteShareState {
        let owner = identity
        if patch.enabled == true {
            let includeSubpages = patch.includeSubpages ?? true
            let scope = includeSubpages ? state.descendants(pageId).union([pageId]) : Set([pageId])
            if let open = state.open, scope.contains(open.id), !(await flushOpen()).ok {
                throw ApiException(status: 409, message: "Failed to update share settings.")
            }
        }
        let result = try await backend.updateShare(id: pageId, patch: patch)
        if let updated = result.page, owner == identity {
            update { s in
                s.pages = s.pages.map {
                    if $0.id == updated.id {
                        var copy = $0
                        copy.shareEnabled = updated.shareEnabled
                        copy.shareExpiresAt = updated.shareExpiresAt
                        return copy
                    }
                    return $0
                }
            }
        }
        return result.share
    }

    /// 复制这一篇和子页面（网页 Duplicate），复制完打开复制件。服务端复制的是已保存的内容，
    /// 所以打开着的是它或它的子页面时先保存，保存不了就不复制。
    func duplicate(_ pageId: String) {
        if state.busy { return }
        let owner = identity
        update {
            $0.busy = true
            $0.groupError = nil
        }
        Task {
            do {
                let subtree = state.descendants(pageId).union([pageId])
                if let open = state.open, subtree.contains(open.id), !(await flushOpen()).ok {
                    if owner == identity {
                        update {
                            $0.busy = false
                            $0.notice = NotesError(.unsavedDraft)
                        }
                    }
                    return
                }
                let result = try await backend.duplicate(id: pageId)
                let applied = commit(owner) {
                    update { state in
                        let copies = Set(result.pages.map(\.id))
                        let merged = state.pages.filter { !copies.contains($0.id) } + result.pages
                        state.busy = false
                        state.pages = Self.applyOrder(merged, result.order)
                    }
                }
                if applied { openNote(result.page.id, title: result.page.title, icon: result.page.icon, kind: result.page.kind) }
            } catch {
                if owner == identity {
                    let cancelled = isCancellation(error)
                    update {
                        $0.busy = false
                        if !cancelled { $0.groupError = errorOf(.group, error) }
                    }
                }
            }
        }
    }

    // ---- Markdown 导出 / 导入（网页 use-note-pages.ts 的 exportPage / importMarkdown） ----

    /// 导出这一篇的 Markdown（`{ fileName, markdown }`），交给界面去存成文件。服务端导出的是已保存的内容，
    /// 所以打开着的是它时先让网页保存；存不上（冲突、断网）就不导出，提示先处理草稿。
    /// 失败返回 nil，原因显示在编辑页顶栏下面（[NotesUiState.notice]；网页写在"…"菜单里，这边菜单已经关了）。
    func exportPage(_ id: String) async -> ExportedNote? {
        if exporting || state.busy { return nil }
        exporting = true
        defer { exporting = false }
        let owner = identity
        update {
            $0.groupError = nil
            // 上一次导出的提示不留着。
            if $0.notice?.kind == .export || $0.notice?.kind == .exportUnsaved { $0.notice = nil }
        }
        if state.open?.id == id, !(await flushOpen()).ok {
            if owner == identity { update { $0.notice = NotesError(.exportUnsaved) } }
            return nil
        }
        // 保存期间换了身份：不用新身份去读旧身份的笔记。
        guard owner == identity else { return nil }
        do {
            let note = try await backend.exportNote(id: id)
            return owner == identity ? note : nil
        } catch {
            if owner == identity, !isCancellation(error) { update { $0.notice = errorOf(.export, error) } }
            return nil
        }
    }

    /// 选好文件以后（网页 page.tsx 的 importMarkdownFiles 没带 groupId 的那一支）：一个项目都没有就直接导入（"无项目"）；
    /// 有项目就先查文件（[checkImportFiles]，不合格的先拒绝，不让人选完去处再被拒），合格返回 true，
    /// 由界面问"导入到"哪里，选好后再调 [importMarkdown]。返回 false 表示不用问（已经导入、已经提示，或什么也没选）。
    func beginImport(_ sources: [NoteImportSource]) async -> Bool {
        // 列表（含项目）还没读到时不知道有没有项目：不直接导入到"无项目"，先重新读列表（读不到会显示加载失败），读到后再导入。
        if !state.loaded {
            refresh()
            return false
        }
        if state.groups.isEmpty {
            await importMarkdown(sources)
            return false
        }
        // 别的操作还在进行时不问（[importMarkdown] 那时也不导入）：不让人选完去处以后什么都没发生。
        return !state.busy && !sources.isEmpty && checkImportFiles(sources)
    }

    /// 发请求之前在本机查数量、扩展名和大小（网页 use-note-pages.ts 的 checkImportFiles）：
    /// 不合格就把原因显示出来并返回 false；合格就收掉上一次的提示。
    private func checkImportFiles(_ sources: [NoteImportSource]) -> Bool {
        let problem = noteImportProblem(sources.map { (name: $0.name, size: $0.size) })
        update { $0.error = problem.map { NotesError($0) } }
        return problem == nil
    }

    /// 导入用户选的 Markdown 文件，建好后打开第一篇（网页 use-note-pages.ts 的 importMarkdown）。
    /// [groupId] 是导入到哪个项目，nil 是"无项目"。
    /// 发请求前先在本机查数量、扩展名和大小（[noteImportProblem]），不合格就只提示、不读也不传。
    /// 文件在后台线程读；读完按要发的内容再查一遍（[noteImportPayloadProblem]：选完又改了、系统没给出大小、
    /// 转成文字和 JSON 以后变大），读的期间换了身份就不传。
    func importMarkdown(_ sources: [NoteImportSource], groupId: String? = nil) async {
        if state.busy || sources.isEmpty { return }
        if !checkImportFiles(sources) { return }
        let owner = identity
        update {
            $0.busy = true
            $0.error = nil
        }
        do {
            let contents = try await Task.detached(priority: .userInitiated) {
                try sources.map { (name: $0.name, data: try $0.read()) }
            }.value
            // 读文件期间换了身份（登录 / 退出）：旧身份选的文件不传给新身份。忙碌状态已经由换身份清掉了。
            guard owner == identity else { return }
            let files = contents.map { ImportMarkdownFile(name: $0.name, markdown: noteImportText($0.data)) }
            if let problem = noteImportPayloadProblem(files, groupId: groupId) {
                update {
                    $0.busy = false
                    $0.error = NotesError(problem)
                }
                return
            }
            let created = try await backend.importMarkdown(files: files, groupId: groupId)
            let applied = commit(owner) {
                update { state in
                    let ids = Set(created.map(\.id))
                    let merged = created + state.pages.filter { !ids.contains($0.id) }
                    state.pages = notesStableSorted(merged) { Self.byPosition($0, $1, tieOnId: false) }
                    state.busy = false
                }
            }
            if applied, let first = created.first { openNote(first.id, title: first.title, icon: first.icon, kind: first.kind) }
        } catch {
            if owner == identity {
                let cancelled = isCancellation(error)
                update {
                    $0.busy = false
                    if !cancelled { $0.error = errorOf(.importFailed, error) }
                }
            }
        }
    }

    func toggleExpanded(_ id: String) {
        var next = state.expanded
        if state.isExpanded(id) { next.remove(id) } else { next.insert(id) }
        prefs.expandedPages = next
        update { $0.expanded = next }
    }

    private func expand(_ id: String) {
        if state.expanded.contains(id) { return }
        let next = state.expanded.union([id])
        prefs.expandedPages = next
        update { $0.expanded = next }
    }

    /// 一篇笔记正在写的图标（[changeIcon]）。[desired] 是最后选的值，[dirty] 表示还有没发出去的选择。
    private final class IconWrite {
        var desired: String?
        var dirty = true
        let done = NoteDeferred<Bool>()

        init(_ desired: String?) {
            self.desired = desired
        }
    }

    /// 每篇笔记同一时刻只有一个 PUT：中途再选的图标合并成下一次请求，响应按顺序写进列表，版本号不会倒退。
    @ObservationIgnored private var iconWrites: [String: IconWrite] = [:]

    /// 侧栏里改笔记图标（网页 use-note-pages.ts 的 changeIcon，只用于没打开的笔记）。成功后列表换成服务端的图标和版本号；
    /// 失败返回 false 并在侧栏显示"Could not change the icon. Try again."。
    /// 同一篇的请求串行：前一个还没回来时只记下最新的选择，等它回来再发（中间的选择不发）；所有调用者拿到整串的结果。
    func changeIcon(_ pageId: String, _ icon: String?) async -> Bool {
        update { $0.iconError = false }
        if let pending = iconWrites[pageId] {
            pending.desired = icon
            pending.dirty = true
            return await pending.done.wait()
        }
        let owner = identity
        let write = IconWrite(icon)
        iconWrites[pageId] = write
        var ok = false
        defer {
            if iconWrites[pageId] === write { iconWrites[pageId] = nil }
            write.done.complete(ok)
        }
        do {
            while write.dirty {
                write.dirty = false
                let page = try await noteIcons.setNoteIcon(id: pageId, icon: write.desired)
                let applied = commit(owner) {
                    update { state in
                        state.pages = state.pages.map { current in
                            guard current.id == pageId else { return current }
                            var next = current
                            next.icon = page.icon
                            next.version = page.version
                            return next
                        }
                    }
                }
                if !applied { return false }
            }
            ok = true
            return true
        } catch {
            if !isCancellation(error), owner == identity { update { $0.iconError = true } }
            return false
        }
    }

    /// 抽屉重新打开时清掉上次改图标失败的提示（网页侧栏关掉后组件卸载，iconError 跟着没了）。
    func dismissIconError() {
        update { $0.iconError = false }
    }

    // ---- 拖动排序（网页 notes-sidebar / notes-home 的 ReorderRowButton） ----

    /// 松手（[DragState.target]）：放到行前 / 后是排序，放到项目标题或 Notes 标签上是移进去；没有目标什么都不做。
    func drop(_ id: String, on target: DropTarget?) {
        switch target {
        case .row(let targetId, let after): reorder(ReorderMove(id: id, targetId: targetId, after: after))
        case .into(let containerId): dropIntoGroup(id, groupId: containerId)
        case nil: break
        }
    }

    /// 拖到另一篇笔记前 / 后（POST /api/pages/reorder，目标在别的项目里时服务端也改项目）。同一时间只做一次，和网页一样上一次没完就报错。
    func reorder(_ move: ReorderMove) {
        if state.reorderBusy {
            update { $0.reorderError = ReorderFailure(move.id, wait: true) }
            return
        }
        if move.id == move.targetId || state.moveBusy.contains(move.id) { return }
        let owner = identity
        update {
            $0.reorderBusy = true
            $0.moveBusy.insert(move.id)
            $0.reorderError = nil
        }
        Task {
            var failure: Error?
            var updates: [NoteOrderUpdate] = []
            do {
                updates = try await backend.reorderNote(id: move.id, targetId: move.targetId, after: move.after)
            } catch {
                failure = error
            }
            if owner != identity { return }
            if failure == nil { commit(owner) { update { $0.pages = Self.applyOrder($0.pages, updates) } } }
            update {
                $0.reorderBusy = false
                $0.moveBusy.remove(move.id)
                $0.reorderError = failure.map { ReorderFailure(move.id, serverDetail($0)) }
            }
        }
    }

    /// 拖到项目标题或 Notes 标签上（网页 onMoveGroup）：移进该项目（nil = 无项目），走普通的移动接口，不受排序锁限制，
    /// 只锁被拖的这一篇。侧栏里移进项目后展开它（网页 notes-sidebar 的 setCollapsed）。
    func dropIntoGroup(_ id: String, groupId: String?) {
        if state.moveBusy.contains(id) { return }
        if let current = state.pages.first(where: { $0.id == id }), current.groupId == groupId, current.parentId == nil { return }
        let owner = identity
        update {
            $0.moveBusy.insert(id)
            $0.reorderError = nil
        }
        Task {
            var moved: Set<String> = [id]
            var failure: Error?
            do {
                moved = Set(try await backend.moveNote(id: id, groupId: groupId)).union([id])
            } catch {
                failure = error
            }
            if owner != identity { return }
            if failure == nil {
                commit(owner) { update { $0.pages = Self.movedToGroup($0.pages, id, moved, groupId) } }
                if let groupId, state.collapsed.contains(groupId) { toggleGroup(groupId) }
                // 移出项目的页面回到自己类型的分区：分区折叠着就展开（网页 setSectionOpen）。
                if groupId == nil, let page = state.pages.first(where: { $0.id == id }) { openSection(state.sectionKind(of: page)) }
            }
            update {
                $0.moveBusy.remove(id)
                $0.reorderError = failure.map { ReorderFailure(id, serverDetail($0)) }
            }
        }
    }

    func dismissReorderError() {
        update { $0.reorderError = nil }
    }

    func toggleGroup(_ id: String) {
        var next = state.collapsed
        if next.contains(id) { next.remove(id) } else { next.insert(id) }
        prefs.collapsedGroups = next
        update { $0.collapsed = next }
    }

    /// 折叠 / 展开分区（网页 notes-sidebar 的分区标题）。
    func toggleSection(_ kind: PageKind) {
        setSectionCollapsed(kind, !state.collapsedSections.contains(kind))
    }

    private func openSection(_ kind: PageKind) {
        if state.collapsedSections.contains(kind) { setSectionCollapsed(kind, false) }
    }

    private func setSectionCollapsed(_ kind: PageKind, _ collapsed: Bool) {
        var next = state.collapsedSections
        if collapsed { next.insert(kind) } else { next.remove(kind) }
        prefs.collapsedSections = Set(next.map(\.wire))
        update { $0.collapsedSections = next }
    }

    // ---- 回收站 ----

    func openTrash() {
        update { $0.trash = TrashUiState() }
        loadTrash()
    }

    func closeTrash() {
        trashTask?.cancel()
        update { $0.trash = nil }
    }

    func loadTrash() {
        trashTask?.cancel()
        updateTrash {
            $0.items = nil
            $0.loadError = nil
        }
        trashTask = Task {
            var result: Result<[NoteTrashItem], Error>
            do {
                result = .success(try await backend.trash())
            } catch {
                result = .failure(error)
            }
            if Task.isCancelled { return }
            switch result {
            case .success(let items):
                updateTrash {
                    $0.items = items
                    $0.loadError = nil
                }
            case .failure(let error):
                updateTrash { $0.loadError = errorOf(.trashLoad, error) }
            }
        }
    }

    func confirmEmptyTrash(_ show: Bool) {
        updateTrash { $0.confirmAll = show }
    }

    func confirmDeleteForever(_ id: String?) {
        updateTrash { $0.confirmId = id }
    }

    func restore(_ id: String) {
        trashAction { [self] in
            // 一起移进回收站的子页面也回来。
            let restored = try await backend.restoreNote(id: id)
            return {
                self.update { state in
                    state.pages = restored.reduce(state.pages) { Self.upsert($0, $1) }
                    let remaining = state.trash?.items?.filter { $0.id != id }
                    state.trash?.items = remaining
                }
            }
        }
    }

    func deleteForever(_ id: String) {
        trashAction { [self] in
            let removed = Set(try await backend.deleteForever(id: id)).union([id])
            return {
                self.updateTrash { trash in
                    trash.confirmId = nil
                    trash.items = trash.items?.filter { !removed.contains($0.id) }
                }
            }
        }
    }

    func emptyTrash() {
        trashAction { [self] in
            // 只删确认时看到的（最新一条之前扔的），确认期间别处新扔的不删。
            guard let newest = state.trash?.items?.first?.deletedAt else { return nil }
            try await backend.emptyTrash(before: newest)
            return {
                self.updateTrash { trash in
                    trash.confirmAll = false
                    trash.items = []
                }
            }
        }
    }

    /// 回收站的一次操作。[work] 发请求，返回要写进界面的改动（nil 表示什么都没做）；
    /// 身份在请求期间换了（登录、退出）就丢掉结果。
    private func trashAction(_ work: @escaping @MainActor () async throws -> (@MainActor () -> Void)?) {
        guard let trash = state.trash, !trash.busy else { return }
        let owner = identity
        updateTrash {
            $0.busy = true
            $0.error = nil
        }
        let key = nextTrashAction
        nextTrashAction += 1
        trashActionTasks[key] = Task {
            defer { trashActionTasks[key] = nil }
            do {
                if let apply = try await work() { commit(owner, apply) }
            } catch {
                if owner == identity { updateTrash { $0.error = errorOf(.trashAction, error) } }
            }
            if owner == identity { updateTrash { $0.busy = false } }
        }
    }

    private func updateTrash(_ transform: (inout TrashUiState) -> Void) {
        guard var trash = state.trash else { return }
        transform(&trash)
        update { $0.trash = trash }
    }

    private func errorOf(_ kind: NotesError.Kind, _ error: Error) -> NotesError {
        NotesError(kind, serverDetail(error))
    }

    private func serverDetail(_ error: Error) -> String? {
        guard let message = (error as? ApiException)?.message, !ApiText.isBlank(message), !message.hasPrefix("HTTP ") else { return nil }
        return message
    }

    /// 调用者自己的任务被取消了（界面关掉）：Kotlin 那边是把 CancellationException 往上抛，不当成失败显示。
    private func isCancellation(_ error: Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled || Task.isCancelled
    }

    // ---- 列表的纯函数 ----

    /// 服务端的顺序：position 升序、新建的在前（网页 byPosition）。
    private nonisolated static func byPosition(_ a: NotePageSummary, _ b: NotePageSummary, tieOnId: Bool) -> Bool {
        if a.position != b.position { return a.position < b.position }
        if a.createdAt != b.createdAt { return a.createdAt > b.createdAt }
        return tieOnId && a.id > b.id
    }

    /// 加入或替换一条，再按服务端的顺序（position 升序、新建的在前）排。
    nonisolated static func upsert(_ pages: [NotePageSummary], _ page: NotePageSummary) -> [NotePageSummary] {
        notesStableSorted(pages.filter { $0.id != page.id } + [page]) { byPosition($0, $1, tieOnId: false) }
    }

    /// 排序结果写进列表：换成新的 position（被移动的那篇还换项目），再按服务端的顺序排（网页 byPosition）。
    nonisolated static func applyOrder(_ pages: [NotePageSummary], _ updates: [NoteOrderUpdate]) -> [NotePageSummary] {
        var byId: [String: NoteOrderUpdate] = [:]
        for update in updates { byId[update.id] = update }
        let next = pages.map { page -> NotePageSummary in
            guard let update = byId[page.id] else { return page }
            var next = page
            next.position = update.position
            if update.movedGroup { next.groupId = update.groupId }
            if update.movedParent { next.parentId = update.parentId }
            return next
        }
        return notesStableSorted(next) { byPosition($0, $1, tieOnId: true) }
    }

    /// 移进项目：这一篇脱离父页面，它和子孙都换成新的项目。
    nonisolated static func movedToGroup(_ pages: [NotePageSummary], _ id: String, _ moved: Set<String>, _ groupId: String?) -> [NotePageSummary] {
        pages.map { page in
            guard page.id == id || moved.contains(page.id) else { return page }
            var next = page
            next.groupId = groupId
            if page.id == id { next.parentId = nil }
            return next
        }
    }
}
