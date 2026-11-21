# UI 层分工与接口（开发期间的临时约定，界面写完后并入 docs/architecture/ios-native.md 并删除）

所有界面都在 `NoteFable/Features/` 和 `NoteFable/App/`。依赖只从环境里取：

```swift
@Environment(AppEnvironment.self) private var app      // Core/App/AppEnvironment.swift：API、ViewModel、Store、systemText
@Environment(AppRouter.self) private var router        // Core/App/AppRouter.swift：抽屉、检索、设置、登录、打开笔记 / 聊天
```

根视图（Root 负责）注入这两个对象，并装好 `.nfOverlayHost().toastHost()`（DesignSystem 的对话框、菜单、底部抽屉、面板、提示都靠它）。

## 各部分对外提供的视图（签名固定，别人按这个调用）

| 归属 | 文件 | 接口 |
| --- | --- | --- |
| Chat | `Features/Chat/ChatWorkspace.swift` | `struct ChatWorkspace: View { init() }` 整个聊天界面（顶栏、消息、输入栏） |
| Answer | `Features/Chat/Answer/AssistantTurn.swift` | `struct AssistantTurn: View { init(message: UiMessage, sessionId: String?, isLatest: Bool) }` 一条回答 |
| Answer | `Features/Shared/RemoteImage.swift` | `struct RemoteImage: View { init(path: String, contentMode: ContentMode = .fill) }` 带 Cookie 读本站图片；`enum RemoteImageLoader { static func image(_ path: String, app: AppEnvironment) async -> UIImage? }` |
| Root | `App/NoteFableApp.swift`、`Features/Root/RootView.swift` | `@main`、抽屉、工作区切换、链接处理 |
| Root | `Features/Root/WorkspaceSwitch.swift` | `struct WorkspaceSwitch: View { init() }` Chat / Note 切换 |
| Root | `Features/Root/HelpMenuButton.swift` | `struct HelpMenuButton: View { init() }` |
| Root | `Features/Shared/ReorderDragUI.swift` | 长按拖动排序的手势与落点显示（基于 Core 的 `DragState` / `DropTarget`），聊天侧栏和笔记列表共用；Notes 等它写好后读它的接口 |
| Root | `Features/Search/SearchScreen.swift` | 由 Root 用 `.nfPanel(isPresented:)` 挂在根上；别处只调 `router.openSearch()` |
| Notes | `Features/Notes/NotesWorkspace.swift` | `struct NotesWorkspace: View { init() }` 笔记首页或编辑页（含各自顶栏） |
| Notes | `Features/Notes/NotesDrawerBody.swift` | `struct NotesDrawerBody: View { init() }` 抽屉里的笔记部分 |
| Account | `Features/Account/AccountRow.swift` | `struct AccountRow: View { init() }` 侧栏底部：未登录是“登录”按钮，登录后是账号行 |
| Account | `Features/Account/AccountOverlays.swift` | `extension View { func accountOverlays() -> some View }` 登录窗口（`router.signInOpen`）和设置（`router.settingsOpen`），Root 挂在根上 |
| Account | `Features/Account/LanguageMenu.swift` | `extension View { func languageMenu(isPresented: Binding<Bool>) -> some View }` 语言菜单（访客在帮助菜单里用，登录用户在设置里用） |
| Account | `Features/Account/GoogleSignInBridge.swift` | `enum GoogleSignInBridge { @MainActor static func install(into app: AppEnvironment); static func handle(_ url: URL) -> Bool }` |
| Account | `Features/Shared/EmojiPicker.swift` | `extension View { func emojiPicker(isPresented: Binding<Bool>, current: String?, onPick: @escaping (String?) -> Void) -> some View }`（挂在触发按钮上的浮动选择器，`nil` = 去掉图标）；`struct EmojiPickerBody: View { init(current: String?, height: CGFloat, onPick: @escaping (String?) -> Void) }`；`enum EmojiGlyphs { static func isSupported(_ emoji: String) -> Bool }` |

抽屉里的聊天部分（`ChatDrawerBody`）归 Root。顶栏的菜单按钮调 `router.openDrawer()`，搜索按钮调 `router.openSearch()`。
打开笔记用 `router.openNote(id)`，打开聊天用 `router.openChat(sessionId, messageId:)`。

需要别人负责的视图时：按上表的签名直接调用；表里没有的，等那个文件出现后读它的接口，不要自己另写一份。
