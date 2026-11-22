# 原生 iOS 界面（Swift / SwiftUI）

> 目录：`mobile/ios/`。Bundle ID `com.kakumine.notefable`，最低 iOS 17，只支持 iPhone 竖屏。PR 检查、TestFlight 自动上传和签名见 [ios.md](ios.md)；目录约定和本机命令见 [mobile/ios/README.md](../../mobile/ios/README.md)。

## 定位

iOS 客户端是 Android 客户端（[android-native.md](android-native.md)）的对照移植，两端是同一套行为：

- 只通过服务器 API 工作（REST + SSE，默认主机 `https://app.notefable.com`），不改后端。模型列表来自 `GET /api/models`，读不到时用和 Android 共用的 `models.json`。
- 界面是网页手机视口（412×915）的复刻：尺寸、颜色、文案、动效时长都取自网页和 Android 代码里记的测量值（1pt = 1 CSS px），不自创设计。浅色、深色两套颜色分别取自网页的 `:root` 和 `:root[data-theme="dark"]`。
- 聊天、侧栏、搜索、笔记列表、设置是原生界面；笔记编辑器和 Android 一样用 WebView（`WKWebView`）加载 `/note-embed`。

**功能规则不在本文重复**：后台生成、附件、使用上限、回答导出、笔记、搜索跳转、头像等规则以 [android-native.md](android-native.md) 为准，本文只写 iOS 特有的结构和差异。改了其中一端的行为，另一端和网页要在同一个任务里一起改（见 `AGENTS.md`）。

## 现状

代码写完并通过了能做的检查，**还没有在真机或模拟器上运行过**：

| 部分 | 验证方式 | 状态 |
| --- | --- | --- |
| `Core/`（网络、接口、解析、ViewModel） | Linux 容器里 `swift test`，以及 CI 的 macOS `swift test` | 570 多项单元测试通过（大部分移植自 Android 的单元测试） |
| `DesignSystem/`、`Features/`、`App/`（SwiftUI / UIKit） | CI 的模拟器无签名构建（`ios-pr.yml`） | 能编译；界面效果、手势、键盘、WebView 交互未经人工验证 |

上线前还缺：

- **Apple Developer 账号**及 `appstore-publish` 环境的密钥（[ios.md](ios.md) 的启用清单）。没有它就不能签名，装不到真机，TestFlight 也不会上传。
- **真机验证**。第一次装机后要按 [android-native.md](android-native.md) 的各节逐项对照网页检查，预计会有一批界面细节要修。
- **Sign in with Apple**。App Store 审核规则 4.8 要求提供第三方登录（Google）的 App 同时提供一个等价的隐私登录方式；现在只有 Google 和邮箱验证码。上架前要么加 Sign in with Apple（后端要支持 Apple 账号关联，属于认证改动），要么确认邮箱验证码登录满足该条。
- **Google 登录的 iOS 客户端**。要在 Google Cloud 给 `com.kakumine.notefable` 登记 iOS OAuth 客户端，把客户端 ID 填进 `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_IOS_REVERSED_CLIENT_ID`；留空时登录窗口不显示 Google，只有邮箱验证码。服务端校验的 audience 仍是 Web 客户端 ID（`serverClientID`）。
- **购买**。iOS 没有接 App Store 内购，设置里的方案卡片只读（显示方案和用量，没有购买 / 管理按钮），已登录的免费用户撞到上限时也没有升级提示。
- **通用链接**。`Support/NoteFable.entitlements` 声明了 `applinks:app.notefable.com`，但网站还没有提供 `/.well-known/apple-app-site-association`，所以点网页链接暂时不会打开 App。

## 结构

```
mobile/ios/
  project.yml            XcodeGen 工程定义（版本号在这里；.xcodeproj 不进仓库）
  Package.swift          只用来单独编译、测试 Core
  Config/  Support/      xcconfig、Info.plist、entitlements
  scripts/               core-check.sh（Linux 容器里编译 / 测试 Core）、ci-core-tests.sh（CI 上跑 Core 测试）
  NoteFable/
    App/                 @main 入口
    Core/                不依赖 SwiftUI / UIKit：网络、接口、DTO、解析、ViewModel
    DesignSystem/        Sm 颜色、Lucide 图标、角色形象、按钮 / 对话框 / 菜单 / 底部抽屉 / 提示
    Features/            各界面（Root、Chat、Sidebar、Search、Notes、Account、Settings、Shared）
    Resources/           Assets.xcassets、17 种语言的 Localizable.strings
  Tests/NoteFableCoreTests/
```

分层规则：

- **Core 只 import Foundation**（加 `Observation` 和 swift-markdown，以及按 `#if canImport` 条件导入的 `CoreGraphics` / `FoundationNetworking`），所以能在没有 Mac 的机器上用 Linux 的 Swift 编译和测试。SwiftUI、UIKit、WebKit、Photos、GoogleSignIn 只出现在 `DesignSystem/`、`Features/`、`App/`。Core 需要平台能力的地方留接口，由界面层装上：Google 登录（`AppEnvironment.requestGoogleIdToken` ← `GoogleSignInBridge`）、表情字形判断（`emojiGlyphSupported` ← `EmojiGlyphs`）、笔记编辑器（`NoteEditorBridge` ← `NoteEditorWebView`）。
- **Core 的源码直接编进 App 模块**（不是单独的包），所以类型都是 internal；`Package.swift` 只是为了测试把同一批文件当成一个库来编译。
- **ViewModel** 是 `@MainActor @Observable final class`，状态是一个值类型（`ChatUiState`、`NotesUiState`…），依赖从初始化参数注入，时间用注入的 sleep / clock，所以测试不真等。
- **依赖装配**在 `Core/App/AppEnvironment.swift`（接口、ViewModel、各种 Store 都在这里创建一次），**导航**在 `Core/App/AppRouter.swift`（抽屉、搜索、设置、登录、打开笔记 / 聊天、处理外部链接）。界面只从环境里取这两个对象：

  ```swift
  @Environment(AppEnvironment.self) private var app
  @Environment(AppRouter.self) private var router
  ```

- **浮层**（对话框、菜单、底部抽屉、面板、提示）都画在根视图的 `.nfOverlayHost().toastHost()` 上，不用系统的 `.sheet` / `.alert`，这样外观和网页一致。层级是 面板 < 底部抽屉 < 对话框 < 菜单 < 提示。

### 和 Android 的对应

类型、函数、文件名尽量和 Kotlin 端相同，方便对照着改：

| Android（`mobile/android/app/src/main/java/com/kakumine/notefable/`） | iOS（`mobile/ios/NoteFable/`） |
| --- | --- |
| `data/NoteFableApi.kt`、`Dto.kt`、各 `*Api.kt` | `Core/API/`、`Core/Models/` |
| OkHttp + CookieJar | `Core/Networking/`：`URLSessionTransport`、`PersistentCookieJar`（Cookie 存在 Application Support 的 `cookies.json`）、`IdentityGate` |
| `ui/ChatViewModel.kt`、`NotesViewModel.kt`、`SidebarViewModel.kt`… | `Core/Chat/ViewModel/`、`Core/Notes/`、`Core/Sidebar/`、`Core/Search/`、`Core/Account/` |
| `ui/Theme.kt`（`Sm`）、`Lucide.kt`、`Mascot.kt` | `DesignSystem/` |
| `ui/NoteFableRoot.kt`、`MainActivity.kt` | `Features/Root/RootView.swift`、`App/NoteFableApp.swift` |
| `ui/ChatScreen.kt`、`AttachUi.kt`、`TurnActions.kt`… | `Features/Chat/` |
| `ui/AssistantTurn.kt`、`AnswerMarkdown.kt`、`ChatActivity.kt`… | `Features/Chat/Answer/` |
| `ui/NotesUi.kt`、`NoteEditor.kt`、`NotePageMenu.kt` | `Features/Notes/` |
| `ui/SettingsDialog.kt`、`AccountUi.kt`、`SignInDialog.kt`… | `Features/Settings/`、`Features/Account/` |
| `res/values*/strings*.xml` | `Resources/<语言>.lproj/Localizable.strings`（生成） |
| `assets/*.json` | 同一份文件，`project.yml` 直接引用 Android 的 `assets/` |

### iOS 上换了做法的地方

| 功能 | Android | iOS |
| --- | --- | --- |
| Markdown | multiplatform-markdown-renderer | swift-markdown 解析（`Core/Chat/MarkdownDocument.swift` 转成自己的块结构），界面逐块渲染，流式时只重画最后一块 |
| 数学公式 | latex-renderer + KaTeX 字体 | SwiftMath（`MTMathUILabel`）；行内公式渲染成图片按基线嵌进文字。认公式的规则（`MathMarkdown.prepare`）两端相同 |
| 回答里选字引用（“问 NoteFable”） | 自定义选择菜单 | 不可编辑的 `UITextView`，在系统选择菜单最前面加一项 |
| 输入框粘贴图片 | `BasicTextField` 的 `contentReceiver` | `UITextView` 子类重写 `paste` |
| 选文件 / 照片 / 拍照 | 系统选择器 | `PhotosPicker`、`fileImporter`、`UIImagePickerController` |
| 保存生成的图片 | MediaStore | `PHPhotoLibrary`（只申请“添加”权限） |
| 笔记编辑器 | `WebView` + `addJavascriptInterface` | `WKWebView` + `WKScriptMessageHandler`；用落盘的默认数据存储（网页的本地草稿和 Android 一样跨 App 重启保留），每次加载前把它的 Cookie 换成 App 的（所有编辑器排成一条链依次换） |
| 外观（跟随系统 / 浅色 / 深色） | `Sm` 按当前色板取值；偏好在 SharedPreferences `app_theme` 的 `theme` | `Sm.*` 和 `Color(light:dark:)` 是 UIKit 动态颜色，跟着所在界面的外观自己换（`DesignSystem/Theme.swift`；UIKit 视图用 `SmUI`）。偏好（`Core/Support/AppTheme.swift` 的 `AppThemeStore`）存在 UserDefaults 的 `app_theme.theme`；`NoteFableWindow` 用 `preferredColorScheme` 并把每个窗口的 `overrideUserInterfaceStyle` 定成浅色 / 深色，“跟随系统”时不指定。画成图片的公式按浅色、深色各画一张 |
| 编辑器的外观 | 地址的 `theme=`、`NoteFableNative.theme()`、`notefableEmbed.theme(value)` | 相同的三处（`NoteEmbedScripts.bootstrap` / `.theme`，`NoteEmbedBridge.pushTheme`）：只传算好的 `light` / `dark`，变了就地推送、`ready` 后再推一次。`WKWebView` 自己不画底（透明），网页画出来之前露出编辑页的底色，深色下不会先白一下 |
| 笔记导出 Markdown | SAF `CreateDocument` | 页面“…”菜单 → 先让网页保存（存不上就不导出）→ `GET /api/pages/:id/export` → 系统的“存储到文件”（`.fileExporter`，UTF-8 的 `.md`，与下载对话共用 `MarkdownExportDocument`）。规则在 `Core/Notes/NoteIO.swift` 和 `NotesViewModel.exportPage` |
| 笔记导入 Markdown | SAF `OpenMultipleDocuments` | `fileImporter`（可多选；`Features/Notes/NoteMarkdownIO.swift`）：带访问权限的地址逐个申请、用完就还，iCloud 里没下载的由 `NSFileCoordinator` 等它下载。发请求前按 20 个 / 每个 1 MiB / 合计 4 MiB / 扩展名查一遍（`noteImportProblem`），读完按实际字节数再查一遍；`POST /api/pages/import`（不带 `groupId`）后合并进列表并打开第一篇 |
| Google 登录 | Credential Manager | GoogleSignIn SDK |
| 返回键 | 系统返回键、预测性返回 | 没有返回键：抽屉、面板、编辑页用边缘滑动或各自的关闭按钮 |

### 和 Android 行为不同的地方

- **添加文件或照片**：iOS 没有合在一起的系统选择器，点了先出“照片图库 / 拍照 / 选取文件”三项，再打开对应的系统界面。
- **回答里选字**：一段一个文字视图，选区不能跨段；还在流式输出的回答不能选（用普通文字渲染，为了速度）。
- **下载会话**：用系统的“存储到文件”（`.fileExporter`）；下载途中 App 被杀不会像 Android 那样恢复。
- **保存生成的图片**：存进相册后只提示“已保存”，不打开图片。没有权限时提示去“设置”里允许。
- **笔记里的文件**：下载到临时目录后打开分享面板（存到“文件”或用别的 App 打开），不是直接存进下载目录。
- **撞到上限时的提示**：游客只有登录提示；已登录的免费用户不显示升级提示（Android 的 `UpgradeLimitPrompt` 没有移植）。
- **系统权限说明**（相机、存相册，`Info.plist`）目前只有英文，没有按语言的 `InfoPlist.strings`。
- **外观的入口**：只有“设置 → 通用”的“外观”一行（语言和图标之间，`Features/Settings/ThemeSettingsRowView.swift`），设置要登录后才能打开。帮助菜单里没有外观一项（Android 和网页的访客在那里选），所以未登录时一直跟随系统。偏好只存在这台设备上，不随账号同步。
- **表情选择器**在深色外观下仍是浅色的一块（和网页的 `Theme.LIGHT` 一样；Android 的跟着变深）。
- **启动画面的底色**（`LaunchBackground`）跟随系统的深浅，不看 App 里选的外观：选的和系统不一样时，启动瞬间的底色与进入后的界面不同。
- **导出笔记**：存好以后不另外提示；写入失败弹 “Could not export the page.” 的提示（Android 显示在笔记顶栏下面的提示条里）。导出、导入的其他错误和 Android 一样分别显示在编辑页顶栏下面和笔记的错误条里。

## 生成的文件

这些文件由脚本从 Android / 网页的源头生成，不手改。前三个有 vitest 测试，生成物过期时失败；`AppIcon-1024.png` 没有测试，改了 `src/app/icon.svg` 要自己重跑脚本。

| 文件 | 来源 | 脚本 |
| --- | --- | --- |
| `Resources/*.lproj/Localizable.strings` | Android 的 `res/values*/strings*.xml` | `npx tsx scripts/gen-ios-strings.ts` |
| `Core/Support/CharactersData.generated.swift` | `src/lib/characters.ts` | `npx tsx scripts/gen-ios-characters.ts` |
| `Tests/NoteFableCoreTests/Fixtures/search-fold-cases.json` | `src/lib/search-fold.ts` 的用例 | `npx tsx scripts/gen-native-search-fold-cases.ts` |
| `Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 角色 Quill | `npx tsx scripts/gen-ios-app-icon.ts` |

新文案的流程：先加到 Android 的 `res/values`（及 zh、ja），跑 Android 的生成脚本，再跑 `gen-ios-strings.ts`。iOS 里用 `L("键", 参数…)`，键就是 Android 的资源名。只有 iOS 才需要的文案（Android 交给系统界面的地方）写在 `scripts/ios-strings.ts` 的 `IOS_ONLY_STRINGS` 里，17 种语言都要写。

## 构建与验证

没有 Mac 时：

- Core：`docker run --rm -v "<仓库>/mobile/ios:/src:ro" -v "<仓库>/mobile/android/app/src/main/assets:/android-assets:ro" -v nf-ios-build:/build swift:6.1 bash /src/scripts/core-check.sh test`（和 Android 共用的 JSON 资源挂在 `/android-assets`；不挂的话读这些资源的测试会跳过）
- 界面层只能查语法：`swiftc -frontend -parse`（命令见 README）。**类型错误只有 CI 能发现**：改到 `mobile/ios/**` 的 PR 会在 `macos-26` 上跑 `swift test`、`xcodegen generate` 和模拟器无签名构建，失败时 “Compiler errors” 一步列出全部错误。macOS 机器按高倍率计分钟数，尽量攒够改动再推。

有 Mac 时：`brew install xcodegen && cd mobile/ios && xcodegen generate && open NoteFable.xcodeproj`。

发布：只在需要上传 TestFlight 的 PR 里调高 `project.yml` 的 `CURRENT_PROJECT_VERSION`（[ios.md](ios.md)）。
