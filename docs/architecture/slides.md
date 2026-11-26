# 幻灯片（Slides）

工作区的第三种页面（`NotePage.kind = slides`，[notes-flow.md](notes-flow.md#页面类型笔记--白板--幻灯片)）。编辑器仿 Figma Slides：总览（一行 = 一章）和单页编辑（左侧缩略图带），版式、主题、自由摆放、放映、导出、公开放映链接。网页做全部功能，Android / iOS 在 `/note-embed` 的 WebView 里用同一个编辑器，原生只接放映（横屏、全屏、常亮）和导出文件的保存。

代码：`src/lib/slides/`（数据形状和纯函数，服务端也能用，有测试 `slides.test.ts`、`ai-edit.test.ts`），`src/components/slides/`（画面），公开页面 `src/components/public-slides-view.tsx`。编辑器在 `CANVAS_EDITORS.slides` 登记（`src/components/canvas-editors.tsx`，`next/dynamic` 按需加载），`PAGE_KIND_FEATURES.slides = { editor: true, publicShare: true, markdownExport: false, typography: false, aiEdit: true }`。

## 数据

本体在 `NoteCanvas.data`（服务端只校验外框，见 notes-flow.md；内容由 `src/lib/slides/model.ts` 定义）：

```text
{ format: 1, theme: { id, mode: "light" | "dark" },
  slides: [{ id, layout, hidden?, notes?, section?, background?, transition?, elements: [...] }] }
```

- 一页是 1920 × 1080 的逻辑像素（16:9），显示时缩放。PPTX 里是 13.333 × 7.5 英寸（1 px = 1/144 英寸，字号 1 px = 0.5 pt）。
- `section`：有这个字段的页开始总览的新一行（章），值是章名（可空）；第一页总在第一行。
- `transition`：可选的简易翻页转场（`"fade"` 淡入 / `"slide"` 滑入；`"none"` 或省略时字段不写入，保持旧 Deck JSON 100% 兼容）。右侧页属性栏（`slide-inspector.tsx`）提供单页选择与“应用到全部幻灯片”（均进撤销栈）。
- 元素共有 `id, x, y, w, h, rotation, group?, role?, opacity?`。类型：`text`（富文本 `doc` + `style`）、`shape`（15 种形状，可带文字）、`line`（箱子的对角线，`flipH` / `flipV` 定方向，两端可带箭头）、`image`（`src` 只能是本人的 `/api/pages/files?key=…`；`generated.prompt` 记着 AI 生成的说明，用于举报；`pendingImagePrompt` 仅在待生成配图的空占位上暂存，一旦填入 `src` 即由 `normalizeDeck` 清除，且 `publicDeck` 严格剥离）、`table`（纯文字单元格，最多 50 × 20）、`whiteboard`（白板框的静态图，见下）。
- 颜色是主题色名（`background, surface, text, muted, heading, accent, accent2, accent3, line`）或 `#rrggbb`；换主题时用色名的元素一起变。
- 富文本是 ProseMirror 的 JSON（`src/lib/slides/rich-text.ts`）：段落（对齐）、项目符号 / 编号列表、代码块（可选 `attrs.language`）、块级公式，行内文字带粗体、斜体、下划线、删除线、代码、链接（只允许 http / https / mailto / tel）、颜色、字号，以及行内公式（KaTeX）。
- 读入时一律经过 `normalizeDeck`：坏值换默认值，未知元素丢掉，重复 ID 重新分配，外部图片地址清空（公开页面不会去外部取图）。搜索用的 `segments` 由服务端从所有 `text` 字段和备注里取（`extractCanvasSegments`，公式的 TeX 也算），ID 是页的 ID。

## 编辑器

- **两种视图**：总览（行 = 章；行名可改；拖动可跨行，拖到下面的空白处开新行）和单页编辑（缩略图带：桌面在左、手机在下）。缩略图拖动排序：鼠标移动 6 px 开始，触摸要先长按。
- **页操作**：新建（选版式）、复制、删除、隐藏 / 显示、分章 / 合并章、拖动排序，可多选（Shift / Ctrl）。
- **版式**（8 种，`src/lib/slides/layouts.ts`）：标题、章节、要点、两栏、图文、引用、全幅图片、空白。每个版式有按角色（title / subtitle / body / body2 / image / quote / attribution / caption）的占位。换版式时把角色对得上的元素移到新占位并套用尺寸和格式；对不上的有内容就留在原地变成自由元素，空的才删掉——内容不会丢。空占位只在编辑时显示提示，放映和导出不画。
- **主题**（8 种，`src/lib/slides/themes.ts`）：标题和正文的字体组合 + 浅色 / 深色配色，一键切换整套。字体全部是 Google Fonts（SIL OFL），用 `next/font` 在构建时取入、自己分发（`slide-fonts.ts`，不 preload，只下载用到的字体）。
- **元素**：文字框、形状、线 / 箭头、表格、图片（上传、粘贴、从聊天里选、AI 生成）、白板框。拖动、八个手柄缩放（Shift 保持比例，图片的角默认保持）、旋转（Shift 每 15 度）、吸附到页边 / 中线 / 其他元素并显示参考线、框选、对齐、等间距分布（3 个以上）、层级、组合 / 取消组合。
- **文字**：ProseMirror（`text-editor.tsx`）。输入法（中日韩）组字期间不从外面替换内容。输入规则：行首 `- ` / `1. ` 列表、` ``` ` 代码块、`$…$` 行内公式、行首 `$$ ` 块级公式。编辑文字时上方出现格式栏。公式用 KaTeX，有公式的页才加载（与笔记的公式相同的延迟加载）。
- **演讲者备注**：每页一段纯文字（最多 20,000 字符），在单页编辑下方。
- **撤销 / 重做**：编辑器自己保存之前的本体（连续的同类操作——打字、备注、方向键移动——合并成一步）。保存交给 `NotesWorkspace` 的保存队列（`onChange(data)`）。
- **快捷键**：Ctrl/⌘+Z / Shift+Z / Y 撤销重做，Ctrl/⌘+M 新页，Ctrl/⌘+D 复制，Ctrl/⌘+G / Shift+G 组合 / 取消，Ctrl/⌘+] / [（加 Shift 到最前 / 最后）层级，Delete 删除，方向键微移（Shift 大步），Enter 编辑文字，Esc 取消选择，T / R / O / L 插入文字 / 矩形 / 椭圆 / 线，Ctrl/⌘+C / X / V 复制粘贴元素或页（也能粘贴图片和纯文字），F5 从头放映、Shift+F5 从当前页放映。
- **只读**：锁定的页面、Trash 里的页面和历史预览不能编辑（`editable: false`），仍可放映和导出。
- **检索跳转**：搜索命中幻灯片时 `blockId` 是页的 ID；`revealNoteBlock` 发 `notefable:reveal-canvas-item`，编辑器打开那一页并高亮缩略图（`src/lib/search-reveal.ts` 的 `canvasItemSelector`）。

## 图片

- **上传 / 粘贴**：和笔记一样传到 `POST /api/pages/files`（note-files，按套餐的存储上限），保存时由 `claimStoredFiles` 设为使用中。
- **聊天里的图片**：`GET /api/pages/chat-images` 列出本人聊天里（当前显示的分支，`active: true`）的图片附件（发送的照片和 AI 生成的图，新的在前，最多 60 张），`POST /api/pages/chat-images { attachmentId }` 把那一张复制成 note-files 并返回 URL。预览走 `/api/attachments/:id/image`（检查所有者）。
- **AI 生成**：`POST /api/pages/images { prompt, size }`（`1536x1024` / `1024x1024` / `1024x1536`），共用 `WorkspaceImageDialog`（与笔记、白板一致：生成后先展示预览，支持修改描述重新生成或点击插入/替换），和聊天的图片生成一样用 OpenAI `/images/generations`（共用 `src/lib/image-generation.ts`），计一次图片生成次数（失败退回）、先检查存储空间，结果存成 note-files（笔记文件经函数返回，Vercel 的响应上限是 4.5 MB，所以超过 4 MiB 的 PNG 转成 WebP、必要时缩小）。不留在聊天记录里。入口包括工具栏图片菜单、右侧图片检查器与页面 AI 面板的“＋”菜单。
- **举报 AI 图片**：AI 生成的图片元素右键菜单有 “Report image”，发 `POST /api/reports { pageId, elementId, reason }`；服务端在本人未删除的幻灯片里找到这个带 `generated` 的元素，把说明（prompt）和文件路径发到开发者邮箱（`slideImageReportEmail`，`src/lib/answer-report.ts`），和回答的举报共用每日次数。

## 放映

- 全屏一页一页放（`slide-player.tsx`），键位与 PowerPoint / Google 幻灯片相同（`player-keys.ts`）：下一页 → ↓ 空格 PageDown Enter N，上一页 ← ↑ PageUp Backspace P，Home / End，数字 + Enter 跳页，B / . 黑屏，W / , 白屏，Esc 结束（正在输入数字时先清数字）。点击、滑动也能翻页。隐藏的页跳过（从隐藏页开始或按数字跳转时仍显示）。
- **转场动画**：全屏放映（`SlidePlayer`）与公开放映页（`PublicSlidesPlayer`）按目标页的 `transition` 播放淡入或方向感知的滑入动画（首次挂载不播放；`[dir="rtl"]` 下自动镜像滑入方向；系统开启 `prefers-reduced-motion: reduce` 时完全禁用）。
- **笔记一键放映**：普通笔记的“…”菜单提供 **Present**（锁定页面也可放映），不写库、按需动态加载 `src/components/slides/note-present-player.tsx`（常规浏览笔记不拉入幻灯片代码与 CSS）。纯函数 `src/lib/slides/note-to-deck.ts`（`noteToDeck` / `noteToDeckResult`）把 BlockNote 块就地转为临时 `Deck`：优先按 `divider` 分页，其次按顶层 H1 分页，否则封面 + 正文；支持标题（按宽度自适应字号与高度）、列表、引用、Callout、公式（KaTeX）、代码块、表格（展开 `colspan`/`rowspan` 并对 >20 列横向分页）、站内图片、分栏与文件，单页内容超出安全高度时自动拆出续页（标题带 `(2)` 等序号）；超过 500 页上限时在放映顶栏提示并在另存前二次确认。放映顶栏提供 **Save as slide deck**（`POST /api/pages` 建同级 `kind: "slides"` 页面，派发 `notefable:page-created` 后打开新建幻灯片；原生端经 `openPage` 打开）。
- 放映时请求 Wake Lock（屏幕常亮）；触摸设备全屏后尝试锁定横屏（浏览器不支持就算了）。
- **演讲者视图**（桌面）：另开一个窗口，显示当前页、下一页、备注（可调字号）、已用时间和时钟，两个窗口都能用键盘翻页。
- **手机**：竖屏时编辑器是浏览模式（缩略图带在下、设置在底部抽屉）；放映在 App 里交给原生（见下），在手机浏览器里用全屏 + 横屏锁定。

## 导出

全部在浏览器里生成（`src/lib/slides/export-files.ts`），重的库只在导出时加载：modern-screenshot（DOM → 图片）、jsPDF、JSZip、PptxGenJS（都是 MIT）。每页在屏幕外按原尺寸画（`slide-capture.tsx`），等图片、字体、公式就绪后截图。

- **PDF**：一页一张图（16:9）；“带演讲者备注”是 A4 竖版，上面是页图、下面是备注。隐藏页不导出。
- **PNG**：一页一张，两页以上打成 ZIP。隐藏页不导出。
- **PPTX**：文字、形状、线、表格是 PowerPoint / Google 幻灯片里可编辑的对象（主题字体写字体名，没装时 PowerPoint 用替代字体）；图片按框裁切（cover）或缩放（contain）后放入；隐藏页标为隐藏；备注写进备注页。公式写成 TeX 文字（`$…$`），不转成 PowerPoint 公式；幻灯片转场不包含在 PPTX 导出中（网页导出菜单与 Android / iOS “…”菜单均注明）。
- 文件交给 `saveExportFile(blob, name)`（`src/lib/export-file.ts`，白板的导出也用它）：浏览器里是下载（`download`）；App 里分块交给原生保存（`app`，见下）；不能收文件的旧版 App 返回 `unsupported`，编辑器提示 “Update the app to save exported files.”（WebView 处理不了 `blob:` 下载）；超过 64 MiB（`MAX_APP_FILE_BYTES`）不交给 App，返回 `tooLarge`（“This file is too large to save in the app.”）；发送途中失败是 `failed`（“Could not save the file.”）。

## 公开放映链接

沿用笔记的分享（“Share” → 发布到网页，`/s/:token`）。幻灯片是分享树的**叶子**（`leafKind`，`src/lib/note-share-server.ts`）：只公开这套幻灯片本身，下面的子页面永远不公开（分享对话框也不显示“包含子页面”）；作为笔记的子页面时，可以在那个笔记的分享里打开它，但它下面的页面仍然不可达。

公开页面（`PublicSlidesView`）一页一页大图显示、下面是缩略图，可以全屏放映（同样的键位），只读。由于外层 `body` 锁定 `overflow: hidden`，`.public-slides-shell` 在自身 `100dvh` 容器内纵向滚动，矮屏或横屏时也能滑到下方缩略图条。服务端先过 `publicDeck`：去掉隐藏页、演讲者备注以及 AI 图片的 `generated` 和 `pendingImagePrompt` 说明；图片地址改成 `/s/:token/file?…`，该路由对幻灯片只放行公开页面引用的图片（`publicDeckFilePaths`）；公式在服务端用 KaTeX 预先渲染，浏览器不加载 KaTeX。

## 原生应用（Android / iOS）

编辑器就是 `/note-embed?page=<id>` 里的网页编辑器。新增的桥接（`src/lib/native-bridge.ts`）：

| 方向 | 消息 / 方法 | 作用 |
| --- | --- | --- |
| App → 网页（能力） | `NoteFableNative.canPresent()` | 为 true 时，放映交给 App：网页发 `presentation`，不用浏览器全屏 |
| App → 网页（能力） | `NoteFableNative.canSaveFile()` | 为 true 时，导出的文件分块交给 App 保存 |
| 网页 → App | `{ type: "presentation", state: "start" \| "slide" \| "end", index, count }` | start：横屏、全屏（隐藏系统栏）、屏幕常亮、收起原生顶栏；end：恢复 |
| 网页 → App | `fileStart { id, name, mime, size }` → `fileChunk { id, index, data }`（base64，每块原始 512 KiB）→ `fileEnd { id }` / `fileAbort { id }` | App 写入临时文件，结束后让用户选位置保存（和白板共用一条路：Android `ExportFileAssembler` + `ExportFileSaver`，系统“保存到”（SAF CreateDocument）；iOS `ExportFileAssembler`（`ExportFile.swift`）+ `NotesViewModel`，`.fileExporter` 的“存储到文件”）。收 PNG / SVG / PDF / PPTX / ZIP（多页的 PNG），最多 64 MiB，见 [whiteboard.md](whiteboard.md)、[android-native.md](android-native.md)、[ios-native.md](ios-native.md) |
| App → 网页 | `notefableEmbed.slides({ action, index?, format? })` | `present` / `end` / `next` / `previous` / `goto` / `export`（`pdf` / `pdf-notes` / `png` / `pptx`）；App 的“…”菜单（放映、导出）和返回键（放映中先结束放映）用它 |

旧版 App（没有 `canPresent` / `canSaveFile`）：放映只在 WebView 里进行（不横屏、不常亮），导出提示更新 App。

## AI 生成幻灯片

把一个主题、自己的几篇笔记或一段对话做成一套新的幻灯片（#150）。先出大纲，用户改好后再生成整套；生成成功才建页，中途放弃不会留下空白页。模型只写文字，版式和坐标由服务端的纯函数排。下面先是向导和各端入口，再是服务端接口。

### 向导（网页和 App 的 WebView 共用）

`src/components/slides-wizard.tsx`（窗口，`SlidesWizardHost`，画面上只放一个）、`src/lib/slides-wizard-jobs.ts`（状态与请求）、`src/lib/slides-image-jobs.ts`（逐页配图队列）、`src/lib/slides-wizard-draft.ts`（本机草稿）。电脑是小窗，手机宽度（≤639px）全屏；不用 Sparkles 图标。

- **三步**：① 材料和设置（页数、语气、受众、语言、文字处理、**“Generate images for slides”** 开关（默认关）；主题和深浅色收在 “Advanced”）→ “Create outline”；② 可改的大纲（整套标题、每页改名 / 上下移 / 删除 / 增删要点、加页，最多 29 页；有空标题时不能生成；同样可切换逐页配图并在点击生成前按实际内容页数提示最多消耗多少次图片额度）→ “Generate slides”，另有 Back、“Regenerate outline”（总是新请求）；③ 进度 → “Open slides”。①② 都写明聊天额度（以及开启配图时的最大图片额度预览）；“Start over” 丢掉草稿。成功前不建页。
- **逐页配图（`src/lib/slides-image-jobs.ts`）**：开启 `generateImages` 时，整套建成后（1 次聊天额度）按服务端返回的 `imageTasks` 逐页调用 `POST /api/pages/images`（每张计 1 次图片额度）。向导与幻灯片编辑器顶部横幅同步显示进度（已完成数 / 总数、当前页标题）、**Stop**（等当前已发起的这一张保存完再停，避免浪费已扣额度，等待期间显示“Stopping after this slide…”）、**Resume**（续配）与 **Open slides**（随时打开）。每张成功即写回该页（编辑器已挂载时经注册的实时提交写入，避免版本冲突覆盖用户编辑；未挂载时读最新版 `PATCH /api/pages/:id` 并在 409 时重读合并最多重试 3 次，随后派发 `notefable:page-updated` / `pagesChanged`；若期间该页被删除或已手动填图则不计入已生成张数），同时设置 `generated.prompt`（支持单图 Report image）并清除 `pendingImagePrompt`。用户点 Stop、触发 429 `usage_limit`、413 `storage_limit` 或失败时，干净停止并保留已生成的所有图片，显示成功数与剩余数；单端续配前重新读取最新页面，只为仍带 `pendingImagePrompt` 且尚未放图的占位生成，不重复扣费（若多个标签页或设备同时并发点 Resume，客户端互相不可见仍可能重复生成同一页）。编辑器里也可点击 **Dismiss** 清掉剩余未生成的占位提示词。
- **入口决定材料**：聊天来的固定是这段对话；笔记来的固定带这篇笔记（可再加，合计 5 篇，在向导里的选笔记面板上选，列表来自 `GET /api/pages` 里 `kind` 为 note 的页）；“新建幻灯片”来的选一句话主题或笔记，从项目 / 页面行的“+”打开时整套建在那里（deck 请求带 `groupId` / `parentId`；服务端的位置规则见下，选了单篇笔记时它仍排在 `groupId` 前面）。
- **草稿**：`localStorage` 的 `notefable:slides-wizard:v1:<scope>:<入口>`（`scope` 来自 `GET /api/pages/slides/outline`；入口 = `new`、`new:g:<项目>`、`new:p:<页面>`、`note:<页面>`、`chat:<会话>`），存步骤、材料、设置、大纲和未拿到结果的请求；30 天过期，每个用户保留最新 10 份。关闭窗口不丢，整套建成后删除。读写失败（隐私模式等）时只是不跨刷新保存。
- **请求**：每个入口一个状态（idle / working / done / error），关闭窗口请求继续，大纲写进草稿，整套建成派发 `notefable:page-created`（并发 `pagesChanged`）。同一内容（不含 `clientRequestId` 的请求体）还没成功时重试沿用同一个 `clientRequestId`（刷新或 WebView 重建后也是），不自动重发；404 后换新的。材料里有正开着的笔记时先保存，保存不了就不发（“Resolve the note's unsaved changes first, then ask again.”）。400 / 404 / 409 / 413 / 429 显示服务端原句，其余显示 “Could not generate slides. Try again.”。
- **上限**：429 时网页显示 `GuestLimitPrompt` / `UpgradePrompt`（同画成图），413 时显示 `StorageLimitPrompt`；App 里发 `usageLimit`（大纲/整套 `kind: "chat"`，逐页配图 `kind: "image"`）与 `storageLimit`（不带 `pageId`）；草稿与已生成的配图均保留。
- **网页入口**：聊天“＋”菜单 / 抽屉里 Create page 旁的 “Generate slides”（同样的显示和禁用条件）；笔记的 “…” 菜单（含分屏）和笔记 AI 面板常用按钮里 “Draw as diagram” 旁；侧栏“新建”、项目和页面行的“+”、幻灯片分区的“+”（菜单：New slide deck / Generate with AI）、首页和空状态新建卡片下的 “Generate with AI”。

### 在 App 的 WebView 里

同一个向导开在常驻的 `/note-embed` WebView 里（页面开着或只是温着都行），约定见 [notes-flow.md](notes-flow.md#原生应用内嵌编辑器note-embed)：App 调 `notefableEmbed.slidesWizard({ action: "open", source, model? })` 打开、`{ action: "back" }` 返回；网页发 `slidesWizard` 的 `open` / `closed`、`openPage`（Open slides，先于 `closed`）、`pagesChanged`、`usageLimit`、`storageLimit`。笔记 AI 面板里的 “Generate slides” 只对声明了 `canShowSlidesWizard()` 的 App 显示。Android（`SlidesWizardScreen.kt`）与 iOS（`SlidesWizardScreen.swift`）已接入与网页一致的全部入口和常驻 WebView 承载，详见 [android-native.md](android-native.md#ai-生成幻灯片) 与 [ios-native.md](ios-native.md)。

### 服务端


- **形状与上限**（`src/lib/slides/ai-wizard.ts`，画面和服务端共用，不依赖 prisma / DOM）：
  - 来源 `source`：`{ type: "topic", topic }`（1–300 字符，换行并成空格）、`{ type: "notes", pageIds }`（1–5 篇，`MAX_MESSAGE_NOTES`）、`{ type: "chat", sessionId }`。
  - 选项 `options`（省略的项取默认值，值不对返回 400）：`pageCount`（`"auto"` 或含封面的总页数 3–30）、`tone`（auto / professional / casual / academic / persuasive）、`audience`（一行，≤ 200）、`language`（`"auto"`＝跟随材料或主题，或 17 种界面语言代码）、`wording`（condense 精简 / keep 保留原文）、`theme`（8 个主题之一 + light / dark）、`generateImages`（布尔值，默认 `false`）。
  - 大纲 `outline`：`{ title, slides: [{ title, points }] }`，不含封面；1–29 页，标题 1–200，每页最多 12 条要点、每条 ≤ 500（空要点丢弃）。
- **接口**（`runtime = "nodejs"`，`maxDuration = 300`，请求体 ≤ 1 MiB；`model` 经 `normalizeModel`）：
  - `GET /api/pages/slides/outline` → `{ scope }`（`Cache-Control: private, no-store`）：由用户 ID 哈希出的值，向导用它按用户隔离本机草稿（浏览器拿不到用户 ID）。
  - `POST /api/pages/slides/outline` `{ source, options, model?, clientRequestId }` → 200 `{ outline, partial? }`，不建页。
  - `POST /api/pages/slides/deck` `{ source, options, outline, model?, clientRequestId, groupId?, parentId? }` → 201 `{ page, partial?, imageTasks? }`（页面摘要；开启 `generateImages` 且存在待配图页时返回 `imageTasks: [{ slideId, elementId, slideTitle, prompt }]`）；同一 `clientRequestId` 已建过时 200 `{ page, imageTasks? }`（从已保存的 Deck 派生仍待配图的任务，已配好图的不重复返回），该页在 Trash 里则 404 “These slides were moved to the trash.”。
- **材料**（`src/lib/page-ai/one-shot.ts`，不联网搜索）：笔记只读本人、`deletedAt: null`、`kind: "note"` 的页，每次现读，用 `delimitPageContent` 包住（私有数据，不是指令），每篇 20,000、合计 60,000 字符；对话只读本人会话里 `active: true` 的 USER / ASSISTANT 正文和附件文件名（和 Create page 同一套 `buildTranscript`），不读 SYSTEM 与 `providerContext`。缺任一篇笔记或会话返回 404，没有可用文字返回 400，都在扣额度之前。被上限截短时响应带 `partial`。
- **额度**：大纲和整套各扣 1 条聊天额度，任何失败（502 上游 / 超时 / 截断 / 格式不对，503 保存等，父页面或项目不存在的 404）都退还；满额返回 429 `usage_limit`。逐页配图由客户端调用 `POST /api/pages/images` 按张扣图片额度。
- **重试不重复扣费**：整套用由（用户、用途、`clientRequestId`）决定的页面 ID（同画成图）。大纲不建页，用 `UsageCounter` 里的标记行（`src/lib/usage-requests.ts`，见 [database.md](database.md#usagecounter)）：同一 ID 且来源、选项、模型都相同的请求，成功后可免费重跑 3 次（响应丢失时用），仍在生成时返回 409 `request_in_progress`（超过 300 秒视为原请求已中断，可免费接着做）。
- **组装**（`src/lib/slides/ai-build.ts`）：封面（只有标题）+ 大纲每页单独走 `noteToDeckResult`（和笔记放映同一套排版，放不下时续页“(2)”，续页可能让总页数超过 30，但不超过 `MAX_SLIDES`）；若该页带 `imagePrompt`，首张采用左文右图 `imageText` 版式并放一个带 `pendingImagePrompt` 的空图片占位（续页不重复放图）；不加 `section`；图片、分割线、目录丢弃，正文一级标题降为三级；演讲备注放在该页的第一张。建页走 `createCanvasPage`（`ai: true`，所以有 Report AI content）。位置：`parentId`，否则来源是单篇笔记时作为它的子页面，否则 `groupId` 项目，否则最上层。

## 与其他功能的接口

- **白板（#152）**：`src/lib/slides/whiteboard-embed.tsx`。白板端调用 `registerWhiteboardFrameProvider({ renderPicker })` 注册“选框并转成图片”的组件后，幻灯片工具栏才出现“白板框”按钮；选中的框由白板端上传成 note-files 后通过 `onPick({ pageId, frameId, frameName, src, width, height })` 交回，幻灯片里放的是那一刻的静态图（`whiteboard` 元素）。没注册时不显示按钮。
- **AI（#150 / #158）**：编辑器在选择变化时发 `notefable:slides-selection`（`{ pageId, slideIds, elementIds }`），并通过 `CanvasEditorProps.onSelectionChange` 把选中的元素或总览多选页实时同步到 `PageAssistant`（点右下角 AI 按钮或在已展开的面板里提问也会自动附带选区，且不抢画布焦点）；同时接入 `CanvasEditorProps.onAskAi`（工具栏、右侧检查器顶部统一的 **Ask NoteFable** 入口（置于锁页禁用的 `<fieldset>` 外以便锁页可问）及元素 / 幻灯片右键菜单）。`slidesContextText(deck, selection, options?)` 把所选页 / 元素变成给 AI 看的文字（仅选中整页或显式 `includeNotes: true` 时附带演讲备注；仅选中个别元素时不自动带入整页备注），`slidesSelectionIds(deck, selection)` 生成与 `read_note` 对齐的稳定 ID。模型支持看图时，通过 `slide-capture.tsx` + `captureSlideSelectionPng` 导出当前选中页或选中元素外接区域的浅色/主题 PNG（长边 ≤ 1568 px）随对话上传，失败时降级发纯文字并轻提示。`GenerateImageDialog` 遇到 429 `usage_limit` 时保留已输入的描述词（并在登录 / 升级跳转间用 `pending-draft` 暂存）：网页端显示 `GuestLimitPrompt` / `UpgradePrompt`，`/note-embed` 优先发 `usageLimit` 交由原生处理。编辑器的 `aiSlot` 属性（`ReactNode`，`CanvasEditorProps.aiSlot`）放在单页编辑画面的右下（`.slides-ai-slot`）：#158 的 AI 按钮没被拖动过时就放在这里（`NotesWorkspace` 放一个看不见的目印，`PageAssistant` 的 `anchor`），重叠顺序和这个位置一样（z-index 5），所以手机的设置面板和菜单会盖住它。
  - **AI 编辑与整套换风格（`src/lib/page-ai/slides-adapter.ts`、`src/lib/slides/ai-edit.ts`）**：`propose_slides_create` 与 `propose_slides_edit` 均无像素坐标参数，严格按 `read_note` 返回的稳定 `slide.id` 定位（不按页码），由服务端确定性排版、校验并走提案卡片的改前/改后版本化可视化预览（支持自动应用与一键 Undo，写入前留 `AI_EDIT` 历史）。支持 `update_slide`（保留既有图片/白板框与装饰）、`set_layout`、`split_slide`、`merge_slides`、`add_slide`、`delete_slides`、`reorder_slides` 与 `restyle_deck`。`restyle_deck` 只改 8 套内置主题、深浅色与每页版式，服务端通过 `assertDeckTextPreserved` 强制校验 100% 保留全部文字、公式、代码、表格、演讲备注、章名与媒体（含 `pendingImagePrompt`），任何改动即拒绝。面板提供整套快捷按钮（Restyle deck / Summarize / Suggest improvements）与单页/多页选区快捷按钮（Rewrite / Make it shorter / Expand / Change tone / Write speaker notes / Split into two slides / Merge slides）。`SlidesEditor` 通过 `registerCanvasFlusher` 挂接共享冲刷机制，在应用/撤销提案或切页前冲刷待保存更改并等待进行中的图片上传完成。

## 已知限制

- PPTX 里的公式是 TeX 文字；表格单元格是纯文字（不支持单元格内的格式）；幻灯片转场不包含在 PPTX 导出中。
- 白板框只有接口，白板端注册之前不显示入口。
- iOS 的横屏放映、文件保存和常亮只做了编译检查（Linux 容器里的 `swift test` 和 macOS 的 PR 检查），没在真机 / 模拟器上验证（[ios-native.md](ios-native.md)）。
