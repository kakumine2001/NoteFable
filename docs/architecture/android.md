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

## 手机界面约定

同一套前端代码，靠屏幕宽度切换排版：小于 640px 是"手机"，小于 1024px 左侧栏收成抽屉，电脑宽度保持原样。

- **首页的 Chat / Notes 切换**：空聊天页和没打开笔记的笔记页，在顶栏下方放一个两键切换（`WorkspaceSwitch`，只在 1024px 以下显示）；开始聊天或打开笔记后空状态消失，切换仍在抽屉最上面。
- **顶栏**：聊天中显示当前会话标题和"新建聊天"按钮；手机上不再重复显示页面里的大标题。
- **笔记首页（手机）**：切到 Notes 时，有笔记就列出所有笔记（图标、标题、日期，`notes-home.tsx`），点一条再打开编辑器，列表下面是"New note"；一篇笔记都没有就显示原来的空状态。列表模式对应"手机宽度 + Notes + 地址里没有 `page=`"（`page.tsx` 的 `syncNotesList`）；编辑器顶栏有"<"回到列表，安卓返回键依次是 笔记 → 列表 → 聊天。电脑端仍然自动打开第一篇笔记，侧栏照旧。
- **模型 / 推理强度**：手机上是底部抽屉（`model-sheet.tsx`），模型是大行，推理强度是一键按钮；电脑上仍是小弹窗加滑块（`DesktopModelSelect`）。
- **"＋"**：手机上，选了支持画图的模型（GPT）时点"＋"弹出"添加文件 / 创建图片"抽屉（`attach-sheet.tsx`），开启后输入框上方出现可取消的标签；其它模型直接打开文件选择。输入栏里单独的图片按钮在手机上隐藏。
- **返回键**：抽屉、两个底部抽屉和图标选择器（1024px 以下，也就是侧栏变成抽屉的宽度）打开时，网页往历史里推一条记录，安卓返回键只关面板（都走 `use-back-to-close.ts`）。不管叠着几层面板，历史里只有 1 条目印：每按一次返回只关最上面的一层，下面还有面板就把目印重新积回去，Esc 也只关最上面一层；最后一层被按钮或 Esc 关掉时才把目印退掉（延后一拍，期间又打开别的面板就沿用同一条）。应用自己投递的合成 `popstate` 不算返回。注意这类历史记录要由真实触摸触发，调试接口的模拟点击不算用户手势，浏览器会跳过。
- **尺寸**：手机宽度下输入栏控件 15px / 40px，侧边栏 16px / 44px，触屏图标按钮 40px；悬停样式只对有鼠标的设备生效。

## 在模拟器里测试还没部署的改动

App 加载的是线上网站，改了 `src/` 之后要先部署才看得到。要在 App 里提前看效果，打一个指向本机开发服务器的测试版：

```bash
npm run dev                  # 仓库根目录，启动开发服务器（端口 3000）
cd mobile && npm run dev-apk # 临时改 capacitor.config.json、打包到 dist/StudyMate-dev.apk，结束后自动还原配置
adb reverse tcp:3000 tcp:3000
adb install -r dist/StudyMate-dev.apk
```

- 测试版读写的是本机数据库，和线上数据、线上 Google 账号无关；Google 登录在测试版里不可用（本机地址不在 Google 的登记里），登录流程用线上包验证。
- 改的是网页就不用重新打包，保存后重新打开 App 即可；只有改了 `mobile/` 里的原生部分才需要重新打包。
- 测完把 `dist/StudyMate-debug.apk`（指向线上）重新装回去。
- 模拟器默认用电脑键盘模式，屏幕键盘不会弹出。要测软键盘，把虚拟手机配置里的 `hw.keyboard` 改成 `no` 再重启模拟器。
- 开发服务器自带的 "N" 角标只在开发时出现，会挡住输入框左下角，正式版没有。

## 返回键

Capacitor 自带的安卓代码不处理"返回"，不处理的话系统会直接关掉 App。`MainActivity.java` 里补了处理：WebView 里有可后退的历史就后退，没有才退出。手机上的抽屉（侧边栏）打开时，网页（`src/app/page.tsx`）会往历史里推一条记录，所以返回键只关抽屉；从抽屉里切换聊天 / 笔记时用替换而不是新增，避免留下一个按返回没反应的空记录。

## 限制

- App 申请的权限只有网络，以及登录插件自带的凭据 / 生物识别（`USE_CREDENTIALS`、`USE_BIOMETRIC`、`USE_FINGERPRINT`，用于账号选择框）。聊天、笔记、AI 工具都和网页完全一致；匿名用户靠 WebView 里的设备 Cookie 区分，清除 App 数据等于换一个新用户。
- **Google 登录**：Google 不允许在内嵌 WebView 里走网页登录，所以 App 里改用安卓系统自带的账号选择框（Credential Manager，插件 `@capgo/capacitor-social-login`，只启用 Google）。流程和服务端校验见下一节。
- **文件下载没有验证**：聊天回答下方的 “Markdown” 按钮用 Blob 加 `<a download>` 下载 .md；`mobile/` 里没有设置 WebView 的下载监听（`DownloadListener`），所以在 App 里点它是否能保存文件没有在真机上确认，可能没有反应，聊天图片的下载按钮同样没有验证。需要时在原生壳里补下载处理。复制和 Save to Notes 是普通网页功能，不受影响。
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
