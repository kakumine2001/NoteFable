# iOS 应用发布与 CI

> 目录：`mobile/ios/`（原生 Swift / SwiftUI）。本文记录 GitHub Actions 的 PR 检查、App Store Connect / TestFlight 自动打包上传流程、云端签名边界，以及注册 Apple Developer 账号后的启用清单。

与 Android 端（[android.md](android.md)）一致，iOS 客户端的应用 ID（Bundle ID）为 `com.kakumine.notefable`，没有实体 Mac 时完全依赖 GitHub Actions 的 macOS runner 和 Apple Cloud Signing 构建并上传到 App Store Connect（进入 TestFlight）。

## PR 检查

- 工作流：[`.github/workflows/ios-pr.yml`](../../.github/workflows/ios-pr.yml)
- 改动 `mobile/ios/**`、`mobile/android/app/src/main/assets/**`、`.github/workflows/ios-*.yml` 或 `scripts/release/ios-version*.sh` 并向 `main` 提 PR 时运行；只改 PR 标题或描述时不触发。
- 先在 `ubuntu-latest` 上运行版本号校验脚本测试（`scripts/release/ios-version.test.sh`）与本次 PR 的版本号检查（`scripts/release/ios-version.sh`），避免版本号出错时白耗高倍率的 macOS 分钟数。
- 只有校验通过且仓库存在 `mobile/ios/project.yml` 时，才启动 `macos-26` 运行 `swift test`、XcodeGen 生成工程和模拟器无签名构建。PR 检查不接触任何发布凭据。

## 自动打包与上传 App Store Connect（TestFlight）

- 工作流：[`.github/workflows/ios-release.yml`](../../.github/workflows/ios-release.yml)
- 版本脚本：[`scripts/release/ios-version.sh`](../../scripts/release/ios-version.sh)

### 触发与版本规则

- **何时发布**：平时合并改动保持 `mobile/ios/project.yml` 的 `CURRENT_PROJECT_VERSION` 不变，不会触发打包或启动 macOS runner。需要上传 TestFlight 时，在合入 `main` 的 PR 中调高 `CURRENT_PROJECT_VERSION`（并按需调高 `MARKETING_VERSION`），在 PR 描述里标明这次会上传 TestFlight。
- **合并校验**：PR 以 merge commit 合入 `main` 后，`plan` 任务在 `ubuntu-latest` 上比较合并提交 `HEAD` 与第一父提交 `HEAD^1`（仓库只允许 merge commit，不是合并提交时直接失败）：
  - `mobile/ios/project.yml` 尚未存在，或本次合并首次引入该文件时：校验通过并跳过发布（`publish=false`），不会在首次合入客户端骨架时意外触发发布。
  - `CURRENT_PROJECT_VERSION` 未变且 `MARKETING_VERSION` 未变：跳过发布（`publish=false`）。
  - `CURRENT_PROJECT_VERSION` 降低、格式非正整数、重复定义，或 `MARKETING_VERSION` 降低、格式无效、修改了 `MARKETING_VERSION` 却未递增 `CURRENT_PROJECT_VERSION`，或 PR 把 `CURRENT_PROJECT_VERSION` 改到了 `main` 已被其他 PR 达到的同一个值：报错失败。
  - **允许同 `MARKETING_VERSION` 多次发 TestFlight**：与 Android 要求每次同时改 `versionName` 不同，App Store Connect 允许同一 `MARKETING_VERSION`（如 `0.1.0`）下连续上传严格递增的 `CURRENT_PROJECT_VERSION`（`1, 2, 3...`），因此只递增 `CURRENT_PROJECT_VERSION` 即可触发上传；不要在切换 `MARKETING_VERSION` 时把 `CURRENT_PROJECT_VERSION` 重置回 `1`。
- **串行与跳过旧任务**：`release` 任务按 `ios-appstore-testflight` 并发组串行执行；排队期间若 `main` 已有更高的 `CURRENT_PROJECT_VERSION`，直接跳过旧任务。

### 无 Mac 云端签名与安全边界

- **Runner 与 SDK**：使用 `macos-26`（默认带 Xcode 26 / iOS 26 SDK，满足 App Store Connect 的最低 SDK 要求）。
- **凭据前置检查**：在跑测试和安装工具前先校验 `appstore-publish` 的必需 Secrets 是否齐全且格式正确，缺失时直接列出缺项并快速失败。
- **构建与云端签名**：
  1. 运行 `swift test` 和 `xcodegen generate`。
  2. 写入临时 `Config/Local.xcconfig`（注入 `DEVELOPMENT_TEAM` 与可选的 Google iOS 客户端配置，退出即删），以 `CODE_SIGNING_ALLOWED=NO` 执行 `xcodebuild archive` 生成 `.xcarchive`，核对包内 `CFBundleVersion` / `CFBundleShortVersionString` 与计划版本一致。
  3. 从构建配置读取 `CODE_SIGN_ENTITLEMENTS`（若配置了 entitlements 文件但缺失则直接失败），用 ad-hoc `codesign --force --sign "-" --entitlements ...` 补写权限声明，防止 `CODE_SIGNING_ALLOWED=NO` 导致 Associated Domains（`applinks:app.notefable.com`）在导出阶段丢失。
  4. 通过 `xcodebuild -exportArchive`（`method: app-store-connect`、`signingStyle: automatic`、`destination: export`、`manageAppVersionAndBuildNumber: false`）配合 `-allowProvisioningUpdates` 和 App Store Connect API Key（`.p8`）由 Apple 云端自动签名导出 `.ipa`，无需本地 `.p12` 证书或手动维护描述文件。
  5. 通过 `API_PRIVATE_KEYS_DIR` 指向 `$RUNNER_TEMP` 下的临时目录，用 `xcrun altool --upload-app` 将 `.ipa` 上传到 App Store Connect（进入 TestFlight）。
- **安全边界**：发布 Secrets 仅存于限制 `main` 分支的 GitHub Environment `appstore-publish`，不放仓库级 Secrets；临时 `Config/Local.xcconfig` 写入 `mobile/ios/Config/` 并在归档步骤结束时由 `trap` 删除，`.p8`、`ExportOptions.plist`、`.xcarchive` 与 `.ipa` 均落在 `$RUNNER_TEMP`（`umask 077`）并通过 `trap` 清理；不把持密任务的输出写入共享 Actions cache。

## 注册 Apple Developer 账号后的启用清单

当前工作流已就位，尚未注册 Apple Developer 账号也未配置 Environment / Secrets（平时合入不升版本号的 PR 不会触发发布）。账号就绪后按以下步骤启用：

1. 注册付费 **Apple Developer Program**，记下 10 位 **Team ID**。
2. 在 Apple Developer / App Store Connect 中：
   - 登记 App ID / Bundle ID：`com.kakumine.notefable`，并开启 **Associated Domains**（匹配 `Support/NoteFable.entitlements` 中的 `applinks:app.notefable.com`）。
   - 在 App Store Connect 新建对应的 iOS App 记录。
   - 在 **Users and Access → Integrations → App Store Connect API** 生成 API Key，**权限必须选 `Admin`**（Apple Cloud Signing 需要云端分发证书权限，`App Manager` 会报 `Cloud signing permission error`，且 Key 创建后不能修改权限），下载一次性的 `.p8` 私钥，记下 **Key ID** 和 **Issuer ID**。
3. 在 GitHub 仓库创建仅允许 `main` 分支部署的 Environment `appstore-publish`，配置 Secrets：
   - `APPLE_TEAM_ID`：10 位大写字母数字 Team ID
   - `APPSTORE_API_KEY_ID`：API Key ID
   - `APPSTORE_API_ISSUER_ID`：Issuer ID（UUID）
   - `APPSTORE_API_KEY_P8_B64`：`.p8` 私钥文件的 Base64 编码内容
   - 可选（后续启用 iOS Google 登录时再配，需成对设置）：`GOOGLE_IOS_CLIENT_ID`、`GOOGLE_IOS_REVERSED_CLIENT_ID`
4. 在 App Store Connect 的 **TestFlight → 内部测试（Internal Testing）** 中：
   - 新建一个内部测试组并开启自动分发（Automatic Distribution），把自己加入内部测试人员，并在 iPhone 的 TestFlight App 中接受邀请（未配置内部测试组并分配构建时，即使上传处理完成也不会在 iPhone 上显示可安装）。
5. 需要发 TestFlight 时，在合入 `main` 的 PR 中调高 `mobile/ios/project.yml` 的 `CURRENT_PROJECT_VERSION` 即可自动打包并上传；TestFlight 内部测试无需苹果审核，处理完成后即可直接在 iPhone 安装。
