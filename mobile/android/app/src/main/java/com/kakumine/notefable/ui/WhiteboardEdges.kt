package com.kakumine.notefable.ui

import android.graphics.Rect
import android.view.View
import androidx.core.view.ViewCompat
import kotlin.math.min
import kotlin.math.roundToInt

// 白板正在用画图工具时（网页 /note-embed 的 drawing 消息），编辑页的 WebView 让开屏幕两侧的系统返回手势
// （ViewCompat.setSystemGestureExclusionRects），从边上起笔不会变成"返回"。Android 9 及以下没有手势导航，ViewCompat 什么也不做。

/** 一块矩形（像素，左上右下，相对视图）。android.graphics.Rect 在 JVM 单元测试里是空壳，所以先算成这个再换。 */
internal data class EdgeRect(val left: Int, val top: Int, val right: Int, val bottom: Int)

/** 每块的宽（dp）。 */
internal const val DRAWING_EDGE_WIDTH_DP = 32

/** 每块的高（dp）：系统每条边最多认 200dp 高的排除区，多出来的不算，所以正好要 200。 */
internal const val DRAWING_EDGE_HEIGHT_DP = 200

/**
 * 要让开返回手势的区域：左右两边各一块 32×200dp，在视图里竖直居中；视图比 200dp 矮时就是整个高度。
 * 视图还没量好（宽或高是 0）时没有。高度往下取整，不超过系统的上限（`200 × densityDpi / 160`，整数除法）。
 */
internal fun drawingEdgeRects(width: Int, height: Int, density: Float): List<EdgeRect> {
    if (width <= 0 || height <= 0 || density <= 0f) return emptyList()
    val edge = min(width, (DRAWING_EDGE_WIDTH_DP * density).roundToInt())
    val tall = min(height, (DRAWING_EDGE_HEIGHT_DP * density).toInt())
    val top = (height - tall) / 2
    return listOf(EdgeRect(0, top, edge, top + tall), EdgeRect(width - edge, top, width, top + tall))
}

/** 设好（按现在的尺寸）或清掉（[enabled] 为 false）这个视图两侧的排除区。 */
internal fun View.excludeDrawingEdges(enabled: Boolean) {
    val rects = if (enabled) drawingEdgeRects(width, height, resources.displayMetrics.density) else emptyList()
    ViewCompat.setSystemGestureExclusionRects(this, rects.map { Rect(it.left, it.top, it.right, it.bottom) })
}

/** 视图尺寸变了（第一次排好、键盘弹出 / 收起、旋转）时按新尺寸重算。[enabled] 读现在要不要让开。 */
internal fun drawingEdgeListener(enabled: () -> Boolean) =
    View.OnLayoutChangeListener { view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
        if (enabled() && (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop)) view.excludeDrawingEdges(true)
    }
