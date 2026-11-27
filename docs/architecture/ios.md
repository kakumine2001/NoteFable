# iOS 应用发布与 CI

> 目录：`mobile/ios/`（原生 Swift / SwiftUI）。本文记录 GitHub Actions 的 PR 检查、App Store Connect / TestFlight 自动打包上传流程、云端签名边界、App Store 商店信息的写入，以及注册 Apple Developer 账号后的启用清单。

与 Android 端（[android.md](android.md)）一致，iOS 客户端的应用 ID（Bundle ID）为 `com.kakumine.notefable`，没有实体 Mac 时完全依赖 GitHub Actions 的 macOS runner 和 Apple Cloud Signing 构建并上传到 App Store Connect（进入 TestFlight）。

## PR 检查

- 工作流：[`.github/workflows/ios-pr.yml`](../../.github/workflows/ios-pr.yml)
- 改动 `mobile/ios/**`、`mobile/android/app/src/main/assets/**`、`.github/workflows/ios-*.yml`、`scripts/release/ios-version*.sh`、`scripts/release/ios-testflight-*.py`、`scripts/release/test_ios_testflight_*.py`、`scripts/release/ios-store-listing.py`、`scripts/release/test_ios_store_listing.py` 或 `scripts/release/verify-merged-pr*.sh` 并向 `main` 提 PR 时运行；只改 PR 标题或描述时不触发。App Store 截图（`mobile/ios/app-store/screenshots/**`）除外：它们不参与构建，由 [`store-listing-pr.yml`](../../.github/workflows/store-listing-pr.yml) 检查（见下文“App Store 商店信息写入”）。
- 先在 `ubuntu-latest` 上运行合并 PR 校验脚本测试（`scripts/release/verify-merged-pr.test.sh`）、版本号校验脚本测试（`scripts/release/ios-version.test.sh`）、TestFlight 分发与商店信息脚本测试（`scripts/release/test_ios_*.py`）与本次 PR 的版本号检查（`scripts/release/ios-version.sh`），脚本或版本号出错时不必启动 macOS。
- 只有校验通过且仓库存在 `mobile/ios/project.yml` 时，才启动两台并行的 `xcode-27` 镜像（macOS + Xcode 27）：`core-tests` 运行 Core 的单元测试（`mobile/ios/scripts/ci-core-tests.sh`：`swift test` 加一个时限，测试挂住时打印卡住的调用栈并提前结束，不把任务时限耗完），`ios` 用 XcodeGen 生成工程并做模拟器无签名构建。PR 检查不接触任何发布凭据。
- **模拟器截图（`ios-screenshots`）**：默认不跑，只有 PR 带 `ios-screenshots` 标签时才跑（iOS 界面大改时加）。标签由 `version` 任务在每次运行时向 GitHub 现查，所以后加标签时推一次提交或重跑本检查即可生效。带标签时，`ios` 任务把构建好的 Debug `NoteFable.app` 打包为 `NoteFable-sim.tgz` 上传；手机端三个矩阵任务分别在 `xcode-27`（iOS 27）与 `macos-15`（iOS 26、iOS 18）上与构建同时启动：先屏蔽生产域名，再在后台用 `mobile/ios/scripts/ci-screenshots.sh --boot-only` 预启动模拟器（托管机器上冷启动要 2～6 分钟，和构建重叠掉），轮询到 `ios` 任务成功后下载安装包并运行 `mobile/ios/scripts/ci-screenshots.sh`（`ios` 任务失败则截图任务直接失败），在屏蔽生产域名的隔离环境下以 Debug fixture 模式（`-NFFixtures YES`、按账号形态同进程批量切换场景，不接触线上接口与真实 Cookie/偏好）截取 PNG：默认变体 `light dark ar rt`，`light` 拍全部 26 个场景，`dark` 拍 15 个，`ar`（系统阿拉伯语）拍 9 个，`rt`（降低透明度）拍 11 个，每个手机系统共 61 张（各变体拍哪些在脚本的 `variant_scenes` 里，挑外观有差别的：内容从浮动玻璃栏下面滚过、玻璃选择器、提示条等）；`ar-app`（系统英文 + 应用内阿拉伯语，靠 App 自己的窗口同步镜像，4 个）和 `hc`（增强对比度，3 个）只在 `NF_VARIANTS` 点名时拍，`NF_ALL_SCENES=1` 让每种变体都拍全部场景。每个场景的 READY 行要报对外壳走的路径（`glass=`：iOS 26+ 为 `native`、更早的系统为 `material`、`rt` 为 `solid`），`hc` 还要报 `increaseContrast=true`，不符时任务失败；`chat-keyboard` 没报 `keyboard=up`（模拟器没弹出软键盘）只记警告。脚本生成总览页 `index.html`，分别上传为 `ios-screenshots-ios27`、`ios-screenshots-ios26` 与 `ios-screenshots-ios18`（保留 14 天）。同一构建也在 iPad 模拟器上按 `light dark ar rt` 截取常驻侧栏展开、手动收起（`sidebar-collapsed`）与主要页面的截图（`ios-screenshots-ipad`）。

## App Store 商店截图

和上面的模拟器截图分开，只有 PR 带 `ios-store-screenshots` 标签时才跑（标签同样现查；`ios` 任务在任一截图标签下打包模拟器 App）。矩阵任务 `ios-store-screenshots` 在 `macos-15` 的 iOS 26 模拟器上拍 iPhone 17 Pro（1206 × 2622）和 iPad Pro 13 英寸（M5，2064 × 2752），浅色。用 iOS 26 是因为 iOS 27 模拟器的截图常缺灵动岛、左上角多一块黑块。和模拟器截图任务不同，它等 `ios` 任务成功后才启动：两个标签都带时，占着 macOS 机器干等的任务太多，构建可能一直排不上。

- **原生界面**：和平时一样的离线 fixture 模式，换成商店故事 `-NFFixtureStory store`（`Core/App/FixtureStoreData.swift`：对话内容取自 Google Play 截图，侧栏和工作区是学习用的项目和页面，账号 “Alex”）。场景 `store-answer` / `store-table` / `store-workspace` / `store-mindmap` / `store-slides` / `store-models` / `store-plan`。
- **思维导图和幻灯片用真实的网页编辑器**：`mobile/ios/scripts/ci-store-server.sh` 在同一台机器上起本 PR 代码的 `next build` + `next start`（临时的 Homebrew PostgreSQL，随机的 `COOKIE_SECRET`，不用任何仓库密钥，生产域名照样屏蔽；依赖用 `npx -y npm@11.6.2 ci` 装，runner 自带的 npm 11.19 会认为本仓库的 lockfile 缺 `@emnapi/*`），把 `mobile/ios/app-store/seed/` 的两页经 `POST /api/pages` 建好（走产品自己的校验），改成固定 ID `fx-store-board` / `fx-store-deck`。App 用 `-NFEditorServer http://localhost:3000 -NFEditorCookie <设备 Cookie>` 打开它；只给 CI 里这份模拟器 App 加 ATS 的本地网络例外。种子改动用 `node node_modules/tsx/dist/cli.mjs scripts/gen-ios-store-seed.ts` 重新生成（不调用 AI），`src/lib/ios-store-seed.test.ts` 检查本体、题名和 ID。网页场景等到画布画出来才报就绪，思维导图再缩小一档。
- **网页空白的处理**：刚启动的模拟器偶尔让第一个 WebView 整个进程都是空白，所以正式拍之前先拍一次思维导图丢掉（`NF_WARMUP_SCENES`）；合成时检查网页区域不是一片纯色，空白或超时就整轮重拍一次。
- **合成**：`mobile/ios/scripts/ci-store-compose.sh` 用无头 Chrome 把原图装进 `mobile/ios/app-store/frame.html`（标题和顺序与 `mobile/android/play-store/screenshots/` 相同，字体 Inter，SIL OFL，固定版本下载并校验），`sips` 转成不带透明通道的 JPEG，尺寸不对就失败。
- **产物**（保留 14 天）：`ios-store-screenshots-iphone` / `-ipad` 里是 `screenshots/<设备>/NN-名称.jpg`；原始截图、模拟器日志和网页服务日志在 `ios-store-captures-<设备>`。看过没问题后把成品解压到 `mobile/ios/app-store/` 并提交（得到 `screenshots/<设备>/`；上传 App Store Connect 是另外的步骤）。

## 自动打包与上传 App Store Connect（TestFlight）

- 工作流：[`.github/workflows/ios-release.yml`](../../.github/workflows/ios-release.yml)
- 版本脚本：[`scripts/release/ios-version.sh`](../../scripts/release/ios-version.sh)

### 触发与版本规则

- **何时发布**：平时合并改动保持 `mobile/ios/project.yml` 的 `CURRENT_PROJECT_VERSION` 不变，不会触发打包或启动 macOS runner。需要上传 TestFlight 时，在合入 `main` 的 PR 中调高 `CURRENT_PROJECT_VERSION`（并按需调高 `MARKETING_VERSION`），在 PR 描述里标明这次会上传 TestFlight。
- **合并校验**：`main` 收到推送后，`plan` 任务在 `ubuntu-latest` 上先核实该提交是合入 `main` 的已合并 PR（`scripts/release/verify-merged-pr.sh`，非 PR 直接推送跳过，接口异常则失败），再比较合并提交 `HEAD` 与第一父提交 `HEAD^1`（仓库只允许 merge commit，不是合并提交时直接失败）；若因合并提交含 `[skip ci]` 等标记未自动触发，可在 `main` 上通过 `workflow_dispatch`（可选填 `main` 第一父提交线上的 40 位合并提交 SHA）按同一套校验补发：
  - `mobile/ios/project.yml` 尚未存在，或本次合并首次引入该文件时：校验通过并跳过发布（`publish=false`），不会在首次合入客户端骨架时意外触发发布。
  - `CURRENT_PROJECT_VERSION` 未变且 `MARKETING_VERSION` 未变：跳过发布（`publish=false`）。
  - `CURRENT_PROJECT_VERSION` 降低、格式非正整数、重复定义，或 `MARKETING_VERSION` 降低、格式无效、修改了 `MARKETING_VERSION` 却未递增 `CURRENT_PROJECT_VERSION`，或 PR 把 `CURRENT_PROJECT_VERSION` 改到了 `main` 已被其他 PR 达到的同一个值：报错失败。
  - **允许同 `MARKETING_VERSION` 多次发 TestFlight**：与 Android 要求每次同时改 `versionName` 不同，App Store Connect 允许同一 `MARKETING_VERSION`（如 `0.1.0`）下连续上传严格递增的 `CURRENT_PROJECT_VERSION`（`1, 2, 3...`），因此只递增 `CURRENT_PROJECT_VERSION` 即可触发上传；不要在切换 `MARKETING_VERSION` 时把 `CURRENT_PROJECT_VERSION` 重置回 `1`。
- **串行与跳过旧任务**：`release` 任务按 `ios-appstore-testflight` 并发组串行执行；排队期间若 `main` 已有更高的 `CURRENT_PROJECT_VERSION`，直接跳过旧任务。

### 无 Mac 云端签名与安全边界

- **Runner 与 SDK**：使用 GitHub 的 `xcode-27` 镜像（默认 Xcode 27 / iOS 27 SDK）。App Store Connect 从 2027 年 4 月起要求用 iOS 27 SDK 构建（ITMS-90725），旧的 `macos-26` 只带 Xcode 26。
- **凭据前置检查**：在跑测试和安装工具前先校验 `appstore-publish` 的必需 Secrets 是否齐全且格式正确，缺失时直接列出缺项并快速失败。
- **构建与云端签名**：
  1. 运行 Core 的单元测试（同一个 `ci-core-tests.sh`）和 `xcodegen generate`。
  2. 写入临时 `Config/Local.xcconfig`（注入 `DEVELOPMENT_TEAM` 与可选的 Google iOS 客户端配置，退出即删），以 `CODE_SIGNING_ALLOWED=NO` 执行 `xcodebuild archive` 生成 `.xcarchive`，核对包内 `CFBundleVersion` / `CFBundleShortVersionString` 与计划版本一致。
  3. 从构建配置读取 `CODE_SIGN_ENTITLEMENTS`（若配置了 entitlements 文件但缺失则直接失败），用 ad-hoc `codesign --force --sign "-" --entitlements ...` 补写权限声明，防止 `CODE_SIGNING_ALLOWED=NO` 导致 Associated Domains（`applinks:app.notefable.com`）在导出阶段丢失。
  4. 通过 `xcodebuild -exportArchive`（`method: app-store-connect`、`signingStyle: automatic`、`destination: export`、`manageAppVersionAndBuildNumber: false`）配合 `-allowProvisioningUpdates` 和 App Store Connect API Key（`.p8`）由 Apple 云端自动签名导出 `.ipa`，无需本地 `.p12` 证书或手动维护描述文件。
  5. 通过 `API_PRIVATE_KEYS_DIR` 指向 `$RUNNER_TEMP` 下的临时目录，用 `xcrun altool --upload-app` 将 `.ipa` 上传到 App Store Connect（进入 TestFlight）。
  6. 上传完成后，`distribute_external` 任务在 `ubuntu-latest` 上运行（不消耗 macOS 分钟数）：通过 `scripts/release/ios-testflight-notes.py` 优先提取本次合并 PR 描述中的 `## TestFlight`（或 `## What to Test`）段落作为「测试内容」，若 PR 未填写面向用户的说明（例如仅后端优化）则回退到通用 Beta 测试文案；随后通过 `scripts/release/ios-testflight-distribute.py` 复用同一套 App Store Connect API 凭据，等待构建处理完成（`VALID`）、写入 `en-US` 测试说明、将构建加入 `External` 外部测试组并在需要时提交 Beta 审核。
- **安全边界**：发布 Secrets 仅存于限制 `main` 分支的 GitHub Environment `appstore-publish`，不放仓库级 Secrets；临时 `Config/Local.xcconfig` 写入 `mobile/ios/Config/` 并在归档步骤结束时由 `trap` 删除，`.p8`、`ExportOptions.plist`、`.xcarchive` 与 `.ipa` 均落在 `$RUNNER_TEMP`（`umask 077`）并通过 `trap` 清理；不把持密任务的输出写入共享 Actions cache。

## App Store 商店信息写入

- 工作流：[`.github/workflows/ios-store-listing.yml`](../../.github/workflows/ios-store-listing.yml)（iOS App Store listing），脚本 [`scripts/release/ios-store-listing.py`](../../scripts/release/ios-store-listing.py)（只用 Python 标准库，JWT、API 请求和密钥处理复用 `ios-testflight-distribute.py`）。内容来源是 [docs/app-store/listing.md](../app-store/listing.md)，名称和描述取自 [docs/play-store/listing.md](../play-store/listing.md)。
- 只能手动运行（Actions → Run workflow，限 `main`），`appstore-publish` 的同一套 API 密钥只给运行脚本的那一步。默认 **dry run**：只读 App Store Connect，按语言和字段打印现值与新值、截图计划（同时写进 job summary）；勾选 `apply` 才写入。先跑 dry run，看过再 apply。重复运行只改有差异的字段，一个语言被拒（例如名称已被占用）不影响其他语言，最后任务标红。服务器出错（5xx）时写请求可能已经生效，所以不重发（限流 429 照常重发），直接记为失败，再运行一次按现状补齐。
- 写入范围：名称、副标题、隐私政策网址、描述、关键词、推广文本、技术支持与营销网址、主次类别，以及 en-US 截图。不提交审核，不碰价格、销售范围、年龄分级、App 隐私、内购和构建（脚本只放行上述写入接口）。
- 需要 App Store Connect 里正好有一个可编辑的 iOS 版本和 App 信息（准备提交、被拒等状态）；没有就停下，不会新建。
- **截图**：`mobile/ios/app-store/screenshots/` 下的 `iphone/`、`ipad/`（PNG / JPEG、不带透明通道），按文件名排序；文件夹不存在就跳过。用 App Asset Library 接口（旧的 `appScreenshotSets` 已弃用），按像素大小对照 Apple 的参考数据（`appAssetLibraryRefData`）归到 App Store 版本用的摆放分组。某个分组的图片或顺序变了才替换：新图全部上传并处理成功后，删掉该分组原来的摆放、按顺序重建；其他分组和资源库里的图片不动。有 en-US 截图、本地却没有对应文件的分组（例如不再提供的尺寸）只警告，不删除。替换时该组每张图都重新上传，参照名带随机后缀（有开发者报告资源库里参照名不能重复）。删掉旧摆放后若中途失败，该分组会暂时空着或不全，再运行一次即可补齐。
- 本机检查文档（不联网、不需要密钥）：`python3 scripts/release/ios-store-listing.py --check`。改到两份商店文档或 `mobile/ios/app-store/screenshots/**` 的 PR 由 [`store-listing-pr.yml`](../../.github/workflows/store-listing-pr.yml) 在 `ubuntu-latest` 上运行这项检查和脚本的单元测试。

## 注册 Apple Developer 账号后的启用清单

以下步骤已经做完（2026-11-24 首个 TestFlight 构建已装到真机），留作换账号或重建环境时的参考（平时合入不升版本号的 PR 不会触发发布）：

1. 注册付费 **Apple Developer Program**，记下 10 位 **Team ID**。
2. 在 Apple Developer / App Store Connect 中：
   - 登记 App Group：`group.com.kakumine.notefable`（主 App 与分享扩展共享待接收内容）。
   - 登记 App ID / Bundle ID：`com.kakumine.notefable`，并开启 **Associated Domains**（匹配 `Support/NoteFable.entitlements` 中的 `applinks:app.notefable.com`）与 **App Groups**（勾选 `group.com.kakumine.notefable`）。
   - 登记分享扩展的 App ID / Bundle ID：`com.kakumine.notefable.ShareExtension`，并开启 **App Groups**（勾选 `group.com.kakumine.notefable`，匹配 `ShareExtension/Support/ShareExtension.entitlements`）。
   - 在 App Store Connect 新建对应的 iOS App 记录。
   - 在 **Users and Access → Integrations → App Store Connect API** 生成 API Key，**权限必须选 `Admin`**（Apple Cloud Signing 需要云端分发证书权限，`App Manager` 会报 `Cloud signing permission error`，且 Key 创建后不能修改权限），下载一次性的 `.p8` 私钥，记下 **Key ID** 和 **Issuer ID**。
3. 在 GitHub 仓库创建仅允许 `main` 分支部署的 Environment `appstore-publish`，配置 Secrets：
   - `APPLE_TEAM_ID`：10 位大写字母数字 Team ID
   - `APPSTORE_API_KEY_ID`：API Key ID
   - `APPSTORE_API_ISSUER_ID`：Issuer ID（UUID）
   - `APPSTORE_API_KEY_P8_B64`：`.p8` 私钥文件的 Base64 编码内容
   - 可选（需成对设置）：`GOOGLE_IOS_CLIENT_ID`、`GOOGLE_IOS_REVERSED_CLIENT_ID`，只在要覆盖 `Config/NoteFable.xcconfig` 里已提交的 iOS Google 客户端时才配
4. 在 App Store Connect 的 **TestFlight** 中：
   - **内部测试（Internal Testing）**：新建一个内部测试组并开启自动分发（Automatic Distribution），把自己加入内部测试人员，并在 iPhone 的 TestFlight App 中接受邀请（未配置内部测试组并分配构建时，即使上传处理完成也不会在 iPhone 上显示可安装）。
   - **外部测试（External Testing）与测试信息**：新建名为 `External` 的外部测试组，并在 **测试信息（Test Information）** 中填好 Beta 应用说明、反馈邮箱、联系人和登录要求（NoteFable 无需登录，取消勾选「需要登录」），否则首次提交 Beta 审核会被 Apple 拒绝。
5. 需要发 TestFlight 时，在合入 `main` 的 PR 中调高 `mobile/ios/project.yml` 的 `CURRENT_PROJECT_VERSION` 即可自动打包并上传；TestFlight 内部测试无需苹果审核，处理完成后即可直接在 iPhone 安装。
