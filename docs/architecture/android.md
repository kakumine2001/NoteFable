# Android 应用

> 目录：`mobile/android/`（Kotlin / Compose）。客户端结构、与网页界面对齐的规则和路线图见 [android-native.md](android-native.md)。本文是开发环境、安装包交付、正式签名与 Google Play、App 内 Google 登录，以及手机浏览器里的网页排版约定。

原来的 Capacitor 外壳（全屏 WebView 打开线上网站）已经删除，`mobile/android/` 现在是原生客户端（曾在 `mobile/native/`）。`mobile/` 下只放原生客户端：`android/` 和 `ios/`（原生 iOS，尚未开始，见 [mobile/ios/README.md](../../mobile/ios/README.md)）；不再使用 Capacitor 等跨平台方案。原生客户端的应用 ID 是 `com.kakumine.notefable`；release 包用 Google Play 的上传密钥签名（见下面“正式签名与 Google Play”）。

## 开发环境

- JDK 21（Gradle 和 Android 工具链用）。
- Android SDK：`platform-tools`、`platforms;android-36`、`build-tools;36.0.0`。可以用 Android Studio 的 SDK Manager 装，也可以只装命令行工具后用 `sdkmanager`（或 Google 的 Android CLI：`android sdk install ...`）。
- 可选：Android Studio（图形界面、Compose 预览、模拟器管理）；Google 的 [Android CLI](https://developer.android.com/tools/agents/android-cli)（`android` 命令，给 AI 和脚本用）。首次启动 Android Studio 时在向导里选 Custom，把 SDK 指到已有的目录，避免再下载一份。
- Windows 上 `android emulator` 命令被 Google 禁用，模拟器在 Android Studio 的 Device Manager 里建；`android studio ...` 一组命令需要 Android Studio 正在运行。
- `mobile/android/local.properties`（不提交）里写 `sdk.dir`，Windows 上用正斜杠，例如 `sdk.dir=A:/Android/Sdk`。写成反斜杠会被当作转义字符，构建报"文件名、目录名或卷标语法不正确"。
- 构建命令和产物位置见 [android-native.md](android-native.md#构建与测试)。

## 安装包交付

所有交给用户的包只用一种签名：Play 的应用签名密钥。所以 Google Cloud 里只需要一个 Android OAuth 客户端（`NoteFable-Android`），本机签名的包（debug 和本机 release）不能用 Google 登录，开发时用邮箱验证码登录，要测 Google 登录就装 Play 签名的包。

**暂停：用户说恢复之前，不要下载 Play 签名的通用 APK，也不要往 Drive 上传任何 APK（下面第 4、5 步和“Drive 规则”整段暂时不执行）；也不要把它当作下一步提出来。** 用户解除暂停后，删掉这一段。

交付流程：

1. `mobile/android/app/build.gradle.kts` 里 `versionCode` 加 1、`versionName` 同步更新（Play 不接受重复的 `versionCode`，系统也可能不允许覆盖安装）。
2. `./gradlew bundleRelease`（上传密钥签名）→ `app/build/outputs/bundle/release/app-release.aab`。
3. 所有者把 AAB 上传到 Play Console 的**内部测试**轨道并发布，或由 CI 工作流自动上传（见下「正式签名与 Google Play」的 CI 条目）。
4. Play Console → App bundle explorer（アプリバンドル エクスプローラ）→ 这个版本 → 下载**签名済みのユニバーサル APK**（Play 签名的通用 APK），改名后传到 Drive。
5. 测试人员可以从内部测试轨道直接安装（能用 Play 结算），也可以装 Drive 上的 APK（同样是 Play 签名，Google 登录能用，但不是从 Play 安装的，不能购买）。

Drive 规则：

- 每次向用户交付 APK，都要上传到现有的 Google Drive [NoteFable 文件夹](https://drive.google.com/drive/folders/1z2T9eDI83TVK1eD3zUW0ctBMbmhuXv6r)，并提供该文件的 Drive 链接；只给本地路径不算交付完成。文件夹只保留一个最新 APK：先上传新包并核对，再把旧包移入回收站。
- 交付的是 Play 签名的通用 APK（R8 压缩后约 2.5 MB）。Drive 连接器单个文件上限 10 MB；不交付本机构建的 APK（签名不同，Google 登录失败）。
- 文件名 `NoteFable-v<版本>.apk`，版本取自 `mobile/android/app/build.gradle.kts` 的 `versionName`；仅供测试的包在文件名里注明 `dev`。保留文件夹的共享设置。
- 上传前装到手机上跑过一遍（至少能打开、能登录），随后读取 Drive 文件元数据，确认文件名、大小和所属文件夹与本地交付物相符，再报告上传完成。
- 以前侧载的本机签名包（debug 签名或上传密钥签名）和 Play 签名不同，不能直接覆盖安装，要先卸载一次。

## 正式签名与 Google Play

- **上传密钥**：PKCS12 密钥库放在本机用户目录（不进仓库，路径和密码写在 `~/.gradle/gradle.properties` 的 `notefable.upload.storeFile` / `storePassword` / `keyAlias` / `keyPassword`），所有 worktree 共用。`app/build.gradle.kts` 有这些属性时用它签 release 包；缺任何一个时 `bundleRelease` / `assembleRelease` 直接失败，只有加 `-Pnotefable.release.debugSigning=true` 才用 debug 签名（只能自己侧载）。上传密钥只用来把 AAB 交给 Play，它签的包不交付给用户。密钥库和密码要另外备份；丢了可以在 Play Console 申请重置上传密钥，但要等 Google 处理。
- **构建**：`./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`（上传 Play）；`assembleRelease` → 本机签名的 APK，只用于本机检查（没有 Google 登录），不交付。每次上传 Play 前 `versionCode` 加 1。
- **PR 检查（不发布）**：`.github/workflows/android-pr.yml` 在 Android / 发布配置 PR 上运行无密钥的单元测试、debug 构建和发布策略测试。PR 不得获取上传密钥或 Play 发布凭据。
- **唯一的 AAB 构建与上传入口**：`.github/workflows/android-release.yml` 仅由 `android-v<versionName>` 标签触发，且标签指向的 commit 必须已在 `main` 历史中。版本名必须匹配 Gradle 配置，`versionCode` 必须未在 Play 使用。CI 先测试，再使用上传密钥签名 AAB，只上传一次到 Play **内部测试**（`completed`）。本工作流不提供直接选择 production 的参数。CI 产物保留 30 天供排查。
- **晋级已验证版本**：内部测试通过后，在 Actions 中运行 `.github/workflows/android-promote.yml`，选择 `main`，输入该版本在 Play 的 `versionCode`、目标轨道与确认词 `PROMOTE`。工作流通过 Google Play Developer API 查找内部测试轨道（`qa` / `internal`）中 `completed` 的版本，并在目标轨道复用同一个 `versionCode`；**不构建新 AAB，也不重新上传**。防止重复发布、降级、覆盖进行中的灰度发布。目标 `alpha` / `beta` 测试轨道必须预先在 Console 配好。production 仅允许 5% / 10% / 20% / 25% / 50% 初始灰度，后续扩大、暂停或完成由 Play Console 人工操作。Google Play 的审核和发布状态仍以 Console 为准。
- **凭据和权限**：上传密钥库与口令放仓库 Secrets（`NOTEFABLE_KEYSTORE_B64`、`NOTEFABLE_KEYSTORE_PASSWORD`、`NOTEFABLE_KEY_ALIAS`、`NOTEFABLE_KEY_PASSWORD`）；`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` **只**放 GitHub Environment `play-publish`。Environment 的允许部署分支/标签必须在 GitHub 后台明确限制为 `main` 与 `android-v*`，工作流文件本身不能自动创建这些限制。私有仓库的 Environment 功能存在 GitHub 套餐条件，需要在设置中实际核实；不要假设 Required reviewers 审批在私有仓库可用。正式发布由人工触发，非自动合并或自动晋级。凭据不写进仓库。版本说明优先取 `mobile/android/play-store/release-notes.txt`（存在时，暂映射 en-US）。

- **Play 应用签名**：Play 用自己保管的应用签名密钥（Google 生成，私钥不给开发者）重新签名后分发。Google Cloud 的 Android OAuth 客户端一个只能填一个 SHA-1，所以只登记这一把：`NoteFable-Android`（包名 `com.kakumine.notefable`，SHA-1 取自 Play Console → 应用完整性 → アプリ署名鍵）。Google Cloud 里只有它和网页用的 `NoteFable-Web` 两个 OAuth 客户端；以前登记 debug 签名和上传密钥的客户端已删除。不用“鍵を変更”把应用签名密钥换成上传密钥：一把密钥兼任上传和签发，泄露后无法重置上传密钥。OAuth 同意屏幕已经是“正式版 / 外部”，任何 Google 账号都能登录。
- **商店资料**：文字和 Console 表单答案在 [docs/play-store/](../play-store/listing.md)，图片在 `mobile/android/play-store/`。
- Play 政策要求的两个应用内功能：设置里的“删除账号”（`DELETE /api/account`，网页 `/delete-account` 说明删除方法）和每条回答“…”菜单里的“报告回答”（`POST /api/reports`，发到开发者邮箱）。见 [chat-flow.md](chat-flow.md) 和 [database.md](database.md)。

## 手机网页界面约定

手机浏览器打开网站时用同一套前端代码，靠屏幕宽度切换排版：小于 640px 是"手机"，小于 1024px 左侧栏收成抽屉，电脑宽度保持原样。原生客户端照这里的网页界面复刻（见 [android-native.md](android-native.md#与网页界面保持一致)）。

- **首页的 Chat / Notes 切换**：空聊天页和没打开笔记的笔记页，在顶栏下方放一个两键切换（`WorkspaceSwitch`，只在 1024px 以下显示）；开始聊天或打开笔记后空状态消失，切换仍在抽屉最上面。
- **顶栏**：聊天中显示当前会话标题和"新建聊天"按钮；手机上不再重复显示页面里的大标题。
- **笔记首页（手机）**：切到 Notes 时，有笔记就列出所有笔记（图标、标题、日期，`notes-home.tsx`），点一条再打开编辑器，列表下面是"New note"；一篇笔记都没有就显示原来的空状态。列表模式对应"手机宽度 + Notes + 地址里没有 `page=`"（`src/app/[locale]/app/page.tsx` 的 `syncNotesList`）；编辑器顶栏有"<"回到列表，返回键依次是 笔记 → 列表 → 聊天。电脑端仍然自动打开第一篇笔记，侧栏照旧。
- **模型 / 推理强度**：手机上是底部抽屉（`model-sheet.tsx`），模型是大行，推理强度是一键按钮；电脑上仍是小弹窗加滑块（`DesktopModelSelect`）。
- **"＋"**：手机上点"＋"始终弹出"添加文件 / 创建图片"抽屉（`attach-sheet.tsx`），开启后输入框上方出现可取消的标签；图片生成独立于所选聊天模型，固定走 OpenAI Images API。桌面的"＋"弹出只含"添加文件 / 创建图片"的小菜单，"添加页面"留在输入栏里。
- **返回键**：抽屉、两个底部抽屉和图标选择器（1024px 以下，也就是侧栏变成抽屉的宽度）打开时，网页往历史里推一条记录，浏览器的返回只关面板（都走 `use-back-to-close.ts`）。不管叠着几层面板，历史里只有 1 条目印：每按一次返回只关最上面的一层，下面还有面板就把目印重新积回去，Esc 也只关最上面一层；最后一层被按钮或 Esc 关掉时才把目印退掉（延后一拍，期间又打开别的面板就沿用同一条）。应用自己投递的合成 `popstate` 不算返回。注意这类历史记录要由真实触摸触发，调试接口的模拟点击不算用户手势，浏览器会跳过。从抽屉里切换聊天 / 笔记时用替换而不是新增，避免留下一个按返回没反应的空记录。
- **尺寸**：手机宽度下输入栏控件 15px / 40px，侧边栏 16px / 44px，触屏图标按钮 40px；悬停样式只对有鼠标的设备生效。

## Google 登录（App 内）

App 里点"登录"打开和网页相同的登录窗口（`ui/SignInDialog.kt`，见 [android-native.md](android-native.md)），里面按服务端开着的方式列出"使用 Google 继续"和邮箱验证码登录。邮箱登录直接用网页的 `/api/auth/email/start` 和 `/api/auth/email/verify`（原生请求不带 `Origin`，服务端放行），不经过下面的 `native-auth` 接口。

Google 不允许在内嵌 WebView 里走网页登录，App 用安卓系统的账号选择框（Credential Manager）拿 ID 令牌，再交给服务端换成和网页相同的会话 Cookie。

1. App 先 `POST /api/native-auth/nonce` 拿一个使用一次的 nonce（服务端同时把签名后的副本写进 `notefable_native_nonce` Cookie，路径限定 `/api/native-auth`，5 分钟有效）。
2. 把 nonce 交给 Credential Manager 弹出账号选择框，得到 Google ID 令牌（令牌里带 `nonce`）。Web 客户端 ID 从 `GET /api/account` 的 `googleClientId` 取。
3. `POST /api/native-auth/google`（`src/lib/native-google-login.ts`）：同源且 JSON；用 `jose` 对 Google 公开密钥做本地签名校验，检查发行者、受众（= 网站已有的 Web 客户端 ID `AUTH_GOOGLE_ID`）、有效期、邮箱已验证、`nonce` 与 Cookie 一致；然后签发和 Auth.js 相同格式的会话 Cookie（`authjs.session-token`，`salt` 是 Cookie 名，`googleSub` 对应现有账号绑定逻辑）。无效令牌返回 401；取不到 Google 密钥这类服务端问题返回 503。
4. 之后的账号绑定、匿名数据迁移与网页登录完全相同（`src/lib/auth.ts`）。

要点：
- **受众是 Web 客户端 ID，不是 Android 客户端 ID。** Google Cloud 里建的 Android 类型客户端（包名 + 签名 SHA-1）只是用来登记"这个安装包有资格调用登录"，代码里不会用到它的 ID。
- 只登记 Play 应用签名密钥的指纹（`NoteFable-Android`）。本机签名的包（debug、本机 release）在 Credential Manager 这一步就失败，只能用邮箱验证码登录（见“正式签名与 Google Play”）。
- OAuth 同意屏幕处于"测试"状态时，只有加入"测试用户"的账号能登录（现在是正式版）。
