import SwiftUI

/// 动画的时长和曲线，逐项取自网页的 CSS（`src/app/motion.css`、`globals.css`、`settings-dialog.css`），和 Android 端用的数值相同。
/// 系统打开“减弱动态效果”时不做装饰性的动画：各控件自己读 `\.accessibilityReduceMotion`，用 `NFMotion.unlessReduced` 取动画。
///
/// 用法：`withAnimation(NFMotion.easeOut(NFMotion.quick)) { … }`、`.animation(NFMotion.unlessReduced(NFMotion.press, reduceMotion), value: pressed)`。
enum NFMotion {
    /// `--dur-quick`：按下的手感、小的状态变化。
    static let quick: Double = 0.14
    /// `--dur-base`：底部抽屉、侧栏面板的进场。
    static let base: Double = 0.26

    /// `--ease-out` cubic-bezier(.23, 1, .32, 1)：快出、慢停，大多数动作用它。
    static func easeOut(_ duration: Double) -> Animation {
        .timingCurve(0.23, 1, 0.32, 1, duration: duration)
    }

    /// `--ease-spring` cubic-bezier(.34, 1.45, .64, 1)：稍微过头再停住，松手回弹用。
    static func spring(_ duration: Double) -> Animation {
        .timingCurve(0.34, 1.45, 0.64, 1, duration: duration)
    }

    /// CSS 关键字 `ease-out` = cubic-bezier(0, 0, .58, 1)（Android 的 `CssEaseOut`）。
    static func cssEaseOut(_ duration: Double) -> Animation {
        .timingCurve(0, 0, 0.58, 1, duration: duration)
    }

    /// CSS 关键字 `ease` = cubic-bezier(.25, .1, .25, 1)。
    static func cssEase(_ duration: Double) -> Animation {
        .timingCurve(0.25, 0.1, 0.25, 1, duration: duration)
    }

    /// 菜单、设置画面进场用的 cubic-bezier(.2, .8, .2, 1)（`.chat-row-menu`、`settings-enter`；Android 的 `SettingsEase`）。
    static func emphasized(_ duration: Double) -> Animation {
        .timingCurve(0.2, 0.8, 0.2, 1, duration: duration)
    }

    /// 按下时的缩放 / 底色：`transition: transform var(--dur-quick) var(--ease-out)`。
    static let press: Animation = easeOut(quick)

    /// 打开了“减弱动态效果”就不给动画。
    static func unlessReduced(_ animation: Animation, _ reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : animation
    }
}

/// 进场 / 退场用的过渡：位移 + 缩放 + 透明度（网页的 `model-sheet-up`、`motion-menu-enter`、`settings-slide` 都是这一类）。
struct NFRiseModifier: ViewModifier {
    var offsetY: CGFloat
    var scale: CGFloat
    var opacity: Double
    var anchor: UnitPoint = .center

    func body(content: Content) -> some View {
        content
            .scaleEffect(scale, anchor: anchor)
            .offset(y: offsetY)
            .opacity(opacity)
    }
}

extension AnyTransition {
    /// 从下方 `offsetY` 处（缩放 `scale`）淡入到原位；退场反过来。
    static func nfRise(offsetY: CGFloat, scale: CGFloat = 1, anchor: UnitPoint = .center) -> AnyTransition {
        .modifier(
            active: NFRiseModifier(offsetY: offsetY, scale: scale, opacity: 0, anchor: anchor),
            identity: NFRiseModifier(offsetY: 0, scale: 1, opacity: 1, anchor: anchor)
        )
    }
}
