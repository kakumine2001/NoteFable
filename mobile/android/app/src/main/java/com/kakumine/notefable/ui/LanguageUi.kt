package com.kakumine.notefable.ui

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.os.LocaleListCompat
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AccountUser
import com.kakumine.notefable.data.AppLanguage
import com.kakumine.notefable.data.LOCALE_UNKNOWN
import com.kakumine.notefable.data.LocaleSyncAction
import com.kakumine.notefable.data.localeSyncAction

// 界面语言（网页 src/lib/i18n 与 settings-dialog.tsx 的 LanguageSettings、account-button.tsx 的 AccountLocaleSync）：
// 只有登录用户能在设置里选，没有"自动"；选的语言存在账号上（User.locale），App 的语言设置
// （AppCompatDelegate.setApplicationLocales，相当于网页的 Cookie）由 [AccountLocaleSync] 跟着账号走。
// 未登录时没有语言选项，始终是系统语言。

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
 * 设置里的"语言"（网页 LanguageSettings + .settings-language-*，手机尺寸）：标题 14/600；账号上还没选过时下面一行说明（13 灰）；
 * 列表上 6.4、间距 2，每项是 .project-settings-option（最小高 44、圆角 6、左右 8、间距 8.8、15 字），左边 16 的圆形单选
 * （1px 深描边白底；选中时蓝边 + 中间 8 的蓝点），选中的整行灰底。各语言名按它自己的语言排版。
 * 选之前哪一项都不标（也能把正在显示的语言固定到账号上）；点已选的那项什么也不做。只保存，切换交给 [AccountLocaleSync]。
 */
@Composable
fun LanguageSettings(user: AccountUser, onChoose: (String) -> Unit) {
    val saved = AppLanguage.preferenceOfCode(user.locale)
    Column(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.language), color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold)
        // 不知道账号上的语言（读不到）时不说"没选过"。
        if (user.locale == null) SettingsHelpText(stringResource(R.string.settings_language_help))
        Column(Modifier.padding(top = 6.4.dp).selectableGroup(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            AppLanguage.Preference.entries.filter { it != AppLanguage.Preference.Auto }.forEach { option ->
                val selected = option == saved
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.dp))
                        .background(if (selected) Sm.Hover else Color.Transparent)
                        .selectable(selected = selected, role = Role.RadioButton) { if (!selected) onChoose(option.code) }
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Radio16(selected)
                    Spacer(Modifier.width(8.8.dp))
                    Text(
                        AppLanguage.nativeName(option).orEmpty(),
                        modifier = Modifier.weight(1f),
                        color = Sm.Text,
                        fontSize = 15.sp,
                        style = LocalTextStyle.current.copy(localeList = LocaleList(option.code)),
                    )
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
