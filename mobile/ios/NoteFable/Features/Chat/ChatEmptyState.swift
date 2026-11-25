import SwiftUI

/// 空白首页（Android ChatScreen.kt 的 `MessageList` 里没有消息的那一支 + `EmptyState`）：
/// 网页手机版在顶栏下方放 Chat / Note 切换（左右 24、上距 4），标题块在剩下的空间里居中，「最近编辑」贴着输入栏。
/// 键盘把可用高度压小时整块可以滚动，靠下的内容（标题、最近编辑）留在视野里；
/// 显示「最近编辑」而高度不足 400 时收起角色图，给标题留出空间。
struct ChatEmptyState: View {
    /// 输入栏里有字：角色低头看（没有传状态时用）。
    let hasDraft: Bool
    let heroState: CharacterState
    /// 「最近编辑」的笔记；空的时候不显示那一栏。
    let recentNotes: [NotePageSummary]
    /// 点了最近的笔记后聚焦输入栏，接着打提问。
    let onFocusComposer: () -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        let state = app.chat.state
        let showRecent = !recentNotes.isEmpty
        GeometryReader { proxy in
            let showMascot = !showRecent || proxy.size.height >= 400
            ScrollView(.vertical) {
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    ChatHero(
                        // 还没保存的新聊天叫"新聊天"。
                        title: state.activeSessionId != nil ? state.activeTitle : nil,
                        icon: state.activeIcon,
                        hasDraft: hasDraft,
                        characterState: heroState,
                        reserveBottomSpace: !showRecent,
                        showMascot: showMascot
                    )
                    Spacer(minLength: 0)
                    if showRecent {
                        ChatRecentNotes(
                            pages: recentNotes,
                            selected: state.attachedPages,
                            enabled: state.upload == nil,
                            onToggle: { note in
                                app.chat.toggleRecentNote(note)
                                onFocusComposer()
                            },
                            onOpen: { id in router.openNote(id) },
                            onViewAll: { app.notes.setWorkspace(.notes) }
                        )
                        .padding(.horizontal, ChatMetrics.pageGutter)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            // 高度不够时从底部开始显示（Android 的 reverseScrolling）。
            .defaultScrollAnchor(.bottom)
        }
    }
}

/// 空白首页的标题块：行首对齐的"图标 + 32 粗体标题"，下面一行 17 灰色说明。
/// 网页的消息列容器自带 48 的底部内边距，居中的是"标题块 + 48"；手机宽度下输入栏区顶部那一行"滚动到底部"（40 + 8）
/// 在空白首页也只是透明、照样占位。所以没有「最近编辑」时底部留 48 + 48，标题的位置才和网页一致。
private struct ChatHero: View {
    let title: String?
    let icon: String?
    let hasDraft: Bool
    let characterState: CharacterState
    let reserveBottomSpace: Bool
    let showMascot: Bool

    @Environment(AppEnvironment.self) private var app
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 标题上方的 AI 角色（网页 .nf-mascot-stage：64 × 68，下距 14.4）；跟着真实的输入与会话状态动。
            if showMascot {
                Mascot(icon: app.appIcon.icon, lookDown: hasDraft, state: characterState)
                    .padding(.bottom, 14.4)
            }
            HStack(alignment: .center, spacing: 9.6) {
                // 网页 ChatTitleIcon：1.3em（41.6）、圆角 6；表情 0.85em（27.2），没有时 MessageSquareText 0.7em（22.4）描边 1.8。
                ChatIconButton(icon: icon, box: 41.6, cornerRadius: 6, emojiSize: 27.2, glyphSize: 22.4, strokeWidth: 1.8)
                Text(title ?? L("new_chat"))
                    .font(.nf(32, weight: 700))
                    // 字距 -.04em；从右到左的文字（阿拉伯语）不收紧，连写不能断。
                    .tracking(layoutDirection == .rightToLeft ? 0 : -1.28)
                    .nfLineHeight(36.8, fontSize: 32)
                    .foregroundStyle(Sm.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            Text(L("empty_hint"))
                .font(.nf(17))
                .nfLineHeight(27.2, fontSize: 17)
                .foregroundStyle(Sm.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8.8)
        }
        .padding(.horizontal, ChatMetrics.pageGutter)
        .padding(.bottom, reserveBottomSpace ? ChatMetrics.listBottomPadding : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
