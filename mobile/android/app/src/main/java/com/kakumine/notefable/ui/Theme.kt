package com.kakumine.notefable.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.data.AppThemeStore
import com.kakumine.notefable.data.ThemePreference

/**
 * 设计令牌，逐项取自网页端 `src/app/globals.css`：浅色是 `:root`，深色是 `:root[data-theme="dark"]` 里的 --nf-* / --notion-*。
 * 改这里之前先改网页；对照表见 docs/architecture/android-native.md。界面里一律通过 [Sm] 读，不直接用这两份色板。
 */
data class SmPalette(
    val isDark: Boolean,
    val background: Color,     // --notion-bg：页面底色
    val surface: Color,        // --notion-surface：卡片、菜单、对话框、输入栏
    val ink: Color,            // --nf-ink：标题、主按钮
    val inkHover: Color,       // --nf-ink-hover
    val onInk: Color,          // --nf-on-ink：主按钮上的字和图标
    val text: Color,           // --notion-text：正文
    val muted: Color,          // --notion-muted
    val faint: Color,          // --notion-faint：占位符、禁用
    val hover: Color,          // --notion-hover
    val active: Color,         // --notion-active
    val border: Color,         // --notion-border
    val borderStrong: Color,   // --notion-border-strong
    val sidebar: Color,        // --notion-sidebar
    val blue: Color,           // --notion-blue / --nf-accent
    val accentSoft: Color,     // --nf-accent-soft
    val accentLine: Color,     // --nf-accent-line
    val userBubble: Color,     // --nf-user-bubble
    val modelPill: Color,      // --nf-model-pill（.codex-model-trigger 背景）
    val sheetGrab: Color,      // .model-sheet-grab
    val codeBackground: Color, // --notes-code-bg
    val danger: Color,         // --nf-danger（.is-danger / .notes-delete）
    val errorBg: Color,        // --nf-error-bg（.notion-error）
    val errorText: Color,      // --nf-error-text
    val composerShadow: Color, // --nf-composer-shadow 的主阴影
    val ring: Color,           // --notion-shadow 里那一圈 0 0 0 1px
    val scrim: Color?,         // 深色时对话框 / 底部面板的遮罩（.notes-dialog::backdrop、.model-sheet-backdrop）；浅色各处用自己的值
    val activeRow: Color,      // 侧栏选中行的卡片底色（浅色白面，深色 #242732）
    val sectionTitle: Color,   // --sidebar-section-ink：侧栏高对比度分区标题
    val tabMuted: Color,       // --sidebar-tab-muted：侧栏未激活标签 / 搜索与工具行文字
    val countBg: Color,        // --sidebar-count-bg：侧栏计数胶囊和默认图标徽章底色
    val countText: Color,      // --sidebar-count-text：侧栏计数胶囊文字
    val kindNote: Color,       // --kind-note
    val kindNoteSoft: Color,   // --kind-note-soft
    val kindNoteBorder: Color, // --kind-note-border
    val kindSlides: Color,       // --kind-slides
    val kindSlidesText: Color,   // --kind-slides-text（浅色下保证 >= 4.5:1 对比度）
    val kindSlidesSoft: Color,   // --kind-slides-soft
    val kindSlidesBorder: Color, // --kind-slides-border
    val kindWhiteboard: Color,       // --kind-whiteboard
    val kindWhiteboardSoft: Color,   // --kind-whiteboard-soft
    val kindWhiteboardBorder: Color, // --kind-whiteboard-border
    val kindFav: Color,        // --kind-fav
    val kindFavSoft: Color,    // --kind-fav-soft
)

val LightSmPalette = SmPalette(
    isDark = false,
    background = Color.White,
    surface = Color.White,
    ink = Color(0xFF0F172A),
    inkHover = Color(0xFF1E293B),
    onInk = Color.White,
    text = Color(0xFF1C202A),
    muted = Color(0x991C202A),          // rgba(28,32,42,.60)
    faint = Color(0x5C1C202A),          // .36
    hover = Color(0x0E1C202A),          // .055
    active = Color(0x181C202A),         // .095
    border = Color(0x141C202A),         // .08
    borderStrong = Color(0x241C202A),   // .14
    sidebar = Color(0xFFF5F6F8),
    blue = Color(0xFF2563EB),
    accentSoft = Color(0x172563EB),     // .09
    accentLine = Color(0x6B2563EB),     // .42
    userBubble = Color(0xFFF3F5F9),
    modelPill = Color(0xFFEFF1F5),
    sheetGrab = Color(0x331C202A),
    codeBackground = Color(0xFFF7F6F3),
    danger = Color(0xFFDC2626),
    errorBg = Color(0xA6FFE2DD),        // rgba(255,226,221,.65)
    errorText = Color(0xFF933B34),
    composerShadow = Color(0x120F172A), // rgba(15,23,42,.07)
    ring = Color(0x0F0F172A),           // rgba(15,23,42,.06)
    scrim = null,
    activeRow = Color.White,
    sectionTitle = Color(0xD61C202A),   // rgba(28,32,42,.84)
    tabMuted = Color(0xB81C202A),       // rgba(28,32,42,.72)
    countBg = Color(0x131C202A),        // rgba(28,32,42,.075)
    countText = Color(0xBD1C202A),      // rgba(28,32,42,.74)
    kindNote = Color(0xFF2563EB),
    kindNoteSoft = Color(0x172563EB),
    kindNoteBorder = Color(0x332563EB),
    kindSlides = Color(0xFFD97706),
    kindSlidesText = Color(0xFFA14908),
    kindSlidesSoft = Color(0x1AD97706),
    kindSlidesBorder = Color(0x38D97706),
    kindWhiteboard = Color(0xFF7C3AED),
    kindWhiteboardSoft = Color(0x177C3AED),
    kindWhiteboardBorder = Color(0x337C3AED),
    kindFav = Color(0xFFEAB308),
    kindFavSoft = Color(0x1FEAB308),
)

val DarkSmPalette = SmPalette(
    isDark = true,
    background = Color(0xFF17181C),
    surface = Color(0xFF202228),
    ink = Color(0xFFF1F5F9),
    inkHover = Color(0xFFDBE4F0),
    onInk = Color(0xFF0F172A),
    text = Color(0xFFECEDF0),
    muted = Color(0x9EECEDF0),          // rgba(236,237,240,.62)
    faint = Color(0x61ECEDF0),          // .38
    hover = Color(0x0EFFFFFF),          // rgba(255,255,255,.055)
    active = Color(0x1AFFFFFF),         // .10
    border = Color(0x14FFFFFF),         // .08
    borderStrong = Color(0x26FFFFFF),   // .15
    sidebar = Color(0xFF111215),
    blue = Color(0xFF60A5FA),
    accentSoft = Color(0x2460A5FA),     // .14
    accentLine = Color(0x8560A5FA),     // .52
    userBubble = Color(0xFF23262E),
    modelPill = Color(0xFF25272F),
    sheetGrab = Color(0x3DFFFFFF),      // rgba(255,255,255,.24)
    codeBackground = Color(0xFF1D1F25),
    danger = Color(0xFFF87171),
    errorBg = Color(0x29EF4444),        // rgba(239,68,68,.16)
    errorText = Color(0xFFFCA5A5),
    composerShadow = Color(0x70000000), // rgba(0,0,0,.44)
    ring = Color(0x14FFFFFF),           // rgba(255,255,255,.08)
    scrim = Color(0x8F000000),          // rgba(0,0,0,.56)
    activeRow = Color(0xFF242732),
    sectionTitle = Color(0xE0ECEDF0),   // rgba(236,237,240,.88)
    tabMuted = Color(0xBDECEDF0),       // rgba(236,237,240,.74)
    countBg = Color(0x17FFFFFF),        // rgba(255,255,255,.09)
    countText = Color(0xC7ECEDF0),      // rgba(236,237,240,.78)
    kindNote = Color(0xFF60A5FA),
    kindNoteSoft = Color(0x2460A5FA),
    kindNoteBorder = Color(0x4760A5FA),
    kindSlides = Color(0xFFFBBF24),
    kindSlidesText = Color(0xFFFBBF24),
    kindSlidesSoft = Color(0x24FBBF24),
    kindSlidesBorder = Color(0x47FBBF24),
    kindWhiteboard = Color(0xFFA78BFA),
    kindWhiteboardSoft = Color(0x24A78BFA),
    kindWhiteboardBorder = Color(0x47A78BFA),
    kindFav = Color(0xFFFACC15),
    kindFavSoft = Color(0x29FACC15),
)

/**
 * 当前主题的设计令牌。背后是 Compose 的快照状态，[NoteFableTheme] 切换浅色 / 深色时读过它的界面自动重组
 * （对话框、弹出菜单这些单独的组合也一样）。
 * 注意：不要把这里的颜色存进文件顶层的 `val`（只在类加载时读一次，之后不再跟着主题变），要写成 `get()` 或在组合里读。
 */
object Sm {
    internal var palette by mutableStateOf(LightSmPalette)

    val isDark: Boolean get() = palette.isDark
    val Background: Color get() = palette.background
    val Surface: Color get() = palette.surface
    val Ink: Color get() = palette.ink
    val InkHover: Color get() = palette.inkHover
    val OnInk: Color get() = palette.onInk
    val Text: Color get() = palette.text
    val Muted: Color get() = palette.muted
    val Faint: Color get() = palette.faint
    val Hover: Color get() = palette.hover
    val Active: Color get() = palette.active
    val Border: Color get() = palette.border
    val BorderStrong: Color get() = palette.borderStrong
    val Sidebar: Color get() = palette.sidebar
    val Blue: Color get() = palette.blue
    val AccentSoft: Color get() = palette.accentSoft
    val AccentLine: Color get() = palette.accentLine
    val UserBubble: Color get() = palette.userBubble
    val ModelPill: Color get() = palette.modelPill
    val SheetGrab: Color get() = palette.sheetGrab
    val CodeBackground: Color get() = palette.codeBackground
    val Danger: Color get() = palette.danger
    val ErrorBg: Color get() = palette.errorBg
    val ErrorText: Color get() = palette.errorText
    val ComposerShadow: Color get() = palette.composerShadow
    val Ring: Color get() = palette.ring
    val ActiveRow: Color get() = palette.activeRow
    val SectionTitle: Color get() = palette.sectionTitle
    val TabMuted: Color get() = palette.tabMuted
    val CountBg: Color get() = palette.countBg
    val CountText: Color get() = palette.countText
    val KindNote: Color get() = palette.kindNote
    val KindNoteSoft: Color get() = palette.kindNoteSoft
    val KindNoteBorder: Color get() = palette.kindNoteBorder
    val KindSlides: Color get() = palette.kindSlides
    val KindSlidesText: Color get() = palette.kindSlidesText
    val KindSlidesSoft: Color get() = palette.kindSlidesSoft
    val KindSlidesBorder: Color get() = palette.kindSlidesBorder
    val KindWhiteboard: Color get() = palette.kindWhiteboard
    val KindWhiteboardSoft: Color get() = palette.kindWhiteboardSoft
    val KindWhiteboardBorder: Color get() = palette.kindWhiteboardBorder
    val KindFav: Color get() = palette.kindFav
    val KindFavSoft: Color get() = palette.kindFavSoft

    /** 遮罩：浅色用各处网页原来的值 [light]，深色统一是 rgba(0,0,0,.56)。 */
    fun scrim(light: Color): Color = palette.scrim ?: light

    /** 只在深色时换成 [dark]（网页 `:root[data-theme="dark"]` 里单独覆盖的那些规则）。 */
    fun pick(light: Color, dark: Color): Color = if (palette.isDark) dark else light
}

/** 对话框窗口的遮罩浓度：.notes-dialog::backdrop 浅色 rgba(15,15,15,.2)，深色 rgba(0,0,0,.56)。 */
internal fun dialogDim(): Float = if (Sm.isDark) 0.56f else 0.2f

private fun materialScheme(p: SmPalette) = if (p.isDark) {
    darkColorScheme(
        primary = p.ink,
        onPrimary = p.onInk,
        secondary = p.blue,
        background = p.background,
        onBackground = p.text,
        surface = p.surface,
        onSurface = p.text,
        surfaceVariant = p.userBubble,
        onSurfaceVariant = p.muted,
        surfaceContainer = p.sidebar,
        surfaceContainerLow = p.surface,
        surfaceContainerHigh = p.hover,
        outline = p.borderStrong,
        outlineVariant = p.border,
        error = p.danger,
    )
} else {
    lightColorScheme(
        primary = p.ink,
        onPrimary = p.onInk,
        secondary = p.blue,
        background = p.background,
        onBackground = p.text,
        surface = p.surface,
        onSurface = p.text,
        surfaceVariant = p.userBubble,
        onSurfaceVariant = p.muted,
        surfaceContainer = p.sidebar,
        surfaceContainerLow = p.surface,
        surfaceContainerHigh = p.hover,
        outline = p.borderStrong,
        outlineVariant = p.border,
        error = p.danger,
    )
}

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

/** 外观设置的存储（App 级，只存在这台设备上）；预览等没有 App 的环境里是 null。 */
@Composable
internal fun appThemeStore(): AppThemeStore? = (LocalContext.current.applicationContext as? NoteFableApp)?.appTheme

/** 现在选的外观（跟随系统 / 浅色 / 深色）。 */
@Composable
internal fun currentThemePreference(): ThemePreference {
    val store = appThemeStore() ?: return ThemePreference.System
    val pref by store.preference.collectAsState()
    return pref
}

/** 现在实际是不是深色：选了"跟随系统"时看系统设置（系统切换时 Activity 的配置跟着变，这里随之重组）。 */
@Composable
internal fun isAppDarkTheme(): Boolean = currentThemePreference().resolveDark(isSystemInDarkTheme())

@Composable
fun NoteFableTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
    val palette = if (darkTheme) DarkSmPalette else LightSmPalette
    // 在内容组合之前换好，第一帧就是对的颜色。
    Sm.palette = palette
    MaterialTheme(colorScheme = materialScheme(palette), typography = NoTrackingTypography) {
        // 没写颜色的文字默认是黑色（不在 Surface / Scaffold 里时）；深色下要跟着正文色。对话框和弹出菜单继承这里的值。
        CompositionLocalProvider(LocalContentColor provides palette.text, content = content)
    }
}
