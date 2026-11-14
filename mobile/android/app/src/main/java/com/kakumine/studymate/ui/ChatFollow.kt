package com.kakumine.studymate.ui

/** 消息列表每次滚动位置或跟随状态变化时要做的事（MessageList 里的 snapshotFlow 用）。 */
internal enum class FollowAction { None, Follow, Unfollow, Pin }

/**
 * "是否跟着最新内容"（网页 page.tsx 的 followBottomRef）的判断，抽成纯函数方便测试。
 *
 * - 用户在滚（拖动、惯性、滚轮、无障碍滚动，[programmaticScroll] 为 false）且离开底部：停止跟随。
 * - 滚动停下、且离底部不超过阈值：恢复跟随。滚动进行中不恢复，否则从底部开始的拖动会马上被拉回去。
 * - 跟随中、没在滚、却离开了底部（回答在列表没重组时变高，或刚开始跟随）：贴底。
 */
internal fun followAction(
    following: Boolean,
    distanceToBottomPx: Int,
    thresholdPx: Float,
    scrolling: Boolean,
    programmaticScroll: Boolean,
    hasItems: Boolean,
): FollowAction {
    val nearBottom = distanceToBottomPx <= thresholdPx
    return when {
        scrolling && !programmaticScroll -> if (following && !nearBottom) FollowAction.Unfollow else FollowAction.None
        scrolling -> FollowAction.None
        nearBottom -> if (following) FollowAction.None else FollowAction.Follow
        following && hasItems -> FollowAction.Pin
        else -> FollowAction.None
    }
}
