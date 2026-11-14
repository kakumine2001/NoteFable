package com.kakumine.studymate.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.studymate.R
import com.kakumine.studymate.data.UsageLimit
import com.kakumine.studymate.data.UsageLimits
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * 未登录用户撞到当日上限时，输入栏上方的登录提示（网页 src/components/guest-limit-prompt.tsx，样式在 globals.css 的
 * .guest-limit-*，412 宽手机下实测）：外框内边距 14/40/14/14、1px 蓝描边、圆角 12、浅蓝到浅黄的 135° 渐变 + 输入栏阴影，下距 12；
 * 左边 34 的蓝色圆角 10 图标框（Sparkles 18、描边 2.1、白）、间距 12；标题 15/600 行高 21 墨色；说明 13.5 / 20.925 灰，上距 2；
 * 按钮区上距 12、竖排、间距 8：Google 按钮高 44 全圆角、左右 16，"以后再说"13.5 灰居中；右上 8 处 28 的关闭键（✕ 16，浅灰，圆角 6）。
 * 和网页一样：只有服务端开了 Google 登录且还没登录时才显示（由调用方判断）；数值用 member 的上限。
 */
@Composable
fun GuestLimitPrompt(
    kind: String,
    attachmentsLost: Boolean,
    signInFailed: Boolean,
    signingIn: Boolean,
    onSignIn: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val limits = remember {
        runCatching { context.assets.open("usage-limits.json").use { UsageLimits.parse(it.readBytes().decodeToString()) }.member }
            .getOrDefault(UsageLimit(0, 0))
    }
    val motion = rememberGuestLimitMotion()
    val shape = RoundedCornerShape(12.dp)

    Box(
        modifier.fillMaxWidth().padding(bottom = 12.dp)
            .graphicsLayer {
                // 进场：从下方 14 处、缩放 .97 淡入（420ms）。
                alpha = motion.enter.value.coerceIn(0f, 1f)
                translationY = (1f - motion.enter.value) * 14.dp.toPx()
                val scale = 0.97f + 0.03f * motion.enter.value
                scaleX = scale
                scaleY = scale
            }
            .shadow(8.dp, shape, ambientColor = Sm.ComposerShadow, spotColor = Sm.ComposerShadow)
            .clip(shape)
            .background(Color.White)
            .drawBehind {
                // linear-gradient(135deg, --sm-accent-soft, rgba(255,226,122,.16))：按 CSS 的角度算渐变线的起止点。
                val d = 0.70710677f
                val half = (size.width + size.height) * d / 2f
                val c = Offset(size.width / 2f, size.height / 2f)
                drawRect(Brush.linearGradient(listOf(Sm.AccentSoft, Color(0x29FFE27A)), c - Offset(d, d) * half, c + Offset(d, d) * half))
            }
            .border(1.dp, Sm.AccentLine, shape)
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = 14.dp, top = 14.dp, bottom = 14.dp, end = 40.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(34.dp).graphicsLayer {
                    alpha = motion.iconAlpha()
                    val s = motion.iconScale()
                    scaleX = s
                    scaleY = s
                    rotationZ = motion.iconRotation()
                }.clip(RoundedCornerShape(10.dp)).background(Sm.Blue),
                Alignment.Center,
            ) {
                LucideIcon(Lucide.Sparkles, 18.dp, Color.White, strokeWidth = 2.1f)
            }
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(if (kind == "image") R.string.guest_limit_title_image else R.string.guest_limit_title_chat),
                    color = Sm.Ink, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold,
                )
                Text(
                    stringResource(R.string.guest_limit_body, limits.chat, limits.image),
                    Modifier.padding(top = 2.dp), color = Sm.Muted, fontSize = 13.5.sp, lineHeight = 20.925.sp,
                )
                if (attachmentsLost) {
                    Text(
                        stringResource(R.string.guest_limit_attachments_lost),
                        Modifier.padding(top = 2.dp), color = Sm.Muted, fontSize = 13.5.sp, lineHeight = 20.925.sp,
                    )
                }
                Column(Modifier.padding(top = 12.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    GuestLimitSignInButton(signInFailed, signingIn, motion, onSignIn)
                    Text(
                        stringResource(R.string.not_now),
                        Modifier.fillMaxWidth().clickable(onClick = onClose).semantics { role = Role.Button },
                        color = Sm.Muted, fontSize = 13.5.sp, lineHeight = 20.25.sp, textAlign = TextAlign.Center,
                    )
                }
            }
        }
        val closeLabel = stringResource(R.string.close)
        Box(
            Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 8.dp).size(28.dp).clip(RoundedCornerShape(6.dp))
                .clickable(onClick = onClose).semantics { contentDescription = closeLabel; role = Role.Button },
            Alignment.Center,
        ) {
            LucideIcon(Lucide.X, 16.dp, Sm.Faint)
        }
    }
}

// .google-signin-button.guest-limit-signin（手机）：高 44、全圆角、1px #747775、白底、左右 16、G 标志 18 + 10 + 15/500 字距 .25；
// 出现后一道浅蓝高光扫过一次，再向外扩两圈光晕。
@Composable
private fun GuestLimitSignInButton(failed: Boolean, busy: Boolean, motion: GuestLimitMotion, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(44.dp)
            .drawBehind {
                // box-shadow: 0 0 0 <0→10px> rgba(35,131,226,.35→0)
                val t = motion.halo.value
                if (t > 0f && t < 1f) {
                    val spread = 10.dp.toPx() * t
                    drawRoundRect(
                        Sm.Blue.copy(alpha = 0.35f * (1f - t)),
                        topLeft = Offset(-spread, -spread),
                        size = Size(size.width + 2 * spread, size.height + 2 * spread),
                        cornerRadius = CornerRadius(size.height / 2 + spread),
                    )
                }
            }
            .clip(CircleShape).background(Color.White).border(1.dp, Color(0xFF747775), CircleShape)
            .drawWithContent {
                drawContent()
                // ::after 的高光：linear-gradient(105deg, transparent 35%, rgba(35,131,226,.22) 50%, transparent 65%)，从 -120% 移到 120%。
                val x = motion.sheen.value * size.width
                val angle = Math.toRadians(105.0)
                val dx = kotlin.math.sin(angle).toFloat()
                val dy = -kotlin.math.cos(angle).toFloat()
                val len = abs(size.width * dx) + abs(size.height * dy)
                val c = Offset(size.width / 2f + x, size.height / 2f)
                val dir = Offset(dx, dy) / sqrt(dx * dx + dy * dy)
                drawRect(
                    Brush.linearGradient(
                        0.35f to Color.Transparent, 0.5f to Color(0x382383E2), 0.65f to Color.Transparent,
                        start = c - dir * (len / 2f), end = c + dir * (len / 2f),
                    ),
                )
            }
            .clickable(enabled = !busy, onClick = onClick).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
    ) {
        GoogleLogo(18.dp)
        Text(
            stringResource(if (failed) R.string.sign_in_failed else R.string.sign_in_google),
            color = Color(0xFF1F1F1F), fontSize = 15.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.25.sp,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 网页 @keyframes guest-limit-enter / pop / sheen / halo 的时间线（系统关掉动画时直接停在终点）。 */
private class GuestLimitMotion(
    val enter: Animatable<Float, AnimationVector1D>,
    val pop: Animatable<Float, AnimationVector1D>,
    val sheen: Animatable<Float, AnimationVector1D>,
    val halo: Animatable<Float, AnimationVector1D>,
) {
    // guest-limit-pop：0% 透明、缩放 .4、转 −20°；60% 不透明、1.12、6°；100% 原样。
    private fun segment(from: Float, mid: Float, to: Float): Float {
        val p = pop.value
        return if (p < 0.6f) from + (mid - from) * (p / 0.6f) else mid + (to - mid) * ((p - 0.6f) / 0.4f)
    }

    fun iconAlpha() = segment(0f, 1f, 1f).coerceIn(0f, 1f)
    fun iconScale() = segment(0.4f, 1.12f, 1f)
    fun iconRotation() = segment(-20f, 6f, 0f)
}

@Composable
private fun rememberGuestLimitMotion(): GuestLimitMotion {
    val context = LocalContext.current
    val reduced = remember {
        android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
    val motion = remember {
        GuestLimitMotion(
            Animatable(if (reduced) 1f else 0f),
            Animatable(if (reduced) 1f else 0f),
            Animatable(if (reduced) 1.2f else -1.2f),
            Animatable(0f),
        )
    }
    LaunchedEffect(Unit) {
        if (reduced) return@LaunchedEffect
        launch { motion.enter.animateTo(1f, tween(420, easing = CubicBezierEasing(0.2f, 0.9f, 0.3f, 1.15f))) }
        launch { motion.pop.animateTo(1f, tween(620, delayMillis = 180, easing = CubicBezierEasing(0.3f, 1.6f, 0.5f, 1f))) }
        launch { motion.sheen.animateTo(1.2f, tween(900, delayMillis = 520, easing = FastOutSlowInEasing)) }
        launch {
            kotlinx.coroutines.delay(700)
            repeat(2) {
                motion.halo.snapTo(0f)
                motion.halo.animateTo(1f, tween(1600, easing = CubicBezierEasing(0f, 0f, 0.58f, 1f)))
            }
            motion.halo.snapTo(0f)
        }
    }
    return motion
}
