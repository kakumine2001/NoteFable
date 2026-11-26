import Foundation
#if DEBUG
import Observation
#endif

/// 截图 / UI 自动化场景枚举（Debug 与 Release 均编译，Release 下不会激活）。
enum ScreenshotScene: String, CaseIterable, Sendable {
    case chatEmpty = "chat-empty"
    case chat
    case chatStreaming = "chat-streaming"
    case chatComposer = "chat-composer"
    case chatKeyboard = "chat-keyboard"
    case chatStreamed = "chat-streamed"
    case drawer
    case workspace
    case workspaceScrolled = "workspace-scrolled"
    case editor
    case editorScrolled = "editor-scrolled"
    case editorLocked = "editor-locked"
    case editorWhiteboard = "editor-whiteboard"
    case editorSlides = "editor-slides"
    case pageMenu = "page-menu"
    case search
    case modelSheet = "model-sheet"
    case attachSheet = "attach-sheet"
    case settings
    case settingsPlan = "settings-plan"
    case signIn = "sign-in"
    // #195 Phase 2a：内容从浮动栏下面滚过、玻璃菜单 / 选择器、提示条的位置。
    /// 京都聊天往上滚一段：消息在顶栏和输入栏下面，「滚到底部」按钮出现。
    case chatScrolled = "chat-scrolled"
    /// 京都聊天顶栏「…」菜单打开。
    case chatMenu = "chat-menu"
    /// 京都聊天的换图标选择器打开。
    case emojiPicker = "emoji-picker"
    /// 检索结果往上滚一段：结果在浮动的检索栏下面。
    case searchScrolled = "search-scrolled"
    /// 设置的「通用」页往上滚一段：内容在浮动的设置顶栏下面。
    case settingsPage = "settings-page"
    /// 京都聊天上显示一条提示条（量出来的输入栏上方位置）。
    case toast
}

#if DEBUG
@MainActor
@Observable
private final class ScreenshotDriver {
    var scene: ScreenshotScene?
    var sceneTick = 0
    var dismissTick = 0
}
#endif

/// 界面层可调用的只读钩子：在 Release 构建里全部折叠为常量 false / nil，避免界面文件直接引用 `#if DEBUG` 类型。
@MainActor
enum ScreenshotHooks {
    #if DEBUG
    private static let driver = ScreenshotDriver()
    private static var configured = false
    private static var configuredQuery: String?
    private static var configuredSolidChrome = false
    private static var consumedScenes: Set<ScreenshotScene> = []
    private static var readyScenes: Set<ScreenshotScene> = []

    static var isActive: Bool { configured }
    static var scene: ScreenshotScene? { configured ? driver.scene : nil }
    static var sceneTick: Int { driver.sceneTick }
    static var dismissTick: Int { driver.dismissTick }
    static var forceSolidChrome: Bool { configured && configuredSolidChrome }
    static var searchQuery: String? { configured ? configuredQuery : nil }

    static func configure(scene: ScreenshotScene, searchQuery: String?, forceSolidChrome: Bool) {
        configured = true
        driver.scene = scene
        driver.sceneTick += 1
        configuredQuery = searchQuery
        configuredSolidChrome = forceSolidChrome
        consumedScenes.removeAll()
        readyScenes.removeAll()
    }

    static func setScene(_ next: ScreenshotScene) {
        configured = true
        driver.scene = next
        consumedScenes.removeAll()
        readyScenes.removeAll()
        driver.sceneTick += 1
    }

    static func dismissOverlays() {
        driver.dismissTick += 1
    }

    static func consume(_ target: ScreenshotScene) -> Bool {
        guard configured, driver.scene == target, !consumedScenes.contains(target) else { return false }
        consumedScenes.insert(target)
        return true
    }

    static func markReady(_ target: ScreenshotScene) {
        guard configured else { return }
        readyScenes.insert(target)
    }

    static func isReady(_ target: ScreenshotScene) -> Bool {
        configured && readyScenes.contains(target)
    }
    #else
    static var isActive: Bool { false }
    static var scene: ScreenshotScene? { nil }
    static var sceneTick: Int { 0 }
    static var dismissTick: Int { 0 }
    static var forceSolidChrome: Bool { false }
    static var searchQuery: String? { nil }
    static func consume(_ target: ScreenshotScene) -> Bool { false }
    static func markReady(_ target: ScreenshotScene) {}
    static func isReady(_ target: ScreenshotScene) -> Bool { false }
    #endif
}
