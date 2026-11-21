package com.kakumine.notefable.ui

// 设置画面的两级导航：入口的一览 → 点了的那一栏的页面（网页 settings-dialog.tsx 手机宽度的 home / tab、show / goHome）。
// 按"关闭 / 返回"以后做什么，和网页 src/lib/settings-navigation.ts 是同一套规则（settingsDismissStep / settingsButtonStep），
// 网页那边改了这里跟着改。这里只有规则，不碰界面；界面在 SettingsDialog.kt 里照着结果做。

/** 入口一览里的四栏，顺序就是网页 TABS 的顺序（通用、个性化、方案、账号）。 */
internal enum class SettingsPage { General, Personalization, Plan, Account }

/**
 * 现在显示的画面：[page] 为 null 是入口的一览（网页 home = true），否则是那一栏的页面（网页 home = false + tab）。
 * [navigated]：换过一次画面以后为 true（网页 data-navigated）。刚打开时的一览不带切换动画。
 */
internal data class SettingsNav(val page: SettingsPage? = null, val navigated: Boolean = false) {
    val isHome: Boolean get() = page == null

    /** 网页 show(id)：进到那一栏的页面（已经在那一页就不动）。 */
    fun show(page: SettingsPage) = SettingsNav(page, navigated = true)

    /** 网页 goHome()：回到入口的一览。 */
    fun toHome() = SettingsNav(null, navigated = true)

    /** 照 [step] 走一步以后的画面；关掉设置时返回 null。 */
    fun after(step: SettingsStep): SettingsNav? = when (step) {
        SettingsStep.Stay -> this
        SettingsStep.Close -> null
        SettingsStep.Home -> toHome()
        is SettingsStep.Show -> show(step.page)
    }
}

/** 按了以后做什么（网页 SettingsStep）。 */
internal sealed interface SettingsStep {
    /** 什么都不做（保存中、删除中）。 */
    data object Stay : SettingsStep

    /** 显示那一栏的页面，不关设置。[attention]：让"未保存的更改"条晃一下。 */
    data class Show(val page: SettingsPage, val attention: Boolean = false) : SettingsStep

    /** 从某一栏的页面回到入口的一览。 */
    data object Home : SettingsStep

    /** 关掉设置。 */
    data object Close : SettingsStep
}

/**
 * 系统的返回键（网页 settingsDismissStep，Esc / 返回 / 点外面）。一次只退一步：
 * 先收起开着的头像编辑区 / 角色网格（[editorIn] 是它所在的那一栏，收起由调用的一方做，见 [settingsEditorGuard]），
 * 再从页面回到一览，最后关掉设置。有没保存的自定义指令时既不回一览也不关（不会不声不响地丢掉）。
 */
internal fun settingsDismissStep(locked: Boolean, editorIn: SettingsPage?, onPage: Boolean, dirty: Boolean): SettingsStep = when {
    locked -> SettingsStep.Stay
    editorIn != null -> SettingsStep.Show(editorIn)
    dirty -> SettingsStep.Show(SettingsPage.Personalization, attention = true)
    onPage -> SettingsStep.Home
    else -> SettingsStep.Close
}

/**
 * 顶栏的按钮（网页 settingsButtonStep）：一览上的"关闭"（[onPage] = false）和页面上的"返回"（[onPage] = true）。
 * 开着的编辑区一次全关，不像返回键那样一步一步退。照片在裁剪或上传时（[photoBusy]）不走，显示"账号"页。
 */
internal fun settingsButtonStep(locked: Boolean, photoBusy: Boolean, onPage: Boolean, dirty: Boolean): SettingsStep = when {
    locked -> SettingsStep.Stay
    photoBusy -> SettingsStep.Show(SettingsPage.Account)
    dirty -> SettingsStep.Show(SettingsPage.Personalization, attention = true)
    onPage -> SettingsStep.Home
    else -> SettingsStep.Close
}

/**
 * 返回键要先处理的编辑区（网页 profileGuard / iconGuard 说"还不能关"的时候）：[page] 是它所在的那一栏，
 * 后两项是要收起哪一个。照片上传中两项都是 false：只显示"账号"页，不收编辑区。
 */
internal data class SettingsEditorGuard(val page: SettingsPage, val closeAvatarEditor: Boolean = false, val closeIconPicker: Boolean = false)

/**
 * 网页 close() 里先问 profileGuard、再问 iconGuard 的顺序：照片上传中 → 头像的"照片 / 表情"编辑区开着 → 图标的角色网格开着。
 * 都没有时返回 null（返回键照 [settingsDismissStep] 往下走）。
 */
internal fun settingsEditorGuard(uploading: Boolean, avatarEditorOpen: Boolean, iconPickerOpen: Boolean): SettingsEditorGuard? = when {
    uploading -> SettingsEditorGuard(SettingsPage.Account)
    avatarEditorOpen -> SettingsEditorGuard(SettingsPage.Account, closeAvatarEditor = true)
    iconPickerOpen -> SettingsEditorGuard(SettingsPage.General, closeIconPicker = true)
    else -> null
}
