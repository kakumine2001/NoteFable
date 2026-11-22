package com.kakumine.notefable.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AccountUser

// 设置画面的共用部件（网页 src/components/settings-dialog.css 的手机宽度的值）：顶栏的圆形按钮、入口一览的账号行和各栏的行、
// 卡片、行、小按钮、"未保存的更改"条。

// 网页进场动画用的 cubic-bezier(0.2, 0.8, 0.2, 1)。
internal val SettingsEase = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

private val SettingsCardShape = RoundedCornerShape(20.dp)
private val UnsavedShadow = Color(0x470C1730) // 0 8px 28px rgba(12, 23, 48, .28)

/** 设置里聚焦 / 打开时外侧 3px 的光圈：0 0 0 3px rgba(35, 131, 226, .16)（.settings-select、textarea.settings-textarea）。 */
internal val SettingsFocusRing = Color(0x292383E2)

/**
 * 顶栏左边的圆形按钮（.settings-close / .settings-back，手机）：40×40、白底、1px 细线（--notion-border）、全圆角，
 * 图标是正文色（--notion-text）。一览上是"关闭"（X 18），页面上是"返回"（ArrowLeft 20，从右往左的语言里镜像）。
 */
@Composable
internal fun SettingsBarButton(icon: List<String>, iconSize: Dp, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.size(40.dp).clip(CircleShape).background(Sm.Surface).border(1.dp, Sm.Border, CircleShape)
            .clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        Alignment.Center,
    ) {
        LucideIcon(icon, iconSize, Sm.Text)
    }
}

/**
 * 入口一览最上面的账号行（.settings-card.settings-identity）：整张卡片可点，内边距 14×16、间距 14；头像 44；
 * 名字 17/600 墨色、一行、放不下省略；下面隔 2 是邮箱 14 灰（行高 1.5）、一行（没有邮箱或和名字一样时不出）；
 * 最右边 ChevronRight 18（--notion-faint，从右往左的语言里镜像）。点了进"账号"页。
 */
@Composable
internal fun SettingsIdentityRow(user: AccountUser, name: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier.fillMaxWidth().clip(SettingsCardShape).background(Sm.Surface).border(1.dp, Sm.Border, SettingsCardShape)
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        UserAvatar(user, 44.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(name, color = Sm.Ink, fontSize = 17.sp, lineHeight = 25.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            user.email?.takeIf { it.isNotEmpty() && it != name }?.let {
                Text(it, color = Sm.Muted, fontSize = 14.sp, lineHeight = 21.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        LucideIcon(Lucide.ChevronRight, 18.dp, Sm.Faint)
    }
}

/**
 * 入口一览里各栏的行（.settings-row.settings-row-button.settings-home-row）：最小高 56、内边距 10×16、间距 14；
 * 图标 20（正文色）、名字 16/500 占满中间、最右边 ChevronRight 18（--notion-faint，从右往左的语言里镜像）。
 * [divider]（第二行起）：行的上边一条 1px 细线，从起始边 50 处（名字的左端，不画到图标下面）到结束边；
 * 和网页的 ::before 一样是盖在行上的，不占高度。
 */
@Composable
internal fun SettingsHomeRow(icon: List<String>, label: String, divider: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Row(
        modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick)
            .drawBehind {
                if (divider) {
                    val width = size.width - 50.dp.toPx()
                    drawRect(Sm.Border, topLeft = Offset(if (rtl) 0f else 50.dp.toPx(), 0f), size = Size(width, 1.dp.toPx()))
                }
            }
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        LucideIcon(icon, 20.dp, Sm.Text)
        Text(label, Modifier.weight(1f), color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium)
        LucideIcon(Lucide.ChevronRight, 18.dp, Sm.Faint)
    }
}

/** .settings-card（手机）：白底、1px 细线、圆角 20；padded 时内边距 16（.settings-card-padded）。行与行之间用 [SettingsRowDivider] 隔开。 */
@Composable
internal fun SettingsCard(padded: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(SettingsCardShape).background(Sm.Surface).border(1.dp, Sm.Border, SettingsCardShape)
            .then(if (padded) Modifier.padding(16.dp) else Modifier),
        content = content,
    )
}

/** 卡片里行之间的 1px 线（.settings-card > * + *）。 */
@Composable
internal fun SettingsRowDivider() = Box(Modifier.fillMaxWidth().height(1.dp).background(Sm.Border))

/**
 * .settings-row.settings-row-button（手机）：整行可点，最小高 56、内边距 10×16、图标 16（灰）+ 间距 12 + 16/500 的字；
 * danger 时图标和字都是红色；不可用时 0.55。
 */
@Composable
internal fun SettingsRowButton(icon: List<String>, label: String, enabled: Boolean, danger: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .alpha(if (enabled) 1f else 0.55f).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        LucideIcon(icon, 16.dp, if (danger) SettingsDanger else Sm.Muted)
        Text(label, color = if (danger) SettingsDanger else Sm.Text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
    }
}

/** .settings-chip（手机）：最小高 40、左右 14、1px 深描边、全圆角、白底，图标 14（灰）+ 间距 6.4 + 14/500 的字；不可用时 0.55。 */
@Composable
internal fun SettingsChip(icon: List<String>, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Row(
        modifier.heightIn(min = 40.dp).clip(CircleShape).background(Sm.Surface).border(1.dp, Sm.BorderStrong, CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).alpha(if (enabled) 1f else 0.55f).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.4.dp),
    ) {
        LucideIcon(icon, 14.dp, Sm.Muted)
        Text(label, color = Sm.Text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * .settings-unsaved（手机）："未保存的更改"条，改了自定义指令还没保存时浮在画面下方：最小高 52、内边距 8/8/8/16、圆角 14、
 * 墨色底、阴影；文字 14/500 白；"放弃"（白 .82）和"保存"（白底墨色字）最小高 40、左右 14、圆角 10、14/550，间距 8。
 * 出现时从下方 16 滑入（200ms）；[attention] 每变一次（没保存就想关）左右晃一下（360ms），并让读屏念出来。
 */
@Composable
internal fun UnsavedBar(attention: Int, busy: Boolean, onDiscard: () -> Unit, onSave: () -> Unit, modifier: Modifier = Modifier) {
    val enter = remember { Animatable(0f) }
    val shake = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(200, easing = SettingsEase)) }
    LaunchedEffect(attention) {
        if (attention == 0) return@LaunchedEffect
        shake.snapTo(0f)
        shake.animateTo(0f, keyframes {
            durationMillis = 360
            -6f at 72
            6f at 144
            -6f at 216
            6f at 288
        })
    }
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier.fillMaxWidth()
            .graphicsLayer {
                alpha = enter.value
                translationY = (1f - enter.value) * 16.dp.toPx()
                translationX = shake.value.dp.toPx()
            }
            .shadow(14.dp, shape, ambientColor = UnsavedShadow, spotColor = UnsavedShadow)
            .clip(shape).background(Sm.Ink)
            // 点在条上（文字、空白处）不要落到下面的行上（退出登录等）。
            .pointerInput(Unit) { detectTapGestures { } }
            .heightIn(min = 52.dp).padding(start = 16.dp, top = 8.dp, end = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            stringResource(R.string.settings_unsaved), color = Sm.OnInk, fontSize = 14.sp, fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f).then(if (attention > 0) Modifier.semantics { liveRegion = LiveRegionMode.Assertive } else Modifier),
        )
        UnsavedButton(stringResource(R.string.proposal_discard), enabled = !busy, filled = false, onClick = onDiscard)
        UnsavedButton(stringResource(if (busy) R.string.sb_saving else R.string.save), enabled = !busy, filled = true, onClick = onSave)
    }
}

@Composable
private fun UnsavedButton(label: String, enabled: Boolean, filled: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier.heightIn(min = 40.dp).clip(shape).then(if (filled) Modifier.background(Sm.OnInk) else Modifier)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).alpha(if (enabled) 1f else 0.6f).padding(horizontal = 14.dp),
        Alignment.Center,
    ) {
        Text(label, color = if (filled) Sm.Ink else Sm.OnInk.copy(alpha = 0.82f), fontSize = 14.sp, fontWeight = FontWeight(550), maxLines = 1)
    }
}
