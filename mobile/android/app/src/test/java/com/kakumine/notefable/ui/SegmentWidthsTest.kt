package com.kakumine.notefable.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class SegmentWidthsTest {
    @Test
    fun splitsInHalfWhenBothNamesFit() {
        assertEquals(109 to 109, segmentWidths(218, 70, 100))
        // 奇数宽度时多出来的 1 给第二个。
        assertEquals(109 to 110, segmentWidths(219, 70, 100))
    }

    @Test
    fun widerNameTakesItsWidthAndTheOtherGetsTheRest() {
        // 日文「チャット｜ワークスペース」在抽屉里（14sp）：第二个比一半宽。
        assertEquals(90 to 128, segmentWidths(218, 86, 128))
        // 第一个比一半宽时同理。
        assertEquals(130 to 88, segmentWidths(218, 130, 60))
    }

    @Test
    fun sharesByWidthWhenNeitherLayoutFits() {
        val (first, second) = segmentWidths(200, 100, 300)
        assertEquals(50, first)
        assertEquals(150, second)
        assertEquals(0 to 0, segmentWidths(0, 10, 10))
    }
}
