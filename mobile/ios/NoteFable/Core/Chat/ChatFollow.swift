import Foundation

/// 消息列表每次滚动位置或跟随状态变化时要做的事（对应 Android `ui/ChatFollow.kt` 的 FollowAction）。
enum FollowAction: Equatable, Sendable {
    case none, follow, unfollow, pin
}

/// "是否跟着最新内容"（网页 page.tsx 的 followBottomRef）的判断，抽成纯函数方便测试。
///
/// - 用户在滚（拖动、惯性，`programmaticScroll` 为 false）且离开底部：停止跟随。
/// - 滚动停下、且离底部不超过阈值：恢复跟随。滚动进行中不恢复，否则从底部开始的拖动会马上被拉回去。
/// - 有待处理的定位请求（`revealPending`）时什么都不做。
/// - 跟随中、没在滚、却离开了底部（回答在列表没重排时变高，或刚开始跟随）：贴底。
func followAction(
    following: Bool,
    distanceToBottom: Double,
    threshold: Double,
    scrolling: Bool,
    programmaticScroll: Bool,
    hasItems: Bool,
    revealPending: Bool = false
) -> FollowAction {
    let nearBottom = distanceToBottom <= threshold
    // 正在定位到检索结果 / 链接里的消息：不贴底、也不改跟随状态（定位自己的滚动不算用户滚动），
    // 定位结束后由消息列表决定是否跟随（网页 openChatFromLink 关掉 pinToBottom）。
    if revealPending { return .none }
    if scrolling && !programmaticScroll { return following && !nearBottom ? .unfollow : .none }
    if scrolling { return .none }
    if nearBottom { return following ? .none : .follow }
    if following && hasItems { return .pin }
    return .none
}
