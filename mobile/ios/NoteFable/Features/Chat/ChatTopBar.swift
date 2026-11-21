import SwiftUI

/// 聊天的顶栏（Android ChatScreen.kt 的 `TopBar`）：高 56、左右内边距 10.4，图标按钮 40×40（图标 20，圆角 4.8）。
/// 行首是菜单；有标题时接着 12 处是聊天图标（点开表情选择器）和 14 灰色标题；行尾按钮组间距 8：搜索、新建聊天、「整理成笔记」。
/// 空白首页（没有消息）不放标题和"新建聊天"（已经在新聊天里），只有搜索。
struct ChatTopBar: View {
    /// 没有消息时为 nil。
    let title: String?
    let icon: String?
    let showNewChat: Bool
    /// 有消息的已保存聊天才有「整理成笔记」；nil 时不显示。
    let createPageSessionId: String?
    /// 当前聊天在发送（含上传附件）时不能点，最后的回答还没存下。外观不变（网页的 disabled 没有单独样式）。
    let createPageEnabled: Bool

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        HStack(spacing: 0) {
            NFIconButton(Lucide.menu, label: L("open_menu")) { router.openDrawer() }
            if let title {
                // 网页 ChatTopbarIcon（手机）：40×40、圆角 4，表情 18 / MessageSquareText 15 灰。
                ChatIconButton(icon: icon, box: 40, cornerRadius: 4, emojiSize: 18, glyphSize: 15, strokeWidth: 2)
                    .padding(.leading, 12)
                Text(title)
                    .font(.nf(14))
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .padding(.horizontal, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Spacer(minLength: 0)
            }
            NFIconButton(Lucide.search, label: L("search_chats_and_notes")) { router.openSearch() }
            if showNewChat {
                NFIconButton(Lucide.plus, label: L("new_chat")) { app.chat.newChat() }
                    .padding(.leading, 8)
            }
            if let createPageSessionId {
                NFIconButton(Lucide.filePlus, label: L("create_page"), disabledColor: Sm.muted) {
                    router.createPageSessionId = createPageSessionId
                }
                .disabled(!createPageEnabled)
                .padding(.leading, 8)
            }
        }
        .padding(.horizontal, 10.4)
        .frame(height: 56)
        .frame(maxWidth: .infinity)
    }
}

/// 聊天图标按钮（网页 ChatTopbarIcon / ChatTitleIcon，aria-label "Change chat icon"）：有表情画表情，没有画 MessageSquareText；
/// 点开表情选择器，选了就改当前聊天的图标（还没保存的新聊天是草稿图标）。
struct ChatIconButton: View {
    let icon: String?
    /// 按钮见方的边长。
    let box: CGFloat
    let cornerRadius: CGFloat
    let emojiSize: CGFloat
    let glyphSize: CGFloat
    let strokeWidth: CGFloat

    @Environment(AppEnvironment.self) private var app
    @State private var picking = false

    var body: some View {
        Button {
            picking.toggle()
        } label: {
            Group {
                if let icon, !icon.isEmpty {
                    // 表情按字号画，行高收紧到 1。
                    Text(icon)
                        .font(.system(size: emojiSize))
                        .lineLimit(1)
                        .fixedSize()
                } else {
                    LucideIcon(Lucide.messageSquareText, size: glyphSize, strokeWidth: strokeWidth, color: Sm.muted)
                }
            }
            .frame(width: box, height: box)
        }
        .buttonStyle(.pressable(cornerRadius: cornerRadius))
        .accessibilityLabel(L("em_change_chat_icon"))
        .emojiPicker(isPresented: $picking, current: icon) { picked in
            app.chat.changeIcon(picked)
        }
    }
}
