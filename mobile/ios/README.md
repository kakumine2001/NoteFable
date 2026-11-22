# NoteFable iOS

原生 iOS 客户端（Swift / SwiftUI，iOS 17+）。和 Android 客户端（`mobile/android/`）一样只通过服务器 API 工作，界面照搬网页手机视口。架构与现状见 [docs/architecture/ios-native.md](../../docs/architecture/ios-native.md)，各功能的规则以 [android-native.md](../../docs/architecture/android-native.md) 为准（两端同一套行为）。

## 目录

```
mobile/ios/
  project.yml          XcodeGen 工程定义（.xcodeproj 不进仓库）
  Package.swift        只用来单独编译、测试 NoteFable/Core（macOS / Linux）
  Config/              xcconfig：服务器地址、Google 客户端 ID、签名
  Support/             Info.plist、entitlements
  NoteFable/
    App/               入口（@main）
    Core/              不依赖 SwiftUI / UIKit 的一层：网络、接口、DTO、解析、ViewModel
      App/（依赖装配 AppEnvironment、导航 AppRouter）  Support/  Networking/  Models/  API/
      Chat/  Notes/  Sidebar/  Search/  Account/  Text/
    DesignSystem/      Theme（Sm 颜色）、Lucide 图标、Mascot、通用控件
    Features/          各界面：Root、Chat、Sidebar、Notes、Search、Account、Settings
    Resources/         Assets.xcassets、<语言>.lproj/Localizable.strings
                       （打包的 JSON 资源和 Android 共用，project.yml 直接引用 mobile/android/app/src/main/assets/，不另存一份）
  Tests/NoteFableCoreTests/   Core 的单元测试（XCTest）
```

## 约定

- **对照 Android 移植**：类型、函数、文件名尽量和 Kotlin 端相同（`ChatViewModel`、`SessionDto`、`ChatStreamParser`…），方便两边对照着改；枚举 case 用 lowerCamelCase。规则、数值、文案以网页和 Android 为准，不自创。Android 的单元测试一并移植。
- **Core 不 import SwiftUI / UIKit / Combine**，只用 Foundation（+ `Observation`、swift-markdown）。用到 `CGRect` / `CGPoint` 的方法（`contains`、`minY`、`.zero`…）的文件要加 `#if canImport(CoreGraphics) import CoreGraphics #endif`：Linux 的 Foundation 自带这些，macOS 上它们在 CoreGraphics 里，不加的话 Linux 能过、CI 不过。网络走 `Core/Networking` 的传输协议，测试里换成假的。Linux 上 `URLSession` 在 `FoundationNetworking` 里：`#if canImport(FoundationNetworking) import FoundationNetworking #endif`。
- **同一个模块**：Core 的源码直接编进 App 模块，所以都用默认的 internal，不写 `public`。
- **ViewModel**：`@MainActor @Observable final class`，状态是一个值类型（如 `ChatUiState`），放在 Core，依赖经初始化参数注入（协议或闭包），时间用注入的 sleep / clock，测试不真等。
- **文案**：`L("键", 参数…)`（`Core/Text/L10n.swift`），键 = Android 字符串资源名，占位符保留 `%1$s` / `%1$d`。`Localizable.strings` 由 `npx tsx scripts/gen-ios-strings.ts` 从 Android 资源生成，不手改；新文案先加到 Android 的 `res/values`（及 zh、ja），再跑两端的生成脚本。服务端发来的英文句子用 `SystemText` 翻译。
- **样式**：颜色用 `Sm.*`，字体 `Font.nf(字号, weight: CSS 字重)`，尺寸直接写网页的 CSS px 数值（1pt = 1px）。图标用 `Lucide`（和网页同一份路径），不用 SF Symbols。每个颜色有浅色、深色两个值（网页 `:root` 和 `:root[data-theme="dark"]`）：`Sm.*` 和 `Color(light:dark:)` 是跟着外观自己换的动态颜色，不要写死 `Color.white` / `.black`（墨色底上的字用 `Sm.onInk`，页面底用 `Sm.background`，卡片 / 对话框底用 `Sm.surface`）；画成图片的东西（公式）要按 `colorScheme` 各画一张。
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

签名：在 `Config/Local.xcconfig`（不进仓库）里写 `DEVELOPMENT_TEAM = <Team ID>`。Google 登录要先在 Google Cloud 登记 iOS 客户端并填 `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_IOS_REVERSED_CLIENT_ID`，留空时只有邮箱验证码登录。
