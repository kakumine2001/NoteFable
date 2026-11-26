# 站内页面与自动保存

Notes 是 NoteFable 内部的文字笔记模式，界面上叫 **Workspace**（简体「工作区」、日文「ワークスペース」、韩文「워크스페이스」，西 / 法 / 葡 / 意 / 越 / 俄用短译名，见 `src/lib/i18n/messages/` 的 "Workspace" 键）：顶部切换是 Chat / Workspace，首页和空状态的大标题、顶栏与分屏的占位标题都是 Workspace；侧栏里列出笔记的小标签和搜索的分类仍叫 Notes（指笔记本身）。只改了显示的文字，内部名称（`/api/pages`、`NotePage`、`?view=pages`、`/note-embed`、文件路径、AI 工具名 `search_notes` 等）都不变。切换按钮在桌面侧栏里平时各占一半，名字放不下时（日文「ワークスペース」等）那一侧按名字宽度变宽（`.notion-segmented` 的 `minmax(max-content, 1fr)`）。切换模式保留聊天输入、当前会话、正在进行的流式请求和笔记状态。选中的模式及页面 ID 写入 URL 查询参数 `view=pages&page=<id>`，刷新后可重新打开；该 URL 不提供公开分享权限。

## 页面类型（笔记 / 白板 / 幻灯片）

工作区的页面有三种类型（`NotePage.kind`，枚举 `PageKind`：`note` / `whiteboard` / `slides`，API 的 JSON 用同样的小写值；旧数据和不带 `kind` 的旧响应一律当作 `note`，见 `pageKindOf`，`src/lib/page-kinds.ts`）。类型在新建时决定，之后不能改。三种类型可以互相嵌套（笔记下面放白板、白板下面放幻灯片……），项目、子页面、收藏、排序、30 天回收站、复制、锁定、编辑历史对三种类型都一样。幻灯片的编辑器、放映、导出和公开放映见 [slides.md](slides.md)；白板的编辑器、导出和公开的只读视图见 [whiteboard.md](whiteboard.md)。侧栏的分区和各处的新建入口按类型做好（见下文“分区与新建”），由下面这张表的 `editor` 开关控制：白板和幻灯片都已打开；开关关着的类型只能通过接口（`POST /api/pages` 带 `kind`）和复制得到。

**各类型能用的功能**只在一张表里定义（`PAGE_KIND_FEATURES`：`editor`、`markdownExport`、`typography`、`publicShare`、`aiEdit`），服务端的拒绝、网页和两个原生应用的菜单都看它。网页直接读这张表；Android / iOS 读 `GET /api/pages` 返回的 `kinds`（同一张表），读到之前用安装包里的 `assets/page-kinds.json`（`scripts/gen-native-page-kinds.ts` 从表生成，iOS 经 `project.yml` 共用同一份；`src/lib/native-page-kinds-asset.test.ts` 在过期时失败），所以开关随网页部署三端一起切换，不用重新发版。`editor` 同时是“能不能新建”的开关（`creatablePageKinds`）。目前白板和幻灯片都打开了 `editor` 和 `publicShare`（其余三项是 `false`）：Markdown 导出、字体 / 小字号 / 全宽、AI 编辑案只对笔记，公开发布对三种类型都有；锁定、收藏、复制、移动、回收站、历史对所有类型。编辑器、公开视图做好后在这张表里打开。

**数据单独存放。** 笔记的正文在 `NotePage.blocks`；白板和幻灯片的 `blocks` 永远是空数组，本体放在 `NoteCanvas`（一页一行，`noteId` 主键、`ON DELETE CASCADE`），一览、搜索和普通的页面读取都不搬运本体。形状只定外框（`src/lib/canvas-document.ts`），元素内部由各编辑器决定：

- 白板：`{ elements: [{ id, type, text?, originalText?, name?, containerId?, isDeleted?, … }], files?: { <id>: { dataURL | url, … } }, appState?: {…} }`（与 Excalidraw 的 scene 同构）。
- 幻灯片：`{ format, theme: { id, mode }, slides: [{ id, layout, hidden?, notes?, section?, background?, elements: [{ id, type, … }] }] }`（元素与富文本的形状见 [slides.md](slides.md#数据)）。

保存时服务端校验（`validateCanvasData`）：JSON 对象、元素和页的 `id` 为 1–120 字符且不重复（幻灯片的元素 ID 在整套里不重复）、白板元素带 `type`、白板最多 20,000 个元素、幻灯片最多 500 页且每页 1,000 个元素、演讲备注 20,000 字符、嵌套不超过 64 层、不含 NUL 和落单的代理项（jsonb 存不进）；**不能内嵌图片**（`data:<MIME>;…` 形式的 URL 一律 400 “Images must be uploaded, not embedded in the page.”），图片先传到笔记文件（`POST /api/pages/files`），白板的 `files` 里的 `dataURL` / `url` 只能是 `/api/pages/files?key=…`；本体里出现的所有笔记文件地址都必须在本人目录下（`assertCanvasFilesOwner`，否则 400 “This page refers to a file that is not yours.”）。整份本体（JSON）最多 2 MB（`MAX_CANVAS_BYTES`，超过 413 “This page is larger than 2 MB and cannot be saved.”；请求体最多 2 MB + 64 KB，远低于 Vercel 4.5 MB 的上限；超过的请求不读完，新建（`POST /api/pages`）时按已读到的开头里最上层的 `kind`（`topLevelJsonFields`，不看本体里同名的键；`kind` 在读到的部分之后时，有 `data` 没有 `blocks` 就当白板 / 幻灯片）选提示：白板 / 幻灯片是上面这句，笔记是 “Note content exceeds 1 MiB.”）。画笔的点由编辑器在接近上限时精简（`fitStoredWhiteboard`，见 [whiteboard.md](whiteboard.md#保存)），服务端只管上限。从聊天里拿大图时压缩到 4 MiB 以内是编辑器 / AI 操作（#152、#158）的事。

**检索用的文字。** 每次保存，服务端从本体里取出文字存进 `NoteCanvas.segments`（`[{ id, text }]`，`extractCanvasSegments`）：白板是没删除的元素的文字（`originalText` 或 `text`，绑在图形上的文字算到图形的 ID 下）和框（frame）的名字；幻灯片是每一页元素里所有 `text` 字段（含富文本 JSON）加演讲备注，ID 是页的 ID。合计最多 100,000 字符。站内搜索、AI 的 `search_notes`、语义搜索的索引、附加到聊天和项目参考笔记**只用这份文字**，SQL 只读 `c."segments"`，从不遍历本体（笔迹的点）。搜索结果的 `blockId` 对白板是命中的元素、对幻灯片是命中的页：幻灯片编辑器打开那一页并高亮缩略图（`notefable:reveal-canvas-item`）；白板的编辑器把视野移到命中的元素并选中（网页和 App 的 `/note-embed?…&reveal=<id>`，见 [whiteboard.md](whiteboard.md#搜索历史公开链接)）。

**网页的编辑器与保存。** 白板 / 幻灯片的编辑器按类型登记在 `CANVAS_EDITORS`（`src/components/canvas-editors.tsx`，各自 `next/dynamic` 按需加载）：`PAGE_KIND_FEATURES[kind].editor` 为 true 且有登记时，`NotesWorkspace` 在工作区全宽渲染它（根元素加 `is-canvas-editor`，滚动交给编辑器），否则仍是只读占位画面。编辑器收到 `{ pageId, kind, title, icon, data, version, editable, embedded, split, saveStatus }`，改动经 `onChange(data)` / `onTitleChange(title)` 交回；保存与笔记共用同一个 `NoteSaveQueue`（一秒防抖、同时只有一个请求、409 冲突、404 `gone`），队列内容多一项 `data`。`useNotePages` 对白板 / 幻灯片发 `PATCH { title, icon, data?, version }`，`data` 只在与上次保存成功的本体不同时才发（只改标题不重发 2 MB），响应的 `{ version, page }` 与发出的本体合成队列里的页面（`src/lib/canvas-save.ts`）。浏览器里的草稿存在 `notefable:canvas-draft:v1:<pageId>`（`{ title, icon, data, version }`，恢复前用 `validateCanvasData` 检查，不合格就丢弃；旧编辑器的 `notefable:page-draft:v1:` 草稿照旧丢弃），移入 Trash 时一起删除。冲突时的“载入最新版”、聊天 / 应用推来的 `page-updated` 不带本体时都先 `GET` 再换掉编辑器（`editorEpoch`），不把新版本号和旧本体拼在一起；“另存为新页面”按原类型 `POST { kind, title, icon, data }`。打开着的白板 / 幻灯片在侧栏改图标也走自动保存（与笔记相同）。**新建入口**（侧栏的“新建”、项目和页面行的“+”、分区的“+”、首页和空状态的新建按钮）见下文“分区与新建”：都按 `editor` 为 true 的类型出现，所以某个类型的编辑器上线时只需在表里打开 `editor`。

**保存只回传版本号。** `PATCH /api/pages/:id` 对白板 / 幻灯片收 `{ title, icon?, data?, version }`，成功返回 `{ version, page }`（`page` 是一览的摘要，不含本体）；省略 `data` 只改标题和图标。版本冲突返回 409 `{ error, page, version }`（同样不带本体，最新内容用 `GET` 读；其他返回整页的接口——`GET`、改图标 `PUT /api/pages/:id/icon`、历史恢复及其 409——对白板 / 幻灯片都带 `data`，先读版本后读本体，网页收到不带 `data` 的页面时重新读取，不把新版本和旧本体拼在一起）；响应丢失后的重发用 `NoteCanvas.hash`（本体 JSON 的 SHA-256）判断内容是否已保存，不必读回本体。不带 `data` 的保存（只改标题 / 图标）版本不一致时一律 409（分不清期间本体是否被别的标签页改过）。旧的笔记编辑器把笔记正文（`blocks`）送到白板 / 幻灯片时不写入，返回 400 “This page can't be edited in this version of NoteFable.”。

**历史少留。** 白板和幻灯片的历史本体存在 `NoteRevision.data`（`blocks` 为空数组），每页只留自动保存 5 份 + AI 编辑 / 恢复前 5 份（共 10 份，笔记是 30 + 20），自动快照最短间隔 30 分钟（笔记 10 分钟），见 `revisionLimits`。自动快照照样是 DB 内的 `INSERT … SELECT`（`LEFT JOIN NoteCanvas`），本体不进应用；空白板（没有元素）/ 空幻灯片（没有页）不留快照。

**在各处按类型处理。**

- **列表与图标**：一览、最近编辑、回收站、搜索结果、附加页面、项目参考笔记、发言下的页面标签都带 `kind`；页面没有自己的图标时显示类型图标（笔记 FileText、白板 Shapes、幻灯片 Presentation，`PageKindIcon`）。搜索结果里白板 / 幻灯片在标题旁标出类型名。
- **打开**：网页的 Notes 视图、分屏和 `/note-embed` 对白板打开白板编辑器（[whiteboard.md](whiteboard.md)），对幻灯片打开幻灯片编辑器；还没有编辑器的类型显示只读的占位画面（`CanvasPagePlaceholder`：图标、标题、“编辑功能即将推出”和本体里的文字，幻灯片带页码），不加载 BlockNote、不自动保存。两者都挂页面的 AI 面板（见“页面里的 AI 助手”，在 AI 能改这种页面之前只能问）；“…”菜单只留锁定、收藏、复制、新建子页面、移动和移入回收站（笔记在网页和 App 里另有 **Present** 一键放映，见 [slides.md](slides.md#放映)；幻灯片在 App 里另有放映和导出），顶栏的“分享”只对能公开的类型（现在三种都能）显示。提及（`@`）和页面链接照常在原地打开，打开后按类型显示。
- **历史**：预览按类型显示（白板画出那一版的图并列出文字，幻灯片列出那一版的文字），恢复按类型写回（`NoteCanvas` 和标题、图标，先把当前状态存成 `RESTORE` 历史），响应的 `page` 带本体。
- **复制**：类型照抄，本体在数据库里 `INSERT … SELECT` 复制（不读进应用），事务超时 30 秒；一次复制的白板 / 幻灯片本体合计最多 32 MB（超过 413 “These pages are too large to duplicate at once.”）。
- **公开分享**：白板可以像笔记一样发布，公开页是可缩放、平移的只读画布，图片只放行白板里还活着的图片元素引用的文件（[whiteboard.md](whiteboard.md#搜索历史公开链接)）。没有公开视图的类型（现在没有）不出现在分享树里，它们下面的子页面也不出现（和“从上级分享排除”一样处理），它们自己也不能发布（`PUT /api/pages/:id/share` 的 `enabled: true` 返回 400）。幻灯片可以发布，公开页面是只读的放映视图；幻灯片是分享树的叶子：它下面的子页面不公开（分享对话框不显示“包含子页面”），隐藏页、演讲者备注和 AI 图片的说明不公开（[slides.md](slides.md#公开放映链接)）。
- **附加到聊天、项目参考笔记**：白板 / 幻灯片发送取出的文字（白板每段一行 `- 文字`，幻灯片 `Slide n: 文字`），规则与笔记相同（每次发送实时读取、单篇 8,000 / 合计 20,000 字符），分隔行上标 `[whiteboard]` / `[slide deck]`。
- **导入导出**：Markdown 导入只建笔记，导出只对笔记（白板 / 幻灯片返回 400），它们自己的导出由各编辑器提供（幻灯片：PDF、带备注的 PDF、PNG、PPTX，[slides.md](slides.md#导出)；白板：PNG、SVG、PDF，[whiteboard.md](whiteboard.md#导入-pdf-与导出)）。
- **AI 工具**：都走 AI 操控底座（[chat-flow.md](chat-flow.md#ai-操控底座框架--各类型适配器158)），每种类型一个适配器。`search_notes` / `list_pages` 列出全部类型，结果带 `kind`；`read_note` 对白板 / 幻灯片从 `NoteCanvas.data` 做结构化只读输出（白板输出框、元素 ID / 类型 / 合并后的绑定文字 / 分组 / 页面卡片链接与箭头连线关系；幻灯片输出主题、章节、每页稳定 `slide.id` / 版式 / 隐藏标记、元素 ID / 角色 / 富文本（含公式 TeX 与代码块）/ 表格 / 图片说明 / 白板框占位与演讲备注；缺损时回退 `segments`，超过 20,000 字符按框 / 元素或按页边界截断并写明省略数量）；白板 / 幻灯片的适配器现在只读，修改工具、直接新建和预览在后续 PR 加上；`propose_note_edit` 和应用编辑案只认笔记（工具错误 / 409 “This page is a whiteboard, not a note.”）。白板 / 幻灯片页面上也有 AI 面板（见“页面里的 AI 助手”），选中的元素 / 幻灯片作为上下文（视觉模型同时附带长边 ≤ 1568 px 的选区 PNG）。`buildInstructions()` 按各类型适配器能做的事说明哪些页面能改（[chat-flow.md](chat-flow.md#notes-工具三家模型共用)）。

**旧版应用。** 应用里的编辑页始终是 `/note-embed?page=<id>`（旧版应用会把新的路径交给系统浏览器，所以不换路径），网页按类型渲染，桥接全部照旧（`ready` 多带 `page.kind`）。旧版应用的“…”菜单对所有类型都显示笔记专用的操作；服务端拒绝这些操作（Markdown 导出、字体 / 小字号 / 全宽、发布、笔记正文的保存），返回 400 `{ error, code: "wrong_page_kind", kind }`，其中 `error` **已经按请求的语言译好**（`notefable-locale` Cookie → `Accept-Language` → 地区 → 英文，与 `/api/i18n` 相同，`src/lib/page-kind-errors.ts`），因为旧版应用的词典里没有这些句子。新版网页和应用直接显示这个句子。

## 编辑器与数据

Notes、聊天与头像共用 `emoji-picker-react` 的完整 Unicode 表情选择器，打开时才加载，支持英文搜索、分类、最近使用和肤色。表情以单个 Unicode 字素保存，包含旗帜、键帽和组合表情；原生显示受设备字体支持范围限制。头像照片与封面的现有上传流程保留，不提供独立的图标素材库。

**页面图标也可以是上传的图片**（仿 Notion 的 Emoji / Upload 两个标签页）：页面标题上方和侧栏行首的图标选择器（`EmojiPopover` / `FloatingEmojiPopover` 传 `allowUpload`）多一个“上传”标签页，选的图片经封面同一个接口 `POST /api/pages/covers`（JPEG/PNG/WebP/GIF、按文件头判断、最大 4 MiB）保存，`icon` 存同样形式的键 `upload:page-covers/<用户ID>/<uuid>.<ext>`。`validateNoteContent` 接受“单个 emoji 或这种键”；新建、自动保存（PATCH 带 `icon`）、`PUT /api/pages/:id/icon`、复制和历史恢复都像封面一样先 `assertCoverOwner`（只能用自己目录下的键）再在事务里 `claimCover`（把 `StoredFile` 的行设为使用中）。显示统一走 `NoteIcon`（`src/components/note-icon.tsx`）：emoji 原样，图片是 `/api/pages/covers?key=` 的 `<img>`（1em 四方、圆角 3）；公开分享页走 `/s/:token/cover?page=<id>&kind=icon`（只返回该公开页面自己的图标图片）。只能放文字的地方（AI 新建提案的标题前缀等）用 `noteIconText`，图片图标不显示。AI 的 `propose_note_create` 只接受 emoji 图标。聊天会话图标和 Callout 的 emoji 不变，仍只能是 emoji。

`src/components/note-editor.tsx` 用同版本的 `@blocknote/core`、`@blocknote/react` 和 `@blocknote/ariakit` 社区包构建编辑器，通过 `next/dynamic` 禁用 SSR，在打开页面时加载。显式 schema 包含段落、H1–H3（可设为折叠标题，`isToggleable`）、项目/编号/待办列表、折叠列表（`toggleListItem`）、引用、Callout（`callout`，自定义块，见下）、代码、分隔线、页内目录（`tableOfContents`，自定义块，见下）、表格（`table`）、数学公式块（`mathBlock`）以及行内数学公式节点（`mathInline`）；代码块使用 `@blocknote/code-block` 的 Shiki 高亮和语言选择，未知或空语言（包括旧数据）在载入和编辑时统一为 Plain Text；另有上传的图片块和文件块（斜杠菜单 Media 分组里的 Image / File，粘贴或拖入图片也会生成图片块）；不开放视频/音频块、外部链接嵌入或子页面。

### 仿 Notion 的块与操作

- **折叠。** 折叠列表和折叠标题用 BlockNote 自带的实现：子块缩进在其下，点三角展开/收起；展开状态只存在本机（BlockNote 用 localStorage 记），不进文档 JSON。
- **Callout。** `src/components/note-callout.tsx`：props 为 `emoji`（单个 emoji，默认 💡）、`backgroundColor`（默认 `gray`）和 `textColor`，正文是行内内容。点 emoji 打开与页面图标相同的表情选择器；背景色用手柄菜单的 Color 修改，选 Default 时只剩边框。
- **页内目录（TOC）与右侧悬浮大纲。** `src/components/note-toc.tsx`（`tableOfContents` 块，斜杠菜单 `/table of contents` / `/toc` / `/目录`，`content: "none"`，`props` 只允许可选 `textColor` / `backgroundColor`）：从编辑器的文档实时提取正文 H1–H3 标题（`extractTocHeadings`，`src/lib/note-toc.ts`，包含折叠块与分栏内的标题、跳过空标题），点击某一条标题调用 `revealNoteBlock` 展开外层折叠并滚动聚焦（见 #189）。Markdown（`note-markdown.ts`）以单独一行的 `[TOC]` 往返（字面段落里的 `[TOC]` 转义为 `\[TOC\]`）；导出到幻灯片（`note-to-deck.ts`）时跳过目录块。公开分享页（`public-note-view.tsx`）在各标题渲染 `id="heading-<blockId>"`，并将 `tableOfContents` 渲染成可点击的锚点目录（无标题时隐藏）。此外，`NotesWorkspace`（非分屏、非 `/note-embed` 的笔记编辑视图）在桌面宽屏右侧挂载 `NoteFloatingToc`（`src/components/note-floating-toc.tsx`），平时显示跟随滚动高亮的细线刻度栏，悬停/聚焦展开标题跳转浮层（窄屏 `<1240px` 或全幅 `<1480px` 时自动隐藏）。
- **数学公式（KaTeX）。** `src/components/note-math.tsx`：块级公式 `mathBlock`（`content: "none"`，`props` 为 `latex`、`textColor`、`backgroundColor`）与行内公式 `mathInline`（`content: "none"`，`props` 为 `latex`），单个公式源最长 10,000 字符（`MAX_MATH_LATEX`，不允许 NUL 字节）。KaTeX 与样式仅在笔记实际含公式时动态加载（`trust: false`、`strict: false`）。插入入口：斜杠菜单 `/equation`（`$$`）与 `/inline equation`（`$`）、行首 `$$ ` 输入规则、选中文字的格式工具栏 `√x` 按钮及 `Ctrl/⌘+Shift+E` 快捷键。点击公式打开挂在 `document.body` 的浮动编辑浮层（随 `visualViewport` 夹紧并支持移动端返回键关闭），输入时通过 `editor.updateBlock` / `tr.setNodeMarkup` 原地实时预览，语法错误在浮层底部提示、正文按 `throwOnError: false` 兜底显示；RTL 环境下公式与 TeX 输入固定 `dir="ltr"`，超长块级公式在自身内部横向滚动。渲染设置（`renderKatex`）在 `src/lib/katex-render.ts`，编辑器与公开分享页共用。公开分享页（`/s/:token`）在服务器端渲染公式：页面含非空公式时（`blocksHaveMath`）才在服务器加载 KaTeX 并输出 HTML，浏览器不下载 KaTeX 的 JS；KaTeX 样式与字体经 `next/dynamic`（`src/components/public-note-math-styles.tsx`）只在这样的页面作为 `<head>` 里的样式表加载，没有公式的页面不加载。外观沿用编辑器的 `.notes-math-block` / `.notes-math-inline`，RTL 页面里同样固定从左到右；空公式不显示，无法渲染的公式显示 TeX 原文。
- **表格。** BlockNote 的 `table`：`content` 是 `tableContent`（`rows[].cells[]`，单元格带颜色、对齐和合并）。编辑器以 `tables: { headers, splitCells, cellBackgroundColor, cellTextColor }` 全部开启：手柄菜单里有 Header row / Header column，行列手柄可以增删行列和给单元格上色，选中多个单元格时工具栏出现合并按钮。`headerRows` / `headerCols` 是“整行/整列都是表头”的数量，可能大于 1（例如粘贴带两行表头的表）。行列数不设上限，大小只受整篇笔记 1 MiB 的限制（约几千个单元格，超过时保存返回 413 `Note content exceeds 1 MiB.`）；表格没有子块。未设置的列宽在编辑器里是 `undefined`、存进 JSON 后是 `null`，`notes-workspace.tsx` 的 `sameJson` 把两者视为相同，避免把没改过的表格当成编辑。
- **输入规则与快捷键**与 Notion 一致：行首 `> ` 生成折叠列表，`" ` 或 `| ` 生成引用（BlockNote 默认的 `> ` 引用被替换）；`Ctrl+Shift+0–8`（macOS 是 `⌘+⌥+0–8`）转换块类型（7 是折叠列表），`Ctrl/⌘+Shift+↑/↓` 上下移动块，`Ctrl/⌘+D` 复制块。把 Callout 转成其他类型时去掉它默认的灰色背景，反过来把没有背景色的块转成 Callout 时补上灰色。
- **仿 Notion 鼠标划区多块选择、整块操作与 AI 联动（`src/components/note-block-selection-ui.tsx`、`src/lib/note-block-selection.ts`）**：
  - **鼠标/触控笔拉框选择**：在桌面/指针设备上（仅限左键且非触屏 `pointerType !== "touch"`，保留移动端与触控板触摸滚动），从页面左右留白、块间距或底部空白区按下并拖动即可拉出蓝色选区框（`.notes-marquee-box`），实时与各块内容框求交、靠近视口上下缘时自动平滑滚动，松手后将选中的根块（嵌套父子自动归一到父块，列容器 `columnList`/`column` 自动穿透到内部块）以蓝色柔和遮罩高亮（`[data-block-selected="true"]`）；在空白处再次点击或单点某已选块的正文即退出块选并在点击处落入光标。支持 `Shift+Click` 连选、`Ctrl/⌘+Click` 反选、编辑器内按 `Esc` 选中当前光标所在块。
  - **多块移动与操作**：按住任意已选块正文或左侧 `⋮⋮` 手柄拖动即可用统一的多块指针拖拽（带计数幽灵卡片 `.notes-block-drag-ghost` 与蓝色落点线 `.notes-drop-indicator`）把所选块整组拖到其他块前后重排，或拖到目标块左右边缘直接创建/插入分栏（复用 `note-columns.ts` 的 `findColumnSideTarget` 与 `moveBlocksBeside`）；在单次 `transact()` 中先插后删，支持 `Ctrl/⌘+Z` 撤销。选区上方自动出现浮动操作栏（`.notes-block-bar`：**Ask NoteFable**、块数、**Turn into**、**Color**、**Duplicate**、**Delete**，锁定页提供复制）；左侧 `⋮⋮` 菜单（`BlockMenu`）同步升级支持多块转换、多块上色、复制、删除及顶部的 **Ask NoteFable**。选中状态下支持 `Shift+↑/↓` 扩缩选区、`Del/Backspace` 删除、`Ctrl/⌘+D` 复制、`Ctrl/⌘+C/X/V` 块级剪贴板（保留富文本块结构）、`Ctrl/⌘+Shift+↑/↓` 同层上下移动、`Tab/Shift+Tab` 缩进/取消缩进、`Ctrl/⌘+Shift+0–8`（macOS `⌘+⌥+0–8`）批量转换、`Ctrl/⌘+A` 全选及 `Esc` 退出。
  - **实时同步 AI 上下文与吉祥物气泡**：确认块选后（不打断普通文本选区），通过 `onSelectionChange` 自动把所选块的 Markdown 摘录与根块 ID 同步进 `NotesWorkspace` 的 `selection` 状态（分屏模式下不主动弹出浮窗，通过浮动栏或 `⋮⋮` 菜单的 **Ask NoteFable** 传入左侧聊天输入栏）。`/note-embed` 复用同一编辑器和气泡，但移动端纯触控不触发划区。
- **分栏（段组み）。** 和 Notion 的 Columns 一样把块左右并排。块 JSON 是 `columnList`（`props` 为空、没有 `content`，`children` 是 2–12 个 `column`）→ `column`（`props.width` 是与兄弟栏的宽度比 0.05–20，即 `flex-grow`；`children` 是至少 1 个普通块，不能直接放 `columnList`）。`column` 只能出现在 `columnList` 里，`validateNoteContent` 按此检查。编辑器侧（`src/components/note-columns.ts`）自己定义这两个 ProseMirror 节点：BlockNote core（MPL）已内置按 `columnList` / `column` 名字处理的逻辑（移动、删除后自动收起空栏），我们没有用官方的 `@blocknote/xl-multi-column`（GPL 或付费）。做法：拖动块到另一个块的左右边缘（左边缘内侧 8–96px、右边缘 96px 内）出现竖线，松开即分栏；拖到栏里某块的左右会在那一栏旁边加一栏（最多 5 栏，栏里不能再分栏，嵌套子块上则以最上层或栏里的祖先块为准）；斜杠菜单的 “2 / 3 / 4 columns”（栏里不显示）。普通的上下拖动把栏里最后一块拖出去时，只收起被拖出的那组空栏（`/2 columns` 刚建的空栏不动）。栏的分界线左右 6px 内可以拖动调宽（每栏至少 48px，松手时一次写入，可撤销）。窄屏（≤640px，手机和 App 内嵌）上栏竖着排，不能调宽。Markdown（AI 的 `read_note` 编号、导出、历史预览）不表达分栏：按左栏到右栏的顺序把栏里的块当作同一层的块写出，`columnList` / `column` 本身不编号；AI 编辑把某栏的块删光后由 `normalizeColumns` 收起空栏（`src/lib/note-columns.ts`）。公开分享页按宽度比并排显示，窄屏竖排。
- **「@」提及。** 正文里打 `@` 弹出菜单（`src/components/note-editor.tsx` 的 `MentionMenu`）：上面是自己的页面（按标题筛选，最多 8 个，不含当前页面），下面是日期（今天 / 明天 / 昨天；输入 `YYYY-MM-DD` 时多一个那一天）。插入的是行内内容 `mention`（`src/components/note-mention.tsx`，props `kind`（`page` / `date`）、`pageId`、`title`、`date`，没用的项是空字符串）。页面提及显示这一页**当前**的标题和图标（来自页面列表；`/note-embed` 没有列表，第一次打 `@` 或打开含页面提及的笔记时自己读 `GET /api/pages`），列表里没有（回收站、已删除）时显示插入时记下的 `title`，变淡加删除线、不能点。点页面提及在原地打开那一页（网页走 `NotesWorkspace` 的 `onOpen`，内嵌页向 App 发 `openPage`）；正文里指向 `?view=pages&page=<id>` 的普通链接（同源）也在原地打开，按 Ctrl/⌘/Shift 点击时照常新开。日期提及按界面语言显示（`Intl.DateTimeFormat`），点一下用系统的日期选择器改。保存时 `validateNoteContent` 用 `validMention`（`src/lib/note-mention.ts`）检查：`pageId` 是 1–64 位 `[A-Za-z0-9_-]`，`title` 最多 200 字符，`date` 是真实存在的日期；提及不能放在链接里。不检查 `pageId` 是否属于本人（显示时只从本人的列表取标题）。打到一半的日期（如 `2026-1`）期间菜单保留日期候选，不会因为没有候选而关掉。站内搜索和 AI 的 `search_notes` 把提及的文字（插入时的标题、日期，以及被提及页面**现在**的标题，只取本人未删除的页面）算进正文（`noteBodyValues`，`src/lib/search.ts`；`inlineText` 同样输出提及文字）。导出 Markdown 时提及写成纯文字 `@标题`。`/note-embed` 只在 App 声明 `window.NoteFableNative.canOpenPage()` 时才拦截页面链接、发 `openPage`，并只在这时让 `@` 菜单列出页面；旧版 App 里页面链接照旧用新窗口打开，日期提及不受影响。
- **斜杠命令。** 除了插入块和 `/turn…` 转换，输入文字后还会匹配作用于当前块的命令：文字颜色（`/red`）、背景色（`/blue background`）、`/duplicate`、`/delete`。这些只在输入了查询时出现，空菜单不列出。

AI 工具读写这些块时用的 Markdown（`src/lib/note-markdown.ts`）：页面提及是 `[@标题](page:<id>)`，日期提及是 `[@YYYY-MM-DD](date:YYYY-MM-DD)`（读回时还原成提及；其他协议的链接照旧只接受 http/https/mailto/tel）；折叠列表是 `▸ 文字`，折叠标题是 `# ▸ 文字`，子块缩进两格；Callout 是 `> [!💡] 文字`；块级公式是 `$$` 单独成行包裹的 LaTeX（解析时也接受单行 `$$…$$` 与 ```` ```math ```` 代码围栏），行内公式是 `$…$`（含 `$` 或以 `\` 结尾时用 `$$…$$`），普通文本里的字面 `$` 写成 `\$` 以保证往返不误判；表格是 GFM 表格，整张表算一个块（`read_note` 只给表格一个编号，第一行当表头）。表格里单元格的颜色、对齐、合并无法用 Markdown 表达，AI 替换这样的表格时提案会带 `dropsFormatting` 警告；表头行/列的设置和列宽（列数不变时）在“表格替换成一张表格”时从原表继承（`carryTableLayout`，`src/lib/page-edit.ts`）。单元格里的 `|` 写成 `\|`，行的切分（`splitTableRow`）不在代码片段和行内公式里切，也不被转义的反引号打断；正文里其他位置的 `\|` 保持原样。从 Markdown 生成表格时，每行会补空单元格到最大列数；补完超过 20,000 个单元格（`MAX_PARSED_TABLE_CELLS`）的不当作表格、按普通行读入，防止很短的输入膨胀成巨大的表。不带编号的输出里，相邻的两张表之间空一行，否则读回来会并成一张；编辑历史的预览（`previewMarkdown`）保持表格各行与 `$$` 公式块各行相连。搜索命中折叠块里的内容时，`revealNoteBlock` 先点开外层的折叠再滚动高亮。聊天回答 “Save to page” 时，回答里的 GFM 表格会保存成表格块，块级与行内公式会保存成 `mathBlock` / `mathInline`。站内搜索会搜到表格单元格里的文字与公式的 TeX 源码。

## 图片与文件

笔记附件和封面的单文件上限均为 4 MiB（4,194,304 字节，`src/lib/usage-plans.ts` 的 `MAX_STORED_FILE_BYTES`）；界面和接口错误文案沿用 “4 MB” 标签。以下容量按实际字节上限描述。

**存储上限。** 笔记文件、封面和图片图标都计入用户的文件存储用量（与聊天图片、生成的图片、头像合计；游客 100 MB、登录免费 500 MB、Pro 10 GB，数值在 `usage-plans.ts` 的 `STORAGE_LIMITS`，规则见 [database.md](database.md#storedfile)）。`POST /api/pages/files` / `POST /api/pages/covers` 放不下时返回 413 `{ error, code: "storage_limit", tier, used, limit }`，什么都不写。网页的上传入口收到它时都派发 `notefable:storage-limit`（`src/lib/storage-limit-client.ts`）：从上传面板（`/image`、`/file`、替换）、封面和图片图标选的文件在原处显示服务端的说明；粘贴、拖入时新建的空块直接删掉（不留“Loading...”），原因只由下面的提示说明。`NotesWorkspace` 在笔记上方显示 `StorageLimitPrompt`（吸附在滚动区域顶端，长笔记下方粘贴时也看得见）：用量、游客的登录按钮、免费用户的 Pro 升级按钮（启用 Stripe 时）和“删除不需要的文件”。`/note-embed` 里不显示按钮：App 声明了 `canShowStorageLimit()` 时把 `storageLimit` 消息交给 App 用原生提示显示，旧版 App 只在编辑器里显示原因。笔记 AI 面板的附件同样处理。已有的文件不受影响。

图片块和文件块的 `props.url` 只能是 `/api/pages/files?key=…&name=…`（`parseNoteFileUrl`，`src/lib/note-file-keys.ts`），不接受任意外部 URL；上传前的空块 `url` 为空字符串。所以新建和替换（选中图片 / 文件时格式工具栏的“替换图片 / 替换文件”，`NoteFileReplaceButton`）都只打开上传面板 `NoteFilePanel`，不出现 BlockNote 默认面板的 Embed（外部链接）标签；图片块面板内与斜杠菜单（`/generate image`）另外提供“用 AI 生成”入口，打开共享的 `WorkspaceImageDialog`（`POST /api/pages/images`），生成后先预览再插入或替换图片块。从别的网页拖进来或贴进来的内容里，指向外部 URL 的图片块 / 文件块会被去掉（`src/components/note-external-files.ts`，ProseMirror 的 `transformPasted`，对贴入和拖放都生效；自己的文件和等待上传的空块照常通过，拖动移动图片块不受影响），否则笔记会因为无效的块而保存失败；只含 HTML 图片的贴入仍由 `pasteHandler` 改为纯文本。文件保存在 `note-files/<用户ID>/<uuid>.<扩展名>`，与封面、聊天图片共用 `src/lib/storage.ts`。保存页面时 `assertNoteFilesOwner` 检查所有被引用的键都在当前用户目录下，否则返回 400。

`POST /api/pages/files` 只收一个 `file` 字段，最大 4 MiB（Vercel 请求体上限 4.5 MB），按实际接收字节数限制。图片按文件头判断（JPEG/PNG/WebP/GIF）；其他文件按扩展名白名单（pdf、txt、md、csv、json、doc/docx、xls/xlsx、ppt/pptx、zip、mp3、wav、mp4），可执行文件、HTML 等被拒绝（400）。`GET /api/pages/files?key=&name=` 只返回当前用户自己的文件：图片内联显示，其他类型以 `attachment` 下载，并带 `nosniff` 和 `Content-Security-Policy: sandbox`。

AI 工具看到上传内容时是 `[Image: 名称 — 说明]` / `[File: 名称]` 占位文字。`propose_note_edit` 可以像其他块一样替换或删除这些块；替换或删除到上传内容时，提案里该处会带 `dropsMedia`，提案卡片提示“上传的图片或文件会从笔记中移除”，用户批准后才会生效。AI 也可以把当前聊天里的图片放进笔记（含用户上传和助手生成的图片）：先用 `list_chat_attachments` 取得附件 ID，再在提案的 Markdown 中单独写一行 `![说明](attachment:ID)`。服务端（`src/lib/note-attachments.ts`）确认该附件属于本会话和本人（不按消息角色排除生成图）、是 PNG/JPEG/WebP/GIF 且不超过 4 MiB，把图片复制到 `note-files/<用户>/`，替换成指向它的图片块；每个提案最多 5 张，同一张只复制一次。聊天里的 PDF / 文本附件只保存了抽出的文字，没有原文件，所以不能作为文件块放进笔记。模型直接写 `![说明](/api/pages/files?...)` 时只接受本人目录下的图片，生成提案和适用提案时都会检查（`assertNoteFilesOwner`）。复制进笔记的图片也计入存储用量，放不下时工具向模型返回错误、不建立提案。

**未引用文件的清理。** 每个上传的文件都登记在 `StoredFile`（[database.md](database.md#storedfile)）。保存笔记（自动保存、新建、导入、复制、历史恢复、适用 AI 提案）时在同一事务里把正文引用的文件设为使用中（`claimNoteFiles`）；白板 / 幻灯片的图片也在 `note-files/`，保存、新建、历史恢复时用 `claimStoredFiles`（路径由 `validateCanvasData` 收集），复制时用 `claimCanvasFiles`（在数据库里从本体取出）。不再被任何页面（含 Trash；笔记读 `blocks`，白板 / 幻灯片读 `NoteCanvas.data`）、编辑历史（`NoteRevision.blocks` / `data`）和待确认的 AI 提案引用的文件，7 天后由文件清理任务删除（`collectUnusedFiles`，请求之后惰性运行，没有 Cron）。所以从笔记里删掉的图片要等它也不在编辑历史里（历史被裁剪或笔记被永久删除）之后约一周才真正删掉、释放空间。

## 分组

笔记可以放进单层的分组（文件夹），界面统一称为 Projects（项目内的层级用子页面，见“子页面、收藏与页面设置”）。`NoteGroup` 属于当前用户（匿名设备或已登录账号）（最多 50 个，名称最长 60 字符），`NotePage.groupId` 可空，删除项目时其中的笔记保留并回到“无项目”（`SetNull`）。移动笔记只改 `groupId`，不增加内容 `version`，所以不会和自动保存冲突。侧栏顺序：新建 → Home → Search → Favorites（有收藏时）→ Projects → 分区（笔记 / 幻灯片 / 白板，见下面“分区与新建”；底部另有 Import Markdown 和 Trash）；每个项目和每个分区都可折叠，折叠状态存在本机 localStorage。拖动笔记行可把笔记拖到项目标题（空项目或折叠项目也支持），成功后自动展开；拖到自己类型的分区标题可移出项目。手机端 Notes 列表的项目标题和分区 / No project 标题也接受拖放，每行保留移动按钮，底部提供新建按钮、New project 和 Import Markdown。笔记项目与聊天项目仍独立存储。项目里可以放三种类型的页面。

### 分区与新建（#168）

工作区的侧栏和首页按类型分区，规则在 `src/lib/workspace-sections.ts`（`workspaceSections`、`sectionKindOf`、`canDropIn`），Android（`NotesUiState.sections`）和 iOS（`NotesUiState.sections`、`noteDropRules`）照同一套规则。

- **能新建的类型**：`creatablePageKinds()` = `PAGE_KIND_FEATURES` 里 `editor` 为 true 的类型，按笔记、幻灯片、白板的顺序（`PAGE_KIND_ORDER`），笔记总在。下面所有“按类型出现”的东西都只看它：开关关着的类型的分区、新建选项、首页按钮和检索筛选完全不出现。
- **新建**：侧栏最上面的按钮在只能建笔记时是 “New note”，一点就建（和以前一样）；能建两种以上时是 “New”，点了打开类型菜单（笔记 / 幻灯片 / 白板，带类型图标；`NewPageButton`）。项目行和页面行的 “+” 同样：一种时直接建，两种以上时先选类型；项目的 “+” 建在该项目的最上层（`POST /api/pages` 带 `groupId`），页面行的 “+” 建子页面。分区标题的 “+” 直接建这个类型（幻灯片分区例外：打开 New slide deck / Generate with AI 菜单）。能建幻灯片的新建菜单末尾和首页新建卡片下面还有 “Generate with AI”（[AI 生成幻灯片](slides.md#ai-生成幻灯片)）。新建到折叠着的项目或分区时先把它展开。页面 “…” 菜单的 “Add a page inside” 和分屏里的 “New note” 仍只建笔记。
- **分区**：Projects 下面是笔记、幻灯片、白板三个分区（只出能新建的类型），每个分区列出不在项目里的最上层页面（项目被删后残留的 `groupId` 也算不在项目里）；标题是 Projects 同款的等宽小字，后面是折叠箭头，点标题折叠，状态存在 `notefable:workspace-sections-collapsed:v1`（类型 → true；Android `NotesPrefs.collapsedSections`、iOS `notes.collapsedSections`）。项目里三种类型按原来的顺序混排，每行前面是页面图标，没有图标时是类型图标。子页面不论类型都跟着父页面显示，不在自己类型的分区里出现。还不能新建的类型（开关关着）的页面放在笔记分区里，不会看不到。
- **拖动**：分区标题和分区里最上层的行带 `data-drop-kind`，被拖的行带 `data-page-kind`（它会进的分区，`sectionKindOf`），`ReorderRowButton` 只把同一分区的页面当作可放的目标（`canDropIn`）：可以在同一分区里排序、拖到自己类型的分区标题上移出项目；拖到别的类型的分区（标题或其中的行）上什么都不发生，因为类型不能改。项目标题、项目里的行和子页面的行接受所有类型（拖进项目、在项目里排序、成为子页面的兄弟）。拖出项目的页面回到自己类型的分区（分区折叠着就展开）。键盘的 Alt+↑/↓ 在分区里也只在同一分区内移动。
- **首页**：只能建笔记时和以前一样（有项目才显示 “No project” 小标题）；能建两种以上时，不在项目里的页面按分区显示小标题（名字和含子页面的数量，只显示有页面的分区），桌面宽度的列表标题从 “All notes” 换成 “All pages”。最近编辑的卡片在桌面和手机视口都展示（最多 8 篇），优先展示页面封面（预设渐变/纯色或带纵向焦点位置 `coverPosition` 的上传封面）并附页面类型图标，与聊天空状态 `ChatRecentNotes` 卡片的封面条保持一致。底部和空状态的新建按钮（`NewPageButtons`）只能建笔记时是原来的 “New note”，能建两种以上时每种一个（类型图标 + “New note / New slide deck / New whiteboard”，第一个是深色按钮）。
- **检索**：Notes 标签页在能新建两种以上的类型时多一个类型筛选（“Page type”：All types / 各分区名），选了就带 `kind` 参数（见 [chat-flow.md](chat-flow.md#跨-chats--notes-搜索)）。
- 白板（#152）、幻灯片（#149）的编辑器上线时只需在 `PAGE_KIND_FEATURES` 里打开 `editor`，并运行 `npx tsx scripts/gen-native-page-kinds.ts`，三端的分区、菜单和筛选随之出现。

代码块的外观仿 Notion：浅米色底、圆角 10px、左 32px / 右 16px / 上下 32px 的内边距，长行自动折行。语言选择和复制按钮平时隐藏，鼠标移到代码块上（或键盘聚焦）时才在右上角出现，复制后图标变成对勾。BlockNote 自带的 CSS 在 `globals.css` 之后加载且选择器权重相同，所以覆盖它的选择器必须带上 `.bn-block-content`（例如 `.notes-block-editor .bn-block-content[data-content-type="codeBlock"] > pre`），否则会被静默覆盖。

数据库保存 `editor.document` 原生 JSON，标题、页面图标和封面单独保存；旧草稿或旧客户端缺少 `icon`/`cover` 时按 null 处理。`src/lib/note-document.ts` 校验区块类型、稳定 ID、文字样式、链接协议、区块数量与深度，拒绝不支持的区块和脚本链接。请求流读取上限为 1 MiB，不仅依赖 Content-Length。标题最长 200 字符，正文最多 2,000 个块、8 层嵌套。

`src/lib/note-block-actions.ts` 维护现有文字区块的转换名称与快捷键、复制 ID 规则和代码转换的文字提取。手柄、斜杠菜单和快捷键使用同一份转换定义。复制时递归生成新 ID；转成代码时保留链接显示文字并移除链接和装饰，保持服务器校验兼容。页面列表按可拖动保存的 `position` 顺序排列（同序时按创建时间倒序），修改正文不会改变顺序，标题立即更新；切换页面和模式写入浏览器历史，后退/前进恢复对应页面。

**页面切换与预加载（#176）。** `useNotePages` 把已打开过的页面（笔记、幻灯片、白板）留在内存的 `queues` 中，并对侧栏、首页、面包屑与分屏选择器的悬停（65ms 防抖，忽略触屏）/ 聚焦 / 按下做去重预加载（`prefetched` 最多缓存 20 篇、最多 2 个并发；不提前建立 `NoteSaveQueue`，不产生草稿或自动保存副作用），同时按页面类型通过 `preloadPageEditor`（`src/lib/preload-editor.ts`）预加载对应的编辑器代码包（BlockNote / 幻灯片 / 白板 Excalidraw）。切换已缓存或预加载的页面时立即更新画面和 URL，不清空编辑器也不禁用侧栏，再在后台静默核对服务端 `version`（仅在服务端版本更新时刷新或标记冲突，404 时按是否有未保存修改提示或移除，网络错误保留缓存）；切换未缓存页面时，桌面端和分屏保留当前内容并在工作区顶端延迟 150ms 显示 2px 进度线（`.notes-switch-progress`），不整页白屏。桌面端与平板宽度的页面切换、返回首页、新建与删除原地切换内容区，不触发整页水平滑动 View Transition（稳住左侧栏）；手机端（≤639px）保留「首页 ⇄ 页面」的 `forward` / `back` 滑动动画。

## 子页面、收藏与页面设置

仿 Notion 的页面层级和页面菜单（`src/lib/note-tree.ts` 是前端用的纯函数，`src/lib/note-tree-server.ts` 是服务端的递归查询和元数据写入）。

- **子页面。** `NotePage.parentId` 指向父页面（null 为最上位），层数不限。子页面的 `groupId` 始终与最上位的祖先相同：移入页面、移入/移出项目、拖动重排、从 Trash 复原时，整棵子树的 `groupId` 一起改。不能把页面移到自己（400 `A page cannot be moved into itself.`）或自己的子孙之下（400 `A page cannot be moved into its own sub-page.`）。父页面不在列表里（例如在 Trash）时，子页面当作最上位显示。
- **侧栏与手机首页。** 每个项目和 Notes 区只列最上位的页面，子页面缩进在父页面下（与项目内的缩进和细线相同）。每行都有展开箭头，没有子页面时展开显示 “No pages inside”；展开状态存在本机（`notefable:note-pages-expanded:v1`，侧栏与手机首页共用），打开的页面的祖先总会展开。侧栏页面行右侧提供 “+”（Add a page inside，在该页面里新建子页面并打开）和 “…” 菜单（Rename（未锁定时）、Add to / Remove from Favorites、Move to、Move to Trash）；Favorites 行在未锁定时同样提供快捷重命名图标和取消收藏按钮。未打开或已冲洗草稿的页面重命名走 `PUT /api/pages/:id/title`（并使 `version` 递增、同步向量索引），打开且可编辑时由 `useNotePages.renamePage` 直接走当前页编辑保存。拖动重排时，放下的页面成为目标页面的兄弟（同一父页面、同一项目）。
- **收藏。** `favoritedAt` 非空即为收藏，侧栏和手机首页最上方的 Favorites 按收藏时间列出；从页面菜单或 Favorites 行的按钮移除。
- **页面菜单（上部栏的 “…”）。** 字体（Default / Serif / Mono）、Small text、Full width、Lock page，以及 Add to/Remove from Favorites、Duplicate、Add a page inside、Move to、Export Markdown（见“Markdown 导出与导入”）、Move to Trash。设置存在 `fullWidth`、`smallText`、`font`、`locked` 列，由 `PUT /api/pages/:id/settings` 单独保存，不增加 `version`，不会和自动保存冲突；`NotesWorkspace` 根据一览里这篇的设置给 `.notes-workspace` 加 `is-full-width`、`is-small-text`、`notes-font-serif`/`notes-font-mono` 和 `is-locked`，`/note-embed` 同样生效。
- **锁定。** 锁定后编辑器、标题、图标和封面在界面上不可编辑，上部栏显示 “Locked” 按钮，点击即解锁。这是防止误改的界面保护，不是权限：服务端的保存接口、AI 编辑案的适用都不检查它。
- **移动（Move to）。** 移动对话框列出项目（移到该项目的最上层，并脱离父页面）和页面树（移到该页面之下；自己和自己的子孙不列出，可按标题筛选）。
- **复制（Duplicate）。** 先保存这篇及其子页面未保存的编辑，再由 `POST /api/pages/:id/duplicate` 在一个事务里复制整棵子树（最多 100 篇，超过返回 400）：标题、图标、封面、正文、页面设置和项目照抄，最上位的标题加 “ (1)”，收藏、历史和 AI 对话不复制；复制件排在原页面的后面，响应带回全部页面的新 `position`。
- **Trash。** 移入 Trash 时整棵子树用同一个 `deletedAt` 一起移入（响应的 `ids` 是全部被移入的页面）。Trash 列表只显示每批的最上位页面；复原时把同一时刻一起移入的子孙一起复原（中间隔着另一时刻移入的页面时，那之下的不复原），父页面仍在 Trash 或已被删除时复原到最上位，父页面还在时跟随父页面当前的项目。永久删除一篇时，Trash 里它的子孙一起删除。

## 反向链接（#189）

笔记正文的最下面（编辑器之后、分隔线之下）列出这篇页面的反向链接（`src/components/note-backlinks.tsx` 的 `NoteBacklinksSection`，网页 `/app`、分屏和 `/note-embed` 共用），两组：

- **页面**：本人未进 Trash 的页面里指向这一篇的：笔记正文里的 `@` 页面提及，或正文里指向本站 `?view=pages&page=<id>` 的链接（与编辑器“原地打开”的判断相同：同源、`view=pages`），白板里链接到这一篇的元素或页面卡片（`customData.notefablePage`），以及幻灯片文字里指向本站这一篇的链接（放映和公开页里它在新标签页打开）。幻灯片里白板截图的来源页（`pageId`，点不了）不算。不含这一篇自己。点一下原地打开（网页走 `onOpen`，内嵌页发 `openPage`）。
- **聊天**：在这篇页面的 AI 面板里开始的会话（`Session.noteId`），和在发言里用“＋添加页面”附上过这一篇的会话（`MessageNote`，只看 `active` 的发言）。点一下切到 Chats 打开那段会话；从附件来的会话滚到最近一条附上这一篇的发言（`messageId`），从 AI 面板来的会话打开到末尾。分屏里在左边的聊天打开。

两组都按最近更新排序，各最多 50 条（聊天按会话取，一个会话里附了多少次都只占一条），先显示 5 条，其余用 “+{count} more” 展开；两组都空（或读不到）时整块不显示。按 Ctrl / ⌘ / Shift 点击时照常交给浏览器（新标签页）。`/note-embed` 只在 App 声明 `canOpenPage()` 时列页面、声明 `canOpenChat()` 时列聊天，点了发 `openPage` / `openChat`，不让 WebView 跳转。白板和幻灯片页面是整屏画布，下面没有正文区，不显示这一块（它们作为链接的来源仍会出现在别的笔记的列表里）；公开分享页（`/s/:token`）也不显示。

数据来自 `GET /api/pages/:id/backlinks`（`src/lib/note-backlinks-server.ts`）：打开页面时在数据库里现查，不建索引表。笔记走本人页面的正文 JSON（与搜索一样），只把含这个页面 ID 的链接带回，再用与编辑器相同的规则（`notePageIdFromUrl`）确认。白板 / 幻灯片的本体很大，读它们会随页数变慢，所以每次保存时服务端把本体里的页面链接抽进 `NoteCanvas.links`（`extractCanvasLinks`，`src/lib/note-backlinks.ts`；复制页面时一并复制），查询只读这一列。页面改了标题、进了 Trash 都立即反映。

打开着的页面在这些时候延迟 400ms 重读一次：别的页面保存完成或进 Trash（`notefable:backlinks-stale`，`useNotePages` 派发）、会话列表变了（发送、改名、删除，`/app` 在列表变化时派发同一事件；`notefable:note-chat-saved` 是 AI 面板）、页面被 AI 改写（`notefable:page-updated`）、新建或复原了页面（`notefable:page-created`）、别处移入 Trash（`notefable:pages-trashed`）。原生 App 的抽屉和回收站盖在笔记上面时，里面的改动由 App 调 `notefableEmbed.refreshBacklinks()` 让编辑器重读：别的页面改名、换图标、复原（Android 与 iOS，写入成功后）、聊天改图标（iOS，写入成功后）、聊天改名和删除（iOS，抽屉关上时；Android 的抽屉只在离开笔记后列聊天）。在 A 里写了 `@B` 马上打开 B，A 的保存一落地 B 的列表就会出现 A。其他标签页或其他设备上的变化要重新打开页面才反映。
## 接口

| 路径 | 行为 |
| --- | --- |
| `GET /api/pages` | 返回 `{ pages, groups, kinds }`（`kinds` 是 `PAGE_KIND_FEATURES`，原生应用据此决定分区和新建菜单）：页面摘要按 `position`、创建时间排列（含 `kind`、`cover`、`coverPosition`、`groupId`、`parentId`、`favoritedAt`、`fullWidth`、`smallText`、`font`、`locked`、`position`），分组按 `position` 排列；带 `?recent=1` 时只返回按 `updatedAt` 排序的最近 4 篇 `{ id, kind, title, icon, cover, coverPosition, updatedAt }`（空对话页的最近笔记卡片使用）。均只含不在 Trash 里的笔记 |
| `PUT /api/pages/:id/title` | 侧栏改页名 `{ title }`（规范化换行与空白，最长 200 字符，空回填 `Untitled`）：使 `version` 递增并触发语义搜索索引更新；白板 / 幻灯片同时带回本体 `data`（避免版本号前移而本地画布数据滞后）。未找到返回 404 |
| `POST /api/pages` | 新建 `{ title, icon, cover, blocks, parentId?, groupId? }` 页面（`parentId` 指定时成为该页面的子页面、项目随父页面，父页面可以是任何类型，`groupId` 不看；没有 `parentId` 时 `groupId` 指定的本人项目的最上层，在同一事务里用 `FOR KEY SHARE` 锁住项目行，不是本人的或已删除的项目 404 `Project not found.`，格式不对 400）；带 `kind: "whiteboard" \| "slides"` 时是 `{ kind, title, icon, data?, parentId?, groupId? }`（`data` 省略为空的本体），201 `{ page }` 的 `page` 带 `data`；未知的 `kind` 400，也用于保存冲突副本，以及聊天回答下方的 “Save to page”（块由浏览器按回答生成，规则见 [chat-flow.md](chat-flow.md#回答的复制保存到-notes-与-markdown-导出)；服务端照常校验） |
| `POST /api/sessions/:id/page` | 输入栏 “＋” 菜单里的 “Create page”：AI 把整段对话改写成一篇笔记，经 `answerToNoteContent`、`validateNoteContent` 与 `createNotePage` 新建，201 `{ page, partial }`；计入聊天额度，规则见 [chat-flow.md](chat-flow.md#整理成笔记create-page) |
| `POST /api/pages/diagram` | “Draw as diagram”（画成图）：`{ source: "answer", messageId } \| { source: "note", pageId }`、`model?`、`clientRequestId`。AI 把回答或笔记画成 Mermaid，服务端转成可编辑的白板元素，新建白板（从笔记来的是它的子页面，`aiUpdatedAt` 设为现在），201 `{ page, partial? }`；同一个 `clientRequestId` 再来时返回已建的页面（200，不计数）。计入聊天额度，规则见 [chat-flow.md](chat-flow.md#画成图draw-as-diagram) |
| `POST /api/pages/from-answer` | Android / iOS 原生 App 的 “Save to page”：`{ markdown, sessionId, messageId?, savedOn? }`，服务端核对会话归属后用 `answerToNoteContent` 生成块，经 `validateNoteContent` 与 `createNotePage`（同 `POST /api/pages`）新建，201 `{ page }` |
| `GET /api/pages/:id` | 读取拥有的页面（Trash 里的笔记返回 404）。白板 / 幻灯片的 `page` 另带本体 `data` |
| `GET /api/pages/:id/backlinks` | 反向链接（见“反向链接”）：`{ pages: [{ id, kind, title, icon }], chats: [{ id, title, icon, messageId }] }`，都按最近更新排序、各最多 50 条；`messageId` 是最近一条附上这一篇的发言（只在 AI 面板里开始的会话为 `null`）。`Cache-Control: no-store`；不是本人的或在 Trash 里返回 404 |
| `PATCH /api/pages/:id` | 原子保存 `{ title, icon, cover, coverPosition, blocks, version }`，版本递增；同一事务内按需先写一份 `AUTO` 历史（见“编辑历史与恢复”）。Trash 里的笔记返回 404。白板 / 幻灯片收 `{ title, icon?, data?, version }`，只回 `{ version, page }`（见“页面类型”） |
| `DELETE /api/pages/:id` | **移入 Trash**（软删除）：给这篇和全部子页面写同一个 `deletedAt`，响应 `{ ok: true, ids }`；不是永久删除。成功后顺带尽力清理本人超期的 Trash 笔记 |
| `GET /api/pages/trash` | 返回 `{ pages: NoteTrashItem[] }`（`id`、`kind`、`title`、`icon`、`deletedAt`、`purgeAt`），最近放入的在前。先清理本人超期的笔记再列出；`Cache-Control: no-store` |
| `DELETE /api/pages/trash[?before=<ISO 时间>]` | 清空 Trash：永久删除本人 Trash 里的笔记，返回 `{ ok: true, count }`。带 `before` 时只删除不晚于该时间放进 Trash 的笔记（界面用确认时看到的最新一条的时间，避免删掉确认期间别的标签页刚丢进来、用户没看到的笔记）；时间无法解析返回 400 |
| `POST /api/pages/trash/:id` | 复原一篇笔记及一起移入的子页面（保留期内才行），返回与 `GET /api/pages` 单项同形的 `{ page }` 和全部复原页面的 `pages`；不在 Trash、不是本人的、已过期的返回 404 `Note not found in the trash.` |
| `DELETE /api/pages/trash/:id` | 永久删除 Trash 里的这一篇及 Trash 里它的子孙；正常笔记不能用它删除（404） |
| `GET /api/pages/:id/revisions` | 返回 `{ revisions }`（`id`、`reason`、`title`、`version`、`createdAt`，不含正文），最新在前，最多 50 条 |
| `GET /api/pages/:id/revisions/:revisionId` | 返回 `{ revision }`，含 `icon` 和 `blocks`（白板 / 幻灯片另含本体 `data`），用于预览 |
| `POST /api/pages/:id/revisions/:revisionId/restore` | 把笔记恢复为该历史的标题、图标和正文（白板 / 幻灯片恢复本体，响应的 `page` 带 `data`）。body `{ version }` 是客户端当前的笔记版本；成功返回完整的 `{ page }`，版本过期返回 409（带最新的 `page`） |
| `POST /api/pages/covers` | 上传封面图片（JPEG/PNG/WebP/GIF，按文件头判断，最大 4 MiB，按实际接收字节数限制），返回 `upload:` 键；页面引用由随后的自动保存写入。存储用量放不下时 413 `code: "storage_limit"` |
| `GET /api/pages/covers?key=` | 只返回当前用户目录下的封面图片 |
| `POST /api/pages/files` | 上传图片块/文件块的文件，返回 `{ url, name, size, kind }`，规则见“图片与文件”；存储用量放不下时 413 `code: "storage_limit"` |
| `GET /api/pages/files?key=&name=` | 只返回当前用户自己的上传文件 |
| `GET /api/pages/chat-images` / `POST /api/pages/chat-images` | 幻灯片的“聊天里的图片”：列出本人聊天里的图片附件 / 把一张复制成笔记文件，返回 `{ url, name, size }`（[slides.md](slides.md#图片)） |
| `POST /api/pages/images` | 幻灯片的 “AI 生成图片” `{ prompt, size }`：计一次图片生成次数，结果存成笔记文件，返回 `{ url, name, size, prompt }`（[slides.md](slides.md#图片)） |
| `POST /api/pages/groups` | 新建分组 `{ name }` |
| `PATCH` / `DELETE /api/pages/groups/:groupId` | 重命名 / 删除自己的分组 |
| `PUT /api/pages/:id/group` | 把页面（连同子页面）移入自己的分组，或用 `{ groupId: null }` 移出；页面同时脱离父页面成为最上位。响应 `{ id, groupId, parentId: null, ids }` |
| `PUT /api/pages/:id/parent` | `{ parentId }`：移到另一页面之下（`null` 回到最上位、项目不变），子页面一起移动、项目随新父页面；成环返回 400。响应 `{ pages }`（被移动的页面的摘要） |
| `PUT /api/pages/:id/favorite` | `{ favorite: boolean }`：加入/移出收藏，返回 `{ page }`（摘要）。不增加 `version` |
| `PUT /api/pages/:id/settings` | `{ fullWidth?, smallText?, font?, locked? }`（`font` 为 `default`/`serif`/`mono`），只改送来的项，返回 `{ page }`（摘要）。不增加 `version`。白板 / 幻灯片只能改 `locked`，送来字体 / 小字号 / 全宽返回 400（按请求语言译好的句子，`code: "wrong_page_kind"`） |
| `GET /api/pages/:id/share` | 返回该笔记的公开分享状态 `{ share }`（含是否已发布、链接、是否包含子页面、过期时间、是否从上级分享排除、上级公开页面的继承信息） |
| `PUT /api/pages/:id/share` | 三种类型都能发布（幻灯片只公开它自己）；没有公开视图的类型的 `enabled: true` 返回 400（`wrong_page_kind`，句子按请求语言译好）。`{ enabled?, includeSubpages?, expiresAt?, excludeFromParent? }`：按 Notion 方式发布/取消发布（首次发布生成 `shareToken` 并保留、`includeSubpages` 默认 `true`、支持过期时间或 `null` 永不过期、子页面可单独设 `excludeFromParent` 打破继承），元数据写入不增加 `version`，返回 `{ share, page }` |
| `GET /s/:token` / `/s/:token/p/:pageId` | 公开只读笔记页及公开子页面（免登录、实时同步、`noindex`）；涵盖封面、图标、正文块、表格、折叠、代码块复制、块级与行内公式（服务器端 KaTeX）、子页面列表与面包屑。由于工作区外层 `body` 锁定 `overflow: hidden`，公开笔记与不可用页面在各自 `100dvh` 滚动容器内纵向滚动（`.public-note-shell` 带 `scroll-padding-top: 3rem` 避免键盘聚焦被吸顶栏遮挡，`.public-note-unavailable` 同样 `overflow-y: auto`），而公开白板保持整屏固定画布（`.public-whiteboard-shell` 为 `overflow: hidden`）。块、文字高亮、Callout、表格单元格与公式的颜色随浅色/深色外观切换（`globals.css` 的 `--public-note-<颜色>-text` / `-bg`，浅色为 Notion 配色，深色与编辑器的 BlockNote 深色配色一致）。封面、图片图标（`/s/:token/cover?kind=icon`）与正文附件经 `/s/:token/cover`、`/s/:token/file` 仅放行当前公开可见页面实际引用的媒体（`Cache-Control: no-store`） |
| `POST /api/pages/:id/duplicate` | 复制这篇及子页面（类型照抄，白板 / 幻灯片的本体在数据库里复制），201 `{ page, pages, items }`：`page` 是复制后的最上位页面（含正文），`pages` 是全部复制件的摘要，`items` 是全部页面的新 `position` |
| `GET /api/pages/:id/export` | 把这一篇导出成 Markdown：`{ fileName, markdown }`（与 `GET /api/sessions/:id/export` 同形），`Cache-Control: no-store`；不存在、不是本人的或在 Trash 里返回 404；白板 / 幻灯片返回 400（`wrong_page_kind`，句子按请求语言译好）。见“Markdown 导出与导入” |
| `POST /api/pages/import` | `{ files: [{ name, markdown }], groupId? }`：每个文件新建一篇笔记，全部在一个事务里，201 `{ pages }`（摘要，顺序与文件相同）。上限和错误见“Markdown 导出与导入” |
| `PUT /api/pages/:id/icon` | 侧栏里点行首图标修改**未打开**笔记的图标：`{ icon: <单个 emoji、上传图片的键或 null> }`（键要在自己目录下，并在同一事务里 `claimCover`），返回 `{ page }`。图标也在自动保存的 PATCH 里，所以这里把 `version` 加 1，其他标签页里旧内容的保存会得到 409，不会把图标改回去；已打开的笔记走编辑器自己的自动保存，不调这个接口 |

所有操作通过 `getOrCreateUser()` 识别当前用户（签名设备 Cookie 或 Google / 邮箱登录会话）；页面不存在、属于其他用户或在 Trash 里时，除 Trash 接口外都返回 404。PATCH 版本不一致时返回 409 和当前拥有的页面，正文相同的重复请求可以成功返回，以处理保存响应丢失的情况。GET 使用 no-store；应用内不对写操作限流。

## Trash（回收站）

删除笔记不再永久删除：`DELETE /api/pages/:id` 只给 `NotePage.deletedAt` 写入当前时间，位置、分组、封面、正文和 `version` 都不动，笔记助手的对话（`Session.noteId`）和编辑历史也原样保留。放进 Trash 的笔记从其他所有地方消失：侧栏和 Notes 首页的列表、`GET/PATCH /api/pages/:id`、移动分组、拖动排序、`/api/search`、AI 的 `search_notes` / `read_note` / `propose_note_edit`、适用 AI 提案、笔记里 AI 助手的 `noteId` 校验、项目参考笔记，全部带 `deletedAt: null`（新增读取笔记的代码必须遵守，见 [database.md](database.md)）。

- **入口与保留期。** Notes 侧栏的 Trash 按钮打开 `NoteTrashDialog`；删除笔记的确认框写明“移入 Trash，30 天内可复原”。保留期 30 天（`TRASH_RETENTION_DAYS`，`src/types/notes.ts`）；列表里每项带 `purgeAt = deletedAt + 30 天`，对话框显示“Deleted N days ago · M days left”。
- **复原**（`POST /api/pages/trash/:id`）把 `deletedAt` 清空，笔记保留原来的 `position` 值和分组（分组在此期间被删，则回到“无项目”；列表顺序见“页面排序”）。只在保留期内才允许，边界与清理共用 `trashCutoff()`。对话框随后派发 `notefable:page-created`（detail 是返回的摘要），`useNotePages` 据此把它加进侧栏列表，不需要重新拉取列表。复原不弹确认，因为它可逆。
- **永久删除**有三条路径：单篇“Delete forever”、“Empty trash”（两者都有行内二次确认）和超期清理。永久删除会级联删除这篇笔记的编辑历史和项目参考关联，不可恢复；在这篇笔记的 AI 面板里开始的聊天保留在 Chats 里（只解除与笔记的关联）。
- **没有定时清理。** 超期笔记在三个时机被删：打开 Trash 列表时、把另一篇笔记放进 Trash 时（尽力而为，失败只记日志、不影响删除本身）、清空 Trash 时。超期笔记在被真正删除之前也不会在任何接口里出现，复原会被拒绝。
- 放进 Trash 前，`remove()` 先把该笔记的未保存编辑 flush；flush 失败则不删除，并提示先处理未保存草稿。成功后丢弃该页的本地队列和 `notefable:page-draft:v1:<pageId>` 草稿缓存，所以复原后看到的是服务端保存的正文，不会被旧草稿覆盖。
- Trash 里的笔记仍引用它的上传封面和文件，因此保留期内它们不会被回收（见 [database.md](database.md#storedfile)）。

## 编辑历史与恢复

`NoteRevision` 保存笔记被覆盖之前的快照（标题、图标、正文和当时的版本）。写入时机：

- **自动保存**：`PATCH /api/pages/:id` 的事务里、更新之前，若该笔记最近 10 分钟内没有 `AUTO` 历史，就把当前已保存的状态复制成一份。这是 DB 内的一条 `INSERT ... SELECT ... FOR UPDATE`，正文不经过应用，自动保存不会因此变慢；`FOR UPDATE` 避免同一版本的两个并发保存都写入。版本冲突（409）、响应丢失后的重发、笔记在 Trash、正文为空时都不写。所以一个连续编辑的笔记大约每 10 分钟留下一份，不是每次保存一份。
- **AI 编辑**：`applyProposal` 适用编辑提案时，在同一事务里先把覆盖前的状态写成 `AI_EDIT` 历史再改笔记；之后任何一步失败，整个事务回滚，历史一起消失，重试不会重复。笔记已在 Trash 或版本变了，则走既有的冲突路径（404 / 409），提案保持待确认。
- **恢复**：写 `RESTORE` 历史（见下）。

每篇笔记最多保留 50 份：自动快照最新 30 份（超过 90 天的也删除），AI 编辑前 / 复原前的快照最新 20 份，两类各自计数，所以连续的自动保存不会挤掉“AI 编辑前”的快照。自动快照在自动保存的事务里用 SAVEPOINT 保护，快照失败只记录日志，不影响保存本身。`GET /api/pages/:id/revisions` 最多返回 50 条摘要，预览时再按需取单份的正文。

**恢复流程**（`POST /api/pages/:id/revisions/:revisionId/restore`，body `{ version }`）：客户端先 flush 未保存的编辑，flush 失败就不恢复；然后带着当前的笔记版本发请求。服务端在一个事务里重读笔记，版本不一致则 409；用保存时同一套 `validateNoteContent` 和 `assertNoteFilesOwner` 重新校验历史内容（失败 400，消息以 “This version cannot be restored.” 开头）；把当前状态写成 `RESTORE` 历史；再按版本条件写入历史的标题、图标和正文，`version` +1。读完到写入之间被别的标签页抢先保存时，条件更新不命中，事务回滚（连同刚写的 `RESTORE` 历史），同样返回 409 和最新的页面。封面、封面位置、分组和位置不变。因为恢复前的状态已被保存，恢复本身也可以再恢复回去。

**打开着的编辑器如何刷新**：恢复成功后，历史对话框派发 `notefable:page-updated`（detail 是返回的完整页面），`useNotePages` 收到后调用该页队列的 `loadLatest()` 并递增编辑器的 `editorEpoch`，编辑器以新正文重新挂载，本地版本号同步为新版本，下一次自动保存不会 409。收到 409 时对话框同样派发 `notefable:page-updated` 带上最新页面，打开的编辑器与版本号随之同步，并提示关闭后重新打开历史。若队列里恰有未保存的编辑，则不覆盖，而是标记为冲突（正常流程里恢复前已 flush，不会发生）。

对话框预览用 `blocksToMarkdown` 转成 Markdown，经 `<AssistantMarkdown math="dollars">` 渲染（只把 `$…$` / `$$` 渲染为 KaTeX，保留 `blocksToMarkdown` 转义出来的 `\[…\]` 与 `\$` 为普通文字；不使用 `dangerouslySetInnerHTML`），电脑上左右两栏、手机上先选版本再看预览。

## Markdown 导出与导入

按篇导出、按文件导入，转换都在服务端做（`src/lib/note-io.ts`），网页、Android 和 iOS 共用这两个接口。没有整个工作区的 ZIP 导出，也不导出子页面树。

**导出**（`GET /api/pages/:id/export`）。`noteToMarkdownFile` 写出 `# 标题`、一个空行和正文；标题里的换行换成空格，空标题写 `Untitled`；标题以 `#` 结尾时在后面多写一个 ` #`（行尾的 `#` 会被当成标题的收尾记号去掉），标题里的 `*`、`_`、`` ` ``、`[`、`]`、`<`、`>`、`~` 和 `\` 前面加 `\`，别的 Markdown 应用不会把它们当成格式。导入时标题取标题行的原文（不像聊天回答的标题那样去掉格式），只把这些 `\` 转义还原，最长保留 200 字，所以自己导出的笔记再导入标题不变（例如 “1. First steps”、“**Bold** plan”）。导入后与新建笔记一样调用 `scheduleNoteEmbeddingSync` 建语义搜索的索引；写入事务的超时放宽到 30 秒（最多 20 篇、每篇接近 1 MiB）。正文用 AI 工具同一套 `blocksToMarkdown`（不带编号），但最上层的块之间用空行隔开，只有同一种列表的相邻项挨着写：`blocksToMarkdown` 是给模型看的紧凑写法，原样存成文件的话，别的 Markdown 应用会把相邻段落并成一段、把段落后面的 `---` 当成标题。空块不写。文件名是 `answerFileName(标题)`（与下载对话相同的安全文件名规则，以 `.md` 结尾）。不导出的内容：图标、封面、页面设置、子页面和编辑历史；上传的图片块和文件块只写成一行 `[Image: 名称 — 说明]` / `[File: 名称]`，不带地址，也不打包文件本身；折叠、Callout 用本应用自己的记法（`▸`、`> [!💡]`），表格单元格的颜色、对齐与合并以及行内下划线、文字色不保留。

- 网页（`useNotePages().exportPage`）：入口是页面菜单的 “Export Markdown”（Notes 顶栏和分屏的笔记面板都有）。这篇有未保存的编辑时先 flush，存不上就不导出，提示 “Resolve the unsaved draft before exporting this page.”；其他失败显示服务端的句子或 “Could not export the page.”。菜单在点击时已经关掉，所以提示出在笔记上方可关闭的错误条里（`actionError`，与列表加载失败的 `error` 分开）。文件经 Markdown Blob 和隐藏的 `<a download>` 下载，10 秒后释放对象 URL。

**导入**（`POST /api/pages/import`）。上限在 `note-io.ts`：一次最多 20 个文件（`MAX_IMPORT_FILES`），每个文件的文字按 UTF-8 算最多 1 MiB（`MAX_IMPORT_FILE_BYTES`），整个请求体最多 4 MiB（`MAX_IMPORT_TOTAL_BYTES`，留在 Vercel 4.5 MB 请求上限以内；错误文案写作 “4 MB”），扩展名只收 `.md`、`.markdown`、`.txt`（不分大小写）。每个文件由 `markdownFileToNoteContent` 转成一篇笔记：去掉开头的 BOM 和 NUL；正文前面没有别的内容的第一个标题行（`#`–`######`）作为笔记标题并从正文里去掉，没有就用去掉扩展名的文件名（都没有则 `Untitled`）；正文经与 “Save to page” 相同的整理和 `markdownToBlocks` 转成块，超过 8 层的嵌套平铺。图标和封面为空。随后照常过 `validateNoteContent` 与 `assertNoteFilesOwner`（Markdown 里写的 `/api/pages/files?…` 图片只接受本人的）。`groupId` 可省略（导入到“无项目”）；给了就必须是本人的项目。用户没有项目时三端都不发；有项目时先弹“Import to”让用户选（见下）。

全部文件都合格后才在**一个事务**里逐个创建，所以任何一个文件有问题时一篇都不建。错误：

| 情况 | 响应 |
| --- | --- |
| 请求体超过 4 MiB | 413 `Import exceeds 4 MB.` |
| 不是 JSON 对象 | 400 `Invalid JSON request.` |
| `files` 不是数组或为空 | 400 `Select at least one Markdown file to import.` |
| 超过 20 个文件 | 400 `You can import up to {max} files at once.` |
| 某一项不是 `{ name, markdown }`、文件名为空或扩展名不对 | 400 `Only Markdown (.md, .markdown, .txt) files can be imported.` |
| 某个文件超过 1 MiB | 413 `Note content exceeds 1 MiB.` |
| 某个文件转成块后放不进一篇笔记（超过 2,000 个块，或整篇 JSON 超过 1 MiB 减 2 KiB 余量） | 413 `File is too long for one note: {name}`（文件名截到 120 字符）。不会像 “Save to page” 那样截掉末尾再保存 |
| `groupId` 格式不对 / 不是本人的项目 | 400 / 404 `Project not found.` |
| 内容没通过笔记校验 | `validateNoteContent` 的原错误 |

- 网页（`useNotePages().importMarkdown`）：入口是 Notes 侧栏底部、笔记主页的按钮行和空状态里的 “Import Markdown”，打开可多选的文件选择框（`accept=".md,.markdown,.txt,text/markdown,text/plain"`）。发请求前先在浏览器里按同样的上限查个数、扩展名和大小，读出文字后再按实际要发的 JSON 大小查一次；不合格只在 Notes 可关闭的错误条（`actionError`）里显示原因，不发请求（`checkImportFiles`）；用户至少有一个项目时，检查通过后弹出 “Import to” 对话框（`ImportTargetDialog`）：第一项 “No project”，后面按项目顺序列出各项目，点一项就导入到那里（请求体带 `groupId`），“Cancel” 则不导入；没有项目时不弹，直接导入到“无项目”。这条错误不遮住空状态和它的按钮，分屏面板没打开笔记时也显示。成功后新笔记加进列表，侧栏收起，并打开第一篇。导入期间和新建一样禁用列表操作。
- Android 和 iOS：页面“…”菜单的 “Export Markdown” 与侧栏、笔记首页、空状态的 “Import Markdown”，用系统的文件选择器，本机检查与网页相同，见 [android-native.md](android-native.md#笔记) 与 [ios-native.md](ios-native.md#ios-上换了做法的地方)。

## 页面里的 AI 助手

打开笔记、白板或幻灯片时，右下角有一个可自由拖动到视口任意位置的圆形 AI 按钮（`src/components/page-assistant.tsx` 的 `PageAssistant`，三种页面共用的组件：传 `pageKind`、`selection`（`{ text, ids?, captureImage? }`）和可选的 `quickActions` / `selectionActions`；白板与幻灯片编辑器既支持点击属性面板顶部的 **Ask NoteFable** 经 `CanvasEditorProps.onAskAi(selection)` 主动展开面板，也通过 `CanvasEditorProps.onSelectionChange` 实时同步当前选区——只要画布上有选中的元素，右下角 AI 角色按钮即亮起数量角标，手动点开或已展开的面板均会自动附带该选区上下文与实时截图能力（被动切换画布选区不抢输入焦点，点 `×` 或发送后解除当前绑定直至重新选择），视觉模型发送时按需把 `captureImage()` 产出的选区 PNG（长边 ≤ 1568 px）走常规 `/api/uploads` + `/api/chat` 上传，截图或上传失败时静默降级不阻断发送并给出温和提示「Could not attach the selection screenshot this time.」；编辑器经 `CanvasEditorProps.aiSlot` 给按钮留位置（幻灯片：单页编辑面的右下，不压住右边的设置栏和手机底部的缩略图），按钮没被拖动过时放在那里（`PageAssistant` 的 `anchor`，`anchorFabPosition`），这时的重叠顺序和那个位置一样（z-index 5，编辑器的面板和菜单盖在它上面），拖动过就用拖到的位置；还没有编辑器的类型在占位画面旁边挂同一个面板，只能问、不能改。`/api/chat` 在白板 / 幻灯片会话里说明用户在哪一页、选中了哪些元素 / 幻灯片（见 [provider-requests.md](provider-requests.md#笔记助手会话多出的指令)）。常用按钮按类型不同：笔记见下文；白板是 Summarize / Find gaps / Suggest next steps，白板选区是 Summarize / Explain / Group & organize / Find gaps / Suggest next steps；幻灯片是 Summarize / Suggest improvements，幻灯片选区是 Summarize / Explain / Find gaps / Suggest next steps，都只回答不改。标题栏只保留历史、新对话和关闭三个按钮；“自动应用”改为带文字标签与物理开关滑块的紧凑切换控件，移至输入栏底部的模型选择器旁（只在 AI 能修改这种页面时显示，颜色与滑块位置共同表示开/关，不改变默认值与适用条件），见 [chat-flow.md](chat-flow.md#编辑案与确认)。笔记的 AI 按钮：电脑 52px、里面的角色 40px，手机 56px、角色 42px；面板标题栏和回答上方的角色 24px，聊天里是 32px；位置持久化在当前浏览器 `localStorage` 的 `notefable:note-ai-fab`，`src/lib/fab-position.ts`）：显示当前所选的 AI 角色（默认 Quill）或上传图标，预设角色带有轻量待机及输入 / 思考 / 回答 / 完成 / 报错状态反馈动画（悬浮按钮尺寸固定，不挤压或移动笔记正文；系统开启“减少动态效果”时静止）。电脑上点开后按按钮所在位置经 `panelPlacement()` 动态浮在上方或下方，手机上是底部弹出的面板（端上的“返回”键可以关闭）。面板里可以输入要求，或点常用按钮（Improve writing、Fix spelling & grammar、Summarize、Make it shorter、Continue writing）；输入栏提供 “＋” 菜单（添加文件或照片、添加页面、以及可编辑页面上的“生成图片”入口——打开与编辑器共用的 `WorkspaceImageDialog`，支持粘贴图片，发送 `uploads` 与 `pages`）、网页端内联模型/推理选择（`/note-embed` 隐藏，改用 App 传入的模型）以及网页端撞上限时的 `GuestLimitPrompt` / `UpgradePrompt`（`/note-embed` 优先发 `usageLimit` 交由原生提示，旧版 App 只展示气泡内原因并保留草稿，不在 WebView 内弹网页登录或 Stripe）。发送前先把正在输入的内容保存（`NoteSaveQueue.flush`），保存不了（例如有冲突）就不发送。

面板直接调用 `/api/chat`，额外带上 `noteId`（并固定 `webSearch=off`），使用聊天里当前选的模型和推理强度。服务端确认该笔记属于当前用户（否则 404），新建的会话写入 `Session.noteId`，并在共享的 `buildInstructions()` 里加一行说明“用户正在这篇笔记里提问”，要求先 `read_note` 再 `propose_note_edit`。带 `noteId` 的请求只能续用 `noteId` 相同的会话（否则 404）。笔记在 Trash 期间不能再向它发送助手请求（`/api/chat` 的笔记校验带 `deletedAt: null`，返回 404）。

**面板里的聊天是正式的聊天记录。** 在面板里开始的会话和普通聊天存在同一张 `Session` 表里，只多一个 `noteId`：它出现在 Chats 列表（网页发送结束后派发 `notefable:note-chat-saved`，`/app` 侧栏随即重新读取列表，这段会话在 Chats 里已读过时也重读消息；Android / iOS 在打开抽屉时刷新列表，从笔记切回聊天时用 `refreshActiveQuietly()` 重读当前会话）、能被搜索命中、可以导出、另存为笔记、编辑 / 重新生成和分支，也可以在 Chats 里接着聊。在 Chats 里续聊时请求不带 `noteId`，服务端按 `Session.noteId` 重新读取这篇笔记（本人、不在 Trash），在 `buildInstructions()` 里说明“这段对话是在这篇笔记的编辑器里开始的”；笔记在 Trash 或已被永久删除时按普通聊天继续。网页搜索只在面板里的发送固定关闭，Chats 里按 Chats 的选择。笔记放进 Trash 时会话不动；笔记被永久删除时会话保留，`Session.noteId` 置空（`ON DELETE SET NULL`）。同一个会话不能在面板和 Chats 两边同时发送：`src/lib/session-turns.ts` 记录两边各自正在等回答的会话，另一边发送时提示 “Wait for the current reply to finish.”（只在同一页面内协调，不跨标签页）。

面板标题栏有三个按钮：这篇笔记的聊天（时钟图标，列出 `GET /api/sessions?noteId=` 返回的会话，按最近更新排序，点一条就读取 `GET /api/sessions/:id/messages` 接着聊）、新聊天（清空面板，下一次发送新建会话；旧会话仍在列表里）和关闭。第一次打开面板时自动接着这篇笔记最近的一段聊天；标题栏显示当前会话的标题。常用按钮发出的长指令在重新读取时显示回按钮的名称（`restoreNoteChatMessages`）。`/note-embed`（Android / iOS 的笔记编辑页）用的是同一个面板。

**选中文字 / 选区与吉祥物互动。** 编辑器的格式工具栏最前面有 **Ask AI**（`note-editor.tsx` 的 `NoteAskAiContext`；选中的是图片 / 文件块时没有），块选择浮动栏与 `⋮⋮` 菜单也有 **Ask NoteFable**。只要笔记（块选区）或白板 / 幻灯片（画布选区）存在实时选区且面板尚未展开，右下角 AI 吉祥物按钮即触发一次轻弹与光圈脉冲（`.note-ai-fab.is-perked`，尊重减少动态效果设置），并在按钮面向画面中央的一侧弹出可点击的 **Ask NoteFable** 气泡（`.note-ai-bubble`，`bubblePlacement` 随拖动位置和 LTR/RTL 自动翻转，附带选区数量标签与 `×` 关闭键）。点击气泡或 **Ask AI** 后打开面板并聚焦输入框，所选内容作为引用条显示在输入框上方（× 移除），下面是针对这段文字的按钮：Improve writing、Fix spelling & grammar、Make it shorter、Explain、Translate（后两个要求模型只回答、不改笔记）；面板还没有消息时，原来针对整篇笔记的常用按钮在有引用期间收起。发送时用聊天引用追问同一个 `composeQuotedMessage` 把引用写成 Markdown 引用块放在发言前面，并多带一个表单字段 `noteSelection=1`；服务端在 `buildInstructions()` 里“用户正在这篇笔记里提问”那一句后面再加一句，要求回答和 `propose_note_edit` 只针对与这段摘录对应的块，除非用户明确要求改别处（原文见 [provider-requests.md](provider-requests.md#笔记助手会话多出的指令)）。`noteSelection` 只在带 `noteId` 时生效。服务端接受这次发送后引用条自动清掉。引用按 Markdown 摘录传给模型，不依附块位置。桌面分屏的笔记面板里没有助手面板，Ask AI 改为把引用交给左边的聊天输入框（[chat-flow.md](chat-flow.md#聊天与笔记分屏)）。两项在 `/note-embed` 里同样可用，所以 Android 和 iOS 的编辑器也有。

AI 的修改默认仍然只是“编辑案”：面板里显示同样的提案卡片，点 Apply 才会写入，写入走 `/api/proposals/:id/apply`，打开的编辑器通过 `notefable:page-updated` 事件更新到最新内容；AI 在读完之后笔记又被改过（或笔记已进 Trash），则应用时返回 409（或 404），需要重新要求。打开“自动应用”时，对这篇（没有锁定的）页面的编辑案和新建的页面立即写入（同样经过版本检查、同样写历史）；对别的页面的编辑案仍要用户点 Apply。适用前会把被覆盖的状态存成一份 `AI_EDIT` 历史，卡片上的 Undo 一键回到适用之前（页面之后被改过时改用“编辑历史”）。AI 写过的页面（`aiUpdatedAt`）在“…”菜单里多一项 “Report AI content”。

## 保存与恢复

`NoteSaveQueue` 在停止输入一秒后保存。同一页面最多一个保存请求进行中，输入期间的新版本等前一个完成后再提交。只有最后一次修改获得服务端确认后才显示 Saved。

失败草稿在内存中保留，并以 `notefable:page-draft:v1:<pageId>` 临时缓存到 localStorage。保存成功后移除缓存，切换到聊天或隐藏标签页时尝试立即保存，仍有未保存内容时关闭页面会触发浏览器提示。localStorage 不可用或容量不足时显示备份不可用提示，正文仍留在当前标签页。

重新打开页面先从服务端验证归属，再检查本机草稿：基准版本一致时恢复并继续保存，版本不一致时保留草稿并显示冲突。冲突停止自动提交，可以保存为新页面或在确认丢弃草稿后载入最新版本。副本创建成功才释放原页面的冲突草稿。把页面移入 Trash 有确认对话框；存在未解决草稿时先处理草稿再移入（见上文“Trash”）。

Cookie 只是设备身份隔离。清除 Cookie 或换浏览器、设备、域名后无法凭当前机制重新认领服务器页面；配置并使用 Google 登录后，同一账号在其他设备登录即可找回。此功能不调用外部模型 API。

## 运行与迁移

无需新增环境变量，沿用 DATABASE_URL 与 COOKIE_SECRET。笔记相关迁移包括 `20260930150000_note_pages`（NotePage 表、归属外键和列表索引）、`20261006120000_note_page_icon_cover`（`icon`、`cover`）、`20261006130000_note_page_cover_position`（`coverPosition`）、`20261006140000_note_cover_assets`（`NoteCoverAsset`）、`20261006150000_note_cover_asset_deleting`（`deletingAt`，并把已有的上传封面登记为使用中）、`20261006160000_note_cover_asset_checked`（`checkedAt` 及索引）、`20261013140000_note_proposals`（`NoteProposal`）、`20261014120000_note_groups`（`NoteGroup` 与 `NotePage.groupId`）、`20261014210000_session_note`（`Session.noteId`）、`20261122120000_session_note_set_null`（`Session.noteId` 的外键改为 `ON DELETE SET NULL`）、`20261015001000_manual_list_order`（`position`）、`20261015100000_note_trash_and_revisions`（`NotePage.deletedAt`、`NoteRevisionReason` 与 `NoteRevision`）、`20261116000000_note_page_tree_settings`（`parentId`、`favoritedAt`、`fullWidth`、`smallText`、`font`、`locked`）、`20261116100000_message_notes`（`MessageNote`）、`20261123000000_page_kinds`（枚举 `PageKind`、`NotePage.kind` 默认 `note`、`NoteRevision.data`、`NoteCanvas` 表）、`20261123000000_stored_files`（`StoredFile` 接替 `NoteCoverAsset`，见 [database.md](database.md#storedfile)）和 `20261124000000_page_ai_harness`（AI 提案的页面类型、自动应用、撤销与 `NotePage.aiUpdatedAt`，见 [database.md](database.md#noteproposal)）、`20261125000000_proposal_images`（文件种类 `PROPOSAL_IMAGE`）、`20261126000000_note_canvas_links`（`NoteCanvas.links`，反向链接用，并回填已有白板 / 幻灯片里的页面链接）。除删掉已搬走的 `NoteCoverAsset` 的那一个外均为非破坏追加（`page_ai_harness` 只加列和枚举值，并回填已有提案的 `appliedPageId` 与 AI 写过的页面的 `aiUpdatedAt`）。历史快照 SQL 用到 `gen_random_uuid()`（PostgreSQL 13+），并显式带 schema（`notefable`）。Trash、历史和文件清理都没有新的环境变量，也没有定时任务（文件清理在请求之后惰性运行）。封面图片与聊天图片共用 `src/lib/storage.ts`（生产为 Private Vercel Blob，本地无令牌时写入 `NOTEFABLE_STORAGE_DIR`）。使用 `npm run prisma:migrate`，不使用 db push 或数据库重置。预览环境仍须使用独立数据库。

## 页面排序

桌面侧栏和手机 Notes 首页没有单独的拖动柄：直接拖动整行（触屏长按后拖），拖动时显示插入线；焦点在行上时 Alt+↑/↓ 也可移动。`POST /api/pages/reorder` 接受 `{ id, targetId, after }`，服务端在用户级事务锁内验证两个页面归属并保存完整顺序；拖到其他分组的页面旁会随之移动分组。排序只更新列表元数据，不改变正文、版本或保存时间；编辑器保存响应沿用当前列表的顺序与分组。刷新请求若早于排序完成，不会把顺序恢复成旧值。排序只涉及不在 Trash 里的笔记；放进 Trash 的笔记保留自己的 `position` 值，复原后按这个值和创建时间重新参与排序（期间其他笔记被重排过的话，不保证回到完全相同的位置）。

## 原生应用内嵌编辑器（`/note-embed`）

原生 Android（`mobile/android`，`WebView`）与 iOS（`mobile/ios`，`WKWebView`）应用自己绘制笔记列表、项目和 Trash，编辑器本身仍用网页的 BlockNote：应用在 WebView 里打开 `<baseUrl>/note-embed?page=<pageId>`（可加 `&lang=<locale>`，支持全部 17 种已启用语言，见 [i18n.md](i18n.md)；`&model=<id>&reasoning=<effort>` 是应用里选的模型和推理强度；`&theme=<light|dark|system>` 是外观，两个应用只发算好的 `light` / `dark`）。页面是按语言预先生成的静态页 `src/app/[locale]/note-embed/page.tsx`，在工作区主机由 `src/proxy.ts` 像 `/app` 一样 rewrite（分域后从主域 `notefable.com` 访问 `/note-embed` 或 `/<locale>/note-embed` 会 307 重定向到工作区主机 `app.notefable.com`）；要打开的页面 ID 在浏览器端从 URL 读取。

- **页面类型。** 白板和幻灯片也用 `/note-embed?page=<id>` 打开。白板打开网页的白板编辑器，幻灯片打开网页的幻灯片编辑器，保存与桥接和笔记相同（白板的画图手势、导出见 [whiteboard.md](whiteboard.md)）；`&reveal=<id>` 让打开后的页面移到搜索命中的块（笔记）或元素（白板）；放映（`presentation`，笔记与幻灯片共用）、导出文件的保存（`fileStart` / `fileChunk` / `fileEnd` / `fileAbort`）和 App 发来的放映 / 导出操作（`notefableEmbed.slides(...)`）见 [slides.md](slides.md#原生应用android--ios)。还没有编辑器的类型显示只读的占位画面（见“页面类型”），桥接照旧（没有要保存的内容，`flush` 总是 `ok`，`saveState` 是 `saved`）。
- **内容。** `NoteEmbed`（`src/components/note-embed.tsx`）只渲染手机 Notes 编辑页的正文：封面、图标、标题、BlockNote 编辑器、保存失败/冲突提示和右下角 AI 按钮，复用 `NotesWorkspace`（`embedded`）、`useNotePages(false, { embedded: true })` 和 `NoteSaveQueue`。不显示网页的顶栏、侧栏和 Chat/Notes 切换；返回、标题、锁定按钮、版本历史、保存状态和“…”页面菜单（字体 / 小字号 / 全宽 / 锁定 / 收藏 / 复制 / 新建子页面 / 移动 / 导出 Markdown / 移入回收站）由应用的原生顶栏负责（与网页端顶栏一致）。412×915 下正文的位置和字号与 `/app?view=pages&page=…` 相同（顶栏高度之外）。不读取笔记列表。
- **保存与恢复照旧。** 一秒防抖自动保存、`notefable:page-draft:v1:<pageId>` 本地草稿、重新打开时的草稿恢复、409 冲突提示（Save as new note / Load latest）、`beforeunload` 和 `visibilitychange` 时的 flush 都与网页相同。WebView 需开启 JavaScript 和 DOM Storage。冲突时选择“另存为新笔记”会把内嵌页切换到新建的副本（URL 用 `replaceState`，不增加历史），并再次发送 `ready`。
- **认证。** 与 API 使用同一组 Cookie：应用加载前把 `notefable_device`（以及登录后的 Auth.js 会话 Cookie）同步到 WebView（Android 为 `CookieManager`，iOS 为 `WKWebsiteDataStore.httpCookieStore`）。笔记文件（`/api/pages/files?key=…`）的下载由应用拦下、带着自己的 Cookie 下载，不交给系统浏览器。
- **AI 按钮的图标。** 页面打开时，`window.NoteFableNative.appIcon` 存在就调用它，拿到应用设置里选的角色或图片（预设角色 `character:<id>` 或图片的 data URL，默认角色 Quill 是空字符串；`readNativeAppIcon`），用 `saveAppIcon` 写进这个 WebView 的 `localStorage`（`notefable:app-icon`），AI 按钮和面板标题随之显示它。读到的值不是预设角色也不是图片（如旧版表情）时按默认角色 Quill 处理；没有这个方法的旧版应用不改已有的值。
- **AI 模型。** 右下角 AI 助手用 URL 里的 `model` / `reasoning`（`readEmbedModelPreference`，再用 `resolveModelPreference` 按服务端模型列表核对：没有的模型不用，选不了的强度换成默认）；没带或无效时用这个 WebView 里最后一次的选择（localStorage），再没有就用服务端默认。
- **外观。** 根布局的内联脚本（`THEME_INIT_SCRIPT`）在第一次绘制前就按 URL 的 `theme` 上色（没带或无效时用这个 WebView 的 `localStorage` 里的 `notefable:theme:v1`，再没有就跟随系统）。页面挂载后，`window.NoteFableNative.theme` 存在就读它（`readNativeTheme`，值为 `light` / `dark` / `system`，其他值不认），没有再用 URL 的 `theme`；读到的值用 `saveThemePreference` 写进这个 WebView 的 `localStorage` 并应用到 `<html>` 的 `data-theme`，BlockNote 编辑器跟着换。应用传的是它自己界面实际显示的 `light` / `dark`，所以编辑器和原生界面总是同一种外观。
- **AI 助手。** 选中文字的 Ask AI、对话恢复和 New chat 与网页相同（见“页面里的 AI 助手”）。

**网页 → 应用**：存在 `window.NoteFableNative`（Android 为 `@JavascriptInterface`，iOS 由 `NoteEditorWebView` 注入转发到 `window.webkit.messageHandlers` 的垫片）时，调用 `window.NoteFableNative.postMessage(JSON.stringify(msg))`，`msg` 为：

| 消息 | 时机 |
| --- | --- |
| `{type:"ready", page:{id,title,icon,kind}}` | `kind` 是页面类型（旧版应用忽略）。页面数据读取完毕、保存队列已建立（BlockNote 是动态加载的，此时可能仍显示 Loading editor…，不代表编辑器已可输入）；打开的页面换成另一篇（冲突副本）时用新 `id` 再发一次，应用据此把打开的笔记换成副本 |
| `{type:"meta", title, icon}` | 本地编辑改变了标题或图标（空标题发 `Untitled`，无图标为 `null`） |
| `{type:"saveState", state}` | 保存状态变化：`saved` / `unsaved`（等待输入停止，网页显示 Saving…）/ `saving` / `error`（Not saved）/ `conflict` |
| `{type:"missing", id?}` | 没有 `page` 参数，或页面不存在、不属于本人、在 Trash 里（404）；编辑中保存返回 404（别处已移入 Trash 或彻底删除）时也发，本地草稿保留。`id` 是找不到的那一篇（没有 `page` 参数时不带）：常驻 WebView 切页时，App 只认这次要打开的那一篇的 missing，上一篇晚到的不会关掉新的一篇（旧网页不带 `id`，App 照旧接受） |
| `{type:"openPage", id}` | 正文里的页面提及被点了。App 用"从链接打开笔记"的同一入口（`openNoteFromLink`）打开那一页：先 flush、切到列表、刷新后笔记在就打开 |
| `{type:"openChat", id, messageId?}` | 笔记下方反向链接里的聊天被点了。App 和搜索结果一样打开那段会话（先 flush、切到聊天，有 `messageId` 就滚到那条发言）。只在 App 声明了 `window.NoteFableNative.canOpenChat()` 时发；旧版 App 的内嵌页不列聊天 |
| `{type:"pagesChanged"}` | 网页新建了页面（笔记 AI 面板的“画成图”画好了白板，或 AI 生成幻灯片做好了一套）。App 刷新笔记列表（`refresh()`）；不认识的旧版 App 忽略 |
| `{type:"slidesWizard", state:"open"}` / `{type:"slidesWizard", state:"closed", busy}` | [AI 生成幻灯片](slides.md#ai-生成幻灯片)的向导出现 / 消失（从 AI 面板打开时也发）。出现期间 App 隐藏自己的顶栏，系统返回 / 边缘返回改调 `slidesWizard({action:"back"})`。`busy` 表示还有生成没完成（App 让 WebView 多留一会儿）。只在 App 声明了 `window.NoteFableNative.canShowSlidesWizard()` 时发 |
| `{type:"flushed", requestId, ok, kept?}` | 对 `flush(requestId)` 的回复；`ok` 为 false 时带 `kept` |
| `{type:"storageLimit", tier, used, limit}` | 编辑器里的图片、文件、封面、图标或 AI 面板的附件因存储空间不够被拒绝（`used` / `limit` 是字节）。只在 App 声明了 `window.NoteFableNative.canShowStorageLimit()` 时发；App 在编辑器上方显示与聊天相同的存储提示（登录 / 升级）。没有这个方法的旧版 App 不收到，网页在编辑器里只说明原因 |
| `{type:"usageLimit", tier, kind, pageId?}` | 编辑器里的 AI 面板（`kind = "chat"`）或幻灯片 AI 生图对话框（`kind = "image"`）撞到 429 `usage_limit`（附带源页面 `pageId` 以便原生过滤切页后晚到的旧响应；AI 生成幻灯片的向导也发 `kind = "chat"`，不带 `pageId`）。只在 App 声明了 `window.NoteFableNative.canShowUsageLimit()` 时发；App 在编辑器上方显示原生登录（游客）或升级/只读上限提示（免费会员）。被拒草稿在 `/note-embed` 下经 `pending-draft` 写入带 2 小时有效期的 `localStorage`，原生登录后重建 WebView 再打开同一页面时仍能恢复。没有这个方法的旧版 App 不收到，网页在 WebView 内只展示原因并保留草稿，不弹网页登录 |
| `{type:"drawing", active}` | 白板正在用绘图工具（抓手以外）。App 据此避开系统的边缘返回手势（Android 每条边 200dp），旧版 App 忽略 |
| `{type:"fileStart", id, name, mime, size}` → `{type:"fileChunk", id, index, data}` ×n → `{type:"fileEnd", id}`（失败时 `{type:"fileAbort", id}`） | 把导出的文件（白板的 PNG / SVG / PDF 等）交给 App 保存：`data` 是每块原始 512 KiB 的 base64。只在 App 声明了 `window.NoteFableNative.canSaveFile()` 时发（`src/lib/export-file.ts`）；旧版 App 里网页提示更新 |
| `{type:"trashed"}` | 预留：内嵌页目前不提供移入 Trash 的入口，Trash 由应用在 flush 成功后调用 `DELETE /api/pages/:id` |

**应用 → 网页**：`window.notefableEmbed`。

- `flush(requestId)`：立即保存未保存的编辑，返回 `Promise<boolean>`，并回复 `{type:"flushed", requestId, ok}`。`ok` 为 true 表示没有未保存内容；冲突或保存失败时为 false（草稿仍在本地）。`kept` 为 true 表示失败不是冲突、草稿已存进 localStorage（下次打开会恢复并重试），应用可以在提示后允许离开，和 `/app` 切走时只 `void flush()` 一样。离开编辑页、移入 Trash、切换页面、登录或退出前先调用。
- `openHistory()`：打开该笔记的 `NoteHistoryDialog`（与网页相同，恢复前先 flush）。
- `pageUpdated(page)`：应用在聊天里应用了编辑案、而被改的笔记正开在编辑器里时，把 `POST /api/proposals/:id/apply` 返回的 `page`（JSON 字符串或对象）传进来。网页校验后发出与编辑案卡片相同的 `notefable:page-updated`，由 `useNotePages` 处理：没有未保存的编辑就 `loadLatest` 并换掉编辑器，有就标成冲突。不传的话编辑器仍是旧版本，下次保存会 409。格式不对时返回 false、什么也不做。
- `pageSettings(page)`：应用在原生的 “…” 菜单里改了字体、Small text、Full width、锁定或收藏后，把 `PUT /api/pages/:id/settings` / `favorite` 返回的 `page`（一览的摘要，JSON 字符串或对象）传进来。网页校验 `id`、把未知的设置值换成默认值，发出 `notefable:page-meta`，`useNotePages` 用它替换这篇的设置，编辑器随即变宽、换字体或变为只读。没有 `id` 时返回 false。
- `appIcon(icon)`：编辑器开着时应用在设置里换了角色或图片，把新值（预设角色 `character:<id>` 或 `<id>`、图片的 data URL；`null`、`character:quill` 或空字符串是默认角色 Quill）传进来，网页用 `saveAppIcon` 存下并立刻换掉 AI 按钮上的角色或图片。不是预设角色也不是图片时返回 false、什么也不做。
- `theme(value)`：应用的外观变了（设置里换了，或跟随系统时系统切了深浅）时把 `light` / `dark`（也接受 `system`）传进来，网页保存并就地换色，不重新加载、不动正文和未保存的编辑；返回 `true`，其他值返回 `false`、什么也不做。两个应用在收到 `ready` 后也再推一次，覆盖加载期间发生的变化。
- `slidesWizard(request)`：AI 生成幻灯片的向导（对象或 JSON 字符串）。`{action:"open", source, model?, reasoning?}`，`source` 为 `{type:"new", groupId?, parentId?}`、`{type:"note", pageId}` 或 `{type:"chat", sessionId}`（ID 为 1–120 位的字母、数字、`_`、`-`）；`{action:"back"}` 关最上面一层（选笔记面板，其次向导，草稿保留）。形状不对或没有可关的返回 `false`。有这个函数就说明网页支持（旧服务端没有）。向导盖在当前页面上，不切页；要读的笔记正开着时网页自己先保存。`openPage` / `close` 只把向导藏起来（请求和草稿保留）。
- `openPage(request)`：原生端复用同一个常驻 `/note-embed` WebView 时，传入 `{ id, reveal?, model?, reasoning? }`（或 JSON / ID 字符串）就地切换到另一篇页面或重新打开缓存里的页面；不向历史栈压记录（`replaceState`，不污染原生返回手势），立即命中 `useNotePages` 内嵌模式最多 8 篇的 LRU 缓存并后台对账（未命中时仅拉取单页数据，不重载 HTML / JS 包）；返回 `true` 表示网页已接管，旧版服务端无此方法时返回 `false` 由原生自动回退到整页加载。
- `close()`：原生端返回笔记列表或切到聊天、暂留常驻 WebView 热缓存时调用，卸载当前 `NotesWorkspace` 编辑器 DOM（释放 BlockNote / 白板 / 幻灯片实例与定时器），只保留轻量的网页壳与最多 8 篇的 LRU 队列缓存；未保存或保存中的队列绝不被 LRU 驱逐。
- `pageTrashed(ids)`：原生端在列表、菜单或聊天提案撤销里把页面移入回收站时传入页面 ID 数组（即使当前未打开编辑器），从常驻 WebView 缓存中同步清除这些页面与草稿。
- `refreshBacklinks()`：原生端在笔记上面改过别的页面或会话（改名、换图标、删除、从回收站复原）后调用，打开着的笔记重读反向链接。旧版网页没有这个函数时什么都不做。

消息的组装与 flush 的回复在 `src/lib/native-bridge.ts`（有单元测试）；更改约定时同时修改 Android / iOS 应用端以及 [android-native.md](android-native.md) / [ios-native.md](ios-native.md)。

语言切换也通过桥就地更新：`window.NoteFableNative.language()` 返回原生当前生效的内部语言代码，`window.notefableEmbed.language(code)` 返回 `Promise<boolean>`。网页校验已启用的代码，复用 `I18nProvider` 的取消、回滚与错误重试。原生端仅在首次加载或渲染进程重建时调用加载 URL，语言变化只推送 `language`；网页刚加载完时再读取/推送当前语言，覆盖加载过程中发生的变化。此操作不 flush、不重载、不替换页面正文或编辑器，未保存编辑与笔记 AI 流保持原状。
