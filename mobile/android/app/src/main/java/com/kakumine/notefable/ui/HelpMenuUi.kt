package com.kakumine.notefable.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import com.kakumine.notefable.BuildConfig
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AppLanguage

private enum class HelpOpen { Help, Language }

/**
 * 侧栏底部的"?"（网页 help-menu.tsx 的 .sidebar-help-trigger）：手机宽度下 44×44、圆角 6.4，17 的 CircleHelp，--notion-faint 色，
 * 打开时底色 --notion-hover、图标 --notion-text。点了在按钮上方开帮助菜单；未登录时（[guest]）菜单里多一项界面语言，点了换成语言菜单。
 */
@Composable
fun HelpMenuButton(guest: Boolean) {
    var bounds by remember { mutableStateOf<IntRect?>(null) }
    var open by remember { mutableStateOf<HelpOpen?>(null) }
    val label = stringResource(R.string.help)
    Box(
        Modifier.size(44.dp).clip(RoundedCornerShape(6.4.dp))
            .background(if (open != null) Sm.Hover else Color.Transparent)
            .onGloballyPositioned { c ->
                val box = c.boundsInWindow()
                bounds = IntRect(box.left.toInt(), box.top.toInt(), box.right.toInt(), box.bottom.toInt())
            }
            .clickable(role = Role.Button) { open = if (open == null) HelpOpen.Help else null }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        LucideIcon(Lucide.CircleHelp, 17.dp, if (open != null) Sm.Text else Sm.Faint)
    }
    val anchor = bounds ?: return
    when (open) {
        HelpOpen.Help -> HelpMenu(anchor, guest, onClose = { open = null }, onLanguage = { open = HelpOpen.Language })
        HelpOpen.Language -> LanguageMenu(anchor, current = showingLanguage(), alignEnd = true, onClose = { open = null }) { choice ->
            open = null
            chooseLanguageOnDevice(choice)
        }
        null -> Unit
    }
}

/**
 * 帮助菜单（.chat-actions-menu.help-menu）：宽 228、内边距 5.6、圆角 12、1px 细线、白底、阴影；右边和按钮对齐，开在按钮上方（放不下就下方），
 * 离窗口边至少 8。项是 .chat-menu-item（最小高 44、内边距 9.6×12、间距 12、14 字），左边 16 的灰色图标。
 * 介绍页指定用浏览器打开，免得用户把站点链接设为由本 App 打开时又回到 App。
 */
@Composable
private fun HelpMenu(anchor: IntRect, guest: Boolean, onClose: () -> Unit, onLanguage: () -> Unit) {
    val density = LocalDensity.current
    val uri = LocalUriHandler.current
    val context = LocalContext.current
    val provider = remember(anchor, density) {
        object : PopupPositionProvider {
            override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
                with(density) {
                    val edge = 8.dp.roundToPx()
                    val gap = 4.dp.roundToPx()
                    val above = anchor.top - gap - popupContentSize.height >= edge
                    val top = if (above) anchor.top - gap - popupContentSize.height
                    else minOf(anchor.bottom + gap, windowSize.height - popupContentSize.height - edge).coerceAtLeast(edge)
                    val left = minOf(anchor.right - popupContentSize.width, windowSize.width - popupContentSize.width - edge).coerceAtLeast(edge)
                    return IntOffset(left, top)
                }
            }
        }
    }
    val label = stringResource(R.string.help)
    Popup(popupPositionProvider = provider, onDismissRequest = onClose, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier.width(228.dp)
                .shadow(16.dp, RoundedCornerShape(12.dp), ambientColor = LanguageMenuShadow, spotColor = LanguageMenuShadow)
                .border(1.dp, Sm.Border, RoundedCornerShape(12.dp))
                .clip(RoundedCornerShape(12.dp)).background(Color.White)
                .padding(5.6.dp)
                .semantics { contentDescription = label },
        ) {
            HelpItem(Lucide.Info, stringResource(R.string.about)) { onClose(); openInBrowser(context, BuildConfig.BASE_URL + "/?intro") }
            HelpItem(Lucide.Shield, stringResource(R.string.privacy)) { onClose(); uri.openUri(BuildConfig.BASE_URL + "/privacy") }
            HelpItem(Lucide.FileText, stringResource(R.string.terms)) { onClose(); uri.openUri(BuildConfig.BASE_URL + "/terms") }
            HelpItem(Lucide.Scale, stringResource(R.string.commercial_disclosure)) { onClose(); uri.openUri(BuildConfig.BASE_URL + "/legal-notice") }
            if (guest) {
                // .chat-menu-divider：上下 4.8、左右 8 的 1px 线。
                Box(Modifier.padding(horizontal = 8.dp, vertical = 4.8.dp).fillMaxWidth().height(1.dp).background(Sm.Border))
                HelpItem(
                    Lucide.Languages, stringResource(R.string.language),
                    value = AppLanguage.nativeName(showingLanguage()).orEmpty(), chevron = true, onClick = onLanguage,
                )
            }
        }
    }
}

@Composable
private fun HelpItem(icon: List<String>, text: String, value: String? = null, chevron: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.4.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 9.6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        LucideIcon(icon, 16.dp, Sm.Muted)
        Text(text, color = Sm.Text, fontSize = 14.sp, modifier = Modifier.weight(1f))
        value?.let { Text(it, color = Sm.Muted, fontSize = 13.sp) }
        if (chevron) LucideIcon(Lucide.ChevronRight, 15.dp, Sm.Muted)
    }
}
