package com.kakumine.notefable.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// 外観テーマ（システム / ライト / ダーク）。Web の src/lib/theme.ts と同じ 3 値で、端末ごとに保存する。
enum class ThemePreference(val value: String) {
    System("system"),
    Light("light"),
    Dark("dark");

    fun resolveDark(systemDark: Boolean): Boolean = when (this) {
        System -> systemDark
        Light -> false
        Dark -> true
    }

    companion object {
        fun parse(raw: String?): ThemePreference = when (raw?.trim()?.lowercase()) {
            "light" -> Light
            "dark" -> Dark
            else -> System
        }
    }
}

/** 系统现在是不是深色模式（Configuration.uiMode 的夜间位）。 */
fun systemInDarkTheme(configuration: android.content.res.Configuration): Boolean =
    (configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES

class AppThemeStore(read: () -> String?, private val write: (String) -> Boolean) {
    private val state = MutableStateFlow(ThemePreference.parse(runCatching(read).getOrNull()))
    val preference: StateFlow<ThemePreference> = state.asStateFlow()

    fun save(next: ThemePreference): Boolean {
        if (!runCatching { write(next.value) }.getOrDefault(false)) return false
        state.value = next
        return true
    }
}
