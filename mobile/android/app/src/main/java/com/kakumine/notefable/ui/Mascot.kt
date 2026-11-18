package com.kakumine.notefable.ui

import android.provider.Settings
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
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.kakumine.notefable.data.CharacterCatalog
import com.kakumine.notefable.data.CharacterEye
import com.kakumine.notefable.data.CharacterId
import com.kakumine.notefable.data.CharacterPath
import com.kakumine.notefable.data.CharacterState
import com.kakumine.notefable.data.CharacterStatePose
import com.kakumine.notefable.data.ResolvedAppIcon
import com.kakumine.notefable.data.resolveAppIcon
import kotlin.math.min

private val EaseInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)
private val EaseOut = CubicBezierEasing(0f, 0f, 0.58f, 1f)
private val EnterEasing = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)

private class ParsedLayer(
    val path: Path,
    val fill: Color?,
    val stroke: Color?,
    val strokeStyle: Stroke?,
)

private sealed interface ParsedEye {
    val cx: Float
    val cy: Float
    val fill: Color

    class Capsule(
        val x: Float,
        val y: Float,
        val width: Float,
        val height: Float,
        val rx: Float,
        val rotation: Float,
        override val cx: Float,
        override val cy: Float,
        override val fill: Color,
    ) : ParsedEye

    class Polygon(
        val path: Path,
        override val cx: Float,
        override val cy: Float,
        override val fill: Color,
    ) : ParsedEye
}

private class ParsedCharacter(
    val backAccents: List<ParsedLayer>,
    val body: List<ParsedLayer>,
    val frontAccents: List<ParsedLayer>,
    val eyes: List<ParsedEye>,
)

private fun parseLayer(spec: CharacterPath): ParsedLayer {
    val path = PathParser().parsePathString(spec.d).toPath().apply {
        if (spec.evenOdd) fillType = PathFillType.EvenOdd
    }
    val strokeColor = spec.strokeArgb?.let(::Color)
    val strokeStyle = if (strokeColor != null && spec.strokeWidth > 0f) {
        val cap = when (spec.strokeCap) {
            "round" -> StrokeCap.Round
            "square" -> StrokeCap.Square
            else -> StrokeCap.Butt
        }
        val join = when (spec.strokeJoin) {
            "round" -> StrokeJoin.Round
            "bevel" -> StrokeJoin.Bevel
            else -> StrokeJoin.Miter
        }
        Stroke(width = spec.strokeWidth, cap = cap, join = join)
    } else null
    return ParsedLayer(path, spec.fillArgb?.let(::Color), strokeColor, strokeStyle)
}

private fun parseCharacter(characterId: CharacterId): ParsedCharacter {
    val spec = CharacterCatalog.spec(characterId)
    return ParsedCharacter(
        backAccents = spec.backAccentPaths.map(::parseLayer),
        body = spec.bodyPaths.map(::parseLayer),
        frontAccents = spec.frontAccentPaths.map(::parseLayer),
        eyes = spec.eyes.map { eye ->
            when (eye) {
                is CharacterEye.Capsule -> ParsedEye.Capsule(
                    x = eye.x, y = eye.y, width = eye.width, height = eye.height, rx = eye.rx,
                    rotation = eye.rotation, cx = eye.cx, cy = eye.cy, fill = Color(eye.fillArgb),
                )
                is CharacterEye.Polygon -> ParsedEye.Polygon(
                    path = PathParser().parsePathString(eye.d).toPath(),
                    cx = eye.cx, cy = eye.cy, fill = Color(eye.fillArgb),
                )
            }
        },
    )
}

private fun DrawScope.drawLayers(layers: List<ParsedLayer>, alpha: Float) {
    layers.forEach { layer ->
        layer.fill?.let { drawPath(layer.path, it, alpha = alpha) }
        if (layer.stroke != null && layer.strokeStyle != null) {
            drawPath(layer.path, layer.stroke, alpha = alpha, style = layer.strokeStyle)
        }
    }
}

@Composable
private fun rememberReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        runCatching {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)
    }
}

@Composable
private fun rememberLifecycleResumed(): Boolean {
    val owner = LocalLifecycleOwner.current
    var resumed by remember(owner) { mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, _ ->
            resumed = owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    return resumed
}

/**
 * 官方 AI 角色矢量绘制与语义状态动画（网页 src/components/character-avatar.tsx）。
 * - 遵循系统无障碍降低动画设置（ANIMATOR_DURATION_SCALE == 0 时静止）；
 * - 页面/应用进入后台或 state == Hidden 时停止无限动画，不空耗电量；
 * - Completed 与 Error 均为单次克制动作，绝不循环抖动。
 */
@Composable
fun CharacterGraphic(
    characterId: CharacterId,
    size: Dp,
    state: CharacterState = CharacterState.Idle,
    hero: Boolean = false,
    animated: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val spec = remember(characterId) { CharacterCatalog.spec(characterId) }
    val parsed = remember(characterId) { parseCharacter(characterId) }
    val reducedMotion = rememberReducedMotion()
    val lifecycleActive = rememberLifecycleResumed()
    val live = animated && !reducedMotion && lifecycleActive && state != CharacterState.Hidden
    val m = spec.motion

    val enter = remember(hero) { Animatable(if (hero && !reducedMotion) 0f else 1f) }
    LaunchedEffect(hero, reducedMotion) {
        if (hero && !reducedMotion && enter.value < 1f) {
            enter.animateTo(1f, tween(560, delayMillis = 80, easing = EnterEasing))
        } else {
            enter.snapTo(1f)
        }
    }

    // One-shot feedback animations for Completed and Error (never infinite).
    val burst = remember { Animatable(0f) }
    LaunchedEffect(state, live) {
        if (!live) {
            burst.snapTo(0f)
            return@LaunchedEffect
        }
        when (state) {
            CharacterState.Completed -> {
                burst.snapTo(0f)
                burst.animateTo(1f, tween(540, easing = EaseOut))
                burst.snapTo(0f)
            }
            CharacterState.Error -> {
                burst.snapTo(0f)
                burst.animateTo(1f, tween(600, easing = EaseOut))
                burst.snapTo(0f)
            }
            else -> burst.snapTo(0f)
        }
    }

    val typingProgress by animateFloatAsState(
        targetValue = if (state == CharacterState.Typing && !reducedMotion) 1f else 0f,
        animationSpec = tween(160, easing = EaseOut),
        label = "char-typing",
    )

    // Only allocate an InfiniteTransition when actively animating an ongoing state.
    val needsLoop = live && (state == CharacterState.Idle || state == CharacterState.Typing ||
        state == CharacterState.Thinking || state == CharacterState.Responding)

    val floatPhase: Float
    val blinkScale: Float
    val idleAccentWave: Float
    val thinkPhase: Float
    val respondPhase: Float

    if (needsLoop) {
        val loop = rememberInfiniteTransition(label = "char-loop")
        val halfFloat = (m.floatDurationMs / 2).coerceAtLeast(900)
        val f by loop.animateFloat(
            0f, 1f,
            infiniteRepeatable(tween(halfFloat, easing = EaseInOut), RepeatMode.Reverse, StartOffset(500)),
            label = "char-float",
        )
        val b by loop.animateFloat(
            1f, 1f,
            infiniteRepeatable(
                keyframes {
                    durationMillis = 5600
                    1f at 0
                    0.12f at 101
                    1f at 202
                    1f at 2912
                    0.12f at 3013
                    1f at 3114
                    0.12f at 3214
                    1f at 3315
                },
                initialStartOffset = StartOffset(1500),
            ),
            label = "char-blink",
        )
        val a by loop.animateFloat(
            0f, 0f,
            infiniteRepeatable(
                keyframes {
                    durationMillis = 6400
                    0f at 0
                    1f at 192
                    -0.3f at 384
                    0.45f at 512
                    0f at 640
                },
                initialStartOffset = StartOffset(1800),
            ),
            label = "char-accent",
        )
        val th by loop.animateFloat(
            -1f, 1f,
            infiniteRepeatable(tween(1300, easing = EaseInOut), RepeatMode.Reverse),
            label = "char-think",
        )
        val rp by loop.animateFloat(
            0f, 1f,
            infiniteRepeatable(tween(950, easing = EaseInOut), RepeatMode.Reverse),
            label = "char-respond",
        )
        floatPhase = f
        blinkScale = b
        idleAccentWave = a
        thinkPhase = th
        respondPhase = rp
    } else {
        floatPhase = 0f
        blinkScale = 1f
        idleAccentWave = 0f
        thinkPhase = 0f
        respondPhase = 0f
    }

    val burstBell = if (burst.value <= 0.4f) burst.value / 0.4f else (1f - burst.value) / 0.6f
    val pose = computeCharacterDrawPose(
        characterId = characterId,
        state = state,
        hero = hero,
        reducedMotion = reducedMotion,
        live = live,
        floatPhase = floatPhase,
        blinkScale = blinkScale,
        idleAccentWave = idleAccentWave,
        typingProgress = typingProgress,
        thinkPhase = thinkPhase,
        respondPhase = respondPhase,
        burstBell = burstBell,
    )

    val canvasHeight = if (hero) size * 1.0625f else size
    Canvas(modifier.size(size, canvasHeight)) {
        val viewX = if (hero) CharacterCatalog.HERO_VIEW_X else CharacterCatalog.ICON_VIEW_X
        val viewY = if (hero) CharacterCatalog.HERO_VIEW_Y else CharacterCatalog.ICON_VIEW_Y
        val viewW = if (hero) CharacterCatalog.HERO_VIEW_W else CharacterCatalog.ICON_VIEW_W
        val viewH = if (hero) CharacterCatalog.HERO_VIEW_H else CharacterCatalog.ICON_VIEW_H

        val s = min(this.size.width / viewW, this.size.height / viewH)
        val padX = (this.size.width - viewW * s) / 2f
        val padY = (this.size.height - viewH * s) / 2f

        translate(left = padX, top = padY) {
            scale(s, pivot = Offset.Zero) {
                translate(left = -viewX, top = -viewY) {
                    val alpha = enter.value.coerceIn(0f, 1f)
                    if (hero) {
                        val shadowFactor = if (live && state == CharacterState.Idle) floatPhase else 0f
                        val rx = spec.shadowRx * (1f - 0.16f * shadowFactor)
                        drawOval(
                            color = Sm.Ink.copy(alpha = (0.1f - 0.04f * shadowFactor) * alpha),
                            topLeft = Offset(120f - rx, 218.5f),
                            size = Size(rx * 2f, 15f),
                        )
                    }

                    val enterScale = if (hero) 0.62f + 0.38f * enter.value else 1f
                    val enterOffsetY = if (hero) 34f * (1f - enter.value) else 0f
                    val accentPivot = Offset(spec.accentPivotX, spec.accentPivotY)

                    translate(top = enterOffsetY + pose.bodyOffsetY) {
                        scale(enterScale, pivot = Offset(120f, 206f)) {
                            scale(pose.bodyScale, pivot = Offset(120f, 195f)) {
                                rotate(pose.bodyTiltDeg, pivot = Offset(120f, 195f)) {
                                    if (parsed.backAccents.isNotEmpty()) {
                                        rotate(pose.accentDeg, pivot = accentPivot) {
                                            drawLayers(parsed.backAccents, alpha)
                                        }
                                    }
                                    drawLayers(parsed.body, alpha)
                                    if (parsed.frontAccents.isNotEmpty()) {
                                        rotate(pose.accentDeg, pivot = accentPivot) {
                                            drawLayers(parsed.frontAccents, alpha)
                                        }
                                    }
                                    translate(left = pose.gazeX, top = pose.gazeY) {
                                        parsed.eyes.forEach { eye ->
                                            scale(scaleX = 1f, scaleY = pose.eyeScaleY, pivot = Offset(eye.cx, eye.cy)) {
                                                when (eye) {
                                                    is ParsedEye.Capsule -> {
                                                        rotate(eye.rotation, pivot = Offset(eye.cx, eye.cy)) {
                                                            drawRoundRect(
                                                                color = eye.fill,
                                                                topLeft = Offset(eye.x, eye.y),
                                                                size = Size(eye.width, eye.height),
                                                                cornerRadius = CornerRadius(eye.rx, eye.rx),
                                                                alpha = alpha,
                                                            )
                                                        }
                                                    }
                                                    is ParsedEye.Polygon -> drawPath(eye.path, eye.fill, alpha = alpha)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * 计算当前绘制帧的角色姿态：
 * - 系统降低动画（ANIMATOR_DURATION_SCALE == 0）或非实时动画态时，使用 [CharacterCatalog.pose] 的静态语义姿态，
 *   让 Typing / Thinking / Responding / Completed / Error 在无动画下依然可清晰区分；
 * - Hidden 态统一归零静止。
 */
internal fun computeCharacterDrawPose(
    characterId: CharacterId,
    state: CharacterState,
    hero: Boolean,
    reducedMotion: Boolean,
    live: Boolean,
    floatPhase: Float = 0f,
    blinkScale: Float = 1f,
    idleAccentWave: Float = 0f,
    typingProgress: Float = 0f,
    thinkPhase: Float = 0f,
    respondPhase: Float = 0f,
    burstBell: Float = 0f,
): CharacterStatePose {
    if (state == CharacterState.Hidden) {
        return CharacterCatalog.pose(characterId, CharacterState.Hidden)
    }
    if (reducedMotion || !live) {
        return CharacterCatalog.pose(characterId, state)
    }
    val m = CharacterCatalog.spec(characterId).motion
    val floatScale = if (hero) 1f else 0.42f
    return when (state) {
        CharacterState.Idle -> CharacterStatePose(
            bodyOffsetY = -m.floatAmplitude * floatScale * floatPhase,
            bodyTiltDeg = m.idleBodyTiltDeg * floatPhase,
            bodyScale = 1f,
            accentDeg = m.idleAccentDeg * idleAccentWave,
            gazeX = 0f,
            gazeY = 0f,
            eyeScaleY = blinkScale,
        )
        CharacterState.Typing -> CharacterStatePose(
            bodyOffsetY = 1.5f * typingProgress,
            bodyTiltDeg = m.typingTiltDeg * typingProgress,
            bodyScale = 1f,
            accentDeg = m.typingAccentDeg * typingProgress,
            gazeX = 0f,
            gazeY = m.typingGazeY * typingProgress,
            eyeScaleY = blinkScale,
        )
        CharacterState.Thinking -> CharacterStatePose(
            bodyOffsetY = -4f + 2f * thinkPhase,
            bodyTiltDeg = m.thinkingTiltDeg * thinkPhase,
            bodyScale = 1f,
            accentDeg = m.thinkingAccentDeg * (0.25f + 0.75f * kotlin.math.abs(thinkPhase)),
            gazeX = m.thinkingGazeX * thinkPhase,
            gazeY = -2.8f,
            eyeScaleY = 1f,
        )
        CharacterState.Responding -> CharacterStatePose(
            bodyOffsetY = -3.5f * respondPhase,
            bodyTiltDeg = m.respondingTiltDeg * respondPhase,
            bodyScale = 1f + 0.015f * respondPhase,
            accentDeg = m.respondingAccentDeg * respondPhase,
            gazeX = 0f,
            gazeY = 1.5f * respondPhase,
            eyeScaleY = blinkScale,
        )
        CharacterState.Completed -> CharacterStatePose(
            bodyOffsetY = m.completedNodY * (if (hero) 1f else 0.65f) * burstBell,
            bodyTiltDeg = 0f,
            bodyScale = 1f + 0.02f * burstBell,
            accentDeg = m.completedAccentDeg * burstBell,
            gazeX = 0f,
            gazeY = 0f,
            eyeScaleY = 1f - 0.65f * burstBell,
        )
        CharacterState.Error -> CharacterStatePose(
            bodyOffsetY = m.errorDropY * (if (hero) 1f else 0.65f) * burstBell,
            bodyTiltDeg = m.errorTiltDeg * burstBell,
            bodyScale = 1f - 0.015f * burstBell,
            accentDeg = m.errorAccentDeg * burstBell,
            gazeX = 0f,
            gazeY = 5f * burstBell,
            eyeScaleY = 1f - 0.18f * burstBell,
        )
        CharacterState.Hidden -> CharacterCatalog.pose(characterId, CharacterState.Hidden)
    }
}

/**
 * 空白聊天首页的主视觉角色（网页 src/components/mascot.tsx）：
 * 展示用户选择的官方角色（默认 Quill）或自定义上传图片，跟随真实聊天状态反馈。
 */
@Composable
fun Mascot(
    lookDown: Boolean = false,
    state: CharacterState? = null,
    modifier: Modifier = Modifier,
) {
    val resolved = resolveAppIcon(currentAppIcon())
    val effectiveState = state ?: if (lookDown) CharacterState.Typing else CharacterState.Idle

    when (resolved) {
        is ResolvedAppIcon.Image -> {
            val bitmap = rememberAppIconImage(resolved.dataUrl)
            if (bitmap != null) {
                Box(modifier.size(64.dp, 68.dp), Alignment.Center) {
                    val shape = RoundedCornerShape(percent = 22)
                    Image(
                        bitmap = bitmap,
                        contentDescription = null,
                        modifier = Modifier.size(60.dp).shadow(6.dp, shape).clip(shape),
                        contentScale = ContentScale.Crop,
                        filterQuality = FilterQuality.Medium,
                    )
                }
            } else {
                CharacterGraphic(
                    characterId = CharacterId.Default,
                    size = 64.dp,
                    state = effectiveState,
                    hero = true,
                    animated = true,
                    modifier = modifier,
                )
            }
        }
        is ResolvedAppIcon.Character -> {
            CharacterGraphic(
                characterId = resolved.characterId,
                size = 64.dp,
                state = effectiveState,
                hero = true,
                animated = true,
                modifier = modifier,
            )
        }
    }
}
