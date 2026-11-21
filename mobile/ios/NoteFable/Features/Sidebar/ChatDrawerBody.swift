import SwiftUI

// 侧栏的聊天部分（网页 chat-sidebar.tsx，手机 412×915 下量的值；Android ui/ChatSidebar.kt）：
// - “新聊天”：.sidebar-primary-action，上距 12、下距 4、高 44、圆角 8、深色、左对齐 16 / 550。下面是 Search 行。
// - 列表区左右 8、下 16，可滚动；顺序是 Pinned（有置顶时）→ PROJECTS 标题（右侧 ＋ 40、图标 15）→ 各项目 → CHATS → 没项目的聊天。
// - 分区小标题 .chat-section-label：内边距 14.4 / 8 / 4.8，12 等宽大写灰字、字距 .06em。
// - 项目里的聊天左缩进 12；没有时 12 灰字 "No chats" / "All chats pinned"。
// - 拖动：长按标题区后拖。目标行上 / 下出现 2px 蓝线；拖到项目行或 CHATS 标签上整块浅蓝底加 1px 蓝框，放下即移进去并取消置顶。
// 行本身在 ChatSidebarRows.swift，菜单里的对话框在 ChatActionsUI.swift，项目设置在 ProjectSettingsDialog.swift。

/// 抽屉里的聊天部分：新聊天、Search、置顶 / 项目 / 聊天三段列表。
struct ChatDrawerBody: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    init() {}

    var body: some View {
        let chat = app.chat.state
        VStack(spacing: 0) {
            SidebarPrimaryButton(L("new_chat")) {
                app.chat.newChat()
                router.closeDrawer()
            }
            .padding(.horizontal, 8)
            .padding(.top, 12)
            .padding(.bottom, 4)

            // 网页侧栏里在“新建”按钮正下方。检索面板盖在抽屉上面，选了结果才关抽屉。
            SidebarSearchRow { router.openSearch() }

            // 聊天状态在生成回答时每个字都变；列表只看这四项，没变就不重算。
            ChatDrawerList(
                sessions: chat.sessions,
                activeId: chat.activeSessionId,
                loading: chat.sessionsLoading,
                failed: chat.sessionsFailed
            )
            .equatable()
        }
    }
}

private struct ChatDrawerList: View, Equatable {
    let sessions: [SessionSummary]
    let activeId: String?
    let loading: Bool
    let failed: Bool

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @State private var reorder = ReorderDragController()
    /// 开着的对话框（改名、移到项目、删除、新建项目）。
    @State private var dialog: ChatDialogItem? = nil
    /// 开着的项目设置。
    @State private var settings: ProjectSettingsModel? = nil

    nonisolated static func == (lhs: ChatDrawerList, rhs: ChatDrawerList) -> Bool {
        lhs.sessions == rhs.sessions && lhs.activeId == rhs.activeId && lhs.loading == rhs.loading && lhs.failed == rhs.failed
    }

    var body: some View {
        let side = app.sidebar.state
        let groups = SidebarGroups.of(sessions, side.projects)
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                if !groups.pinned.isEmpty {
                    ChatSectionLabel(L("sb_pinned"))
                    ForEach(groups.pinned) { session in
                        row(session, side)
                    }
                }

                ChatProjectsHeading { present(.createProject) }
                if side.projectsFailed {
                    SidebarSmallNote(L("sb_err_load_projects"), color: Sm.danger)
                }
                if let error = side.createError {
                    SidebarSmallNote(sidebarErrorText(error, app.systemText), color: Sm.danger)
                }
                ForEach(side.projects) { project in
                    projectSection(project, side, groups)
                }

                // CHATS 标签同时是“移出项目”的投放区（网页 data-chat-project-drop=""）。
                ChatSectionLabel(L("chats"))
                    .reorderDropZone("", in: reorder)
                if loading && sessions.isEmpty {
                    Spinner(size: 24)
                        .frame(maxWidth: .infinity)
                        .padding(24)
                } else if failed && sessions.isEmpty {
                    // 网页没有单独的“列表加载失败”文案，这里只给一个重试按钮（文案用网页已有的 Retry）。
                    Button {
                        app.chat.refreshSessions()
                    } label: {
                        Text(L("retry"))
                            .font(.nf(14, weight: 500))
                            .foregroundStyle(Sm.blue)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 40)
                    }
                    .buttonStyle(.pressable(cornerRadius: 6.4))
                } else {
                    ForEach(groups.loose) { session in
                        row(session, side)
                    }
                }
                if sessions.isEmpty && !loading && !failed {
                    // px-2 py-3 text-xs leading-5 灰字。
                    Text(L("chats_empty"))
                        .font(.nf(12))
                        .nfLineHeight(20, fontSize: 12)
                        .foregroundStyle(Sm.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 12)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.bottom, 16)
            .reorderContainer(reorder, onStart: { _ in app.sidebar.dismissReorderError() }) { id, target in
                // 行 → 排序；项目行 / CHATS 标签 → 移进去并取消置顶。
                app.sidebar.drop(id, on: target)
            }
        }
        .nfDialog(item: $dialog, dismissDisabled: dialog?.runner.busy ?? false) { item in
            ChatActionDialog(item: item)
        }
        .nfPanel(isPresented: settingsPresented, style: ProjectSettingsDialog.panelStyle) {
            if let settings {
                ProjectSettingsDialog(model: settings)
            }
        }
    }

    private var settingsPresented: Binding<Bool> {
        Binding(
            get: { settings != nil },
            set: { shown in
                if !shown { settings = nil }
            }
        )
    }

    private func row(_ session: SessionSummary, _ side: SidebarUiState) -> some View {
        let error = side.reorderError.flatMap { failure in
            failure.id == session.id ? sidebarErrorText(failure.error, app.systemText) : nil
        }
        return ChatSessionRow(
            session: session,
            active: session.id == activeId,
            // 和网页一样只锁正在移动的这一行；别的行照常能拖（排序还没完时由 reorder() 提示等待）。
            moveBusy: side.moveBusy.contains(session.id),
            errorText: error,
            reorder: reorder,
            onOpen: {
                app.chat.openSession(session.id)
                router.closeDrawer()
            },
            onAction: { action in present(action) }
        )
    }

    @ViewBuilder
    private func projectSection(_ project: ChatProjectSummary, _ side: SidebarUiState, _ groups: SidebarGroups) -> some View {
        let collapsed = side.collapsed.contains(project.id)
        ChatProjectRow(
            project: project,
            collapsed: collapsed,
            reorder: reorder,
            onToggle: { app.sidebar.toggleProject(project.id) },
            onNewChat: { newChat(in: project.id) },
            onAction: { action in present(action) }
        )
        if !collapsed {
            let rows = groups.byProject[project.id] ?? []
            VStack(alignment: .leading, spacing: 0) {
                ForEach(rows) { session in
                    row(session, side)
                }
                if rows.isEmpty {
                    SidebarSmallNote(L(emptyProjectNoteKey(project.id, groups)), color: Sm.muted, vertical: 4)
                }
            }
            .padding(.leading, 12)
        }
    }

    /// 项目行的“＋”：成功才关抽屉；失败时原因显示在 PROJECTS 下面。
    private func newChat(in projectId: String) {
        Task {
            if await app.sidebar.newChatInProject(projectId) {
                router.closeDrawer()
            }
        }
    }

    /// 菜单里选了一项：打开对应的对话框。每个对话框有自己的 `SidebarActionRunner`（一次只跑一个操作，请求进行中不能关）。
    private func present(_ action: ChatAction) {
        switch action {
        case .menu, .projectMenu:
            // 菜单贴着行上的按钮，由行自己开。
            break
        case .projectSettings(let project):
            settings = ProjectSettingsModel(project: project, sidebar: app.sidebar, onClose: { settings = nil })
        case .rename, .move, .delete, .createProject, .renameProject, .deleteProject:
            dialog = ChatDialogItem(action: action, runner: SidebarActionRunner(onClose: { dialog = nil }))
        }
    }
}
