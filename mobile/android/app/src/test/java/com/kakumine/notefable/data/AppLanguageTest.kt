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
        assertEquals(AppLanguage.Preference.Auto, AppLanguage.preferenceOf(Locale.forLanguageTag("nl")))
        assertEquals(AppLanguage.Preference.English, AppLanguage.preferenceOf(Locale.forLanguageTag("en-GB")))
        assertEquals(AppLanguage.Preference.Japanese, AppLanguage.preferenceOf(Locale.forLanguageTag("ja")))
        assertEquals(AppLanguage.Preference.Simplified, AppLanguage.preferenceOf(Locale.forLanguageTag("zh-CN")))
        assertEquals(AppLanguage.Preference.Simplified, AppLanguage.preferenceOf(Locale.forLanguageTag("zh")))
        assertEquals(AppLanguage.Preference.Simplified, AppLanguage.preferenceOf(Locale.forLanguageTag("zh-Hans-HK")))
        assertEquals(AppLanguage.Preference.Traditional, AppLanguage.preferenceOf(Locale.forLanguageTag("zh-TW")))
        assertEquals(AppLanguage.Preference.Traditional, AppLanguage.preferenceOf(Locale.forLanguageTag("zh-HK")))
        assertEquals(AppLanguage.Preference.Traditional, AppLanguage.preferenceOf(Locale.forLanguageTag("zh-Hant")))
        assertEquals(AppLanguage.Preference.Korean, AppLanguage.preferenceOf(Locale.forLanguageTag("ko-KR")))
        assertEquals(AppLanguage.Preference.Spanish, AppLanguage.preferenceOf(Locale.forLanguageTag("es-MX")))
        assertEquals(AppLanguage.Preference.French, AppLanguage.preferenceOf(Locale.forLanguageTag("fr-CA")))
        assertEquals(AppLanguage.Preference.German, AppLanguage.preferenceOf(Locale.forLanguageTag("de-DE")))
        assertEquals(AppLanguage.Preference.PortugueseBrazil, AppLanguage.preferenceOf(Locale.forLanguageTag("pt-BR")))
        assertEquals(AppLanguage.Preference.PortugueseBrazil, AppLanguage.preferenceOf(Locale.forLanguageTag("pt-PT")))
        assertEquals(AppLanguage.Preference.Italian, AppLanguage.preferenceOf(Locale.forLanguageTag("it-IT")))
        assertEquals(AppLanguage.Preference.Indonesian, AppLanguage.preferenceOf(Locale.forLanguageTag("id-ID")))
        assertEquals(AppLanguage.Preference.Indonesian, AppLanguage.preferenceOf(Locale("in", "ID")))
        assertEquals(AppLanguage.Preference.Vietnamese, AppLanguage.preferenceOf(Locale.forLanguageTag("vi-VN")))
        assertEquals(AppLanguage.Preference.Thai, AppLanguage.preferenceOf(Locale.forLanguageTag("th-TH")))
        assertEquals(AppLanguage.Preference.Hindi, AppLanguage.preferenceOf(Locale.forLanguageTag("hi-IN")))
        assertEquals(AppLanguage.Preference.Arabic, AppLanguage.preferenceOf(Locale.forLanguageTag("ar-SA")))
        assertEquals(AppLanguage.Preference.Turkish, AppLanguage.preferenceOf(Locale.forLanguageTag("tr-TR")))
        assertEquals(AppLanguage.Preference.Russian, AppLanguage.preferenceOf(Locale.forLanguageTag("ru-RU")))
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
        assertEquals("pt-BR", AppLanguage.acceptLanguage("pt-BR"))
        assertEquals("id", AppLanguage.acceptLanguage("id"))
        assertEquals("ar", AppLanguage.acceptLanguage("ar"))
        assertEquals("en", AppLanguage.acceptLanguage(null))
    }

    @Test
    fun `menu names are written in their own language like the web LOCALE_NAMES`() {
        assertEquals(
            listOf(
                null,
                "English", "简体中文", "繁體中文", "日本語",
                "한국어", "Español", "Français", "Deutsch", "Português (Brasil)", "Italiano",
                "Bahasa Indonesia", "Tiếng Việt", "ไทย", "हिन्दी", "العربية", "Türkçe", "Русский",
            ),
            AppLanguage.Preference.entries.map(AppLanguage::nativeName),
        )
    }

    @Test
    fun `normalizes BCP tags and applies manual system country English priority`() {
        assertEquals(AppLanguage.Preference.Traditional, AppLanguage.localeFromTag("zh_HK"))
        assertEquals(AppLanguage.Preference.Simplified, AppLanguage.localeFromTag("zh-Hans-HK"))
        assertEquals(AppLanguage.Preference.Japanese, AppLanguage.localeFromTag("jpn-JP"))
        assertEquals(AppLanguage.Preference.Korean, AppLanguage.localeFromTag("ko-KR"))
        assertEquals(AppLanguage.Preference.Spanish, AppLanguage.localeFromTag("es-419"))
        assertEquals(AppLanguage.Preference.PortugueseBrazil, AppLanguage.localeFromTag("pt-BR"))
        assertEquals(AppLanguage.Preference.Arabic, AppLanguage.localeFromTag("ar-SA"))
        assertEquals(AppLanguage.Preference.Indonesian, AppLanguage.localeFromTag("in-ID"))
        assertEquals(AppLanguage.Preference.Indonesian, AppLanguage.localeFromTag("id-ID"))
        listOf("nl-NL", "sv-SE", "pl-PL", "he-IL", "zh--HK", "en-!", "*").forEach {
            assertEquals(null, AppLanguage.localeFromTag(it))
        }
        assertEquals(AppLanguage.Preference.Japanese, AppLanguage.resolveLocale(AppLanguage.Preference.Japanese, listOf("en"), "CN"))
        assertEquals(AppLanguage.Preference.Korean, AppLanguage.resolveLocale(AppLanguage.Preference.Auto, listOf("ko-KR", "zh-HK"), "JP"))
        assertEquals(AppLanguage.Preference.Traditional, AppLanguage.resolveLocale(AppLanguage.Preference.Auto, listOf("nl-NL", "zh-HK"), "JP"))
        assertEquals(AppLanguage.Preference.Japanese, AppLanguage.resolveLocale(AppLanguage.Preference.Auto, listOf("nl-NL"), "JP"))
        assertEquals(AppLanguage.Preference.Arabic, AppLanguage.resolveLocale(AppLanguage.Preference.Auto, listOf("nl-NL"), "SA"))
        assertEquals(AppLanguage.Preference.English, AppLanguage.resolveLocale(AppLanguage.Preference.Auto, listOf("nl-NL"), "IN"))
        assertEquals(AppLanguage.Preference.English, AppLanguage.resolveLocale(AppLanguage.Preference.Auto, listOf("nl-NL")))
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
    ) = localeSyncAction(loaded, configured, signedIn, saved, preference, active, target)

    @Test
    fun `locale sync does nothing until the account is known, or when sign-in is not set up`() {
        assertEquals(null, sync(loaded = false, preference = ja))
        assertEquals(null, sync(configured = false, signedIn = false, preference = ja))
    }

    @Test
    fun `signed-out users keep their own choice`() {
        assertEquals(null, sync(signedIn = false, preference = ja, active = ja))
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
        assertEquals(LocaleSyncAction.Switch(AppLanguage.Preference.Arabic), sync(saved = "ar"))
    }

    @Test
    fun `goes back to the system language when a first choice was not saved`() {
        assertEquals(LocaleSyncAction.Switch(zh), sync(saved = "zh", preference = zh, active = zh, target = ja))
        assertEquals(LocaleSyncAction.Switch(auto), sync(preference = ja, active = ja))
        assertEquals(LocaleSyncAction.Switch(auto), sync(preference = auto, target = ja))
    }

    @Test
    fun `account Auto wins over an earlier device choice on every launch`() {
        assertEquals(LocaleSyncAction.Switch(auto), sync(preference = ja, active = ja))
        assertEquals(null, sync(preference = auto))
        assertEquals(null, sync(preference = ja, target = auto))
    }

    @Test
    fun `never overwrites the account when its saved language is unknown`() {
        assertEquals(null, sync(saved = LOCALE_UNKNOWN, preference = ja))
    }

    @Test
    fun `reads the account language codes`() {
        assertEquals(AppLanguage.Preference.Traditional, AppLanguage.preferenceOfCode("zh-Hant"))
        assertEquals(AppLanguage.Preference.French, AppLanguage.preferenceOfCode("fr"))
        assertEquals(AppLanguage.Preference.PortugueseBrazil, AppLanguage.preferenceOfCode("pt-BR"))
        assertEquals(AppLanguage.Preference.Arabic, AppLanguage.preferenceOfCode("ar"))
        assertEquals(null, AppLanguage.preferenceOfCode("auto"))
        assertEquals(null, AppLanguage.preferenceOfCode("nl"))
        assertEquals(null, AppLanguage.preferenceOfCode(null))
    }

    @Test
    fun `account locale - missing is unknown, null is Auto`() {
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
