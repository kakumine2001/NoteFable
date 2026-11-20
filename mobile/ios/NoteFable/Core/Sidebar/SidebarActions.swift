import Foundation
import Observation

// 侧栏的菜单 / 对话框里不画界面的部分（Android ui/ChatActions.kt、ui/ChatSidebar.kt）。

/// 侧栏里打开的菜单 / 对话框（网页 chat-actions.tsx 的 ChatAction）。按钮的位置（菜单的锚点）由界面层自己记。
enum ChatAction: Equatable, Sendable {
    case menu(SessionSummary)
    case rename(SessionSummary)
    case move(SessionSummary)
    case delete(SessionSummary)
    case createProject
    case projectMenu(ChatProjectSummary)
    case projectSettings(ChatProjectSummary)
    case renameProject(ChatProjectSummary)
    case deleteProject(ChatProjectSummary)
}

/// 聊天名最多 120 字，项目名 60 字（网页输入框的 maxLength，按 UTF-16 计）。
let MAX_CHAT_TITLE = 120
let MAX_PROJECT_NAME = 60

/// 显示错误：服务端原句经系统文词典翻译，没有就用网页同一处的 msg() 句子。
func sidebarErrorText(_ error: SidebarError, _ system: SystemTextTranslator) -> String {
    error.detail.map { system.localize($0) } ?? L(error.fallback)
}

/// 项目行的简短说明（网页 projectHint）：有共通指示和 / 或参考笔记时才有，否则是空字符串。
func projectHint(_ project: ChatProjectSummary) -> String {
    var parts: [String] = []
    if project.hasInstructions { parts.append(L("sb_hint_instructions")) }
    if project.noteCount == 1 {
        parts.append(L("sb_one_reference_note"))
    } else if project.noteCount > 1 {
        parts.append(L("sb_n_reference_notes", project.noteCount))
    }
    return parts.joined(separator: " + ")
}

/// 项目里没有可列的聊天时的那行灰字：全都置顶了是 "All chats pinned"，否则 "No chats"。
func emptyProjectNoteKey(_ projectId: String, _ groups: SidebarGroups) -> String {
    groups.allPinned.contains(projectId) ? "sb_all_chats_pinned" : "sb_no_chats"
}

/// "移到项目"窗口的一个选项；[id] 为 nil 是"无项目"。[checked]：聊天现在就在这里。
struct MoveOption: Equatable, Sendable, Identifiable {
    var projectId: String?
    var label: String
    var checked: Bool

    var id: String { projectId ?? "" }
}

/// 选项"无项目" + 各项目（网页 ChatActions 的 move）。
func moveOptions(_ session: SessionSummary, _ projects: [ChatProjectSummary]) -> [MoveOption] {
    [MoveOption(projectId: nil, label: L("no_project"), checked: session.projectId == nil)]
        + projects.map { MoveOption(projectId: $0.id, label: $0.name, checked: session.projectId == $0.id) }
}

/// 一次只跑一个操作的小状态机（网页 run() 的 locked / busy / error；Android ChatActions.kt 的 Runner）。
/// 成功就关闭；失败留在窗口里显示原因。请求进行中对话框不能关（界面用 [canClose] 判断），
/// 否则服务端已经改了而本地列表没跟着更新。
@MainActor
@Observable
final class SidebarActionRunner {
    private(set) var busy = false
    private(set) var error: SidebarError?

    @ObservationIgnored private let onClose: () -> Void
    @ObservationIgnored private let work = PendingWork()

    init(onClose: @escaping () -> Void) {
        self.onClose = onClose
    }

    var canClose: Bool { !busy }

    /// 返回键 / 点遮罩 / 取消：忙的时候不关。
    func close() {
        if !busy { onClose() }
    }

    func run(_ operation: @escaping @MainActor () async -> SidebarError?) {
        if busy { return }
        busy = true
        error = nil
        work.launch { [weak self] in
            let failure = await operation()
            guard let self else { return }
            self.busy = false
            if let failure { self.error = failure } else { self.onClose() }
        }
    }

    /// 等正在跑的操作结束（单元测试用）。
    func idle() async {
        await work.idle()
    }
}

extension SidebarActionRunner {
    /// "移到项目"里的"创建并移动"：建好项目但移动失败时项目留着，可以从列表里再选。
    /// [onCreated] 在项目建好时调用（界面收起输入框）。
    func createAndMove(_ sidebar: SidebarViewModel, sessionId: String, name: String, onCreated: @escaping @MainActor () -> Void) {
        if ApiText.isBlank(name) { return }
        run {
            let created = await sidebar.createProject(name)
            guard let project = created.project else { return created.error }
            onCreated()
            return await sidebar.moveToProject(sessionId, project.id)
        }
    }
}
