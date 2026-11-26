# 原生 iOS 界面（Swift / SwiftUI）

> 目录：`mobile/ios/`。Bundle ID `com.kakumine.notefable`，最低 iOS 17，iPhone 与 iPad 使用同一构建。PR 检查、TestFlight 自动上传和签名见 [ios.md](ios.md)；目录约定和本机命令见 [mobile/ios/README.md](../../mobile/ios/README.md)。

## 定位

iOS 客户端是 Android 客户端（[android-native.md](android-native.md)）的对照移植，两端是同一套行为（界面外壳按下面第二条走 iOS 原生）：

- 只通过服务器 API 工作（REST + SSE，默认主机 `https://app.notefable.com`），不改后端。模型列表来自 `GET /api/models`，读不到时用和 Android 共用的 `models.json`。
- 界面按三端分界（[android-native.md](android-native.md#三端一致与原生分界)）：功能范围、入口、17 种语言的文案和术语、数据与编辑器能力、品牌色和角色形象与网页 / Android 相同；材质、导航容器、手势、动效、弹层呈现按 iOS 原生。外壳按 #195 换成了 iOS 26 的 Liquid Glass（共用部件见下面“结构”里的“玻璃外壳”）：浮动栏、分体式输入栏（左侧独立 `+` 玻璃圆钮、26pt 连续圆角玻璃卡片、36pt 发送键）、28pt 连续圆角玻璃对话框（17/650 标题、14pt 圆角输入框、38pt 胶囊按钮）和自适应原生选择器按 iOS 原生比例与触感打磨；阅读正文与列表核心内容（聊天消息 Markdown、公式、笔记内容、色板）仍取网页和 Android 的测量值（1pt = 1 CSS px）。浅色、深色两套颜色分别取自网页的 `:root` 和 `:root[data-theme="dark"]`；玻璃只当底，不改品牌色。
  - **三条渲染路径**（`NFChromePath`，界面和截图 READY 行的 `glass=` 用同一个判断）：iOS 26+ 原生 Liquid Glass（`.glassEffect(_:in:)` / `GlassEffectContainer`；浮动栏用 `.safeAreaBar(edge:)`，栏底就是系统的滚动边缘效果）；iOS 17–18 系统毛玻璃（控件 `.regularMaterial` / `.ultraThinMaterial`，栏底 `Material.bar` 加细线，浮动栏用 `.safeAreaInset(edge:)`）；“降低透明度”或调试开关 `nfForceSolidChrome` 时实色（栏底是页面的底色，控件是 `Sm.surface` 加描边，iOS 26+ 用 `Glass.identity` 关掉玻璃）。切换路径只换值、不换视图结构，输入框的内容和焦点、开着的选择器都不丢。
  - **导航与弹层**：底部 3 标签 `TabView`（聊天 / 工作区 / 搜索；iOS 26 用 `role: .search`、iOS 27 用 `role: .prominent` 保持独立的圆形玻璃按钮；编辑页和幻灯片放映中收起，附带 iOS 26 降低透明度下的 `UITabBarController` 显隐修复）；自适应浮动玻璃侧栏（`AdaptiveSidebarShell` + `Core/App/AdaptiveLayout.swift`：窗口可用宽度 `>= 640pt` 且窗口总高 `>= 560pt` 且未在幻灯片放映时，260–280pt 侧栏以 `26pt` 连续圆角 Liquid Glass 浮岛常驻在详情栏行首，点击侧栏头部按钮可收起/展开，详情各页在常驻侧栏展开时隐藏行首菜单钮、收起后恢复；窄窗口或低矮横屏手机则作为 `30pt` 连续圆角 Liquid Glass 浮层叠在实时内容上方，配合半透明遮罩，让玻璃实时折射背后的聊天/工作区画面；两种布局共享同一组视图节点，旋转、分屏缩放与折展时保留当前选中项、编辑器 WebView 和未保存输入，内部控件改用半透明填充避免玻璃叠玻璃；聊天与工作区目录合一，没有 `WorkspaceSwitch`，搜索入口只在搜索标签和编辑页顶栏）；模型 / 附件 / 回收站是系统 `.sheet`（`onDismiss` 衔接后续弹窗）；系统原生 `Menu`（放在 `NFGlassContainer` 外部，避免 iOS 26 触发闪烁）用于纯操作菜单，原生 `.nfPopover`（按窗口宽度在紧凑下适配系统 `.sheet` 或常规下适配 `.popover`）用于带开关/进度/搜索的选择器与 Rich 菜单；跨 `TabView` 的 `@Observable NFOverlayCenter` 仅承接全屏面板与居中 `.nfDialog` 对话框（`28pt` 连续圆角玻璃卡 + `14pt` 玻璃谐调输入框 + Capsule 按钮与圆形勾选框）；不拦截触摸的独立 `UIWindow` 提示条（宽屏常驻侧栏展开时按侧栏宽度让出 `leadingInset` 在详情栏内水平居中）；应用内切换阿拉伯语时同步 UIKit 窗口的 `semanticContentAttribute`（`AdaptiveSidebarShell`、`LucideShape` 保持 `.fixed` 避免双重镜像）。
  - **聊天**：顶栏（高 56）浮在消息上：行首玻璃圆的菜单（宽屏常驻侧栏展开时隐藏）；正中玻璃胶囊，有 AI 角色（设置里选的图标，回答时跟着动）、聊天表情和标题、模型名和推理强度，点开模型抽屉，标题放得下时在整条栏的正中；行尾是独立的玻璃圆“新建聊天”与紧邻其外侧（在 `NFGlassContainer` 外部）的系统原生圆形 `Menu`“…”（见下面“和 Android 行为不同的地方”）。空白首页只有菜单（常驻侧栏展开时无按钮）。消息列表铺满整屏、从顶栏和输入栏下面滚过（两条栏经安全区给消息让位），“滚动到底部”是玻璃圆。输入栏采用 iOS 26 分体式玻璃簇（左为独立的 `+` 玻璃圆钮，右为 `26pt` 连续圆角玻璃输入卡；卡内依次是错误、引用、Capsule 附上页面胶囊、圆角图片缩略与 Capsule 文件胶囊、“生成图片”标记、输入框、无边框高亮模型胶囊、圆形发送/停止键和状态小字，上限提示在卡片上方），操作与切换附带 `Haptics` 触感反馈；回答与消息操作栏的“…”经 `.nfPopover` 弹出（导出前等弹窗动画落稳，避免 UIKit 呈现冲突）。iOS 26+ 在聊天标签里往上翻旧消息时标签栏收起、回到最新处展开（`ChatChrome.tabBarMinimize = .onScrollUp`，其他标签 `.never`）。真机上出问题时的开关：`ChatChrome.composerUsesSystemBar` 改成 `false`（输入栏改用 `safeAreaInset`，没有滚动边缘效果）、`ChatChrome.tabBarMinimize` 改成 `.never`。
  - **工作区、搜索、设置、抽屉**：都是浮动的玻璃顶栏，内容从下面滚过。工作区首页是菜单（常驻侧栏展开时隐藏）+ 页面类型筛选（带弹簧动画 `matchedGeometryEffect` 指示滑块的分段玻璃胶囊，放不下时横向滚动；有两种以上页面类型、工作区又不是空的时才有），头部的 New project / Import Markdown 保持实色内容胶囊（避免滚到玻璃顶栏下方时玻璃叠玻璃）；搜索是菜单（常驻侧栏展开时隐藏）+ 玻璃检索框，下一行是带弹簧滑块的标签玻璃胶囊和放在 `GlassEffectContainer` 外面的项目 / 类型过滤胶囊（原生 `Menu`），宽窗口下顶栏内容与结果列限宽 760 居中、滚动区铺满详情宽度；设置是关闭 / 返回玻璃圆 + 居中标题（宽且足够高的窗口按 `AdaptiveLayout.supportsDockedSidebar` 切换为 260–280pt 侧栏加详情两栏，换画面时顶栏不跟着横移，使用 `24pt` 连续圆角卡片、弹簧分段主题开关与浮动 `28pt` Liquid Glass “未保存的更改”操作栏）；侧栏与抽屉使用外层 Liquid Glass 浮层，内部列表行改用 `12pt` 柔和发光选中高亮与原生 `Menu`（帮助、聊天/项目行“…”、新建菜单与底部建项），头部/底部控制采用半透明胶囊避免玻璃叠玻璃。
  - **编辑页**：顶栏是两组玻璃，行首菜单（常驻侧栏展开时隐藏）、返回，行尾搜索、解锁（锁定时）、分享（公开时蓝图标加浅色圆底）、版本历史、“…”（经 `.nfPopover` 弹出，含紧凑分段字体条与系统原生 `Toggle` 开关）；中间是页面图标和标题，保存状态在标题下面；窗口窄时组里的按钮变窄，给标题至少留 44。顶栏不浮动：网页编辑器从顶栏下方开始。
  - **浮层**：纯操作菜单用系统原生 `Menu`（`NFMenuIcons` / `NFMenuLabel` / `NFMascotMenuLabel`）；需内置开关、加载指示、分段控件或搜索的菜单与选择器（回答“…”、页面“…”、语言菜单、表情选择器）使用 `.nfPopover`（语言与表情在紧凑宽度下自适应系统 `.sheet`，宽窗口自适应 `.popover`）；居中对话框（`NFDialogLayer`、登录、附加页面、项目设置、报告、分享）统一为 `28pt` 连续圆角 Liquid Glass 卡、Capsule 动作键、圆形 `20×20` 勾选框与 `14pt` 玻璃谐调输入框，先裁内容再上玻璃，自定义阴影只在非原生路径画；开关统一使用系统 `Toggle`。
  - **按窗口排版**：根视图量出整个窗口放进环境（`nfWindowFrame`），`.nfSheet` Fitted 高度的上限（窗口高的 88%，不低于 260）和提示条的位置按它算，“导入到”和“移到”对话框里列表的最高高度也按窗口高算（`nfWindowHeight`）；外壳不读 `UIScreen.main`。聊天消息列、输入卡片与搜索内容列限宽 760（聊天在窗口宽到 1440 起按网页的 `clamp(50rem, 48vw, 55rem)`），工作区首页连边距限宽 960（窗口窄于 640 时左右边距 20，否则 48）；滚动区和栏底仍铺满窗口。
- 聊天、侧栏、搜索、笔记列表、设置是原生界面；笔记编辑器和 Android 一样用 WebView（`WKWebView`）加载 `/note-embed`；桥消息（`EmbedMessage`）与 Android 相同，`openPage`（页面提及被点）走 `NotesViewModel.openNoteFromLink`，`openChat`（笔记下方反向链接里的聊天被点）由 `NoteEditorWebView` 交给 `AppRouter.openChat`（和搜索结果相同：先保存笔记、切到聊天标签页，有 `messageId` 就滚到那条发言；bootstrap 声明 `canOpenChat()`）；侧栏和回收站里的改动让开着的笔记重读反向链接（`notefableEmbed.refreshBacklinks()`）：页面改名、换图标、复原在写入成功后（`NotesViewModel.refreshBacklinks`），聊天换图标在写入后（`ChatViewModel.onSessionIconSaved`），聊天改名、删除在写入成功后（`SidebarViewModel.onSessionMutated`，常驻侧栏不关闭也能立刻生效）及窄屏抽屉关上时（`AppRouter.drawerOpen`）。原生 → 网页的调用是 `Core/Notes/NoteEditor.swift` 的 `NoteEmbedScripts`（经 `NoteEditorBridge` ← `NoteEditorController` 执行）：`window.notefableEmbed` 的 `flush(requestId)` / `openHistory()` / `pageUpdated(page)` / `pageSettings(page)` / `appIcon(icon)` / `language(code)` / `theme(value)` / `reveal(id)`，约定见 `src/lib/native-bridge.ts`。页面图标是上传图片时（`Core/Models/Notes.swift` 的 `NoteIcons`），`NFIconTile` / `NoteIconGlyph` 用 `RemoteImage` 带 App 的 Cookie 读 `/api/pages/covers?key=`，和表情一样大、圆角 3；原生的图标选择器还只能选表情（**上传图片图标尚未实现**，编辑器里网页的选择器可以上传）。
- 编辑器里的分栏（`columnList` / `column`，见 [notes-flow.md](notes-flow.md)）由内嵌的网页编辑器处理，App 不读块的结构；手机宽度下栏竖着排，不能拖动调宽。
- 页面类型（笔记 / 白板 / 幻灯片）的行为和 Android 相同，规则见 [android-native.md](android-native.md) 的“页面类型”一条和 [notes-flow.md](notes-flow.md) 的“页面类型”。对应的代码：`Core/Models/Notes.swift` 的 `PageKind`（缺字段、null、不认识或不是字符串的值都按笔记）和 `PageKindTable`（`features` 是网页 `PAGE_KIND_FEATURES` 那张表：`GET /api/pages` 的 `kinds` 一到就换成它，之前用安装包里与 Android 共用的 `page-kinds.json`）、`pageKindLabel`，`OpenNote.kind`（`ready` 带来时以它为准），菜单的开关 `NotePageToggle.visible(for:)`，检索结果的类型名 `SearchHit.kindLabel`；默认图标 `pageKindIcon`（`DesignSystem/Lucide.swift` 的 `Lucide.shapes` / `Lucide.presentation`），经 `NFIconTile` 的 `fallback` 和 `NoteIconGlyph` 的 `kind`。单元测试：`PageKindTests`，`NotesViewModelTests` 和 `SVGPathDataTests` 里的类型 / 图标路径各一条。图标、“…”菜单、分享按钮、检索的类型名这些界面改动只经过语法检查和 CI 编译，没在模拟器或真机上看过。
- 白板（#152）：和笔记同一个 `WKWebView` 打开 `/note-embed?page=<id>`，网页显示白板编辑器，桥照旧。新建入口和分区见下面“分区与新建”一条。
  - **导出的文件**：bootstrap 声明 `canSaveFile()`，网页把白板的 PNG / SVG / PDF、幻灯片的 PDF / PNG / PPTX（多页的 PNG 是 ZIP）按 `fileStart` → `fileChunk` × n（512 KiB 以内的字节的 base64，`index` 从 0 起）→ `fileEnd` 送来，中途放弃发 `fileAbort`。`Core/Notes/ExportFile.swift` 的 `ExportFileAssembler` 拼成临时文件：只收这 5 种类型，最多 64 MiB 且要和声明的大小一致，块必须按顺序，一次一个（新的 `fileStart` 让没收完的作废），出错就删掉写了一半的；文件名去掉路径分隔符、控制字符和改变文字方向的字符，扩展名按类型，连扩展名 120 个字符以内。收齐后 `NotesUiState.exportFile` 交给编辑页的 `.fileExporter`（`ExportedFileDocument`，系统的“存储到文件”；iOS 17 的 `onCancellation` 接住取消）：存好提示 “File saved.”，存失败或文件收不下提示 “Could not save the file.”（`export_file_saved` / `export_file_failed`），取消不提示；结束后删掉临时文件。保存窗口开着时又拼好一个文件：新的不存、提示失败（同一时间只等一个保存位置，和 Android 一样）。网页进程崩溃重新加载时，拼了一半的作废。换了编辑器、换了身份时没收完和没存的都删掉，每次启动后第一次导出时清掉以前留下的。只收打开着的编辑器发来的。
  - **手势**：白板页（`PageKind.capturesEdgeSwipes`）关掉编辑页的边缘返回（`UIScreenEdgePanGestureRecognizer`，类型随 `ready` 改正时跟着开关），抽屉也不从屏幕边缘拉出（`NotesUiState.editorCapturesEdgeSwipes` → `AppDrawer` 的 `edgeOpens`）；离开用顶栏的“<”，抽屉用菜单键开、照常能推回去。`drawing` 消息收下不用。
  - **检索定位**（笔记和白板都用）：笔记结果的 `blockId` 经 `AppRouter.openNote` → `NotesViewModel.openNote(reveal:)`。要打开别的页面时存进 `OpenNote.reveal`，新编辑器第一次加载时在地址后加 `&reveal=`（`noteEmbedUrl`），网页滚到命中的块、白板移到命中的元素；网页进程崩溃后的重新加载不再带。命中的就是开着的那一篇时不保存、不重新加载，经注册的编辑器桥（`revealInEditor` → `NoteEmbedBridge.reveal` → `NoteEmbedScripts.reveal`）调 `notefableEmbed.reveal(id)` 就地定位；网页还没挂上编辑器时这一下什么也不做。
  - 单元测试：`ExportFileTests`（桥消息、拼文件、文件名、ViewModel），`PageKindTests` 的功能表和边缘手势，`NotesViewModelTests` / `NoteIconTests` 的 `reveal`，`NoteEditorTests` 的 `reveal` 脚本和开着的那一篇就地定位，`AppThemeTests` 的地址和 bootstrap。
  - **待验证（只经过编译检查）**：选了画笔后单指画、两指捏合缩放和移动，手的工具下单指移动画布；从屏幕边缘开始画时不返回列表、不拉出抽屉；导出 PNG / SVG / PDF 时“存储到文件”窗口的默认文件名和扩展名、存好 / 取消 / 失败时的提示；编辑器的工具栏在 Home 指示条和键盘上方、不被遮住；深色外观下的画布、工具栏和导出窗口。
- 分区与新建（#168）和工作区 / 侧栏界面焕新与 Android / 网页相同（[android-native.md](android-native.md) 的对应条款）：`NotesUiState.kinds` / `sections` / `sectionKind(of:)` / `collapsedSections`（`NotesPrefs.collapsedSections`，UserDefaults 的 `notes.collapsedSections`），`NotesViewModel.createNote(parentId:kind:groupId:)` / `toggleSection`，拖动规则 `noteDropRules`（`ReorderDragController.rules`，拖动开始时取一次）和 `dropTargetAt` 的 `zoneAccepts` / `rowAccepts`；界面同步了深色黑曜石色板、页面类型语义色（蓝 / 琥珀 / 紫）、`Lucide.layoutGrid` 切换图标、280pt 抽屉与高对比侧栏（顶部操作区与各分区间 1pt 分隔线、20×20 圆角语义图标徽章 + 高对比 13pt 分区标题 + 计数胶囊、浮起圆角当前行配 3×18 语义色左侧指示条、白面强细框 Search 栏、底部柔和卡片式“登录”按钮、零星标 AI 图标）、Studio 首页（头部工具胶囊、快速创建卡片、类型筛选栏、圆角卡片分组列表）和居中 Studio 空状态。单元测试：`WorkspaceSectionsTests`。**待验证**（只经过语法检查和 CI 编译，没在模拟器或真机上看过）：抽屉和首页的浅色 / 深色视觉效果、快速创建卡片与类型筛选栏交互、新建菜单位置、分区折叠与跨分区拖动。
- 幻灯片与笔记一键放映和 Android 相同（[android-native.md](android-native.md) 的对应一条，规则见 [slides.md](slides.md#原生应用android--ios)）：笔记和幻灯片“…”菜单都显示放映（`notePageSupportsPresentation`，复用 `slides_present`），幻灯片另显示四种导出（`NotePageMenu` 的 `onSlides` → `NotesViewModel.sendSlidesCommand`，经 `notefableEmbed.slides(...)`），分享对话框不显示“包含子页面”（`NoteShareDialog.kind`），桥的 `canPresent()` / `canSaveFile()`。放映：`presentation` start 时 `NotesUiState.presenting`，编辑页收起顶栏、隐藏状态栏、`isIdleTimerDisabled`（常亮），`App/OrientationLock.swift`（`AppDelegate` 的 `supportedInterfaceOrientationsFor`）锁横屏；平时只允许竖屏（`Info.plist` 声明了横屏，供放映使用）；笔记放映里点击“另存为幻灯片”后先结束放映再经 `openPage` 刷新列表并打开新建幻灯片。导出：和白板走同一条路（上面白板一节的“导出的文件”：`Core/Notes/ExportFile.swift` 的 `ExportFileAssembler` 拼临时文件，`NotesUiState.exportFile` 交给编辑页的 `.fileExporter`）。单元测试：`SlidesBridgeTests`、`PageKindTests`。**横屏放映、常亮、文件导出都只经过 Linux 容器的 `swift test` 和 CI 编译，没在模拟器或真机上验证。**
- AI 生成幻灯片（#150，规则见 [slides.md](slides.md#ai-生成幻灯片) 和 [android-native.md](android-native.md#ai-生成幻灯片)）：对照 Android 实现三端一致的全部入口——聊天“＋”抽屉（`AttachSheet`，“整理成笔记”旁的“生成幻灯片”，同可见/禁用规则）、笔记“…”菜单（仅笔记，“画成图”后的“生成幻灯片”；编辑器内 AI 面板按钮由网页自带）、新建幻灯片处的“用 AI 生成”（抽屉底部“＋”菜单、项目行/页面行 `NewPageMenuAnchor`、幻灯片分区 `NotesSectionHeading` 双项菜单、工作区首页与空状态 `CreateDeck` 胶囊，均使用 `AppIconView` 零星标）。`NoteEmbedScripts.bootstrap` 声明 `canShowSlidesWizard()`；当前有编辑器时由 `SlidesWizardOverlayLauncher` 在现有编辑页内调用 `notefableEmbed.slidesWizard({action:"open",...})` 并隐藏顶栏，无编辑器时由 `RootView` 弹出 `SlidesWizardScreen` 借用 `NoteEditorPool` 加载 `/note-embed?warm=1`（宽窗口 iPad / iPhone Duo 自动居中弹窗、窄窗口全屏）；边缘返回优先调用 `slidesWizard({action:"back"})`，`closed(busy: true)` 期间延长常驻 WebView 空闲释放至 360 秒并放过停靠释放；`openPage` 打开新建幻灯片并切到工作区，`usageLimit` 在向导顶部显示 `GuestLimitPrompt`。单元测试：`SlidesBridgeTests`、`AppThemeTests`；SwiftUI 界面经语法检查与 CI 编译验证，真机 / iPad / iPhone Duo 交互待实测。
- AI 的页面提案卡片（#158，网页 `page-proposal.tsx`）不分页面类型：笔记、白板、幻灯片的编辑 / 新建提案是同一张卡片，改动的文字和缩略图由服务端各类型的适配器做好（`src/lib/page-ai/types.ts`），卡片照着画。对应的代码：
  - 解析在 `Core/Chat/Activity.swift`：`pageKind`（缺了或不认识按笔记）、`autoApplied`、`undoable`、`status` 多了 `undone`；新建提案的 `parentId` / `parentTitle` / `changes`；改动的 `op` 是 `ProposalOp`（多了 add / update / move / reorder，不认识的按 update），`target`（`ProposalChangeTarget`：第几张幻灯片、白板的元素）、`beforeImage` / `afterImage`（只收本站的相对地址，别的当没有）。仍然要求 `proposed.blocks` 是数组（服务端总给空数组）。
  - 文案在 `Core/Chat/ProposalCopy.swift`：标题（编辑都是“对“…”的修改建议”，新建按类型）、读屏名（笔记 / 页面）、主按钮（应用 / 创建笔记 / 创建白板 / 创建幻灯片）、徽标（自动应用的写“已自动应用 / 已自动创建”，另有“已放弃”“已撤销”）、改动的小标题（笔记的第几块 / 开头，幻灯片第几张，白板元素的文字或个数，别的类型没有对象时只写操作）、子页面的“位于“…”中”。
  - 撤销是 `ProposalStore.undo`（`POST /api/proposals/:id/undo`，`ProposalApi.undo` 读回 `page` 或移进回收站的 `ids`）。卡片显示的状态（`stateOf`，网页 `useProposalState`）：服务端说已放弃 / 已撤销的以服务端为准；服务端说已应用的，只用本机的撤销中、已撤销和撤销失败（还是“已应用”，带原因）；没处理的用本机的。“撤销”键在服务端说能撤销（`undoable`）或刚在这台设备上应用过时出现，撤销中转圈；失败显示服务端原句（系统文翻译）或“无法撤销这项修改。”。撤销编辑提案后和应用后一样刷新笔记列表、把恢复后的页面交给开着的编辑器（`pageUpdated`）；撤销新建提案后 `NotesViewModel.onPagesTrashed` 先从列表拿掉移进回收站的页面（含子页面）、关掉开着的那篇，再刷新（`AppEnvironment.onProposalChange`）。应用 / 放弃 / 撤销被拒、而错误响应带着提案的最终状态（`status`）时，卡片换成那个状态，不显示错误（`ProposalException.finalStatus`，和网页、Android 相同）。
  - 界面在 `Features/Chat/Answer/ProposalCard.swift`：按钮行待确认是“应用 / 放弃”，已应用是“打开笔记 / 打开页面” + “撤销”，撤销过的编辑提案还能打开，撤销过的新建提案写“这个页面已移到回收站。”。缩略图改前、改后并排（最高 176，红 / 绿边框），地址只给提案的主人，只收 `/api/proposals/<id>/image?change=<n>&side=before|after` 这一种写法（`Activity.isProposalImagePath`，Android 同），经 `RemoteImageLoader` 带 App 的 Cookie 读，读到之前按 16:9 留底色。撤销中和网页一样算已处理：徽章还是“已应用”，不显示“应用 / 放弃”，编辑提案的“打开…”还在（新建的页面要进回收站，不给）。
  - 报告 AI 内容：`Core/API/ReportApi.swift` 的 `ReportTarget`（回答 `messageId`、提案 `proposalId`、页面 `pageId`，请求体里只放一个）、`Core/Account/ReportModel.swift`、`Features/Chat/Answer/ReportDialog.swift`（`.reportDialog(_:isPresented:)`；标题和说明回答是 `report_title` / `report_help`，提案和页面是 `report_ai_content` / `report_ai_help`）。卡片标题行最右的旗子报告这个提案；页面“…”菜单在 `NotePageSummary.aiUpdatedAt` 不是 nil 时有“报告 AI 内容”（`notePageReportable`）。编辑器里网页的 AI 面板应用的修改不经原生，所以这一项要等笔记列表下次刷新（回到列表、重新打开）才出现。
  - 单元测试：`ActivityTests`（新字段、对象、缩略图地址、旧提案的默认值）、`ProposalCopyTests`、`ProposalStoreTests`（撤销、状态优先级、undo 和报告的请求体）、`AccountModelsTests`（报告提案 / 页面）、`NotesApiTests`（`aiUpdatedAt`）、`NotesViewModelTests` / `AppEnvironmentTests`（移进回收站的页面）。卡片、报告窗口和菜单项只经过语法检查和 CI 编译，没在模拟器或真机上看过。
- 画成图（#153，规则见 [chat-flow.md](chat-flow.md#画成图draw-as-diagram)）：接口和任务在 `Core/API/DiagramApi.swift`（`DiagramApi` 发 `POST /api/pages/diagram`，超时和「整理成笔记」一样 320 秒；422 `diagram_invalid` 的 Mermaid 原文用 `DiagramInvalidError` 带出来；429 `usage_limit` 保留 `usageLimitTier`；`DiagramStore` 按 `DiagramSource.key` 存任务，每个任务一个 UUID 当 `clientRequestId`，重试沿用，`forgetFinished` / `clearJobs` 忘掉；建好后 `created()` 让 `AppEnvironment` 刷新笔记列表）。导航在 `AppRouter`：`drawDiagram`（回答“…”菜单，`AnswerActions` 里只给已入库的回答）、`drawDiagramFromNote`（笔记“…”菜单，`NotePageMenuActions.onDrawDiagram`，只给笔记；已有任务直接重开，否则先 `NotesViewModel.flushBeforeServerRead`，存不上提示 `err_save_draft`、不开始，同页防重入）、`retryDiagram`、`closeDiagram`、`openDrawnDiagram`（`NotesViewModel.showCreatedPage` 先放进列表并展开父笔记，再打开白板）。进度窗口 `Features/Shared/DrawDiagramDialog.swift` 挂在 `RootView`（`router.diagramSource`），图标 `Lucide.workflow`，游客撞 429 上限时在窗口内显示 `GuestLimitPrompt`。单元测试 `DiagramTests`（请求的形、错误显示、一个素材一个任务、重试同一个 ID、关窗口忘掉、换身份不留结果、先保存再开始、打开白板）和 `SVGPathDataTests` 的图标路径。窗口和菜单项只经过语法检查和 CI 编译，没在模拟器或真机上看过。

**功能规则不在本文重复**：后台生成、附件、使用上限、回答导出、笔记、搜索跳转、头像等规则以 [android-native.md](android-native.md) 为准，本文只写 iOS 特有的结构和差异。改了三端必须一致的部分（功能范围、入口、文案和术语、数据与编辑器能力、品牌色和角色形象），另一端和网页要在同一个任务里一起改；只改 iOS 的原生部分（材质、导航容器、手势、动效、弹层呈现）时不动 Android 和网页（见 `AGENTS.md`）。

## 现状

代码通过了能做的检查；第一个 TestFlight 构建 2026-11-24 已装到真机（[ios.md](ios.md)），界面还没有逐项验收：

| 部分 | 验证方式 | 状态 |
| --- | --- | --- |
| `Core/`（网络、接口、解析、ViewModel） | Linux 容器里 `swift test`，以及 CI 的 macOS `swift test` | 740 多项单元测试通过（大部分移植自 Android 的单元测试） |
| `DesignSystem/`、`Features/`、`App/`（SwiftUI / UIKit） | CI 的模拟器无签名构建，以及 PR 带 `ios-screenshots` 标签时的模拟器截图（`ios-pr.yml`：iOS 26 / iOS 18 / iOS 27：浅色拍全部场景，深色、阿拉伯语 RTL 与“降低透明度”各拍关键场景） | 能编译，截图供人工验收；手势、键盘、WebView 交互需在真机（TestFlight）上验 |

Google 登录：Google Cloud 里给 `com.kakumine.notefable` 登记的 iOS OAuth 客户端是 `NoteFable-iOS`，客户端 ID 写在 `Config/NoteFable.xcconfig` 的 `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_IOS_REVERSED_CLIENT_ID`（不是密钥，会打进安装包；留空时登录窗口只有邮箱验证码）。服务端校验的 audience 仍是 Web 客户端 ID（`serverClientID`）。

上线前还缺：

- **真机验证**。TestFlight 构建已能装到 iPhone；按 [android-native.md](android-native.md) 的各节核对三端必须一致的部分（功能、入口、文案、数据与编辑器能力、品牌色和角色形象），外壳手感待在 iOS 26+ 的 iPhone 上按验收标准实测（Tab 栏按住滑动与折射、顶栏按压高光、抽屉跟手、输入框随键盘不跳；浅色 / 深色 / 降低透明度下可读）。宽屏自适应侧栏在 CI 仅覆盖 iPad 竖屏（浅色 / 深色 / 阿拉伯语 RTL / 降低透明度，含常驻展开与手动收起）；iPad 横屏、多任务窗口缩放、Split View 以及 iPhone Duo 双屏与折展切换尚待真机或本地 Mac 模拟器验证。预计会有一批细节要修。
- **Sign in with Apple**。服务端配置齐全后，登录弹窗显示原生 Apple 按钮。服务端绑定一次性授权码和设备 nonce，按 Apple 账号 ID 延续同一账户。Apple 登录入口在 iOS；网页与 Android 继续提供原有登录选项。真机仍需验收。
- **购买**。设置按当前窗口宽度切换单栏或侧栏加详情两栏，选中项和设置草稿跟随同一份状态。方案卡片显示店面月价，可购买、恢复及打开 App Store 订阅管理。购买、续费、退款都由服务端验证并同步，见 [billing.md](billing.md)。日常 TestFlight 沙盒购买使用隔离后端。App Review 则使用专用沙盒评审账号，见 [deployment.md](deployment.md)。
- **通用链接**。`Support/NoteFable.entitlements` 声明了 `applinks:app.notefable.com`，网站已提供 `public/.well-known/apple-app-site-association`（仅匹配 `/c/?*` 分享链接，由 `next.config.ts` 返回 `Content-Type: application/json`），待真机实测验证。

## 结构

```
mobile/ios/
  project.yml            XcodeGen 工程定义（版本号在这里；.xcodeproj 不进仓库）
  Package.swift          只用来单独编译、测试 Core
  Config/  Support/      xcconfig、Info.plist、entitlements
  scripts/               core-check.sh（Linux 容器里编译 / 测试 Core）、ci-core-tests.sh（CI 上跑 Core 测试）
  NoteFable/
    App/                 @main 入口
    Core/                不依赖 SwiftUI / UIKit：网络、接口、DTO、解析、ViewModel
    DesignSystem/        Sm 颜色、Lucide 图标、角色形象、玻璃外壳、按钮 / 对话框 / 菜单 / 底部抽屉 / 提示
    Features/            各界面（Root、Chat、Sidebar、Search、Notes、Account、Settings、Shared）
    Resources/           Assets.xcassets、17 种语言的 Localizable.strings
  Tests/NoteFableCoreTests/
```

分层规则：

- **Core 只 import Foundation**（加 `Observation` 和 swift-markdown，以及按 `#if canImport` 条件导入的 `CoreGraphics` / `FoundationNetworking`），所以能在没有 Mac 的机器上用 Linux 的 Swift 编译和测试。SwiftUI、UIKit、WebKit、Photos、GoogleSignIn 只出现在 `DesignSystem/`、`Features/`、`App/`。Core 需要平台能力的地方留接口，由界面层装上：Google 登录（`AppEnvironment.requestGoogleIdToken` ← `GoogleSignInBridge`）、表情字形判断（`emojiGlyphSupported` ← `EmojiGlyphs`）、笔记编辑器（`NoteEditorBridge` ← `NoteEditorWebView`）。
- **Core 的源码直接编进 App 模块**（不是单独的包），所以类型都是 internal；`Package.swift` 只是为了测试把同一批文件当成一个库来编译。
- **ViewModel** 是 `@MainActor @Observable final class`，状态是一个值类型（`ChatUiState`、`NotesUiState`…），依赖从初始化参数注入，时间用注入的 sleep / clock，所以测试不真等。
- **依赖装配**在 `Core/App/AppEnvironment.swift`（接口、ViewModel、各种 Store 都在这里创建一次），**导航**在 `Core/App/AppRouter.swift`（抽屉、`selectedTab: AppTab`、设置、登录、打开笔记 / 聊天、处理外部链接）。界面只从环境里取这两个对象：

  ```swift
  @Environment(AppEnvironment.self) private var app
  @Environment(AppRouter.self) private var router
  ```

- **浮层与底部弹层**：模型、附件、回收站使用包装在 `.nfSheet` 里的系统 `.sheet`（Fitted 与 Medium/Large detent，iOS 26+ 保留系统 Liquid Glass，iOS 17–18 使用 `.regularMaterial`，降低透明度时使用实色底）；纯动作菜单使用系统原生 `Menu`（放在 `GlassEffectContainer` 外侧），带开关/加载状态/搜索栏的菜单与选择器（`AnswerActions`、`NotePageMenuButton`、`LanguageMenu`、`EmojiPicker`）使用原生 `.nfPopover`（紧凑宽度下 `LanguageMenu` 与 `EmojiPicker` 自适应系统 `.sheet`，宽窗口及选项条弹窗呈现原生 `.popover`）；居中对话框与全屏面板（设置 / 登录 / 幻灯片向导 / 添加页面 / 项目设置）注册到根视图及各层 `.nfOverlayHost()` 的 `@Observable NFOverlayCenter`（面板 < 对话框）；提示条（`ToastHostModifier`）画在不拦截触摸的独立 `ToastOverlayWindow`（`windowLevel = .normal + 10`，和根视图同一个场景、同样大小）上，浮在系统 `.sheet` 和底部 Tab 栏之上，摆放见下面的 `NFBottomChrome`。
- **玻璃外壳**的共用部件在 `DesignSystem/LiquidGlass.swift` 和 `GlassChrome.swift`，界面层不自己判断系统版本和“降低透明度”：
  - `NFChromePath`（`resolve(reduceTransparency:forceSolid:)`、`primaryInk` / `secondaryInk`）和环境值 `nfChromePath`：三条渲染路径的唯一判断；小块玻璃上的字和图标在原生路径用系统的 primary / secondary，其余用 `Sm.text` / `Sm.muted`。
  - `nfForceSolidChrome`：调试 / CI 强制走实色（`-NFForceSolidChrome YES`）。
  - `nfWindowFrame`：根视图（`.toastHost`）量出的整个窗口的 frame，含容器安全区。
  - `NFChromeMetrics`：iOS 26 工具栏的尺寸（栏高 56、玻璃控件 44、左右 16 / 编辑页 12、间距和容器间距 8、组内按钮宽 40、非原生路径的控件阴影）。
  - `NFGlassStyle` + `.nfGlassBackground(_:in:solidFill:tint:stroke:)`：任意形状的玻璃底（regular / clear / interactive），按路径换成毛玻璃或实色加描边。
  - `.nfPopover(...)`：原生 `.popover` / 自适应 `.sheet` 包装（统一注入方向、Locale、`nfDismiss` 与覆盖宿主）。
  - `NFMenuIcons` / `NFMenuLabel` / `NFMascotMenuLabel`：把 Lucide 矢量图标或角色图标渲染为模板位图用于系统原生 `Menu`。
  - `NFGlassContainer`：iOS 26+ 外面包一层 `GlassEffectContainer`，更早的系统原样放。
  - `.nfFloatingBar(edge:alignment:spacing:systemBar:content:)`：iOS 26+ 用 `safeAreaBar`（`systemBar: false` 时也用 `safeAreaInset`），更早用 `safeAreaInset`。
  - `.nfBarBackdrop(_:solidFill:divider:)`：浮动栏自己那块的底：原生路径透明（交给滚动边缘效果），毛玻璃 `Material.bar`，实色 `solidFill`；后两种伸进安全区，可在内侧加细线。
  - `.nfFloatingHeader(edge:solidFill:divider:spacing:systemBar:content:)`：`nfFloatingBar` + `nfBarBackdrop` + 铺满宽度，浮动栏的默认写法。
  - `.nfGlassCapsule(_:solidFill:stroke:)`：不是按钮的玻璃胶囊（菜单的触发框、分段轨道、检索框）。
  - `.nfChromeShadow(_:radius:x:y:)`：只在非原生路径画的阴影（原生路径只把颜色换成透明）。
  - `NFGlassIconButton`：可交互玻璃圆按钮（原生路径不另加缩放和阴影）。
  - `NFGlassGroup` / `NFGlassBarButton`：相邻几个按钮共用一个可交互玻璃胶囊（iOS 26 工具栏分组）；组里的按钮自己不带玻璃，可设颜色和“开着”的圆底。
  - `.nfTabBarHidden(_:)`：收起 / 显示底部标签栏，含 iOS 26 降低透明度下的显隐修复；`NFTabBarMinimize` + `.nfTabBarMinimize(_:)`：iOS 26+ 的 `tabBarMinimizeBehavior`，更早的系统不做事。
  - `.nfSheet(isPresented:detents:…)`（`NFSheetDetents`：`fitted` / `mediumAndLarge`）：系统 `.sheet`，Fitted 的高度最多到窗口高的 88%（不低于 260）。
  - `NFGlassTabIcons`：把 Lucide 路径画成模板图片给 `TabView` 用。
  - `NFBottomChrome` + `.nfReportsBottomChrome(_:)`：各标签页报告窗口底部被标签栏、浮动底栏和 Home 指示条挡住多少，提示条据此摆放（计算在 Core 的 `toastBottomClearance`，单元测试 `ToastClearanceTests`）。

### 和 Android 的对应

类型、函数、文件名尽量和 Kotlin 端相同，方便对照着改：

| Android（`mobile/android/app/src/main/java/com/kakumine/notefable/`） | iOS（`mobile/ios/NoteFable/`） |
| --- | --- |
| `data/NoteFableApi.kt`、`Dto.kt`、各 `*Api.kt` | `Core/API/`、`Core/Models/` |
| OkHttp + CookieJar | `Core/Networking/`：`URLSessionTransport`、`PersistentCookieJar`（Cookie 存在 Application Support 的 `cookies.json`）、`IdentityGate` |
| `ui/ChatViewModel.kt`、`NotesViewModel.kt`、`SidebarViewModel.kt`… | `Core/Chat/ViewModel/`、`Core/Notes/`、`Core/Sidebar/`、`Core/Search/`、`Core/Account/` |
| `ui/Theme.kt`（`Sm`）、`Lucide.kt`、`Mascot.kt` | `DesignSystem/` |
| `ui/NoteFableRoot.kt`、`MainActivity.kt` | `Features/Root/RootView.swift`、`App/NoteFableApp.swift` |
| `ui/ChatScreen.kt`、`AttachUi.kt`、`TurnActions.kt`… | `Features/Chat/` |
| `ui/AssistantTurn.kt`、`AnswerMarkdown.kt`、`ChatActivity.kt`… | `Features/Chat/Answer/` |
| `ui/NotesUi.kt`、`NoteEditor.kt`、`NotePageMenu.kt` | `Features/Notes/` |
| `ui/SettingsDialog.kt`、`AccountUi.kt`、`SignInDialog.kt`… | `Features/Settings/`、`Features/Account/` |
| `res/values*/strings*.xml` | `Resources/<语言>.lproj/Localizable.strings`（生成） |
| `assets/*.json` | 同一份文件，`project.yml` 直接引用 Android 的 `assets/` |

### iOS 上换了做法的地方

| 功能 | Android | iOS |
| --- | --- | --- |
| Markdown | multiplatform-markdown-renderer | swift-markdown 解析（`Core/Chat/MarkdownDocument.swift` 转成自己的块结构），界面逐块渲染，流式时只重画最后一块 |
| 数学公式 | latex-renderer + KaTeX 字体 | SwiftMath（`MTMathUILabel`）；行内公式渲染成图片按基线嵌进文字。认公式的规则（`MathMarkdown.prepare`）两端相同 |
| 回答里选字引用（“问 NoteFable”） | 自定义选择菜单 | 不可编辑的 `UITextView`，在系统选择菜单最前面加一项 |
| 输入框粘贴图片 | `BasicTextField` 的 `contentReceiver` | `UITextView` 子类重写 `paste` |
| 选文件 / 照片 / 拍照 | 系统选择器 | `PhotosPicker`、`fileImporter`、`UIImagePickerController` |
| 保存生成的图片 | MediaStore | `PHPhotoLibrary`（只申请“添加”权限） |
| 笔记编辑器 | `WebView` + `addJavascriptInterface` | `WKWebView` + `WKScriptMessageHandler`；用落盘的默认数据存储（网页的本地草稿和 Android 一样跨 App 重启保留），每次加载前把它的 Cookie 换成 App 的（所有编辑器排成一条链依次换） |
| 外观（跟随系统 / 浅色 / 深色） | `Sm` 按当前色板取值；偏好在 SharedPreferences `app_theme` 的 `theme` | `Sm.*` 和 `Color(light:dark:)` 是 UIKit 动态颜色，跟着所在界面的外观自己换（`DesignSystem/Theme.swift`；UIKit 视图用 `SmUI`）。偏好（`Core/Support/AppTheme.swift` 的 `AppThemeStore`）存在 UserDefaults 的 `app_theme.theme`；`NoteFableWindow` 用 `preferredColorScheme` 并把每个窗口的 `overrideUserInterfaceStyle` 定成浅色 / 深色，“跟随系统”时不指定。画成图片的公式按浅色、深色各画一张 |
| 编辑器的外观 | 地址的 `theme=`、`NoteFableNative.theme()`、`notefableEmbed.theme(value)` | 相同的三处（`NoteEmbedScripts.bootstrap` / `.theme`，`NoteEmbedBridge.pushTheme`）：只传算好的 `light` / `dark`，变了就地推送、`ready` 后再推一次。`WKWebView` 自己不画底（透明），网页画出来之前露出编辑页的底色，深色下不会先白一下 |
| 笔记导出 Markdown | SAF `CreateDocument` | 页面“…”菜单 → 先让网页保存（存不上就不导出）→ `GET /api/pages/:id/export` → 系统的“存储到文件”（`.fileExporter`，UTF-8 的 `.md`，与下载对话共用 `MarkdownExportDocument`）。规则在 `Core/Notes/NoteIO.swift` 和 `NotesViewModel.exportPage` |
| 笔记导入 Markdown | SAF `OpenMultipleDocuments` | `fileImporter`（可多选；`Features/Notes/NoteMarkdownIO.swift`）：带访问权限的地址逐个申请、用完就还，iCloud 里没下载的由 `NSFileCoordinator` 等它下载。发请求前按 20 个 / 每个 1 MiB / 合计 4 MiB / 扩展名查一遍（`noteImportProblem`），读完按实际要发的文字和 JSON 请求体再查一遍（`noteImportPayloadProblem`，`groupId` 也算在内）。没有项目时直接导入（请求体不带 `groupId`）；至少有一个项目时本机检查通过后先显示“Import to”对话框（`NotesViewModel.beginImport` 决定，`NoteImportTargetDialog`，用“移到”窗口同一套 `.nfDialog` / `NFOptionRow`）：第一项 “No project”，后面按项目顺序，点一项就导入到那里（带 `groupId`），“Cancel” 不导入。`POST /api/pages/import` 后合并进列表并打开第一篇 |
| 首页封面与侧栏重命名 | `NotesUi.kt`、`NoteFableRoot.kt`、`ChatRecentNotes.kt` | 同源对照实现：`NoteCovers` + `NoteCoverBanner` 在 `NotesHomeView`（最近编辑横向卡）和 `ChatRecentNotes`（卡片顶部封面条）渲染封面；`NotesDrawerBody` 的页面行 “…” 原生 `Menu` 与收藏行提供重命名（未锁定时），由 `NotesViewModel.renamePage` 冲洗草稿后调用 `PUT /api/pages/:id/title` 并通过 `notifyPageUpdated` 同步给 `WKWebView` 缓存；`/note-embed` 编辑器同步获得 `/table of contents` 实时目录块 |
| Google 登录 | Credential Manager | GoogleSignIn SDK |
| 系统分享接收 | `MainActivity` 的 `ACTION_SEND` / `ACTION_SEND_MULTIPLE` | 独立扩展 `NoteFableShareExtension`（`ShareExtension/ShareViewController.swift`）把内容写入 App Group（`group.com.kakumine.notefable`）共享目录（`ShareInboxStore`），尝试经 `extensionContext.open` 打开 `notefable://share?id=…`；若系统拒绝直接拉起主 App，则展示已保存勾标后收起，用户回到 NoteFable 时由 `AppRouter.consumePendingShares` 按顺序自动取走全部待处理分享 |
| 返回键 | 系统返回键、预测性返回 | 没有返回键：抽屉、面板、编辑页用边缘滑动或各自的关闭按钮（白板页没有边缘返回，用顶栏的“<”） |

设置里的“图标”和 Android 一样先存在本机（`UserDefaults` 的 `app_icon.icon`，`AppIconStore`），登录时随账号同步（`Core/Support/AppIconSync.swift`，Android `AppIconSync.kt` 的移植；`AppEnvironment.start()` 跟着登录状态读，`Features/Settings/AppIconSettings.swift` 打开时读、选了以后送；图标属于哪个账号和待发送存在 `UserDefaults` 的 `app_icon.owner` / `app_icon.pending`，退出登录 / 删除账号后由 `AppEnvironment.onSignedOut` 调 `forgetAccount`），规则见 [image-flow.md](image-flow.md) 的“设置里的图标”。单元测试 `AppIconSyncTests`。

### 和 Android 行为不同的地方

- **添加文件或照片**：iOS 没有合在一起的系统选择器，点了先出“照片图库 / 拍照 / 选取文件”三项，再打开对应的系统界面。
- **回答里选字**：一段一个文字视图，选区不能跨段；还在流式输出的回答不能选（用普通文字渲染，为了速度）。
- **下载会话**：用系统的“存储到文件”（`.fileExporter`）；下载途中 App 被杀不会像 Android 那样恢复。
- **保存生成的图片**：存进相册后只提示“已保存”，不打开图片。没有权限时提示去“设置”里允许。
- **笔记里的文件**：下载到临时目录后打开分享面板（存到“文件”或用别的 App 打开），不是直接存进下载目录。
- **撞到上限时的提示**：游客显示登录提示。已登录的免费用户在开放 App Store 购买时可以跳转到设置的方案页。笔记编辑器 WebView 里的 AI 面板或幻灯片 AI 生图撞 429 `usage_limit` 时，bootstrap 声明 `canShowUsageLimit()`，接收 `EmbedMessage.usageLimit(tier, kind, pageId?)` 核对当前编辑器与 `pageId`（过滤切页后晚到的旧页面响应）后写入 `NotesUiState.usageLimit`（与 `storageLimit` 互斥，换编辑器或换身份时清零），`NoteEditorScreen` 在顶栏下方用 `GuestLimitPrompt(usage:)` 呈现：游客显示原生登录入口，已登录免费用户可以跳转到方案页。被拒草稿由网页持久化到 `WKWebsiteDataStore.default()` 的 `localStorage`，登录重建 WebView 后重开原页面自动恢复。
- **存储空间不够**（413 `storage_limit`）：和 Android 一样文字和附件留在输入栏、显示存储提示（`GuestLimitPrompt(storage:)`：用量、“删除不需要的文件”，游客有登录按钮），笔记编辑器里的上传被拒时网页经桥发 `storageLimit`（`canShowStorageLimit()`），编辑器顶栏下面显示同一个提示。开放 App Store 购买时，免费用户可以跳转到方案页。设置的方案卡片显示存储用量条（`PlanInfo.storage`）和说明。
- **系统权限说明**（相机、存相册，`Info.plist`）目前只有英文，没有按语言的 `InfoPlist.strings`。
- **表情选择器**在深浅色外观下自动适配当前主题：使用自适应胶囊搜索栏、`.ultraThinMaterial` 吸顶分类标题（降低透明度时回退实色）、浮动 Liquid Glass 肤色变体条及动态正文色 `Sm.text`（与 Android 一致跟随系统深浅切换；网页端仍保留浅色 `Theme.LIGHT`）。
- **启动画面的底色**（`LaunchBackground`）跟随系统的深浅，不看 App 里选的外观：选的和系统不一样时，启动瞬间的底色与进入后的界面不同。
- **导出笔记**：存好以后不另外提示；写入失败弹 “Could not export the page.” 的提示（Android 显示在笔记顶栏下面的提示条里）。导出、导入的其他错误和 Android 一样分别显示在编辑页顶栏下面和笔记的错误条里。
- **白板页的边缘手势**：Android 只在网页报来正在用画画的工具（`drawing`）时让开屏幕边缘；iOS 在白板页一直关掉边缘返回和抽屉的边缘拉出（用手的工具时也一样），离开用顶栏的“<”。
- **常驻复用 WebView 与就地切页（#176）**：与 Android 对齐，`RootView` 持有单个工作区级 `NoteEditorPool`（首次打开笔记时按需创建 `WKWebView`），直接切页与离开后短暂重开都复用同一个 `WKWebView` 并经 `window.notefableEmbed.openPage` 就地切换（命中网页端最多 8 篇的 LRU 缓存；旧版服务端或尚未挂好时回退到 Cookie 同步 + 整页加载）。离开编辑页停留在列表或聊天时调用 `close()` 卸载编辑器 DOM 仅保留轻量缓存，同时通过 `AppEnvironment.warmPageUpdated`、`NotesViewModel.notifyPageUpdated`（侧栏改图标，`PUT /api/pages/:id/icon` 返回的整篇页面，只推这次加载以来在这个 WKWebView 里打开过的页面）、`notifyPageSettings`（没打开着的那篇的收藏 / 显示设置 / 锁定）与 `notifyPagesTrashed` 把聊天提案更新、图标、设置和回收站清理同步进热缓存。`missing` 带 `id`，切页途中只认要打开的那一篇的；旧版服务端回退整页加载（`location.replace`）时记下之前的历史项数（`historyFloor`），边缘返回不会退回上一篇。换身份、退到后台（`scenePhase == .background` 且未打开笔记）、收到系统内存警告（`didReceiveMemoryWarningNotification` 且未打开笔记）、停靠空闲超过 120 秒、网页进程在停靠期间终止以及根视图销毁时彻底释放 `WKWebView`。
- **聊天顶栏**：标题在正中的玻璃胶囊里，点胶囊打开模型抽屉，是输入栏模型按钮之外的第二个入口。行尾的“…”原生 `Menu`（更改聊天图标、置顶 / 取消置顶、改名、移到项目、删除；菜单项和对话框与侧栏共用 `ChatSessionMenuItems` / `ChatActionDialog`；置顶失败因原生菜单点击后立即关闭，通过全局 Toast 提示错误）是 iOS 多出来的入口：网页和 Android 的置顶、改名、移到项目、删除只在侧栏聊天行的菜单里。有标题的聊天改图标也挪进了“…”（网页和 Android 用顶栏标题前的图标按钮），空白首页的标题块仍是图标按钮。还没保存的新聊天没有“…”。
- **工作区的页面类型筛选**在浮动顶栏里、菜单旁边（网页和 Android 在首页的内容里，跟着列表滚动）。
- **编辑页的保存状态**在标题下面（网页和 Android 是顶栏按钮中间的一个胶囊）。
- **提示条的位置**：Android 用系统的 Toast；iOS 的提示条画在独立窗口里，放在当前标签页量到的底部遮挡上方 8（标签栏、浮动底栏和 Home 指示条，聊天里包括输入栏；`NFBottomChrome`），键盘开着时在键盘上方 12，没有标签栏时离底 16，还没量到时离底 84（`toastBottomClearance`）。

## 生成的文件

这些文件由脚本从 Android / 网页的源头生成，不手改。前三个有 vitest 测试，生成物过期时失败；`AppIcon-1024.png` 没有测试，改了 `src/app/icon.svg` 要自己重跑脚本。

| 文件 | 来源 | 脚本 |
| --- | --- | --- |
| `Resources/*.lproj/Localizable.strings` | Android 的 `res/values*/strings*.xml` | `npx tsx scripts/gen-ios-strings.ts` |
| `Core/Support/CharactersData.generated.swift` | `src/lib/characters.ts` | `npx tsx scripts/gen-ios-characters.ts` |
| `Tests/NoteFableCoreTests/Fixtures/search-fold-cases.json` | `src/lib/search-fold.ts` 的用例 | `npx tsx scripts/gen-native-search-fold-cases.ts` |
| `Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 角色 Quill | `npx tsx scripts/gen-ios-app-icon.ts` |

新文案的流程：先加到 Android 的 `res/values`（及 zh、ja），跑 Android 的生成脚本，再跑 `gen-ios-strings.ts`。iOS 里用 `L("键", 参数…)`，键就是 Android 的资源名。只有 iOS 才需要的文案（Android 交给系统界面的地方）写在 `scripts/ios-strings.ts` 的 `IOS_ONLY_STRINGS` 里，17 种语言都要写。

## 构建与验证

没有 Mac 时：

- Core：`docker run --rm -v "<仓库>/mobile/ios:/src:ro" -v "<仓库>/mobile/android/app/src/main/assets:/android-assets:ro" -v nf-ios-build:/build swift:6.1 bash /src/scripts/core-check.sh test`（和 Android 共用的 JSON 资源挂在 `/android-assets`；不挂的话读这些资源的测试会跳过）
- 界面层只能查语法：`swiftc -frontend -parse`（命令见 README）。**类型错误只有 CI 能发现**：改到 `mobile/ios/**` 的 PR 会在 `xcode-27` 镜像上跑 `swift test`、`xcodegen generate` 和模拟器无签名构建，失败时 “Compiler errors” 一步列出全部错误。macOS 机器按高倍率计分钟数，尽量攒够改动再推。

有 Mac 时：`brew install xcodegen && cd mobile/ios && xcodegen generate && open NoteFable.xcodeproj`。

界面截图：PR 带 `ios-screenshots` 标签时 CI 在模拟器上以 fixture 模式截图（变体和张数见 [ios.md](ios.md)，场景和启动参数见 [README](../../mobile/ios/README.md)）。玻璃外壳有专门的场景：`chat-scrolled`（消息滚到两条浮动栏下面，出现“滚动到底部”）、`emoji-picker`（改聊天图标，自适应原生选择器）、`chat-composer`（输入卡片里有附上的页面、一张图片和两行草稿）、`chat-keyboard`（引用后输入框聚焦、键盘弹出）、`toast`（输入栏上方的提示条）、`chat-streamed`（新聊天里答完的回答）、`search-scrolled`、`settings-page`（“通用”页打开图标的角色选择、滚到卡片底）、`workspace-scrolled`、`editor-scrolled`（定位到行程的 Day 2）、`editor-locked`（锁定且公开的笔记）、`editor-whiteboard`、`editor-slides`。每个场景的 `NF_FIXTURE_READY` 行带 `glass=`（`NFChromePath`：iOS 26+ 应为 `native`，更早的系统为 `material`，“降低透明度”变体为 `solid`，不符时截图任务失败）、`keyboard=up|down`（`chat-keyboard` 没弹出软键盘时只记警告）和 `increaseContrast=`（`hc` 变体必须是 `true`）。

截图看不出、要在 TestFlight 真机上看的：输入栏走 `safeAreaBar` 时是否跟着键盘升降（包括拖动列表收起键盘；不跟时把 `ChatChrome.composerUsesSystemBar` 改成 `false`）、聊天里标签栏随滚动收起和展开（不对时把 `ChatChrome.tabBarMinimize` 改成 `.never`）、可交互玻璃（顶栏圆钮、按钮组、标题胶囊）的按压反馈。App 同时面向 iPhone 和 iPad（`TARGETED_DEVICE_FAMILY` 为 `1,2`）。浮动外壳按当前窗口排版：聊天列、输入卡片与搜索列收到 760、工作区收到 960，弹层和对话框列表按窗口高度封顶；宽且足够高的窗口（`AdaptiveLayout.supportsDockedSidebar`：可用宽 `>= 640pt` 且窗口总高 `>= 560pt`，覆盖 iPad 与展开态 iPhone Duo 竖/横屏）默认常驻侧栏并可手动收起，窄屏或低矮横屏手机保持推入式抽屉。PR 检查的 iPad 截图覆盖浅色 / 深色 / 阿拉伯语 RTL / 降低透明度下的聊天（常驻展开与 `sidebar-collapsed` 收起）、表情选择器（常规宽 `.popover`）、检索、工作区、编辑页与页面菜单（`.popover`）、设置与登录；iPad 横竖屏切换、调整过大小的多任务窗口、分屏和 iPhone Duo 双屏及折叠 / 展开也还待真机或本地 Mac 模拟器逐项验证。

发布：只在需要上传 TestFlight 的 PR 里调高 `project.yml` 的 `CURRENT_PROJECT_VERSION`（[ios.md](ios.md)）。
