# 原生 iOS 界面（Swift / SwiftUI）

> 目录：`mobile/ios/`。Bundle ID `com.kakumine.notefable`，最低 iOS 17，只支持 iPhone 竖屏。PR 检查、TestFlight 自动上传和签名见 [ios.md](ios.md)；目录约定和本机命令见 [mobile/ios/README.md](../../mobile/ios/README.md)。

## 定位

iOS 客户端是 Android 客户端（[android-native.md](android-native.md)）的对照移植，两端是同一套行为（界面外壳按下面第二条走 iOS 原生）：

- 只通过服务器 API 工作（REST + SSE，默认主机 `https://app.notefable.com`），不改后端。模型列表来自 `GET /api/models`，读不到时用和 Android 共用的 `models.json`。
- 界面按三端分界（[android-native.md](android-native.md#三端一致与原生分界)）：功能范围、入口、17 种语言的文案和术语、数据与编辑器能力、品牌色和角色形象与网页 / Android 相同；材质、导航容器、手势、动效、弹层呈现按 iOS 原生。外壳正按 #195 分阶段升级为 iOS 26 的 Liquid Glass：Phase 0 已落地规则与 CI 模拟器截图基建；**Phase 1** 已落地 `DesignSystem/LiquidGlass.swift` 兼容层（iOS 26+ 使用 `.glassEffect(_:in:)` / `GlassEffectContainer` / `.safeAreaBar(edge:)`，iOS 17–18 退回 `.regularMaterial` / `.ultraThinMaterial` + `.safeAreaInset(edge:)`，“降低透明度”及调试开关 `nfForceSolidChrome` 通过 `Glass.identity` 保持视图身份并退回实色底）、双层原生导航（底部 3 标签 `TabView`：聊天 / 工作区 / 搜索，iOS 26 用 `role: .search`、iOS 27 用 `role: .prominent` 保持独立圆形玻璃按钮样式，编辑页和幻灯片放映中收起并附带 iOS 26 降低透明度下的 `UITabBarController` 显隐修复；交互式行首推入圆角合并抽屉，同时呈现聊天与工作区目录并配备底部悬浮玻璃操作栏；合并后去掉了顶栏与侧栏重复搜索入口和 `WorkspaceSwitch`）、以及系统 `.sheet` 底部弹层（模型 / 附件 / 回收站，利用 `onDismiss` 衔接后续弹窗）、跨 `TabView` 的 `@Observable NFOverlayCenter` 浮层宿主、不拦截触摸的独立 `UIWindow` 提示条，以及应用内切换阿拉伯语时的 UIKit 窗口级 `semanticContentAttribute` 同步（`AppDrawer`、`LucideShape` 保持 `.fixed` 避免双重镜像）。Phase 2–3 将继续完成聊天悬浮玻璃顶栏/输入栏、工作区筛选与编辑器玻璃控件。外壳以外的内容（消息、列表、卡片、对话框里的排版、字号、间距）仍取网页和 Android 代码里记的测量值（1pt = 1 CSS px），不自创设计。浅色、深色两套颜色分别取自网页的 `:root` 和 `:root[data-theme="dark"]`；玻璃只当底，不改品牌色。
- 聊天、侧栏、搜索、笔记列表、设置是原生界面；笔记编辑器和 Android 一样用 WebView（`WKWebView`）加载 `/note-embed`；桥消息（`EmbedMessage`）与 Android 相同，`openPage`（页面提及被点）走 `NotesViewModel.openNoteFromLink`。原生 → 网页的调用是 `Core/Notes/NoteEditor.swift` 的 `NoteEmbedScripts`（经 `NoteEditorBridge` ← `NoteEditorController` 执行）：`window.notefableEmbed` 的 `flush(requestId)` / `openHistory()` / `pageUpdated(page)` / `pageSettings(page)` / `appIcon(icon)` / `language(code)` / `theme(value)` / `reveal(id)`，约定见 `src/lib/native-bridge.ts`。页面图标是上传图片时（`Core/Models/Notes.swift` 的 `NoteIcons`），`NFIconTile` / `NoteIconGlyph` 用 `RemoteImage` 带 App 的 Cookie 读 `/api/pages/covers?key=`，和表情一样大、圆角 3；原生的图标选择器还只能选表情（**上传图片图标尚未实现**，编辑器里网页的选择器可以上传）。
- 编辑器里的分栏（`columnList` / `column`，见 [notes-flow.md](notes-flow.md)）由内嵌的网页编辑器处理，App 不读块的结构；手机宽度下栏竖着排，不能拖动调宽。
- 页面类型（笔记 / 白板 / 幻灯片）的行为和 Android 相同，规则见 [android-native.md](android-native.md) 的“页面类型”一条和 [notes-flow.md](notes-flow.md) 的“页面类型”。对应的代码：`Core/Models/Notes.swift` 的 `PageKind`（缺字段、null、不认识或不是字符串的值都按笔记）和 `PageKindTable`（`features` 是网页 `PAGE_KIND_FEATURES` 那张表：`GET /api/pages` 的 `kinds` 一到就换成它，之前用安装包里与 Android 共用的 `page-kinds.json`）、`pageKindLabel`，`OpenNote.kind`（`ready` 带来时以它为准），菜单的开关 `NotePageToggle.visible(for:)`，检索结果的类型名 `SearchHit.kindLabel`；默认图标 `pageKindIcon`（`DesignSystem/Lucide.swift` 的 `Lucide.shapes` / `Lucide.presentation`），经 `NFIconTile` 的 `fallback` 和 `NoteIconGlyph` 的 `kind`。单元测试：`PageKindTests`，`NotesViewModelTests` 和 `SVGPathDataTests` 里的类型 / 图标路径各一条。图标、“…”菜单、分享按钮、检索的类型名这些界面改动只经过语法检查和 CI 编译，没在模拟器或真机上看过。
- 白板（#152）：和笔记同一个 `WKWebView` 打开 `/note-embed?page=<id>`，网页显示白板编辑器，桥照旧。新建入口和分区见下面“分区与新建”一条。
  - **导出的文件**：bootstrap 声明 `canSaveFile()`，网页把白板的 PNG / SVG / PDF、幻灯片的 PDF / PNG / PPTX（多页的 PNG 是 ZIP）按 `fileStart` → `fileChunk` × n（512 KiB 以内的字节的 base64，`index` 从 0 起）→ `fileEnd` 送来，中途放弃发 `fileAbort`。`Core/Notes/ExportFile.swift` 的 `ExportFileAssembler` 拼成临时文件：只收这 5 种类型，最多 64 MiB 且要和声明的大小一致，块必须按顺序，一次一个（新的 `fileStart` 让没收完的作废），出错就删掉写了一半的；文件名去掉路径分隔符、控制字符和改变文字方向的字符，扩展名按类型，连扩展名 120 个字符以内。收齐后 `NotesUiState.exportFile` 交给编辑页的 `.fileExporter`（`ExportedFileDocument`，系统的“存储到文件”；iOS 17 的 `onCancellation` 接住取消）：存好提示 “File saved.”，存失败或文件收不下提示 “Could not save the file.”（`export_file_saved` / `export_file_failed`），取消不提示；结束后删掉临时文件。保存窗口开着时又拼好一个文件：新的不存、提示失败（同一时间只等一个保存位置，和 Android 一样）。网页进程崩溃重新加载时，拼了一半的作废。换了编辑器、换了身份时没收完和没存的都删掉，每次启动后第一次导出时清掉以前留下的。只收打开着的编辑器发来的。
  - **手势**：白板页（`PageKind.capturesEdgeSwipes`）关掉编辑页的边缘返回（`UIScreenEdgePanGestureRecognizer`，类型随 `ready` 改正时跟着开关），抽屉也不从屏幕边缘拉出（`NotesUiState.editorCapturesEdgeSwipes` → `AppDrawer` 的 `edgeOpens`）；离开用顶栏的“<”，抽屉用菜单键开、照常能推回去。`drawing` 消息收下不用。
  - **检索定位**（笔记和白板都用）：笔记结果的 `blockId` 经 `AppRouter.openNote` → `NotesViewModel.openNote(reveal:)`。要打开别的页面时存进 `OpenNote.reveal`，新编辑器第一次加载时在地址后加 `&reveal=`（`noteEmbedUrl`），网页滚到命中的块、白板移到命中的元素；网页进程崩溃后的重新加载不再带。命中的就是开着的那一篇时不保存、不重新加载，经注册的编辑器桥（`revealInEditor` → `NoteEmbedBridge.reveal` → `NoteEmbedScripts.reveal`）调 `notefableEmbed.reveal(id)` 就地定位；网页还没挂上编辑器时这一下什么也不做。
  - 单元测试：`ExportFileTests`（桥消息、拼文件、文件名、ViewModel），`PageKindTests` 的功能表和边缘手势，`NotesViewModelTests` / `NoteIconTests` 的 `reveal`，`NoteEditorTests` 的 `reveal` 脚本和开着的那一篇就地定位，`AppThemeTests` 的地址和 bootstrap。
  - **待验证（只经过编译检查）**：选了画笔后单指画、两指捏合缩放和移动，手的工具下单指移动画布；从屏幕边缘开始画时不返回列表、不拉出抽屉；导出 PNG / SVG / PDF 时“存储到文件”窗口的默认文件名和扩展名、存好 / 取消 / 失败时的提示；编辑器的工具栏在 Home 指示条和键盘上方、不被遮住；深色外观下的画布、工具栏和导出窗口。
- 分区与新建（#168）和工作区 / 侧栏界面焕新与 Android / 网页相同（[android-native.md](android-native.md) 的对应条款）：`NotesUiState.kinds` / `sections` / `sectionKind(of:)` / `collapsedSections`（`NotesPrefs.collapsedSections`，UserDefaults 的 `notes.collapsedSections`），`NotesViewModel.createNote(parentId:kind:groupId:)` / `toggleSection`，拖动规则 `noteDropRules`（`ReorderDragController.rules`，拖动开始时取一次）和 `dropTargetAt` 的 `zoneAccepts` / `rowAccepts`；界面同步了深色黑曜石色板、页面类型语义色（蓝 / 琥珀 / 紫）、`Lucide.layoutGrid` 切换图标、280pt 抽屉与高对比侧栏（顶部操作区与各分区间 1pt 分隔线、20×20 圆角语义图标徽章 + 高对比 13pt 分区标题 + 计数胶囊、浮起圆角当前行配 3×18 语义色左侧指示条、白面强细框 Search 栏、底部柔和卡片式“登录”按钮、零星标 AI 图标）、Studio 首页（头部工具胶囊、快速创建卡片、类型筛选栏、圆角卡片分组列表）和居中 Studio 空状态。单元测试：`WorkspaceSectionsTests`。**待验证**（只经过语法检查和 CI 编译，没在模拟器或真机上看过）：抽屉和首页的浅色 / 深色视觉效果、快速创建卡片与类型筛选栏交互、新建菜单位置、分区折叠与跨分区拖动。
- 幻灯片与笔记一键放映和 Android 相同（[android-native.md](android-native.md) 的对应一条，规则见 [slides.md](slides.md#原生应用android--ios)）：笔记和幻灯片“…”菜单都显示放映（`notePageSupportsPresentation`，复用 `slides_present`），幻灯片另显示四种导出（`NotePageMenu` 的 `onSlides` → `NotesViewModel.sendSlidesCommand`，经 `notefableEmbed.slides(...)`），分享对话框不显示“包含子页面”（`NoteShareDialog.kind`），桥的 `canPresent()` / `canSaveFile()`。放映：`presentation` start 时 `NotesUiState.presenting`，编辑页收起顶栏、隐藏状态栏、`isIdleTimerDisabled`（常亮），`App/OrientationLock.swift`（`AppDelegate` 的 `supportedInterfaceOrientationsFor`）锁横屏；平时只允许竖屏（`Info.plist` 声明了横屏，供放映使用）；笔记放映里点击“另存为幻灯片”后先结束放映再经 `openPage` 刷新列表并打开新建幻灯片。导出：和白板走同一条路（上面白板一节的“导出的文件”：`Core/Notes/ExportFile.swift` 的 `ExportFileAssembler` 拼临时文件，`NotesUiState.exportFile` 交给编辑页的 `.fileExporter`）。单元测试：`SlidesBridgeTests`、`PageKindTests`。**横屏放映、常亮、文件导出都只经过 Linux 容器的 `swift test` 和 CI 编译，没在模拟器或真机上验证。**
- AI 的页面提案卡片（#158，网页 `page-proposal.tsx`）不分页面类型：笔记、白板、幻灯片的编辑 / 新建提案是同一张卡片，改动的文字和缩略图由服务端各类型的适配器做好（`src/lib/page-ai/types.ts`），卡片照着画。对应的代码：
  - 解析在 `Core/Chat/Activity.swift`：`pageKind`（缺了或不认识按笔记）、`autoApplied`、`undoable`、`status` 多了 `undone`；新建提案的 `parentId` / `parentTitle` / `changes`；改动的 `op` 是 `ProposalOp`（多了 add / update / move / reorder，不认识的按 update），`target`（`ProposalChangeTarget`：第几张幻灯片、白板的元素）、`beforeImage` / `afterImage`（只收本站的相对地址，别的当没有）。仍然要求 `proposed.blocks` 是数组（服务端总给空数组）。
  - 文案在 `Core/Chat/ProposalCopy.swift`：标题（编辑都是“对“…”的修改建议”，新建按类型）、读屏名（笔记 / 页面）、主按钮（应用 / 创建笔记 / 创建白板 / 创建幻灯片）、徽标（自动应用的写“已自动应用 / 已自动创建”，另有“已放弃”“已撤销”）、改动的小标题（笔记的第几块 / 开头，幻灯片第几张，白板元素的文字或个数，别的类型没有对象时只写操作）、子页面的“位于“…”中”。
  - 撤销是 `ProposalStore.undo`（`POST /api/proposals/:id/undo`，`ProposalApi.undo` 读回 `page` 或移进回收站的 `ids`）。卡片显示的状态（`stateOf`，网页 `useProposalState`）：服务端说已放弃 / 已撤销的以服务端为准；服务端说已应用的，只用本机的撤销中、已撤销和撤销失败（还是“已应用”，带原因）；没处理的用本机的。“撤销”键在服务端说能撤销（`undoable`）或刚在这台设备上应用过时出现，撤销中转圈；失败显示服务端原句（系统文翻译）或“无法撤销这项修改。”。撤销编辑提案后和应用后一样刷新笔记列表、把恢复后的页面交给开着的编辑器（`pageUpdated`）；撤销新建提案后 `NotesViewModel.onPagesTrashed` 先从列表拿掉移进回收站的页面（含子页面）、关掉开着的那篇，再刷新（`AppEnvironment.onProposalChange`）。应用 / 放弃 / 撤销被拒、而错误响应带着提案的最终状态（`status`）时，卡片换成那个状态，不显示错误（`ProposalException.finalStatus`，和网页、Android 相同）。
  - 界面在 `Features/Chat/Answer/ProposalCard.swift`：按钮行待确认是“应用 / 放弃”，已应用是“打开笔记 / 打开页面” + “撤销”，撤销过的编辑提案还能打开，撤销过的新建提案写“这个页面已移到回收站。”。缩略图改前、改后并排（最高 176，红 / 绿边框），地址只给提案的主人，只收 `/api/proposals/<id>/image?change=<n>&side=before|after` 这一种写法（`Activity.isProposalImagePath`，Android 同），经 `RemoteImageLoader` 带 App 的 Cookie 读，读到之前按 16:9 留底色。撤销中和网页一样算已处理：徽章还是“已应用”，不显示“应用 / 放弃”，编辑提案的“打开…”还在（新建的页面要进回收站，不给）。
  - 报告 AI 内容：`Core/API/ReportApi.swift` 的 `ReportTarget`（回答 `messageId`、提案 `proposalId`、页面 `pageId`，请求体里只放一个）、`Core/Account/ReportModel.swift`、`Features/Chat/Answer/ReportDialog.swift`（`.reportDialog(_:isPresented:)`；标题和说明回答是 `report_title` / `report_help`，提案和页面是 `report_ai_content` / `report_ai_help`）。卡片标题行最右的旗子报告这个提案；页面“…”菜单在 `NotePageSummary.aiUpdatedAt` 不是 nil 时有“报告 AI 内容”（`notePageReportable`）。编辑器里网页的 AI 面板应用的修改不经原生，所以这一项要等笔记列表下次刷新（回到列表、重新打开）才出现。
  - 单元测试：`ActivityTests`（新字段、对象、缩略图地址、旧提案的默认值）、`ProposalCopyTests`、`ProposalStoreTests`（撤销、状态优先级、undo 和报告的请求体）、`AccountModelsTests`（报告提案 / 页面）、`NotesApiTests`（`aiUpdatedAt`）、`NotesViewModelTests` / `AppEnvironmentTests`（移进回收站的页面）。卡片、报告窗口和菜单项只经过语法检查和 CI 编译，没在模拟器或真机上看过。

**功能规则不在本文重复**：后台生成、附件、使用上限、回答导出、笔记、搜索跳转、头像等规则以 [android-native.md](android-native.md) 为准，本文只写 iOS 特有的结构和差异。改了三端必须一致的部分（功能范围、入口、文案和术语、数据与编辑器能力、品牌色和角色形象），另一端和网页要在同一个任务里一起改；只改 iOS 的原生部分（材质、导航容器、手势、动效、弹层呈现）时不动 Android 和网页（见 `AGENTS.md`）。

## 现状

代码通过了能做的检查；第一个 TestFlight 构建 2026-11-24 已装到真机（[ios.md](ios.md)），界面还没有逐项验收：

| 部分 | 验证方式 | 状态 |
| --- | --- | --- |
| `Core/`（网络、接口、解析、ViewModel） | Linux 容器里 `swift test`，以及 CI 的 macOS `swift test` | 730 多项单元测试通过（大部分移植自 Android 的单元测试） |
| `DesignSystem/`、`Features/`、`App/`（SwiftUI / UIKit） | CI 的模拟器无签名构建与模拟器截图（`ios-pr.yml`：iOS 26 / iOS 18 / iOS 27 × 浅色 / 深色、阿拉伯语 RTL 与“降低透明度”） | 能编译，截图供人工验收；手势、键盘、WebView 交互需在真机（TestFlight）上验 |

Google 登录：Google Cloud 里给 `com.kakumine.notefable` 登记的 iOS OAuth 客户端是 `NoteFable-iOS`，客户端 ID 写在 `Config/NoteFable.xcconfig` 的 `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_IOS_REVERSED_CLIENT_ID`（不是密钥，会打进安装包；留空时登录窗口只有邮箱验证码）。服务端校验的 audience 仍是 Web 客户端 ID（`serverClientID`）。

上线前还缺：

- **真机验证**。TestFlight 构建已能装到 iPhone；按 [android-native.md](android-native.md) 的各节核对三端必须一致的部分（功能、入口、文案、数据与编辑器能力、品牌色和角色形象），外壳手感待 #195 在 iOS 26+ 的 iPhone 上按验收标准实测（Tab 栏按住滑动与折射、顶栏按压高光、抽屉跟手、输入框随键盘不跳；浅色 / 深色 / 降低透明度下可读）。预计会有一批细节要修。
- **Sign in with Apple**。App Store 审核规则 4.8 要求提供第三方登录（Google）的 App 同时提供一个等价的隐私登录方式；现在只有 Google 和邮箱验证码。上架前要么加 Sign in with Apple（后端要支持 Apple 账号关联，属于认证改动），要么确认邮箱验证码登录满足该条。这是上架阻塞项，和 #195 的界面升级分开、独立并行推进（认证改动按 `AGENTS.md` 的 xhigh 评审；是否三端同步加由所有者决定）。
- **购买**。iOS 没有接 App Store 内购，设置里的方案卡片只读（显示方案和用量，没有购买 / 管理按钮），已登录的免费用户撞到上限时也没有升级提示。
- **通用链接**。`Support/NoteFable.entitlements` 声明了 `applinks:app.notefable.com`，但网站还没有提供 `/.well-known/apple-app-site-association`，所以点网页链接暂时不会打开 App。这也是上架阻塞项，和 #195 分开、单独推进（网站提供该文件属于服务端改动）。

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
- **依赖装配**在 `Core/App/AppEnvironment.swift`（接口、ViewModel、各种 Store 都在这里创建一次），**导航**在 `Core/App/AppRouter.swift`（抽屉、`selectedTab: AppTab`、设置、登录、打开笔记 / 聊天、处理外部链接）。界面只从环境里取这两个对象：

  ```swift
  @Environment(AppEnvironment.self) private var app
  @Environment(AppRouter.self) private var router
  ```

- **浮层与底部弹层**：模型、附件、回收站使用包装在 `.nfSheet` 里的系统 `.sheet`（Fitted 与 Medium/Large detent，iOS 26+ 保留系统 Liquid Glass，iOS 17–18 使用 `.regularMaterial`，降低透明度时使用实色底）；对话框、操作菜单、表情选择器、全屏面板（设置 / 登录 / 添加页面 / 项目设置）带 `.nfGlassBackground` 注册到根视图及各层 `.nfOverlayHost()` 的 `@Observable NFOverlayCenter`（用 `.global` 几何坐标跨越 `TabView` 边界，面板 < 对话框 < 菜单）；提示条（`ToastHostModifier`）画在不拦截触摸的独立 `ToastOverlayWindow`（`windowLevel = .normal + 10`）上，浮在系统 `.sheet` 和底部 Tab 栏之上。

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
| 笔记导入 Markdown | SAF `OpenMultipleDocuments` | `fileImporter`（可多选；`Features/Notes/NoteMarkdownIO.swift`）：带访问权限的地址逐个申请、用完就还，iCloud 里没下载的由 `NSFileCoordinator` 等它下载。发请求前按 20 个 / 每个 1 MiB / 合计 4 MiB / 扩展名查一遍（`noteImportProblem`），读完按实际要发的文字和 JSON 请求体再查一遍（`noteImportPayloadProblem`，`groupId` 也算在内）。没有项目时直接导入（请求体不带 `groupId`）；至少有一个项目时本机检查通过后先显示“Import to”对话框（`NotesViewModel.beginImport` 决定，`NoteImportTargetDialog`，用“移到”窗口同一套 `.nfDialog` / `NFOptionRow`）：第一项 “No project”，后面按项目顺序，点一项就导入到那里（带 `groupId`），“Cancel” 不导入。`POST /api/pages/import` 后合并进列表并打开第一篇 |
| 首页封面与侧栏重命名 | `NotesUi.kt`、`NoteFableRoot.kt`、`ChatRecentNotes.kt` | 同源对照实现：`NoteCovers` + `NoteCoverBanner` 在 `NotesHomeView`（最近编辑横向卡）和 `ChatRecentNotes`（卡片顶部封面条）渲染封面；`NotesDrawerBody` 的页面行 “…” `actionsMenu` 与收藏行提供重命名（未锁定时），由 `NotesViewModel.renamePage` 冲洗草稿后调用 `PUT /api/pages/:id/title` 并通过 `notifyPageUpdated` 同步给 `WKWebView` 缓存；`/note-embed` 编辑器同步获得 `/table of contents` 实时目录块 |
| Google 登录 | Credential Manager | GoogleSignIn SDK |
| 系统分享接收 | `MainActivity` 的 `ACTION_SEND` / `ACTION_SEND_MULTIPLE` | 独立扩展 `NoteFableShareExtension`（`ShareExtension/ShareViewController.swift`）把内容写入 App Group（`group.com.kakumine.notefable`）共享目录（`ShareInboxStore`），尝试经 `extensionContext.open` 打开 `notefable://share?id=…`；若系统拒绝直接拉起主 App，则展示已保存勾标后收起，用户回到 NoteFable 时由 `AppRouter.consumePendingShares` 按顺序自动取走全部待处理分享 |
| 返回键 | 系统返回键、预测性返回 | 没有返回键：抽屉、面板、编辑页用边缘滑动或各自的关闭按钮（白板页没有边缘返回，用顶栏的“<”） |

设置里的“图标”和 Android 一样先存在本机（`UserDefaults` 的 `app_icon.icon`，`AppIconStore`），登录时随账号同步（`Core/Support/AppIconSync.swift`，Android `AppIconSync.kt` 的移植；`AppEnvironment.start()` 跟着登录状态读，`Features/Settings/AppIconSettings.swift` 打开时读、选了以后送；图标属于哪个账号和待发送存在 `UserDefaults` 的 `app_icon.owner` / `app_icon.pending`，退出登录 / 删除账号后由 `AppEnvironment.onSignedOut` 调 `forgetAccount`），规则见 [image-flow.md](image-flow.md) 的“设置里的图标”。单元测试 `AppIconSyncTests`。

### 和 Android 行为不同的地方

- **添加文件或照片**：iOS 没有合在一起的系统选择器，点了先出“照片图库 / 拍照 / 选取文件”三项，再打开对应的系统界面。
- **回答里选字**：一段一个文字视图，选区不能跨段；还在流式输出的回答不能选（用普通文字渲染，为了速度）。
- **下载会话**：用系统的“存储到文件”（`.fileExporter`）；下载途中 App 被杀不会像 Android 那样恢复。
- **保存生成的图片**：存进相册后只提示“已保存”，不打开图片。没有权限时提示去“设置”里允许。
- **笔记里的文件**：下载到临时目录后打开分享面板（存到“文件”或用别的 App 打开），不是直接存进下载目录。
- **撞到上限时的提示**：游客只有登录提示；已登录的免费用户不显示升级提示（Android 的 `UpgradeLimitPrompt` 没有移植）。笔记编辑器 WebView 里的 AI 面板或幻灯片 AI 生图撞 429 `usage_limit` 时，bootstrap 声明 `canShowUsageLimit()`，接收 `EmbedMessage.usageLimit(tier, kind, pageId?)` 核对当前编辑器与 `pageId`（过滤切页后晚到的旧页面响应）后写入 `NotesUiState.usageLimit`（与 `storageLimit` 互斥，换编辑器或换身份时清零），`NoteEditorScreen` 在顶栏下方用 `GuestLimitPrompt(usage:)` 呈现：游客显示原生登录入口，已登录免费用户显示只读上限说明（无内购升级按钮）。被拒草稿由网页持久化到 `WKWebsiteDataStore.default()` 的 `localStorage`，登录重建 WebView 后重开原页面自动恢复。
- **存储空间不够**（413 `storage_limit`）：和 Android 一样文字和附件留在输入栏、显示存储提示（`GuestLimitPrompt(storage:)`：用量、“删除不需要的文件”，游客有登录按钮），笔记编辑器里的上传被拒时网页经桥发 `storageLimit`（`canShowStorageLimit()`），编辑器顶栏下面显示同一个提示。没有内购，所以免费用户和 Pro 只说明原因，不提 Pro 的容量、不放升级按钮。设置的方案卡片显示存储用量条（`PlanInfo.storage`）和说明。
- **系统权限说明**（相机、存相册，`Info.plist`）目前只有英文，没有按语言的 `InfoPlist.strings`。
- **表情选择器**在深色外观下仍是浅色的一块（和网页的 `Theme.LIGHT` 一样；Android 的跟着变深）。
- **启动画面的底色**（`LaunchBackground`）跟随系统的深浅，不看 App 里选的外观：选的和系统不一样时，启动瞬间的底色与进入后的界面不同。
- **导出笔记**：存好以后不另外提示；写入失败弹 “Could not export the page.” 的提示（Android 显示在笔记顶栏下面的提示条里）。导出、导入的其他错误和 Android 一样分别显示在编辑页顶栏下面和笔记的错误条里。
- **白板页的边缘手势**：Android 只在网页报来正在用画画的工具（`drawing`）时让开屏幕边缘；iOS 在白板页一直关掉边缘返回和抽屉的边缘拉出（用手的工具时也一样），离开用顶栏的“<”。
- **常驻复用 WebView 与就地切页（#176）**：与 Android 对齐，`RootView` 持有单个工作区级 `NoteEditorPool`（首次打开笔记时按需创建 `WKWebView`），直接切页与离开后短暂重开都复用同一个 `WKWebView` 并经 `window.notefableEmbed.openPage` 就地切换（命中网页端最多 8 篇的 LRU 缓存；旧版服务端或尚未挂好时回退到 Cookie 同步 + 整页加载）。离开编辑页停留在列表或聊天时调用 `close()` 卸载编辑器 DOM 仅保留轻量缓存，同时通过 `AppEnvironment.warmPageUpdated`、`NotesViewModel.notifyPageUpdated`（侧栏改图标，`PUT /api/pages/:id/icon` 返回的整篇页面，只推这次加载以来在这个 WKWebView 里打开过的页面）、`notifyPageSettings`（没打开着的那篇的收藏 / 显示设置 / 锁定）与 `notifyPagesTrashed` 把聊天提案更新、图标、设置和回收站清理同步进热缓存。`missing` 带 `id`，切页途中只认要打开的那一篇的；旧版服务端回退整页加载（`location.replace`）时记下之前的历史项数（`historyFloor`），边缘返回不会退回上一篇。换身份、退到后台（`scenePhase == .background` 且未打开笔记）、收到系统内存警告（`didReceiveMemoryWarningNotification` 且未打开笔记）、停靠空闲超过 120 秒、网页进程在停靠期间终止以及根视图销毁时彻底释放 `WKWebView`。

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
- 界面层只能查语法：`swiftc -frontend -parse`（命令见 README）。**类型错误只有 CI 能发现**：改到 `mobile/ios/**` 的 PR 会在 `xcode-27` 镜像上跑 `swift test`、`xcodegen generate` 和模拟器无签名构建，失败时 “Compiler errors” 一步列出全部错误。macOS 机器按高倍率计分钟数，尽量攒够改动再推。

有 Mac 时：`brew install xcodegen && cd mobile/ios && xcodegen generate && open NoteFable.xcodeproj`。

发布：只在需要上传 TestFlight 的 PR 里调高 `project.yml` 的 `CURRENT_PROJECT_VERSION`（[ios.md](ios.md)）。
