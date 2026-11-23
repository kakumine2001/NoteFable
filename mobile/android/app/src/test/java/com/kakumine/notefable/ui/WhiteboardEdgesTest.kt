package com.kakumine.notefable.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 白板画图时让开的两侧返回手势区（[drawingEdgeRects]）。 */
class WhiteboardEdgesTest {
    @Test
    fun `one 32 by 200 dp rect on each edge, centred vertically`() {
        // 412×915dp 的手机（density 2.625）上 WebView 是 1082×2100 px。
        val rects = drawingEdgeRects(1082, 2100, 2.625f)
        val edge = 84 // 32dp
        val tall = 525 // 200dp
        val top = (2100 - tall) / 2
        assertEquals(listOf(EdgeRect(0, top, edge, top + tall), EdgeRect(1082 - edge, top, 1082, top + tall)), rects)
        rects.forEach { assertEquals(it.top, 2100 - it.bottom - (2100 - tall) % 2) }
    }

    @Test
    fun `a view shorter than 200 dp is covered from top to bottom`() {
        assertEquals(listOf(EdgeRect(0, 0, 64, 300), EdgeRect(436, 0, 500, 300)), drawingEdgeRects(500, 300, 2f))
    }

    @Test
    fun `nothing before the view is measured`() {
        assertEquals(emptyList<EdgeRect>(), drawingEdgeRects(0, 0, 2f))
        assertEquals(emptyList<EdgeRect>(), drawingEdgeRects(1080, 0, 2f))
        assertEquals(emptyList<EdgeRect>(), drawingEdgeRects(0, 1920, 2f))
        assertEquals(emptyList<EdgeRect>(), drawingEdgeRects(1080, 1920, 0f))
    }

    @Test
    fun `the height never goes over what the system honours per edge`() {
        // 系统的上限是 200 × densityDpi / 160（整数除法）；density 是 densityDpi / 160。
        for (dpi in 120..800) {
            val density = dpi / 160f
            val limit = 200 * dpi / 160
            val rects = drawingEdgeRects(4000, 10_000, density)
            assertEquals(2, rects.size)
            rects.forEach { assertTrue("dpi $dpi", it.bottom - it.top in (limit - 1)..limit) }
        }
    }

    @Test
    fun `a view narrower than both edges is covered by each rect`() {
        assertEquals(listOf(EdgeRect(0, 0, 40, 100), EdgeRect(0, 0, 40, 100)), drawingEdgeRects(40, 100, 2f))
    }
}
