import SwiftUI

// 侧栏菜单里选了一项后打开的对话框（网页 chat-actions.tsx，Android ui/ChatActions.kt）：改名、新建项目、删除、移到项目。
// 都是 `.notes-dialog` 的外框（`.nfDialog`）。和网页 run() 一样：一次只跑一个操作（`SidebarActionRunner`），成功关闭；
// 失败留在窗口里显示原因（14 红字、上距 8）；请求进行中不能关。

/// 开着的对话框和它的操作状态。换一个对话框就是新的一项（新的 `id`），重新进场。
struct ChatDialogItem: Identifiable {
    let id = UUID()
    let action: ChatAction
    let runner: SidebarActionRunner
}

/// 对话框的内容。删掉 / 移走后菜单里的旧对象可能已过时：显示的标题以打开时为准，和网页一样。
struct ChatActionDialog: View {
    let item: ChatDialogItem

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let sidebar = app.sidebar
        let runner = item.runner
        switch item.action {
        case .rename(let session):
            ChatNameDialog(
                title: L("sb_rename_chat"), initial: session.title, maxLength: MAX_CHAT_TITLE,
                label: L("sb_chat_name"), submit: L("save"), runner: runner
            ) { name in
                await sidebar.rename(session.id, name)
            }
        case .renameProject(let project):
            ChatNameDialog(
                title: L("rename_project"), initial: project.name, maxLength: MAX_PROJECT_NAME,
                label: L("project_name"), submit: L("save"), runner: runner
            ) { name in
                await sidebar.renameProject(project.id, name)
            }
        case .createProject:
            ChatNameDialog(
                title: L("new_project"), initial: "", maxLength: MAX_PROJECT_NAME,
                label: L("project_name"), submit: L("create"), runner: runner
            ) { name in
                await sidebar.createProject(name).error
            }
        case .delete(let session):
            ChatDeleteDialog(name: session.title, message: L("sb_chat_delete_body"), runner: runner) {
                await sidebar.delete(session.id)
            }
        case .deleteProject(let project):
            ChatDeleteDialog(name: project.name, message: L("sb_project_delete_body"), runner: runner) {
                await sidebar.deleteProject(project.id)
            }
        case .move(let session):
            ChatMoveDialog(session: session, runner: runner)
        case .menu, .projectMenu, .projectSettings:
            // 菜单贴着行上的按钮开；项目设置是另一个窗口（ProjectSettingsDialog）。
            EmptyView()
        }
    }
}

private struct ChatDialogFeedback: View {
    let error: SidebarError?

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        if let error {
            NFDialogError(sidebarErrorText(error, app.systemText))
        }
    }
}

/// 改名 / 新建项目：标题 + 输入框 + 取消 / 保存（或创建）。聊天名最多 120 字，项目名 60 字。
private struct ChatNameDialog: View {
    private let title: String
    private let maxLength: Int
    private let label: String
    private let submit: String
    private let runner: SidebarActionRunner
    private let work: @MainActor (String) async -> SidebarError?
    @State private var value: String

    init(
        title: String,
        initial: String,
        maxLength: Int,
        label: String,
        submit: String,
        runner: SidebarActionRunner,
        work: @escaping @MainActor (String) async -> SidebarError?
    ) {
        self.title = title
        self.maxLength = maxLength
        self.label = label
        self.submit = submit
        self.runner = runner
        self.work = work
        self._value = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NFDialogTitle(title)
            NFDialogTextField(text: $value, label: label, maxLength: maxLength) { save() }
            ChatDialogFeedback(error: runner.error)
            NFDialogButtons {
                NotionButton(L("cancel")) { runner.close() }
                    .disabled(runner.busy)
                NotionButton(submit, kind: .primary) { save() }
                    .disabled(runner.busy || ApiText.isBlank(value))
            }
        }
    }

    private func save() {
        if ApiText.isBlank(value) { return }
        let name = value
        let work = self.work
        runner.run { await work(name) }
    }
}

/// 删除聊天 / 项目：标题“删除“名称”？” + 说明 + 取消 / 删除（红字）。
private struct ChatDeleteDialog: View {
    let name: String
    let message: String
    let runner: SidebarActionRunner
    let work: @MainActor () async -> SidebarError?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NFDialogTitle(L("sb_delete_name_q", name))
            NFDialogDescription(message)
            ChatDialogFeedback(error: runner.error)
            NFDialogButtons {
                NotionButton(L("cancel")) { runner.close() }
                    .disabled(runner.busy)
                NotionButton(L("sb_delete_"), kind: .danger) { runner.run(work) }
                    .disabled(runner.busy)
            }
        }
    }
}

/// 移到项目（网页 ChatActions 的 move）：标题“将“…”移到”，选项“无项目” + 各项目（当前所在的打 ✓，不加灰底），
/// 下面“＋ 新项目”展开成输入框 + “创建并移动”；建好项目但移动失败时项目留着，可以从列表里再选。
private struct ChatMoveDialog: View {
    let session: SessionSummary
    let runner: SidebarActionRunner

    @Environment(AppEnvironment.self) private var app
    @State private var creating = false
    @State private var name = ""

    var body: some View {
        let sidebar = app.sidebar
        let busy = runner.busy
        VStack(alignment: .leading, spacing: 0) {
            NFDialogTitle(L("move_note_to", session.title))
            // .chat-project-options：上距 12。
            VStack(alignment: .leading, spacing: 0) {
                ForEach(moveOptions(session, sidebar.state.projects)) { option in
                    NFOptionRow(option.label, isSelected: option.checked, highlightsSelection: false) {
                        let sessionId = session.id
                        let projectId = option.projectId
                        runner.run { await sidebar.moveToProject(sessionId, projectId) }
                    }
                }
            }
            .padding(.top, 12)
            .disabled(busy)

            if creating {
                NFDialogTextField(
                    text: $name, label: L("new_project_name"), placeholder: L("project_name"), maxLength: MAX_PROJECT_NAME
                ) {
                    createAndMove()
                }
                NotionButton(L("create_and_move"), kind: .primary) { createAndMove() }
                    .disabled(busy || ApiText.isBlank(name))
                    .padding(.top, 8)
            } else {
                NFOptionRow(L("sb_new_project_plus")) {
                    name = ""
                    creating = true
                }
                .disabled(busy)
            }

            ChatDialogFeedback(error: runner.error)
            NFDialogButtons(topSpacing: 16) {
                NotionButton(L("cancel")) { runner.close() }
                    .disabled(busy)
            }
        }
    }

    private func createAndMove() {
        runner.createAndMove(app.sidebar, sessionId: session.id, name: name) {
            creating = false
        }
    }
}
