package com.kakumine.studymate.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AvatarCropTest {
    private val eps = 0.0001f

    @Test
    fun `the photo covers the circle by its short side, like the web layoutFor`() {
        // 400×200 横图：短边 200 对上圆，宽 400，左右各多出 100。
        val layout = cropLayout(400f, 200f, zoom = 1f, offsetX = 0f, offsetY = 0f, view = 200f)
        assertEquals(400f, layout.w, eps)
        assertEquals(200f, layout.h, eps)
        assertEquals(-100f, layout.dx, eps)
        assertEquals(0f, layout.dy, eps)
    }

    @Test
    fun `offsets are clamped so no gap shows, and zoom widens the range`() {
        val clamped = cropLayout(400f, 200f, zoom = 1f, offsetX = 500f, offsetY = 50f, view = 200f)
        assertEquals(100f, clamped.offsetX, eps)
        assertEquals(0f, clamped.offsetY, eps)
        assertEquals(0f, clamped.dx, eps)

        val zoomed = cropLayout(400f, 200f, zoom = 2f, offsetX = -500f, offsetY = 500f, view = 200f)
        assertEquals(800f, zoomed.w, eps)
        assertEquals(-300f, zoomed.offsetX, eps)
        assertEquals(100f, zoomed.offsetY, eps)
        assertEquals(-600f, zoomed.dx, eps)
        assertEquals(0f, zoomed.dy, eps)
    }

    @Test
    fun `decoding keeps at least 512 times the max zoom on the short side`() {
        assertEquals(1, avatarSampleSize(1000, 3000))
        assertEquals(1, avatarSampleSize(3071, 4000))
        assertEquals(2, avatarSampleSize(3072, 4096))
        assertEquals(4, avatarSampleSize(8000, 6144))
    }

    @Test
    fun `very long images are also capped by total pixels`() {
        // 长截图 / 全景图：短边不到 1536，但整张解码会超过画布能画的 100 MiB。
        assertEquals(2, avatarSampleSize(1080, 25000))
        assertEquals(2, avatarSampleSize(3000, 9000))
        assertEquals(1, avatarSampleSize(3000, 6000))
        for ((w, h) in listOf(1080 to 25000, 3000 to 9000, 400 to 200000, 3071 to 30000)) {
            val s = avatarSampleSize(w, h)
            assertTrue("$w x $h / $s", (w.toLong() / s) * (h.toLong() / s) * 4 < 100L * 1024 * 1024)
        }
    }

    @Test
    fun `picked files must be images under 10 MB`() {
        assertEquals(PhotoError.NotImage, checkPickedPhoto("application/pdf", 10))
        assertEquals(PhotoError.NotImage, checkPickedPhoto(null, 10))
        assertEquals(PhotoError.TooLarge, checkPickedPhoto("image/jpeg", MAX_PICKED_PHOTO_BYTES + 1))
        assertNull(checkPickedPhoto("image/png", MAX_PICKED_PHOTO_BYTES))
        assertNull("size unknown: the decoder decides", checkPickedPhoto("image/webp", null))
    }

    @Test
    fun `non-round image sizes never produce a negative clamp range`() {
        for ((w, h) in listOf(309f to 400f, 400f to 309f, 201f to 333f, 777f to 213f)) {
            for (zoom in listOf(1f, 1.37f, 3f)) {
                val layout = cropLayout(w, h, zoom = zoom, offsetX = 1000f, offsetY = -1000f, view = 200f)
                org.junit.Assert.assertTrue(layout.w >= 199.99f && layout.h >= 199.99f)
            }
        }
    }
}
