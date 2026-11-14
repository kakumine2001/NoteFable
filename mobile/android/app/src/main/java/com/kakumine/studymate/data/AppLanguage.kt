package com.kakumine.studymate.data

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

    /** 系统保存的应用语言（第一个）→ 选项。和网页 localeFromTag 同样：zh 先看文字（Hant / Hans），没有再看地区。 */
    fun preferenceOf(locale: Locale?): Preference {
        if (locale == null || locale.language.isEmpty()) return Preference.Auto
        return when (locale.language) {
            "en" -> Preference.English
            "ja" -> Preference.Japanese
            "zh" -> when {
                locale.script.equals("Hant", ignoreCase = true) -> Preference.Traditional
                locale.script.equals("Hans", ignoreCase = true) -> Preference.Simplified
                locale.country.uppercase() in TraditionalRegions -> Preference.Traditional
                else -> Preference.Simplified
            }
            else -> Preference.Auto
        }
    }

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
