package com.kakumine.notefable.data

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

    // ---- 界面语言跟着账号走（和网页 src/lib/locale-sync.test.ts 同样的情况） ----

    private val en = AppLanguage.Preference.English
    private val zh = AppLanguage.Preference.Simplified
    private val ja = AppLanguage.Preference.Japanese
    private val auto = AppLanguage.Preference.Auto

    private fun sync(
        loaded: Boolean = true,
        configured: Boolean = true,
        signedIn: Boolean = true,
        saved: String? = null,
        preference: AppLanguage.Preference = auto,
        active: AppLanguage.Preference = en,
        target: AppLanguage.Preference? = null,
        firstRun: Boolean = false,
        migrated: AppLanguage.Preference? = null,
    ) = localeSyncAction(loaded, configured, signedIn, saved, preference, active, target, firstRun, migrated)

    @Test
    fun `locale sync does nothing until the account is known, or when sign-in is not set up`() {
        assertEquals(null, sync(loaded = false, preference = ja))
        assertEquals(null, sync(configured = false, signedIn = false, preference = ja))
    }

    @Test
    fun `signed-out users get the system language and lose an old choice`() {
        assertEquals(LocaleSyncAction.Switch(auto), sync(signedIn = false, preference = ja))
        assertEquals(null, sync(signedIn = false, preference = auto))
    }

    @Test
    fun `follows the language saved on the account`() {
        assertEquals(LocaleSyncAction.Switch(zh), sync(saved = "zh", preference = auto))
        assertEquals(LocaleSyncAction.Switch(zh), sync(saved = "zh", preference = ja, active = ja))
        assertEquals(null, sync(saved = "zh", preference = zh, active = zh))
        assertEquals(null, sync(saved = "zh", preference = zh, active = en, target = zh))
        assertEquals(LocaleSyncAction.Switch(ja), sync(saved = "ja", preference = ja, active = zh))
        assertEquals(LocaleSyncAction.Switch(AppLanguage.Preference.Traditional), sync(saved = "zh-Hant"))
    }

    @Test
    fun `goes back to the system language when a first choice was not saved`() {
        assertEquals(LocaleSyncAction.Switch(zh), sync(saved = "zh", preference = zh, active = zh, target = ja))
        assertEquals(LocaleSyncAction.Switch(auto), sync(preference = ja, active = ja))
        assertEquals(LocaleSyncAction.Switch(auto), sync(preference = auto, target = ja))
    }

    @Test
    fun `saves the device's earlier choice once on the first run and keeps it if that fails`() {
        assertEquals(LocaleSyncAction.Save(ja), sync(firstRun = true, preference = ja, active = ja))
        assertEquals(null, sync(firstRun = true, preference = auto))
        assertEquals(null, sync(preference = ja, active = ja, migrated = ja))
    }

    @Test
    fun `never overwrites the account when its saved language is unknown`() {
        assertEquals(null, sync(saved = LOCALE_UNKNOWN, preference = ja, firstRun = true))
    }

    @Test
    fun `reads the account language codes`() {
        assertEquals(AppLanguage.Preference.Traditional, AppLanguage.preferenceOfCode("zh-Hant"))
        assertEquals(null, AppLanguage.preferenceOfCode("auto"))
        assertEquals(null, AppLanguage.preferenceOfCode("fr"))
        assertEquals(null, AppLanguage.preferenceOfCode(null))
    }

    @Test
    fun `account locale - missing is unknown, null is not chosen`() {
        assertEquals(LOCALE_UNKNOWN, NoteFableJson.decodeFromString<AccountUser>("""{"name":"A"}""").locale)
        assertEquals(null, NoteFableJson.decodeFromString<AccountUser>("""{"name":"A","locale":null}""").locale)
        assertEquals("ja", NoteFableJson.decodeFromString<AccountUser>("""{"name":"A","locale":"ja"}""").locale)
    }

    @Test
    fun `API requests carry the current UI language as Accept-Language`() = runBlocking {
        val saved = AppLanguage.uiLocale
        try {
            MockWebServer().use { server ->
                server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"x"}"""))
                AppLanguage.uiLocale = "zh-Hant"
                val api = NoteFableApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)
                runCatching { api.notes() }
                assertEquals("zh-TW", server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Accept-Language"))
            }
        } finally {
            AppLanguage.uiLocale = saved
        }
    }
}