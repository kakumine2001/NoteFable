package com.kakumine.notefable.ui

import androidx.compose.ui.graphics.vector.PathNode
import androidx.compose.ui.graphics.vector.PathParser
import com.kakumine.notefable.R
import com.kakumine.notefable.data.PageKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

// 页面类型的默认图标和名字（网页 page-kind-icon.tsx、PAGE_KIND_LABELS）。
class PageKindIconTest {
    @Test
    fun `each kind falls back to its own lucide icon like the web PageKindIcon`() {
        assertSame(Lucide.FileText, pageKindIcon(PageKind.Note))
        assertSame(Lucide.Shapes, pageKindIcon(PageKind.Whiteboard))
        assertSame(Lucide.Presentation, pageKindIcon(PageKind.Slides))
    }

    @Test
    fun `each kind has its name for the search label`() {
        assertEquals(R.string.page_kind_note, pageKindLabel(PageKind.Note))
        assertEquals(R.string.page_kind_whiteboard, pageKindLabel(PageKind.Whiteboard))
        assertEquals(R.string.page_kind_slides, pageKindLabel(PageKind.Slides))
    }

    @Test
    fun `Shapes keeps lucide's rect and circle when drawn as paths`() {
        (Lucide.Shapes + Lucide.Presentation).forEach { assertTrue(it, PathParser().parsePathString(it).toNodes().isNotEmpty()) }
        // rect x=3 y=14 width=7 height=7 rx=1：经过的点框住 (3,14)–(10,21)，最后回到起点。
        val rect = points(Lucide.Shapes[1])
        assertEquals(3f, rect.minOf { it.first }, 0.001f)
        assertEquals(10f, rect.maxOf { it.first }, 0.001f)
        assertEquals(14f, rect.minOf { it.second }, 0.001f)
        assertEquals(21f, rect.maxOf { it.second }, 0.001f)
        assertEquals(rect.first(), rect.last())
        // circle cx=17.5 cy=17.5 r=3.5：两段半径 3.5 的弧，从 (14,17.5) 到 (21,17.5) 再回来。
        val circle = PathParser().parsePathString(Lucide.Shapes[2]).toNodes()
        val arcs = circle.filterIsInstance<PathNode.RelativeArcTo>()
        assertEquals(2, arcs.size)
        arcs.forEach { assertEquals(3.5f, it.horizontalEllipseRadius, 0.001f); assertEquals(3.5f, it.verticalEllipseRadius, 0.001f) }
        assertEquals(listOf(14f to 17.5f, 21f to 17.5f, 14f to 17.5f), points(Lucide.Shapes[2]))
    }

    /** 每一段走到的点（绝对坐标）。 */
    private fun points(path: String): List<Pair<Float, Float>> {
        var x = 0f
        var y = 0f
        var startX = 0f
        var startY = 0f
        val out = mutableListOf<Pair<Float, Float>>()
        for (node in PathParser().parsePathString(path).toNodes()) {
            when (node) {
                is PathNode.MoveTo -> { x = node.x; y = node.y; startX = x; startY = y }
                is PathNode.RelativeMoveTo -> { x += node.dx; y += node.dy; startX = x; startY = y }
                is PathNode.LineTo -> { x = node.x; y = node.y }
                is PathNode.RelativeLineTo -> { x += node.dx; y += node.dy }
                is PathNode.HorizontalTo -> x = node.x
                is PathNode.RelativeHorizontalTo -> x += node.dx
                is PathNode.VerticalTo -> y = node.y
                is PathNode.RelativeVerticalTo -> y += node.dy
                is PathNode.ArcTo -> { x = node.arcStartX; y = node.arcStartY }
                is PathNode.RelativeArcTo -> { x += node.arcStartDx; y += node.arcStartDy }
                PathNode.Close -> { x = startX; y = startY }
                else -> error("unexpected $node")
            }
            out += x to y
        }
        return out
    }
}
