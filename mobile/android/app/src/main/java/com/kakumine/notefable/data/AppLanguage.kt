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

/** 让界面语言跟着账号走时要做的事（网页 LocaleSyncAction）。 */
sealed interface LocaleSyncAction {
    /** 把 App 的语言设置换成 [to]（Auto＝清空，跟系统语言）。 */
    data class Switch(val to: AppLanguage.Preference) : LocaleSyncAction
    /** 把本机以前选的语言存到账号上。 */
    data class Save(val locale: AppLanguage.Preference) : LocaleSyncAction
}

/**
 * 界面语言跟着账号走的判断（网页 src/lib/locale-sync.ts 的 localeSyncAction，规则相同）：
 * - [loaded] 账号读到过，[configured] 服务端开了登录；否则什么都不做。
 * - 没登录：本机的选择不动（没登录也能在侧栏底部的语言菜单里选；退出登录时由调用方清掉）。
 * - 已登录、[saved]（账号上的语言，原样：null 是没选过，[LOCALE_UNKNOWN] 是不知道）不知道：不用本机的选择覆盖。
 * - 账号上有语言：本机的选择（[preference]）和正在显示的（[active]，或切换中的 [target]）都换成它。
 * - 没选过、本机有以前选的语言：打开 App 后第一次判断（[firstRun]）时存到账号，只试这一次（[migrated] 是当时存的语言）。
 *   之后仍不一致（第一次在设置里选的语言没存上）就回到环境语言。
 */
fun localeSyncAction(
    loaded: Boolean,
    configured: Boolean,
    signedIn: Boolean,
    saved: String?,
    preference: AppLanguage.Preference,
    active: AppLanguage.Preference,
    target: AppLanguage.Preference?,
    firstRun: Boolean,
    migrated: AppLanguage.Preference?,
): LocaleSyncAction? {
    if (!loaded || !configured) return null
    if (!signedIn) return null
    if (saved == LOCALE_UNKNOWN) return null
    val chosen = AppLanguage.preferenceOfCode(saved)
    if (chosen != null) return if (preference == chosen && (target ?: active) == chosen) null else LocaleSyncAction.Switch(chosen)
    val choice = target ?: preference
    if (choice == AppLanguage.Preference.Auto) return null
    if (firstRun) return LocaleSyncAction.Save(choice)
    if (choice == migrated) return null
    return LocaleSyncAction.Switch(AppLanguage.Preference.Auto)
}
