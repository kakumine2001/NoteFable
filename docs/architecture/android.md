# Android 应用

> 目录：`mobile/`。网页端的手机适配仍在 `src/` 里做。

`mobile/` 是一个 Capacitor 安卓外壳：App 本身只是全屏 WebView，直接打开线上的 StudyMate（地址写在 `mobile/capacitor.config.json` 的 `server.url`），所以网站更新后 App 不用重新打包。原生代码只有 Capacitor 模板生成的文件，不需要自己写 Kotlin / Java。

## 改哪里

- 手机上的界面、布局、软键盘、触屏交互：改网站代码（`src/`），App 和手机浏览器同时生效。
- 只和 App 有关的内容才改 `mobile/`：图标和启动画面、App 名称和包名（`com.kakumine.studymate`）、权限、断网页面、Capacitor 原生插件。
- 以后如果做原生（Kotlin）界面，在 `mobile/` 下新建独立目录，不要和这个外壳混在一起。

## 开发环境

- JDK 21（Gradle 和 Android 工具链用）。
- Android SDK：`platform-tools`、`platforms;android-36`、`build-tools;36.0.0`。可以用 Android Studio 的 SDK Manager 装，也可以只装命令行工具后用 `sdkmanager`（或 Google 的 Android CLI：`android sdk install ...`）。
- 可选：Android Studio（图形界面、Compose 预览、模拟器管理）；Google 的 [Android CLI](https://developer.android.com/tools/agents/android-cli)（`android` 命令，给 AI 和脚本用，`android init` 给 AI 工具装安卓技能包）。首次启动 Android Studio 时在向导里选 Custom，把 SDK 指到已有的目录，避免再下载一份。
- Windows 上 `android emulator` 命令被 Google 禁用，模拟器在 Android Studio 的 Device Manager 里建；`android studio ...` 一组命令需要 Android Studio 正在运行。

## 打包

打包一个可以直接安装的 debug APK（手机上需要允许"安装未知来源应用"）：

```bash
cd mobile
npm install
npm run icons        # 从 public/icon.svg 生成图标和启动画面
npm run sync
# android/local.properties 里写 sdk.dir=<Android SDK 路径>（不会提交）
cd android && ./gradlew assembleDebug
# 产物: android/app/build/outputs/apk/debug/app-debug.apk
```

- `sdk.dir` 在 Windows 上要用正斜杠，例如 `sdk.dir=A:/Android/Sdk`。写成 `A\:\Android\Sdk` 会被当作转义字符，构建报"文件名、目录名或卷标语法不正确"。
- 第一次构建会下载 Gradle 和依赖库，需要几分钟。
- 装到连着电脑的手机：手机开 USB 调试，`adb install -r app-debug.apk`（或 `android install`）。
- 无法连接网站时显示 `mobile/www/offline.html`，点按钮重试。
- 登录插件默认带 Facebook / Apple / X 三个用不到的提供商，`capacitor.config.json` 的 `plugins.SocialLogin.providers` 里已关掉，改完要 `npm run sync`。
- 给手机发新安装包前把 `android/app/build.gradle` 的 `versionCode` 加 1，否则系统可能不允许覆盖安装。

## 限制

- App 申请的权限只有网络，以及登录插件自带的凭据 / 生物识别（`USE_CREDENTIALS`、`USE_BIOMETRIC`、`USE_FINGERPRINT`，用于账号选择框）。聊天、笔记、AI 工具都和网页完全一致；匿名用户靠 WebView 里的设备 Cookie 区分，清除 App 数据等于换一个新用户。
- **Google 登录**：Google 不允许在内嵌 WebView 里走网页登录，所以 App 里改用安卓系统自带的账号选择框（Credential Manager，插件 `@capgo/capacitor-social-login`，只启用 Google）。流程和服务端校验见下一节。
- debug 签名的 APK 只适合自己安装试用。上架 Google Play 需要正式签名密钥、AAB 和开发者账号，不在当前范围内。

## Google 登录（App 内）

1. 网页里的"Sign in with Google"按钮检测到自己在 App 里（`window.Capacitor.isNativePlatform()`）时，不走 Auth.js 的网页登录，而是 `src/lib/native-app.ts` 通过 `Capacitor.nativePromise("SocialLogin", ...)` 调原生插件。外壳只是用 URL 打开网站，Capacitor 的 JS 运行时没有加载，所以不能用 `Capacitor.Plugins`。
2. 先 `POST /api/native-auth/nonce` 拿一个使用一次的 nonce（服务端同时把签名后的副本写进 `studymate_native_nonce` Cookie，路径限定 `/api/native-auth`，5 分钟有效）。
3. 把 nonce 交给插件弹出账号选择框，得到 Google ID 令牌（令牌里带 `nonce`）。**不要传 `scopes`**：插件在没有改造 `MainActivity` 时会拒绝，邮箱和资料本来就是默认包含的。
4. `POST /api/native-auth/google`（`src/lib/native-google-login.ts`）：同源且 JSON；用 `jose` 对 Google 公开密钥做本地签名校验，检查发行者、受众（= 网站已有的 Web 客户端 ID `AUTH_GOOGLE_ID`）、有效期、邮箱已验证、`nonce` 与 Cookie 一致；然后签发和 Auth.js 相同格式的会话 Cookie（`authjs.session-token`，`salt` 是 Cookie 名，`googleSub` 对应现有账号绑定逻辑）。无效令牌返回 401；取不到 Google 密钥这类服务端问题返回 503。
5. 之后的账号绑定、匿名数据迁移与网页登录完全相同（`src/lib/auth.ts`）。

要点：
- **受众是 Web 客户端 ID，不是 Android 客户端 ID。** Google Cloud 里建的 Android 类型客户端（包名 + 签名 SHA-1）只是用来登记"这个安装包有资格调用登录"，代码里不会用到它的 ID。
- 不同签名的包要各自登记指纹：调试签名和将来的正式签名是两个指纹，可以加在同一个 Android 客户端上。
- OAuth 同意屏幕处于"测试"状态时，只有加入"测试用户"的账号能登录。
- 这条路径依赖线上网站已部署对应版本；App 本身只是壳。
