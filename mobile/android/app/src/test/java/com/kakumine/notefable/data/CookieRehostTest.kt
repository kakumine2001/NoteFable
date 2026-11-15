package com.kakumine.notefable.data

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CookieRehostTest {
    @Test
    fun movesHostOnlyCookieToNewHostKeepingAttributes() {
        val old = Cookie.Builder().name("studymate_device").value("id.sig").expiresAt(4_000_000_000_000)
            .hostOnlyDomain("studymate-lab-ai.vercel.app").path("/").secure().httpOnly().sameSite("Lax").build()
        val moved = PersistentCookieJar.rehost(old, "notefable.com")
        assertEquals("notefable.com", moved.domain)
        assertTrue(moved.hostOnly)
        assertTrue(moved.secure)
        assertTrue(moved.httpOnly)
        assertEquals("Lax", moved.sameSite)
        assertEquals(old.value, moved.value)
        assertEquals(old.expiresAt, moved.expiresAt)
        assertTrue(moved.matches("https://notefable.com/api/sessions".toHttpUrl()))
        assertFalse(moved.matches("https://studymate-lab-ai.vercel.app/api/sessions".toHttpUrl()))
    }
}
