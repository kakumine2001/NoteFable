import Foundation

/// 侧栏通过 `SidebarChatHost` 读写聊天这边的会话列表（Android 的 SidebarViewModel 直接拿着 ChatViewModel）。
/// 其余成员（navigationCount、patchSessions、onSessionDeleted、openCreatedSession、addCreatedSession）ChatViewModel 本来就有。
extension ChatViewModel: SidebarChatHost {
    var sidebarChat: SidebarChatSnapshot {
        SidebarChatSnapshot(
            sessions: state.sessions,
            activeSessionId: state.activeSessionId,
            generatingSessionIds: state.generatingSessionIds,
            messagesEmpty: state.messages.isEmpty,
            sending: state.sending,
            messagesLoading: state.messagesLoading
        )
    }
}
