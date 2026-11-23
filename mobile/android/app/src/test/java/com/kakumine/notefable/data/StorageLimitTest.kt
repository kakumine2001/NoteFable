package com.kakumine.notefable.data

import com.kakumine.notefable.ui.StorageLimitInfo
import com.kakumine.notefable.ui.storageLimitInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** 文件存储上限（网页 src/lib/stored-files.ts 的 413 storage_limit、usage-plans.ts 的 formatStorageSize）。 */
class StorageLimitTest {
    @Test
    fun `the storage limit error carries the tier and byte counts`() {
        val error = ApiException.from(413, """{"error":"full","code":"storage_limit","tier":"member","used":11811160064,"limit":10737418240}""")
        assertTrue(error.isStorageLimit)
        assertFalse(error.isUsageLimit)
        assertEquals(StorageLimitInfo("member", 11811160064L, 10737418240L), error.storageLimitInfo())
        assertEquals("full", error.message)
    }

    @Test
    fun `other 413 errors are not storage limits`() {
        val tooLarge = ApiException.from(413, """{"error":"Files must be 4 MB or smaller."}""")
        assertFalse(tooLarge.isStorageLimit)
        assertNull(tooLarge.storageLimitInfo())
        assertNull(java.io.IOException("offline").storageLimitInfo())
    }

    @Test
    fun `sizes are shown like the web, 1024-based and never rounded up`() {
        assertEquals("0 KB", formatStorageSize(0))
        assertEquals("100 MB", formatStorageSize(100L * 1024 * 1024))
        assertEquals("499 MB", formatStorageSize(500L * 1024 * 1024 - 1))
        assertEquals("2.5 MB", formatStorageSize((2.56 * 1024 * 1024).toLong()))
        assertEquals("10 GB", formatStorageSize(10L * 1024 * 1024 * 1024))
        assertEquals("1.2 GB", formatStorageSize((1.25 * 1024 * 1024 * 1024).toLong()))
        assertEquals("2,5 MB", formatStorageSize((2.5 * 1024 * 1024).toLong(), Locale.GERMAN))
    }

    @Test
    fun `the note editor tells the app when an upload did not fit`() {
        assertEquals(
            EmbedMessage.StorageLimit("guest", 1L, 104857600L),
            EmbedMessage.parse("""{"type":"storageLimit","tier":"guest","used":1,"limit":104857600}"""),
        )
        assertNull(EmbedMessage.parse("""{"type":"storageLimit","tier":"guest"}"""))
    }

    @Test
    fun `the plan carries storage usage beyond 2 GiB`() {
        val plan = NoteFableJson.decodeFromString<PlanInfo>("""{"plan":"pro","storage":{"used":3221225472,"limit":10737418240}}""")
        assertEquals(PlanStorage(3221225472L, 10737418240L), plan.storage)
        assertNull(NoteFableJson.decodeFromString<PlanInfo>("""{"plan":"free"}""").storage)
    }
}
