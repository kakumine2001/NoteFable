# NoteFable iOS

原生 iOS 客户端（Swift / SwiftUI，iOS 17+）。和 Android 客户端（`mobile/android/`）一样只通过服务器 API 工作。功能范围、入口、文案和术语、数据与编辑器能力、品牌色和角色形象与网页 / Android 一致；材质、导航容器、手势、动效、弹层呈现按 iOS 原生做（#195：iOS 26+ 用 Liquid Glass，iOS 17–18 退回系统毛玻璃，“降低透明度”时实色），分界见 [android-native.md](../../docs/architecture/android-native.md#三端一致与原生分界)。架构与现状见 [docs/architecture/ios-native.md](../../docs/architecture/ios-native.md)，各功能的规则以 [android-native.md](../../docs/architecture/android-native.md) 为准（两端同一套行为）。

## 目录

```
mobile/ios/
  project.yml          XcodeGen 工程定义（.xcodeproj 不进仓库）
  Package.swift        只用来单独编译、测试 NoteFable/Core（macOS / Linux）
  Config/              xcconfig：服务器地址、Google 客户端 ID、签名
  Support/             Info.plist、entitlements
  scripts/             core-check.sh（Linux 容器里编译 / 测试 Core）、ci-core-tests.sh（CI 上跑 Core 测试）
  NoteFable/
    App/               入口（@main）
    Core/              不依赖 SwiftUI / UIKit 的一层：网络、接口、DTO、解析、ViewModel
      App/（依赖装配 AppEnvironment、导航 AppRouter）  Support/  Networking/  Models/  API/
      Chat/  Notes/  Sidebar/  Search/  Account/  Text/
    DesignSystem/      Theme（Sm 颜色）、Lucide 图标、Mascot、通用控件
    Features/          各界面：Root、Chat、Sidebar、Notes、Search、Account、Settings、Shared
    Resources/         Assets.xcassets、<语言>.lproj/Localizable.strings
                       （打包的 JSON 资源和 Android 共用，project.yml 直接引用 mobile/android/app/src/main/assets/，不另存一份）
  Tests/NoteFableCoreTests/   Core 的单元测试（XCTest）
```

## 约定

- **对照 Android 移植**：类型、函数、文件名尽量和 Kotlin 端相同（`ChatViewModel`、`SessionDto`、`ChatStreamParser`…），方便两边对照着改；枚举 case 用 lowerCamelCase。规则、文案、术语以网页和 Android 为准，不自创；外壳以外的数值也照网页量的值，外壳（材质、导航容器、手势、动效、弹层呈现）按 iOS 系统的做。Android 的单元测试一并移植。
- **Core 不 import SwiftUI / UIKit / Combine**，只用 Foundation（+ `Observation`、swift-markdown）。用到 `CGRect` / `CGPoint` 的方法（`contains`、`minY`、`.zero`…）的文件要加 `#if canImport(CoreGraphics) import CoreGraphics #endif`：Linux 的 Foundation 自带这些，macOS 上它们在 CoreGraphics 里，不加的话 Linux 能过、CI 不过。网络走 `Core/Networking` 的传输协议，测试里换成假的。Linux 上 `URLSession` 在 `FoundationNetworking` 里：`#if canImport(FoundationNetworking) import FoundationNetworking #endif`。
- **同一个模块**：Core 的源码直接编进 App 模块，所以都用默认的 internal，不写 `public`。
- **ViewModel**：`@MainActor @Observable final class`，状态是一个值类型（如 `ChatUiState`），放在 Core，依赖经初始化参数注入（协议或闭包），时间用注入的 sleep / clock，测试不真等。
- **文案**：`L("键", 参数…)`（`Core/Text/L10n.swift`），键 = Android 字符串资源名，占位符保留 `%1$s` / `%1$d`。`Localizable.strings` 由 `npx tsx scripts/gen-ios-strings.ts` 从 Android 资源生成，不手改；新文案先加到 Android 的 `res/values`（及 zh、ja），再跑两端的生成脚本。服务端发来的英文句子用 `SystemText` 翻译。
- **样式**：颜色用 `Sm.*`（品牌色三端相同；玻璃材质只当底，不另调颜色），字体 `Font.nf(字号, weight: CSS 字重)`，外壳以外的尺寸直接写网页的 CSS px 数值（1pt = 1px）；系统容器（`TabView` 底栏、`.nfSheet` 系统 `.sheet`）的尺寸、圆角、材质用系统的，不硬套网页数值。每个颜色有浅色、深色两个值（网页 `:root` 和 `:root[data-theme="dark"]`）：`Sm.*` 和 `Color(light:dark:)` 是跟着外观自己换的动态颜色，不要写死 `Color.white` / `.black`（墨色底上的字用 `Sm.onInk`，页面底用 `Sm.background`，卡片 / 对话框底用 `Sm.surface`）；画成图片的东西（公式）要按 `colorScheme` 各画一张。图标用 `Lucide`（和网页同一份路径），不用 SF Symbols；系统容器只收 `Image` 的地方（如 Tab 图标）经 `NFGlassTabIcons` 把同一份 Lucide 路径渲染成模板图片。材质、浮动栏与系统容器的兼容层封装在 `DesignSystem/LiquidGlass.swift` 和 `GlassChrome.swift`（iOS 26+ Liquid Glass、iOS 17–18 系统毛玻璃、“降低透明度”与 `nfForceSolidChrome` 回退实色底，三条路径由 `NFChromePath` 判断），界面层不各自判断系统版本。
- **并发**：Swift 5 语言模式；async/await，不用 Combine；UI 状态只在主线程改。
- **注释**：和 Android 端一样用中文，写“为什么”和对应的网页 / Android 出处，不写显而易见的。

## 构建与测试

Windows / Linux（没有 Xcode）只能验证 Core 和语法：

```bash
# Core：编译 + 单元测试（Docker 里的 Linux Swift）。源码只读，构建缓存在具名卷里；
# 和 Android 共用的 JSON 资源挂在 /android-assets，不挂的话读这些资源的测试会跳过。
docker run --rm -v "<仓库>/mobile/ios:/src:ro" -v "<仓库>/mobile/android/app/src/main/assets:/android-assets:ro" -v nf-ios-build:/build swift:6.1 bash /src/scripts/core-check.sh test
# 界面层：只查语法（不查类型）
docker run --rm -v "<仓库>/mobile/ios:/src" -w /src swift:6.1 bash -c 'find NoteFable -name "*.swift" -print0 | xargs -0 swiftc -frontend -parse'
```

Mac：

```bash
brew install xcodegen
cd mobile/ios && xcodegen generate && open NoteFable.xcodeproj
swift test            # Core 的单元测试
```

签名：在 `Config/Local.xcconfig`（不进仓库）里写 `DEVELOPMENT_TEAM = <Team ID>`。Google 登录的 iOS 客户端 ID 已写在 `Config/NoteFable.xcconfig`（`GOOGLE_IOS_CLIENT_ID` / `GOOGLE_IOS_REVERSED_CLIENT_ID`），清空时只有邮箱验证码登录。

## 截图（fixture 模式）

Debug 构建支持完全离线的截图模式，CI（`.github/workflows/ios-pr.yml` 的 `ios-screenshots` 三路并行任务，只在 PR 带 `ios-screenshots` 标签时运行）通过它分别在 `xcode-27`（iOS 27）与 `macos-15`（iOS 26、iOS 18）上截取界面图：

- 启动参数：`-NFFixtures YES` 开启离线 `FixtureTransport`（`.invalid` 域名、独立 `UserDefaults` 套件和临时目录、本地替身编辑页），支持单场景 `-NFFixtureScene <场景>` 或同进程批量 `-NFFixtureBatch <逗号分隔场景>` + `-NFFixtureAckDir <目录>`（场景：`chat-empty` / `chat` / `chat-scrolled` / `emoji-picker` / `chat-composer` / `chat-keyboard` / `toast` / `model-sheet` / `attach-sheet` / `drawer` / `sidebar-collapsed` / `search` / `search-scrolled` / `settings` / `settings-page` / `settings-plan` / `workspace` / `workspace-scrolled` / `editor` / `page-menu` / `editor-scrolled` / `editor-locked` / `editor-whiteboard` / `editor-slides` / `chat-streamed` / `chat-streaming` / `sign-in`）、`-NFFixtureAccount signed-in|guest`、`-NFFixtureAppLanguage <locale>`、`-NFForceSolidChrome YES`。
- 每个场景稳定后向 `stderr` 输出一行 `NF_FIXTURE_READY [idx=<n>] scene= reduceTransparency= forcedSolid= rtl= locale= glass=native|material|solid keyboard=up|down increaseContrast= timeout=`；脚本 `mobile/ios/scripts/ci-screenshots.sh <NoteFable.app> <out-dir>` 在本地会新建并清理一次性模拟器以保护本机原有 App 数据（CI 或显式传 `NF_REUSE_SIMULATOR=1` 时才复用预置单屏模拟器），按变体同进程批量截取场景（`NF_VARIANTS` 默认 `light dark ar rt`：浅色拍全部场景，其余变体只拍 `variant_scenes` 里外观有差别的场景；可加 `ar-app`（系统英文 + 应用内阿拉伯语）和 `hc`（增强对比度），默认不跑；`NF_SCENES` 只拍点名的场景，`NF_ALL_SCENES=1` 时每种变体都拍全部），核对 READY 行（`glass=` 在 iOS 26+ 应为 `native`、更早的系统为 `material`、`rt` 为 `solid`，`hc` 要 `increaseContrast=true`，不符时失败；`chat-keyboard` 没有 `keyboard=up` 只警告），并生成 `index.html` 拼图（超时 / 缺失场景标红并令脚本失败）。Release / TestFlight 构建不含任何 fixture 代码。
- 聊天消息区空白的排查（暂时，原因查清、修复落地后删掉；iOS 27 模拟器上见过，Debug 专用）：设了 `NF_CHAT_CONTROL`（`ios-pr.yml` 里 iOS 27、iOS 26、iPad 三个截图任务；格式 `off:3 a:3 b:3 nopin:1`，冒号后是轮数）时，普通截图之后每组开关起两个进程，浅色下按轮数依次拍对照场景：不开编辑页的 `chat-switch-visible`、`chat-new-send`、`chat-regenerate` 一个进程，开编辑页的 `chat-editor-send`、`chat-after-editor`、`chat-streamed-settled`、`chat-editor-link` 另一个进程（每个场景自己从空白首页做准备，`App/FixtureChatControl.swift`；`NF_CHAT_CONTROL_SCENES` 只拍点名的、同一个进程；`NF_CHAT_CONTROL_LIMIT` 默认 1080 秒到点收工，免得任务超时连产物都丢）。开关是启动参数（`Features/Chat/ChatDebug.swift`，默认关）：`a` = `-NFChatListIdentity YES`（候选修复 A：每段对话一个新消息列表）、`b` = `-NFChatPinPastEnd YES`（候选修复 B：滚过末尾时贴回去）、`nopin` = `-NFChatNoPin YES`（控制器从不贴底）。聊天画面就绪时 stderr 另记一行 `NF_CHAT_GEOMETRY`（滚动位置、内边距、内容和可视区大小、是否跟随、出现过的行）；`scripts/chat-blank-check.py` 按它给出的消息区查截图是不是空白（也查普通截图里的 `chat` / `chat-scrolled` / `chat-streamed` / `chat-streaming`），结果写进 step summary 和产物的 `chat-control/`（`report.md`、`index.html`）。查出空白只报告（一条 warning）、不让任务失败；对照场景超时、缺 READY 或应用崩溃和普通截图一样令任务失败。
