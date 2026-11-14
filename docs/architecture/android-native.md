# 原生 Android 界面（Kotlin / Compose）

> 目录：`mobile/android/`。这是唯一的 Android 客户端；原来的 Capacitor 外壳已删除，原生版用同一个包名（`com.kakumine.studymate`）覆盖安装它。开发环境与 APK 交付规则见 [android.md](android.md)。

## 为什么是"混合原生"，不是全部重写

结论：**聊天和导航原生化，笔记编辑器继续用 WebView**。

- 手感差距主要出在高频、贴手的地方：流式回答的滚动与重绘、输入框与软键盘、侧边栏手势、底部抽屉、返回键。这些用 Compose 做能直接拿到原生的 120Hz 渲染、预测性返回和系统文字选择，WebView 里很难补齐。
- 服务端已经是干净的 REST + SSE（`/api/sessions`、`/api/chat` 等），原生客户端可以直接复用，不需要改后端。
- 笔记编辑器是 BlockNote（自定义块、图片/文件块、拖拽、历史版本）。原生重写工作量大、很难和网页保持一致，收益远低于聊天，所以保留 WebView，只把列表、导航、顶栏做成原生（见路线图）。
- 全部重写会让 Android 和网页两套界面长期各自维护，并且失去"网站更新后 App 不用重新打包"这一点。聊天界面稳定后再接受这个代价，笔记编辑器不接受。

## 现状（阶段 3）

已有：聊天列表抽屉、历史消息、流式回答（SSE，约 40ms 合并一次刷新）、Markdown 渲染、复制回答、模型与推理强度选择（`GET /api/models`，服务器用 `STUDYMATE_MODELS` 决定开放哪些，见 [deployment.md](deployment.md)；读不到接口时用安装包自带的内置列表）、停止生成、中 / 日 / 英界面（`res/values-zh`、`values-ja`）、持久化 Cookie（匿名设备身份）。

Markdown 异步解析下一段流式内容时保留上一帧，避免反复显示空白加载态；有序列表保留原文的起始编号，与网页一致。

另有 Credential Manager Google 登录、退出及修改显示名的代码，沿用 `/api/native-auth/*` 和 `/api/account`，真实账号登录流程仍需单独验证。附件（文件选择、上传、发送）和「生成图片」模式已有，见下文“附件与图片”。笔记（列表、项目、回收站、WebView 编辑器）已有，见下文“笔记”。还没有：推理 / 搜索进度条、搜索、聊天项目、设置页、繁体中文及网页的上限登录提示与草稿恢复交互。

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
| 输入栏的 ＋ | 40×40 图标按钮、圆角 4.8、图标 18（描边 1.8）灰色；右边 6 处接模型按钮 | `Composer` |
| ＋ 抽屉 | 与模型抽屉同款外框；行高 ≥60、圆角 11.2、内边距 6.4×13.6、图标 22、间距 14.4；标题 17 半粗、说明 14 灰；打开「生成图片」时该行灰底加 ✓ | `AttachSheet` |
| 待发送附件 | 输入栏上方，间距 8、下距 12；图片 96×96、圆角 6、1px 描边，右上 6 处 24×24 半透明黑底移除键（✕ 15）；其他文件是 12 灰字标签（回形针 13 + 文件名 + ✕ 13，内边距 10×6），点一下移除 | `PendingFiles` |
| 附件状态行 | 输入栏下方 8 处、12 灰字：“已附上 n/10 · 总大小”；上传时再加一行进度 | `ComposerStatus` |
| 提示条 | 输入栏上方、下距 12；浅红底 `rgba(255,226,221,.65)`、字 12.8 `#933b34`、圆角 4.8、内边距 8.8×10.4 | `ComposerError` |
| 生成图片标记 | 输入框上方、高 32、全圆角、浅蓝底 `rgba(35,131,226,.12)`、蓝字 14/500，图标 16 + 文字 + ✕ 14，点一下关闭 | `ImageModeChip` |
| 生成中占位 | 最宽 448、1px 描边、圆角 5.6；头部高 ≥56（图标框 30.4 + 两行说明 + 三个跳动的点），下面 16:9 浅灰画布和 2px 蓝色进度线 | `GeneratingImagePreview` |
| 模型按钮 | 高 40、全圆角、`#F1F1EF`、字 15/500、左右 13.6、"模型名 + 灰色强度 + ⌄" | `ModelPill` |
| 发送键 | 40 的圆；可发送：深色底白箭头（24，描边 2.1）；不可发送：`.08` 灰底 | `SendButton` |
| 模型 / 强度抽屉 | 顶部圆角 17.6，行高 ≥52、圆角 10.4、选中灰底加粗加 ✓；强度三列网格、选中蓝底白字；说明 14 灰；"完成"按钮 48、深色 `#37352F` | `ModelSheet` |
| 侧边栏 | 宽 240、`#F7F7F5`；头部高 48；下面 Chat / Note 切换（左右 8、上距 4）；"新聊天 / 新笔记"按钮上距 12、高 44、圆角 8、深色、左对齐（图标 16 + 8 + 16/550 白字）；聊天行高 44、圆角 6.4，当前行浅蓝底加左侧蓝条 | `AppDrawer`、`ChatDrawerBody` |
| Chat / Note 切换 | 高 48、底色 `.12` 灰、圆角 8、内边距 2、间距 2；每键高 44、圆角 6.4、16/500、图标 16 + 6.4；选中白底、墨色字、蓝色图标、1px 细环 + 浅阴影。空白聊天页和笔记首页在顶栏下方（左右 24、上距 4），抽屉里在头部下方 | `WorkspaceSwitch` |
| 侧栏笔记部分 | "PROJECTS / NOTES"12 等宽大写灰字（上 14.4、下 4.8），"新项目"40 按钮（图标 15）；项目行高 44：箭头 14、文件夹 15、名称 14/500、数量 12 浅灰，右侧铅笔 13 / 垃圾桶 14 两个 25.6 小按钮；组内笔记左距 12 + 1px 竖线 + 内左距 4；笔记行高 44：图标区 40（表情 / 文件图标 15），标题 14，右侧"移到项目""移到回收站"25.6 小按钮（触屏常显）；最下方"回收站"行高 44、图标 16 + 8.8、16/500 | `NotesDrawerBody` |
| 笔记首页 | 左右 24、下 96；"Notes"32/750、行高 48、字距 −0.04em、上 8 下 12；项目小标题 13/600 灰 + 数量 13 浅灰（外边距 20/4/4）；行最小高 56、下边 1px 线：图标区 28（表情 / 图标 20 浅灰）、间距 13.6、标题 17/500、日期 13 灰（`MMMd`）、右侧 44×48"移到项目"（图标 18 浅灰）；"新笔记"高 40 + "新项目"文字按钮 12.8/500 | `NotesHome` |
| 笔记空状态 | 上距 120；文件图标 28（线宽 1.4、浅灰）；"Notes"40/750、行高 50、上 16；说明 15/24 灰（"/"等宽键帽）；"新笔记"高 32、上 24；存储说明 12/20 浅灰、上 40、最宽 384 | `NotesEmpty` |
| 笔记编辑页顶栏 | 高 56、左右 10.4：菜单 40、间距 12、"<"40（图标 22）、间距 12、图标 15 + 6 + 标题 14 灰；右侧版本历史 40（图标 20）、间距 8、保存状态 14 灰（出错 / 冲突 `#b45309`） | `NoteEditorScreen` |
| 笔记对话框 | 宽 min(100% − 48, 400)、内边距 24、圆角 8、遮罩 `rgba(15,15,15,.2)`；标题 16/600、说明 14 灰；输入框 1px 深描边、圆角 6、内边距 8.8×11.2、聚焦 2px 蓝；选项行 ≥40、圆角 6、15 字，当前项灰底 600 + ✓；按钮 ≥32、圆角 4.8、12.8/500，危险操作红字 `#b91c1c` | `NotesDialog` 等 |
| 回收站 | 底部全宽面板、顶部圆角 16；头部内边距 12/12/12/16 + 下边 1px 线；"清空回收站"红字、关闭 40；说明 13/18.85 灰；行内边距 6.4×8：图标 24（表情 17）、标题 15/500、时间 12 灰；按钮高 44、15/500、左右 16，在下一行靠右 | `TrashSheet` |

**有意不放的网页控件**（原生版还没有对应功能，不放不能用的入口）：搜索（顶栏和侧栏）、聊天项目、侧栏里的拖动 / 置顶 / 更多、回答下面的"更多"；笔记里：拖动排序（侧栏和首页行前的把手）、侧栏行里的改图标（表情选择器；编辑器里仍可改）。笔记编辑页没有网页以外的"更多"菜单：移到回收站和网页一样在侧栏的笔记行上。做到对应功能时再按网页补上。**原生版额外有**：生成中发送键变成停止键（网页没有停止键）。`/api/models` 不可用时使用安装包里的 `assets/models.json`；接口返回服务器开放的模型，资源是 `src/lib/models.ts` 的内置列表；两者都不可用时才隐藏模型按钮。

改动模型定义后运行 `npx tsx scripts/gen-native-models.ts` 更新打包资源；`src/lib/native-models-asset.test.ts` 检查资源与内置列表是否一致。App 里不写死模型：开放哪些由服务器的 `STUDYMATE_MODELS` 决定。

## 目录

```
mobile/android/
  app/src/main/java/com/kakumine/studymate/
    data/   StudyMateApi（OkHttp、SSE）、PersistentCookieJar、ChatStreamParser、DTO、Notes（笔记 DTO、NotesBackend、JS 桥消息）
    ui/     ChatViewModel（状态与流式逻辑）、NotesViewModel（列表、项目、回收站、离开前保存）、StudyMateRoot（抽屉、模式切换）、
            ChatScreen、NotesUi（侧栏笔记部分、首页、对话框、回收站）、NoteEditor（顶栏 + WebView + JS 桥）、Theme
  app/src/test/   ChatStreamParser、ChatViewModel、NotesViewModel、笔记接口与桥消息的单元测试（假后端 / MockWebServer，不联网）
```

- 包名 `com.kakumine.studymate`（和已删除的 Capacitor 外壳相同，装上就覆盖旧版），名称 "StudyMate"。Google 登录用已登记的 Android 客户端 `StudyMate-Android`。
- minSdk 26，compileSdk / targetSdk 36，AGP 8.13.2，Gradle 8.14.3，Kotlin 2.3.21。AGP 至少用 8.13.2，其附带的 R8 才支持 Kotlin 2.3 元数据（[官方兼容说明](https://developer.android.com/build/releases/agp-8-13-0-release-notes)）。Compose BOM、OkHttp、Coil、Markdown 渲染库仍沿用当前固定版本；升级依赖时同时核对它们要求的 AGP、Gradle 和 SDK 平台。

## 与服务端的约定

- 身份：和网页一样靠 `studymate_device` Cookie（`PersistentCookieJar` 存在应用私有目录）。这个 App 的 Cookie 和旧外壳的 WebView 互不相通；匿名数据不自动迁移，登录同一个 Google 账号后由服务端关联记录。清除应用数据等于换一个新匿名用户。
- 请求：`POST /api/chat` 用 multipart 表单，字段与网页的 FormData 相同（`message`、`sessionId`、`model`、`reasoning`、`webSearch`）。读不到模型列表时不带 `model` / `reasoning`，由服务端用默认值。
- 响应：`text/event-stream`，`data: "文本"` 是增量，`data: {"activity":…}` 是过程事件，新聊天的会话 ID 在响应头 `X-Session-Id`。解析规则与 `src/lib/chat-stream.ts` 保持一致。
- 错误文：服务端 API 返回的是英文原句（`msg()` 只做标记，网页端拿它当键用 `t()` 翻译），原生端目前原样显示，外面套本地化的"请求失败：…"。要让中 / 日界面显示译文，需要让服务端按请求语言翻译，或提供错误文词典给原生端（路线图第 2 步顺带做）。
- 首次启动：设备 Cookie 由第一个到达服务端的请求签发。App 先发会话列表请求，发送提问前会等它结束，否则 `/api/sessions` 和 `/api/chat` 各签发一个身份、后到的 Cookie 覆盖先到的，第一个聊天就读不回来。
- 同一时刻只认最新一次会话列表刷新和历史读取，被取消的在途请求结果会被丢弃；历史加载中不能发送。
- 流式请求不设读超时，思考型模型可能很久没有输出。停止生成会取消底层网络请求；切换聊天也会先停掉进行中的回答。停止后不用服务器版本覆盖屏幕，只有正常结束才对账。

## 附件与图片

流程和网页相同（`src/lib/client-chat-upload.ts`）：点发送后先上传附件，全部成功才把这条消息放进对话；上传失败时文字和附件都留在输入栏，并删掉已经传上去的文件。

1. `POST /api/uploads`（文件名、类型、大小）换回每个文件的存放路径和凭证（ticket），以及 `mode`。
2. `mode` 是 `blob`（线上，或本机配置了 `BLOB_READ_WRITE_TOKEN`）时：再向 `/api/uploads` 发 `blob.generate-client-token` 事件换一个只能写这一个文件的令牌，然后把字节直接 `PUT` 到 Vercel Blob（`https://vercel.com/api/blob/?pathname=…`，请求头 `authorization`、`x-api-version`、`x-vercel-blob-store-id`、`x-vercel-blob-access: private`、`x-content-type`、`x-content-length`）。这是网页用的 `@vercel/blob` 客户端的单次上传协议，App 里照着实现在 `StudyMateApi.uploadFile`；**升级 `@vercel/blob` 时要核对协议版本（现在是 12）**。`mode` 是 `local` 时直接 `PUT /api/uploads/local?ticket=…`。
3. 发送时把凭证放进表单的 `uploads` 字段（JSON 数组）：聊天走 `/api/chat`，「生成图片」模式走 `/api/images`（完成后一次返回图片，没有流）。

限制和提示文字与网页一致（`data/Attachments.kt` 对应 `src/lib/client-files.ts`、`upload-limits.ts`）：每条消息最多 10 个文件、单个 20 MiB、合计 100 MiB；图片只收 PNG / JPEG / WEBP，当前模型不能读图时不能附图（打开「生成图片」时可以）。一次选的文件有问题就整批不加。

和网页的差别：网页的文件选择框在手机上可以直接拍照，原生版用系统文件选择器，暂时没有单独的拍照入口；生成的图片还不能保存到相册。

## 笔记

列表、项目和回收站是原生界面，直接调用网页用的接口（`data/Notes.kt`、`StudyMateApi`）：`GET /api/pages`、新建 `POST /api/pages`（和网页一样发空白的 Untitled）、移到回收站 `DELETE /api/pages/:id`、移到项目 `PUT /api/pages/:id/group`、项目 `POST /api/pages/groups` 与 `PATCH / DELETE /api/pages/groups/:id`、回收站 `GET / DELETE /api/pages/trash`（清空时带 `before=` 最新一条的删除时间）、`POST / DELETE /api/pages/trash/:id`。项目折叠状态存在本机（网页存在 localStorage）。

编辑器仍是网页的 BlockNote：编辑页的 WebView 打开 `<baseUrl>/note-embed?page=<id>&lang=<zh|ja|en>`（网页只渲染笔记正文，没有网页的顶栏和侧栏）。加载前先清空 WebView 的 Cookie，再把 App 的 Cookie（`studymate_device`、Auth.js 会话）拷进 `CookieManager`，所以身份与 API 相同，退出登录后网页也不会沿用旧会话。JS 桥约定见 `src/lib/native-bridge.ts`，两边一起改：

- 网页 → App：`window.StudyMateNative.postMessage(json)`，消息 `ready`（页面数据读好；带页面 id，冲突后"另存为新笔记"时网页换到副本并用副本的 id 再发一次，App 把打开的笔记换成副本，WebView 不重新加载）、`meta`（标题 / 图标变了，原生顶栏和列表即时更新）、`saveState`（`saved / saving / unsaved / error / conflict`，顶栏显示"已保存 / 正在保存… / 未保存 / 保存冲突"）、`missing`（笔记不存在或已在回收站，或编辑中保存返回 404：直接关闭并刷新列表，草稿留在 WebView）、`trashed`、`flushed`。
- App → 网页：`window.studymateEmbed.flush("<requestId>")`，网页保存后回 `{type:"flushed", requestId, ok, kept?}`；`openHistory()` 打开网页的版本历史。
- 离开笔记（"<"、返回键、切换到别的笔记、切到聊天、新建、移到回收站当前笔记）前先 flush，`ok` 才离开；不 ok（或整个 flush 15 秒没结果、WebView 中途被销毁）就留在笔记里，显示网页的"保存失败，草稿已保留。"（移到回收站时显示"请先处理未保存的草稿…"，且不移）。`kept` 为 true（断网、服务器出错，草稿已存进 WebView 的 localStorage，不是冲突）时，提示之后再操作一次就放行，和网页 `/app` 一样不把人困在笔记里；冲突则一直留在笔记里。编辑器还没挂上（`studymateEmbed` 不存在）时没有可保存的编辑，直接离开。
- 登录、退出前也先 flush（趁 WebView 还带着旧身份的 Cookie），存不上也继续；身份换了以后关掉编辑器，排着的打开 / 新建作废。
- 编辑页按"最初打开的页面"分（`OpenNote.editor`），消息也按它转发；副本替换后 `OpenNote.id` 变成副本，换语言重新加载时用副本的地址。
- WebView 的渲染进程被系统杀掉或崩溃时（`onRenderProcessGone`）不让整个 App 退出：丢掉这个 WebView，换一个新的重新加载，没保存的编辑由网页的本地草稿恢复。
- 返回键先交给网页：WebView 能后退就后退；有打开的 `<dialog>`（版本历史等）就发 `cancel` 事件关最上面一层（原生调用打开的面板没有用户手势，浏览器不一定为它留历史记录）；都没有才保存并回列表。返回顺序：笔记 → 列表 → 聊天 → 退出。
- WebView：开 JS 和 DOM Storage、禁止混合内容、不允许 file/content 访问；只有本站的 `/note-embed` 在 WebView 里打开，其它链接交给系统浏览器；图片 / 文件块用系统文件选择器（`onShowFileChooser`）；只有 debug 包能用 Chrome 调试 WebView。

本机验证时注意：Next 开发服务器默认拒绝来自 `10.0.2.2` 的开发资源请求（`allowedDevOrigins`），编辑器会停在"正在加载笔记…"。模拟器里用 `adb reverse tcp:3000 tcp:3000` 并用 `-Pstudymate.baseUrl=http://localhost:3000` 构建即可。

## 构建与测试

```bash
cd mobile/android
# local.properties（不提交）里写一行：sdk.dir=A\:/Android/Sdk（使用正斜杠）
./gradlew testDebugUnitTest assembleDebug          # 产物 app/build/outputs/apk/debug/app-debug.apk
```

- 交付用 release 包：`./gradlew assembleRelease`（R8 压缩后约 2 MB，产物 `app/build/outputs/apk/release/app-release.apk`）。它暂时用 debug 密钥签名，能直接侧载安装；Drive 连接器单个文件上限 10 MB，20 MB 的 debug 包传不上去。文件名和上传规则见 [android.md](android.md#安装包交付)。
- 默认连线上 `https://studymate-lab-ai.vercel.app`。连电脑上的开发服务器：`./gradlew assembleDebug -Pstudymate.baseUrl=http://10.0.2.2:3000`（笔记编辑器要用上面"笔记"一节的 `adb reverse` + `localhost`）。明文 HTTP 只在 debug 包允许，且只限 `10.0.2.2` / `localhost`（`src/debug/res/xml/network_security_config.xml`）。
- 模拟器里要先 `adb install -r app-debug.apk`。Windows 上用 `emulator -avd <名字>` 启动前设置 `ANDROID_AVD_HOME=C:\Users\<用户>\.android\avd`。

## 路线图

1. ✅ 聊天（本阶段）。
2. 附件与图片：✅ 文件选择上传和「生成图片」模式；还差拍照入口、生成图片的保存；服务端错误文的中 / 日译文；推理、搜索、笔记工具的进度条；笔记编辑提案卡片。
3. ✅ 笔记：原生笔记列表、项目（分组）、回收站；编辑器用 WebView 加载网页的 `/note-embed`，通过 JS 桥同步标题、保存状态、离开前保存和返回键。还差：拖动排序、侧栏行里改图标、搜索。
4. 账号：已有 Credential Manager Google 登录、退出和修改显示名，沿用 `/api/native-auth/*`（受众仍是 Web 客户端 ID），需完成真实账号流程验证。Google Cloud 使用 `StudyMate-Android`（包名 + debug 签名）；换电脑或正式密钥后需登记新指纹。
5. ✅ 替换 Capacitor 外壳：外壳代码已删除；同一包名、同一签名覆盖安装。匿名数据不跨 Cookie 迁移（开发阶段不做）。
