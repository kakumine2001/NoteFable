import SwiftUI

/// iOS 27 起消息列表可能整个空白（顶栏和输入栏照常；模拟器上见过，iOS 26 和 18 没有）：内容一下子换掉后，
/// 懒加载列表不重新排行。两个办法一起用，更早的系统保持原样：
/// - 每段对话一个新的消息列表（`ChatUiState.conversationId` 作视图身份）；
/// - 开着的对话里，最后一个回合和之后的行不放进懒加载栈（`ChatTailSplit`，超过上限时最早的几行除外），换掉、变短时
///   不会留下旧高度。
///   不按"有行换掉"重建懒加载栈：那样会丢掉阅读位置和每一行的界面状态。
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
