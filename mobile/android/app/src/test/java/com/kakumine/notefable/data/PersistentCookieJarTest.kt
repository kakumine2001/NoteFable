package com.kakumine.notefable.data

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PersistentCookieJarTest {
    private val expires = System.currentTimeMillis() + 86_400_000L

    @Test
    fun `relocate keeps the session cookie and only changes the host`() {
        val original = Cookie.Builder().name("__Secure-authjs.session-token.0").value("abc").expiresAt(expires)
            .hostOnlyDomain("notefable.com").path("/").secure().httpOnly().sameSite("Lax").build()
        val moved = PersistentCookieJar.relocate(original, "app.notefable.com")
        assertEquals("__Secure-authjs.session-token.0", moved.name)
        assertEquals("abc", moved.value)
        assertEquals(expires, moved.expiresAt)
        assertEquals("app.notefable.com", moved.domain)
        assertEquals("/", moved.path)
        assertTrue(moved.hostOnly)
        assertTrue(moved.secure)
        assertTrue(moved.httpOnly)
        assertEquals("Lax", moved.sameSite)
        assertTrue(moved.matches("https://app.notefable.com/api/sessions".toHttpUrl()))
        assertFalse(moved.matches("https://notefable.com/api/sessions".toHttpUrl()))
    }

    @Test
    fun `relocate keeps a non-secure cookie non-secure`() {
        val original = Cookie.Builder().name("notefable_device").value("d.s").expiresAt(expires)
            .hostOnlyDomain("notefable.com").path("/api/native-auth").httpOnly().build()
        val moved = PersistentCookieJar.relocate(original, "app.notefable.com")
        assertFalse(moved.secure)
        assertEquals("/api/native-auth", moved.path)
        assertEquals(null, moved.sameSite)
    }
}
