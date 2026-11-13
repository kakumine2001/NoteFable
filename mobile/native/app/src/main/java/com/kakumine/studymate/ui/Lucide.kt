package com.kakumine.studymate.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp

/**
 * 网页用的是 lucide 图标（线条图标，24x24 画布，描边 2，圆头）。
 * 这里直接用同一份路径数据绘制，和网页的图标一模一样；Material 图标的线宽和造型不一样，所以不用。
 */
object Lucide {
    val Menu = listOf("M4 5h16", "M4 12h16", "M4 19h16")
    val Plus = listOf("M5 12h14", "M12 5v14")
    val ArrowUp = listOf("m5 12 7-7 7 7", "M12 19V5")
    val ChevronDown = listOf("m6 9 6 6 6-6")
    val Check = listOf("M20 6 9 17l-5-5")
    val Copy = listOf(
        "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z",
        "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
    )
    val MessageSquareText = listOf(
        "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
        "M7 11h10",
        "M7 15h6",
        "M7 7h8",
    )
    val RotateCcw = listOf("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5")
    val LogOut = listOf("m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4")
    val ChevronsUpDown = listOf("m7 15 5 5 5-5", "m7 9 5-5 5 5")
    val Globe = listOf("M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20")
    val Paperclip = listOf("m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551")
}

@Composable
fun LucideIcon(
    paths: List<String>,
    size: Dp,
    tint: Color,
    modifier: Modifier = Modifier,
    strokeWidth: Float = 2f,
) {
    val parsed = remember(paths) { paths.map { PathParser().parsePathString(it).toPath() } }
    Canvas(modifier.size(size)) {
        scale(this.size.width / 24f, pivot = Offset.Zero) {
            val stroke = Stroke(width = strokeWidth, cap = StrokeCap.Round, join = StrokeJoin.Round)
            parsed.forEach { drawPath(it, tint, style = stroke) }
        }
    }
}

// 品牌标志（src/components/studymate-logo.tsx 的 BrandMark，viewBox 12 5 44 56）。
private const val BrandOutline =
    "M18 12.5 43 9c4-.6 7 2 7 5.7v34c0 3.1-2.2 5.8-5.2 6.2L26 57.2c-4.8.6-8.8-3.1-8.8-7.9V17.1c0-2.3 1.7-4.3 4-4.6Z"
private const val BrandDetails =
    "M20.2 18 45.5 14.4c2-.3 3.8.5 4.5 2.1M18 23.8 42 20.5c4.6-.6 8.3 3 8.3 7.6M30 29h14v9.5H30zM25.2 44v12.7l4.4-3 4.5 2V43.4M24 40.1h2.8"

@Composable
fun BrandMark(size: Dp, tint: Color, modifier: Modifier = Modifier) {
    val outline = remember { PathParser().parsePathString(BrandOutline).toPath() }
    val details = remember { PathParser().parsePathString(BrandDetails).toPath() }
    Canvas(modifier.size(size)) {
        // viewBox 44x56 按"保持比例、居中"放进正方形（preserveAspectRatio 默认值）。
        val s = this.size.height / 56f
        translate(left = (this.size.width - 44f * s) / 2f) {
            scale(s, pivot = Offset.Zero) {
                translate(left = -12f, top = -5f) {
                    drawPath(outline, tint, style = Stroke(3.2f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    drawPath(details, tint, style = Stroke(2.8f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                }
            }
        }
    }
}
