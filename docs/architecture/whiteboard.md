# 白板（Whiteboard）

工作区的第二种页面类型（`NotePage.kind = "whiteboard"`，#152）：打开就是全屏的无限画布，可以自由地画、摆、连。数据怎么存、怎么校验、历史怎么留见 [notes-flow.md](notes-flow.md) 的“页面类型”；这里写编辑器和它周边的做法。

## 引擎：Excalidraw 开发版快照

- 用 MIT 授权的 `@excalidraw/excalidraw`，**版本钉死**在 `package.json` 的 `0.18.0-2c3dcc0`（2026-11-21 的开发版快照，`npm install --save-exact`）。选它是因为稳定版 0.18.1 没有便签、小地图和可替换的界面；动手前实测过这个快照有 `stickynote` 工具、小地图、`ui` / `activeTool` 属性、手写笔压感（`strokeOptions.variability`）和 `exportScene`（含按框导出）。开发版的 API 还会变：**升级前要重测**下面“依赖内部的地方”。
- 动态加载、不做 SSR：`src/components/canvas-editors.tsx` 的 `CANVAS_EDITORS.whiteboard` 用 `next/dynamic` 加载 `src/components/whiteboard/whiteboard-canvas.tsx` → `whiteboard-editor.tsx`。Excalidraw（JS 约 1 MB、CSS 约 200 KB）只在打开白板时下载，`/`、`/app`、`/note-embed` 的静态页面不受影响。编辑历史的版本图（`whiteboard-thumbnail.tsx`）和公开页的只读视图（`public-whiteboard-canvas.tsx`）也各自动态加载。
- **字体自托管。** `scripts/copy-whiteboard-assets.mjs`（`npm run dev` / `npm run build` 前的 `predev` / `prebuild`）把 Excalidraw 的图形字体（`dist/prod/fonts`，约 14 MB，其中中日韩手写字体 Xiaolai 按字符范围分成 209 个小文件，用到才下载）和 pdf.js 的 worker 写到 `public/whiteboard/`（不进仓库）；编辑器设 `window.EXCALIDRAW_ASSET_PATH = "/whiteboard/"`。Excalidraw 在我们的地址读不到时会再试 esm.sh，正常部署不会走到。界面用的 Assistant 字体随 CSS 一起打包。
- **线条默认“整洁”。** 新图形的默认值是 `roughness 0`、字体 Nunito（`CLEAN_DEFAULTS`）。Nunito 没有中日韩字形，中日韩文字落到系统字体，三端显示会有差异；需要统一时可以在样式面板里换成手写风（Excalifont + Xiaolai，自托管）。
- **界面语言。** Excalidraw 自带的界面全部关掉（`ui={false}`），工具栏和面板是我们自己的（`whiteboard-ui.tsx`、`whiteboard-style-panel.tsx`），文案走 `useT()`，17 种语言。Excalidraw 只剩少量自带文字（框的默认名等），`langCode` 按我们的语言映射（`excalidraw-locale.ts`，Excalidraw 没有的语言用英文）。Excalidraw 每次设语言都会改 `<html lang/dir>`，`useKeepDocumentLanguage` 用 MutationObserver 立刻改回 NoteFable 的设置（RTL 的阿拉伯语也保持 `dir="rtl"`）。

### 依赖内部的地方（升级时重测）

- `src/lib/whiteboard/excalidraw-bridge.ts`：公开 API 没有执行内置操作的入口。我们注册一个只用于“拿到编辑器本体”的操作（`keyTest` 总是返回 false），在容器里派发一次不存在的按键，从 `keyTest` 的参数拿到 App，之后用 `actionManager.executeAction` 按名字执行内置操作（对齐、等距分布、组合、层级、线色 / 背景 / 粗细 / 线型 / 字体 / 字号 / 对齐 / 不透明度 / 箭头、撤销重做、缩放、网格、吸附、锁定、复制、删除、翻转）。这样撤销历史、绑在形状上的文字和连接线都由 Excalidraw 自己处理。
- 动作的参数格式（`changeStrokeColor` 的 `{ color }`、`changeStrokeWidth` 的 `thin` / `medium` / `bold`、`changeArrowhead` 的 `{ position, type }` 等）和 `appState` 的字段名（`currentItemStrokeWidthKey`、`currentItemStrokeVariability` 等）。
- 荧光笔用手写线的 `extraBold` 宽度键（类型里没有，运行时有）。
- 抓手的光标：Excalidraw 把 `cursor: grab` / `grabbing` 直接写在 `canvas.interactive` 的 style 上，`whiteboard.css` 按这个属性换成我们画的手（改了写法就会退回浏览器自带的白手）。

## 编辑器

- **工具**：选择、套索、抓手、画笔（压感，`variability: variable`）、荧光笔（同是手写线，默认黄色、不透明度 40%、更粗）、橡皮、激光笔、矩形 / 菱形 / 椭圆、线、箭头（绑在形状上的箭头随形状移动；直线 / 曲线 / 折线）、文字、便签（Excalidraw 的 `stickynote`）、图片、框（Frame）。切换工具用 `api.setActiveTool`（不用强制的 `activeTool` 属性：那会让形状画完不回到选择、也不选中新形状）。画笔、荧光笔和其他图形各自记住颜色、粗细、不透明度，切换时互换（`switchStyle`），所以荧光笔的黄色不会染到矩形上。Excalidraw 的单键快捷键（V、H、P、E、R、D、O、L、A、T、S、I、F、K 等）照常有效，键盘切换工具时同样换色组。抓手的光标是自己画的（`whiteboard.css`：和工具栏一样的手，深色线条加白色描边，悬停张开、拖动握住）：Excalidraw 用 CSS 的 `grab` / `grabbing`，浏览器自带的是只有 1 像素黑边的白手，在浅色画布上几乎看不见，也不跟随 Windows 的指针颜色设置。其他工具的光标（系统的箭头 / 十字、Excalidraw 按主题换色的橡皮和激光笔）浅色、深色下都看得见。
- **样式面板**（选中元素或拿着绘图工具时出现）：线色、背景 / 便签色（5 个常用色 + 调色板 + 色号）、粗细、压感、填充、线型、风格（整洁 / 手写 / 草图）、边角、箭头类型和两端、字体 / 字号 / 对齐、不透明度、层级、对齐与等距（多选时）、组合 / 取消组合、复制、翻转、链接、锁定、删除。深色模式下色块按 Excalidraw 的深色滤镜显示（`applyDarkModeFilter`），和画布上看到的一致；导出时一律是浅色。
- **画布**：撤销重做、缩放、适应屏幕、小地图（自己画的：内容缩略图 + 视野框，点或拖跳到那里；元素超过 2,500 个时只画外框）、“回到内容”（视野里没有内容时出现）、网格、对象吸附、手写笔专用（检测到手写笔后可选，手指只拖动）、画布底色。每个设备记住每块白板的视野（`localStorage` 的 `notefable:whiteboard-viewport:v1:<id>`），小地图开关记在 `notefable:whiteboard-minimap:v1`。
- **标题和图标**在左上角的小条里改（和笔记一样走自动保存）。
- **锁定**（页面设置的 Lock）：Excalidraw 的 `viewModeEnabled`，只能看、拖动、缩放、导出。
- **锁定的元素**（样式面板的锁、导入 PDF 的页面图片）：点它时 Excalidraw 只记下 `activeLockedId`（解除的小窗只在它自己的界面里），我们在画布上方显示 “Unlock” 按钮，解除后选中它（是组就整组）。
- **布局**按画布宽度（不是窗口宽度）：撤销 / 缩放在右上（菜单旁），工具栏在下方中间；宽度 < 1010px 时小地图移到工具栏上方；< 640px（手机、App）时工具栏靠左、右下角留给 AI 按钮（`.whiteboard-ai-slot`，#153），样式面板变成底部的一条，可以展开。

## 保存

- 走笔记同一个保存队列（`NoteSaveQueue`，#169 的 `canvas-save.ts`）：编辑器在内容变化 400ms 后（画线、拖动途中不算）把场景转成保存用的形（`sceneToStored`，`src/lib/whiteboard/scene.ts`）交给队列，队列再按一秒防抖 `PATCH { title, icon, data, version }`。只改视野、选择不会保存。关闭编辑器（换页）、页面被隐藏（`visibilitychange` / `pagehide`）、App 关闭编辑页前的 `notefableEmbed.flush()` 时，不等 400ms，立刻把还没交出去的变化交给队列（`src/lib/canvas-flush.ts` 的 `registerCanvasFlusher`；App 的 flush 还会等上传中的图片最多 10 秒）。
- 打开时 Excalidraw 读完内容（`onInitialize`）才记下“已保存”的样子；读的过程中的变化不算编辑（打开不会多出版本）。编辑器关掉后不再用 Excalidraw 的 API（它把内容清空但 `isDestroyed` 仍是 false），之后完成的上传用最后一次收到的场景补进保存。最新的版本 / 版本恢复替换了内容（`NoteSaveQueue.generation` 变了）以后，之前的编辑器关掉时交来的旧变化丢弃。
- 保存的形和 Excalidraw 的 scene 同构：`{ elements, files?, appState? }`。只存 NoteFable 的工具能做出的元素种类（`WHITEBOARD_ELEMENT_TYPES`：矩形、菱形、椭圆、箭头、线、手写、文字、图片、框、便签），Excalidraw 的嵌入（`embeddable`、`iframe`）和 AI 框（`magicframe`）不存、不读，服务端也拒绝；编辑器和公开页都关掉嵌入（`validateEmbeddable={false}`，贴网址只会变成链接）。删掉的元素不存（撤销历史只在打开的页面内存里），坐标保留两位小数，`appState` 只存底色、网格、吸附。
- **图片**：Excalidraw 把贴进来 / 拖进来 / 用图片工具插入的图片放成 `data:` URL。编辑器把它们上传到 `POST /api/pages/files`（SVG 等先转成 PNG），`files[id].dataURL` 存成 `/api/pages/files?key=…` 的地址；上传完成前这个图片元素（和绑在上面的文字）不进保存。上传因存储空间不够被拒时（413 `storage_limit`）删掉这张图，由笔记画面的存储提示说明；其他失败在画布上提示。关闭编辑器后才上传完的图片，也会用最后的场景补进保存。既不是 `data:` 也不是自己的 note-files 地址的图片（例如从公开链接的视图复制来的），读得到就同样上传，读不到就删掉并提示。单张图片上限沿用 4 MiB（Excalidraw 先把长边缩到 2560px）。
- **大小**：整份本体最多 2 MB（服务端上限）。超过 95% 时，保存前用 Ramer–Douglas–Peucker 逐级精简手写线的点（`fitStoredWhiteboard`，平时不精简，以免改变按速度变化的线宽）；仍然超过就由服务端返回 413，提示在画布上方的保存提示里。

## 链接与页面卡片

- 选中图形 → “添加链接”：选自己的页面（笔记 / 白板 / 幻灯片）或输入网址（只收 http、https、mailto）。页面链接存成 `/app?view=pages&page=<id>`，和笔记正文里的页面链接同形。
- 点链接图标（没选中时画在图形右上）或面板的“打开链接”：页面链接在原地打开（网页切换页面，App 里发 `openPage`），按 Ctrl / ⌘ / Shift 时新窗口打开；外部链接新标签页打开。
- “链接到页面”放一张**页面卡片**：圆角矩形 + 文字“图标 标题”，`link` 指向那一页，`customData.notefablePage = { id, kind }`。卡片的文字在放置时写入（之后改了页面标题不会自动更新），图片图标显示成类型符号。卡片文字也进搜索。

## 导入 PDF 与导出

- **导入 PDF**（菜单或“更多工具”）：pdf.js（`pdfjs-dist`，Apache-2.0）在浏览器里逐页渲染成 JPEG（长边最多 2000px、约 350 万像素，超过 4 MiB 再压），逐页上传，每页放进一个框（“文件名 · 页码”），图片锁定以便直接在上面批注。最多 50 页、文件最多 50 MB；为了手机内存，一次只渲染一页、渲染完立刻释放画布。中途某一页失败（存储空间不够、网络）时，已经上传的页照样放进白板，并提示“只导入了前 N 页”。
- **导出**：PNG（2 倍，像素上限 1600 万）、SVG（图片内嵌成 data URL、字体内嵌）、PDF（每个有内容的框一页，按从上到下、从左到右排；不在任何框里的内容放在最后一页，空框跳过；没有框、或者只有空框时整块一页。`planPdfPages` 在 `export-utils.ts`，框的内容和 Excalidraw 的按框导出一致：框的子元素和与框重叠的散元素；只有一部分压在框上的散元素两页都有，不会被裁掉；图形和箭头里的文字跟着它的图形 / 箭头走；外接矩形碰到了框、实际却没画进去时，画出来是全白的那页框也跳过）。导出总是整块白板（选中的部分不影响），一律浅色。PDF 由自写的小写入器生成（`pdf-writer.ts`，每页一张图，可逆的 Flate，不支持时用 JPEG；照片、导入的 PDF 这类 Flate 超过 2 MiB 且 JPEG 不到一半时改用 JPEG），没有新增依赖。文件交给 `saveExportFile`（`src/lib/export-file.ts`）：浏览器里下载；App 里分块交给原生保存（见下）。

## 搜索、历史、公开链接

- **搜索**：白板的文字（元素的文字、框名）由服务端存进 `NoteCanvas.segments`，命中的 `blockId` 是元素 ID。网页打开结果后 `requestWhiteboardReveal` 把请求交给编辑器（编辑器是动态加载的，用 `src/lib/whiteboard/reveal.ts` 暂存，15 秒内有效），编辑器把视野移到该元素并选中。App 里用 `/note-embed?page=<id>&reveal=<id>`（笔记的块同样适用）。
- **历史**：预览用 `exportScene` 画出那一版（SVG），下面列出文字；恢复走服务端原有的流程，打开的编辑器以新内容重新挂载。
- **公开链接**：`PAGE_KIND_FEATURES.whiteboard.publicShare = true`。`/s/:token`（和 `/s/:token/p/:id`）对白板显示和笔记相同的顶栏 + 只读画布（`viewModeEnabled`，可缩放、平移，右下有缩放按钮）；本体由 `GET /s/:token/scene?page=` 读取（`no-store`、`noindex`），图片地址换成 `/s/:token/file?page=&key=`，而 `/s/:token/file` 对白板只放行还活着的图片元素用到的文件（`whiteboardFileKeys`，和 scene 用同一份：删掉的图片、没人用的文件、同一个文件的第二个地址都不放行）；公开的 scene 里元素的 `customData` 只留页面卡片的标记。公开页里的页面链接按同一个公开链接的子页面打开（不在公开树里就显示“无法显示”）。

## App（`/note-embed`）

- 白板和笔记一样在 `/note-embed?page=<id>` 里打开，桥接照旧（`ready` 带 `kind`）。触屏上默认是抓手（单指拖动），切到画笔后单指画、双指缩放平移。
- 用绘图工具（抓手以外）时发 `{type:"drawing", active}`，App 据此在屏幕两侧各排除 200dp 的系统返回手势（Android 每条边的上限）；白板页上 App 的侧栏滑动和 iOS 的边缘返回都关闭（只用顶栏的返回）。
- 导出文件：App 声明 `canSaveFile()` 时，网页发 `fileStart {id, name, mime, size}` → `fileChunk {id, index, data}`（base64，每块原始 512 KiB）×n → `fileEnd {id}`（中途失败发 `fileAbort`），App 写临时文件后让用户选保存位置。旧版 App 提示“请更新应用”。超过 App 能收的 64 MiB（`MAX_APP_FILE_BYTES`，和两端的 `ExportFileAssembler` 一致）时不发送，提示文件太大。各端的实现见 [android-native.md](android-native.md)、[ios-native.md](ios-native.md)。

## 给 AI（#153）留的口

- `WhiteboardEditorHandle.selectionContext()`：当前选中元素的 ID 和其中的文字（绑定文字算到容器上）。
- `aiSlot`：右下角的挂载位置（`.whiteboard-ai-slot`），手机布局下工具栏已经给它让出位置。

## 测试

`src/lib/whiteboard/*.test.ts`（保存形的转换、精简、链接、公开地址、显示请求、导出文件名、框的顺序与 PDF 分页、PDF 写入器）、`src/lib/export-file.test.ts`（分块发送）、`src/app/s/[token]/file/route.test.ts`（公开图片只放行引用的文件）、`src/lib/note-share-server.test.ts`（白板可以公开；幻灯片也能公开，是分享树的叶子）。编辑器本身（Excalidraw）在浏览器里验证。
