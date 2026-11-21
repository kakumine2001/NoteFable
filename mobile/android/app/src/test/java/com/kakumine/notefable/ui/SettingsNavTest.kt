package com.kakumine.notefable.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// 设置的两级导航的规则。前六条和网页 src/lib/settings-navigation.test.ts 一一对应（同一套规则），后面是 Android 这边的状态。
class SettingsNavTest {
    private val shake = SettingsStep.Show(SettingsPage.Personalization, attention = true)
    private val account = SettingsStep.Show(SettingsPage.Account)

    private fun dismiss(locked: Boolean = false, editorIn: SettingsPage? = null, onPage: Boolean = false, dirty: Boolean = false) =
        settingsDismissStep(locked, editorIn, onPage, dirty)

    private fun button(locked: Boolean = false, photoBusy: Boolean = false, onPage: Boolean = false, dirty: Boolean = false) =
        settingsButtonStep(locked, photoBusy, onPage, dirty)

    @Test
    fun `system Back goes one step at a time, page to home list to closed`() {
        assertEquals(SettingsStep.Home, dismiss(onPage = true))
        assertEquals(SettingsStep.Close, dismiss())
    }

    @Test
    fun `system Back first closes an open photo or emoji editor and shows its page`() {
        assertEquals(SettingsStep.Show(SettingsPage.Account), dismiss(editorIn = SettingsPage.Account))
        assertEquals(SettingsStep.Show(SettingsPage.General), dismiss(onPage = true, editorIn = SettingsPage.General))
        // 编辑区先于没保存的指令：这一步只收编辑区，不晃那条。
        assertEquals(SettingsStep.Show(SettingsPage.Account), dismiss(onPage = true, editorIn = SettingsPage.Account, dirty = true))
    }

    @Test
    fun `unsaved custom instructions keep the user on Personalization, on a page and on the home list`() {
        assertEquals(shake, dismiss(onPage = true, dirty = true))
        assertEquals(shake, dismiss(dirty = true))
        assertEquals(shake, button(onPage = true, dirty = true))
        assertEquals(shake, button(dirty = true))
    }

    @Test
    fun `nothing happens while a save or delete is running`() {
        assertEquals(SettingsStep.Stay, dismiss(locked = true, editorIn = SettingsPage.Account, onPage = true, dirty = true))
        assertEquals(SettingsStep.Stay, button(locked = true, photoBusy = true, onPage = true, dirty = true))
    }

    @Test
    fun `the bar button goes home from a page and closes from the home list`() {
        assertEquals(SettingsStep.Home, button(onPage = true))
        assertEquals(SettingsStep.Close, button())
    }

    @Test
    fun `a photo being cropped or uploaded shows the Account page instead of leaving, before the unsaved check`() {
        assertEquals(account, button(photoBusy = true, onPage = true))
        assertEquals(account, button(photoBusy = true, dirty = true))
    }

    @Test
    fun `system Back asks the profile editor first, then the character grid, and an upload closes nothing`() {
        assertNull(settingsEditorGuard(uploading = false, avatarEditorOpen = false, iconPickerOpen = false))
        assertEquals(
            SettingsEditorGuard(SettingsPage.Account, closeAvatarEditor = true),
            settingsEditorGuard(uploading = false, avatarEditorOpen = true, iconPickerOpen = true),
        )
        assertEquals(
            SettingsEditorGuard(SettingsPage.General, closeIconPicker = true),
            settingsEditorGuard(uploading = false, avatarEditorOpen = false, iconPickerOpen = true),
        )
        // 上传中：显示"账号"页，编辑区和角色网格都不收。
        assertEquals(SettingsEditorGuard(SettingsPage.Account), settingsEditorGuard(uploading = true, avatarEditorOpen = true, iconPickerOpen = true))
    }

    @Test
    fun `the screen opens on the home list and only later moves count as navigated`() {
        val opened = SettingsNav()
        assertTrue(opened.isHome)
        assertFalse(opened.navigated)

        val plan = opened.show(SettingsPage.Plan)
        assertEquals(SettingsNav(SettingsPage.Plan, navigated = true), plan)
        assertFalse(plan.isHome)
        // 已经在那一页：状态不变（界面不重做动画、不滚回最上面）。
        assertEquals(plan, plan.show(SettingsPage.Plan))

        val home = plan.toHome()
        assertTrue(home.isHome)
        assertTrue(home.navigated)
    }

    @Test
    fun `a step moves the screen, and closing leaves no screen`() {
        val page = SettingsNav(SettingsPage.General, navigated = true)
        assertEquals(page, page.after(SettingsStep.Stay))
        assertEquals(SettingsNav(null, navigated = true), page.after(SettingsStep.Home))
        assertEquals(SettingsNav(SettingsPage.Personalization, navigated = true), page.after(shake))
        assertEquals(SettingsNav(SettingsPage.Account, navigated = true), SettingsNav().after(account))
        assertNull(SettingsNav().after(SettingsStep.Close))
    }

    @Test
    fun `walking back from an open emoji editor with unsaved instructions never drops the draft`() {
        // 在"账号"页开着表情编辑区，自定义指令改了没保存。
        var nav = SettingsNav(SettingsPage.Account, navigated = true)

        // 返回键第一下：只收编辑区，留在"账号"页。
        val guard = settingsEditorGuard(uploading = false, avatarEditorOpen = true, iconPickerOpen = false)
        var step = settingsDismissStep(locked = false, editorIn = guard?.page, onPage = !nav.isHome, dirty = true)
        assertEquals(SettingsStep.Show(SettingsPage.Account), step)
        nav = nav.after(step)!!
        assertEquals(SettingsPage.Account, nav.page)

        // 第二下：编辑区已经收起，有没保存的指令 → 去"个性化"页并晃一下，不回一览。
        step = settingsDismissStep(locked = false, editorIn = null, onPage = !nav.isHome, dirty = true)
        assertEquals(shake, step)
        nav = nav.after(step)!!
        assertEquals(SettingsPage.Personalization, nav.page)

        // 保存或放弃以后：回一览，再按一下才关。
        step = settingsDismissStep(locked = false, editorIn = null, onPage = !nav.isHome, dirty = false)
        nav = nav.after(step)!!
        assertTrue(nav.isHome)
        assertNull(nav.after(settingsDismissStep(locked = false, editorIn = null, onPage = !nav.isHome, dirty = false)))
    }

    @Test
    fun `the entries are listed in the web order`() {
        assertEquals(
            listOf(SettingsPage.General, SettingsPage.Personalization, SettingsPage.Plan, SettingsPage.Account),
            SettingsPage.entries.toList(),
        )
    }
}
