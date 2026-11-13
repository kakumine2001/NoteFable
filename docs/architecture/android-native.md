# 原生 Android 界面（Kotlin / Compose）

> 目录：`mobile/native/`。与 `mobile/android/` 的 Capacitor 外壳是同一个包名（`com.kakumine.studymate`），装上就覆盖旧版，两者不能同时安装；原生版取代外壳。

## 为什么是"混合原生"，不是全部重写

结论：**聊天和导航原生化，笔记编辑器继续用 WebView**。

- 手感差距主要出在高频、贴手的地方：流式回答的滚动与重绘、输入框与软键盘、侧边栏手势、底部抽屉、返回键。这些用 Compose 做能直接拿到原生的 120Hz 渲染、预测性返回和系统文字选择，WebView 里很难补齐。
- 服务端已经是干净的 REST + SSE（`/api/sessions`、`/api/chat` 等），原生客户端可以直接复用，不需要改后端。
- 笔记编辑器是 BlockNote（自定义块、图片/文件块、拖拽、历史版本）。原生重写工作量大、很难和网页保持一致，收益远低于聊天，所以保留 WebView，只把列表、导航、顶栏做成原生（见路线图）。
- 全部重写会让 Android 和网页两套界面长期各自维护，并且失去"网站更新后 App 不用重新打包"这一点。聊天界面稳定后再接受这个代价，笔记编辑器不接受。

## 现状（阶段 1）

已有：聊天列表抽屉、历史消息、流式回答（SSE，约 40ms 合并一次刷新）、Markdown 渲染、复制回答、模型与推理强度选择（`GET /api/models`，来源是 `src/lib/models.ts`）、停止生成、中 / 日 / 英界面（`res/values-zh`、`values-ja`）、持久化 Cookie（匿名设备身份）。

Markdown 异步解析下一段流式内容时保留上一帧，避免反复显示空白加载态；有序列表保留原文的起始编号，与网页一致。

还没有：附件与图片发送、推理 / 搜索进度条、笔记、Google 登录、搜索、聊天项目、设置页。

## 与网页界面保持一致

原生界面不是另起一套设计，而是网页手机视口（412×915）的复刻。规则：先在网页里量，再在原生里照着写，不凭感觉改。

- **数值来源**：网页 `src/app/globals.css` 与组件，用浏览器在 412×915 下读取真实的位置和样式。原生里 1dp = 网页 1 CSS px。
- **文案**：沿用网页字典（空列表、加载失败也用网页已有的句子，没有就不另写）（`src/lib/i18n/messages/{zh,ja}.ts`），英文原句就是 `res/values/strings.xml` 的内容，`values-zh`、`values-ja` 与字典逐条对应。网页新增或改写文案时，这里要同步。
- **颜色**：`ui/Theme.kt` 的 `Sm` 对象，逐项对应 `--sm-*` / `--notion-*`。**网页只有浅色主题**，所以原生版也只做浅色，不跟随系统深色模式。
- **图标**：网页用 lucide，原生版 `ui/Lucide.kt` 直接用同一份路径数据绘制，品牌标志同理。
- **字体**：网页的字体栈在安卓上落到 Roboto（日文 / 中文用系统 Noto CJK），原生版用系统默认，所以一致。等宽的角色标签网页用 Geist Mono，原生版先用系统等宽，没有内置字体文件。

| 位置 | 网页数值（CSS px） | 原生 |
|---|---|---|
| 顶栏 | 高 56，左右 10.4；图标按钮 40×40、图标 20、圆角 4.8；标题 14 灰 | `TopBar` |
| 空白首页 | 左右 24；图标框 41.6 + 标题 32 粗体、字距 −0.04em、行高 36.8；说明 17 / 27.2 灰，上距 8.8；整体垂直居中 | `EmptyState` |
| 提问气泡 | 标签"あなた / You"12 等宽灰；气泡圆角 14、`#F3F5F9`、内边距 12×16、字 **15 / 行高 28**；图片缩略图 128、圆角 4，在文字上方；非图片附件是块下方的文件标签 | `UserTurn` |
| 回答 | 标签 = 品牌标志 12 + "STUDYMATE · 模型名"；正文 16 / 行高 27.52；标题 650 字重；链接蓝色加粗下划线；回合间距 36；复制按钮 36×36，距正文 6.4 | `AssistantTurn`、`AnswerMarkdown` |
| 输入栏 | 外边距 10.4、上 12、下 max(16, 安全区)；白底、1px `rgba(55,53,47,.18)`、圆角 16、内边距 10、浮起阴影；聚焦时描边变蓝并带 3px 浅蓝光圈；输入框最小高 40，字 16/24 | `Composer` |
| 模型按钮 | 高 40、全圆角、`#F1F1EF`、字 15/500、左右 13.6、"模型名 + 灰色强度 + ⌄" | `ModelPill` |
| 发送键 | 40 的圆；可发送：深色底白箭头（24，描边 2.1）；不可发送：`.08` 灰底 | `SendButton` |
| 模型 / 强度抽屉 | 顶部圆角 17.6，行高 ≥52、圆角 10.4、选中灰底加粗加 ✓；强度三列网格、选中蓝底白字；说明 14 灰；"完成"按钮 48、深色 `#37352F` | `ModelSheet` |
| 侧边栏 | 宽 240、`#F7F7F5`；头部高 48；"新聊天"按钮高 44、圆角 8、深色；聊天行高 44、圆角 6.4，当前行浅蓝底加左侧蓝条 | `SessionDrawer` |

**有意不放的网页控件**（原生版还没有对应功能，不放不能用的入口）：Chat / Notes 切换、搜索、项目、输入栏的 ＋、侧栏里的拖动 / 置顶 / 更多、回答下面的"更多"、语言选择、隐私政策与服务条款链接。做到对应功能时再按网页补上。**原生版额外有**：生成中发送键变成停止键（网页没有停止键）。**线上没部署 `/api/models` 之前**，模型按钮不显示（读不到模型列表就不猜）。

## 目录

```
mobile/native/
  app/src/main/java/com/kakumine/studymate/
    data/   StudyMateApi（OkHttp、SSE）、PersistentCookieJar、ChatStreamParser、DTO
    ui/     ChatViewModel（状态与流式逻辑）、StudyMateRoot（抽屉）、ChatScreen、Theme
  app/src/test/   ChatStreamParser 与 ChatViewModel 的单元测试（假后端，不联网）
```

- 包名 `com.kakumine.studymate`（和 Capacitor 外壳相同，装上就覆盖旧版；versionCode 必须大于外壳的 3），名称 "StudyMate"。Google 登录用已登记的 Android 客户端 `StudyMate-Android`。
- minSdk 26，compileSdk / targetSdk 36，AGP 8.13.2，Gradle 8.14.3，Kotlin 2.3.21。AGP 至少用 8.13.2，其附带的 R8 才支持 Kotlin 2.3 元数据（[官方兼容说明](https://developer.android.com/build/releases/agp-8-13-0-release-notes)）。Compose BOM、OkHttp、Coil、Markdown 渲染库仍沿用当前固定版本；升级依赖时同时核对它们要求的 AGP、Gradle 和 SDK 平台。

## 与服务端的约定

- 身份：和网页一样靠 `studymate_device` Cookie（`PersistentCookieJar` 存在应用私有目录）。**这个 App 的 Cookie 和 Capacitor 外壳互不相通，所以全新安装后看不到外壳里的聊天，直到实现 Google 登录并登录同一个账号。** 清除应用数据等于换一个新用户。
- 请求：`POST /api/chat` 用 multipart 表单，字段与网页的 FormData 相同（`message`、`sessionId`、`model`、`reasoning`、`webSearch`）。读不到模型列表时不带 `model` / `reasoning`，由服务端用默认值。
- 响应：`text/event-stream`，`data: "文本"` 是增量，`data: {"activity":…}` 是过程事件，新聊天的会话 ID 在响应头 `X-Session-Id`。解析规则与 `src/lib/chat-stream.ts` 保持一致。
- 错误文：服务端 API 返回的是英文原句（`msg()` 只做标记，网页端拿它当键用 `t()` 翻译），原生端目前原样显示，外面套本地化的"请求失败：…"。要让中 / 日界面显示译文，需要让服务端按请求语言翻译，或提供错误文词典给原生端（路线图第 2 步顺带做）。
- 首次启动：设备 Cookie 由第一个到达服务端的请求签发。App 先发会话列表请求，发送提问前会等它结束，否则 `/api/sessions` 和 `/api/chat` 各签发一个身份、后到的 Cookie 覆盖先到的，第一个聊天就读不回来。
- 同一时刻只认最新一次会话列表刷新和历史读取，被取消的在途请求结果会被丢弃；历史加载中不能发送。
- 流式请求不设读超时，思考型模型可能很久没有输出。停止生成会取消底层网络请求；切换聊天也会先停掉进行中的回答。停止后不用服务器版本覆盖屏幕，只有正常结束才对账。

## 构建与测试

```bash
cd mobile/native
# local.properties（不提交）里写一行：sdk.dir=A\:/Android/Sdk   （冒号要转义，否则 lint 报 PropertyEscape）
./gradlew testDebugUnitTest assembleDebug          # 产物 app/build/outputs/apk/debug/app-debug.apk
```

- 交付用 release 包：`./gradlew assembleRelease`（R8 压缩后约 2 MB，产物 `app/build/outputs/apk/release/app-release.apk`）。它暂时用 debug 密钥签名，能直接侧载安装；Drive 连接器单个文件上限 10 MB，20 MB 的 debug 包传不上去。文件名 `StudyMate-native-v<版本>-dev.apk`，上传到 `android.md` 里的 Drive 文件夹。
- 默认连线上 `https://studymate-lab-ai.vercel.app`。连电脑上的开发服务器：`./gradlew assembleDebug -Pstudymate.baseUrl=http://10.0.2.2:3000`。明文 HTTP 只在 debug 包允许，且只限 `10.0.2.2` / `localhost`（`src/debug/res/xml/network_security_config.xml`）。
- 模拟器里要先 `adb install -r app-debug.apk`。Windows 上用 `emulator -avd <名字>` 启动前设置 `ANDROID_AVD_HOME=C:\Users\<用户>\.android\avd`。
- 交付 APK 的规则同 `android.md`：上传 Google Drive 并给出链接。

## 路线图

1. ✅ 聊天（本阶段）。
2. 附件与图片：相机 / 相册 / 文件选择上传（`/api/uploads`），生成图片查看和保存；服务端错误文的中 / 日译文；推理、搜索、笔记工具的进度条；笔记编辑提案卡片。
3. 笔记：原生笔记列表、分组、回收站；编辑器用 WebView 加载网页端提供的"仅编辑器"页面，通过 JS 桥同步标题、版本和返回键。这一步需要先在 `src/` 增加该页面。
4. 账号：Credential Manager 原生 Google 登录，沿用 `/api/native-auth/*`（受众仍是 Web 客户端 ID）。已完成：沿用 Google Cloud 里的 `StudyMate-Android`（包名 `com.kakumine.studymate` + 这台电脑的 debug 签名）。换电脑构建或换正式密钥时要再登记新指纹。
5. 替换 Capacitor 外壳：改回 `com.kakumine.studymate`，用同一签名覆盖安装。匿名数据无法跨 Cookie 迁移，替换前要让用户先登录 Google，或接受匿名数据不继承。
