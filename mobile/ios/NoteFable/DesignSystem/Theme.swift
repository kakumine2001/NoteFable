import SwiftUI
import UIKit

/// 设计令牌，逐项取自网页端 `src/app/globals.css`（:root 和 :root[data-theme="dark"] 里的 --nf-* / --notion-*），
/// 和 Android 的 `ui/Theme.kt`（Sm）同名同值。每个颜色有浅色、深色两个值，跟着所在界面的外观自己换
/// （`Color(light:dark:)` 包的是 UIKit 的动态颜色）：设置里的"外观"（Core 的 `AppThemeStore`）只管把窗口定成浅色、深色或跟随系统，
/// 用到 `Sm.*` 的视图不用知道现在是哪一种。只在一种外观下不同的零散颜色（代码块、提案的增删底色…）也用 `Color(light:dark:)` 写在用它的文件里。
/// 改这里之前先改网页；对照表见 docs/architecture/android-native.md。1pt = 网页 1 CSS px。
enum Sm {
    static let ink = Color(uiColor: SmUI.ink)                              // --nf-ink：标题、主按钮
    static let inkHover = Color(light: 0xFF1E293B, dark: 0xFFDBE4F0)       // --nf-ink-hover
    static let onInk = Color(light: 0xFFFFFFFF, dark: 0xFF0F172A)          // --nf-on-ink：墨色底上的字和图标
    static let text = Color(uiColor: SmUI.text)                            // --notion-text：正文
    static let muted = Color(uiColor: SmUI.muted)                          // --notion-muted .60 / 深色 .62
    static let faint = Color(light: 0x5C1C202A, dark: 0x61ECEDF0)          // --notion-faint .36 / .38：占位符、禁用
    static let hover = Color(light: 0x0E1C202A, dark: 0x0EFFFFFF)          // --notion-hover .055 / 白 .055
    static let active = Color(light: 0x181C202A, dark: 0x1AFFFFFF)         // --notion-active .095 / 白 .10
    static let border = Color(light: 0x141C202A, dark: 0x14FFFFFF)         // --notion-border .08 / 白 .08
    static let borderStrong = Color(light: 0x241C202A, dark: 0x26FFFFFF)   // --notion-border-strong .14 / 白 .15
    static let sidebar = Color(light: 0xFFF5F6F8, dark: 0xFF111215)        // --notion-sidebar
    static let blue = Color(uiColor: SmUI.blue)                            // --notion-blue / --nf-accent
    static let accentSoft = Color(light: 0x172563EB, dark: 0x2460A5FA)     // --nf-accent-soft .09 / .14
    static let accentLine = Color(light: 0x6B2563EB, dark: 0x8560A5FA)     // --nf-accent-line .42 / .52
    static let userBubble = Color(light: 0xFFF3F5F9, dark: 0xFF23262E)     // --nf-user-bubble
    static let modelPill = Color(light: 0xFFEFF1F5, dark: 0xFF25272F)      // --nf-model-pill：.codex-model-trigger 背景
    static let modelPillPressed = Color(light: 0xFFE6E9F0, dark: 0xFF25272F)
    static let sheetGrab = Color(light: 0x331C202A, dark: 0x3DFFFFFF)      // .model-sheet-grab .2 / 白 .24
    static let codeBackground = Color(light: 0xFFF7F6F3, dark: 0xFF1D1F25) // --notes-code-bg
    static let danger = Color(light: 0xFFDC2626, dark: 0xFFF87171)         // --nf-danger：.is-danger
    static let composerShadow = Color(light: 0x120F172A, dark: 0x70000000) // --nf-composer-shadow 的主阴影 .07 / 黑 .44

    // 侧栏选中行的卡片底色 + 页面类型语义色（与网页 globals.css / Android Theme.kt 同名同值）。
    static let activeRow = Color(light: 0xFFFFFFFF, dark: 0xFF22242C)
    static let kindNote = Color(light: 0xFF2563EB, dark: 0xFF60A5FA)
    static let kindNoteSoft = Color(light: 0x172563EB, dark: 0x2460A5FA)
    static let kindNoteBorder = Color(light: 0x332563EB, dark: 0x4760A5FA)
    static let kindSlides = Color(light: 0xFFD97706, dark: 0xFFFBBF24)
    static let kindSlidesSoft = Color(light: 0x1AD97706, dark: 0x24FBBF24)
    static let kindSlidesBorder = Color(light: 0x38D97706, dark: 0x47FBBF24)
    static let kindWhiteboard = Color(light: 0xFF7C3AED, dark: 0xFFA78BFA)
    static let kindWhiteboardSoft = Color(light: 0x177C3AED, dark: 0x24A78BFA)
    static let kindWhiteboardBorder = Color(light: 0x337C3AED, dark: 0x47A78BFA)
    static let kindFav = Color(light: 0xFFEAB308, dark: 0xFFFACC15)
    static let kindFavSoft = Color(light: 0x1FEAB308, dark: 0x29FACC15)

    // 通用控件（DesignSystem）用到的面、遮罩和阴影。
    static let background = Color(uiColor: SmUI.background)                // --notion-bg：聊天、笔记页面的底
    static let surface = Color(light: 0xFFFFFFFF, dark: 0xFF202228)        // --notion-surface：对话框、菜单、抽屉、卡片、输入框的底
    static let dialogScrim = Color(light: 0x330F0F0F, dark: 0x8F000000)    // .notes-dialog::backdrop rgba(15,15,15,.2) / 黑 .56
    static let sheetScrim = Color(light: 0x590F0F0F, dark: 0x8F000000)     // .model-sheet-backdrop rgba(15,15,15,.35) / 黑 .56
    static let panelShadow = Color(light: 0x1A0F172A, dark: 0x80000000)    // --notion-shadow
    static let panelRing = Color(light: 0x0F0F172A, dark: 0x14FFFFFF)      // --notion-shadow 的 0 0 0 1px
    static let menuShadow = Color(argb: 0x22000000)      // .chat-actions-menu 0 8px 32px #0002
    static let sheetShadow = Color(argb: 0x330F0F0F)     // .model-sheet 0 -8px 24px rgba(15,15,15,.2)
    static let primaryShadow = Color(argb: 0x1F0F172A)   // .sidebar-primary-action
    static let errorText = Color(light: 0xFF933B34, dark: 0xFFFCA5A5)       // --nf-error-text：.notion-error / .answer-menu-error 的字
    static let errorBackground = Color(light: 0xA6FFE2DD, dark: 0x29EF4444) // --nf-error-bg rgba(255,226,221,.65) / rgba(239,68,68,.16)
    static let focusRing = Color(argb: 0x292563EB)       // 设置里聚焦时外侧 3px 光圈
}

/// UIKit 的视图（输入框、可选中的回答文字、公式、WKWebView 的底）直接用的几个颜色：和 `Sm` 里同名的是同一个动态颜色。
enum SmUI {
    static let ink = UIColor(light: 0xFF0F172A, dark: 0xFFF1F5F9)
    static let text = UIColor(light: 0xFF1C202A, dark: 0xFFECEDF0)
    static let muted = UIColor(light: 0x991C202A, dark: 0x9EECEDF0)
    static let blue = UIColor(light: 0xFF2563EB, dark: 0xFF60A5FA)
    static let background = UIColor(light: 0xFFFFFFFF, dark: 0xFF17181C)
}

/// 页面类型的语义色（与网页 --kind-* 和 Android pageKindColor/Soft/Border 同步）。
func pageKindColor(_ kind: PageKind) -> Color {
    switch kind {
    case .note: Sm.kindNote
    case .slides: Sm.kindSlides
    case .whiteboard: Sm.kindWhiteboard
    }
}

func pageKindSoft(_ kind: PageKind) -> Color {
    switch kind {
    case .note: Sm.kindNoteSoft
    case .slides: Sm.kindSlidesSoft
    case .whiteboard: Sm.kindWhiteboardSoft
    }
}

func pageKindBorder(_ kind: PageKind) -> Color {
    switch kind {
    case .note: Sm.kindNoteBorder
    case .slides: Sm.kindSlidesBorder
    case .whiteboard: Sm.kindWhiteboardBorder
    }
}

extension Color {
    /// 0xAARRGGBB，和 Android `Color(0x…)` 的写法相同，方便对照。
    init(argb: UInt32) {
        self.init(
            .sRGB,
            red: Double((argb >> 16) & 0xFF) / 255,
            green: Double((argb >> 8) & 0xFF) / 255,
            blue: Double(argb & 0xFF) / 255,
            opacity: Double((argb >> 24) & 0xFF) / 255
        )
    }

    /// 浅色、深色各一个值（0xAARRGGBB）：跟着所在界面的外观换，外观变了自己重画。
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor(light: light, dark: dark))
    }
}

extension UIColor {
    /// 0xAARRGGBB。
    convenience init(argb: UInt32) {
        self.init(
            red: CGFloat((argb >> 16) & 0xFF) / 255,
            green: CGFloat((argb >> 8) & 0xFF) / 255,
            blue: CGFloat(argb & 0xFF) / 255,
            alpha: CGFloat((argb >> 24) & 0xFF) / 255
        )
    }

    /// 浅色、深色各一个值的动态颜色。
    convenience init(light: UInt32, dark: UInt32) {
        self.init(dynamicProvider: { traits in
            UIColor(argb: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension Font {
    /// 网页字体栈在 iOS 上落到系统字体（SF + 苹方 / ヒラギノ）。`weight` 用 CSS 的数值（400、500、550、600、650、750）。
    static func nf(_ size: CGFloat, weight: Int = 400) -> Font {
        .system(size: size, weight: .css(weight))
    }

    /// 等宽（代码、角色标签；网页是 Geist Mono，这里用系统等宽）。
    static func nfMono(_ size: CGFloat, weight: Int = 400) -> Font {
        .system(size: size, weight: .css(weight), design: .monospaced)
    }
}

extension Font.Weight {
    /// CSS font-weight 数值 → 最接近的系统字重。
    static func css(_ value: Int) -> Font.Weight {
        switch value {
        case ..<350: return .light
        case ..<450: return .regular
        case ..<550: return .medium
        case ..<650: return .semibold
        case ..<750: return .bold
        default: return .heavy
        }
    }
}

extension Text {
    /// CSS 的 `font-size / line-height`：行高超出字体自然行高的部分平分到行间和上下。
    func nfLineHeight(_ lineHeight: CGFloat, fontSize: CGFloat) -> some View {
        let natural = fontSize * 1.193 // SF 的自然行高约为字号的 1.193 倍
        let extra = max(0, lineHeight - natural)
        return self.lineSpacing(extra).padding(.vertical, extra / 2)
    }
}
