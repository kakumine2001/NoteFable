package com.kakumine.notefable.data

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppIconTest {
    private val image = "data:image/png;base64,AAEC"

    @Test
    fun `a stored value is an image data URL or one emoji, anything else falls back to the logo`() {
        assertEquals(image, validAppIcon(image))
        assertEquals("🦊", validAppIcon("🦊"))
        assertEquals("👩🏽‍💻", validAppIcon("👩🏽‍💻"))
        assertNull(validAppIcon(null))
        assertNull(validAppIcon(""))
        assertNull(validAppIcon("two words"))
        assertNull(validAppIcon("x".repeat(65)))
    }

    @Test
    fun `the image is cropped to a centred square, like the web imageFileToIcon`() {
        assertEquals(AppIconCrop(100, 0, 200), appIconCrop(400, 200))
        assertEquals(AppIconCrop(0, 150, 100), appIconCrop(100, 400))
        assertEquals(AppIconCrop(0, 0, 96), appIconCrop(96, 96))
    }

    @Test
    fun `decoding keeps at least twice the saved size on the short side`() {
        assertEquals(1, appIconSampleSize(96, 96))
        assertEquals(1, appIconSampleSize(383, 4000))
        assertEquals(2, appIconSampleSize(384, 4000))
        assertEquals(8, appIconSampleSize(3000, 4000))
        // 很长的图：短边不大，但像素太多，继续缩小。
        assertTrue(appIconSampleSize(300, 200_000) >= 2)
    }

    @Test
    fun `the saved image is a PNG data URL that reads back to the same bytes`() {
        val bytes = byteArrayOf(0, 1, 2, -1)
        val url = appIconDataUrl(bytes)
        assertTrue(url.startsWith("data:image/png;base64,"))
        assertTrue(isImageIcon(url))
        assertArrayEquals(bytes, appIconImageBytes(url))
        assertNull(appIconImageBytes("🦊"))
        assertNull(appIconImageBytes("data:image/svg+xml,<svg/>"))
        assertNull(appIconImageBytes("data:image/png;base64,***"))
    }

    @Test
    fun `the store starts from the saved icon and drops a broken one`() {
        assertEquals("🦊", AppIconStore(read = { "🦊" }, write = { true }).icon.value)
        assertNull(AppIconStore(read = { "not an icon" }, write = { true }).icon.value)
        assertNull(AppIconStore(read = { error("storage unavailable") }, write = { true }).icon.value)
    }

    @Test
    fun `saving writes the value and shows it, null goes back to the logo`() {
        val written = mutableListOf<String?>()
        val store = AppIconStore(read = { null }, write = { written += it; true })
        assertTrue(store.save("🦊"))
        assertEquals("🦊", store.icon.value)
        assertTrue(store.save(image))
        assertEquals(image, store.icon.value)
        assertTrue(store.save(null))
        assertNull(store.icon.value)
        assertEquals(listOf("🦊", image, null), written)
    }

    @Test
    fun `a failed save keeps the icon that is shown`() {
        var fail = false
        val store = AppIconStore(read = { "🦊" }, write = { if (fail) error("disk full") else false })
        assertFalse(store.save("🐼"))
        fail = true
        assertFalse(store.save(null))
        assertEquals("🦊", store.icon.value)
        // 不能用的值不写。
        assertFalse(AppIconStore(read = { null }, write = { true }).save("two words"))
    }
}
