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
    fun `un-customized, empty, legacy emoji, and unknown values normalize to default Quill`() {
        assertNull(validAppIcon(null))
        assertNull(validAppIcon(""))
        assertNull(validAppIcon("quill"))
        assertNull(validAppIcon("character:quill"))
        // Legacy custom emojis migrate cleanly to null -> default Quill.
        assertNull(validAppIcon("🦊"))
        assertNull(validAppIcon("👩🏽‍💻"))
        assertNull(validAppIcon("character:unknown_future"))
        assertNull(validAppIcon("two words"))
        assertNull(validAppIcon("x".repeat(65)))

        assertEquals(ResolvedAppIcon.Character(CharacterId.Quill), resolveAppIcon(null))
        assertEquals(ResolvedAppIcon.Character(CharacterId.Quill), resolveAppIcon("🦊"))
    }

    @Test
    fun `all 7 preset characters and custom uploaded images resolve and round-trip cleanly`() {
        assertEquals(image, validAppIcon(image))
        assertEquals(ResolvedAppIcon.Image(image), resolveAppIcon(image))

        for (character in CharacterId.entries) {
            val encoded = toCharacterIcon(character)
            if (character == CharacterId.Default) {
                assertNull(encoded)
            } else {
                assertEquals("character:${character.id}", encoded)
                assertEquals(character, parseCharacterIcon(encoded!!))
            }
            assertEquals(character, parseCharacterIcon(character.id))
            assertEquals(ResolvedAppIcon.Character(character), resolveAppIcon(encoded))
            assertEquals(ResolvedAppIcon.Character(character), resolveAppIcon(character.id))
        }
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
        assertTrue(appIconSampleSize(300, 200_000) >= 2)
    }

    @Test
    fun `the saved image is a PNG data URL that reads back to the same bytes`() {
        val bytes = byteArrayOf(0, 1, 2, -1)
        val url = appIconDataUrl(bytes)
        assertTrue(url.startsWith("data:image/png;base64,"))
        assertTrue(isImageIcon(url))
        assertArrayEquals(bytes, appIconImageBytes(url))
        assertNull(appIconImageBytes("character:foldie"))
        assertNull(appIconImageBytes("data:image/svg+xml,<svg/>"))
        assertNull(appIconImageBytes("data:image/png;base64,***"))
    }

    @Test
    fun `the store preserves custom uploads and preset characters while migrating legacy emoji on startup`() {
        assertEquals(image, AppIconStore(read = { image }, write = { true }).icon.value)
        assertEquals("character:foldie", AppIconStore(read = { "character:foldie" }, write = { true }).icon.value)
        assertNull(AppIconStore(read = { "🦊" }, write = { true }).icon.value)
        assertNull(AppIconStore(read = { "not an icon" }, write = { true }).icon.value)
        assertNull(AppIconStore(read = { error("storage unavailable") }, write = { true }).icon.value)
    }

    @Test
    fun `saving writes preset characters and custom images, and Quill or null clears back to default`() {
        val written = mutableListOf<String?>()
        val store = AppIconStore(read = { null }, write = { written += it; true })
        assertTrue(store.save("character:piko"))
        assertEquals("character:piko", store.icon.value)
        assertTrue(store.save(image))
        assertEquals(image, store.icon.value)
        assertTrue(store.save("quill"))
        assertNull(store.icon.value)
        assertEquals(listOf("character:piko", image, null), written)
    }

    @Test
    fun `a failed or invalid save keeps the currently active icon unchanged`() {
        var fail = false
        val store = AppIconStore(read = { "character:sora" }, write = { if (fail) error("disk full") else false })
        assertFalse(store.save("character:loop"))
        fail = true
        assertFalse(store.save(null))
        assertEquals("character:sora", store.icon.value)

        // Legacy emojis and arbitrary strings are rejected on save.
        val writable = AppIconStore(read = { "character:velo" }, write = { true })
        assertFalse(writable.save("🦊"))
        assertFalse(writable.save("two words"))
        assertEquals("character:velo", writable.icon.value)
    }
}
