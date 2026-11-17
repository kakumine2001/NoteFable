package com.kakumine.notefable.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

private val EaseInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)
private val EaseOut = CubicBezierEasing(0f, 0f, 0.58f, 1f)
private val EnterEasing = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)

// 空白首页的产品形象（网页 src/components/mascot.tsx + globals.css 的 .nf-mascot-*）：64 × 68，viewBox 0 0 64 68。
// 出场从下方弹起（560ms、延迟 80），之后上下浮动（4.2s 一个来回、2.5 个单位），脚下的影子跟着缩放；
// 眨眼 5.6s 一轮（一次单眨、一次连眨），折角 6.5s 抖一下。lookDown（输入框里有字）时眼睛往下看 2.4 个单位。
// 触屏没有指针位置，所以没有网页"眼睛跟着鼠标"那一部分。装饰用，不念出来。
@Composable
fun Mascot(lookDown: Boolean, modifier: Modifier = Modifier) {
    val body = remember { PathParser().parsePathString(MascotBody).toPath() }
    val flap = remember { PathParser().parsePathString(MascotFlap).toPath() }

    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(560, delayMillis = 80, easing = EnterEasing)) }

    val loop = rememberInfiniteTransition(label = "mascot")
    val float by loop.animateFloat(
        0f, 1f,
        infiniteRepeatable(tween(2100, easing = EaseInOut), RepeatMode.Reverse, StartOffset(700)),
        label = "mascot-float",
    )
    val blink by loop.animateFloat(
        1f, 1f,
        infiniteRepeatable(
            keyframes {
                durationMillis = 5600
                1f at 0
                0.1f at 101
                1f at 202
                1f at 2912
                0.1f at 3013
                1f at 3114
                0.1f at 3214
                1f at 3315
            },
            initialStartOffset = StartOffset(1600),
        ),
        label = "mascot-blink",
    )
    val flapAngle by loop.animateFloat(
        0f, 0f,
        infiniteRepeatable(
            keyframes {
                durationMillis = 6500
                0f at 0
                -10f at 162
                3f at 325
                -5f at 455
                0f at 585
            },
            initialStartOffset = StartOffset(2000),
        ),
        label = "mascot-flap",
    )
    val look by animateFloatAsState(if (lookDown) 2.4f else 0f, tween(140, easing = EaseOut), label = "mascot-look")

    Canvas(modifier.size(64.dp, 68.dp)) {
        scale(size.width / 64f, pivot = Offset.Zero) {
            // 影子：椭圆 cx 32 / cy 63.5 / rx 15 / ry 2.2，不透明度 .1 → .06、横向 1 → .82。
            val shadowRx = 15f * (1f - 0.18f * float)
            drawOval(
                Sm.Ink.copy(alpha = 0.1f - 0.04f * float),
                topLeft = Offset(32f - shadowRx, 61.3f),
                size = Size(shadowRx * 2f, 4.4f),
            )
            // 出场：不透明度 0 → 1，下移 10 → 0，以脚底中点（32, 55）为轴从 .6 放大到 1（缓动带回弹，会略超过 1）。
            val enterScale = 0.6f + 0.4f * enter.value
            val alpha = enter.value.coerceIn(0f, 1f)
            translate(top = 10f * (1f - enter.value) - 2.5f * float) {
                scale(enterScale, pivot = Offset(32f, 55f)) {
                    drawPath(body, Sm.Ink, alpha = alpha)
                    // 折角绕自己的左下角（39.5, 23.5）抖动。
                    rotate(flapAngle, pivot = Offset(39.5f, 23.5f)) { drawPath(flap, Sm.Ink, alpha = alpha) }
                    // 眼睛：5 × 9、圆角 2.5，眨眼时以各自中心（y = 37.5）压扁。
                    val eyeHeight = 9f * blink
                    for (x in floatArrayOf(22.5f, 36.5f)) {
                        drawRoundRect(
                            Color.White,
                            topLeft = Offset(x, 37.5f + look - eyeHeight / 2f),
                            size = Size(5f, eyeHeight),
                            cornerRadius = CornerRadius(2.5f, minOf(2.5f, eyeHeight / 2f)),
                            alpha = alpha,
                        )
                    }
                }
            }
        }
    }
}
