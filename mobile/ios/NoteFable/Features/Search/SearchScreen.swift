import SwiftUI

// 全屏检索：网页 search-dialog.tsx 在手机宽度（< 640）下的全屏面板（search-dialog.css 的 @media (max-width: 639px)），
// Android ui/SearchScreen.kt。iOS 上是底部 `TabView` 里常驻的搜索标签页（RootView）。
// 顶部是浮动的玻璃顶栏（#195，`nfFloatingHeader`）：结果从它下面滚过（iOS 26 系统的滚动边缘效果；iOS 17–18 是 Material.bar 底 +
// 细线；减弱透明度时是不透明的页面底 + 细线）。顶栏左右 16、上 6、下 8，两行间距 8：
//   输入行：抽屉的玻璃圆按钮 44（Menu 20）+ 间距 8 + 玻璃检索框（胶囊，高 44，左 14 / 右 4）：搜索图标 17、输入框 16、
//     行尾转圈 16（800ms 一圈）或清除 32（X 16，全圆）。两者在同一个 GlassEffectContainer 里。
//   工具行：三个标签在一个玻璃胶囊里（内边距 4、间距 4）：标签 高 40、左右 14.4、15，选中 --notion-active 底 + 600，其余 500；
//     Chats 标签页且有项目时右侧是项目筛选、Notes 标签页是类型筛选（系统菜单，触发框是高 40、左右 12 的玻璃胶囊，最宽 48%，16）。
//     筛选的菜单不放进 GlassEffectContainer（FORUM 826863 / 799491：容器里的 Menu 收起时会闪）。
// 以下数值是网页在 412×915 下的实测：
//   结果区（上 5.6、左右 6.4、下 12）：分组标题 12 / 600 灰（上 8、左右 9.6、下 4）；
//     行 最小高 52、内边距 9.6、圆角 6、间距 10.4，当前行 --notion-hover 底；图标区 22.4（上 0.8，表情 16 / 图标 16 灰）；
//     标题 15 / 500 单行，后面 8 处项目名 / 白板、幻灯片的类型名 12 浅灰（最宽 40%）；摘录 13 行高 1.4 灰、最多两行，命中词黄色底 rgba(255,207,0,.4)；
//     附件命中时摘录前是 回形针 12 + "in 文件名" 12 / 500 正文色；日期 12 浅灰，上距 2.4。
//   空 / 失败 / 无结果：内边距 20×12.8、间距 6.4，标题 15 / 600 正文色，说明 14 行高 21 灰；“检索中”是转圈 16 + 14 灰字，间距 8。
//   键盘提示（"Use ↑ ↓ to move…"）在触屏上不显示（@media (hover: none)）。
// 规则（防抖、取消、保留旧结果、分组顺序）在 Core 的 `SearchViewModel` / `SearchPresentation`。

/// 命中词的黄色底（网页 <mark>：rgba(255,207,0,.4)）。
private let SearchMarkColor = Color(argb: 0x66FFCF00)

/// 搜索标签页。常驻在底部 `TabView` 里；身份切换时重建模型，避免残留上一位用户的检索结果。
struct SearchScreen: View {
    @Environment(AppEnvironment.self) private var app
    @State private var model: SearchViewModel? = nil
    @State private var modelIdentity = -1

    init() {}

    var body: some View {
        ZStack {
            if let model {
                SearchPanel(model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Sm.background)
        .onAppear {
            syncModel()
        }
        .onChange(of: app.identityGeneration) { _, _ in
            syncModel()
        }
        .onDisappear { model?.close() }
    }

    private func syncModel() {
        if model == nil || modelIdentity != app.identityGeneration {
            model?.close()
            modelIdentity = app.identityGeneration
            model = app.makeSearchViewModel()
        }
    }
}

private struct SearchPanel: View {
    let model: SearchViewModel

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @State private var toolbarWidth: CGFloat = 0

    var body: some View {
        let chat = app.chat.state
        let projects = app.sidebar.state.projects
        // 筛选里把当前聊天所在的项目排在最前；在聊天界面时 Chats 组在前，在笔记界面时 Notes 在前。
        let currentProjectId = chat.sessions.first { $0.id == chat.activeSessionId }?.projectId
        let chatFirst = app.notes.state.workspace == .chat
        let state = model.state
        let view = model.view(currentProjectId: currentProjectId, chatFirst: chatFirst)

        // 结果区是底：顶栏浮在它上面，结果的滚动区一直铺到屏幕顶，从玻璃顶栏下面滚过；
        // 空 / 失败 / 检索中的说明排在顶栏下面（顶栏算在安全区里）。滚动区铺满详情宽度，内容列在宽窗口下收窄到 760pt 居中。
        results(state, view)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            // 底部被标签栏挡住多少（提示条的位置）：放在顶栏里面的内容上。
            .nfReportsBottomChrome(.search)
            .nfFloatingHeader(edge: .top) {
                VStack(spacing: NFChromeMetrics.gap) {
                    inputRow(state, view)
                    toolbar(state, view)
                }
                .padding(.horizontal, NFChromeMetrics.sideInset)
                .padding(.top, 6)
                .padding(.bottom, 8)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
                // 浮动顶栏排在结果后面（safeAreaBar）：读屏仍然先念顶栏（抽屉、检索框、标签），和原来在最上面时一样。
                .accessibilityElement(children: .contain)
                .accessibilitySortPriority(1)
            }
            .onChange(of: projects, initial: true) { _, list in
                model.setProjects(list)
            }
            // 类型筛选的选项跟着服务端的表（笔记列表读到的 kinds）：换了就重新检索。
            .onChange(of: app.notes.state.kinds, initial: true) { _, list in
                model.setKinds(list)
            }
            .task {
                // 还没读过笔记列表时（从聊天直接打开检索）顺便读一次：页面类型的表跟着 GET /api/pages 的 kinds。
                let notes = app.notes
                if !notes.state.loaded && !notes.state.loading { notes.refresh() }
            }
            .task(id: ScreenshotHooks.sceneTick) {
                guard ScreenshotHooks.isActive else { return }
                if ScreenshotHooks.scene == .search {
                    if ScreenshotHooks.consume(.search), let query = ScreenshotHooks.searchQuery {
                        model.setInput(query)
                    }
                } else if ScreenshotHooks.scene == .searchScrolled,
                          let query = ScreenshotHooks.searchQuery,
                          model.state.input != query {
                    // search-scrolled 用同一个检索词（接在 search 后面时已经是它了）；滚动和 markReady 在结果列表里。
                    model.setInput(query)
                }
            }
            .onChange(of: state.loaded, initial: true) { _, _ in
                guard ScreenshotHooks.isActive, ScreenshotHooks.scene == .search, !view.groups.isEmpty else { return }
                ScreenshotHooks.markReady(.search)
            }
    }

    // ---- 输入行：抽屉的玻璃圆按钮 + 玻璃检索框（同一个 GlassEffectContainer）----

    private func inputRow(_ state: SearchUiState, _ view: SearchView) -> some View {
        NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
            HStack(spacing: NFChromeMetrics.gap) {
                if !router.isSidebarDockedVisible {
                    NFGlassIconButton(Lucide.menu, label: L("open_menu"), size: NFChromeMetrics.control, iconSize: 20) {
                        router.openSidebar()
                    }
                }
                GlassSearchField(
                    text: Binding(get: { model.state.input }, set: { model.setInput($0) }),
                    loading: view.loading
                ) {
                    // 网页的 Enter：结果是当前条件的才打开高亮的那一行。
                    if let hit = view.submitTarget(state.active) { select(hit) }
                }
            }
        }
    }

    // ---- 工具行：标签（玻璃胶囊）+ 项目 / 类型筛选 ----

    private func toolbar(_ state: SearchUiState, _ view: SearchView) -> some View {
        HStack(spacing: 0) {
            NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
                HStack(spacing: 4) {
                    SearchTab(title: L("search_tab_all"), selected: state.scope == .all) { model.setScope(.all) }
                    SearchTab(title: L("search_tab_chats"), selected: state.scope == .chats) { model.setScope(.chats) }
                    SearchTab(title: L("notes"), selected: state.scope == .notes) { model.setScope(.notes) }
                }
                .padding(4)
                .nfGlassCapsule()
            }
            // 窄屏放不下时先省略右边的筛选，不省略标签名。
            .layoutPriority(1)
            Spacer(minLength: 8)
            // 筛选是系统菜单：放在 GlassEffectContainer 外面。
            if state.scope == .chats && !view.projectOptions.isEmpty {
                SearchFilter(
                    options: [("", L("search_all_projects"))] + view.projectOptions.map { ($0.id, $0.name) },
                    selected: view.projectId, label: L("search_project")
                ) { id in
                    model.setProject(id)
                }
                .frame(maxWidth: max(0, toolbarWidth * 0.48), alignment: .trailing)
            }
            // Notes 的类型筛选（网页 search-dialog 的「Page type」，#168）：能新建的类型有两种以上时才出现。
            if state.scope == .notes && !view.kindOptions.isEmpty {
                SearchFilter(
                    options: [("", L("ws_all_types"))] + view.kindOptions.map { ($0.wire, L(pageKindSectionLabel($0))) },
                    selected: view.kind, label: L("ws_page_type")
                ) { wire in
                    model.setKind(wire)
                }
                .frame(maxWidth: max(0, toolbarWidth * 0.48), alignment: .trailing)
            }
        }
        .frame(maxWidth: .infinity)
        .nfOnSizeChange { size in
            if toolbarWidth != size.width { toolbarWidth = size.width }
        }
    }

    // ---- 结果区 ----

    @ViewBuilder
    private func results(_ state: SearchUiState, _ view: SearchView) -> some View {
        switch view.content {
        case .idle:
            SearchEmptyBlock(title: L("search_idle_title"), message: L("search_idle_body"))
        case .failed:
            SearchEmptyBlock(title: L("search_unavailable_title"), message: L("search_unavailable_body")) {
                NotionButton(L("search_try_again")) { model.retry() }
            }
        case .searching:
            HStack(spacing: 8) {
                Spinner(size: 16, duration: 0.8)
                Text(L("search_searching"))
                    .font(.nf(14))
                    .nfLineHeight(21, fontSize: 14)
                    .foregroundStyle(Sm.muted)
            }
            .padding(.horizontal, 19.2)
            .padding(.top, 25.6)
            .padding(.bottom, 20)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        case .noResults(let query):
            SearchEmptyBlock(title: L("search_no_results", query), message: L("search_no_results_body"))
        case .results:
            SearchResultList(
                view: view,
                active: view.activeIndex(state.active),
                locale: Locale(identifier: app.language.active.tag ?? app.language.uiLocale)
            ) { index, hit in
                model.setActive(index)
                select(hit)
            }
        }
    }

    /// 选了一条结果：聊天结果切到聊天并定位到命中的消息；笔记结果用结果里的标题、图标和页面类型打开（列表还没读过也能开），
    /// 编辑器读好后滚动 / 移动到命中的块（笔记）或元素（白板）。
    /// 两个入口都会先关掉检索面板和抽屉（和网页一样先关检索再跳转）。
    private func select(_ hit: SearchHit) {
        switch hit {
        case .note(let note):
            router.openNote(note.id, title: note.title, icon: note.icon, kind: note.pageKind, reveal: note.blockId)
        case .chat(let chat):
            router.openChat(chat.id, messageId: chat.messageId)
        }
    }
}

// MARK: - 检索框、标签和筛选

/// 浮动顶栏里的检索框：普通（不可交互）玻璃胶囊，高 44、左 14 / 右 4；搜索图标 17 + 输入框（16 字）+ 行尾的转圈或清除键。
/// 点在框里的空白处（图标、输入框上下、行尾）也让输入框获得焦点；按下不弹（不是按钮）。
/// 玻璃上的字和图标：iOS 26 玻璃上用系统的 primary / secondary（随玻璃下的内容自动变深浅），其余路径是品牌的正文色 / 灰。
/// 换路径（减弱透明度）只换颜色值，输入框不重建，焦点和输入法状态都留着。
private struct GlassSearchField: View {
    @Binding private var text: String
    private let loading: Bool
    private let submit: () -> Void

    @Environment(\.nfChromePath) private var chromePath
    @FocusState private var focused: Bool

    init(text: Binding<String>, loading: Bool, submit: @escaping () -> Void) {
        _text = text
        self.loading = loading
        self.submit = submit
    }

    var body: some View {
        let path = chromePath
        HStack(spacing: 8) {
            LucideIcon(Lucide.search, size: 17, color: path.secondaryInk)
                // 点在图标上落到下面的焦点层。
                .allowsHitTesting(false)
            TextField(
                "",
                text: $text,
                prompt: Text(L("search_chats_and_notes")).foregroundStyle(path == .native ? Color.secondary : Sm.faint)
            )
            .textFieldStyle(.plain)
            .font(.nf(16))
            .foregroundStyle(path.primaryInk)
            .tint(Sm.ink)
            .focused($focused)
            .submitLabel(.search)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .onSubmit(submit)
            .frame(height: NFChromeMetrics.control)
            .frame(maxWidth: .infinity)
            .accessibilityLabel(L("search_chats_and_notes"))

            if loading {
                Spinner(size: 16, color: path.secondaryInk, duration: 0.8)
            } else if !text.isEmpty {
                NFIconButton(
                    Lucide.x, label: L("em_clear_search"), size: 32, iconSize: 16,
                    color: path.secondaryInk, cornerRadius: 16
                ) {
                    text = ""
                }
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .frame(height: NFChromeMetrics.control)
        .background {
            // 焦点层在内容后面：输入框和清除键照常收到点按，只有落在空白处的点按才到这里。
            Color.clear
                .contentShape(Capsule())
                .onTapGesture { focused = true }
                // 读屏只念输入框和清除键，这层空白不单独成为一个可点的元素。
                .accessibilityHidden(true)
        }
        .nfGlassCapsule()
    }
}

private struct SearchTab: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.nf(15, weight: selected ? 600 : 500))
                .foregroundStyle(selected ? chromePath.primaryInk : chromePath.secondaryInk)
                .lineLimit(1)
                .padding(.horizontal, 14.4)
                .frame(height: 40)
        }
        // 玻璃胶囊里的一段：选中的是 --notion-active 的全圆角底。
        .buttonStyle(.pressable(background: selected ? Sm.active : Color.clear, cornerRadius: 20))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// 筛选（项目、类型；网页是原生 <select>，这里用系统的菜单）：触发框按最长的选项定宽（外面再限制到 48%），箭头在行尾。
/// 触发框是高 40、左右 12 的玻璃胶囊（普通玻璃）；菜单本身不放进 GlassEffectContainer（FORUM 826863 / 799491）。
/// [options] 是（值, 名字），第一项是“全部”（值 ""）。[label] 是读屏名字。
private struct SearchFilter: View {
    let options: [(String, String)]
    let selected: String
    let label: String
    let onSelect: (String) -> Void

    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let names = options.map(\.1)
        let current = options.first { $0.0 == selected }?.1 ?? names.first ?? ""
        let ink = chromePath.secondaryInk
        Menu {
            Picker(label, selection: Binding(get: { selected }, set: { onSelect($0) })) {
                ForEach(Array(options.enumerated()), id: \.offset) { entry in
                    Text(entry.element.1).tag(entry.element.0)
                }
            }
        } label: {
            HStack(spacing: 4) {
                ZStack(alignment: .leading) {
                    // 看不见的全部选项：把宽度撑到最长的那一项，选哪一项都不变宽变窄。
                    ForEach(Array(names.enumerated()), id: \.offset) { entry in
                        Text(entry.element)
                            .font(.nf(16))
                            .lineLimit(1)
                            .hidden()
                    }
                    Text(current)
                        .font(.nf(16))
                        .foregroundStyle(ink)
                        .lineLimit(1)
                }
                LucideIcon(Lucide.chevronDown, size: 14, color: ink)
                    .layoutPriority(1)
            }
            .padding(.horizontal, 12)
            .frame(height: 40)
            .nfGlassCapsule()
            .contentShape(Capsule())
        }
        .accessibilityLabel(label)
    }
}

// MARK: - 空 / 失败 / 无结果

private struct SearchEmptyBlock<Action: View>: View {
    private let title: String
    private let message: String
    private let action: Action

    init(title: String, message: String, @ViewBuilder action: () -> Action) {
        self.title = title
        self.message = message
        self.action = action()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6.4) {
            Text(title)
                .font(.nf(15, weight: 600))
                .nfLineHeight(22.5, fontSize: 15)
                .foregroundStyle(Sm.text)
                .fixedSize(horizontal: false, vertical: true)
            Text(message)
                .font(.nf(14))
                .nfLineHeight(21, fontSize: 14)
                .foregroundStyle(Sm.muted)
                .fixedSize(horizontal: false, vertical: true)
            action
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // 结果区的内边距（上 5.6、左右 6.4）+ 自己的 20×12.8。
        .padding(.horizontal, 19.2)
        .padding(.top, 25.6)
        .padding(.bottom, 20)
        .frame(maxWidth: 760, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .center)
    }
}

extension SearchEmptyBlock where Action == EmptyView {
    init(title: String, message: String) {
        self.init(title: title, message: message) { EmptyView() }
    }
}

// MARK: - 结果列表

private enum SearchListEntry: Identifiable {
    case header(isChats: Bool)
    case row(index: Int, hit: SearchHit)

    var id: String {
        switch self {
        case .header(let isChats): return "group:\(isChats)"
        case .row(_, let hit): return hit.key
        }
    }
}

private struct SearchResultList: View {
    let view: SearchView
    /// 高亮的行（已经夹在范围内）。
    let active: Int
    let locale: Locale
    let onSelect: (Int, SearchHit) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var entries: [SearchListEntry] {
        var list: [SearchListEntry] = []
        var base = 0
        for group in view.groups {
            list.append(.header(isChats: group.isChats))
            for (offset, hit) in group.results.enumerated() {
                list.append(.row(index: base + offset, hit: hit))
            }
            base += group.results.count
        }
        return list
    }

    var body: some View {
        let names = view.projectNames
        let rowCount = view.rows.count
        // 滚动区铺到屏幕顶（浮动顶栏算在它的内容边距里）：结果从玻璃顶栏下面滚过。
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(entries) { entry in
                        switch entry {
                        case .header(let isChats):
                            Text(L(isChats ? "search_tab_chats" : "notes"))
                                .font(.nf(12, weight: 600))
                                .nfLineHeight(18, fontSize: 12)
                                .foregroundStyle(Sm.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 9.6)
                                .padding(.top, 8)
                                .padding(.bottom, 4)
                                .accessibilityAddTraits(.isHeader)
                        case .row(let index, let hit):
                            SearchResultRow(
                                hit: hit,
                                terms: view.terms,
                                projectName: hit.projectName(names),
                                active: index == active,
                                locale: locale
                            ) {
                                onSelect(index, hit)
                            }
                        }
                    }
                }
                .padding(.horizontal, 6.4)
                .padding(.top, 5.6)
                .padding(.bottom, 12)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
            }
            .scrollDismissesKeyboard(.interactively)
            // 检索中的旧结果淡到 0.5：.search-list.is-stale 的 transition 只写在 is-stale 上，所以变淡用 120ms ease，恢复是立即的。
            .opacity(view.loading ? 0.5 : 1)
            .animation(view.loading && !reduceMotion ? NFMotion.cssEase(0.12) : nil, value: view.loading)
            .accessibilityLabel(L("search_results"))
            // 截图场景 search-scrolled：结果到了以后滚一段，让分组标题和前面的行从玻璃顶栏下面过去。
            .task(id: "\(ScreenshotHooks.sceneTick)-\(rowCount)") {
                await scrollForScreenshot(proxy)
            }
        }
    }

    /// search-scrolled：把第三行（不到三行时是最后一行）顶到顶栏下沿，然后报告就绪。
    /// 内容不够一屏时滚不动（系统把位置夹在范围里），画面停在原处。
    private func scrollForScreenshot(_ proxy: ScrollViewProxy) async {
        let rows = view.rows
        guard ScreenshotHooks.isActive, ScreenshotHooks.scene == .searchScrolled, let last = rows.last else { return }
        // 等列表第一次排好（LazyVStack 的行要先出现一次）。
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled, ScreenshotHooks.consume(.searchScrolled) else { return }
        let target = rows.count > 2 ? rows[2] : last
        proxy.scrollTo(target.key, anchor: .top)
        try? await Task.sleep(for: .milliseconds(300))
        ScreenshotHooks.markReady(.searchScrolled)
    }
}

private struct SearchResultRow: View {
    let hit: SearchHit
    let terms: [String]
    let projectName: String?
    let active: Bool
    let locale: Locale
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 10.4) {
                NFIconTile(
                    emoji: hit.icon,
                    fallback: hit.pageKind.map(pageKindIcon) ?? Lucide.messageSquareText,
                    box: 22.4, glyph: 16
                )
                .padding(.top, 0.8)

                VStack(alignment: .leading, spacing: 2.4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(searchHighlighted(hit.title, terms))
                            .font(.nf(15, weight: 500))
                            .foregroundStyle(Sm.text)
                            .lineLimit(1)
                        if let projectName {
                            headLabel(projectName)
                        }
                        // 白板、幻灯片在标题后面加类型名（和项目名同样的小字），打开前就知道会看到什么；笔记是默认，不加（网页 search-dialog.tsx）。
                        if let kindLabel = hit.kindLabel {
                            headLabel(L(kindLabel))
                        }
                    }
                    if !hit.snippet.isEmpty {
                        snippet
                            .font(.nf(13))
                            .foregroundStyle(Sm.muted)
                            // 行高 18.2（1.4）比 SF 13 的自然行高多出来的部分。
                            .lineSpacing(2.7)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Text(formatSearchDate(hit.updatedAt, locale: locale))
                    .font(.nf(12))
                    .foregroundStyle(Sm.faint)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.top, 2.4)
            }
            .padding(9.6)
            .frame(minHeight: 52, alignment: .top)
        }
        .buttonStyle(.pressable(background: active ? Sm.hover : Color.clear, cornerRadius: 6))
    }

    /// 标题后面的小字（.search-row-project：聊天的项目名、白板 / 幻灯片的类型名）：保持自己的宽度（最宽约 40%），
    /// 标题用剩下的、放不下省略。
    private func headLabel(_ text: String) -> some View {
        Text(text)
            .font(.nf(12))
            .foregroundStyle(Sm.faint)
            .lineLimit(1)
            .frame(maxWidth: 116, alignment: .leading)
            .fixedSize(horizontal: true, vertical: false)
    }

    /// 摘录：前面是说话人（"You: " / "NoteFable: "），命中附件正文时换成回形针 + "in 文件名"（不显示说话人）。
    private var snippet: Text {
        var body = AttributedString()
        var clip: Text?
        switch hit.snippetLead {
        case .file(let name):
            var label = AttributedString(" " + L("search_in_file", name) + "  ")
            label.font = Font.nf(12, weight: 500)
            label.foregroundColor = Sm.text
            body.append(label)
            if let image = SearchClipIcon.image {
                clip = Text(image).baselineOffset(-1.5)
            }
        case .you:
            body.append(AttributedString(L("search_speaker_you")))
        case .notefable:
            body.append(AttributedString(L("search_speaker_notefable")))
        case .none:
            break
        }
        body.append(searchHighlighted(hit.snippet, terms))
        if let clip { return clip + Text(body) }
        return Text(body)
    }
}

/// 命中词加黄色底。片段接起来等于原文（`SearchFold.splitHighlight`）。
private func searchHighlighted(_ text: String, _ terms: [String]) -> AttributedString {
    var out = AttributedString()
    for part in SearchFold.splitHighlight(text, terms) {
        var piece = AttributedString(part.text)
        if part.isMatch { piece.backgroundColor = SearchMarkColor }
        out.append(piece)
    }
    return out
}

/// 摘录里的回形针（lucide Paperclip 12，正文色）：文字里只能放图片，所以把图标画成一张图，只画一次。
@MainActor
private enum SearchClipIcon {
    static let image: Image? = {
        let renderer = ImageRenderer(content: LucideIcon(Lucide.paperclip, size: 12, color: Sm.text))
        renderer.scale = 3
        return renderer.uiImage.map { Image(uiImage: $0) }
    }()
}
