package com.kakumine.notefable.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class FontChoiceRowsTest {
    @Test
    fun shortNamesShareOneRow() {
        assertEquals(listOf(listOf(70, 70, 70)), fontChoiceRows(218, 4, listOf(40, 30, 50)))
        // 除不尽的像素给后面的按钮。
        assertEquals(listOf(listOf(70, 71, 71)), fontChoiceRows(220, 4, listOf(40, 30, 50)))
    }

    @Test
    fun widerNameTakesItsWidthAndTheOthersShareTheRest() {
        assertEquals(listOf(listOf(60, 90, 60)), fontChoiceRows(218, 4, listOf(40, 90, 50)))
    }

    @Test
    fun namesThatDoNotFitMoveToTheNextRow() {
        // 俄语：「умолчанию｜засечками｜Моноширинный」放不进一行，第三个占第二行。
        assertEquals(listOf(listOf(113, 113), listOf(230)), fontChoiceRows(230, 4, listOf(78, 76, 95)))
    }

    @Test
    fun wordWiderThanTheRowTakesTheWholeRow() {
        assertEquals(listOf(listOf(100), listOf(100)), fontChoiceRows(100, 4, listOf(60, 140)))
        assertEquals(emptyList<List<Int>>(), fontChoiceRows(100, 4, emptyList()))
    }
}
