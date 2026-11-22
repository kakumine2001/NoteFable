# 原生 Android 界面（Kotlin / Compose）

> 目录：`mobile/android/`。这是唯一的 Android 客户端；原来的 Capacitor 外壳已删除，原生版的应用 ID 是 `com.kakumine.notefable`。开发环境与 APK 交付规则见 [android.md](android.md)。

## 为什么是"混合原生"，不是全部重写

结论：**聊天和导航原生化，笔记编辑器继续用 WebView**。

- 手感差距主要出在高频、贴手的地方：流式回答的滚动与重绘、输入框与软键盘、侧边栏手势、底部抽屉、返回键。这些用 Compose 做能直接拿到原生的 120Hz 渲染、预测性返回和系统文字选择，WebView 里很难补齐。
- 服务端已经是干净的 REST + SSE（`/api/sessions`、`/api/chat` 等），原生客户端可以直接复用，不需要改后端。
- 笔记编辑器是 BlockNote（自定义块、图片/文件块、拖拽、历史版本）。原生重写工作量大、很难和网页保持一致，收益远低于聊天，所以保留 WebView，只把列表、导航、顶栏做成原生（见路线图）。
- 全部重写会让 Android 和网页两套界面长期各自维护，并且失去"网站更新后 App 不用重新打包"这一点。聊天界面稳定后再接受这个代价，笔记编辑器不接受。

## 现状

已有：聊天列表抽屉、历史消息、流式回答（SSE，约 40ms 合并一次刷新）、Markdown 渲染、复制回答、模型与推理强度选择（`GET /api/models`，服务器用 `NOTEFABLE_MODELS` 决定开放哪些，见 [deployment.md](deployment.md)；读不到接口时用安装包自带的内置列表）、停止生成、与网页一致的 17 种界面语言 + 自动检测（含阿拉伯语 RTL，见下文“界面语言”）、持久化 Cookie（匿名设备身份）。

Markdown 异步解析下一段流式内容时保留上一帧，避免反复显示空白加载态；有序列表保留原文的起始编号，与网页一致。

另有 Credential Manager Google 登录、退出、修改显示名和头像（照片 / 表情，见下文“账号头像”）的代码，沿用 `/api/native-auth/*` 和 `/api/account`，真实账号登录流程仍需单独验证。附件（文件选择、上传、发送）和「生成图片」模式已有，见下文“附件与图片”。笔记（列表、项目、子页面、收藏、页面菜单、回收站、拖动排序、WebView 编辑器）已有，见下文“笔记”。回答的过程面板、提案卡片、代码块等见下文“回答体验”。上限时的草稿恢复与登录提示、滚动到底部按钮、粘贴图片和拍照见下文“输入栏与使用上限”。搜索、跳转到消息和聊天链接见下文“搜索与跳转”。登录入口已对齐为「登录」按钮 + 弹窗，按服务端配置提供 Google / 邮箱验证码（`ui/SignInDialog.kt`）；登录后点侧栏的账号行打开设置（`ui/SettingsDialog.kt`，两级：入口的一览 → 通用 / 个性化 / 方案 / 账号各自的页面）。发言可以添加自己的笔记（“添加页面”），输入栏“＋”抽屉可以把聊天整理成笔记（“整理成笔记”），见下文“附件与图片”和“整理成笔记”。这些是当前源码能力，不代表已安装 APK 自动获得更新；交付状态以实际构建、运行验证和 Drive 上的包为准。

## 与网页界面保持一致

原生界面不是另起一套设计，而是网页手机视口（412×915）的复刻。规则：先在网页里量，再在原生里照着写，不凭感觉改。

- **数值来源**：网页 `src/app/globals.css` 与组件，用浏览器在 412×915 下读取真实的位置和样式。原生里 1dp = 网页 1 CSS px。
- **文案**：沿用网页字典（空列表、加载失败也用网页已有的句子，没有就不另写）（`src/lib/i18n/messages/*.ts`），英文原句就是 `res/values/strings*.xml` 的内容；`values-zh`、`values-ja` 手工维护，`values-b+zh+Hant` 由 `scripts/gen-native-zh-hant.ts` 生成，其余 13 种语言（`values-ko`、`values-es`、`values-fr`、`values-de`、`values-pt-rBR`、`values-it`、`values-in`、`values-vi`、`values-th`、`values-hi`、`values-ar`、`values-tr`、`values-ru`）由 `scripts/gen-native-strings.ts` 从 `res/values` 与网页字典生成。网页新增或改写文案时，修改 `res/values`、`values-zh`、`values-ja` 和网页字典后重新运行生成脚本，`src/lib/native-language.test.ts` 会校验全部 17 套 XML 的键、占位符和转义。
- **文案文件按批次分开**：`strings.xml` 是早期界面的文案，之后每一批功能把新文案放进自己的 `res/values/strings_<批次>.xml`（例如 `strings_answers.xml`、`strings_search.xml`），各语言目录里放同名文件，键一一对应。同一个句子只放一处，后面的批次直接引用已有的键，不重复定义。
- **服务端发来的文字**不进 `strings*.xml`，见下文“与服务端的约定”里的系统文词典。
- **颜色**：`ui/Theme.kt` 的 `Sm` 对象，逐项对应 `--nf-*` / `--notion-*`。有浅色、深色两份色板（`LightSmPalette` 取自网页的 `:root`，`DarkSmPalette` 取自 `:root[data-theme="dark"]`），`Sm.*` 读的是当前外观的那一份，只在一种外观下不同的零散颜色用 `Sm.pick(浅, 深)`。**不要把颜色存进文件顶层的 `val`**（只在类加载时读一次，之后不跟着外观变）：写成 `get()` 或在组合里读。外观的选择见“账号头像”一节的“外观”。
- **图标**：网页用 lucide，原生版 `ui/Lucide.kt` 直接用同一份路径数据绘制；7 个预设 AI 角色（Foldie、Piko、Velo、默认的 Quill、Sora、Loop、Orbit）由 `scripts/gen-native-characters.ts` 从 `src/lib/characters.ts` 生成 `data/Characters.kt`，经 `ui/Mascot.kt` 的 `CharacterGraphic` 绘制；Android 自适应启动图标、网页标签页和官网品牌标志统一使用默认角色 Quill。`/app` 移动端界面 `import` 的图标以及拍照、设置、置顶等后续要用的图标已一次性收进 `Lucide.kt`；没收的是只在 BlockNote 编辑器里用的、落地页 `thread-landing.tsx` 的（ArrowRight、BookOpen、NotebookPen）、桌面端侧栏开关 PanelLeft，以及笔记封面按钮的 ImageIcon（`note-page-header.tsx`，目前在 WebView 里由网页自己画）（从 lucide-react 渲染同名组件，circle / rect / line 换成等价 path），名字与网页的 import 相同；缺新图标时用同样方法补，不手画。
- **字体**：网页的字体栈在安卓上落到 Roboto（日文 / 中文用系统 Noto CJK），原生版用系统默认，所以一致。等宽的角色标签网页用 Geist Mono，原生版先用系统等宽，没有内置字体文件。

| 位置 | 网页数值（CSS px） | 原生 |
|---|---|---|
| 顶栏 | 高 56，左右 10.4；图标按钮 40×40、图标 20、圆角 4.8；标题 14 灰 | `TopBar` |
| 空白首页 | 左右 24；AI 角色形象 64 × 68、下距 14.4（默认 Quill 或所选角色 / 静态上传图片；角色按 `idle / typing / thinking / responding / completed / error / hidden` 状态机驱动出场、浮动、眨眼与视线反馈，系统关掉动画或退到后台时静止；网页的"眼睛跟鼠标"触屏没有）；图标框 41.6 + 标题 32 粗体、字距 −0.04em、行高 36.8；说明 17 / 27.2 灰，上距 8.8；整体垂直居中。网页输入框下面的起手提示只在 ≥ 640 宽出现，手机宽度和原生都没有 | `EmptyState`、`Mascot` |
| 提问气泡 | 上方没有标签；气泡圆角 14、`#F3F5F9`、内边距 12×16、字 **15 / 行高 28**；图片缩略图 128、圆角 4，在文字上方；非图片附件是块下方的文件标签 | `UserTurn` |
| 提问的操作行 | 上距 6.4、整体左移 10.4；依次是版本切换、复制、编辑，按钮 36×36、圆角 4.8、间距 2、图标 16（线宽 1.9）灰色；只给已保存的提问显示，生成图片的那一轮没有编辑 | `UserTurnActions` |
| 版本切换 | `‹ 2/3 ›`：两个 36 的箭头按钮（ChevronLeft / ChevronRight 16）夹着 13 号灰色数字（最小宽 28、居中）；到头或聊天在生成时箭头是 `.36` 灰、不能点 | `VersionNav` |
| 改写提问 | 在气泡里直接编辑：文字 15 / 28、透明底、最高 40% 屏高；下面靠右“取消”“发送”两个按钮（`.notion-button` / `.notion-button-primary`），上距 8、间距 8；返回键取消 | `UserMessageEditor` |
| 回答 | 标签 = 角色 / 上传图标 32（默认 Quill，当前回合带实时状态反馈）+ 间距 8 + 模型名（正文字体 13、500 字重、灰色；下距 8.8；不重复显示 `"NOTEFABLE"` 品牌字样，无障碍读屏保留 `"AI reply"`）；正文 16 / 行高 27.52；标题 650 字重；链接蓝色加粗下划线；回合间距 36；复制按钮 36×36，距正文 6.4 | `AssistantTurn`、`AnswerMarkdown` |
| 输入栏 | 外边距 10.4、上 12、下 max(16, 安全区)；白底、1px `rgba(55,53,47,.18)`、圆角 16、内边距 10、浮起阴影；聚焦时描边变蓝并带 3px 浅蓝光圈；输入框最小高 40，字 16/24 | `Composer` |
| 输入栏的 ＋ | 40×40 图标按钮、圆角 4.8、图标 18（描边 1.8）灰色；右边 6 处接模型按钮 | `Composer` |
| ＋ 抽屉 | 与模型抽屉同款外框；行高 ≥60、圆角 11.2、内边距 6.4×13.6、图标 22、间距 14.4；标题 17 半粗、说明 14 灰；打开「生成图片」时该行灰底加 ✓ | `AttachSheet` |
| 待发送附件 | 输入栏上方，间距 8、下距 12；图片 96×96、圆角 6、1px 描边，右上 6 处 24×24 半透明黑底移除键（✕ 15）；其他文件是 12 灰字标签（回形针 13 + 文件名 + ✕ 13，内边距 10×6），点一下移除 | `PendingFiles` |
| 附件状态行 | 输入栏下方 8 处、12 灰字：“已附上 n/10 · 总大小”；上传时再加一行进度 | `ComposerStatus` |
| 提示条 | 输入栏上方、下距 12；浅红底 `rgba(255,226,221,.65)`、字 12.8 `#933b34`、圆角 4.8、内边距 8.8×10.4 | `ComposerError` |
| 生成图片标记 | 输入框上方、高 32、全圆角、浅蓝底 `rgba(35,131,226,.12)`、蓝字 14/500，图标 16 + 文字 + ✕ 14，点一下关闭 | `ImageModeChip` |
| 生成中占位 | 最宽 448、1px 描边、圆角 5.6；头部高 ≥56（图标框 30.4 + 两行说明 + 三个跳动的点），下面 16:9 浅灰画布和 2px 蓝色进度线 | `GeneratingImagePreview` |
| 模型按钮 | 高 40、全圆角、`#F1F1EF`、字 15/500、左右 13.6、"模型名 + 灰色强度 + ⌄" | `ModelPill` |
| 发送键 | 40 的圆；可发送：深色底白箭头（24，描边 2.1）；不可发送：`.08` 灰底；回答进行中换成停止键：深色底、白色实心方块（边长 12、圆角 1.3） | `SendButton` |
| 模型 / 强度抽屉 | 顶部圆角 17.6，行高 ≥52、圆角 10.4、选中灰底加粗加 ✓；强度三列网格、选中蓝底白字；说明 14 灰；"完成"按钮 48、深色 `#37352F` | `ModelSheet` |
| 侧边栏 | 宽 240、`#F7F7F5`；头部高 48；下面 Chat / Note 切换（左右 8、上距 4）；"新聊天 / 新笔记"按钮上距 12、高 44、圆角 8、深色、左对齐（图标 16 + 8 + 16/550 白字）；聊天行高 44、圆角 6.4，当前行浅蓝底加左侧蓝条 | `AppDrawer`、`ChatDrawerBody` |
| Chat / Note 切换 | 高 48、底色 `.12` 灰、圆角 8、内边距 2、间距 2；每键高 44、圆角 6.4、16/500、图标 16 + 6.4；选中白底、墨色字、蓝色图标、1px 细环 + 浅阴影。空白聊天页和笔记首页在顶栏下方（左右 24、上距 4），抽屉里在头部下方 | `WorkspaceSwitch` |
| 侧栏笔记部分 | "PROJECTS / NOTES"12 等宽大写灰字（上 14.4、下 4.8），"新项目"40 按钮（图标 15）；项目行高 44：箭头 14、文件夹 15、名称 14/500、数量 12 浅灰，右侧铅笔 13 / 垃圾桶 14 两个 25.6 小按钮；组内笔记左距 12 + 1px 竖线 + 内左距 4；笔记行高 44：图标区 40（表情 / 文件图标 15），标题 14，右侧"移到项目""移到回收站"25.6 小按钮（触屏常显）；最下方"回收站"行高 44、图标 16 + 8.8、16/500 | `NotesDrawerBody` |
| 笔记首页 | 左右 24、下 96；"Notes"32/750、行高 48、字距 −0.04em、上 8 下 12；项目小标题 13/600 灰 + 数量 13 浅灰（外边距 20/4/4）；行最小高 56、下边 1px 线：图标区 28（表情 / 图标 20 浅灰）、间距 13.6、标题 17/500、日期 13 灰（`MMMd`）、右侧 44×48"移到项目"（图标 18 浅灰）；"新笔记"高 40 + "新项目"文字按钮 12.8/500 | `NotesHome` |
| 笔记空状态 | 上距 120；文件图标 28（线宽 1.4、浅灰）；"Notes"40/750、行高 50、上 16；说明 15/24 灰（"/"等宽键帽）；"新笔记"高 32、上 24；存储说明 12/20 浅灰、上 40、最宽 384 | `NotesEmpty` |
| 笔记编辑页顶栏 | 高 56、左右 10.4：菜单 40、间距 12、"<"40（图标 22）、间距 12、图标 15 + 6 + 标题 14 灰；右侧搜索 40、间距 8、（锁定时）锁按钮高 32（Lock 14）、间距 8、分享按钮高 32（Globe 15，已公开为蓝色）、间距 8、版本历史 40（图标 20）、间距 8、保存状态 14 灰（出错 / 冲突 `#b45309`）、间距 8、“…”页面菜单 40（Ellipsis 20，菜单宽 248） | `NoteEditorScreen`、`NoteShareDialog` |
| 笔记对话框 | 宽 min(100% − 48, 400)、内边距 24、圆角 8、遮罩 `rgba(15,15,15,.2)`；标题 16/600、说明 14 灰；输入框 1px 深描边、圆角 6、内边距 8.8×11.2、聚焦 2px 蓝；选项行 ≥40、圆角 6、15 字，当前项灰底 600 + ✓；按钮 ≥32、圆角 4.8、12.8/500，危险操作红字 `#b91c1c` | `NotesDialog` 等 |
| 帮助菜单 | 侧栏底部账号行右边的“?”（44×44、圆角 6.4、17 的 CircleHelp），点了在上方开菜单（宽 228）：关于、隐私政策、服务条款、特商法标示，未登录时加语言项 | `HelpMenuButton`（`HelpMenuUi.kt`） |
| 账号行（登录后） | 侧栏底部，四周 8；高 44、左右 8、圆角 4.8、间距 8.8：头像 22、名字 16、齿轮 15（`--notion-faint`）；点了打开设置 | `ProfileRow`（`AccountUi.kt`） |
| 设置 | 全屏、灰底 `#F7F7F5`，两级：入口的一览 → 点了的那一栏自己的页面。顶栏最小高 64、左右 16，三列 40 \| 剩下 \| 40、间距 8：左边圆形按钮 40（白底、1px 细线、全圆角；一览上是关闭 X 18，页面上是返回 ArrowLeft 20），标题居中 17/650（一览是“设置”，页面是栏名），右边一列空着；内容左右 16、上 8、下 32；卡片白底、1px 细线、圆角 20（带内边距的 16）。一览：账号行（卡片，内边距 14×16、间距 14：头像 44、名字 17/600 墨色一行、下隔 2 邮箱 14 灰一行、ChevronRight 18 `--notion-faint`），隔 24 是四行的卡片（通用 SlidersHorizontal、个性化 PenLine、方案 CreditCard、账号 CircleUser；每行最小高 56、内边距 10×16、间距 14：图标 20 正文色、名字 16/500、ChevronRight 18；行间 1px 细线从起始边 50 处画到结束边）。页面没有栏标题：通用（语言一行：最小高 56、内边距 10×16、标题 16/500，右边选择按钮高 40、圆角 8、15 字 + ChevronsUpDown 14；图标一行 + 40 的圆形预览 + 小按钮）、个性化（自定义指令：标题 15/500、输入框最小高 240、圆角 10）、方案（“NoteFable”17/650 + 徽章，用量条高 6）、账号（个人资料：头像 56 + 间距 16 + 名字输入框高 44 圆角 8、邮箱 13 灰、编辑区圆角 10；隔 24 是退出登录 / 删除账号两行：最小高 56、图标 16 + 12 + 16/500）。换画面：滚动区 200ms `cubic-bezier(0.2, 0.8, 0.2, 1)` 淡入并横移 16（页面从结束边、一览从起始边进来，RTL 相反）。小按钮：高 40、左右 14、全圆角、1px 深描边、14/500。“未保存的更改”条：离边 16、最小高 52、圆角 14、墨色底，按钮高 40、圆角 10 | `SettingsDialog`、`SettingsNav.kt`、`SettingsParts.kt`、`LanguageSettings` |
| 回收站 | 底部全宽面板、顶部圆角 16；头部内边距 12/12/12/16 + 下边 1px 线；"清空回收站"红字、关闭 40；说明 13/18.85 灰；行内边距 6.4×8：图标 24（表情 17）、标题 15/500、时间 12 灰；按钮高 44、15/500、左右 16，在下一行靠右 | `TrashSheet` |

**有意不放的网页控件**（原生版还没有对应功能，不放不能用的入口）：笔记侧栏里正打开着的那篇笔记的图标按钮（网页点它也弹选择器，经编辑器自动保存；原生版要先给 WebView 编辑器加改图标的桥接口，现在只显示图标，在编辑器里改）。笔记编辑页没有网页以外的"更多"菜单：移到回收站和网页一样在侧栏的笔记行上。做到对应功能时再按网页补上。`/api/models` 不可用时使用安装包里的 `assets/models.json`；接口返回服务器开放的模型，资源是 `src/lib/models.ts` 的内置列表；两者都不可用时才隐藏模型按钮。

改动模型定义后运行 `npx tsx scripts/gen-native-models.ts` 更新打包资源；`src/lib/native-models-asset.test.ts` 检查资源与内置列表是否一致。App 里不写死模型：开放哪些由服务器的 `NOTEFABLE_MODELS` 决定。

## 目录

```
mobile/android/
  app/src/main/java/com/kakumine/notefable/
    MainActivity（唯一的 Activity：语言、外部链接）、NoteFableApp（Application：Cookie jar、接口、App 级的 Store）
    auth/   GoogleIdToken（Credential Manager 取 Google ID 令牌）
    data/   NoteFableApi（各接口）、NoteFableHttp（共用的 OkHttp 客户端、JSON 请求、ApiException）、PersistentCookieJar、
            ChatStream（ChatStreamParser）、Dto、ChatBackend / AccountBackend（ViewModel 依赖的接口）、SystemText（服务端系统文的译文）、Activity（回答的过程与提案）、ProposalApi（提案的应用 / 放弃与状态）、ExportApi（回答存到笔记、下载对话）、ImageSaver（生成图片存相册）、Notes（笔记 DTO、NotesBackend、JS 桥消息）、
            IdentityGate（身份确定前只放一个请求）、NoteFiles（笔记文件链接与下载）、AccountApi（改资料、上传头像）、
            AppLanguage（界面语言）、AppIcon / Characters（图标与预设角色）、Attachments（附件限制）、UsageLimits、PlayBilling（Play 结算）、ReportApi（报告回答）、
            SessionsApi / ProjectsApi（侧栏的聊天与项目）、NoteIconApi、SearchApi / SearchFold / ChatLink（搜索与聊天链接）、ChatQuote（引用追问）、MathMarkdown（公式）、EmojiCatalog（表情数据）
    ui/     ChatViewModel（状态与流式逻辑）、NotesViewModel（列表、项目、拖动排序、回收站、离开前保存）、NoteFableRoot（抽屉、模式切换）、
            ChatScreen（顶栏、消息列表、输入栏、模型抽屉）、GuestLimitPrompt（上限登录提示）、AssistantTurn（一条回答）、AnswerMarkdown（正文、表格、公式）、AnswerActions（回答的"…"菜单）、ReportAnswerDialog（“报告回答”）、ChatActivity（过程面板）、ProposalCard、CodeBlock（代码块与高亮）、ChatSidebar（侧栏的聊天部分）、ReorderDrag（聊天和笔记列表共用的拖动排序）、
            AttachUi / AttachPagesDialog / CreatePageDialog / ChatRecentNotes（“＋”抽屉、添加页面、整理成笔记、最近编辑）、TurnActions（编辑、重新生成、版本切换、分支）、QuoteSelection（引用追问）、ChatFollow（跟随底部的规则）、
            ChatActions / ProjectSettings / SidebarViewModel / SessionIconSync（侧栏菜单、项目设置、聊天图标）、SearchScreen / SearchViewModel、EmojiPicker、
            NotesUi（侧栏笔记部分、首页、对话框、回收站）、NotePageMenu（编辑页“…”菜单）、NoteFileDownloads、AccountUi / AccountViewModel / AvatarCropper（账号行、个人资料、头像裁剪）、SignInDialog（Google / 邮箱验证码）、
            SettingsDialog / SettingsNav / SettingsParts（两级设置）、LanguageUi、AppIconSettings、PlanSettings（方案与购买）、DeleteAccountSection（删除账号）、HelpMenuUi（帮助菜单）、ThemeSettings（外观）、NoteMarkdownIo（笔记的 Markdown 导出 / 导入）、NoteEditor（顶栏 + WebView + JS 桥）、Mascot、SystemTextUi、Lucide、Theme
  app/src/main/assets/   models.json、system-text.json、usage-limits.json、emoji.json（都由 scripts/ 下的脚本从网页源码生成，不手改）
  app/src/test/   ChatStreamParser、ChatViewModel、NotesViewModel、SidebarViewModel、SearchViewModel、AccountViewModel、SystemText、ApiException、Activity、ProposalStore、AppLanguage、PlayBilling、代码高亮与表格列宽、表情与图标、笔记接口与桥消息、外观（`AppThemeTest`）与 Markdown 导入规则（`NoteImportTest`）等的单元测试（假后端 / MockWebServer，不联网）
```

- 应用 ID（`applicationId`）和 Kotlin 包 / `namespace` 都是 `com.kakumine.notefable`，名称 "NoteFable"。Google 登录用 Google Cloud 里登记的 Android 客户端 `NoteFable-Android`（按应用 ID + Play 应用签名登记），所以只有 Play 签名的包能用 Google 登录。服务器地址（`gradle.properties` 的 `notefable.baseUrl`）是工作区的主机 `https://app.notefable.com`；帮助菜单打开的介绍页和法律页面用 `notefable.siteUrl`（`https://notefable.com`，`BuildConfig.SITE_URL`）。服务端只在工作区主机提供 `/api/*` 和 `/note-embed`（[deployment.md](deployment.md)）。1.0.10 及以前的包（没有公开发布过）连的是 `notefable.com`，已经连不上，要更新；从那些版本升级上来不搬 Cookie，要重新登录，匿名数据从新身份开始。聊天链接（`ChatLink`）把 `app.notefable.com`、`notefable.com` 和 `www.notefable.com` 当成同一个站。
- minSdk 26，compileSdk / targetSdk 36，AGP 8.13.2，Gradle 8.14.3，Kotlin 2.3.21。AGP 至少用 8.13.2，其附带的 R8 才支持 Kotlin 2.3 元数据（[官方兼容说明](https://developer.android.com/build/releases/agp-8-13-0-release-notes)）。Compose BOM、OkHttp、Coil、Markdown 渲染库仍沿用当前固定版本；升级依赖时同时核对它们要求的 AGP、Gradle 和 SDK 平台。

## 与服务端的约定

- 身份：和网页一样靠 `notefable_device` Cookie（`PersistentCookieJar` 存在应用私有目录）。清除应用数据等于换一个新匿名用户。
- 请求：`POST /api/chat` 用 multipart 表单，字段与网页的 FormData 相同（`message`、`sessionId`、`model`、`reasoning`、`webSearch`）。读不到模型列表时不带 `model` / `reasoning`，由服务端用默认值。
- 响应：`text/event-stream`，`data: "文本"` 是增量，`data: {"activity":…}` 是过程事件，新聊天的会话 ID 在响应头 `X-Session-Id`。解析规则与 `src/lib/chat-stream.ts` 保持一致。
- 错误文与系统文：服务端 API 返回的是英文原句（`msg()` / `fmt()` 只做标记，网页端拿它当键用 `t()` / `localizeSystemText` 翻译）。原生端用安装包里的 `assets/system-text.json` 做同样的事（`data/SystemText.kt`，界面里用 `rememberSystemText()`）：整句命中词典就换成译文；命中 `SYSTEM_TEXT_TEMPLATES` 的句型（如 `Read “{title}”`、`Request failed: {detail}`）只翻译句型，标题、文件名、搜索词原样保留，`{detail}` 再翻一次；都不命中就显示英文原句。回答中途失败时服务端把"Request failed: …"接在正文后面，并在 activity 里记下位置（`failure`：offset + detail），原生端和网页一样只替换那个位置上的那句话，不从措辞猜测。连不上服务器（断网、域名解析失败、连接被拒或超时、TLS 握手失败）时，回答下方的失败原因不用 OkHttp 的英文原句（还带着主机地址），换成网页字典里的 "Check your connection and try again."（`chatFailureDetail`，显示为"请求失败：请检查网络连接后重试。"；网页这里接的是浏览器自己的英文 "Failed to fetch"）；服务端返回的错误照旧显示原句。目前用在回答的失败文、笔记与账号的错误提示，以及 429 使用上限：和网页（`chat-message.tsx` 的 `usageLimit` 分支）一样，上限句子替换回答正文、只用 `t` 翻译，按普通回答显示，不套「请求失败：」也不标红（`UiMessage.usageLimit`）。上限时恢复被拒的草稿和登录提示见“输入栏与使用上限”；笔记工具的完成标签在过程面板里同样经词典翻译。
  - 词典由 `npx tsx scripts/gen-native-system-text.ts` 生成：从 `src/app/api` 的路由沿 import 收集 `msg()` / `fmt()` 的句子，加上 `zh-server.ts` 的全部键和 `SYSTEM_TEXT_TEMPLATES`，译文取自网页的全部 16 种非英文语言的字典（缺译文时生成失败）。改了服务端的句子或字典后重新生成；`src/lib/native-system-text-asset.test.ts` 在资源过期时失败。
  - 错误响应解析成 `ApiException`（`data/NoteFableHttp.kt`）：`message` 是服务端原句（读不到时 "HTTP <状态码>"），429 使用上限另有 `code`（`usage_limit`）、`tier`、`kind`（`src/lib/usage-limits.ts`），`isUsageLimit` 判断是否是上限。
- 首次启动、登录、退出后：设备 Cookie 由第一个到达服务端的请求签发（退出后设备 Cookie 指向已绑定 Google 的用户，服务端会重新签发匿名身份）。几个请求同时发出的话会各签发一个身份，后到的 Cookie 覆盖先到的，前面那个身份下建的聊天 / 笔记就读不回来。所以 `NoteFableHttp` 的 OkHttp 客户端装了 `IdentityGate`（`data/IdentityGate.kt`，聊天、笔记、账号、附件图片、笔记文件下载共用）：身份未确定时第一个本站请求单独走，其它请求等它拿到响应（Set-Cookie 已存进 Cookie jar）再走；之后并行。登录成功和退出时 `reset()`，下一个请求又单独走；网络错误不算确定；`/api/models` 不读也不签发身份，不排队也不算确定（否则启动时它先回来就把闸门打开了）。聊天发送前另外还会等会话列表请求结束（`awaitSessionsRequest`）。
- 同一时刻只认最新一次会话列表刷新和历史读取，被取消的在途请求结果会被丢弃；历史加载中不能发送。
- 流式请求不设读超时，思考型模型可能很久没有输出。停止生成只停当前聊天：先请求 `POST /api/sessions/:id/stop`，由服务端结束流后按正常结束对账，请求不成功才取消底层网络请求（见下文“回答体验”）；切换聊天不停回答，见下文“后台生成”。

## 后台生成（每个聊天各自的回答）

和网页 `page.tsx`（`sessionMessagesRef`、`streamingSessions`、`migrateCachedMessages`）一样：切换聊天、开新聊天都不停掉正在生成的回答。实现都在 `ChatViewModel` 内部，公开接口没变，单元测试在 `ChatViewModelBackgroundTest`。

- 每个聊天一份消息缓存、一个发送任务（上传附件 + 回答），按会话 ID 存；界面的 `messages` 只是当前聊天那一份。还没有会话 ID 的新聊天用本机键，每开一次新聊天换一个（网页发送前先建好会话，原生版仍由 `/api/chat` 建，所以要靠这个区分两个新聊天）；`X-Session-Id`（图片模式是结果里的 `sessionId`）到了以后缓存和任务迁到真正的 ID 下，用户还在看它的话当前聊天也换成这个 ID。
- 服务端先建会话、稍后才回 `X-Session-Id`，这期间这个会话已经出现在侧栏，用户可能先打开它（读到的历史只有这次的提问）甚至又发了一条。迁移不覆盖已有的东西：读来的历史换成本机这份，之后在那边发的消息接在后面；两个任务都算这个聊天在发送，停止键两个都停。
- 新聊天在拿到会话 ID 之前就失败（网络错误、5xx、400、429 使用上限；图片模式只有成功才回会话 ID，所以任何失败都算），而用户已经离开了它：这个聊天在侧栏里不存在、也再打不开，所以提问和附件放回输入栏（排在等待期间新写的内容前面），不留缓存和草稿图标；上限时未登录照常显示登录提示（网页同样不看是否离开）。当前聊天正在上传附件时，放回要等这次上传结束（发出后输入栏清空再放回，失败或不发时接在输入栏内容前面），否则会被这次发送清掉。网页发送前先建会话，侧栏里能找回带错误的那个聊天；原生版只能这样补。用户还在看着时照常显示错误气泡，离开后就找不回了。
- `sending` 只表示当前聊天在发送，只决定发送键 / 停止键（以及发送后滚到底）；"生成中"的显示看各条消息自己的 `streaming` / `generatingImage`（在它所属聊天的缓存里），所以回到还在生成的聊天时直接从缓存显示出来。别的聊天在后台生成时这里照样能发。同一个聊天在回答结束前不能再发。停止键只停当前聊天。
- 回到生成中的聊天直接显示缓存里的实时状态，不读历史（服务器还没存下进行中的回答）。回到已有缓存的聊天先显示缓存，再静默换成服务器版本；没有缓存才显示加载中。静默读取失败时缓存照常显示，输入栏上方提示"加载聊天失败。"（网页 `Failed to load conversation.`）；会话已不存在（404，不论有没有缓存）时和网页一样解除绑定、当作新聊天，并给同一句提示。换聊天会清掉输入栏上方的提示（网页 `setSendError("")`）。
- 回答正常结束后只用服务器版本替换那个聊天自己的缓存（不管用户在看哪个），之后又在那个聊天发了新消息时丢掉旧快照。
- 上传附件期间换了聊天：和网页一样这条不发，删掉已传的文件，文字和附件留在输入栏；离开的是新聊天时不留它的缓存和草稿图标；离开后上传才失败也不在别的聊天里报"无法上传附件"（网页同样只在没换聊天时报错）。在还没发过东西的新聊天里点"新聊天"不算换聊天（网页 `createSession` 直接返回），上传照常进行、发出。上传进度是全局的，上传中哪个聊天都不能发（网页同样）。
- `ChatUiState.generatingSessionIds` 是所有在发送的聊天；侧栏据此不让删生成中的聊天（网页同样只禁止删除，侧栏不显示"生成中"标记，所以原生版也不显示）。
- 登录 / 退出时停掉所有聊天的回答并清空缓存，旧身份的半截回答不会再写进来。
- 任何一次用服务器版本替换某个聊天缓存（打开时的读取、重试、检索前补读、回答结束后的对账，前台后台都一样）都走 `carryLocalKeys` / `replacedLocalIds`，并调用 `onMessageIdChanged`：后台答完的聊天，“存到笔记”的状态同样搬到服务端 ID 下。
- 检索 / 链接定位（`openSessionAt`）在那个聊天自己的缓存里找；没有这条就保持“读取中”，等读到服务器版本再定位（刚打开的聊天本来就在静默读，本来开着的补读一次），生成中的聊天不重读。

## 界面语言

和网页一样启用全部 17 种界面语言（`en`、`zh`、`zh-Hant`、`ja`、`ko`、`es`、`fr`、`de`、`pt-BR`、`it`、`id`、`vi`、`th`、`hi`、`ar`、`tr`、`ru`）+ 第一项“自动检测”（显示当前实际语言）。对勾表示明确偏好，当前语言单独标注；菜单支持按原生名 / 代码 / 标签搜索与内部滚动，宽度 min(320dp, 屏宽 − 16dp)、最高 min(368dp, 屏高 − 16dp)。登录用户在设置里选，访客在侧栏帮助菜单里选。`res/xml/locales_config.xml` 按相同顺序登记全部 17 个标签，Android 13+ 系统应用语言设置自动提供“跟随系统”。

- `AppLanguage.localeFromTag` 与 Web 一样严格解析 BCP 47，兼容下划线、`in`→`id`（兼容旧版 Android `Locale.language` 返回 `"in"`）及 ISO 639-2/3 别名，中文脚本优先于地区，`pt` 各地区归一到 `pt-BR`。未知或未启用语言继续匹配系统列表下一项；无匹配再用保守的 IP 国家回退，最后英文。`AppLanguage.resolveLocale` 是可测试的纯函数规则。
- 本机明确选择由 `AppCompatDelegate.setApplicationLocales` 保存，Auto 清空该列表。`MainActivity` 在 Auto 时归一化系统语言并就地设置资源和布局方向（`Configuration.setLayoutDirection` + `window.decorView.layoutDirection`）；系统列表没有匹配时请求 `/api/i18n?preference=auto&format=locale`（发送原始系统语言列表，不带账号 Cookie），由服务端做 IP 推断，结果只缓存在当前 Activity，不写入明确偏好。
- 资源实际语言取 `strings_i18n.xml` 的 `ui_locale`。API `Accept-Language`、`assets/system-text.json`（覆盖全部 16 种非英文语言）和笔记 WebView 的 `lang` 都跟它走。`MainActivity` 就地更新配置而不重建 Activity，保留草稿、附件、会话、流式回答及笔记编辑；打开的笔记通过 `notefableEmbed.language(code)` 就地换字典（同时在 WebView 内同步 `dir`）。
- **阿拉伯语 RTL**：`AndroidManifest.xml` 开启 `android:supportsRtl="true"`；切到 `ar` 时 Compose `LocalLayoutDirection` 变为 `Rtl`，`ModalNavigationDrawer` 从右侧抽入；`Lucide.kt` 自动水平镜像方向性图标（返回、前进、折叠箭头、收起侧栏、移入文件夹、退出登录），过程面板与提案卡片展开箭头按方向旋转，侧栏激活蓝条、子页面竖线及浮动菜单位置随 `LayoutDirection` 镜像；阿拉伯脚本标题和标签设 `letterSpacing = 0.sp` 保护连写，代码块、独立数学公式和 6 位验证码输入框固定 `LayoutDirection.Ltr`。
- `AccountLocaleSync` 只随账号状态变化；账号 `null` 是权威 Auto，缺字段（`LOCALE_UNKNOWN`）保持不动，未登录保留本机选择。退出 / 删除账号后清空本机偏好。
- 资源生成：繁体由 `npx tsx scripts/gen-native-zh-hant.ts` 从 `values-zh` 生成；新增的 13 种语言由 `npx tsx scripts/gen-native-strings.ts` 从 `res/values` 与 Web 字典生成（印尼语使用 Android 标准资源目录 `values-in`，巴西葡语使用 `values-pt-rBR`）；服务端系统文由 `npx tsx scripts/gen-native-system-text.ts` 生成。
- 验证：`native-language.test.ts`（255 份 XML 格式、键集合、占位符与 `locales_config.xml` 校验）及资源一致性测试；Android 的 JUnit 由 PR 检查（`android-pr.yml`）运行；真机 RTL 手感待验证。

## 侧栏：置顶、聊天项目与整理

和网页 `chat-sidebar.tsx` / `chat-actions.tsx` / `chat-project-settings.tsx` 一一对应（数值在 412×915 下量，写在 `ui/ChatSidebar.kt`、`ui/ChatActions.kt`、`ui/ProjectSettings.kt` 的注释里；文案在 `strings_sidebar.xml`）。

- 抽屉头部右侧有"关闭侧栏"（PanelLeftClose 17，40 按钮），聊天和笔记两边都有。
- 列表顺序：Pinned（有置顶时）→ PROJECTS（右侧 ＋ 新建项目）→ 各项目（可折叠，折叠状态只在内存里，和网页一样）→ CHATS。组内按置顶、position、更新时间排序（`orderedSessions`）。项目里没有聊天时显示 "No chats"，全都置顶了显示 "All chats pinned"；项目有共通指示 / 参考笔记时名称后加 ScrollText 小图标。
- 聊天行：图标、标题（长按后拖动排序）、"更多"。行上没有单独的置顶按钮，置顶收在"更多"菜单里。"更多"菜单（从右上角 140ms 展开，系统关掉动画时不动）：置顶 / 取消置顶（点了就保存，`SidebarViewModel.setPinned`；成功关菜单，失败留着、在菜单下面显示原因，保存中不能关）、改名（最多 120 字）、移到项目（含"＋ 新项目 / 创建并移动"，建好但移动失败时项目保留）、删除（确认；删的是正在看的聊天时回到新聊天；回答生成中不能删）。项目菜单：项目设置、改名（60 字）、删除（聊天保留并移到 Chats）。返回键先关菜单和对话框；请求进行中对话框不能关（网页 run() 锁住窗口），免得结果到了本地列表却没更新。
- 项目行的 ＋：正在看的是空的新聊天时不多建——同一项目直接用，别的项目（且没置顶）就移过来；否则 `POST /api/sessions {projectId}` 新建并打开。失败时抽屉不关，原因显示在 PROJECTS 下面（网页显示在输入栏上方，原生版输入栏属于别的批次）；下次打开抽屉时清掉。
- 项目设置：共通指示（计数 n/4000）、参考笔记（筛选、勾选最多 `MAX_PROJECT_NOTES` 篇、已选标签、一次最多列 100 篇），保存时只发改了的字段（`projectSettingsChanges`）。加载失败和网页一样先看项目详情：详情读不到是 "Could not load the project settings."，笔记读不到是 "Could not load your notes."，服务端给了原因就用原因。
- 拖动排序：没有单独的把手，长按标题区后拖（与网页触屏一致，开始时有一次长按触感反馈），放到别的行前 / 后走 `POST /api/sessions/reorder`（跨组时服务端顺便改项目和置顶），放到项目行或 CHATS 标签上是移进该项目并取消置顶。长按之前的滑动照常滚动列表；长按开始后拖动被吃掉，不会同时触发抽屉的横滑关闭和列表滚动；手指在列表上下边 30 以内移动时每次移动滚 12（和网页一样，手指不动就不滚）。正在移动的那一行不能拖，别的行照常能拖；排序请求同一时间只做一次，上一次没完时再排序提示 "Wait for the previous move to finish."（拖进项目走普通更新，不受这个限制，和网页一样）。折叠 / 删除后离开列表的行不再参与命中。网页的键盘上下移动在原生版没有。
- 接口：`data/SessionsApi.kt`（PATCH / DELETE / POST `/api/sessions`、reorder）、`data/ProjectsApi.kt`（`/api/chat-projects`，参考笔记候选来自 `GET /api/pages`）。状态在 `ui/SidebarViewModel.kt`；会话列表本身仍在 `ChatViewModel`，成功后通过 `patchSessions` / `onSessionDeleted` / `openCreatedSession` 更新。打开抽屉时同时刷新会话和项目；本地改了项目列表时若有刷新在进行就再刷一次（和 `patchSessions` 一样），免得旧结果盖掉新改动；登录 / 退出后丢弃旧身份的结果。单元测试：`SidebarViewModelTest`、`SidebarApiTest`。

## 表情选择器与聊天 / 笔记图标

网页的选择器是 emoji-picker-react（`src/components/emoji-picker.tsx`、`full-emoji-picker.tsx`），原生版 `ui/EmojiPicker.kt` 照着它画（412×915 下量的值写在文件开头的注释里），文案在 `strings_emoji.xml`。

- **数据**：`assets/emoji.json` 由 `npx tsx scripts/gen-native-emoji.ts` 从同一个 npm 包生成（表情、分类顺序、肤色变体、包内支持的全部 14 种界面语言的搜索关键词，以及分类图标、放大镜和清除图标的路径；包内无关键词文件的 `id`、`ar`、`tr` 自动回退到英文关键词），不手改；升级 emoji-picker-react 后重新生成，`src/lib/native-emoji-asset.test.ts` 检查是否过期。读取和搜索在 `data/EmojiCatalog.kt`：关键词按界面语言（`ui_locale`）选；搜索是去空白、转小写后"任一关键词包含"（与包的 `normalizeQuery` + `includes` 相同）；本机字体画不出来的表情不显示（`Paint.hasGlyph`，网页同样隐藏浏览器不支持的表情）。
- **界面**：弹出框宽 min(408, 屏宽 − 24)、高 36 + min(380, 屏高 − 60)，位置照网页 `floatingPositionFor`（按钮下方 6，放不下就上方，离屏幕边至少 12），打开时和 `.notes-popover` 一样淡入上移（120ms）。顶部条是 Emoji + 当前表情（选中标记）、Random（换一个、不关）、Remove（去掉并关闭）；下面是搜索框、肤色（点开展开 6 个）、9 个分类图标（space-around；搜索框有字时变淡到 .3 且不能点）、吸顶分类标题和表情格（每格 34，一行放几个按宽度算：floor((宽 − 20) / 34)，与包的 grid auto-fill 相同，412 宽时 10 个）。表情数据读不出来时显示 "Could not load emoji." 和 "Try again"（包的 LoadError）。点表情选中并关闭；有肤色变体的表情长按 0.5 秒出变体条。"最近使用"存在本机（`SharedPreferences` 的 `emoji/recent`，最多 14 个、新的在前；网页存在 localStorage 的 `epr_suggested`），为空时这一类不显示。点外面或按返回键关闭。`EmojiPickerBody` 也能直接放进页面（账号头像的表情页用它）。
- **聊天图标**：顶栏标题左边的图标（40×40）、空白页标题左边的图标（41.6，表情 27.2 / 默认 MessageSquareText 22.4、描边 1.8）和侧栏聊天行的图标（40×40）都能点开选择器。保存走 `PATCH /api/sessions/:id {icon}`（`SessionsApi.updateSessionIcon`），排队和对账在 `ui/SessionIconSync.kt`（网页 `session-icon-sync.ts` 的移植：先显示，连点只发最后一次，失败退回最后保存成功的值并在输入栏上方提示 "Failed to change the chat icon."（换到别的聊天或新聊天时清掉，网页 `setSendError("")`），刷新回来的旧列表不会冲掉刚选的图标）。
- **还没保存的新聊天**：先选的图标是草稿（`ChatUiState.draftIcon`）。原生的会话由 `/api/chat`（或 `/api/images`）在发第一条消息时创建、不带图标，所以收到 `X-Session-Id`（图片模式是返回的 `sessionId`）后再 `PATCH` 上去；从新聊天点项目的 ＋ 建好聊天时也把草稿带过去：新行一放进列表就带着这个图标，再去保存。打开别的聊天时丢掉草稿（网页 `loadMessages` 同样清掉）。草稿按新聊天的本机键存（见“后台生成”）：已经发出、还在等会话 ID 的新聊天，用户离开后图标仍跟着这次发送迁到会话 ID 上并保存（网页 `send` 的 `sentIcon`），也不会被项目 ＋ 带走；附件还在上传时不算发出（离开后这条不发），项目 ＋ 照常把图标带走。
- **空白页标题**：没有消息的聊天（含已保存但还没消息的）显示空白页，标题是这个聊天的标题（新聊天是 "New chat"）和它的图标；这时顶栏不放标题和"新建聊天"（网页 `emptyState`）。
- **笔记侧栏行的图标**：没打开的笔记点图标就能改，走 `PUT /api/pages/:id/icon`（`data/NoteIconApi.kt`，服务端把版本号加一，列表换成返回的图标和版本；同一篇的请求串行，前一个没回来时再选只记下最后的值，回来后再发一次；这时打开那篇会先等写完，免得编辑器读到旧版本、下次保存 409）；失败时在 NOTES 标签上方显示 "Could not change the icon. Try again."，下次打开抽屉时清掉（网页侧栏关掉后组件卸载，提示跟着消失）。打开着的笔记的图标在原生侧栏里只显示、不弹选择器（见上面的"有意不放的网页控件"）。
- 单元测试：`EmojiCatalogTest`、`ChatIconTest`、`NoteIconTest`、`IconApiTest`。

## 附件与图片

流程和网页相同（`src/lib/client-chat-upload.ts`）：点发送后先上传附件，全部成功才把这条消息放进对话；上传失败时文字和附件都留在输入栏，并删掉已经传上去的文件。

1. `POST /api/uploads`（文件名、类型、大小）换回每个文件的存放路径和凭证（ticket），以及 `mode`。
2. `mode` 是 `blob`（线上，或本机配置了 `BLOB_READ_WRITE_TOKEN`）时：再向 `/api/uploads` 发 `blob.generate-client-token` 事件换一个只能写这一个文件的令牌，然后把字节直接 `PUT` 到 Vercel Blob（`https://vercel.com/api/blob/?pathname=…`，请求头 `authorization`、`x-api-version`、`x-vercel-blob-store-id`、`x-vercel-blob-access: private`、`x-content-type`、`x-content-length`）。这是网页用的 `@vercel/blob` 客户端的单次上传协议，App 里照着实现在 `NoteFableApi.uploadFile`；**升级 `@vercel/blob` 时要核对协议版本（现在是 12）**。`mode` 是 `local` 时直接 `PUT /api/uploads/local?ticket=…`。
3. 发送时把凭证放进表单的 `uploads` 字段（JSON 数组）：聊天走 `/api/chat`，「生成图片」模式走 `/api/images`（完成后一次返回图片，没有流）。

限制和提示文字与网页一致（`data/Attachments.kt` 对应 `src/lib/client-files.ts`、`upload-limits.ts`）：每条消息最多 10 个文件、单个 20 MiB、合计 100 MiB；图片只收 PNG / JPEG / WEBP，当前模型不能读图时不能附图（打开「生成图片」时可以）。一次选的文件有问题就整批不加。

和网页的差别：生成的图片右下角有下载键，见下文“回答体验”。

新对话输入框上方的“最近编辑”通过 `GET /api/pages?recent=1` 读取最近 4 篇笔记，普通笔记列表与“添加页面”仍读完整列表。点卡片复用输入栏的待附加笔记，↗ 打开编辑器，“全部笔记”进入列表。Web 在 412×915 下的实测尺寸为卡片 152×101、圆角 14.4、卡间距 8、打开按钮的触控区 48×48。卡片随空状态内容滚动，输入框贴近键盘。显示卡片时，剩余聊天区高度不足 400 dp 就收起角色图，给笔记标题留出空间。

**添加页面**（网页 `attach-page-dialog.tsx`，规则见 [chat-flow.md](chat-flow.md#发言附加的笔记)）：“＋”抽屉里在“添加文件或照片”下面多一行“添加页面”，先关抽屉再开 `ui/AttachPagesDialog.kt`。窗口复用项目设置参考笔记那一栏的部件（计数 n/5、已选标签、筛选、最多列 100 篇），打开时读 `GET /api/pages`，之前选的换成现在的标题、进了回收站的去掉（`refreshAttachedPages`）。选好的笔记在输入栏上方、附件上面（`PendingPages`，和文件标签同样式），点一下移除，上传附件期间不能改。发送时表单多一个 `pages`（ID 的 JSON 数组）；生成图片模式下带着笔记、或放回后超过 5 篇时不发送，输入栏上方提示（`ComposerNotice.PagesInImageMode` / `TooManyPages`）。上限拒绝时笔记和文字、附件一起放回，排在等待期间新选的前面（`mergeRestoredPages`）。发言下面是可点的笔记标签（`MessageDto.pages`），点了打开那篇笔记；登录 / 退出时清掉待发送的笔记。

## 整理成笔记

网页 `create-page-dialog.tsx`（规则见 [chat-flow.md](chat-flow.md)）：输入栏“＋”抽屉（`AttachSheet`）末尾的 “整理成笔记” 一行（`Lucide.FilePlus`，副标题 `R.string.create_page_title`），已保存且有消息的聊天才显示；当前聊天在发送（含上传附件）时置灰不可点。窗口是 `ui/CreatePageDialog.kt`（`.notes-dialog`）：说明 → 进行中（转圈 + 可以关掉的说明）→ 完成（“已在笔记中创建…”，省略了一部分时多一句）+“打开笔记”；失败显示服务端原句（429 / 400 / 413）、“Session not found.”（404）或通用句，经系统文词典翻译，可以重试。请求是 `ExportApi.createPageFromChat`（`POST /api/sessions/:id/page {model, savedOn}`，单独的客户端不设读超时、总时限 320 秒）。状态按聊天放在 App 级的 `AnswerExportStore.pageJobs`：关掉窗口照常生成，重开时进行中的照样显示、不会重复建；关窗口时忘掉已结束的结果；完成后通过 `created` 刷新笔记列表；登录 / 退出时清空。

## 输入栏与使用上限

- **上限（429 `usage_limit`）**：和网页 `page.tsx` 的 `UsageLimitError` 分支一样，被拒的原文和附件放回输入栏（`ChatViewModel.restoreRejected`）：等待期间又写了字就把原文放前面、空一行接上（`mergeRejectedDraft`），附件排在新加的前面；已发出的提问气泡去掉本机图片预览（变成文件标签）。草稿在 ViewModel 里（`SavedStateHandle`），登录、退出后仍在；附件和网页一样不跨登录保留（网页登录会重载页面），所以 `onIdentityChanged` 清掉待发送附件。
- **登录窗口**（`ui/SignInDialog.kt`，网页 `sign-in-dialog.tsx`、`.signin-*`）：侧栏底部和上限提示都只放一个"登录"按钮（`SignInButton`，高 44、圆角 6、深色底白字 15/600），点了打开窗口（宽 374、内边距 32 / 28 / 24、右上关闭键）。窗口只列服务端开着的方式（`GET /api/account` 的 `google` / `email`，旧服务端不返回时 Google 算开、邮箱算关）："使用 Google 继续"走原来的 Credential Manager 流程；邮箱是两步，`POST /api/auth/email/start`（带界面语言 `AppLanguage.uiLocale`）发 6 位验证码，`POST /api/auth/email/verify` 核对后 Cookie 里就有登录会话，然后和 Google 登录一样先把打开的笔记存掉、重新读账号、通知换了身份。失败显示服务端原句（经系统文词典翻译）或网页的两句兜底文（`SignInError`）；发送 / 核对期间窗口不能关；登录成功后窗口自动关闭。在模拟器上看过第一屏（线上没开邮箱登录，所以只有 Google）；邮箱的两步只有单元测试，没有用真实邮箱跑过。
- **登录提示**（`ui/GuestLimitPrompt.kt`，网页 `guest-limit-prompt.tsx`）：`tier = guest` 时记下 `ChatUiState.guestLimit`（`chat` / `image`），只在服务端开了登录且还没登录时显示在输入栏上方（提示条和待发送附件之前）。外框、图标、按钮的数值和进场、图标弹出、高光、光晕动画都照 `.guest-limit-*`（412 宽实测），系统关掉动画时不动。"登录"按钮（深色全圆角）和侧栏底部的一样打开登录窗口；"以后再说"和 ✕ 关闭。说明里的条数用 member 的上限（每天的聊天、每月的图片）：安装包里的 `assets/usage-limits.json` 由 `scripts/gen-native-usage-limits.ts` 从 `src/lib/usage-plans.ts` 生成，`src/lib/native-usage-limits-asset.test.ts` 在数值过期时失败。
- **滚动到底部**：网页输入栏区顶部那一行（40 + 下距 8）。手机宽度下这一行一直占位，隐藏时只是透明（空白首页也一样；只有 ≥ 640 的空白首页才 `display: none`）。原生是列表底部居中的 40 白底按钮（圆角 4.8、`--notion-shadow`、ArrowDown 20），离底部超过 8 时 150ms 淡入放大；列表底部内边距 96 = 消息列自己的 `pb-12`（48）+ 这一行（48），空白首页的标题居中也按 48 + 48 留底。消息列表改为正向排列（短对话从顶部开始，和网页一样），"跟随最新内容"的规则照 `followBottomRef`：打开会话、发出消息、点按钮时跟随；用户一滚（拖动、滚轮、无障碍滚动）离开底部就停止，滚动停在底部 2 以内又跟随，滚动进行中不恢复。判断规则是 `ChatFollow.kt` 的纯函数 `followAction`，有单元测试。跟随时在测量前用 `requestScrollToItem` 贴底，回答变长不会先跳一下。
- **粘贴图片**：输入框换成 `TextFieldState` 版的 `BasicTextField`（草稿仍在 ViewModel，两边同步），用 `contentReceiver` 收剪贴板 / 键盘里的 PNG、JPEG、WEBP（网页 `getClipboardImageFiles`），其它内容照常粘贴成文字。图片先拷进缓存目录（`image.png` 等，和网页粘贴的文件名一样），再走 `addFiles` 的校验。拷贝（以及文件选择器读文件名和大小）经 `ChatViewModel.importFiles` 在后台进行，期间 `importing` 大于 0、不能发送，免得图片漏掉、跑进下一条。键盘插入的图片，临时读取权限挂在 `TransferableContent` extras 里的 `InputContentInfo` 上：拷贝期间一直引用着它，拷完调 `releasePermission`。
- **拍照**：没有新加一行，"添加文件或照片"打开的系统选择器里同时列出相机 App（`ACTION_GET_CONTENT` 选择器 + `EXTRA_INITIAL_INTENTS` 的拍照意图，和手机浏览器里网页的文件选择框一样）。照片写到缓存目录 `attachments/`，经 FileProvider（`${applicationId}.attachments`，`res/xml/file_paths.xml`）交给相机 App；不需要相机权限，Manifest 里用 `<queries>` 声明要查相机。缓存里超过一天的副本在下次新建副本（打开选择器或粘贴图片）时清掉；不再拍照或粘贴的话，旧副本留到系统清缓存为止。选择器返回后用哪些文件（选中的文件优先，否则看相机文件有没有内容）在 `pickedAttachmentSources`，有单元测试。

- **方案与购买**（`ui/PlanSettings.kt`，网页 `plan-settings.tsx`、`.settings-plan-*`）：设置的“方案”页，打开设置时读一次 `GET /api/billing`（状态在 `PlanSettingsState`，由设置窗口拿着，进出“方案”页不重读），显示免费 / Pro 徽章、Pro 的续费 / 结束 / 扣款失败 / 试用结束说明、聊天和图片生成用量条（Pro 同时显示本期与今日图片生成；免费方案平时只显示今日图片生成，仅在触及月上限时补显示本月满额条）。还能免费试用时（`trialDays > 0` 且 Play 返回带免费阶段的 offer，见 [billing.md](billing.md#免费试用)）介绍框和上限提示多一行试用说明，按钮写“开始 N 天免费试用”。免费用户在服务端开了 Play 结算、Play 商品读得到时，显示和网页一样的 Pro 介绍框和“升级到 Pro”，打开 **Google Play** 的购买窗口（`data/PlayBilling.kt`，网页是 Stripe）；Play 买的 Pro 显示“在 Google Play 上管理订阅”。免费用户撞到上限时，输入栏上方的升级提示（`UpgradeLimitPrompt`，网页 `UpgradePrompt`）沿用登录提示的外框和动画，按钮同样打开 Play。网页（Stripe）买的订阅在 App 里没有管理入口；App 内嵌的笔记编辑页不显示网页的升级提示。从 Drive 装的 APK 连不上 Play 结算，购买按钮不出现。流程见 [billing.md](billing.md#androidgoogle-play-结算)。

## 回答体验

一条回答从上到下和网页 `chat-message.tsx` 相同：标签 → 过程面板 → 生成的图片 → 正文 → 提案卡片 → 失败文 → 操作行（`ui/AssistantTurn.kt`）。

- **过程数据**（`data/Activity.kt`）：移植 `src/lib/chat-activity.ts` 的 `applyActivityEvent`（按 id 合并：推理增量拼接，其它同 id 替换）、`parseStoredActivity` 的校验（不安全的地址、没完成的搜索、坏的项目上下文都丢掉）、`splitThought`、`hostOf`，`ActivityTest` 与 `chat-activity.test.ts` 逐条对应，两边一起改。流里的 `{activity}` 事件在 `ChatViewModel.runStream` 里和正文一起攒着，每次刷新合并一次；历史里的 `activity` / `proposals` 在 `toUiMessage` 里解析。正文开始出现前的时长记为 `thinkingMs`。
- **过程面板**（`ui/ChatActivity.kt`，网页 `chat-activity.tsx`）：等待中（还没有正文和图片，包括生成图片时）标题行是"当前一步 · N s"并带流动高光、步骤列表自动展开并跟到最新一步；正文来了收起，标题变成"已思考 N s · N 次搜索 · N 个来源 · N 次查阅笔记 · 项目笔记 / 项目指示"。步骤：推理（标题 + 正文）、搜索（搜索词 + 来源标签，先显示 6 个、其余收进"+N"）、读取 / 在页面里查找（地址链接）、笔记工具（进行中转圈，完成后显示服务端的标签，经系统文词典翻译）、项目上下文（笔记标签可点，`partial` 徽标）。来源和链接用系统浏览器打开（`LocalUriHandler`）。
- **提案卡片**（`ui/ProposalCard.kt`、`data/ProposalApi.kt`，网页 `page-edit-proposal.tsx`）：编辑提案（改名前后、每处改动的"替换 / 插入 / 删除 · 第 N 块 / 笔记开头"、改前改后、丢失图片 / 格式的警告）和新建提案（预览或"空白笔记"）。应用 / 放弃走 `POST /api/proposals/:id/apply|discard`；状态按提案 ID 存在 `NoteFableApp.proposals`（`ProposalStore`）里，回答结束后重读历史不会退回"未处理"，服务端保存的已应用 / 已放弃优先；失败回到未处理并显示服务端原句（经词典翻译）或"无法应用 / 放弃修改建议。"。已处理的卡片默认最小化。应用成功后刷新笔记列表，被改的笔记正开在编辑器里时经 JS 桥 `pageUpdated` 把新版本交给网页编辑器（见下文“笔记”）；"打开笔记"经 `LocalOpenNote`（`NoteFableRoot` 提供）走 `NotesViewModel.openNoteFromLink`（网页 `openNoteFromLink`）：马上切到笔记列表，刷新列表后笔记在就打开，不在（已删除、在回收站、读取失败）就留在列表上。笔记标签（项目上下文）走同一个入口。
- **代码块**（`ui/CodeBlock.kt`，网页 `MarkdownCodeBlock` + `.markdown-code-*`）：头部 Code2 + 语言名（围栏语言含别名 → `guessLanguage` 的 Python 规则 → 自动识别，识别不出显示"代码"）+ 复制键（✓ 停 1.2 秒）；代码不折行、横向滚动。网页用 highlight.js，原生是自带的小词法高亮器，覆盖同样 17 种语言、用同一套颜色类别；逐个记号和自动识别结果是近似，不保证与 highlight.js 完全一致。行内代码按 `.markdown-inline-code`（#e2e8f0 底、13.6）。
- **表格**（`AnswerMarkdown` 的 `AnswerTable`）：渲染库自带的表格是固定列宽、只有分隔线，和网页不同，所以自己排：1px 边框、内边距 7.2×11.2、表头浅蓝灰底 + 600，左上对齐；列宽按浏览器自动表格布局分配（每列最窄 88 或最长的词，放得下用自然宽度，否则按比例分，最窄都放不下时横向滚动）。
- **操作行**：只给完成、没有失败、有正文的回答显示（生成中、只有图片、失败时不显示）。复制后图标换成 ✓ 停 2 秒；复制失败在下面显示"无法复制，请选中文字后手动复制。"。复制键后面是"…"菜单，见下文“回答导出”。
- **生成图片的下载**：每张图片右下角 44 的圆形下载键（`.generated-image-download`）。存进相册的 Pictures（`data/ImageSaver.kt`，文件名 `notefable-<id>.<扩展名>`，扩展名按图片的 MIME 类型（jpg / webp / gif，默认 png；网页总是 `.png`），id 里不安全的字符换成 `_`；下载在 App 级作用域（`NoteFableApp.scope`）里跑，回合滚出屏幕也不中断；Android 8–9 媒体库没扫到时只存不打开；Android 10+ 用 MediaStore 不需要权限，8–9 先申请 `WRITE_EXTERNAL_STORAGE`，清单里 `maxSdkVersion=28`），提示和成功后打开的方式与笔记文件下载相同。
- **停止、重新生成、编辑、版本切换、分支**（`ui/TurnActions.kt`、`ChatViewModel` 的 `regenerate` / `editMessage` / `showVersion` / `branch`，网页 `turn-actions.tsx` 和 `page.tsx` 的 `rerunTurn` / `showVersion` / `branchChat`；服务端的规则见 [chat-flow.md](chat-flow.md#停止编辑重新生成与分支)）：回答的“…”菜单最上面是“重新生成”“在新聊天中分支”；提问下面是版本切换、复制、编辑，编辑在气泡里直接改写。重新生成和编辑请求 `/api/chat` 时带 `regenerate` / `edit`（`ChatRequest`），先从画面上拿掉那条消息之后的对话；没开始就被拒绝（上限、断网）时退回原样并在输入栏上方显示原因，输入栏里的草稿不动。版本切换调用 `POST /api/sessions/:id/versions` 后重读消息；分支调用 `POST /api/sessions/:id/branch`（标题由界面拼成“分支 · 原标题”）并打开新聊天。没开始就被拒绝的改写，那条提问的编辑框会带着刚写的文字重新打开（`ChatUiState.rejectedEdit`）；登录 / 退出时输入栏空着的话把它放进输入栏。点停止不再直接断开连接：先请求 `POST /api/sessions/:id/stop`（`ChatBackend.stopSession`），服务端存好已生成的部分后自己结束流，这边按正常结束对账，所以停下的回答随后就能重新生成或分支；等待期间停止键不能点（`ChatUiState.stopping`）。请求没成功、或 8 秒内流没结束才自己取消，这时收到过正文的话再读几次消息（500 / 1000 / 2000 ms），等到新回答出现才换成服务端的版本。上传附件中、生成图片、新聊天还没拿到会话 ID 时仍是直接取消。
- **引用回答追问**（`ui/QuoteSelection.kt`、`data/ChatQuote.kt`，网页 `quote-selection.tsx` / `chat-quote.ts`，规则见 [chat-flow.md](chat-flow.md#引用回答追问问-notefable)）：已完成、没失败、有正文的回答在 `SelectionContainer` 外换上自己的 `TextToolbar`，系统浮动选择菜单最前面多一项“问 NoteFable”，后面是系统的复制、全选。Compose 的选区不给出选中的文字，所以这一项借一次选区的“复制”：回答外面换上 `QuoteClipboard`（`LocalClipboard`），这次复制写来的文字直接交给引用，不进系统剪贴板，用户原来复制的文字、图片、文件都不动；普通的复制和代码块复制按钮照常转给系统剪贴板。新版 Compose 文字菜单（foundation 1.10 起默认）不走 `LocalTextToolbar`，所以同样的三项也用 `appendTextContextMenuComponents` / `filterTextContextMenuComponents` 加在选区上（其它系统项去掉）。上传附件期间引用不能改：菜单里不出“问 NoteFable”（复制、全选照常）。引用和草稿一起存进 `SavedStateHandle`，进程被回收后一起回来。引用放进 `ChatUiState.quote`，输入栏上方显示（`ComposerQuote`），发送时用 `ChatQuote.compose` 和网页同一格式拼进 `message`；提问气泡里用 `ChatQuote.split` 把引用灰字分开显示；被拒时引用回到输入栏上方。引用后回答换 key 重建选区，高亮消失。拖放添加文件只有网页（桌面）。
- 和网页的差别：删除线颜色（网页是半透明红）用文字色；代码高亮是近似（见上）。
- **数学公式**（`data/MathMarkdown.kt`、`AnswerMarkdown`，网页 KaTeX，规则见 [chat-flow.md](chat-flow.md#回答里的数学公式)）：`MathMarkdown.prepare` 用和网页 `prepareMath` 相同的规则认出公式，把每个公式换成占位符（私用区字符夹着序号，Markdown 解析器当普通文字），独立公式前后留空行让它自成一段（已经有空行的不再加：连着两个空行会让解析器把列表项截断）。`AnswerMarkdown` 再把公式放回去：行内公式先量好尺寸、按基线嵌进文字（`markdownAnnotator` + `InlineTextContent`，表格单元格和引用里也一样）；整段只有一个独立公式的段落画成居中的一块（上下 14.4，比屏幕宽时在公式内部横向滚动，对应 `.katex-display`）；```` ```math ```` 代码块也是独立公式。字号 19.36（网页 `.katex` 是正文的 1.21 倍），颜色跟正文（引用里是灰色）。排版用 `io.github.huarangmeng:latex-renderer` + `latex-fonts-katex`（MIT，纯 Kotlin / Compose，字体就是 KaTeX 的字体，不带原生库）。库把 `-` 画成连字符，所以交给它之前由 `MathMarkdown.typeset` 换成真正的减号：减法用 `\minus`（两边有间距），负号和上下标里用 U+2212（没有间距），文字、环境名、长度里的不动。量不出来的公式（写错、库不支持）在原处显示 LaTeX 源码。和网页的差别：行内的 `\int`、`\sum` 等大算符比 KaTeX 的行内样式大；库不支持的命令显示效果可能不同。

### 回答导出（"…"菜单）

`ui/AnswerActions.kt`、`data/ExportApi.kt`，对应网页 `answer-actions.tsx` + `answer-actions.css`（412 宽实测）。复制键后面是 36×36 的"…"（Ellipsis 18、线宽 1.9、Muted），点开的菜单与侧栏菜单同一外观（宽 228、内边距 5.6、圆角 12、细线、阴影 0 8 32 #0002；项最小高 44、内边距 9.6×12、图标 16 + 间距 12、14/21），左边与按钮对齐、在按钮下 4，下方放不下就放到按钮上方，离窗口边至少 8（`answerMenuPosition`）。点外面或返回键关闭。

- **存到笔记**：网页在浏览器里用 `answerToNoteContent` 生成块；原生不移植这段转换，改由服务端 `POST /api/pages/from-answer`（body `{ markdown, sessionId, messageId, savedOn }`）用同一个函数生成，再走与 `POST /api/pages` 相同的 `validateNoteContent` + `createNotePage`（`src/lib/note-create.ts`）。会话只用来取标题和回到会话的链接：必须属于当前用户，否则 404；正文是 App 显示的回答原文（和 `POST /api/pages` 一样，只是把自己的文字存进自己的笔记），请求体上限 1 MiB（413）。链接的 origin 取请求地址；`savedOn` 是本机日期，出处里的日期与网页一样按用户所在时区。菜单项：保存中转圈 + "正在保存…"，成功变 ✓"已保存到笔记"并多出"打开已保存的笔记"（关菜单，经 `LocalOpenNote` 打开）；保存中 / 已保存的项变 Muted、不能再点。状态按 `会话ID\n消息ID` 存在 App 级的 `AnswerExportStore`（网页模块级 Map），重新绘制、切换对话都不会重复新建；回答刚结束时还是本地 ID（`local-N`），对账换成服务端 ID 时列表项沿用原来的 key（`UiMessage.key`，`carryLocalKeys`：先按服务端 ID 沿用之前回合已有的 key，再把刚发送回合的本地 key 交给服务端的那几条），菜单状态不丢；保存状态由 `ChatViewModel` 在对账时搬到新 ID 下（`onMessageIdChanged` → `AnswerExportStore.rename`，不管那条回答在不在屏幕上；在途的保存完成后记在新 ID 下）；保存成功后 `AnswerExportStore.created` 发出新笔记 ID，`NoteFableRoot` 刷新笔记列表（网页 `notefable:page-created`，离开对话后在后台完成也一样）；重开 App 就忘了（服务端不去重，与网页刷新后相同）。失败时项变"重新保存到笔记"，菜单里显示原因：413 太长、400 服务端原句（经系统文词典翻译）、其余"无法保存到笔记，请重试。"。
- **下载对话**：`GET /api/sessions/:id/export?date=` 返回 `{ fileName, markdown }`，服务端用网页同一组 `conversationToMarkdownFile` / `answerFileName` 生成（同样的所有权检查；只读 USER / ASSISTANT 的正文和附件，不读 SYSTEM 消息和 providerContext；附件图片是本站绝对地址）。读取中菜单项转圈 + "正在下载…" 并阻止重复点击；读取失败菜单保持打开并显示"无法下载聊天，请重试。"；成功后关菜单，用系统的保存位置选择（SAF `CreateDocument`，`text/markdown`，建议文件名即 `fileName`）写入，写完 Toast "聊天已下载"（网页这里只有读屏通知），取消选择就什么也不做，写入失败在操作行下方显示同一句错误，并删掉选择器已建好的空文件。保存位置选择器注册在 `NoteFableRoot`（`rememberConversationDownloader`，经 `LocalConversationDownloader` 交给回答行），不在回答行里：要写的会话 ID 和文件名存在 `rememberSaveable`，选择器开着时进程被杀、回来后那条回答没有重新组合，结果也能接住。等写入的 Markdown 按会话放在 `AnswerExportStore`（Activity 重建也还在）；进程被杀后没了就重新读一次再写，写入在 App 级作用域里跑；发起的回答行已不在时，写入失败改用 Toast 提示。读取时离开这条回答（滚出屏幕）就不再弹出保存位置选择。
- **错误**：与网页一样只有一处：复制、保存、下载开始时都清掉上一条，菜单开着时显示在菜单里，关着时显示在操作行下方（复制失败也在这里，`MenuError.Copy`）。
- 和网页的差别：菜单不随页面滚动关闭；没有键盘方向键导航。
- 服务端测试：`src/app/api/pages/from-answer/route.test.ts`、`src/app/api/sessions/[sessionId]/export/route.test.ts`（与浏览器端转换结果逐项比对）；原生：`ExportApiTest`（MockWebServer、假后端、新建通知、定位）、`ChatViewModelTest`（对账的 key 沿用与 ID 替换通知）。

## 笔记

列表、项目和回收站是原生界面，直接调用网页用的接口（`data/Notes.kt`、`NoteFableApi`）：`GET /api/pages`、新建 `POST /api/pages`（和网页一样发空白的 Untitled）、移到回收站 `DELETE /api/pages/:id`、移到项目 `PUT /api/pages/:id/group`、项目 `POST /api/pages/groups` 与 `PATCH / DELETE /api/pages/groups/:id`、回收站 `GET / DELETE /api/pages/trash`（清空时带 `before=` 最新一条的删除时间）、`POST / DELETE /api/pages/trash/:id`。项目折叠状态存在本机（网页存在 localStorage）。

- 拖动排序（网页 `ReorderRowButton`）：侧栏和首页的笔记行没有单独的把手，长按行主体后拖（与聊天侧栏相同，共用 `ui/ReorderDrag.kt`）。放到别的笔记前 / 后走 `POST /api/pages/reorder`（目标在别的项目里时服务端顺便把它移过去，返回新顺序，`NotesViewModel.applyOrder` 按网页 `byPosition` 重排）；放到项目行 / 项目小标题上移进该项目，放到侧栏的 NOTES 标签、首页的 "Notes" 标题或 "No project" 小标题上移出项目，走 `PUT /api/pages/:id/group`，侧栏里移进折叠着的项目时把它展开。排序请求同一时间只做一次，上一次没完时提示 "Wait for the previous move to finish."；新建 / 移到回收站进行中和正在移动的那一篇不能拖。失败时在那一行下面显示服务端原句（经词典翻译）或 "Could not move the item. Try again."，只显示在发起拖动的那个列表里（抽屉盖在首页上时两个列表同时在组合里）。网页的键盘上下移动在原生版没有。单元测试：`NotesViewModelTest`、`NotesApiTest`。

- 子页面、收藏、页面菜单（网页 notes-sidebar / notes-home / note-page-menu，规则见 [notes-flow.md](notes-flow.md#子页面收藏与页面设置)）：`NotePageSummary` 带 `parentId`、`favoritedAt`、`fullWidth`、`smallText`、`font`、`locked`。侧栏和首页只按项目列最上层的页面，子页面在展开的父页面下缩进（侧栏左距 12 + 1px 竖线，首页左距 24）；每行都有展开箭头（侧栏 20×28 Chevron 14，首页 28×48 Chevron 18，浅灰），没有子页面时展开显示 “No pages inside”；展开状态存在本机（`NotesPrefs.expandedPages`），打开着的笔记的祖先总是展开。侧栏行多一个 “+”（Add a page inside，`POST /api/pages` 带 `parentId`）；项目和 “No project” 后的数字含子页面。收藏在 Projects 上面（侧栏 FAVORITES 标签 + 平铺的行，右侧 StarOff 移除；首页 “Favorites” 小标题 + 行）。移到回收站时子页面一起移进去（`DELETE` 返回的 `ids`），恢复时一起回来，永久删除时回收站里的子页面一起删；确认框加一句 “Its sub-pages move to Trash with it.”。移动对话框在项目下面列页面树（可筛选；自己和子孙不列），走 `PUT /api/pages/:id/parent`；移进项目会脱离父页面。
- 编辑页顶栏最右边是 “…”（`NotePageMenu.kt`，菜单外框与聊天的 `ActionsMenu` 相同，宽 248）：Style（Default / Serif / Mono）、Small text、Full width、Lock page 开关，Add to / Remove from Favorites、Duplicate、Add a page inside、Move to、Export Markdown、Move to Trash。设置走 `PUT /api/pages/:id/settings`、收藏走 `/favorite`，成功后调 `window.notefableEmbed.pageSettings(<一览项 JSON>)` 让编辑器立即变宽、换字体、变成只读；锁定时顶栏多一个锁的按钮（高 32，Lock 14），点一下解锁。Duplicate 先 flush（打开的是它或它的子页面时），再 `POST /api/pages/:id/duplicate`，按返回的新顺序放进列表并打开复制件。单元测试见 `NotesViewModelTest` 里子页面、移动、设置、复制的几条。
- Markdown 导出（`ui/NoteMarkdownIo.kt` 的 `rememberNoteExporter`、`NotesViewModel.exportNote`；网页 `exportPage`，规则见 [notes-flow.md](notes-flow.md#markdown-导出与导入)）：页面菜单的 “Export Markdown”。打开着的是这一篇时先 flush，存不上就不导出，顶栏下面的提示条显示 “Resolve the unsaved draft before exporting this page.”；然后 `GET /api/pages/:id/export`，用系统的“保存到…”（SAF `CreateDocument("text/markdown")`，建议文件名是服务端给的 `<标题>.md`，没给时 `note.md`）让用户选位置，按 UTF-8 写入。取消选择什么也不做；读取或写入失败时同一处显示服务端的句子或 “Could not export the page.”，写不进去时删掉选择器已建好的空文件。和“下载对话”一样注册在 App 根上（选择器开着时进程被回收，回来后重新读一次内容）。与网页的差别：网页是浏览器直接下载；两边导出成功后都不另外提示。
- Markdown 导入（`rememberMarkdownImportPicker`、`data/NoteImport.kt`、`NotesViewModel.pickedForImport` / `importMarkdown`、`ImportTargetDialog`；网页 `importMarkdownFiles`、`importMarkdown`、`ImportTargetDialog`）：侧栏底部（回收站上面）、笔记首页的按钮行和空状态里的 “Import Markdown”，打开系统的多选文件选择器（SAF `OpenMultipleDocuments`；按 MIME 类型列 `text/markdown`、`text/x-markdown`、`text/plain`、`application/octet-stream`，因为不少文件管理器把 `.md` 报成后者，选完再按扩展名查）。选好后先收起侧栏，再按网页同样的上限在本机检查（`NoteImport.check`：最多 20 个、每个 1 MiB、合计 4 MB，扩展名 `.md` / `.markdown` / `.txt`）：读之前按选择器报的大小查一次，读出全文后按实际的 UTF-8 字节数再查一次（每个文件最多读到上限多一个字节，报错大小的大文件不会整个进内存）。不合格只在笔记的错误条里显示原因，不发请求。导入到哪里和网页一样：一个项目都没有时直接导入（不进项目）；有项目时，读之前的那次检查通过后先出 “Import to” 对话框（`ImportTargetDialog`，和“移动笔记”对话框同一套 `NotesDialog` / 选项行：“No project” 在最前，后面按侧栏的顺序列各个项目，列表最高半屏、可滚动，底部 “Cancel”），点一项就开始导入，取消或点窗口外则不导入；等着选去处的文件留在 `NotesViewModel`（`NotesUiState.importTarget`），旋转屏幕不丢，换身份时丢弃。通过后 `POST /api/pages/import`（选了项目是 `{ files: [{ name, markdown }], groupId }`，没选是 `{ files }`；4 MB 的上限按这个含 `groupId` 的请求体量），新笔记并进列表并打开第一篇；服务端拒绝时（例如 “File is too long for one note: {name}”）显示服务端的句子（经系统文词典翻译）或 “Could not import Markdown files.”，列表不变。期间和新建一样禁用列表操作；换了身份后才回来的结果丢弃。单元测试：`NoteImportTest`、`NotesViewModelTest` 和 `NotesApiTest` 里的导出 / 导入用例。

编辑器仍是网页的 BlockNote：编辑页的 WebView 打开 `<baseUrl>/note-embed?page=<id>&lang=<界面语言代码>&model=<id>&reasoning=<effort>&theme=<light|dark>`（网页只渲染笔记正文，没有网页的顶栏和侧栏）。`model` / `reasoning` 是聊天里选的模型和推理强度（模型列表读到之后才带），编辑器里的 AI 助手用它们；网页按服务端的模型列表核对，列表里没有的模型不用，选不了的强度换成默认。加载前先清空 WebView 的 Cookie，再把 App 的 Cookie（`notefable_device`、Auth.js 会话）拷进 `CookieManager`，所以身份与 API 相同，退出登录后网页也不会沿用旧会话。JS 桥约定见 `src/lib/native-bridge.ts`，两边一起改：

- 网页 → App：`window.NoteFableNative.postMessage(json)`，消息 `ready`（页面数据读好；带页面 id，冲突后"另存为新笔记"时网页换到副本并用副本的 id 再发一次，App 把打开的笔记换成副本，WebView 不重新加载）、`meta`（标题 / 图标变了，原生顶栏和列表即时更新）、`saveState`（`saved / saving / unsaved / error / conflict`，顶栏显示"已保存 / 正在保存… / 未保存 / 保存冲突"）、`missing`（笔记不存在或已在回收站，或编辑中保存返回 404：直接关闭并刷新列表，草稿留在 WebView）、`trashed`、`flushed`。
- App → 网页：`window.notefableEmbed.flush("<requestId>")`，网页保存后回 `{type:"flushed", requestId, ok, kept?}`；`openHistory()` 打开网页的版本历史。聊天里应用了编辑提案、被改的笔记正开着时，App 调 `pageUpdated(<page JSON>)`，把 apply 返回的新版本交给网页（走网页 `notefable:page-updated` 的同一条路：没有未保存的编辑就换成新版本，有就提示冲突），不然下次保存会 409。
- 设置里选的图标（见“账号头像”一节的“图标”）：网页打开时调 `window.NoteFableNative.appIcon()` 读（预设角色 `character:<id>` 或图片的 data URL，默认角色 Quill 是空字符串），写进这个 WebView 的 `localStorage`（`notefable:app-icon`），右下角的 AI 按钮和面板标题就用它；编辑器开着时在设置里换了，App 调 `window.notefableEmbed.appIcon(<值或 null>)`，按钮马上跟着变（`NoteEmbedBridge.pushAppIcon`）。
- 外观：地址里的 `theme` 是 App 现在实际显示的外观（`light` / `dark`，“跟随系统”已经算好，不发 `system`），网页第一帧就按它画；网页打开时再读 `window.NoteFableNative.theme()`（同一个值）。编辑器开着时外观变了（设置或帮助菜单里换了，或跟随系统时系统切了深浅），App 调 `window.notefableEmbed.theme(<light|dark>)`，网页就地换色、不重新加载（`NoteEmbedBridge.pushTheme`）；收到 `ready` 后也再推一次，覆盖加载期间的变化。
- 离开笔记（"<"、返回键、切换到别的笔记、切到聊天、新建、移到回收站当前笔记）前先 flush，`ok` 才离开；不 ok（或整个 flush 15 秒没结果、WebView 中途被销毁）就留在笔记里，显示网页的"保存失败，草稿已保留。"（移到回收站时显示"请先处理未保存的草稿…"，且不移）。`kept` 为 true（断网、服务器出错，草稿已存进 WebView 的 localStorage，不是冲突）时，提示之后再操作一次就放行，和网页 `/app` 一样不把人困在笔记里；冲突则一直留在笔记里。编辑器还没挂上（`notefableEmbed` 不存在）时没有可保存的编辑，直接离开。
- 登录、退出前也先 flush（趁 WebView 还带着旧身份的 Cookie），存不上也继续；身份换了以后关掉编辑器，排着的打开 / 新建作废，回收站里进行中的操作被取消；旧身份下发出、换身份后才回来的改动（移动、项目、移到回收站、恢复…）结果直接丢弃（`NotesViewModel` 的身份代数）。
- 列表刷新期间有改动完成（新建、移动、删除、恢复…）时，刷新读到的可能是改动前的列表：丢掉它重读一次，不盖掉本地刚做的改动。
- 聊天输入栏的草稿放在 `ChatViewModel.draft`（Compose 状态），切到笔记再切回来还在；消息真正发出去后才清空。
- 编辑页按"最初打开的页面"分（`OpenNote.editor`），消息也按它转发；副本替换后 `OpenNote.id` 变成副本，WebView 重新加载（渲染进程被杀后）时用副本的地址；换语言不重新加载，见“界面语言”。
- WebView 的渲染进程被系统杀掉或崩溃时（`onRenderProcessGone`）不让整个 App 退出：丢掉这个 WebView，换一个新的重新加载，没保存的编辑由网页的本地草稿恢复。
- 返回键先交给网页：WebView 能后退就后退；有打开的 `<dialog>`（版本历史等）就发 `cancel` 事件关最上面一层（原生调用打开的面板没有用户手势，浏览器不一定为它留历史记录）；都没有才保存并回列表。返回顺序：笔记 → 列表 → 聊天 → 退出。
- WebView：开 JS 和 DOM Storage、禁止混合内容、不允许 file/content 访问；只有本站的 `/note-embed` 在 WebView 里打开，其它链接交给系统浏览器；图片 / 文件块用系统文件选择器（`onShowFileChooser`）；只有 debug 包能用 Chrome 调试 WebView。
- 笔记里的文件（本站 `/api/pages/files?key=…`）只给主人，系统浏览器没有 App 的 Cookie。`shouldOverrideUrlLoading` 和 `DownloadListener` 拦下这种地址，由 App 用 OkHttp（同一个 Cookie jar）下载：Android 10 及以上存进"下载"（MediaStore，不需要权限），更老的系统先让用户选保存位置（SAF `CreateDocument`），存好后用系统的"打开方式"打开。提示用网页的"正在下载…"，失败时显示"请求失败：<服务端原因>"。

本机验证时注意：Next 开发服务器默认拒绝来自 `10.0.2.2` 的开发资源请求（`allowedDevOrigins`），编辑器会停在"正在加载笔记…"。模拟器里用 `adb reverse tcp:3000 tcp:3000` 并用 `-Pnotefable.baseUrl=http://localhost:3000` 构建即可。

## 搜索与跳转（Batch 4）

和网页 `search-dialog.tsx` 在手机宽度下的全屏面板一致（数值在 412×915 下量，写在 `ui/SearchScreen.kt` 的注释里；文案在 `strings_search.xml`）。

- 入口：聊天和笔记两边抽屉"新建"按钮下面的 Search 行（触屏不显示 Ctrl K 提示）；聊天顶栏右侧"＋"前面的搜索按钮（空白首页只有它）；笔记列表顶栏右侧、笔记编辑页顶栏版本历史前面的搜索按钮。
- 面板：All / Chats / Notes 标签；Chats 标签页且有项目时右侧是项目筛选（当前聊天所在的项目排在最前，默认"全部项目"，选的项目没了就退回全部）。输入停 250ms 后 `GET /api/search?q=&scope=&projectId=`，条件变了就取消上一次请求、丢掉晚到的旧结果；检索中保留上一次结果并淡显（0.5）。在聊天界面时 Chats 组在前，在笔记界面时 Notes 在前。空输入 / 失败（"Try again" 重试）/ 检索中 / 无结果的文案都来自网页。每行：图标（表情或 MessageSquareText / FileText）、标题、项目名、摘录（"You: " / "NoteFable: "，附件命中时是回形针 + "in 文件名"）、日期（今年只写月日，`android.icu` 的 MMMd / yMMMd 骨架）；第一行带 hover 底色（网页手机上也是），命中词黄色底。每次打开都是空的（网页只在打开时挂载面板），返回键关闭。打开时整个面板从下方 32 处淡入上移（`model-sheet-up` 200ms ease-out）；检索中旧结果用 120ms ease 淡到 0.5，结果到了立即恢复（同 `.is-stale` 的 transition）。项目筛选的触发框和网页 `<select>` 一样按最长的选项定宽（最宽 48%），箭头在右端；**已知差异**：网页点开是浏览器自己的选择器（Android Chrome 是单选列表对话框），原生用 Material3 `DropdownMenu`（白底，当前项加粗），没有按网页量过。网页的 `<mark>` 有 1px 左右内边距和 2px 圆角，原生用文字背景色，没有这两项。
- 高亮的折叠规则移植在 `data/SearchFold.kt`（`search-fold.ts` 的客户端部分）。对照用例 `app/src/test/resources/search-fold-cases.json` 由 `npx tsx scripts/gen-native-search-fold-cases.ts` 用网页实现算出（输入同 `search-fold.test.ts`），`SearchFoldParityTest` 用它核对 Kotlin 版；改了 `search-fold.ts` 要重新生成，`src/lib/native-search-fold-cases.test.ts` 会在用例过期时失败。
- 选结果：聊天结果切到聊天并 `openSessionAt(id, messageId)`；笔记结果用结果里的标题和图标打开原生笔记编辑页（列表还没读过也能开）。网页会滚到命中的笔记块（blockId），原生版的 `/note-embed` 还没有对应参数，只打开笔记开头。
- 定位到消息（`ChatUiState.reveal`）：消息读完后滚到那条消息、放在可视区中间，然后闪 2 秒（黄色底保持 1.2 秒再淡出，外圈 3px，与 `.search-reveal-flash` 一致）；消息已不存在就停在最底部；换了聊天就作废。闪的强度按开始时间算，条目滚出屏幕再回来时接着当前进度、不从头重放；2 秒后作废，从侧栏重开不再闪（网页 `clearFlash`）。`listState` 和上一段聊天共用，先等新列表量好（项数对上、可见项的 key 都是这段聊天的消息）再判断目标在不在屏幕上。定位完成前不贴底（`followAction` 的 `revealPending`，同网页 openChatFromLink 关掉 pinToBottom）；滚到目标后停止跟随底部，目标不存在时恢复跟随。
- 聊天链接 `https://<站点>/?chat=<会话>&message=<消息>`（也认 `/app?chat=`、`/<语言>/app?chat=`，规则在 `data/ChatLink.kt`，同网页 `LINK_ID`）：笔记 WebView 里点到时由 `shouldOverrideUrlLoading` 拦下在 App 里打开；外部的 VIEW intent 由 `MainActivity` 处理（`singleTask`，App 在运行时走 `onNewIntent`）。intent-filter 只有一组，`autoVerify="true"`：工作区主机（`BASE_URL` 的主机，正式为 `app.notefable.com`）上 `/c/` 开头的分享链接（`/c/<会话>?message=<消息>`，网页 `answerConversationUrl` 生成）。Android 用 `public/.well-known/assetlinks.json`（包名 + Play 应用签名证书的 SHA-256）验证后直接用 App 打开，可以用 `adb shell pm get-app-links com.kakumine.notefable` 查看验证状态。不认工作区的 `/` 和 `/app`（网页登录和 Stripe 付款后的返回地址，不能被 App 抢走），也不认 `notefable.com` / `www`（Android 11 及以下会验证 Manifest 里所有 http(s) 主机，`www` 是跳转、通不过）：以前保存的 `notefable.com/?chat=…` 旧链接由浏览器打开，转到网页工作区。外部链接经 `ChatViewModel.linkRequests` 交给 `NoteFableRoot`，先关掉检索面板和抽屉再打开；从"最近任务"重新进入（`FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`）时不重放当初的链接。在笔记里时先保存笔记，存不上留在笔记里就不动聊天（`setWorkspace` 的 `then` 只在切过去后执行）。会话 ID 形式不对时和网页一样回到新聊天，输入栏上方显示 "Failed to load conversation."；形式对但读不到的会话沿用聊天页原有的加载失败界面。
- 代码：`ui/SearchScreen.kt`（面板、定位与闪烁、抽屉 Search 行）、`ui/SearchViewModel.kt`（状态与防抖，`view()` 推出界面内容）、`data/SearchApi.kt`、`data/SearchFold.kt`、`data/ChatLink.kt`。单元测试：`SearchViewModelTest`、`SearchApiTest`、`SearchFoldParityTest`、`ChatLinkTest`、`ChatRevealTest`、`ChatRevealLayoutTest`。

## 系统分享接收

从浏览器、X、相册、文件等其他 App 点系统「分享」选 NoteFable 时，把文字、链接、图片或文件放进新聊天的输入栏（不自动发送，用户确认或补一句后再发）：

- `AndroidManifest.xml` 在 `MainActivity` 上声明 `ACTION_SEND` 和 `ACTION_SEND_MULTIPLE`（`text/*`、`image/*`、`application/pdf`、`application/json`）。`MainActivity` 在 `onCreate`（排除重建和 `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`）与 `onNewIntent` 里交由 `ui/ShareIntent.kt`（`extractShareIntent`）解析，并立即在后台线程将外部临时 `content://` 文件拷贝到 `attachments/` 缓存目录（复用 `FileProvider` 缓存与 24 小时清理）；超限文件按 `MAX_UPLOAD_FILE_BYTES + 1` 截断计数后带真实大小交给附件校验提示超限；HEIC / GIF 等非直通图片在本地转码为 JPEG（质量 90）。
- `data/ShareIntake.kt`（`composeSharedText`、`mergeDraftWithShare`）负责标题/正文去重与草稿拼接（与 Web、iOS 规则一致）。经 `ChatViewModel.shareRequests` 交给 `NoteFableRoot`，关闭检索面板和抽屉、切到聊天工作区后调用 `ChatViewModel.applyIncomingShare`：从已有聊天切入时开启新聊天并清掉旧引用，已在空新聊天时保留已有草稿并追加分享文字，文件走现有的 `importFiles` 与 `selectionError` 校验。单元测试：`ShareIntakeTest`、`ChatViewModelShareTest`。

## 账号头像（Batch 7b）

和网页设置对话框里的个人资料（`settings-dialog.tsx` / `profile-settings.tsx`）、`avatar-cropper.tsx`、`user-avatar.tsx` 一致（数值取自 `globals.css` 的 `.profile-*` / `.avatar-*` 和 `settings-dialog.css` 的手机宽度规则，写在 `ui/AccountUi.kt`、`ui/AvatarCropper.kt` 开头的注释里；文案在 `strings_account.xml`）。设置要登录才出现，本机开发服务器登不进去，所以没有在浏览器里实测，按 CSS 源码照写。

- 个人资料（设置“账号”页的第一张卡片，`ProfileSettings`）：头像 56 右下角有铅笔角标，点一下打开 / 收起"照片 / 表情"编辑区（1px 描边、圆角 10 的框）；名字最多 40 字（`MAX_DISPLAY_NAME`），聚焦时蓝边加 2px 浅蓝外圈，失焦、回车、离开“账号”页和关设置时保存。改过名字或头像、且有 Google 资料时才有“使用我的 Google 名称和头像”（邮箱登录的人没有 Google 资料）。编辑区开着时返回键先只收起编辑区（不在“账号”页时顺带回到那一页）；系统选择器开着不动，上传中不关、显示“账号”页；选了照片还没存或在上传时，“退出登录”“删除账号”不可点。
- 自定义指令（“个性化”页）：只有这一项要按“保存”。改了以后下方浮出“未保存的更改”条（放弃 / 保存，`UnsavedBar`，一览和各页面上都在）；这时按返回键或顶栏的关闭 / 返回，既不关设置也不回一览，而是显示“个性化”页、让那条晃一下。保存后留在设置里，标题右边显示“已保存”；保存失败也显示“个性化”页（原因写在那里）。
- 照片：系统选择器只列 PNG / JPEG / WebP / GIF；不是图片提示"请选择图片文件。"，超过 10 MB 提示"请选择小于 10 MB 的照片。"（`checkPickedPhoto`）。裁剪（`AvatarCropper`）：直径 200 的圆里拖动、滑块 1–3 倍缩放，规则是网页 `layoutFor` 的移植（`cropLayout`）；按 EXIF 摆正（Android 9+ 用 `ImageDecoder`，更早的用 `BitmapFactory` + `ExifInterface`），短边小于 200 拒绝，原图按 2 的幂缩小到短边仍 ≥ 1536（`avatarSampleSize`）以免 10 MB 原图整个进内存；保存时画成 512×512 的 WebP（质量 90），`POST /api/account/avatar`（multipart，唯一字段 `file`，文件名 `avatar`）。有上传的照片时显示"移除我的照片"（`PATCH {icon: null}`）。系统选择器开着和上传中，点外面 / 返回键不关弹层；选择器的结果在账号行里接（`rememberSaveable`），弹层重组也不丢。
- 表情：`EmojiPickerBody`（高 min(320, 屏高 − 220)），选中走 `PATCH /api/account {icon}`，去掉键写"使用 Google 头像"。
- 保存（`AccountViewModel`，网页 `account-store.ts` 的移植）：编辑马上显示（服务端确认的资料 + 待确认的编辑），名字、图标、照片按顺序一个一个发（`Mutex`）；失败只撤掉那一次，显示服务端原句（经系统文词典翻译）或"无法保存。"（字符串资源 `acct_could_not_save`：这句来自客户端的 `account-store.ts`，不在系统文词典里）；照片失败显示服务端原句、"无法上传这张照片，请重试。"或网络错误的那句。退出登录时先把输入中的名字排进队列（网页靠输入框 blur），再等这些发完。头像照片读不出来时和网页一样退到表情 / Google 照片 / 首字母。
- 接口：`data/AccountApi.kt`（`ProfileEdit`、`applyProfileEdit`、`profileEditChanges`、`AccountProfileBackend`）；`AccountBackend` 只剩登录、读取和退出。单元测试：`AccountViewModelTest`、`AccountApiTest`、`AvatarCropTest`。
- 设置（`ui/SettingsDialog.kt`，网页 `settings-dialog.tsx`）：点侧栏的账号行打开，全屏（`Dialog`，`decorFitsSystemWindows = false`，自己留出系统栏和键盘的位置），分两级（网页手机宽度相同）：先是入口的一览（账号行，下面通用 / 个性化 / 方案 / 账号四行），点一行进到那一栏自己的页面，页面上只有那一栏的内容：通用（语言，见“界面语言”；外观；图标）、个性化（自定义指令）、方案、账号（个人资料，下面是退出登录、删除账号）；点账号行也进“账号”页。顶栏左边的圆形按钮在一览上是关闭、在页面上是返回，标题是“设置”或栏名。保存错误（名字、头像、语言没存上时）在滚动区最上面，一览和各页面上都有。导航的状态和规则在 `ui/SettingsNav.kt`（不碰界面，单元测试 `SettingsNavTest`）：`SettingsNav`（现在是一览还是哪一页）、`settingsDismissStep`（返回键）、`settingsButtonStep`（顶栏按钮），和网页 `src/lib/settings-navigation.ts` 是同一套规则。返回键一次退一步：收起开着的头像编辑区 / 角色网格（并显示它所在的页面）→ 从页面回一览 → 关设置；顶栏的返回连开着的编辑区一起收起、一步回到一览；保存中、删除中都不动；照片在裁剪或上传时顶栏按钮不走，显示“账号”页；有没保存的自定义指令时显示“个性化”页并让条晃一下。换画面时滚动区 200ms 淡入并横移 16（系统关掉动画时、刚打开时的一览不动），从最上面看起；读屏靠 `paneTitle`（标题变了会念出来），键盘焦点移到返回按钮，回一览时回到刚才点的那一行。页面离开画面时它里面的状态不能丢（网页各栏一直挂着、只是不显示），所以方案（`PlanSettingsState`）、删除账号的确认（`DeleteAccountState`）、名字的草稿和自定义指令都由设置窗口拿着；旋转屏幕等重建后留在原来那一页。顶栏按钮、一览的账号行和各栏的行、卡片、行、小按钮和“未保存的更改”条在 `ui/SettingsParts.kt`，数值照 `settings-dialog.css` 的手机宽度规则。自定义指令（计数 n/4000）打开时 `GET /api/custom-instructions`；文字变了才出现“未保存的更改”条，按“保存”就 `PUT`（`AccountProfileBackend.customInstructions` / `saveCustomInstructions`），成功后留在设置里。全屏窗口和两级的切换没有在真机或模拟器上看过（开发环境跑不了模拟器），只通过了编译和单元测试。失败显示服务端原句或 `acct_err_load_custom_instructions` / `acct_err_save_custom_instructions`；保存中不能关、也不能换画面。输入超过上限时用 `clipInstructions` 截断（不把表情的代理对切开），项目设置的指示栏也用它。退出登录不会失败（`signOut` 忽略网络错误、照常换成匿名身份），所以没有网页的“无法退出登录”提示。
- 图标（`ui/AppIconSettings.kt`、`ui/Mascot.kt`，网页 `app-icon-settings.tsx` / `app-icon.tsx` / `character-avatar.tsx`；值和存法在 `data/AppIcon.kt`、`data/Characters.kt`，网页 `src/lib/app-icon.ts`、`src/lib/characters.ts`）：把空白聊天页形象、侧栏标志、AI 回答标签上的角色和笔记里 AI 按钮上的角色统一换成所选的预设 AI 角色（7 种：Foldie、Piko、Velo、默认的 Quill、Sora、Loop、Orbit）或上传的图片。在“通用”页的卡片里、语言的下面：一行是标题 + 说明，右边 40 的圆形预览（白底、1px 深描边，里面 24 的角色 / 图片预览）；下面一排两个可换行小按钮“选择角色”“上传图片”（`.settings-chip`，不再提供表情和 NoteFable 标志按钮）；“选择角色”打开 / 收起下面的 3 列角色选择网格（选中项带蓝色勾标、Quill 标出“默认”，点选 Quill 即恢复默认）。“上传图片”用头像的系统选择器（PNG / JPEG / WebP / GIF），按 EXIF 摆正后居中裁成正方形、缩到 96×96、存成 PNG 的 data URL（网页 `imageFileToIcon`）；不是图片或读不出来提示“请选择图片文件。”，存不进去提示“无法在这台设备上保存图标。”。选了就存、不用按“保存”，只存在这台设备上（`SharedPreferences` `app_icon`，`AppIconStore`；值和网页 `localStorage` 的 `notefable:app-icon` 相同：`character:<id>` 或图片的 data URL，默认 Quill 存 `null`；旧版存下的表情会自动回退为默认 Quill，已有上传图片原样保留），不随账号同步，退出登录也留着。显示用 `AppIcon` / `Mascot`（预设角色按语义状态机绘制，系统关掉动画或后台隐藏时静止；上传图片圆角 22% 静态显示，读不出来的图片退回默认 Quill）：空白页 64×68、侧栏头部 20、回答标签 32、设置预览 24；WebView 编辑器里的 AI 按钮（网页 56 的圆、角色 34）经 JS 桥拿到同一个值（见“笔记”一节）。单元测试：`AppIconTest`、`CharactersTest`。
- 外观（`ui/ThemeSettings.kt`，网页 `theme-settings.tsx`；值和存法在 `data/AppTheme.kt`，网页 `src/lib/theme.ts`）：跟随系统 / 浅色 / 深色三选一的分段，在“通用”页的卡片里、语言和图标之间；未登录时在帮助菜单里多一项“外观”（`HelpMenuUi.kt`，点了换成三个选项的菜单），和网页一样。偏好存在 SharedPreferences `app_theme` 的 `theme`（`system` / `light` / `dark`，读不到或不认识的值按 `system`），只在这台设备上，不随账号同步，退出登录也不清。`MainActivity` 按偏好和系统的深浅算出实际外观，交给 `NoteFableTheme(darkTheme)` 并同步窗口底色；清单里 `configChanges` 含 `uiMode`，系统切换深色时 Activity 不重建。单元测试：`AppThemeTest`。与网页的差别：表情选择器跟着变深（网页的固定浅色）。
- 已知差异：缩放滑块是 Material3 `Slider`（蓝色），没有对照网页 Chrome 的 range 外观逐像素量；裁剪预览的读屏说明沿用网页原句（提到方向键，原生只能拖）。
## 构建与测试

```bash
cd mobile/android
# local.properties（不提交）里写一行：sdk.dir=A\:/Android/Sdk（使用正斜杠）
./gradlew testDebugUnitTest assembleDebug          # 产物 app/build/outputs/apk/debug/app-debug.apk
```

- 需要发布时，通过合入 main 的 PR 提高 versionCode，CI 会构建 AAB 并同时发布到 Play 的内部测试和 alpha 封闭测试轨道。本机的 `assembleRelease` / `assembleDebug` 包只用于本机检查，没有 Google 登录（用邮箱验证码登录）。流程和 Drive 规则见 [android.md](android.md#安装包交付)。
- 默认连线上 `https://app.notefable.com`（`mobile/android/gradle.properties`）。连电脑上的开发服务器：`./gradlew assembleDebug -Pnotefable.baseUrl=http://10.0.2.2:3000 -Pnotefable.siteUrl=http://10.0.2.2:3000`（笔记编辑器要用上面"笔记"一节的 `adb reverse` + `localhost`）。明文 HTTP 只在 debug 包允许，且只限 `10.0.2.2` / `localhost`（`src/debug/res/xml/network_security_config.xml`）。
- 模拟器里要先 `adb install -r app-debug.apk`。Windows 上用 `emulator -avd <名字>` 启动前设置 `ANDROID_AVD_HOME=C:\Users\<用户>\.android\avd`。

## 路线图

1. ✅ 聊天（本阶段）。
2. 附件与图片：✅ 文件选择上传、拍照、粘贴图片和「生成图片」模式；✅ 服务端错误文的各语言译文（系统文词典）；✅ 上限时恢复草稿与登录提示；✅ 生成图片的保存、推理 / 搜索 / 笔记工具的进度面板、笔记提案卡片（见“回答体验”）。
3. ✅ 笔记：原生笔记列表、项目（分组）、回收站、拖动排序（0.4.0）；编辑器用 WebView 加载网页的 `/note-embed`，通过 JS 桥同步标题、保存状态、离开前保存和返回键。还差：侧栏里给正打开着的笔记改图标（要先给编辑器加桥接口）。（搜索见“搜索与跳转”。）
4. 账号：已有统一登录弹窗、Credential Manager Google 登录、邮箱验证码登录、退出，以及设置（显示名和头像（照片 / 表情）、存到账号的界面语言、自定义指令）。Google 沿用 `/api/native-auth/*`（受众仍是 Web 客户端 ID），邮箱用 `/api/auth/email/*`；仍需完成真实账号流程验证。Google Cloud 只登记 `NoteFable-Android`（包名 + Play 应用签名），本机签名的包没有 Google 登录。
5. ✅ 替换 Capacitor 外壳：外壳代码已删除。
