import Foundation

/// iPhone / iPad / iPhone Duo 共用的窗口自适应布局规则（只看当前窗口可用宽度与状态，不看设备型号）。
/// 412×915 是单栏参考；宽到放得下常驻侧栏与详情两栏时并排显示，空间受限时退回单栏推入抽屉。
enum AdaptiveLayout {
    /// 与设置页（`SettingsScreen`）一致的分栏阈值：覆盖 iPad 竖/横屏（744pt 起）与展开的 iPhone Duo，
    /// 手机、折叠态 iPhone Duo 和较窄的 iPad 分屏维持单栏推入抽屉。
    static let sidebarDockMinWidth: Double = 720

    /// 常驻侧栏宽度（与设置页双栏左侧一致；720pt 窗口下详情栏仍有 440pt，高于 412pt 手机参考宽度）。
    static let dockedSidebarWidth: Double = 280

    /// 当前窗口是否适合常驻侧栏（幻灯片全屏放映期间始终收起侧栏，把整块屏幕让给放映画面）。
    static func supportsDockedSidebar(windowWidth: Double, presenting: Bool) -> Bool {
        !presenting && windowWidth.isFinite && windowWidth >= sidebarDockMinWidth
    }

    /// 详情栏的可用宽度：常驻侧栏展开时让出侧栏宽度，其余情况占满窗口。
    static func detailWidth(windowWidth: Double, docked: Bool, dockedVisible: Bool) -> Double {
        guard windowWidth.isFinite, windowWidth > 0 else { return 0 }
        if docked && dockedVisible {
            return max(0, windowWidth - dockedSidebarWidth)
        }
        return windowWidth
    }
}
