package com.kakumine.studymate.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp

/**
 * 设计令牌，逐项取自网页端 `src/app/globals.css`（:root 里的 --sm-* / --notion-*）。
 * 网页只有浅色主题（没有 prefers-color-scheme），所以原生版也只做浅色，保持和网页一致。
 * 改这里之前先改网页；对照表见 docs/architecture/android-native.md。
 */
object Sm {
    val Ink = Color(0xFF0C1730)          // --sm-ink：标题、主按钮
    val InkHover = Color(0xFF1D2A47)     // --sm-ink-hover
    val Text = Color(0xFF37352F)         // --notion-text：正文
    val Muted = Color(0x9E37352F)        // --notion-muted rgba(55,53,47,.62)
    val Faint = Color(0x5C37352F)        // --notion-faint .36：占位符、禁用
    val Hover = Color(0x1437352F)        // --notion-hover .08
    val Active = Color(0x1F37352F)       // --notion-active .12
    val Border = Color(0x1737352F)       // --notion-border .09
    val BorderStrong = Color(0x2E37352F) // --notion-border-strong .18
    val Sidebar = Color(0xFFF7F7F5)      // --notion-sidebar
    val Blue = Color(0xFF2383E2)         // --notion-blue / --sm-accent
    val AccentSoft = Color(0x1A2383E2)   // --sm-accent-soft .10
    val AccentLine = Color(0x732383E2)   // --sm-accent-line .45
    val UserBubble = Color(0xFFF3F5F9)   // --sm-user-bubble
    val ModelPill = Color(0xFFF1F1EF)    // .codex-model-trigger 背景
    val SheetGrab = Color(0x3337352F)    // .model-sheet-grab
    val CodeBackground = Color(0xFFF7F6F3) // --notes-code-bg
    val Danger = Color(0xFFB91C1C)       // .is-danger
    val ComposerShadow = Color(0x120C1730) // --sm-composer-shadow 的主阴影 .07
}

private val Colors = lightColorScheme(
    primary = Sm.Ink,
    onPrimary = Color.White,
    secondary = Sm.Blue,
    background = Color.White,
    onBackground = Sm.Text,
    surface = Color.White,
    onSurface = Sm.Text,
    surfaceVariant = Sm.UserBubble,
    onSurfaceVariant = Sm.Muted,
    surfaceContainer = Sm.Sidebar,
    surfaceContainerLow = Color.White,
    surfaceContainerHigh = Sm.Hover,
    outline = Sm.BorderStrong,
    outlineVariant = Sm.Border,
    error = Sm.Danger,
)

// Material 默认字体样式带 0.1~0.5sp 的字距（bodyLarge 是 0.5sp），网页正文字距是 0。
// 不清零的话，所有没写字距的文字都会比网页宽，换行和截断位置也跟着变；需要字距的地方（标题、角色标签）自己写。
private val NoTrackingTypography = Typography().let { t ->
    fun TextStyle.flat() = copy(letterSpacing = 0.sp)
    Typography(
        displayLarge = t.displayLarge.flat(), displayMedium = t.displayMedium.flat(), displaySmall = t.displaySmall.flat(),
        headlineLarge = t.headlineLarge.flat(), headlineMedium = t.headlineMedium.flat(), headlineSmall = t.headlineSmall.flat(),
        titleLarge = t.titleLarge.flat(), titleMedium = t.titleMedium.flat(), titleSmall = t.titleSmall.flat(),
        bodyLarge = t.bodyLarge.flat(), bodyMedium = t.bodyMedium.flat(), bodySmall = t.bodySmall.flat(),
        labelLarge = t.labelLarge.flat(), labelMedium = t.labelMedium.flat(), labelSmall = t.labelSmall.flat(),
    )
}

@Composable
fun NoteFableTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Colors, typography = NoTrackingTypography, content = content)
}
