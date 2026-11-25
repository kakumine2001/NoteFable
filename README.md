# NoteFable

> **面向个人的 AI 认知工作台（Personal AI Studio）**——以对话为入口、以可沉淀的作品（笔记 / 白板 / 幻灯片）为画布、以多模型 AI 搭档陪伴你的整个思考闭环。

**快速导航：**
[产品定位](#产品定位) · [架构与文档导航](#架构与文档导航) · [功能概览](#功能概览) · [模型与上传存储](#模型与上传存储) · [用量与边界](#用量与边界) · [部署与技术栈](#部署与技术栈) · [本地启动与配置](#本地启动与配置) · [校验](#校验)

---

## 产品定位

单纯的 AI 聊天聊完即沉底、难以长期组织与反复精修；传统笔记软件则往往需要人先搭结构、再手动排版。NoteFable 把两者融进同一个个人空间：

- **对话即创作，成果可沉淀**：从提问、联网查证、看图读文件开始，将想法与回答沉淀为可编辑的**笔记**、自由绘制并支持导入 PDF 批注的**白板**，以及可全屏放映和导出 PPTX / PDF 的**幻灯片**；AI 能针对笔记提出带对比预览的修改或新建建议（由你决定应用，可一键撤销），能读取白板与幻灯片，还能把回答或笔记画成可编辑的白板图。
- **作品反哺对话**：沉淀下来的页面不是静态归档——随时附加进对话或挂入项目参考，让 AI 带着你的资料继续推进思考。
- **有温度、多模型自由**：支持多种主流模型与可调思考深度，搭配自定义指令与 AI 角色形象，不被单一模型厂商绑死。
- **专注个人闭环，全端原生打磨**：不做重型团队协作，聚焦一个人从输入吸收、沉淀内化到表达输出的完整闭环；无广告，支持单页笔记（Markdown）、白板、幻灯片与对话导出，持续打磨 Web、原生 Android 和原生 iOS 体验。

---

## 架构与文档导航

README 作为系统总览入口；更细的流程拆在 `docs/architecture/`。

```mermaid
flowchart LR
    Browser["Browser"]
    App["Next.js on Vercel"]
    Neon["Neon PostgreSQL"]
    Blob["Private Vercel Blob"]
    OpenAI["OpenAI APIs"]
    DeepSeek["DeepSeek API"]
    Anthropic["Anthropic API"]

    Browser --> App
    App --> Neon
    App --> Blob
    App --> OpenAI
    App --> DeepSeek
    App --> Anthropic
```

几个月没维护、需要重新理解项目时，从这里开始：

| 主题 | 文档 |
| --- | --- |
| 快速上手 | [项目全景图（入门版，用大白话讲整体结构、签名、发布和收费）](docs/project-map.md) · [详细架构入口：5 分钟恢复上下文](docs/architecture/README.md) |
| 核心业务流 | [聊天请求流程](docs/architecture/chat-flow.md) · [上游请求结构示例](docs/architecture/provider-requests.md) · [站内页面与自动保存](docs/architecture/notes-flow.md) · [图片上传与生成流程](docs/architecture/image-flow.md) |
| 数据与多语言 | [数据库设计](docs/architecture/database.md) · [界面语言（17 语言与 RTL）](docs/architecture/i18n.md) |
| 原生客户端 | [Android 应用与发布](docs/architecture/android.md) / [原生 Android 界面](docs/architecture/android-native.md) · [iOS 应用与发布](docs/architecture/ios.md) / [原生 iOS 界面](docs/architecture/ios-native.md) |
| 运维与商业化 | [部署与运行环境](docs/architecture/deployment.md) · [付费方案与用量上限](docs/architecture/billing.md) |

---

## 功能概览

用户可以从聊天开始，把回答和资料整理进工作区（Workspace）的笔记、白板和幻灯片，再让 AI 读取这些页面、对笔记提出修改建议，确认后应用（笔记里的 AI 面板可以打开“自动应用”，改动可撤销）。

当前已涵盖：匿名试用、Google / 邮箱验证码登录、流式聊天、文件上下文、图片输入与生成、Web 搜索、系统分享接收（Web / Android / iOS）、发言附加页面（笔记 / 白板 / 幻灯片）、引用回答追问、回答保存 / 整段整理成笔记与整段对话导出、画成图（回答或笔记 → 可编辑白板）、回答举报、跨 Chats 与工作区页面的搜索（页面另有语义检索）、自定义指令、项目共通指示与参考页面、AI 角色形象、页面的子页面 / 收藏 / 页面设置 / 回收站 / 编辑历史与可选的单向公开只读分享链接、笔记里选中文字或选中块问 AI、笔记的 Markdown 导出 / 导入、笔记一键放映并另存为幻灯片、白板与幻灯片、桌面端聊天与页面分屏、浅色 / 深色外观，以及可选的 Pro 月额订阅与账号删除。以下记录当前实现；当前没有团队协作功能，私人聊天与未公开的页面仅作者可见。

### 域名分流与多语言（17 语言与 RTL）

- **分域访问**：产品介绍主页在 `notefable.com`，聊天与工作区（Workspace）在 `app.notefable.com`（参照 Notion 的分域；同一份代码按主机分流，见 [deployment.md](docs/architecture/deployment.md)）。旧地址 `notefable.com/app` 和带 `chat`、`message`、`view` 或 `page` 参数的旧链接保留全部查询参数转到工作区。没有设置分域变量的环境（Preview、本地）仍是 `/` 介绍页、`/app` 工作区。
- **17 种界面语言**：English、简体中文、繁體中文、日本語、한국어、Español、Français、Deutsch、Português (Brasil)、Italiano、Bahasa Indonesia、Tiếng Việt、ไทย、हिन्दी、العربية（支持完整的从右到左 RTL 排版）、Türkçe、Русский，以及“自动检测”选项。
- **切换与检测规则**：登录用户在“设置”中选择并跨设备同步，未登录访客在侧栏帮助菜单或介绍页页脚选择本机语言；退出登录时清除本机偏好并回到自动检测。自动检测按“浏览器 / 系统语言 → 保守的访问国家回退 → 英文”决定，明确选择的语言优先于环境判断。
- **静态生成与边界**：首页、`/app` 和 `/note-embed` 按全部 17 种语言预先生成静态页面，由 `src/proxy.ts` 在网址不变的情况下返回对应页面。界面语言不改写聊天、笔记或 AI 的输出语言；隐私政策、服务条款正文保持英文，特定商取引法标示保持日文。详见[界面语言](docs/architecture/i18n.md)。

### 聊天、项目与桌面分屏

- **数学公式（LaTeX）**：回答里的行内和独立公式均会排版显示（网页用 KaTeX，Android 原生 App 用 KaTeX 字体的原生排版库，iOS 原生 App 用 SwiftMath），金额里的 `$` 不会被误当成公式。详见 [chat-flow.md](docs/architecture/chat-flow.md#回答里的数学公式)。
- **停止、改写、重新生成与分支**：
  - 回答进行中，发送键变成停止键，停下时已生成部分会保存下来。
  - 每条回答的“…”菜单提供重新生成（用当前所选模型）与“在新聊天中分支”（复制到这条回答为止的新聊天）；自己的发言可复制或改写后重新回答。
  - 改写和重新生成不丢弃原内容：同一位置出现 `‹ 2/3 ›`，可切回旧版本及后续对话。
  - 回答正文里选中文字可点“问 NoteFable”引用追问；发言时可通过“添加页面”或空白聊天页的最近编辑卡片附加最多 5 个页面（笔记、白板、幻灯片均可）。详见 [chat-flow.md](docs/architecture/chat-flow.md#停止编辑重新生成与分支)。
- **桌面端聊天与笔记分屏**：
  - 视口宽度 1100px 以上时，聊天顶栏提供分屏按钮，在右侧并排打开正常编辑器（带笔记切换、版本历史、页面菜单、“在完整视图中打开”和关闭）。
  - 中间分隔线可拖动（笔记侧占 30%–65%，默认 46%；双击恢复默认，聚焦后用 `←` / `→` 调整）；开关、打开的笔记和比例保存在当前浏览器（`localStorage`）。
  - 宽屏聊天中点笔记链接（搜索结果、参考/附加笔记标签、保存或整理后的打开链接）会在右侧直接打开不离开对话；右侧笔记选中文字点 “Ask AI” 会引用进聊天输入框并附加该笔记；发消息前自动保存右侧未保存编辑。手机宽度和原生 App 无分屏。详见 [chat-flow.md](docs/architecture/chat-flow.md#聊天与笔记分屏)。
- **侧栏项目、图标与拖拽排序**：
  - 聊天侧栏每行右侧三点菜单支持置顶/取消置顶、重命名、移动到独立聊天项目、删除确认。项目可新建、改名、删除（删除项目保留聊天）；项目菜单中的 Project settings 可设共通指示与参考页面。共享与归档暂不提供。
  - Chat 和工作区列表无单独拖动柄：直接拖动整行（标题区）调序（触屏长按后拖动；焦点在行上时 `Alt+↑/↓` 也可调整，刷新后保留；在标题区滑动仍正常滚动列表）。Chat 行拖到项目行可移入项目（取消置顶并自动展开项目），拖到 Chats 标题移出项目。
  - 每个聊天可设置 emoji 图标（与工作区页面共用选择器）：点击标题左侧图标或侧栏行最左图标即可更换（`Remove` 恢复默认聊天气泡）；新聊天在发第一条消息前就能选；手机顶栏也可改。修改图标不改排序，快速连点按序保存最后一次选择，失败回滚。

### 回答的复制、保存与导出

每条完成的 AI 回答下方保留复制和三个点（More options）图标（多版本时带 `‹ 2/3 ›`），菜单包含：Regenerate、Branch in new chat、Save to page（保存后变为 Open saved page）、Download conversation、Report answer（`POST /api/reports`；AI 提案卡片、AI 写过的页面和幻灯片中 AI 生成的图片也支持举报）。此外，输入栏“＋”菜单提供 **Create page**（`POST /api/sessions/:id/page`，用当前模型将整段对话整理成新笔记，计入 1 次聊天额度）。

- **Copy**：复制保存的 Markdown 原文。
- **Save to page**：一键将点选的回答新建为笔记（网页走 `POST /api/pages`，原生端走 `POST /api/pages/from-answer`），取首标题或首行为标题，保留列表、代码块、引用、GFM 表格（存为原生表格块）和 Web 搜索出处链接，末尾附分隔线与回原会话链接；过长在块边界截断并注明（上限 2,000 块、1 MiB）。“已保存”仅当前页记忆，刷新后再点会新建第二篇。
- **Download conversation**：按顺序导出整段对话的提问与回答为 `.md`（以会话标题命名），保留代码、引用链接和附件名称（图片保留需登录查看的链接，不打包原文件），末尾附原会话链接。
- **原会话链接**：形如 `/c/<会话 ID>?message=<消息 ID>`（兼容旧版 `/?chat=<会话 ID>&message=<消息 ID>`），打开后直达该消息并滚动定位；并非公开分享链接，仍按设备 Cookie 或登录账号归属。无需新增环境变量或迁移。详见 [chat-flow.md](docs/architecture/chat-flow.md#回答的复制保存到-notes-与-markdown-导出)。

### 工作区：笔记、白板与幻灯片

#### 侧栏、主页与页面外观
- **切换与主页**：侧栏顶部 `Chat / Workspace` 切换聊天与工作区（收起侧栏后需展开切换）。切到 Workspace 且 URL 无 `page=` 时显示工作区主页：标题（640px 以上换成问候语）、New project / Import Markdown、快速新建卡片（笔记 / 幻灯片 / 白板），然后是按 `updatedAt` 取最近 8 个页面的“最近编辑”卡片（各宽度都显示，横向滑动，带封面与类型图标）、类型筛选和页面列表（收藏、各项目，以及不在项目里的页面按类型分区；能建多种类型时 640px 以上的列表标题是 “All pages”）。640px 以上侧栏的“主页”行可返回。打开页面压入带 `page=` 的历史，浏览器“返回”或删除正打开的页面后回到主页。
- **组织与外观**：支持创建、选择、收藏（Favorites）、单层项目分组（`NoteGroup`）、嵌套子页面（`parentId`）、Import Markdown 与 Trash；编辑页顶栏“…”菜单提供字体（Default / Serif / Mono）、小字号、全宽（这三项只对笔记）、锁定页面、Present（笔记一键放映）、收藏、复制子树、新建子页面、Draw as diagram（画成图，只对笔记）、移动、导出 Markdown（只对笔记）、Report AI content（AI 写过的页面）、移入回收站。悬停标题区可 `Add icon / Add cover`（emoji 图标同步侧栏与顶部；封面支持预设渐变/纯色或上传最大 4 MiB 图片并拖动调位）。页面按保存的拖动顺序排列，同序按创建时间倒序；编辑和自动保存不改变排序。
- **动效与手势**：Chat / Workspace 切换、手机笔记列表进出及列表增删移动使用浏览器 View Transition（不支持时直接切换）；手机抽屉支持左滑关闭，模型/附件/笔记 AI 底部面板可拖动手柄下滑关闭（距离不足回弹）；按钮有轻微按压反馈；系统开启“减少动态效果”时关闭过场与回弹动画。

#### 笔记编辑器与自动保存
- **编辑器能力**：基于 BlockNote 社区版，支持段落、H1–H3（含折叠标题）、项目/编号/待办/折叠列表、引用、Callout、代码块（语法高亮、语言选择、一键复制）、分隔线、表格、行内与块级数学公式（KaTeX）、目录块（另有右侧悬浮大纲）、多栏布局、`@` 提及页面与日期，以及上传的图片和文件块；支持 `/` 菜单、Markdown 快捷输入、行内格式工具栏、块选择（多块一起转换类型、着色、复制、删除或问 AI）与拖动整理。笔记附件单个上限 4 MiB（4,194,304 字节，与聊天附件限制独立），详见 [notes-flow.md](docs/architecture/notes-flow.md#图片与文件)。
- **快捷操作**：
  - 标题自动换行，`Enter` 进正文；首块开头按 `↑` 回标题；点正文下方空白继续输入；区块加号默认下方插入，`Alt`＋点击上方插入。
  - 手柄菜单支持转换类型、颜色、复制、删除；`/turn` 转换当前文字块，`Ctrl/Cmd+D` 复制当前或选中块（含子块）。
  - 块类型快捷键：Windows `Ctrl+Shift+0/1/2/3/4/5/6/7/8`（Mac `Cmd+Option+0..8`）依次转为文本、H1/H2/H3、待办、项目列表、编号列表、折叠列表、代码；`Ctrl/Cmd+E` 行内代码，`Ctrl/Cmd+Shift+S` 删除线。
- **自动保存、冲突与边界**：
  - 停止输入约 1 秒自动保存，顶部显示 `Saving… / Saved`，正文以原生区块 JSON 存 `NotePage` 表。浏览器仅缓存未保存草稿，失败可重试或刷新恢复；多标签冲突由版本号拦截，可另存为新页或载入最新版。
  - 未登录页面绑定当前浏览器与域名；登录后可跨设备找回（不自动合并另一设备匿名数据）。标题上限 200 字符，单页请求上限 1 MiB、2,000 块、8 层块嵌套。

#### 页面内 AI 助手
- 页面编辑和自动保存不调用 AI 模型（开启语义搜索时，保存后会更新嵌入索引，见下文“搜索”）；页面内 AI 助手（笔记、白板、幻灯片共用面板，白板/幻灯片目前只能问、不能改）仅在发送请求后调用所选模型。
- 选中文字时格式工具栏最前有 “Ask AI”，选中多个块时浮动栏有 “Ask NoteFable”，点击打开助手并引用所选内容，附带快捷操作（改进写作、修正拼写和语法、缩短、解释、翻译）。
- 助手对话持久化在服务端，首次打开恢复最近一段，标题栏 “New chat” 可另开新段。输入栏“＋”菜单含添加文件或照片、添加页面（桌面聊天输入栏“＋”含添加文件或照片、创建图片、整理成笔记，手机“＋”抽屉合并四项），与聊天共用模型/推理强度选择；不提供图片生成与联网搜索。Android / iOS 的 `/note-embed` 由 App 传入模型，不显示模型选择器。详见 [notes-flow.md](docs/architecture/notes-flow.md)。

#### Markdown 导入与导出
- **导出**：页面菜单 “Export Markdown” 下载 `.md`（`# 标题` + 正文，`GET /api/pages/:id/export`）。不打包图片和文件，上传的图片/文件块输出为 `[Image: 名称]` / `[File: 名称]`；无整工作区 ZIP 导出。
- **导入**：工作区侧栏、主页与空状态的 “Import Markdown” 支持单次选最多 20 个 `.md` / `.markdown` / `.txt` 文件（单文件 ≤ 1 MiB，合计 ≤ 4 MiB），每文件新建一篇笔记（`POST /api/pages/import`，首标题行或文件名作标题）。建过项目时会先询问导入目标项目（或“无项目”）；任一文件不合格整批不创建。详见 [notes-flow.md](docs/architecture/notes-flow.md#markdown-导出与导入)。

#### 白板（`whiteboard`）
- 基于 MIT 授权的 Excalidraw（使用 NoteFable 自建工具栏与面板）：支持压感画笔、荧光笔、橡皮、激光笔、形状、线和箭头、文字、便签、图片、框，以及样式面板、小地图、网格、吸附、锁定和指向笔记/白板/幻灯片的页面卡片；检索可定位到白板元素。
- 支持导入 PDF（每页放入一个框并锁定底图直接批注），导出 PNG、SVG 与 PDF（有内容的框各一页，框外内容放最后一页），并支持发布公开只读链接。Android / iOS 通过 `/note-embed` 使用同一编辑器，导出文件交给系统保存。详见 [whiteboard.md](docs/architecture/whiteboard.md)。
- **画成图（Draw as diagram）**：聊天回答或笔记的“…”菜单（以及网页笔记 AI 面板的快捷按钮）让 AI 先写 Mermaid，服务端再转成可编辑的白板元素（思维导图用自建的排版引擎），存成新白板（从笔记来的是它的子页面），计入 1 次聊天额度（`POST /api/pages/diagram`）。详见 [chat-flow.md](docs/architecture/chat-flow.md#画成图draw-as-diagram) 与 [whiteboard.md](docs/architecture/whiteboard.md#画成图ai-把回答或笔记画成可编辑的图153)。

#### 幻灯片（`slides`）
- 仿 Figma Slides：支持总览（一行一章）与单页编辑、8 种版式、8 套浅/深色主题、文字框（格式、列表、链接、代码、KaTeX 公式、CJK 输入法）、图片（上传、粘贴、聊天图片、AI 生成）、形状、线、表格、自由摆放（拖动、缩放、旋转、吸附、对齐、分布、层级、组合）、演讲者备注、翻页转场（淡入 / 滑入）、撤销/重做与快捷键。
- 支持全屏放映（桌面带演讲者视图、黑屏/白屏与数字跳页）、导出 PDF（可选备注）、PNG 与可编辑 PPTX（不含转场），以及发布公开放映链接（不含隐藏页与备注）。Android / iOS 在 `/note-embed` 中使用同一编辑器，放映时自动横屏、全屏、常亮，导出文件交系统保存。详见 [slides.md](docs/architecture/slides.md)。
- 普通笔记的“…”菜单有 **Present**：把笔记临时排成幻灯片放映（按分隔线或一级标题分页，不写库），放映中可 “Save as slide deck” 另存为幻灯片。

### 搜索、项目上下文与回收站

三项功能的数据只新增表与可空列，随 `npm run prisma:migrate` 部署。只有工作区页面的语义检索会调用外部接口（OpenAI 嵌入；共用 `OPENAI_API_KEY`，可选 `NOTEFABLE_SEMANTIC_SEARCH` / `OPENAI_EMBEDDING_MODEL`，见 [deployment.md](docs/architecture/deployment.md)）。

- **跨 Chats 与工作区页面搜索**（`Ctrl/Cmd+K` 打开；分类 All / Chats / Pages）：
  - 接口 `GET /api/search?q=…&scope=all|chats|notes[&projectId=…][&kind=note|slides|whiteboard]`：`q` 长 1–100 字符，按空白切最多 8 词且全部命中，每类最多返回 15 条。
  - 匹配折叠大小写、全角/半角、平假名/片假名（如 `ＡＰＩ` 匹配 `API`，`でーた` 匹配 `データ`）以及弯引号与各类连字符；1–2 个字母数字词仅在词首匹配，其余子串匹配。
  - Chats 可跨标题、多条消息与附件抽取文本匹配，每会话返回 1 条（排序：全词在标题 → 单条消息含全词 → 分散多条消息），带 `messageId` 与可选 `attachmentName`；支持按 `projectId`（Chats）与 `kind`（Pages）筛选。Trash 里的页面不参与搜索；页面 AI 面板的聊天可被搜到。点结果直达对应会话/页面并滚动短暂高亮。
  - 页面另有语义检索：配置了 `OPENAI_API_KEY`（且未关闭）时，关键词命中不满 15 条就用 OpenAI 嵌入补上意思相近的页面（换说法、跨语言也能命中），排在关键词结果之后；未配置、超时或超出每日上限时静默退回纯关键词。
  - 局限：Chats 只做关键词匹配，无同义词、翻译、繁简转换和无空格中文分词；顺序扫描无索引（本地 20,000 消息单词约 50 ms，Neon 生产未实测），数据库需 UTF8。详见 [chat-flow.md](docs/architecture/chat-flow.md#跨-chats--pages-搜索)。
- **聊天项目共通指示与参考页面**：
  - 项目菜单 “Project settings” 支持最多 4,000 字符共通指示 + 手动选最多 5 个参考页面（笔记、白板、幻灯片均可；Trash 里的不生效）。
  - 每次发送实时读取并注入系统指令（共通指示优先于默认语言与格式；参考页面的文字仅作为资料，白板 / 幻灯片取保存时提取的文字，每篇最多 8,000 字符、合计最多 20,000 字符，超出截断，计入模型输入用量）。回答前过程条显示 “Used project …”，可点击标签打开参考页面。详见 [chat-flow.md](docs/architecture/chat-flow.md#项目的共通指示与参考笔记)。
- **Trash 与编辑历史**：
  - 删除页面先移入 Trash，30 天内可完整复原（保留位置、分组、正文），也可单篇或清空永久删除；超期页面在打开 Trash、删除另一篇或清空时惰性清除（无定时任务），永久删除同时清理编辑历史与项目参考关联，页面 AI 面板的聊天保留在 Chats。
  - 每篇笔记保留最多 50 份编辑历史（自动保存快照 30 份，间隔 ≥ 10 分钟；AI 提案应用前与每次恢复前的快照 20 份）；白板 / 幻灯片的本体较大，只留 10 份（自动 5 份，间隔 ≥ 30 分钟；AI / 恢复前 5 份）；自动快照 90 天后清除。恢复仅改标题、图标和正文（白板 / 幻灯片为本体），不动封面、分组和位置。详见 [notes-flow.md](docs/architecture/notes-flow.md#trash回收站)。

### 账号、设置、外观与 AI 角色形象

- **入口与布局**：侧栏底部左侧为账号区，右侧为 “?” 帮助菜单（官网、Privacy、Terms、Commercial disclosure 及未登录访客的语言与外观）。未登录点 “Sign in” 按配置提供 Google / 邮箱验证码（均未启用则隐藏）；登录后点击头像/名字/齿轮打开唯一设置入口。电脑端为左导航（通用 / 个性化 / 方案 / 账号）+ 右内容对话框，手机端为全屏两级页面（规则见 `src/lib/settings-navigation.ts`，Android / iOS 一致）。
- **设置项**：改显示名、上传并裁剪头像、选 emoji、可搜索的 17 语言与自动检测选择器、最多 4,000 字符自定义指令（适用于后续聊天和笔记 AI 助手，优先级低于项目共通指示）、查看方案与用量（支持升级/管理 Pro）、退出登录与删除账号（`DELETE /api/account`，公开说明页 `/delete-account`）。资料、语言、图标即时保存；仅自定义指令需点底部“保存 / 放弃”条，未处理前不关闭设置。
- **AI 角色形象（图标）**：提供 7 个预设角色（Foldie、Piko、Velo、默认 Quill、Sora、Loop、Orbit，带输入/思考/回答/完成/报错轻量动画，开启“减少动态效果”时静止）或上传自定义静态图片，统一替换新对话首页、AI 回答标记、侧栏标志和笔记 AI 按钮。本机存 `localStorage`（`src/lib/app-icon.ts`），登录后经 `GET/PUT /api/app-icon` 跨 Web / Android / iOS 同步（上传图存私有 Blob，见 [image-flow.md](docs/architecture/image-flow.md)）；退出登录恢复默认。笔记 AI 按钮可自由拖动位置，位置记在当前浏览器（`src/lib/fab-position.ts`）。
- **外观（跟随系统 / 浅色 / 深色）**：仅存当前设备（网页用 `localStorage` 的 `notefable:theme:v1`，`src/lib/theme.ts`），不随账号同步；登录用户在“设置 → 通用”选，访客在帮助菜单选。根布局内联 `THEME_INIT_SCRIPT`（`src/lib/theme-init.ts`）在首绘前写入 `data-theme` 与 `color-scheme` 防止深色闪白，且不读 Cookie/请求头保持页面静态。深色配色见 `src/app/globals.css` 的 `:root[data-theme="dark"]`（BlockNote 跟随切换，表情选择器保持浅色；分域介绍页 `notefable.com` 跟随系统）。Android / iOS 设置含同一项并同步传给内嵌编辑器。

### 移动应用（Android / iOS）

- **Android**（`mobile/android/`，Kotlin / Compose）：聊天、侧栏、搜索、附件、图片生成、笔记列表/项目/子页面/收藏/页面菜单、回收站、两级设置（含 Google Play Pro 订阅）、Google / 邮箱验证码登录、引用追问、回答举报、发言添加页面、整理成笔记、画成图、系统分享接收、外观切换、Markdown 导入/导出均已实现；笔记、白板和幻灯片的编辑器通过 WebView 加载 `/note-embed`。默认连接 `https://app.notefable.com`（接口仅在该主机提供，`notefable.com/api/*` 返回 421）。详见 [android-native.md](docs/architecture/android-native.md) 与 [android.md](docs/architecture/android.md)。
- **iOS**（`mobile/ios/`，Swift / SwiftUI）：对照 Android 移植的原生客户端，通过 CI 编译、Core 单元测试和模拟器截图检查；合入调高构建号的 PR 后自动上传 TestFlight，构建已装到真机，界面尚未逐项验收。上架前还缺 App Store 内购、Sign in with Apple（或确认邮箱验证码登录满足审核要求）和通用链接（网站尚未提供 `apple-app-site-association`）。结构与待补项见 [ios-native.md](docs/architecture/ios-native.md)，PR 检查与 TestFlight 自动上传见 [ios.md](docs/architecture/ios.md)。

---

## 模型与上传存储

### 模型能力与上下文管理

| 模型 | 核心能力 | 推理强度档位 | 备注 |
| --- | --- | --- | --- |
| **GPT-6 Luna** | 图片输入、Web 搜索、Notes 工具 | `none / low / medium / high / xhigh / max` | OpenAI Responses API；原生自动压缩 |
| **Claude Haiku 5.5** | 图片输入、原生 Web 搜索、Notes 工具 | `low / medium / high / xhigh / max`（默认 `medium`） | Anthropic Messages API；adaptive thinking；推理滑杆暖色（其余蓝色） |
| **DeepSeek-V4.1-Flash** | 图片输入、内置 Web 搜索（`deepseek_web_search`）、Notes 工具 | `low / high / max`（默认 `high`） | DeepSeek Responses API |

- **图片生成**：独立于当前聊天模型，任何模型下均可打开 Create an image，`/api/images` 固定调用 OpenAI 图片接口，所选聊天模型仅记录在消息上。
- **Notes 工具与提案系统**：三家模型均可用 `search_notes` / `list_pages` / `read_note` 读当前用户页面（Trash 除外；白板/幻灯片目前只读），用 `list_chat_attachments` 查当前聊天附件，用 `propose_note_edit` / `propose_note_create` 提议修改笔记或新建笔记（可将符合条件的聊天图片放进笔记）。提案存 `NoteProposal` 表，默认显示待确认卡片、点 Apply / Create note 后生效且仅生效一次；笔记的 AI 面板开启“自动应用”时，对所在未锁定笔记的修改与新建笔记会立即保存（对其他页面仍需确认）。已应用提案可一键撤销（编辑回滚，新建移入 Trash），提案卡片与 AI 写过的页面支持举报。详见 [chat-flow.md](docs/architecture/chat-flow.md#ai-操控底座框架--各类型适配器158)。
- **长上下文与原生自动压缩**：
  - Claude 默认 `max_tokens: 128000`（含思考与回答）、1,000,000 token 上下文；使用 `compact-2026-01-12` Beta 与 `compact_20260112`（官方默认 150,000 输入 token 触发）。GPT-6 Luna 请求 `context_management: [{type: "compaction"}]`（沿用官方默认触发值）。触发摘要会产生额外用量。
  - 两者均发送上次压缩状态与后续全部文字历史，首次压缩前发送全部文字历史（不再按 30 条或历史附件 120,000 字符截断；DeepSeek 同样发送全部文字历史，历史附件文本合计仍限 120,000 字符），单文件提取与历史图片限制保留。`Message.providerContext` 按 provider 与上游 model 隔离保存服务端压缩状态，不返回浏览器。超上游硬限仍会报错；实时聊天不调用 Batch API。参见 [OpenAI 压缩](https://developers.openai.com/api/docs/guides/compaction) 与 [Claude 压缩](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold)。
- **服务端原生 Web 搜索**：分别使用 OpenAI `web_search`、DeepSeek `deepseek_web_search`（不可在 `tool_choice` 中强制指定，固定 `"auto"`；该模型忽略 `web_search`）与 Anthropic `web_search_20250305`（省略 `max_uses`，默认 `"auto"`；遇 `pause_turn` 保留原生块继续，与 Notes 工具合计最多 8 次上游续接请求）。三家引用均转可点击链接保存。参见 [DeepSeek 搜索说明](https://api-docs.deepseek.com/guides/web_search) 与 [Claude 搜索说明](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)。
- **各家接入细项**：Claude 经 `ANTHROPIC_API_KEY` 走 `/v1/messages`（与订阅计费分开），规格见 [Haiku 官方规格](https://platform.claude.com/docs/en/models/haiku-5-5/overview) 与 [effort 说明](https://platform.claude.com/docs/en/build-with-claude/effort)，代码执行/结构化输出未开放，PDF 走统一文本提取，思考块不保存。DeepSeek 对 `response.output_text.delta` 检查 DSML/工具结果标记，命中或流异常/空回答均按失败处理，异常文本不再送入后续上下文但保留原记录。

### 上传限制与文件存储

聊天输入框选文件与粘贴图片时即时校验数量、类型、单文件及总大小，服务端复用相同校验；超限时整批不加入并保留原附件与文字，发送前再校验。支持文本、Markdown、JSON、CSV、TSV、TXT、PDF 与 PNG/JPEG/WEBP 图片。

| 限制项 | 规则 |
| --- | --- |
| 单次聊天附件数 | 图片和文件合计最多 **10 个**（共用额度） |
| 单次聊天附件大小 | 单文件 ≤ **20 MiB**，合计 ≤ **100 MiB** |
| 工作区页面单附件（笔记的图片 / 文件、白板与幻灯片的图片、封面） | 单个 ≤ **4 MiB** |
| 用户总文件存储空间 | 游客 **100 MB** / 登录免费 **500 MB** / Pro **10 GB**（`src/lib/usage-plans.ts` 的 `STORAGE_LIMITS`） |

- **直传私有 Blob**：浏览器经 `/api/uploads` 拿限路径、限大小、短时效凭证，通过 `@vercel/blob/client` 直传私有 Blob；聊天与生图请求仅传签名附件引用（`uploads`），绕过 Vercel Function 的 4.5 MB 入站请求上限。上传显示进度，失败保留现场可重试；服务端校验签名、归属、数量、大小并限量读取；临时上传读后即删，下次上传顺手清理超 2 小时遗留临时 Blob（每次最多巡查 3,000 个）。历史图片另存原路径，文本/PDF 保留抽取结果。
- **历史图片访问与本地回退**：经 `/api/attachments/[id]/image` 校验归属后，不缓存重定向到单图 5 分钟私有 Blob 读取链（绕过 4.5 MB 响应上限）；未配 Blob 的本地开发走 `/api/uploads/local` 且直接返回图片（生产禁用二进制回退；旧 multipart 客户端兼容但受 4.5 MB 限制）。
- **Claude 图片模型副本优化**：保留原图（超 5 MiB 也可传），仅优化发给模型的副本（按需转 JPEG、降质、等比缩小，不裁剪），未编码内部预算为单张 ≤ 5 MiB、当前消息 ≤ 10 MiB、当前与历史合计 ≤ 20 MiB，历史最多恢复最近 3 张，保留上游 32 MB 保护。界面不常驻提示，超限时提醒。
- **空间超限与回收**：所有聊天图片、生图、笔记图片/文件、封面、头像合计计入配额；超限返回 `413 storage_limit` 并展示用量与登录/升级提示（设置“方案”页可见已用空间）。不再被引用的文件约一周后惰性删除（无 Cron），见 [database.md](docs/architecture/database.md#storedfile)。

### 图片存储（Vercel Blob）

- 生产环境通过 `src/lib/storage.ts`（`@vercel/blob`）写入私有 Vercel Blob，路径格式：`images/YYYY/MM/DD/<uuid>.<ext>`。
- 图片二进制不写入 PostgreSQL；数据库仅存 `imageStoragePath` 与 `StoredFile` 登记（持有者、大小、引用状态），读取时经 `/api/attachments/:id/image` 校验归属。
- 本地未配 `BLOB_READ_WRITE_TOKEN` 时回退到 `NOTEFABLE_STORAGE_DIR`；若本地 `.env.local` 配了 Blob token，文件会写入该 Blob Store，此时未引用文件清理不会运行，避免本地库误删生产文件。
- Vercel Serverless 除 `/tmp` 外只读且重启清空，因此生产必须配置 `BLOB_READ_WRITE_TOKEN`（未配时明确报错，不静默写临时盘）。

---

## 用量与边界

### API 保护与使用上限

“天”按日本时间 0 点重置；超限返回 `429`，失败且无交付内容的请求不计数。页面保存、搜索等不限次数（语义检索与建索引调用 OpenAI 嵌入的次数每人每天各 200 次，超出时搜索静默退回关键词）；更细限流可在 Vercel 防火墙/网关层配置。数值定义见 `src/lib/usage-plans.ts`，计数表见 [database.md](docs/architecture/database.md#usagecounter)。

| 身份 | 聊天（含页面 AI 助手、Create page、画成图） | 图片生成（含幻灯片 AI 生图） | 举报（`REPORT_LIMITS`，回答与 AI 内容共用） |
| --- | --- | --- | --- |
| 游客（未登录） | 20 条 / 天（另设同网络共享上限防清 Cookie 刷额度） | 10 张 / 月 且 3 张 / 天 | 10 次 / 天（未登录同网络合计 20 次 / 天） |
| 登录免费 | 40 条 / 天 | 20 张 / 月 且 5 张 / 天 | 10 次 / 天 |
| Pro 订阅 | 2,000 条 / 账期 | 60 张 / 月 且 10 张 / 天 | 10 次 / 天 |

游客超限时输入框上方显示带动效的登录提示；已登录免费用户启用订阅时显示升级提示（`UpgradePrompt`）；关闭后保留超限原因，开启“减少动态效果”时停用动画。

### 当前边界

- 面向 AI 对话与个人知识整理，支持将单篇笔记（及可选子页面）、白板、幻灯片手动发布为公开只读/放映链接；当前无团队协作或评论功能；Pro 订阅按 Stripe / Google Play 环境变量启用（见 [billing.md](docs/architecture/billing.md)）。
- 模型及第三方服务凭据由服务端环境变量统一配置，不暴露给浏览器。
- 签名设备 Cookie 仅用于隔离不同浏览器的会话和附件，不等同于登录或访问控制。
- Google / 邮箱验证码登录（Auth.js JWT 会话）用于跨设备找回数据：首次登录绑定当前设备匿名数据，已有账号登录不自动合并另一设备匿名数据；登出回到新匿名身份，账号数据仍可重新登录找回。关联规则见 [database.md](docs/architecture/database.md#user)。
- 若部署地址可能被他人获知，每日上限只能控制单人消耗；如需真正访问控制，应在 Vercel、反向代理或应用层增加认证。
- 聊天、附件和选作上下文的页面会按请求发送给对应 AI 服务；开启语义搜索（配置了 `OPENAI_API_KEY` 且未关闭）时，页面新建、保存、导入等之后还会把页面标题和正文（白板 / 幻灯片为提取出的文字）分块发给 OpenAI 嵌入接口建索引，搜索词也会在当次请求里发给它。使用时须遵守资料所属组织的数据处理规定。

---

## 部署与技术栈

### 技术栈

- **前端与全栈**：Next.js 16 App Router · React 19 · Tailwind CSS v4
- **数据与存储**：Prisma 7 · Neon PostgreSQL 18 · Private Vercel Blob
- **模型接口**：OpenAI Responses API / Images API · DeepSeek Responses API · Anthropic Messages API
- **部署与观测**：Vercel（GitHub `main` 联动自动部署）· `@vercel/analytics` · `@vercel/speed-insights`（已在 `src/app/layout.tsx` 启用）

### 线上部署概览

> 源码仓库、Vercel 项目名和域名已于 2026-11-15 核对；数据库资源信息沿用此前记录，实际运行状态以线上为准，核对方法见 [deployment.md](docs/architecture/deployment.md)。

| 项目 | 配置 |
| --- | --- |
| 源码仓库 | GitHub `kakumine2001/NoteFable`（主分支 `main`） |
| 应用托管 | Vercel 项目 `notefable` · Next.js · Node.js 24.x · Region `iad1` |
| 线上域名 | `https://notefable.com`（介绍页）· `https://app.notefable.com`（工作区）· `www.notefable.com`（跳转主域名）· `notefable-kaku10.vercel.app` |
| 数据库 | Neon project `neon_db` · Region `aws-us-east-1` · PostgreSQL 18 · Branch `production` · DB `neondb` · Schema `notefable` |

Vercel 的 `iad1` 与 Neon 的 `aws-us-east-1` 同在美国东部，网络延迟合理。

---

## 本地启动与配置

### 本地启动

使用 Node.js 24.x（与 Vercel 一致）。先准备 `.env` 和本地 PostgreSQL，再启动应用。

当前开发环境使用 Docker Desktop 中的 `notefable-pg18-dev` 容器（PostgreSQL 18.4，端口 5432）。先打开 Docker Desktop，再启动容器：

```bash
docker start notefable-pg18-dev
docker exec notefable-pg18-dev pg_isready
```

本地使用独立 `notefable` 库，生产使用 Neon `neondb` 库，两边的表都在 `notefable` schema（代码固定）。新机器需自行准备独立库和账户；上述命令仅启动已有容器。

本地 `.env` 连接示例：

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/notefable"
```

确认 `DATABASE_URL` 指向本地数据库后执行：

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

默认访问：`http://localhost:3000`

> **排查提示**：
> - 页面可打开但 `/api/sessions` 返回 `503 Database is unavailable.` 时，检查 Docker Desktop、数据库容器与连接地址（页面加载成功不代表数据库已连通）。
> - 应用优先读取 `.env.local` 同名变量，而 Prisma CLI 通过 `dotenv/config` 读 `.env`；请将 `DATABASE_URL` 统一保留在 `.env` 或进程环境中，勿在 `.env.local` 覆盖成不同数据库。

### 环境变量

#### 基础必需
```bash
DATABASE_URL="postgresql://user:password@host:5432/neondb?schema=notefable"
COOKIE_SECRET="replace-with-a-long-random-secret"
# 生产环境图片存储必需
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."
```

#### 登录认证（可选）
```bash
# Google 登录（三项齐全启用；分域后 OAuth 回调：https://app.notefable.com/api/auth/callback/google）
AUTH_SECRET="replace-with-a-long-random-secret"
AUTH_GOOGLE_ID="....apps.googleusercontent.com"
AUTH_GOOGLE_SECRET="..."

# 邮箱验证码登录及回答举报发信（生产三项齐全启用，共用 AUTH_SECRET；发件域名需在 Resend 验证）
RESEND_API_KEY="your-resend-sending-key"
EMAIL_FROM="NoteFable <login@your-verified-domain.example>"
```
非 production 环境未配发信密钥或发件人时，验证码直接打印在开发服务器日志中；详见 [deployment.md](docs/architecture/deployment.md#邮箱验证码登录可选) 与 [database.md](docs/architecture/database.md#user)。

#### AI 模型与可选覆盖
```bash
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com"
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_BASE_URL="https://api.anthropic.com"

# 可选模型与存储覆盖
OPENAI_IMAGE_MODEL="gpt-image-2.6-sunburst"
OPENAI_TEXT_MODEL="gpt-6-luna"
DEEPSEEK_FLASH_MODEL="deepseek-flash"
ANTHROPIC_HAIKU_MODEL="claude-haiku-5-5"
# 开放哪些模型（JSON 数组，格式见 docs/architecture/deployment.md）；不设置则使用全部内置模型
NOTEFABLE_MODELS='[{"id":"gpt-6-luna"},{"id":"claude-haiku-5-5"}]'
NOTEFABLE_STORAGE_DIR="data/storage"
```
内置模型定义在 `src/lib/models.ts`；服务端通过 `NOTEFABLE_MODELS` 控制开放列表、显示名和上游模型名，Web、Android 和 iOS 均从服务端读取。

#### 分域与 Pro 订阅（可选）
```bash
# 官网与工作区分域（同时设置时启用 notefable.com / app.notefable.com 分流）
NEXT_PUBLIC_SITE_ORIGIN="https://notefable.com"
NEXT_PUBLIC_APP_ORIGIN="https://app.notefable.com"

# Stripe 网页订阅（三项齐全时开放升级）
STRIPE_SECRET_KEY="sk_..."
STRIPE_PRICE_ID="price_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Google Play App 内订阅（前两项齐全时开放）
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON="{...}"
GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT="pubsub-push@..."
GOOGLE_PLAY_PUSH_AUDIENCE="https://app.notefable.com/api/billing/google/notify"
GOOGLE_PLAY_PACKAGE_NAME="com.kakumine.notefable"
GOOGLE_PLAY_PRODUCT_ID="notefable_pro"
```
完整说明见 [deployment.md](docs/architecture/deployment.md) 与 [billing.md](docs/architecture/billing.md)。

### 数据库与 Vercel 部署

```bash
npm run prisma:generate   # 生成 Prisma Client
npm run prisma:migrate    # 部署迁移（内部仅运行 prisma migrate deploy）
```

- **固定 schema**：`src/lib/database-url.ts`（`DATABASE_SCHEMA`）、`src/lib/prisma.ts` 与 `prisma.config.ts` 均固定将 `schema` 参数设为 `notefable` 并显式传给 Prisma PostgreSQL adapter。
- **TLS 与连接池**：生产连接 Neon pooled endpoint，Node 运行时将旧 `sslmode=prefer/require/verify-ca` 明确为 `verify-full` 以保持 pg 8 的证书和主机名校验；显式 `uselibpqcompat=true` 与本地非 TLS 保持不变。
- **安全边界**：生产只走 `prisma migrate deploy`（含 Neon 冷启动瞬断有限重试，不重试 SQL/认证/Schema 错误），严禁执行 `prisma db push` 或 `prisma migrate reset`。
- **同库多 schema 提醒**：同一个 Neon database 中另存有 `kaku_log` schema，NoteFable 操作务必限定在 `notefable` schema。
- **Vercel 构建**：Build Command 会先跑 `npm run prisma:migrate` 再构建应用，部署前需确保 `DATABASE_URL` 等上述环境变量已配置齐全，且 Preview 环境切勿指向生产数据库。

---

## 校验

```bash
npm run typecheck
npm run lint
npm test
npx prisma validate
```
