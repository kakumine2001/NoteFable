package com.kakumine.studymate.data

import kotlinx.coroutines.runBlocking
import okhttp3.CookieJar
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale
import java.util.concurrent.TimeUnit

class AppLanguageTest {
    @Test
    fun `reads the saved app language like the web localeFromTag`() {
        assertEquals(AppLanguage.Preference.Auto, AppLanguage.preferenceOf(null))
        assertEquals(AppLanguage.Preference.Auto, AppLanguage.preferenceOf(Locale.forLanguageTag("fr")))
        assertEquals(AppLanguage.Preference.English, AppLanguage.preferenceOf(Locale.forLanguageTag("en-GB")))
        assertEquals(AppLanguage.Preference.Japanese, AppLanguage.preferenceOf(Locale.forLanguageTag("ja")))
        assertEquals(AppLanguage.Preference.Simplified, AppLanguage.preferenceOf(Locale.forLanguageTag("zh-CN")))
        assertEquals(AppLanguage.Preference.Simplified, AppLanguage.preferenceOf(Locale.forLanguageTag("zh")))
        assertEquals(AppLanguage.Preference.Simplified, AppLanguage.preferenceOf(Locale.forLanguageTag("zh-Hans-HK")))
        assertEquals(AppLanguage.Preference.Traditional, AppLanguage.preferenceOf(Locale.forLanguageTag("zh-TW")))
        assertEquals(AppLanguage.Preference.Traditional, AppLanguage.preferenceOf(Locale.forLanguageTag("zh-HK")))
        assertEquals(AppLanguage.Preference.Traditional, AppLanguage.preferenceOf(Locale.forLanguageTag("zh-Hant")))
    }

    @Test
    fun `every option round-trips through its saved tag`() {
        AppLanguage.Preference.entries.filter { it.tag != null }.forEach {
            assertEquals(it, AppLanguage.preferenceOf(Locale.forLanguageTag(it.tag!!)))
        }
    }

    @Test
    fun `sends the web locale tag as Accept-Language`() {
        assertEquals("en", AppLanguage.acceptLanguage("en"))
        assertEquals("zh-CN", AppLanguage.acceptLanguage("zh"))
        assertEquals("zh-TW", AppLanguage.acceptLanguage("zh-Hant"))
        assertEquals("ja", AppLanguage.acceptLanguage("ja"))
        assertEquals("en", AppLanguage.acceptLanguage(null))
    }

    @Test
    fun `menu names are written in their own language like the web LOCALE_NAMES`() {
        assertEquals(
            listOf(null, "English", "简体中文", "繁體中文", "日本語"),
            AppLanguage.Preference.entries.map(AppLanguage::nativeName),
        )
    }

    @Test
    fun `API requests carry the current UI language as Accept-Language`() = runBlocking {
        val saved = AppLanguage.uiLocale
        try {
            MockWebServer().use { server ->
                server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"x"}"""))
                AppLanguage.uiLocale = "zh-Hant"
                val api = StudyMateApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)
                runCatching { api.notes() }
                assertEquals("zh-TW", server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Accept-Language"))
            }
        } finally {
            AppLanguage.uiLocale = saved
        }
    }
}