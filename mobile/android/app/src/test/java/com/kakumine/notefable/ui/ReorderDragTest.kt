package com.kakumine.notefable.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// 拖动的目标（网页 ReorderRowButton 的 updateTarget 和 canDropIn）：工作区的分区只接受同一分区的页面。
class ReorderDragTest {
    private val zones = mapOf("g1" to Rect(0f, 0f, 100f, 40f), "section:note" to Rect(0f, 50f, 100f, 90f), "" to Rect(0f, 300f, 100f, 340f))
    private val rows = mapOf("n1" to Rect(0f, 100f, 100f, 140f), "w1" to Rect(0f, 150f, 100f, 190f), "child" to Rect(0f, 200f, 100f, 240f))
    private val containers = mapOf<String, String?>("section:note" to null)
    private val zoneAccepts = mapOf("section:note" to "note")
    private val rowAccepts = mapOf("n1" to "note", "w1" to "whiteboard")

    private fun at(y: Float, dragging: String, tag: String) = dropTargetAt(Offset(50f, y), dragging, zones, rows, containers, zoneAccepts, rowAccepts, tag)

    @Test
    fun `a page goes only into its own section, but into any project or sub-page list`() {
        // 分区标题 = 移出项目（无项目）。
        assertEquals(DropTarget.Into(null), at(70f, "w2", "note"))
        assertNull(at(70f, "w2", "whiteboard"))
        // 分区里最上层的行：同一分区才能放在前后。
        assertEquals(DropTarget.Row("n1", false), at(110f, "n2", "note"))
        assertNull(at(110f, "w2", "whiteboard"))
        assertEquals(DropTarget.Row("w1", true), at(185f, "w2", "whiteboard"))
        // 项目、子页面的行、首页标题什么都接受。
        assertEquals(DropTarget.Into("g1"), at(20f, "w2", "whiteboard"))
        assertEquals(DropTarget.Row("child", false), at(205f, "w2", "whiteboard"))
        assertEquals(DropTarget.Into(null), at(320f, "w2", "whiteboard"))
    }
}
