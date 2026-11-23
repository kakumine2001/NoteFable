package com.kakumine.notefable.ui

/**
 * Chat / Workspace 切换两键的宽度（网页 `.notion-segmented` 的 `repeat(2, minmax(max-content, 1fr))`）。
 * 两边的名字都放得下一半时各占一半；一边比一半宽时它按自己的宽度、另一边拿剩下的；
 * 两边加起来都放不下时按各自宽度的比例分（文字自己省略）。iOS 是 `workspaceSegmentWidths`。
 */
internal fun segmentWidths(available: Int, first: Int, second: Int): Pair<Int, Int> {
    if (available <= 0) return 0 to 0
    val half = available / 2
    return when {
        first <= half && second <= half -> half to available - half
        first + second <= available -> if (first > half) first to available - first else available - second to second
        else -> {
            val firstShare = (available.toLong() * first / (first + second)).toInt()
            firstShare to available - firstShare
        }
    }
}
