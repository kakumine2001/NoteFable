package com.kakumine.notefable.data

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayBillingTest {
    @Test
    fun readsTrialLengthFromPlayBillingPeriod() {
        assertEquals(30, isoPeriodDays("P30D"))
        assertEquals(30, isoPeriodDays("P1M"))
        assertEquals(30, isoPeriodDays("P4W2D"))
        assertEquals(7, isoPeriodDays("P1W"))
        assertEquals(365, isoPeriodDays("P1Y"))
        assertEquals(0, isoPeriodDays(""))
        assertEquals(0, isoPeriodDays("30 days"))
    }
}
