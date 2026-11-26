import Foundation

// 提示条（toast）离宿主底边留多少（Issue #195）。提示条画在一个盖满屏幕、不拦截触摸的独立窗口里，
// 所以要自己躲开键盘、标签栏和各标签页的悬浮底栏（聊天的输入框等）。各标签页量好的遮挡高度由界面层的
// `NFBottomChrome` 收集（`nfReportsBottomChrome`），这里只做计算，好在 Linux 容器里测试。

/// 提示条底边离宿主底边的距离。
/// - Parameters:
///   - keyboardInset: 宿主底部被键盘挡住的高度；键盘开着时优先躲键盘（上方留 12）。
///   - tabBarVisible: 标签栏是否显示。不显示时（全屏面板、打开的笔记）离底边 16。
///   - obstructionFromScreenBottom: 当前标签页量到的、从屏幕底边算起被标签栏和悬浮底栏盖住的高度；
///     还没量到时为 nil，沿用原来的固定 84。
///   - hostBottomGap: 宿主底边到屏幕底边的距离（宿主盖满屏幕时是 0）。
func toastBottomClearance(
    keyboardInset: CGFloat,
    tabBarVisible: Bool,
    obstructionFromScreenBottom: CGFloat?,
    hostBottomGap: CGFloat
) -> CGFloat {
    if keyboardInset > 0 { return keyboardInset + 12 }
    guard tabBarVisible else { return 16 }
    guard let obstruction = obstructionFromScreenBottom else { return 84 }
    return max(16, obstruction - hostBottomGap + 8)
}
