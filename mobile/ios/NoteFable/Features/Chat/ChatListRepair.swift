import SwiftUI

/// iOS 27 起消息列表可能整个空白（顶栏和输入栏照常；模拟器上见过，iOS 26 和 18 没有）：内容一下子换掉后，
/// 懒加载列表不重新排行。解决办法是按内容换视图身份，让它重新建：每段对话一个新的消息列表（`ChatUiState.conversationId`），
/// 开着的对话里有行换掉时换一个新的懒加载栈（`ChatUiState.replacedRowsId`）。更早的系统保持原样。
enum ChatListRepair {
    static let isNeeded: Bool = {
        if #available(iOS 27.0, *) { return true }
        return false
    }()
}

extension View {
    /// 需要时（iOS 27 起）给视图加上按 `value` 换的身份，否则原样返回。
    @ViewBuilder
    func chatListIdentity(_ value: Int) -> some View {
        if ChatListRepair.isNeeded {
            self.id(value)
        } else {
            self
        }
    }
}
