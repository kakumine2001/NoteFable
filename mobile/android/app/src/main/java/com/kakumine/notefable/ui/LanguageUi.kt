package com.kakumine.notefable.ui

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
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
// 选项是 Auto + 4 种语言；对勾表示偏好，实际显示的语言单独标注。App 的语言设置
// （AppCompatDelegate.setApplicationLocales，相当于网页的 Cookie）就是本机的选择。登录用户在设置里选，存在账号上（User.locale），
// [AccountLocaleSync] 让本机跟着账号走；未登录时在侧栏底部帮助菜单（[HelpMenuButton]）的语言项里选，只改本机。

// CSS 的 ease-out。
internal val CssEaseOut = CubicBezierEasing(0f, 0f, 0.58f, 1f)

/** App 当前的语言设置（空＝自动，跟系统语言）。 */
internal fun currentPreference(): AppLanguage.Preference =
    AppLanguage.preferenceOf(AppCompatDelegate.getApplicationLocales()[0])

/** 本机切换失败状态，只在主线程读写。 */
private object LocaleSyncMemory {
    /** 上一次切换失败（网页 changeError）：设置里显示"无法切换语言"和"重试"。 */
    var failed by mutableStateOf(false)
}

/** 换 App 的语言设置。语言变化由 MainActivity 的 configChanges 接住，界面就地重组，输入中的内容不丢。 */
private fun applyLanguage(preference: AppLanguage.Preference) {
    val previous = AppCompatDelegate.getApplicationLocales()
    try {
        AppCompatDelegate.setApplicationLocales(
            preference.tag?.let(LocaleListCompat::forLanguageTags) ?: LocaleListCompat.getEmptyLocaleList(),
        )
        LocaleSyncMemory.failed = false
    } catch (e: RuntimeException) {
        runCatching { AppCompatDelegate.setApplicationLocales(previous) }
        LocaleSyncMemory.failed = true
    }
}

/**
 * 退出登录、删除账号后忘掉本机的语言选择，回到系统语言（网页 forgetLocaleChoice）。
 */
fun forgetLanguageChoice() {
    if (currentPreference() != AppLanguage.Preference.Auto) applyLanguage(AppLanguage.Preference.Auto)
}

/**
 * 让界面语言跟着账号走（网页 AccountLocaleSync，App 里只放一个）。只在账号状态（读到没有、是否登录、账号上的语言）变化时判断，
 * 规则见 [localeSyncAction]。账号 null 明确表示 Auto，不用本机选择写回账号。
 */
@Composable
fun AccountLocaleSync(account: AccountUiState) {
    val signedIn = account.user != null
    val saved = account.user?.locale
    LaunchedEffect(account.loaded, account.configured, signedIn, saved, account.signingOut) {
        // 退出登录期间不同步（网页 signingOut）：不在即将离开的身份上切换或保存；退出完成后再判断一次（这时已是未登录）。
        if (account.signingOut) return@LaunchedEffect
        val action = localeSyncAction(
            loaded = account.loaded,
            configured = account.configured,
            signedIn = signedIn,
            saved = saved,
            preference = currentPreference(),
            active = AppLanguage.preferenceOfCode(AppLanguage.uiLocale) ?: AppLanguage.Preference.English,
            // 原生版的切换是同步的（没有取字典这一步），不存在"切换中"。
            target = null,
        )
        when (action) {
            is LocaleSyncAction.Switch -> applyLanguage(action.to)
            null -> Unit
        }
    }
}

/**
 * 设置里的"语言"一行（网页 LanguageSettings + .settings-row / .settings-select，手机尺寸）：行最小高 56、内边距 10×16，
 * 左边"语言"16/500，右边是选择按钮（高 40、左 12 右 10、1px 深描边、圆角 8、白底、15 字 + 间距 8 + 14 的 ChevronsUpDown 浅灰；
 * 打开时蓝边 + 外侧 3px 的浅蓝光圈），写的是标着的语言。点了在按钮下方打开 [LanguageMenu]（右边和按钮对齐）。
 * 标的是保存的偏好（null 选 Auto）；读不到账号的语言时哪一项都不标
 * （按钮上写正在显示的语言）。只保存，切换交给 [AccountLocaleSync]。
 */
@Composable
fun LanguageSettings(user: AccountUser, onChoose: (String?) -> Unit) {
    val saved = if (user.locale == null) AppLanguage.Preference.Auto else AppLanguage.preferenceOfCode(user.locale)
    val checked = when (user.locale) {
        LOCALE_UNKNOWN -> null
        null -> AppLanguage.Preference.Auto
        else -> saved
    }
    val shown = checked ?: showingLanguage()
    var anchor by remember { mutableStateOf<IntRect?>(null) }
    var bounds by remember { mutableStateOf<IntRect?>(null) }
    val label = stringResource(R.string.language_current, languageLabel(shown))
    val shape = RoundedCornerShape(8.dp)
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.language), Modifier.weight(1f), color = Sm.Text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.width(16.dp))
            Row(
                Modifier.widthIn(max = 200.dp)
                    .onGloballyPositioned { coordinates ->
                        val box = coordinates.boundsInWindow()
                        bounds = IntRect(box.left.toInt(), box.top.toInt(), box.right.toInt(), box.bottom.toInt())
                    }
                    .drawBehind {
                        if (anchor != null) {
                            val ring = 3.dp.toPx()
                            drawRoundRect(
                                SettingsFocusRing, topLeft = Offset(-ring, -ring), size = Size(size.width + ring * 2, size.height + ring * 2),
                                cornerRadius = CornerRadius(8.dp.toPx() + ring),
                            )
                        }
                    }
                    .heightIn(min = 40.dp).clip(shape).background(Color.White).border(1.dp, if (anchor != null) Sm.Blue else Sm.BorderStrong, shape)
                    .clickable(role = Role.DropdownList) { anchor = bounds }
                    .semantics(mergeDescendants = true) { contentDescription = label }
                    .padding(start = 12.dp, end = 10.dp, top = 5.6.dp, bottom = 5.6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                LanguageName(shown, Modifier.weight(1f, fill = false), fontSize = 15)
                LucideIcon(Lucide.ChevronsUpDown, 14.dp, Sm.Faint)
            }
        }
        if (LocaleSyncMemory.failed) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
                Text(
                    stringResource(R.string.language_change_failed), color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                )
                if (saved != null) NotionButton(stringResource(R.string.try_again), onClick = { applyLanguage(saved) }, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
    anchor?.let { rect ->
        LanguageMenu(rect, current = checked, alignEnd = true, onClose = { anchor = null }) { choice ->
            anchor = null
            // Auto sends explicit null; manual options save their internal code.
            if (choice != saved) onChoose(choice.code.takeUnless { choice == AppLanguage.Preference.Auto })
        }
    }
}

/** Auto first, then enabled languages in Web order. */
private val Languages = AppLanguage.Preference.entries

/** 正在显示的语言（资源解析的结果 `ui_locale`）。 */
@Composable
internal fun showingLanguage(): AppLanguage.Preference =
    AppLanguage.preferenceOfCode(stringResource(R.string.ui_locale)) ?: AppLanguage.Preference.English

/** 语言名：按它自己的语言排版（网页 lang=）。 */
@Composable
private fun LanguageName(option: AppLanguage.Preference, modifier: Modifier, fontSize: Int) {
    Text(
        languageLabel(option), modifier, color = Sm.Text, fontSize = fontSize.sp,
        maxLines = 3, overflow = TextOverflow.Ellipsis,
        style = LocalTextStyle.current.copy(localeList = LocaleList(option.tag ?: AppLanguage.acceptLanguage(AppLanguage.uiLocale))),
    )
}

@Composable
internal fun languageLabel(option: AppLanguage.Preference): String =
    if (option == AppLanguage.Preference.Auto) stringResource(R.string.language_auto_current, AppLanguage.nativeName(showingLanguage()).orEmpty())
    else AppLanguage.nativeName(option).orEmpty()

/** 上一次切换语言失败了（网页 changeError）。侧栏的帮助菜单按钮下面显示一行红字。 */
internal val languageChangeFailed: Boolean get() = LocaleSyncMemory.failed

/** 未登录时在帮助菜单里选了语言：马上换 App 的语言（只改本机）。按系统语言显示中选了同一种语言，也当作选择存下来，和网页一样。 */
internal fun chooseLanguageOnDevice(choice: AppLanguage.Preference) {
    if (choice != currentPreference()) applyLanguage(choice)
}

/**
 * 语言菜单（网页 language-menu.tsx 的 .chat-actions-menu.language-menu）：宽最多 320、内边距 5.6、圆角 12、1px 细线、白底、阴影。
 * 按钮在屏幕下方，所以下面放不下就开在按钮上方（间距 4），左边和按钮对齐（alignEnd 时右边对齐，设置里的行用），离窗口边至少 8。
 * current 是标对勾的语言（null 时哪一项都不标）。
 * 项是 .chat-menu-item（最小高 44、内边距 9.6×12、圆角 6.4、14 字），正在显示的语言右边 15 的蓝色对勾。
 */
@Composable
internal fun LanguageMenu(
    anchor: IntRect, current: AppLanguage.Preference?, alignEnd: Boolean = false, onClose: () -> Unit, onChoose: (AppLanguage.Preference) -> Unit,
) {
    val density = LocalDensity.current
    val configuration = LocalConfiguration.current
    var query by remember { mutableStateOf("") }
    val searchLabel = stringResource(R.string.language_search)
    val effective = showingLanguage()
    val provider = remember(anchor, density, alignEnd) {
        object : PopupPositionProvider {
            override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
                with(density) {
                    val edge = 8.dp.roundToPx()
                    val gap = 4.dp.roundToPx()
                    val below = anchor.bottom + gap + popupContentSize.height <= windowSize.height - edge
                    val top = if (below) anchor.bottom + gap else (anchor.top - gap - popupContentSize.height).coerceAtLeast(edge)
                    val alignRight = if (layoutDirection == LayoutDirection.Rtl) !alignEnd else alignEnd
                    val start = if (alignRight) anchor.right - popupContentSize.width else anchor.left
                    val left = minOf(start, windowSize.width - popupContentSize.width - edge).coerceAtLeast(edge)
                    return IntOffset(left, top)
                }
            }
        }
    }
    val label = stringResource(R.string.language)
    Popup(popupPositionProvider = provider, onDismissRequest = onClose, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier.width(minOf(320, configuration.screenWidthDp - 16).dp).heightIn(max = minOf(368, configuration.screenHeightDp - 16).dp)
                .shadow(16.dp, RoundedCornerShape(12.dp), ambientColor = LanguageMenuShadow, spotColor = LanguageMenuShadow)
                .border(1.dp, Sm.Border, RoundedCornerShape(12.dp))
                .clip(RoundedCornerShape(12.dp)).background(Color.White)
                .padding(5.6.dp)
                .selectableGroup()
                .semantics { contentDescription = label },
        ) {
            Row(Modifier.fillMaxWidth().padding(4.dp).border(1.dp, Sm.Border, RoundedCornerShape(6.4.dp)).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                BasicTextField(query, onValueChange = { query = it }, singleLine = true,
                    textStyle = LocalTextStyle.current.copy(color = Sm.Text, fontSize = 14.sp),
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = searchLabel },
                    decorationBox = { inner -> if (query.isEmpty()) Text(searchLabel, color = Sm.Muted, fontSize = 14.sp); inner() })
            }
            val filtered = Languages.filter { it == AppLanguage.Preference.Auto || "${AppLanguage.nativeName(it)} ${it.code} ${it.tag}".contains(query.trim(), ignoreCase = true) }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                filtered.forEach { option ->
                    val selected = option == current
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.4.dp))
                            .background(if (selected) Sm.Active else Color.Transparent)
                            .selectable(selected = selected, role = Role.RadioButton) { onChoose(option) }
                            .padding(horizontal = 12.dp, vertical = 9.6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            // Auto 行：「自动检测」下面用小字写「当前：○○」（和网页的语言列表一样，不重复「自动检测」）。
                            if (option == AppLanguage.Preference.Auto) {
                                Text(stringResource(R.string.language_auto), color = Sm.Text, fontSize = 14.sp)
                                Text(stringResource(R.string.language_auto_now, AppLanguage.nativeName(showingLanguage()).orEmpty()), color = Sm.Muted, fontSize = 12.sp)
                            } else LanguageName(option, Modifier.fillMaxWidth(), fontSize = 14)
                            if (option == effective) Text(stringResource(R.string.language_effective), color = Sm.Muted, fontSize = 12.sp)
                        }
                        Spacer(Modifier.width(12.dp))
                        Box(Modifier.size(15.dp)) { if (selected) LucideIcon(Lucide.Check, 15.dp, Sm.Blue) }
                    }
                }
                if (filtered.size == 1 && query.isNotBlank()) Text(
                    stringResource(R.string.language_no_results), color = Sm.Muted, fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }
    }
}

// .chat-actions-menu 的 box-shadow 0 8px 32px #0002。
internal val LanguageMenuShadow = Color(0x22000000)
