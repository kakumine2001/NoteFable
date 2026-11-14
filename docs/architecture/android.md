# Android 应用

> 目录：`mobile/android/`（Kotlin / Compose）。客户端结构、与网页界面对齐的规则和路线图见 [android-native.md](android-native.md)。本文是开发环境、安装包交付、App 内 Google 登录，以及手机浏览器里的网页排版约定。

原来的 Capacitor 外壳（全屏 WebView 打开线上网站）已经删除，`mobile/android/` 现在是原生客户端（曾在 `mobile/native/`）。`mobile/` 下只放原生客户端：`android/` 和 `ios/`（原生 iOS，尚未开始，见 [mobile/ios/README.md](../../mobile/ios/README.md)）；不再使用 Capacitor 等跨平台方案。原生客户端用同一个包名 `com.kakumine.studymate` 和同一个 debug 签名，直接覆盖安装旧外壳。外壳里的匿名数据存在 WebView 的 Cookie 里，不会转到原生客户端（开发阶段不做迁移）。

## 开发环境

- JDK 21（Gradle 和 Android 工具链用）。
- Android SDK：`platform-tools`、`platforms;android-36`、`build-tools;36.0.0`。可以用 Android Studio 的 SDK Manager 装，也可以只装命令行工具后用 `sdkmanager`（或 Google 的 Android CLI：`android sdk install ...`）。
- 可选：Android Studio（图形界面、Compose 预览、模拟器管理）；Google 的 [Android CLI](https://developer.android.com/tools/agents/android-cli)（`android` 命令，给 AI 和脚本用）。首次启动 Android Studio 时在向导里选 Custom，把 SDK 指到已有的目录，避免再下载一份。
- Windows 上 `android emulator` 命令被 Google 禁用，模拟器在 Android Studio 的 Device Manager 里建；`android studio ...` 一组命令需要 Android Studio 正在运行。
- `mobile/android/local.properties`（不提交）里写 `sdk.dir`，Windows 上用正斜杠，例如 `sdk.dir=A:/Android/Sdk`。写成反斜杠会被当作转义字符，构建报"文件名、目录名或卷标语法不正确"。
- 构建命令和产物位置见 [android-native.md](android-native.md#构建与测试)。

## 安装包交付

- 每次向用户交付 APK，都要上传到现有的 Google Drive [studymate 文件夹](https://drive.google.com/drive/folders/1z2T9eDI83TVK1eD3zUW0ctBMbmhuXv6r)，并提供该文件的 Drive 链接；只给本地路径不算交付完成。文件夹只保留一个最新 APK：先上传新包并核对，再把旧包移入回收站。
- 交付用 R8 压缩后的 release 包（约 2.5 MB）。Drive 连接器单个文件上限 10 MB，20 MB 的 debug 包传不上去。
- 文件名 `NoteFable-v<版本>.apk`，版本取自 `mobile/android/app/build.gradle.kts` 的 `versionName`；仅供测试的包在文件名里注明 `dev`。保留文件夹的共享设置。
- 交付新包前把 `versionCode` 加 1、`versionName` 同步更新，否则系统可能不允许覆盖安装，也分不清手机上装的是哪一版。
- 上传实际通过构建、签名及运行验证的 APK，随后读取 Drive 文件元数据，确认文件名、大小和所属文件夹与本地交付物相符，再报告上传完成。
- debug 签名的 APK 只适合自己安装试用。上架 Google Play 需要正式签名密钥、AAB 和开发者账号，不在当前范围内。

## 手机网页界面约定

手机浏览器打开网站时用同一套前端代码，靠屏幕宽度切换排版：小于 640px 是"手机"，小于 1024px 左侧栏收成抽屉，电脑宽度保持原样。原生客户端照这里的网页界面复刻（见 [android-native.md](android-native.md#与网页界面保持一致)）。

- **首页的 Chat / Notes 切换**：空聊天页和没打开笔记的笔记页，在顶栏下方放一个两键切换（`WorkspaceSwitch`，只在 1024px 以下显示）；开始聊天或打开笔记后空状态消失，切换仍在抽屉最上面。
- **顶栏**：聊天中显示当前会话标题和"新建聊天"按钮；手机上不再重复显示页面里的大标题。
- **笔记首页（手机）**：切到 Notes 时，有笔记就列出所有笔记（图标、标题、日期，`notes-home.tsx`），点一条再打开编辑器，列表下面是"New note"；一篇笔记都没有就显示原来的空状态。列表模式对应"手机宽度 + Notes + 地址里没有 `page=`"（`src/app/[locale]/app/page.tsx` 的 `syncNotesList`）；编辑器顶栏有"<"回到列表，返回键依次是 笔记 → 列表 → 聊天。电脑端仍然自动打开第一篇笔记，侧栏照旧。
- **模型 / 推理强度**：手机上是底部抽屉（`model-sheet.tsx`），模型是大行，推理强度是一键按钮；电脑上仍是小弹窗加滑块（`DesktopModelSelect`）。
- **"＋"**：手机上，选了支持画图的模型（GPT）时点"＋"弹出"添加文件 / 创建图片"抽屉（`attach-sheet.tsx`），开启后输入框上方出现可取消的标签；其它模型直接打开文件选择。输入栏里单独的图片按钮在手机上隐藏。
- **返回键**：抽屉、两个底部抽屉和图标选择器（1024px 以下，也就是侧栏变成抽屉的宽度）打开时，网页往历史里推一条记录，浏览器的返回只关面板（都走 `use-back-to-close.ts`）。不管叠着几层面板，历史里只有 1 条目印：每按一次返回只关最上面的一层，下面还有面板就把目印重新积回去，Esc 也只关最上面一层；最后一层被按钮或 Esc 关掉时才把目印退掉（延后一拍，期间又打开别的面板就沿用同一条）。应用自己投递的合成 `popstate` 不算返回。注意这类历史记录要由真实触摸触发，调试接口的模拟点击不算用户手势，浏览器会跳过。从抽屉里切换聊天 / 笔记时用替换而不是新增，避免留下一个按返回没反应的空记录。
- **尺寸**：手机宽度下输入栏控件 15px / 40px，侧边栏 16px / 44px，触屏图标按钮 40px；悬停样式只对有鼠标的设备生效。

## Google 登录（App 内）

App 里点"登录"打开和网页相同的登录窗口（`ui/SignInDialog.kt`，见 [android-native.md](android-native.md)），里面按服务端开着的方式列出"使用 Google 继续"和邮箱验证码登录。邮箱登录直接用网页的 `/api/auth/email/start` 和 `/api/auth/email/verify`（原生请求不带 `Origin`，服务端放行），不经过下面的 `native-auth` 接口。

Google 不允许在内嵌 WebView 里走网页登录，App 用安卓系统的账号选择框（Credential Manager）拿 ID 令牌，再交给服务端换成和网页相同的会话 Cookie。

1. App 先 `POST /api/native-auth/nonce` 拿一个使用一次的 nonce（服务端同时把签名后的副本写进 `studymate_native_nonce` Cookie，路径限定 `/api/native-auth`，5 分钟有效）。
2. 把 nonce 交给 Credential Manager 弹出账号选择框，得到 Google ID 令牌（令牌里带 `nonce`）。Web 客户端 ID 从 `GET /api/account` 的 `googleClientId` 取。
3. `POST /api/native-auth/google`（`src/lib/native-google-login.ts`）：同源且 JSON；用 `jose` 对 Google 公开密钥做本地签名校验，检查发行者、受众（= 网站已有的 Web 客户端 ID `AUTH_GOOGLE_ID`）、有效期、邮箱已验证、`nonce` 与 Cookie 一致；然后签发和 Auth.js 相同格式的会话 Cookie（`authjs.session-token`，`salt` 是 Cookie 名，`googleSub` 对应现有账号绑定逻辑）。无效令牌返回 401；取不到 Google 密钥这类服务端问题返回 503。
4. 之后的账号绑定、匿名数据迁移与网页登录完全相同（`src/lib/auth.ts`）。

要点：
- **受众是 Web 客户端 ID，不是 Android 客户端 ID。** Google Cloud 里建的 Android 类型客户端（包名 + 签名 SHA-1）只是用来登记"这个安装包有资格调用登录"，代码里不会用到它的 ID。
- 不同签名的包要各自登记指纹：调试签名和将来的正式签名是两个指纹，可以加在同一个 Android 客户端上；换电脑后 debug 签名也会变。
- OAuth 同意屏幕处于"测试"状态时，只有加入"测试用户"的账号能登录。
