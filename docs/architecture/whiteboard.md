# 白板（Whiteboard）

工作区的第二种页面类型（`NotePage.kind = "whiteboard"`，#152）：打开就是全屏的无限画布，可以自由地画、摆、连。数据怎么存、怎么校验、历史怎么留见 [notes-flow.md](notes-flow.md) 的“页面类型”；这里写编辑器和它周边的做法。

## 引擎：Excalidraw 开发版快照

- 用 MIT 授权的 `@excalidraw/excalidraw`，**版本钉死**在 `package.json` 的 `0.18.0-2c3dcc0`（2026-11-21 的开发版快照，`npm install --save-exact`）。选它是因为稳定版 0.18.1 没有便签、小地图和可替换的界面；动手前实测过这个快照有 `stickynote` 工具、小地图、`ui` / `activeTool` 属性、手写笔压感（`strokeOptions.variability`）和 `exportScene`（含按框导出）。开发版的 API 还会变：**升级前要重测**下面“依赖内部的地方”。
- 动态加载、不做 SSR：`src/components/canvas-editors.tsx` 的 `CANVAS_EDITORS.whiteboard` 用 `next/dynamic` 加载 `src/components/whiteboard/whiteboard-canvas.tsx` → `whiteboard-editor.tsx`。Excalidraw（JS 约 1 MB、CSS 约 200 KB）只在打开白板时下载，`/`、`/app`、`/note-embed` 的静态页面不受影响。编辑历史的版本图（`whiteboard-thumbnail.tsx`）和公开页的只读视图（`public-whiteboard-canvas.tsx`）也各自动态加载。
- **字体自托管。** `scripts/copy-whiteboard-assets.mjs`（`npm run dev` / `npm run build` 前的 `predev` / `prebuild`）把 Excalidraw 的图形字体（`dist/prod/fonts`，约 14 MB，其中中日韩手写字体 Xiaolai 按字符范围分成 209 个小文件，用到才下载）和 pdf.js 的 worker（legacy 版：iOS 17.0〜17.3 的 WKWebView 没有 `Promise.withResolvers`）、pdf.js 按需读取的 CMap（CJK 字体）/ 标准字体 / wasm（JPEG 2000 等）/ ICC 写到 `public/whiteboard/`（`pdfjs/`；不进仓库）；编辑器设 `window.EXCALIDRAW_ASSET_PATH = "/whiteboard/"`。Excalidraw 在我们的地址读不到时会再试 esm.sh，正常部署不会走到。界面用的 Assistant 字体随 CSS 一起打包。
- **线条默认“整洁”。** 新图形的默认值是 `roughness 0`、字体 Nunito（`CLEAN_DEFAULTS`）。Nunito 没有中日韩字形，中日韩文字落到系统字体，三端显示会有差异；需要统一时可以在样式面板里换成手写风（Excalifont + Xiaolai，自托管）。
- **界面语言。** Excalidraw 自带的界面全部关掉（`ui={false}`），工具栏和面板是我们自己的（`whiteboard-ui.tsx`、`whiteboard-style-panel.tsx`），文案走 `useT()`，17 种语言。Excalidraw 只剩少量自带文字（框的默认名等），`langCode` 按我们的语言映射（`excalidraw-locale.ts`，Excalidraw 没有的语言用英文）。Excalidraw 每次设语言都会改 `<html lang/dir>`，`useKeepDocumentLanguage` 用 MutationObserver 立刻改回 NoteFable 的设置（RTL 的阿拉伯语也保持 `dir="rtl"`）。

### 依赖内部的地方（升级时重测）

- `src/lib/whiteboard/excalidraw-bridge.ts`：公开 API 没有执行内置操作的入口。我们注册一个只用于“拿到编辑器本体”的操作（`keyTest` 总是返回 false），在容器里派发一次不存在的按键，从 `keyTest` 的参数拿到 App，之后用 `actionManager.executeAction` 按名字执行内置操作（对齐、等距分布、组合、层级、线色 / 背景 / 粗细 / 线型 / 字体 / 字号 / 对齐 / 不透明度 / 箭头、撤销重做、缩放、网格、吸附、锁定、复制、删除、翻转）。这样撤销历史、绑在形状上的文字和连接线都由 Excalidraw 自己处理。
- 动作的参数格式（`changeStrokeColor` 的 `{ color }`、`changeStrokeWidth` 的 `thin` / `medium` / `bold`、`changeArrowhead` 的 `{ position, type }` 等）和 `appState` 的字段名（`currentItemStrokeWidthKey`、`currentItemStrokeVariability` 等）。
- 荧光笔用手写线的 `extraBold` 宽度键（类型里没有，运行时有）。
- 抓手的光标：Excalidraw 把 `cursor: grab` / `grabbing` 直接写在 `canvas.interactive` 的 style 上，`whiteboard.css` 按这个属性换成我们画的手（改了写法就会退回浏览器自带的白手）。

## 编辑器

- **工具**：选择、套索、抓手、画笔（压感，`variability: variable`）、荧光笔（同是手写线，默认黄色、不透明度 40%、更粗）、激光笔、橡皮、矩形 / 菱形 / 椭圆、线、箭头（绑在形状上的箭头随形状移动；直线 / 曲线 / 折线）、文字、便签（Excalidraw 的 `stickynote`）、图片、框（Frame）。切换工具用 `api.setActiveTool`（不用强制的 `activeTool` 属性：那会让形状画完不回到选择、也不选中新形状）。画笔、荧光笔和其他图形各自记住颜色、粗细、不透明度，切换时互换（`switchStyle`），所以荧光笔的黄色不会染到矩形上。工具栏上各工具的单键快捷键（V 选择、H 抓手、P 画笔、K 激光笔、E 橡皮、R / D / O 形状、L 线、A 箭头、T 文字、N 便签、9 图片、F 框）照常有效，键盘切换工具时同样换色组。Excalidraw 还有几个我们没放在工具栏上的单键（例如 B 的油漆桶、Shift+X），按了会切到那个工具，工具栏上没有选中项；点工具栏的工具或按 Esc 回来。抓手的光标是自己画的（`whiteboard.css`：和工具栏一样的手，深色线条加白色描边，悬停张开、拖动握住）：Excalidraw 用 CSS 的 `grab` / `grabbing`，浏览器自带的是只有 1 像素黑边的白手，在浅色画布上几乎看不见，也不跟随 Windows 的指针颜色设置。其他工具的光标（系统的箭头 / 十字、Excalidraw 按主题换色的橡皮和激光笔）浅色、深色下都看得见。
- **样式面板**（选中元素或拿着绘图工具时出现）：线色、背景 / 便签色（5 个常用色 + 调色板 + 色号）、粗细、压感、填充、线型、风格（整洁 / 手写 / 草图）、边角、箭头类型和两端、字体 / 字号 / 对齐、不透明度、层级、对齐与等距（多选时）、组合 / 取消组合、复制、翻转、链接、锁定、删除。深色模式下色块按 Excalidraw 的深色滤镜显示（`applyDarkModeFilter`），和画布上看到的一致；导出时一律是浅色。
- **画布**：撤销重做、缩放、适应屏幕、小地图（自己画的：内容缩略图 + 视野框，点或拖跳到那里；元素超过 2,500 个时只画外框）、“回到内容”（视野里没有内容时出现；画布大小变了也重新判断，大小还是 0 时不判断。第一次打开时画布大小还是 0——看不见的框、后来才有大小的 App WebView——就等有了大小再缩放到内容或跳到检索结果）、网格、对象吸附、手写笔专用（检测到手写笔后可选，手指只拖动）、画布底色。每个设备记住每块白板的视野（`localStorage` 的 `notefable:whiteboard-viewport:v1:<id>`），小地图开关记在 `notefable:whiteboard-minimap:v1`。
- **标题和图标**在左上角的小条里改（和笔记一样走自动保存）。
- **锁定**（页面设置的 Lock）：Excalidraw 的 `viewModeEnabled`，只能看、拖动、缩放、导出。
- **锁定的元素**（样式面板的锁、导入 PDF 的页面图片）：点它时 Excalidraw 只记下 `activeLockedId`（解除的小窗只在它自己的界面里），我们在画布上方显示 “Unlock” 按钮，解除后选中它（是组就整组）。
- **布局**按画布宽度（不是窗口宽度）：撤销 / 缩放在右上（菜单旁），工具栏在下方中间；宽度 < 1010px 时小地图移到工具栏上方；< 640px（手机、App）时工具栏靠左、右下角留给页面 AI 面板的按钮（`.whiteboard-ai-slot`，#158）；640–719px 且有这个按钮时，工具栏不居中，靠到按钮左边（`is-tight`），样式面板变成底部的一条，可以展开。

## 保存

- 走笔记同一个保存队列（`NoteSaveQueue`，#169 的 `canvas-save.ts`）：编辑器在内容变化 400ms 后（画线、拖动途中不算）把场景转成保存用的形（`sceneToStored`，`src/lib/whiteboard/scene.ts`）交给队列，队列再按一秒防抖 `PATCH { title, icon, data, version }`。只改视野、选择不会保存。关闭编辑器（换页）、页面被隐藏（`visibilitychange` / `pagehide`）、App 关闭编辑页前的 `notefableEmbed.flush()` 时，不等 400ms，立刻把还没交出去的变化交给队列（`src/lib/canvas-flush.ts` 的 `registerCanvasFlusher`；App 的 flush 还会等上传中的图片最多 10 秒）。
- 打开时 Excalidraw 读完内容（`onInitialize`）才记下“已保存”的样子；读的过程中的变化不算编辑（打开不会多出版本）。编辑器关掉后不再用 Excalidraw 的 API（它把内容清空但 `isDestroyed` 仍是 false），之后完成的上传用最后一次收到的场景补进保存。最新的版本 / 版本恢复替换了内容（`NoteSaveQueue.generation` 变了）以后，之前的编辑器关掉时交来的旧变化丢弃。
- 保存的形和 Excalidraw 的 scene 同构：`{ elements, files?, appState? }`。只存 NoteFable 的工具能做出的元素种类（`WHITEBOARD_ELEMENT_TYPES`：矩形、菱形、椭圆、箭头、线、手写、文字、图片、框、便签），Excalidraw 的嵌入（`embeddable`、`iframe`）和 AI 框（`magicframe`）不存、不读，服务端也拒绝；编辑器和公开页都关掉嵌入（`validateEmbeddable={false}`，贴网址只会变成链接）。删掉的元素不存（撤销历史只在打开的页面内存里），坐标保留两位小数，`appState` 只存底色、网格、吸附。
- **图片**：Excalidraw 把贴进来 / 拖进来 / 用图片工具插入的图片放成 `data:` URL。编辑器把它们上传到 `POST /api/pages/files`（SVG 等先转成 PNG），`files[id].dataURL` 存成 `/api/pages/files?key=…` 的地址；上传完成前这个图片元素（和绑在上面的文字）不进保存。上传因存储空间不够被拒时（413 `storage_limit`）删掉这张图，由工作区画面的存储提示说明；其他失败在画布上提示。关闭编辑器后才上传完的图片，也会用最后的场景补进保存。既不是 `data:` 也不是自己的 note-files 地址的图片（例如从公开链接的视图复制来的），读得到就同样上传，读不到就删掉并提示。单张图片上限沿用 4 MiB（Excalidraw 先把长边缩到 2560px）。此外，工具栏图片菜单、更多工具菜单、右上选项菜单与页面 AI 面板的“＋”菜单均提供 **AI 生成图片**（共用 `WorkspaceImageDialog` 与 `POST /api/pages/images`）：生成后先在对话框预览，点击插入后按自然比例缩放（长边 ≤ 560，见 `fitWhiteboardImageSize`）直接放置在当前视野中央并选中，并在元素上写入 `customData.generated = { prompt }`（`sceneToStored` 清洗并限长 4,000 字符，公开分享由 `publicWhiteboardScene` 剥离），立即进入自动保存。
- **草图变图片与 AI 图片举报（WA3 + F4）**：在可编辑白板上选中任意元素后，左侧样式面板（桌面展开与手机折叠条）提供 **“变成图片（Turn into image）”** 入口（遵循 D8，不在画布顶部增加浮动条、不使用 Sparkles 图标）：点击后经 `exportWhiteboardSelectionPng` 仅将当前选区导出为浅色纯白底 PNG，并在 `WorkspaceImageDialog` 的草图模式中展示选区缩略图、可选描述输入与自动匹配草图比例的尺寸选择，经 `POST /api/pages/images`（`multipart/form-data` 的 `referenceImage` 走 OpenAI `/images/edits`，参考草图不落盘）生成预览；点击插入后保留原草图不动，由 `placeSketchGeneratedImage`（`src/lib/whiteboard/sketch-to-image.ts`）按比例缩放并排放在原选区右侧，同样写入 `customData.generated = { prompt }` 并自动保存。选中单个带 `customData.generated` 的 AI 图片元素时（包括锁定的元素，以及在锁定/只读白板上点击该图片），左侧属性面板显示 **“举报图片（Report image）”**，经 `WhiteboardReportImageDialog` 调用 `POST /api/reports`（`{ pageId, elementId, reason }`，与幻灯片共用每日举报额度，服务端核验归属、非回收站、元素标记与 `files[fileId].dataURL` 所有权）。
- **大小**：整份本体最多 2 MB（服务端上限）。超过 95% 时，保存前用 Ramer–Douglas–Peucker 逐级精简手写线的点（`fitStoredWhiteboard`，平时不精简，以免改变按速度变化的线宽）；仍然超过就由服务端返回 413，提示在画布上方的保存提示里。

## 链接与页面卡片

- 选中图形 → “添加链接”：选自己的页面（笔记 / 白板 / 幻灯片）或输入网址（只收 http、https、mailto）。页面链接存成 `/app?view=pages&page=<id>`，和笔记正文里的页面链接同形。
- 点链接图标（没选中时画在图形右上）或面板的“打开链接”：页面链接在原地打开（网页切换页面，App 里发 `openPage`），按 Ctrl / ⌘ / Shift 时新窗口打开；外部链接新标签页打开。
- “链接到页面”放一张**页面卡片**：圆角矩形 + 文字“图标 标题”，`link` 指向那一页，`customData.notefablePage = { id, kind }`。卡片的文字在放置时写入（之后改了页面标题不会自动更新），图片图标显示成类型符号。卡片文字也进搜索。
- **还没做**（#152 里举的例子，另开 PR）：公式标签（KaTeX）、带内容预览的页面卡片（现在卡片显示标题和图标）。

## 导入 PDF 与导出

- **导入 PDF**（菜单或“更多工具”）：pdf.js（`pdfjs-dist`，Apache-2.0）在浏览器里逐页渲染成 JPEG（长边最多 2000px、约 350 万像素，超过 4 MiB 再压），逐页上传，每页放进一个框（“文件名 · 页码”），图片锁定以便直接在上面批注。最多 50 页、文件最多 50 MB；为了手机内存，一次只渲染一页、渲染完立刻释放画布。中途某一页失败（存储空间不够、网络）时，已经上传的页照样放进白板，并提示“只导入了前 N 页”。
- **导出**：PNG（2 倍，像素上限 1600 万）、SVG（图片内嵌成 data URL、字体内嵌）、PDF（每个有内容的框一页，按从上到下、从左到右排；不在任何框里的内容放在最后一页，空框跳过；没有框、或者只有空框时整块一页。`planPdfPages` 在 `export-utils.ts`，框的内容和 Excalidraw 的按框导出一致：框的子元素和与框重叠的散元素；只有一部分压在框上的散元素两页都有，不会被裁掉；图形和箭头里的文字跟着它的图形 / 箭头走；箭头不会被框裁掉（Excalidraw 的 `isFrameClippable`），所以从框里画出框外的箭头也会完整地出现在最后一页；只碰到框边的元素不算重叠（和 Excalidraw 的 `doBoundsIntersect` 一样，压在框边上的直线放进最后一页）；框被删掉后留下 `frameId` 的元素也放进最后一页；外接矩形碰到了框、实际却没画进去时，画出来只有画布底色的那页框也跳过，按画布颜色判断）。导出总是整块白板（选中的部分不影响），一律浅色。PDF 由自写的小写入器生成（`pdf-writer.ts`，每页一张图，可逆的 Flate，不支持时用 JPEG；照片、导入的 PDF 这类 Flate 超过 2 MiB 且 JPEG 不到一半时改用 JPEG），没有新增依赖。文件交给 `saveExportFile`（`src/lib/export-file.ts`）：浏览器里下载；App 里分块交给原生保存（见下）。

## 搜索、历史、公开链接

- **搜索**：白板的文字（元素的文字、框名）由服务端存进 `NoteCanvas.segments`，命中的 `blockId` 是元素 ID。网页打开结果后 `requestWhiteboardReveal` 把请求交给编辑器（编辑器是动态加载的，用 `src/lib/whiteboard/reveal.ts` 暂存，15 秒内有效），编辑器把视野移到该元素并选中。App 里用 `/note-embed?page=<id>&reveal=<id>`（笔记的块同样适用）。
- **历史**：预览用 `exportScene` 画出那一版（SVG），下面列出文字；恢复走服务端原有的流程，打开的编辑器以新内容重新挂载。
- **公开链接**：`PAGE_KIND_FEATURES.whiteboard.publicShare = true`。`/s/:token`（和 `/s/:token/p/:id`）对白板显示和笔记相同的顶栏 + 只读画布（`viewModeEnabled`，可缩放、平移，右下有缩放按钮）；本体由 `GET /s/:token/scene?page=` 读取（`no-store`、`noindex`），图片地址换成 `/s/:token/file?page=&key=`，而 `/s/:token/file` 对白板只放行还活着的图片元素用到的文件（`whiteboardFileKeys`，和 scene 用同一份：删掉的图片、没人用的文件、同一个文件的第二个地址都不放行）；公开的 scene 里元素的 `customData` 只留页面卡片的标记。公开页里的页面链接按同一个公开链接的子页面打开（不在公开树里就显示“无法显示”）。

## App（`/note-embed`）

- 白板和笔记一样在 `/note-embed?page=<id>` 里打开，桥接照旧（`ready` 带 `kind`）。触屏上默认是抓手（单指拖动），切到画笔后单指画、双指缩放平移。
- 用绘图工具（抓手以外）时发 `{type:"drawing", active}`，App 据此在屏幕两侧各排除 200dp 高的系统返回手势（Android 每条边的上限；宽至少 32dp，系统的返回手势区更宽时按它）；白板页上 App 的侧栏滑动和 iOS 的边缘返回都关闭（只用顶栏的返回）。
- 导出文件：App 声明 `canSaveFile()` 时，网页发 `fileStart {id, name, mime, size}` → `fileChunk {id, index, data}`（base64，每块原始 512 KiB）×n → `fileEnd {id}`（中途失败发 `fileAbort`），App 写临时文件后让用户选保存位置。旧版 App 提示“请更新应用”。超过 App 能收的 64 MiB（`MAX_APP_FILE_BYTES`，和两端的 `ExportFileAssembler` 一致）时不发送，提示文件太大。各端的实现见 [android-native.md](android-native.md)、[ios-native.md](ios-native.md)。

## 画成图（AI 把回答或笔记画成可编辑的图，#153）

入口、额度和请求见 [chat-flow.md](chat-flow.md#画成图draw-as-diagram)；这里写图怎么变成白板的元素。

- **全部在服务端转换，一次建页。** 模型只写 Mermaid（`src/lib/whiteboard/diagram.ts` 的 `DIAGRAM_INSTRUCTIONS`），坐标由程序算，转换成功后才用 `createCanvasPage` 建页（白板正文里不存“待转换”的状态），所以网页和 App 打开的是同一份内容。
- **8 种图走 Mermaid 转换器。** 流程图、时序图、状态图、类图、ER 图、时间线、甘特图、象限图由 MIT 授权的 `@excalidraw/mermaid-to-excalidraw`（`3.6.0`，用不依赖 DOM 的 Pele 排版，不依赖 `mermaid` 包）转成形状和箭头的草稿，再由 `@excalidraw/element`（和编辑器同一个钉死的快照版本）的 `convertToExcalidrawElements` 变成真正的元素：形状里的文字是绑在形状上的 `text`（`containerId`），箭头两端用 `startBinding` / `endBinding` 绑在形状上（拖动形状时箭头跟着走）。然后统一成“整洁”的样式（`roughness: 0`、字体 Nunito），只留 http / https / mailto 的链接，去掉会被保存校验拒绝的字符（NUL、单独的代理对、以 `data:` 开头的文字），经 `sceneToStored` 变成保存的形。
- **服务端的最小“浏览器”。** 这两个包要用 `DOMParser`（读 Pele 画出的 SVG）、canvas 量字宽、`textarea` 还原字符实体，`@excalidraw/element` 还会读 `window`。`src/lib/whiteboard/server-dom.ts` 在 `globalThis` 上放只读的 `document` / `window` / `DOMParser`，**只在转换的异步流程里（`AsyncLocalStorage`）有值**，其他请求和代码看到的仍是 `undefined`（`typeof document === "undefined"` 不变）；`DOMParser` 来自 `linkedom`（ISC），量字宽用 `text-measure.ts` 的估算（中日韩、全角和表情 1em，其他 0.6em，偏宽，不会挤出形状）。`@excalidraw/element` 的字宽也设成同一个估算（`setCustomTextMetricsProvider`）。
- **转不了的图让模型重写一次。** 只能变成图片的类型（饼图等，转换器会退回一张 SVG 图片，白板也不收内嵌图片）、语法错误、超过 3,000 个元素，都抛 `DiagramSourceError`，路由把错误交给模型重写一次（同一次额度）；还不行就退还额度，返回 Mermaid 原文让用户复制。
- **思维导图用自己的引擎**（`src/lib/whiteboard/mindmap/`，纯 TS，服务端和浏览器共用，下面的思维导图模式和学习模板也用它）：Mermaid 的 `mindmap` 转换器只会给一张图片，所以 `parse.ts` 自己读缩进和节点形状（`root((…))`、`[…]`、`(…)` 等；`::icon`、`:::class`、`%%` 注释跳过；根之后同级的节点当作根的子节点），`model.ts` 限制最多 400 个节点、10 层、每个节点 200 字（宽度优先保留，超出的整枝丢掉并标记 `partial`），`layout.ts` 做确定性的排版（同一棵树在服务端和浏览器排出一样的位置：文字用估算宽度折行，节点是圆角矩形，子节点在父节点外侧竖排、父节点在子节点的竖直中央；根的子节点 ≥ 4 个时左右分开，按高度从上往下切成两半），`elements.ts` 生成元素草稿：节点是带文字的圆角矩形（根和第一层填色、更深只描边，第一层按枝换色；手动新增的第一层节点取用得最少的颜色，折叠着的分支也算在内），父子之间是没有箭头的 S 形箭头线，两端绑在节点上。
- **思维导图的标记**放在元素的 `customData.notefableMindmap`：节点 `{ v: 1, role: "node", tree, parent, order, direction?, collapsed? }`（`tree` 是根节点的元素 ID，`parent` 是父节点的元素 ID，根为 null；`order` 是兄弟里的顺序；`direction` 只在根上：`right` / `both`），连线 `{ v: 1, role: "edge", tree, parent, child }`。所以生成元素时不重新生成 ID（`regenerateIds: false`）。公开链接的 scene 照旧去掉 `customData`（只留页面卡片的标记）。折叠不能用 `isDeleted`（保存时会被删掉），做法见下面的“思维导图模式”。

## 思维导图模式与学习模板（#154 WE1 / WE2）

- **同一套树引擎**：画成图的思维导图、手动的思维导图和学习模板里的思维导图都用 `src/lib/whiteboard/mindmap/`（纯 TS，有测试）。`editing.ts` 读白板上的树（`readMindmapTrees`：按 `customData.notefableMindmap` 的 `parent` / `order` 还原；父节点找不到或成环的节点当作独立的根），每个操作返回要改的元素（`patches`）、新加的元素草稿（`added`）和展开时放回的元素（`restored`）；`composeMindmapScene` 把它们连同受影响的树的重新排版（`relayoutMindmaps`：根不动，按节点现在的大小排，补上缺的连线、删掉两端不全的连线；有新连线时再排一遍，让线在同一步里就绑到两端节点上）和连线绑定（`bindMindmapEdges`：连线两端节点的 `boundElements` 记上这条线，拖动节点时线跟着走）算成下一个场景，编辑器的 `applyMindmapChange`（`whiteboard-mindmap.tsx`）用**一次** `updateScene` 写入，所以每个结构操作撤销一次就回去。新节点在同一步里就按文字编辑结束时的大小（`fitMindmapNodeToText`）建好，所以加完不打字直接结束编辑不会再多一条撤销记录。展开时放回的元素版本号要比折叠时删掉的那份高（撤销记录只认版本升高的元素）。按很多 ID 查节点时用一次建好的 `mindmapFinder`（上万元素的白板逐个扫会卡住）。
- **操作**：选中一个节点后，节点上方浮出小按钮（加子节点、加同级、折叠），左侧属性栏多一组“思维导图”（同样的按钮 + 分支方向：只在右侧 / 两侧，作用于整棵树）。键盘：Tab 加子节点、Enter 加同级（根上是加子节点）、F2 编辑文字、Delete / Backspace 连子孙一起删（选中的只有思维导图的节点、节点文字和连线时；混着别的图形就交给 Excalidraw 的删除，剩下的子孙和连线由下面的“删除节点”清掉）。按住 Delete / Backspace 的键盘连发只接住、不再删（删完会选中父节点，连发会一路删到根）。这些键在 Excalidraw 之前接住（容器上的捕获阶段监听；Excalidraw 的 Tab 是切换图形种类，Enter 是编辑文字）。新节点的文字是“新主题”，加完立刻进入编辑并全选（直接打字就替换），开始编辑走 Excalidraw 内部的 `App.text.startTextEditing`（`excalidraw-bridge.ts` 的 `editText`，升级时重测）。
- **删除节点**：不管怎么删（Delete 键、属性栏的删除按钮、和别的图形一起删、Ctrl+X、橡皮），节点的子孙、它们的文字和连线都跟着删，并且和这次删除是**同一条撤销记录**；用户自己的其他图形不动，用户画的、绑在被删节点上的箭头解绑（图形留下）。子节点的新增（Enter / Tab）按现有最大的 `order` 排，删除后留下的序号空隙不会让新节点排到上面。思维导图自己的删除走 `deleteMindmapNodes`；Excalidraw 自己的删除只删选中的元素，编辑器在每次场景变化时用 `api.onStateChange`（总是为真的 `predicate`，同样在记撤销之前）比较“上次还在的节点”和现在，有节点没了而子孙或连线还在就补删并重排（`mindmapRemovalCleanup`；折叠、撤销、重做里子孙和连线是一起消失的，所以什么都不做。依赖 Excalidraw 的这个调用顺序，升级时在浏览器里重测橡皮和混合删除后按一次撤销）。剪切之前（容器上捕获 Ctrl / ⌘+X 和 `cut` 事件）先把子孙和它们之间的连线一起选上（`mindmapCutExtras`），所以剪贴板里是整个分支，粘贴就是移动。复制（Ctrl+C）仍只复制选中的元素。
- **锁定的元素**：删除时锁定的节点不删，它和它下面的分支留下；父节点被删时，它成为一棵新思维导图的根（位置不动）。节点文字和连线（包括连线上的文字）跟着节点走（没有节点的文字、连线留不下来）。只选中锁定节点时按 Delete 什么都不删。要隐藏的内容（子孙节点、节点文字、连线）里只要有锁定的元素，这个节点就不能折叠（不显示折叠按钮）：只折一部分会把父子关系拆开。自动排版目前不看锁定状态，锁定节点所在的树重排时它仍可能被移动。
- **自动排版的时机**：结构操作之后；拖动或改大小结束时（拖动的单个非根节点的中心落在另一个节点上，就改挂到那个节点下面，不能挂到自己或自己的子孙下面；落在空白处就弹回原位；拖动根节点时整棵树跟着过去）；节点文字编辑结束时（节点宽度按文字重新算，和画成图用同一个估算 `mindmapNodeBox`，折行和高度用 Excalidraw 自己的测量，再重排整棵树）。排版后的位置不变时不动场景，不多出撤销记录。拖动、改大小、文字编辑这三种结束后的改挂和重排**和操作本身是同一条撤销记录**：编辑器用 `api.onStateChange`（`selectedElementsAreBeingDragged` / `isResizing` / `editingTextElement`）监听结束，它在 Excalidraw 的 `componentDidUpdate` 里、记撤销（`store.commit`）之前同步调用，场景在这里改且 `updateScene` 不带 `captureUpdate`。改到 `onChange` 或微任务里就会变成两条记录。这个调用顺序是 Excalidraw 内部行为，升级时在浏览器里重测（拖动改挂后按一次撤销应完全复原）。
- **框（frame）**：重排时整棵树的框归属跟着根节点（Excalidraw 把框成员裁在框里，超出的部分看不见）。节点完全装得进根所在的框才是成员，装不下的移出框；节点文字跟节点，连线只有两端归属相同时才跟着进框，连线文字跟连线。别的框的 `frameId` 一律不留（拖到别的框上又弹回的节点、展开时放回的旧存货也一样）。只有归属不对、位置没变时也会改。根自己的归属由 Excalidraw 决定。
- **折叠**不用 `isDeleted`（保存时会丢掉）：子孙（节点、节点文字、连线和连线上的文字）从白板上拿掉，原样存进被折叠节点的 `customData.notefableMindmap.stash`，展开时用同样的 ID 放回（只放回白板能存的元素种类）；嵌套折叠时内层的存货平铺进外层，不嵌套。存货不算在服务端的 20,000 个元素上限里，所以展开（点“+N”、给折叠节点加子节点、拖到折叠节点上改挂）之前先算展开后的元素数（`exceedsWhiteboardLimit`），超过就不展开、在画布上方提示（拖动的节点弹回原位），免得之后每次保存都被拒。因为不在白板上，折叠的分支不会出现在导出、小地图和公开链接里（公开的 scene 本来就去掉 `customData`，测试覆盖）；它们的文字照样进搜索和 AI 读取（算在被折叠的节点上；搜索用的文字超过单段 8,000 字符时分成同一 ID 的多段，节点自己的文字排在最前）：页面 AI 读整板时（`canvas-adapter.ts`）和选区问 AI 时（`selection-capture.ts`），在被折叠节点下按层级缩进列出（`mindmapStashOutline`，缩进最多 8 层：`mindmapIndent`），分别受读取上限 `MAX_READ_CHARS` 和引用上限 `MAX_QUOTE_CHARS` 限制。白板上被折叠的节点外侧显示“+N”（隐藏的主题数），点它展开；锁定的白板只显示不能点。
  - 已知限制：用户自己画的、连到被折叠节点上的箭头不在存货里。折叠状态下保存并重新打开过的白板上，Excalidraw 会解掉指向不存在元素的绑定，之后展开节点，这些箭头仍是未绑定的，需要手动重新连。
- **复制**（Ctrl+D、Alt 拖动、粘贴）：Excalidraw 的 `onDuplicate` 里改写副本的标记（`remapMindmapDuplicateScene`）。Excalidraw 用 `onDuplicate` 返回的数组拼下一个场景（没返回的元素会消失），所以必须返回完整的 `nextElements`，只改其中的思维导图副本。改写规则：父节点一起复制的节点挂到新的父节点下，没带父节点的成为新树的根；两端都复制了的连线才保留标记。被折叠节点的存货**跟着副本走**（剪切再粘贴是移动，丢掉存货就等于丢掉整个分支），存货里每个元素都换新 ID，彼此的引用（文字所属、连线绑定、父子标记、分组）一起改写，所以复制、跨白板粘贴、连续粘贴都不会出现重复 ID。
- **学习模板**（`src/lib/whiteboard/templates.ts`，纯函数，文字由编辑器按当前语言传入，17 种语言）：思维导图、康奈尔笔记、时间线、韦恩图、对比表。思维导图之外的模板放在一个框里（框名是模板名），整体可以拖。入口：空白板中央的“从模板开始”（画了东西就消失，关掉后本次打开不再出现），以及工具栏“更多工具”里的“模板”。插入到当前视野中央并选中（框或思维导图的根）。网页和 App 的 WebView 共用，原生不另做界面。

## 给 AI（#153）留的口与 AI 改白板（WA2）

- `WhiteboardEditorHandle.selectionContext()`：当前选中元素的 ID 和其中的文字（选中框时包含框名及框内元素文字，绑定文字算到容器上）。
- `aiSlot`：右下角的挂载位置（`.whiteboard-ai-slot`），手机布局下工具栏已经给它让出位置。NotesWorkspace 把页面 AI 面板（#158 的 `PageAssistant`）按钮的位置标记放进来（分屏不放），按钮就停在这里。
- 选区问 AI 与实时选区同步（`CanvasEditorProps.onAskAi` / `onSelectionChange`）：`whiteboard-canvas.tsx` 转发 `handleRef`、`onAskAi` 与 `onSelectionChange`；不在画布顶部额外弹出悬浮按钮，而是将 **Ask NoteFable** 置于左侧选中属性面板最顶部（紧接单行化的操作栏：复制/翻转/链接/锁定/分隔线/删除，全部保持一排不折行，下方为样式调整；手机折叠态同样收在顶部单行条内）。同时白板实时向 `PageAssistant` 同步当前选区：即使不点按钮，只要画布有选中元素，右下角 AI 角色按钮即亮起数量角标，点开或已展开的 AI 面板会自动附带该选区（点击 `×` 或发送后解除当前选区绑定，切换选区或重新选中时自动恢复，且面板已展开时切换画布选区不抢焦点）。模型支持看图时，`PageAssistant` 通过 `exportWhiteboardSelectionPng`（实时取最新场景，浅色 PNG，长边 ≤ 1568 px）走常规 `/api/uploads` + `/api/chat` 附带选区图，非视觉模型只发文字，截图失败时降级为纯文字并轻提示「本次仅发送了文字」。锁定白板时仍可通过右下角 AI 按钮就整板提问。
- **AI 创建与编辑白板（`PAGE_KIND_FEATURES.whiteboard.aiEdit = true`）**：`src/lib/page-ai/whiteboard-adapter.ts` 与纯 TS 排版/操作引擎 `src/lib/whiteboard/ai-edit.ts` 提供 `propose_whiteboard_create`（接受 Mermaid 源码复用 `diagramToWhiteboard` 或结构化 `frames`/`items`/`connections`）与 `propose_whiteboard_edit`（`add_element`、`add_frame`、`connect`、`update_element`、`delete_elements`（含绑定文字和思维导图子树级联清理）、`set_frame`、`arrange`、`group_elements`）。模型从不输出像素坐标，全部位置与箭头绑定在服务端由 `ai-edit.ts` 经 `convertToExcalidrawElements`（`withServerDom`）确定性计算，保留 `customData` 并通过 `sceneToStored` + `validateCanvasPage("whiteboard", ...)` 校验，超 20,000 元素或 2 MiB 拒绝。白板 AI 面板支持「Group & organize」等编辑操作、自动应用（锁定白板仍停留在待确认提案）、应用/撤销前先经 `flushCanvasEditors` + 保存队列冲刷未保存修改、写入 `AI_EDIT` 历史快照、刷新已打开的白板编辑器及一键撤销。提案卡片通过 `GET /api/proposals/[id]/content?side=before|after` 按需加载改前/改后可视化预览（网页复用 `whiteboard-thumbnail.tsx`，原生端经 `/note-embed?proposal=<id>` 查看）。

## 测试

`src/lib/whiteboard/*.test.ts`（保存形的转换、精简、链接、公开地址、显示请求、导出文件名、框的顺序与 PDF 分页、PDF 写入器、画成图的 9 种图转换与清理：`diagram.test.ts`、AI 结构化编辑与排版：`ai-edit.test.ts`）、`src/lib/page-ai/whiteboard-adapter.test.ts`、`src/lib/whiteboard/mindmap/mindmap.test.ts`（思维导图的解析、上限、排版不重叠、标记）、`src/lib/whiteboard/mindmap/editing.test.ts`（加节点、连子孙删除（含 Excalidraw 删除 / 橡皮后的补删与剪切）、兄弟顺序与分支颜色、展开的元素上限、改挂、折叠与展开、方向、复制与剪切粘贴折叠节点、连线文字、框归属、连线绑定、拖放目标、锁定元素、约 2 万元素的大白板）、`src/lib/whiteboard/templates.test.ts`（5 种模板）、`src/lib/export-file.test.ts`（分块发送）、`src/app/s/[token]/file/route.test.ts`（公开图片只放行引用的文件）、`src/lib/note-share-server.test.ts`（白板可以公开；幻灯片也能公开，是分享树的叶子）。编辑器本身（Excalidraw）在浏览器里验证。
