package com.kakumine.notefable.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppThemeTest {
    @Test
    fun parsesAndResolvesPreferences() {
        assertEquals(ThemePreference.System, ThemePreference.parse(null))
        assertEquals(ThemePreference.System, ThemePreference.parse("unknown"))
        assertEquals(ThemePreference.Light, ThemePreference.parse("LIGHT"))
        assertEquals(ThemePreference.Dark, ThemePreference.parse(" dark "))

        assertFalse(ThemePreference.System.resolveDark(false))
        assertTrue(ThemePreference.System.resolveDark(true))
        assertFalse(ThemePreference.Light.resolveDark(true))
        assertTrue(ThemePreference.Dark.resolveDark(false))
    }

    @Test
    fun storePersistsPreferenceAndGuardsWriteFailure() {
        var saved: String? = "dark"
        val store = AppThemeStore(read = { saved }, write = { value -> saved = value; true })
        assertEquals(ThemePreference.Dark, store.preference.value)
        assertTrue(store.save(ThemePreference.Light))
        assertEquals("light", saved)
        assertEquals(ThemePreference.Light, store.preference.value)

        val failing = AppThemeStore(read = { "system" }, write = { false })
        assertFalse(failing.save(ThemePreference.Dark))
        assertEquals(ThemePreference.System, failing.preference.value)
    }
}
