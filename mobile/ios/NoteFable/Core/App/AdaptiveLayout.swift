import Foundation

/// iPhone / iPad / iPhone Duo 共用的窗口自适应布局规则（只看当前窗口可用尺寸与状态，不看设备型号）。
/// 412×915 是单栏参考；窗口宽高都放得下常驻侧栏与详情两栏时并排显示，空间受限时退回单栏推入抽屉。
enum AdaptiveLayout {
    /// 允许常驻侧栏与双栏并排的最小可用窗口宽度：覆盖展开态 iPhone Duo 竖屏（~669pt）、iPad 竖/横屏与较宽分屏，
    /// 让标准手机、折叠态 iPhone Duo 与较窄的 iPad 分屏保持单栏推入抽屉。
    static let sidebarDockMinWidth: Double = 640

    /// 允许常驻侧栏的最小窗口高度（含上下安全区，键盘升降不影响）：排除横屏手机（~393–440pt 高）与折叠态横屏 iPhone Duo（~466pt 高），
    /// 保留 iPad 与展开态 iPhone Duo（竖/横屏均 >= 600pt 高）。
    static let sidebarDockMinHeight: Double = 560

    /// 标准宽窗口（>= 720pt，如 iPad 与横屏展开的 iPhone Duo）的常驻侧栏宽度（与设置页双栏左侧一致）。
    static let dockedSidebarWidth: Double = 280

    /// 较紧的双栏窗口（640..<720pt，如竖屏展开的 iPhone Duo ~669pt）收窄至 260pt，给详情栏留出约 409pt 以上可读宽度。
    static let compactDockedSidebarWidth: Double = 260

    /// 启用标准 280pt 常驻侧栏宽度的窗口宽度阈值。
    static let standardSidebarMinWidth: Double = 720

    /// 当前窗口是否适合常驻侧栏（幻灯片全屏放映期间始终收起侧栏，把整块屏幕让给放映画面）。
    static func supportsDockedSidebar(
        windowWidth: Double,
        windowHeight: Double,
        presenting: Bool
    ) -> Bool {
        !presenting
            && windowWidth.isFinite && windowHeight.isFinite
            && windowWidth >= sidebarDockMinWidth
            && windowHeight >= sidebarDockMinHeight
    }

    /// 按当前可用窗口宽度返回常驻侧栏宽度。
    static func sidebarWidth(forWindowWidth windowWidth: Double) -> Double {
        guard windowWidth.isFinite else { return dockedSidebarWidth }
        return windowWidth >= standardSidebarMinWidth ? dockedSidebarWidth : compactDockedSidebarWidth
    }

    /// 详情栏的可用宽度：常驻侧栏展开时让出对应侧栏宽度，其余情况占满窗口。
    static func detailWidth(windowWidth: Double, docked: Bool, dockedVisible: Bool) -> Double {
        guard windowWidth.isFinite, windowWidth > 0 else { return 0 }
        if docked && dockedVisible {
            return max(0, windowWidth - sidebarWidth(forWindowWidth: windowWidth))
        }
        return windowWidth
    }
}
