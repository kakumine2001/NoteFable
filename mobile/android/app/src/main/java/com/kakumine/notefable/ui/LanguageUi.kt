package com.kakumine.notefable.ui

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import androidx.core.os.LocaleListCompat
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AccountUser
import com.kakumine.notefable.data.AppLanguage
import com.kakumine.notefable.data.LOCALE_UNKNOWN
import com.kakumine.notefable.data.LocaleSyncAction
import com.kakumine.notefable.data.localeSyncAction

// 界面语言（网页 src/lib/i18n 与 settings-dialog.tsx 的 LanguageSettings、language-menu.tsx、account-button.tsx 的 AccountLocaleSync）：
// 选项是 4 种语言；没选过时按系统语言显示，列表里标的就是正在显示的语言。App 的语言设置
// （AppCompatDelegate.setApplicationLocales，相当于网页的 Cookie）就是本机的选择。登录用户在设置里选，存在账号上（User.locale），
// [AccountLocaleSync] 让本机跟着账号走；未登录时在侧栏底部的语言菜单（[LanguageMenuButton]）里选，只改本机。

// CSS 的 ease-out。
internal val CssEaseOut = CubicBezierEasing(0f, 0f, 0.58f, 1f)

/** App 当前的语言设置（空＝自动，跟系统语言）。 */
private fun currentPreference(): AppLanguage.Preference =
    AppLanguage.preferenceOf(AppCompatDelegate.getApplicationLocales()[0])

/** 这次运行里的同步状态（网页 account-button.tsx 模块级的 firstRunDone / migrated）。只在主线程读写。 */
private object LocaleSyncMemory {
    var firstRunDone = false
    var migrated: AppLanguage.Preference? = null
    /** 上一次切换失败（网页 changeError）：设置里显示"无法切换语言"和"重试"。 */
    var failed by mutableStateOf(false)
}

/** 换 App 的语言设置。语言变化由 MainActivity 的 configChanges 接住，界面就地重组，输入中的内容不丢。 */
private fun applyLanguage(preference: AppLanguage.Preference) {
    try {
        AppCompatDelegate.setApplicationLocales(
            preference.tag?.let(LocaleListCompat::forLanguageTags) ?: LocaleListCompat.getEmptyLocaleList(),
        )
        LocaleSyncMemory.failed = false
    } catch (e: RuntimeException) {
        LocaleSyncMemory.failed = true
    }
}

/**
 * 退出登录、删除账号后忘掉本机的语言选择，回到系统语言（网页 forgetLocaleChoice）。
 * 同步状态也回到"刚打开 App"：网页退出后会重新载入页面，App 不会，不清的话下次登录时不会把未登录时选的语言存到账号上。
 */
fun forgetLanguageChoice() {
    LocaleSyncMemory.firstRunDone = false
    LocaleSyncMemory.migrated = null
    if (currentPreference() != AppLanguage.Preference.Auto) applyLanguage(AppLanguage.Preference.Auto)
}

/**
 * 让界面语言跟着账号走（网页 AccountLocaleSync，App 里只放一个）。只在账号状态（读到没有、是否登录、账号上的语言）变化时判断，
 * 规则见 [localeSyncAction]。[onSave] 把本机以前选的语言存到账号上（只在打开 App 后第一次判断时试一次）。
 */
@Composable
fun AccountLocaleSync(account: AccountUiState, onSave: (String) -> Unit) {
    val signedIn = account.user != null
    val saved = account.user?.locale
    LaunchedEffect(account.loaded, account.configured, signedIn, saved, account.signingOut) {
        // 退出登录期间不同步（网页 signingOut）：不在即将离开的身份上切换或保存；退出完成后再判断一次（这时已是未登录）。
        if (account.signingOut) return@LaunchedEffect
        val known = account.loaded && account.configured && signedIn && saved != LOCALE_UNKNOWN
        val action = localeSyncAction(
            loaded = account.loaded,
            configured = account.configured,
            signedIn = signedIn,
            saved = saved,
            preference = currentPreference(),
            active = AppLanguage.preferenceOfCode(AppLanguage.uiLocale) ?: AppLanguage.Preference.English,
            // 原生版的切换是同步的（没有取字典这一步），不存在"切换中"。
            target = null,
            firstRun = known && !LocaleSyncMemory.firstRunDone,
            migrated = LocaleSyncMemory.migrated,
        )
        if (known) LocaleSyncMemory.firstRunDone = true
        when (action) {
            is LocaleSyncAction.Switch -> applyLanguage(action.to)
            is LocaleSyncAction.Save -> {
                LocaleSyncMemory.migrated = action.locale
                onSave(action.locale.code)
            }
            null -> Unit
        }
    }
}

/**
 * 设置里的"语言"（网页 LanguageSettings + .settings-language-*，手机尺寸）：标题 14/600；
 * 列表上 6.4、间距 2，每项是 .project-settings-option（最小高 44、圆角 6、左右 8、间距 8.8、15 字），左边 16 的圆形单选
 * （1px 深描边白底；选中时蓝边 + 中间 8 的蓝点），选中的整行灰底。各语言名按它自己的语言排版。
 * 标的是选过的语言；没选过（null）时标正在显示的语言，点它也会存（把系统语言固定到账号上）；读不到账号的语言时哪一项都不标。
 * 只保存，切换交给 [AccountLocaleSync]。
 */
@Composable
fun LanguageSettings(user: AccountUser, onChoose: (String) -> Unit) {
    val saved = AppLanguage.preferenceOfCode(user.locale)
    val checked = when (user.locale) {
        LOCALE_UNKNOWN -> null
        null -> showingLanguage()
        else -> saved
    }
    Column(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.language), color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold)
        Column(Modifier.padding(top = 6.4.dp).selectableGroup(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Languages.forEach { option ->
                val selected = option == checked
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.dp))
                        .background(if (selected) Sm.Hover else Color.Transparent)
                        .selectable(selected = selected, role = Role.RadioButton) { if (option != saved) onChoose(option.code) }
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Radio16(selected)
                    Spacer(Modifier.width(8.8.dp))
                    LanguageName(option, Modifier.weight(1f), fontSize = 15)
                }
            }
        }
        if (LocaleSyncMemory.failed) {
            Text(
                stringResource(R.string.language_change_failed), color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp,
                modifier = Modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Assertive },
            )
            if (saved != null) NotionButton(stringResource(R.string.try_again), onClick = { applyLanguage(saved) }, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

/** 列表里的 4 种语言（网页 LOCALES 的顺序）。 */
private val Languages = AppLanguage.Preference.entries.filter { it != AppLanguage.Preference.Auto }

/** 正在显示的语言（资源解析的结果 `ui_locale`）。 */
@Composable
private fun showingLanguage(): AppLanguage.Preference =
    AppLanguage.preferenceOfCode(stringResource(R.string.ui_locale)) ?: AppLanguage.Preference.English

/** 语言名：按它自己的语言排版（网页 lang=）。 */
@Composable
private fun LanguageName(option: AppLanguage.Preference, modifier: Modifier, fontSize: Int) {
    Text(
        AppLanguage.nativeName(option).orEmpty(), modifier, color = Sm.Text, fontSize = fontSize.sp,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
        style = LocalTextStyle.current.copy(localeList = LocaleList(option.code)),
    )
}

/**
 * 未登录时侧栏底部的语言按钮（网页 .language-trigger）：12 灰字，左边 14 的 Languages 图标、间距 4.8，写现在的界面语言。
 * 点了打开 [LanguageMenu]，选了马上换 App 的语言（只改本机）。
 */
@Composable
fun LanguageMenuButton(modifier: Modifier = Modifier) {
    var anchor by remember { mutableStateOf<IntRect?>(null) }
    var bounds by remember { mutableStateOf<IntRect?>(null) }
    val showing = showingLanguage()
    val name = AppLanguage.nativeName(showing).orEmpty()
    val label = stringResource(R.string.language_current, name)
    // 切换失败（网页 .language-menu-error）：按钮下面一行红字。
    Column(modifier, horizontalAlignment = Alignment.End) {
        Row(
            Modifier
                .onGloballyPositioned { coordinates ->
                    val box = coordinates.boundsInWindow()
                    bounds = IntRect(box.left.toInt(), box.top.toInt(), box.right.toInt(), box.bottom.toInt())
                }
                .clickable(role = Role.Button) { anchor = bounds }
                .semantics(mergeDescendants = true) { contentDescription = label },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.8.dp),
        ) {
            LucideIcon(Lucide.Languages, 14.dp, Sm.Muted)
            Text(name, color = Sm.Muted, fontSize = 12.sp, style = LocalTextStyle.current.copy(localeList = LocaleList(showing.code)))
        }
        if (LocaleSyncMemory.failed) {
            Text(
                stringResource(R.string.language_change_failed), color = SettingsDanger, fontSize = 12.sp,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }
    }
    anchor?.let { rect ->
        LanguageMenu(rect, current = showing, onClose = { anchor = null }) { choice ->
            anchor = null
            if (choice != showing) applyLanguage(choice)
        }
    }
}

/**
 * 语言菜单（网页 language-menu.tsx 的 .chat-actions-menu.language-menu）：宽 228、内边距 5.6、圆角 12、1px 细线、白底、阴影。
 * 按钮在屏幕下方，所以下面放不下就开在按钮上方（间距 4），左边和按钮对齐，离窗口边至少 8。
 * 项是 .chat-menu-item（最小高 44、内边距 9.6×12、圆角 6.4、14 字），正在显示的语言右边 15 的蓝色对勾。
 */
@Composable
private fun LanguageMenu(anchor: IntRect, current: AppLanguage.Preference, onClose: () -> Unit, onChoose: (AppLanguage.Preference) -> Unit) {
    val density = LocalDensity.current
    val provider = remember(anchor, density) {
        object : PopupPositionProvider {
            override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
                with(density) {
                    val edge = 8.dp.roundToPx()
                    val gap = 4.dp.roundToPx()
                    val below = anchor.bottom + gap + popupContentSize.height <= windowSize.height - edge
                    val top = if (below) anchor.bottom + gap else (anchor.top - gap - popupContentSize.height).coerceAtLeast(edge)
                    val left = minOf(anchor.left, windowSize.width - popupContentSize.width - edge).coerceAtLeast(edge)
                    return IntOffset(left, top)
                }
            }
        }
    }
    val label = stringResource(R.string.language)
    Popup(popupPositionProvider = provider, onDismissRequest = onClose, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier.width(228.dp)
                .shadow(16.dp, RoundedCornerShape(12.dp), ambientColor = LanguageMenuShadow, spotColor = LanguageMenuShadow)
                .border(1.dp, Sm.Border, RoundedCornerShape(12.dp))
                .clip(RoundedCornerShape(12.dp)).background(Color.White)
                .padding(5.6.dp)
                .selectableGroup()
                .semantics { contentDescription = label },
        ) {
            Languages.forEach { option ->
                val selected = option == current
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.4.dp))
                        .selectable(selected = selected, role = Role.RadioButton) { onChoose(option) }
                        .padding(horizontal = 12.dp, vertical = 9.6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    LanguageName(option, Modifier.weight(1f), fontSize = 14)
                    Spacer(Modifier.width(12.dp))
                    Box(Modifier.size(15.dp)) { if (selected) LucideIcon(Lucide.Check, 15.dp, Sm.Blue) }
                }
            }
        }
    }
}

// .chat-actions-menu 的 box-shadow 0 8px 32px #0002。
private val LanguageMenuShadow = Color(0x22000000)

// .settings-language-radio：16 的圆，1px 深描边、白底；选中时蓝边，中间半径 4 的蓝点。
@Composable
private fun Radio16(checked: Boolean) {
    Box(
        Modifier.size(16.dp).clip(CircleShape).background(Color.White)
            .border(1.dp, if (checked) Sm.Blue else Sm.BorderStrong, CircleShape),
        Alignment.Center,
    ) {
        if (checked) Box(Modifier.size(8.dp).clip(CircleShape).background(Sm.Blue))
    }
}
