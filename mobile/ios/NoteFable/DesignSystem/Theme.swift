import SwiftUI

/// 设计令牌，逐项取自网页端 `src/app/globals.css`（:root 里的 --nf-* / --notion-*），和 Android 的 `ui/Theme.kt`（Sm）同名同值。
/// 网页只有浅色主题，所以 App 也只做浅色（Info.plist 的 UIUserInterfaceStyle = Light）。
/// 改这里之前先改网页；对照表见 docs/architecture/android-native.md。1pt = 网页 1 CSS px。
enum Sm {
    static let ink = Color(argb: 0xFF0C1730)            // --nf-ink：标题、主按钮
    static let inkHover = Color(argb: 0xFF1D2A47)       // --nf-ink-hover
    static let text = Color(argb: 0xFF37352F)           // --notion-text：正文
    static let muted = Color(argb: 0x9E37352F)          // --notion-muted rgba(55,53,47,.62)
    static let faint = Color(argb: 0x5C37352F)          // --notion-faint .36：占位符、禁用
    static let hover = Color(argb: 0x1437352F)          // --notion-hover .08
    static let active = Color(argb: 0x1F37352F)         // --notion-active .12
    static let border = Color(argb: 0x1737352F)         // --notion-border .09
    static let borderStrong = Color(argb: 0x2E37352F)   // --notion-border-strong .18
    static let sidebar = Color(argb: 0xFFF7F7F5)        // --notion-sidebar
    static let blue = Color(argb: 0xFF2383E2)           // --notion-blue / --nf-accent
    static let accentSoft = Color(argb: 0x1A2383E2)     // --nf-accent-soft .10
    static let accentLine = Color(argb: 0x732383E2)     // --nf-accent-line .45
    static let userBubble = Color(argb: 0xFFF3F5F9)     // --nf-user-bubble
    static let modelPill = Color(argb: 0xFFF1F1EF)      // .codex-model-trigger 背景
    static let sheetGrab = Color(argb: 0x3337352F)      // .model-sheet-grab
    static let codeBackground = Color(argb: 0xFFF7F6F3) // --notes-code-bg
    static let danger = Color(argb: 0xFFB91C1C)         // .is-danger
    static let composerShadow = Color(argb: 0x120C1730) // --nf-composer-shadow 的主阴影 .07
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
