import SwiftUI

// 侧栏聊天部分的行和小部件（Android ui/ChatSidebar.kt 的 SessionRow / ProjectRow / SectionLabel / ProjectsHeading / RowAction）。

// MARK: - 小标题和说明

/// 分区小标题的字（网页 `.chat-section-label`：句首大小写 UI 字体 12 / 560 灰色）。
private struct SectionLabelText: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.nf(12, weight: 560))
            .nfLineHeight(16, fontSize: 12)
            .foregroundStyle(Sm.muted)
            .lineLimit(1)
    }
}

/// `.chat-section-label`：内边距 14（上）/ 8（左右）/ 5（下），整行宽。"Pinned"、"Chats"。
struct ChatSectionLabel: View {
    private let text: String
    private let icon: [String]?

    init(_ text: String, icon: [String]? = nil) {
        self.text = text
        self.icon = icon
    }

    var body: some View {
        HStack(spacing: 5.6) {
            if let icon {
                LucideIcon(icon, size: 12.5, color: Sm.muted)
            }
            SectionLabelText(text: text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.top, 14)
        .padding(.bottom, 5)
        .accessibilityAddTraits(.isHeader)
    }
}

/// `.chat-project-heading`：与小标题同款，右侧“新项目”＋（40 的按钮，图标 15）。
struct ChatProjectsHeading: View {
    private let onCreate: () -> Void

    init(onCreate: @escaping () -> Void) {
        self.onCreate = onCreate
    }

    var body: some View {
        HStack(spacing: 0) {
            SectionLabelText(text: L("projects"))
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            NFIconButton(Lucide.plus, label: L("new_project"), iconSize: 15, action: onCreate)
                .padding(.vertical, -4.8)
        }
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .padding(.top, 14)
        .padding(.bottom, 4)
    }
}

/// 列表里的小字说明（12 / 行高 16，左右 8）：项目读取失败、"No chats"。
struct SidebarSmallNote: View {
    private let text: String
    private let color: Color
    private let vertical: CGFloat

    init(_ text: String, color: Color, vertical: CGFloat = 0) {
        self.text = text
        self.color = color
        self.vertical = vertical
    }

    var body: some View {
        Text(text)
            .font(.nf(12))
            .nfLineHeight(16, fontSize: 12)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, vertical)
    }
}

// MARK: - 聊天行

/// 聊天行（高 44、圆角 6.4）：图标区 40（左距 2，表情或 MessageSquareText 15，点开表情选择器）、标题 14 / 20（右距 8，
/// 长按后拖动排序，点按打开）、“更多” 40（图标 16，右距 3.2）。当前行浅蓝底、字重 550、左侧 3px 蓝条（上下各缩 7.2）。
/// 行上没有单独的置顶按钮，置顶收在“更多”菜单里。
struct ChatSessionRow: View {
    let session: SessionSummary
    let active: Bool
    /// 这一行正在移动：不能拖。
    let moveBusy: Bool
    /// 拖动失败的原因（显示在行下方）。
    let errorText: String?
    let reorder: ReorderDragController
    let onOpen: () -> Void
    let onAction: (ChatAction) -> Void

    @Environment(AppEnvironment.self) private var app
    @State private var pickerOpen = false
    @State private var menuOpen = false
    /// 菜单里“置顶 / 取消置顶”的保存（每次打开菜单新建一个）。
    @State private var runner: SidebarActionRunner? = nil

    var body: some View {
        let line = reorder.dropLine(session.id)
        let shape = RoundedRectangle(cornerRadius: 8)
        HStack(spacing: 0) {
            iconButton
            titleButton
            moreButton
        }
        .frame(height: 42)
        .background(active ? Sm.activeRow : Color.clear, in: shape)
        .overlay {
            if active {
                shape.strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false)
            }
        }
        .overlay(alignment: .top) {
            if line.before { ReorderDropLine() }
        }
        .overlay(alignment: .bottom) {
            if line.after { ReorderDropLine() }
        }
        .clipShape(shape)
        .reorderRow(session.id, in: reorder, showsDropLine: false)
        .reorderError(errorText) { app.sidebar.dismissReorderError() }
    }

    /// 图标按钮 40×40（左距 2、圆角 4）：表情 15 或 MessageSquareText 15 灰，点开表情选择器。
    private var iconButton: some View {
        Button {
            pickerOpen.toggle()
        } label: {
            NFIconTile(emoji: session.icon, fallback: Lucide.messageSquareText, box: 40, glyph: 15)
        }
        .buttonStyle(.pressable(background: pickerOpen ? Sm.hover : Color.clear, cornerRadius: 4))
        .accessibilityLabel(L("em_change_icon_of", session.title))
        .emojiPicker(isPresented: $pickerOpen, current: session.icon) { icon in
            app.chat.changeSessionIcon(session.id, icon)
        }
        .padding(.leading, 2)
    }

    /// 标题区就是拖动处：长按后拖，点按打开。长按生效后原地松手不会再打开这一行（网页 suppressClick）。
    private var titleButton: some View {
        Button {
            if !reorder.swallowsTap() { onOpen() }
        } label: {
            Text(session.title)
                .font(.nf(14, weight: active ? 560 : 400))
                .foregroundStyle(active ? Sm.ink : Sm.text)
                .lineLimit(1)
                .padding(.trailing, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 42)
                .contentShape(Rectangle())
        }
        .buttonStyle(.pressable(cornerRadius: 0))
        .accessibilityAddTraits(active ? .isSelected : [])
        .reorderHandle(session.id, in: reorder, locked: moveBusy)
    }

    private var moreButton: some View {
        let label = L("sb_actions_for_title", session.title)
        return NFIconButton(Lucide.moreHorizontal, label: label, iconSize: 16, cornerRadius: 4) {
            runner = SidebarActionRunner(onClose: { menuOpen = false })
            menuOpen = true
        }
        // 保存中不能关（否则服务端改了而本地列表没跟上）。
        .actionsMenu(isPresented: $menuOpen, dismissDisabled: runner?.busy ?? false, label: label) {
            ChatSessionMenu(session: session, runner: runner) { action in
                menuOpen = false
                onAction(action)
            }
        }
        .padding(.trailing, 3.2)
    }
}

/// 聊天行的“更多”菜单（`.chat-actions-menu.chat-row-menu`）：置顶 / 取消置顶（点了就保存：成功关菜单，失败留着、在下面显示原因）、
/// 改名、移到项目、删除。保存中其它项也不能点（网页 disabled={busy}）。
private struct ChatSessionMenu: View {
    let session: SessionSummary
    let runner: SidebarActionRunner?
    let onAction: (ChatAction) -> Void

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let busy = runner?.busy ?? false
        let pinned = session.pinned
        VStack(alignment: .leading, spacing: 0) {
            ActionsMenuItem(L(pinned ? "sb_unpin" : "sb_pin"), icon: pinned ? Lucide.pinOff : Lucide.pin, isBusy: busy) {
                let sidebar = app.sidebar
                let id = session.id
                runner?.run { await sidebar.setPinned(id, !pinned) }
            }
            ActionsMenuItem(L("sb_rename"), icon: Lucide.pencil) { onAction(.rename(session)) }
            ActionsMenuItem(L("move_to_project"), icon: Lucide.folderInput) { onAction(.move(session)) }
            ActionsMenuDivider()
            ActionsMenuItem(L("sb_delete_"), icon: Lucide.trash2, role: .danger) { onAction(.delete(session)) }
            if let error = runner?.error {
                ActionsMenuError(sidebarErrorText(error, app.systemText))
            }
        }
        .disabled(busy)
    }
}

// MARK: - 项目行

/// 项目行（高 44、圆角 6.4）：折叠箭头 13 + 文件夹 15 + 名称 14（间距 6.4，左右 3.2），有共通指示 / 参考笔记时名称后加 ScrollText 12 浅灰；
/// 右侧“在项目里新建聊天”＋ 和“更多”各 40（图标 16，右距 3.2）。整行是投放区：把聊天拖到上面就移进这个项目。
struct ChatProjectRow: View {
    let project: ChatProjectSummary
    let collapsed: Bool
    let reorder: ReorderDragController
    let onToggle: () -> Void
    let onNewChat: () -> Void
    let onAction: (ChatAction) -> Void

    @State private var menuOpen = false

    var body: some View {
        let hint = projectHint(project)
        HStack(spacing: 0) {
            Button(action: onToggle) {
                HStack(spacing: 6.4) {
                    LucideIcon(collapsed ? Lucide.chevronRight : Lucide.chevronDown, size: 13, color: Sm.text)
                    LucideIcon(Lucide.folder, size: 15, color: Sm.text)
                    Text(project.name)
                        .font(.nf(14))
                        .foregroundStyle(Sm.text)
                        .lineLimit(1)
                    if !hint.isEmpty {
                        LucideIcon(Lucide.scrollText, size: 12, color: Sm.faint)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 3.2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.pressable(cornerRadius: 0))
            .accessibilityLabel(hint.isEmpty ? project.name : "\(project.name) (\(hint))")

            NFIconButton(Lucide.plus, label: L("sb_new_chat_in_name", project.name), iconSize: 16, cornerRadius: 4, action: onNewChat)
                .padding(.trailing, 3.2)

            NFIconButton(Lucide.moreHorizontal, label: L("sb_actions_for_project", project.name), iconSize: 16, cornerRadius: 4) {
                menuOpen = true
            }
            .actionsMenu(isPresented: $menuOpen, label: L("sb_actions_for_name", project.name)) {
                ActionsMenuItem(L("sb_project_settings"), icon: Lucide.settings2) {
                    menuOpen = false
                    onAction(.projectSettings(project))
                }
                ActionsMenuItem(L("rename_project"), icon: Lucide.pencil) {
                    menuOpen = false
                    onAction(.renameProject(project))
                }
                ActionsMenuItem(L("delete_project"), icon: Lucide.trash2, role: .danger) {
                    menuOpen = false
                    onAction(.deleteProject(project))
                }
            }
            .padding(.trailing, 3.2)
        }
        .frame(height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 6.4))
        .reorderDropZone(project.id, in: reorder)
    }
}
