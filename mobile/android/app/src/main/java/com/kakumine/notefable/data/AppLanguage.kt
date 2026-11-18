package com.kakumine.notefable.data

import java.util.Locale

/**
 * 界面语言（和网页 `src/lib/i18n/locale.ts` 的 Locale / LocalePreference 一致）。
 *
 * - 选择（[Preference]）存在系统的"应用语言"里（AppCompatDelegate.setApplicationLocales：Android 13+ 由系统保存，
 *   更早的版本由 AppCompat 的 autoStoreLocales 保存）。"自动"＝不设置，跟系统语言走。
 * - 界面实际用的语言由资源解析决定（res/values*、strings_i18n.xml 的 `ui_locale`），系统文、笔记 WebView 的 `lang=`
 *   和发给服务端的 Accept-Language 都跟它走，所以不会出现"界面是英文、系统文是中文"的情况。
 */
object AppLanguage {
    enum class Preference(val code: String, val tag: String?) {
        Auto("auto", null),
        English("en", "en"),
        Simplified("zh", "zh-CN"),
        Traditional("zh-Hant", "zh-TW"),
        Japanese("ja", "ja"),
    }

    /** 网页 LOCALE_NAMES：各语言用它自己的写法；"自动"由调用方翻译。 */
    fun nativeName(preference: Preference): String? = when (preference) {
        Preference.Auto -> null
        Preference.English -> "English"
        Preference.Simplified -> "简体中文"
        Preference.Traditional -> "繁體中文"
        Preference.Japanese -> "日本語"
    }

    private val TraditionalRegions = setOf("TW", "HK", "MO")
    private val Aliases = mapOf("eng" to "en", "jpn" to "ja", "chi" to "zh", "zho" to "zh", "cmn" to "zh", "in" to "id")

    /** Strict BCP 47 parsing; legacy underscores and ISO aliases match Web. */
    fun localeFromTag(tag: String?): Preference? {
        val normalized = tag?.trim()?.replace('_', '-') ?: return null
        if (!Regex("^[a-z]{2,8}(-[a-z0-9]{1,8})*$", RegexOption.IGNORE_CASE).matches(normalized)) return null
        val parts = normalized.split('-')
        val canonical = (listOf(Aliases[parts.first().lowercase(Locale.ROOT)] ?: parts.first()) + parts.drop(1)).joinToString("-")
        val locale = runCatching { Locale.Builder().setLanguageTag(canonical).build() }.getOrNull() ?: return null
        return when (locale.language) {
            "en" -> Preference.English
            "ja" -> Preference.Japanese
            "zh" -> when {
                locale.script.equals("Hant", ignoreCase = true) -> Preference.Traditional
                locale.script.equals("Hans", ignoreCase = true) -> Preference.Simplified
                locale.country.uppercase(Locale.ROOT) in TraditionalRegions -> Preference.Traditional
                else -> Preference.Simplified
            }
            else -> null
        }
    }
    fun preferenceOf(locale: Locale?): Preference = localeFromTag(locale?.toLanguageTag()) ?: Preference.Auto

    fun localeFromCountry(country: String?): Preference? = when (country?.trim()?.uppercase(Locale.ROOT)) {
        "CN", "SG" -> Preference.Simplified
        "TW", "HK", "MO" -> Preference.Traditional
        "JP" -> Preference.Japanese
        "US", "GB", "AU", "NZ", "IE" -> Preference.English
        else -> null
    }
    fun resolveLocale(preference: Preference, preferredTags: List<String>, country: String? = null): Preference =
        if (preference != Preference.Auto) preference else preferredTags.firstNotNullOfOrNull(::localeFromTag)
            ?: localeFromCountry(country) ?: Preference.English

    /** 账号上存的语言代码（en / zh / zh-Hant / ja，网页 Locale）→ 选项；不认识的是 null。"auto" 不是账号能存的值。 */
    fun preferenceOfCode(code: String?): Preference? =
        Preference.entries.firstOrNull { it != Preference.Auto && it.code == code }

    /** `ui_locale`（en / zh / zh-Hant / ja）→ Accept-Language 的值（网页 LOCALE_TAGS）。 */
    fun acceptLanguage(uiLocale: String?): String = when (uiLocale) {
        "zh" -> "zh-CN"
        "zh-Hant" -> "zh-TW"
        "ja" -> "ja"
        else -> "en"
    }

    /** 当前界面语言（`ui_locale`）。由 MainActivity 在创建和配置变化时更新；HTTP 拦截器用它设置 Accept-Language。 */
    @Volatile
    var uiLocale: String = "en"
}

/** Account null is authoritative Auto; an absent field remains unknown. */
sealed interface LocaleSyncAction {
    data class Switch(val to: AppLanguage.Preference) : LocaleSyncAction
}
fun localeSyncAction(
    loaded: Boolean,
    configured: Boolean,
    signedIn: Boolean,
    saved: String?,
    preference: AppLanguage.Preference,
    active: AppLanguage.Preference,
    target: AppLanguage.Preference?,
): LocaleSyncAction? {
    if (!loaded || !configured || !signedIn || saved == LOCALE_UNKNOWN) return null
    val desired = if (saved == null) AppLanguage.Preference.Auto else AppLanguage.preferenceOfCode(saved) ?: return null
    if (desired == AppLanguage.Preference.Auto) return if ((target ?: preference) == desired) null else LocaleSyncAction.Switch(desired)
    return if (preference == desired && (target ?: active) == desired) null else LocaleSyncAction.Switch(desired)
}
