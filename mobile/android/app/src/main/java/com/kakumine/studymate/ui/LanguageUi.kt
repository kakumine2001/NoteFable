package com.kakumine.studymate.ui

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.LocaleList
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
import com.kakumine.studymate.R
import com.kakumine.studymate.data.AppLanguage
import kotlinx.coroutines.delay

// 侧栏底部的表示语言（网页 LanguageSelect，src/components/language-select.tsx + globals.css 的 .language-select*，手机尺寸）：
// 触发行高 44、左右 8、圆角 4.8、间距 8.8；地球 16 灰、"语言" 15、当前值 13 灰、右侧下箭头 13（切换中换成转圈）；切换中半透明 0.6、不可点。
// 菜单（.language-menu）在触发行正上方 4、和触发行同宽（至少 176）、内边距 5.6、圆角 12、1px rgba(55,53,47,.09)、白底、--notion-shadow；
// 选项（.chat-menu-item.language-menu-item）高 44、左右 12、圆角 6.4、14sp，选中的加粗 600 并在右侧打勾 15；
// 各语言名用它自己的语言排版（网页 lang={option}，汉字字形随语言）。打开时 .notes-popover 的 motion-menu-enter：
// 120ms ease-out，从透明、下移 0.25rem（4）、缩小到 .98 开始。
// 选项：自动 / English / 简体中文 / 繁體中文 / 日本語。选择存在系统的"应用语言"里（AppCompatDelegate），出错时在下面显示红字。
@Composable
fun LanguageSelect() {
    val configuration = LocalConfiguration.current
    var preference by remember { mutableStateOf(currentPreference()) }
    var open by rememberSaveable { mutableStateOf(false) }
    var switching by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var triggerWidth by remember { mutableIntStateOf(0) }
    // 语言生效时 Activity 收到配置变化：重新读选择、结束"切换中"。
    LaunchedEffect(configuration) {
        preference = currentPreference()
        switching = false
    }
    // 选的语言和现在的界面语言一样时不会有配置变化，过一会儿也结束"切换中"。
    LaunchedEffect(switching) {
        if (switching) {
            delay(3000)
            switching = false
        }
    }
    val automatic = stringResource(R.string.language_automatic)
    val label = { option: AppLanguage.Preference -> AppLanguage.nativeName(option) ?: automatic }
    val changing = stringResource(R.string.language_changing)

    fun choose(option: AppLanguage.Preference) {
        open = false
        if (option == preference) return
        failed = false
        switching = true
        try {
            AppCompatDelegate.setApplicationLocales(
                option.tag?.let(LocaleListCompat::forLanguageTags) ?: LocaleListCompat.getEmptyLocaleList(),
            )
            preference = option
        } catch (e: RuntimeException) {
            switching = false
            failed = true
        }
    }

    Column(Modifier.padding(start = 8.dp, end = 8.dp, top = 8.dp).fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().height(44.dp).onSizeChanged { triggerWidth = it.width }
                .clip(RoundedCornerShape(4.8.dp))
                .clickable(enabled = !switching, role = Role.Button) { open = !open }
                .semantics { if (switching) stateDescription = changing }
                .alpha(if (switching) 0.6f else 1f)
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.8.dp),
        ) {
            LucideIcon(Lucide.Globe, 16.dp, Sm.Muted)
            Text(stringResource(R.string.language), modifier = Modifier.weight(1f), color = Sm.Text, fontSize = 15.sp, maxLines = 1)
            Text(label(preference), color = Sm.Muted, fontSize = 13.sp, maxLines = 1)
            if (switching) Spinner(13) else LucideIcon(Lucide.ChevronDown, 13.dp, Sm.Muted)
        }
        if (open) {
            LanguageMenu(
                preference = preference,
                width = with(LocalDensity.current) { triggerWidth.toDp() }.coerceAtLeast(176.dp),
                label = label,
                onChoose = ::choose,
                onDismiss = { open = false },
            )
        }
        if (failed) {
            Text(
                stringResource(R.string.language_change_failed),
                color = Color(0xFFDC2626), // text-red-600
                fontSize = 12.sp,
                lineHeight = 16.sp,
                modifier = Modifier.padding(top = 4.dp).semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }
    }
}

private fun currentPreference(): AppLanguage.Preference =
    AppLanguage.preferenceOf(AppCompatDelegate.getApplicationLocales()[0])

// 网页 Loader2 + animate-spin（1 秒转一圈，匀速）。
@Composable
private fun Spinner(size: Int) {
    val angle by rememberInfiniteTransition(label = "spin").animateFloat(
        0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "angle",
    )
    LucideIcon(Lucide.Loader2, size.dp, Sm.Muted, Modifier.rotate(angle))
}

// CSS 的 ease-out。
private val CssEaseOut = CubicBezierEasing(0f, 0f, 0.58f, 1f)

// 菜单贴在触发行上方 [gap] 处、左边对齐（.language-menu：bottom: calc(100% + 4px); left: 0）。
private class AboveTrigger(private val gap: Int) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset =
        IntOffset(anchorBounds.left, (anchorBounds.top - gap - popupContentSize.height).coerceAtLeast(0))
}

@Composable
private fun LanguageMenu(
    preference: AppLanguage.Preference,
    width: androidx.compose.ui.unit.Dp,
    label: (AppLanguage.Preference) -> String,
    onChoose: (AppLanguage.Preference) -> Unit,
    onDismiss: () -> Unit,
) {
    val density = LocalDensity.current
    // 锚点是包着触发行和错误文的 Column，它的顶边就是触发行的顶边。
    val provider = remember(density) { AboveTrigger(with(density) { 4.dp.roundToPx() }) }
    val shape = RoundedCornerShape(12.dp)
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(120, easing = CssEaseOut)) }
    Popup(popupPositionProvider = provider, onDismissRequest = onDismiss, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier.graphicsLayer {
                val t = enter.value
                alpha = t
                translationY = (1f - t) * 4.dp.toPx()
                val scale = 0.98f + 0.02f * t
                scaleX = scale
                scaleY = scale
            }.width(width)
                .shadow(14.dp, shape, ambientColor = Color(0x330F0F0F), spotColor = Color(0x330F0F0F))
                .background(Color.White, shape).border(1.dp, Sm.Border, shape).padding(5.6.dp),
        ) {
            AppLanguage.Preference.entries.forEach { option ->
                val selected = option == preference
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.4.dp))
                        .selectable(selected = selected, role = Role.RadioButton) { onChoose(option) }
                        .padding(horizontal = 12.dp, vertical = 9.6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        label(option),
                        modifier = Modifier.weight(1f),
                        color = Sm.Text,
                        fontSize = 14.sp,
                        lineHeight = 21.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        style = if (option == AppLanguage.Preference.Auto) LocalTextStyle.current
                        else LocalTextStyle.current.copy(localeList = LocaleList(option.code)),
                    )
                    if (selected) LucideIcon(Lucide.Check, 15.dp, Sm.Text)
                }
            }
        }
    }
}
