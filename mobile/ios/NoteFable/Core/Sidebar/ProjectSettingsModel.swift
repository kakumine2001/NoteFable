import Foundation
import Observation

// 项目设置窗口里不画界面的部分（Android ui/ProjectSettings.kt）。

/// 一次最多列出的笔记数（网页 MAX_LISTED）；多了用筛选找。
let MAX_LISTED_NOTES = 100

/// 筛选：标题（空标题按 "Untitled" 算）包含关键词，不分大小写（网页 listed）。
func filterProjectNotes(_ pages: [ChatProjectNote], _ filter: String, _ untitled: String) -> [ChatProjectNote] {
    let query = ApiText.trim(filter).lowercased()
    if query.isEmpty { return pages }
    return pages.filter { ($0.title.isEmpty ? untitled : $0.title).lowercased().contains(query) }
}

/// 勾选 / 取消：已选的去掉；没满就加到最后；满了不变（网页 toggle）。
func toggleProjectNote(_ selected: [ChatProjectNote], _ note: ChatProjectNote, max: Int = MAX_PROJECT_NOTES) -> [ChatProjectNote] {
    if selected.contains(where: { $0.id == note.id }) { return selected.filter { $0.id != note.id } }
    if selected.count >= max { return selected }
    return selected + [note]
}

/// 输入框的字数上限（网页 textarea 的 maxLength，按 UTF-16 计）：超出的截掉，但不把一个表情（代理对）从中间切开。
func clipInstructions(_ text: String, _ max: Int) -> String {
    clipUtf16(text, max)
}

struct ProjectSettingsState: Equatable, Sendable {
    /// 读到的详情和全部笔记；nil 是还没读到。
    var loaded: ProjectSettingsLoaded? = nil
    var loadError: SidebarError? = nil
    var instructions = ""
    var selected: [ChatProjectNote] = []
    var filter = ""
    /// 保存中：整个窗口锁住，不能关。
    var busy = false
    var error: SidebarError? = nil
}

/// 项目设置窗口的状态（网页 ChatProjectSettings）：打开时读详情和笔记，失败可以重试；保存只发改了的字段，没改直接关。
@MainActor
@Observable
final class ProjectSettingsModel {
    private(set) var state = ProjectSettingsState()
    let project: ChatProjectSummary

    @ObservationIgnored private let sidebar: SidebarViewModel
    @ObservationIgnored private let onClose: () -> Void
    @ObservationIgnored private let work = PendingWork()
    @ObservationIgnored private var attempt = 0

    init(project: ChatProjectSummary, sidebar: SidebarViewModel, onClose: @escaping () -> Void) {
        self.project = project
        self.sidebar = sidebar
        self.onClose = onClose
        load()
    }

    // ---- 界面要显示的 ----

    /// "已用 / 上限"（按 UTF-16 计，和网页的 length 相同）。
    var instructionsCount: String { "\(state.instructions.utf16.count)/\(MAX_PROJECT_INSTRUCTIONS)" }
    var notesCount: String { "\(state.selected.count)/\(MAX_PROJECT_NOTES)" }
    /// 参考笔记选满了：没选的不能再勾，计数变橙色，下面多一行说明。
    var full: Bool { state.selected.count >= MAX_PROJECT_NOTES }
    var canSave: Bool { !state.busy && state.loaded != nil }
    var canClose: Bool { !state.busy }

    /// 筛选后的全部笔记；界面只列前 [MAX_LISTED_NOTES] 条（[listed]），多出来时显示 "sb_showing_first_notes"。
    func matching(untitled: String) -> [ChatProjectNote] {
        filterProjectNotes(state.loaded?.notes ?? [], state.filter, untitled)
    }

    func listed(untitled: String) -> [ChatProjectNote] {
        Array(matching(untitled: untitled).prefix(MAX_LISTED_NOTES))
    }

    /// 一条也列不出来时的说明：有笔记但筛选没命中 / 还没有笔记。
    var emptyNotesKey: String {
        (state.loaded?.notes.isEmpty ?? true) ? "sb_no_notes_yet" : "sb_no_notes_match"
    }

    func isChecked(_ note: ChatProjectNote) -> Bool {
        state.selected.contains { $0.id == note.id }
    }

    /// 没选、而且已经选满：这一项点不了。
    func isBlocked(_ note: ChatProjectNote) -> Bool {
        !isChecked(note) && full
    }

    // ---- 操作 ----

    func setInstructions(_ text: String) {
        state.instructions = clipInstructions(text, MAX_PROJECT_INSTRUCTIONS)
    }

    func setFilter(_ text: String) {
        state.filter = text
    }

    func toggle(_ note: ChatProjectNote) {
        if state.busy { return }
        state.selected = toggleProjectNote(state.selected, note)
    }

    func retry() {
        state.loadError = nil
        load()
    }

    func save() {
        guard let current = state.loaded, !state.busy else { return }
        guard let changes = projectSettingsChanges(current.detail, state.instructions, state.selected) else {
            onClose()
            return
        }
        state.busy = true
        state.error = nil
        work.launch { [weak self] in
            guard let self else { return }
            let failure = await self.sidebar.saveProjectSettings(self.project.id, changes)
            self.state.busy = false
            if let failure { self.state.error = failure } else { self.onClose() }
        }
    }

    /// 取消 / 返回键 / 点遮罩：保存中不关（否则请求结果到了也没人更新侧栏）。
    func close() {
        if !state.busy { onClose() }
    }

    func idle() async {
        await work.idle()
    }

    private func load() {
        attempt += 1
        let current = attempt
        work.launch { [weak self] in
            guard let self else { return }
            let result = await self.sidebar.loadProjectSettings(self.project.id)
            guard current == self.attempt else { return }
            switch result {
            case .success(let loaded):
                self.state.loaded = loaded
                self.state.instructions = loaded.detail.instructions ?? ""
                self.state.selected = loaded.detail.notes
            case .failure(let error):
                if error is CancellationError { return }
                self.state.loadError = self.sidebar.projectSettingsLoadError(error)
            }
        }
    }
}
