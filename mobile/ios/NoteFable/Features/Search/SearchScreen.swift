import SwiftUI

// 全屏检索：网页 search-dialog.tsx 在手机宽度（< 640）下的全屏面板（search-dialog.css 的 @media (max-width: 639px)），
// Android ui/SearchScreen.kt。由根视图用 `.nfPanel(isPresented:)` 挂出来（白底，从下方 32 处淡入上移 200ms ease-out）。
// 以下数值是网页在 412×915 下的实测：
//   输入行 高 60（左 14.4、右 8，间距 9.6，下边 1px 线）：搜索图标 18 灰、输入框 16 高 48、转圈 16（800ms 一圈）、关闭 40（X 18，圆角 6）。
//   工具行（上下 6.4、左右 12，下边 1px 线）：标签 高 40、左右 14.4、15、圆角 6，选中 --notion-active 底 + 600，其余灰 + 500，间距 4；
//     Chats 标签页且有项目时右侧是项目筛选（高 40、最宽 48%、1px 线、圆角 6、左右 6.4、16 灰）。
//   结果区（上 5.6、左右 6.4、下 12）：分组标题 12 / 600 灰（上 8、左右 9.6、下 4）；
//     行 最小高 52、内边距 9.6、圆角 6、间距 10.4，当前行 --notion-hover 底；图标区 22.4（上 0.8，表情 16 / 图标 16 灰）；
//     标题 15 / 500 单行，后面 8 处项目名 / 白板、幻灯片的类型名 12 浅灰（最宽 40%）；摘录 13 行高 1.4 灰、最多两行，命中词黄色底 rgba(255,207,0,.4)；
//     附件命中时摘录前是 回形针 12 + "in 文件名" 12 / 500 正文色；日期 12 浅灰，上距 2.4。
//   空 / 失败 / 无结果：内边距 20×12.8、间距 6.4，标题 15 / 600 正文色，说明 14 行高 21 灰；“检索中”是转圈 16 + 14 灰字，间距 8。
//   键盘提示（"Use ↑ ↓ to move…"）在触屏上不显示（@media (hover: none)）。
// 规则（防抖、取消、保留旧结果、分组顺序）在 Core 的 `SearchViewModel` / `SearchPresentation`。

/// 命中词的黄色底（网页 <mark>：rgba(255,207,0,.4)）。
private let SearchMarkColor = Color(argb: 0x66FFCF00)

/// 全屏检索。每次打开都是空的（网页只在打开时挂载面板）：`SearchViewModel` 在这里新建，关掉时停掉还在等的请求。
struct SearchScreen: View {
    @Environment(AppEnvironment.self) private var app
    @State private var model: SearchViewModel? = nil

    init() {}

    var body: some View {
        ZStack {
            if let model {
                SearchPanel(model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear {
            if model == nil { model = app.makeSearchViewModel() }
        }
        .onDisappear { model?.close() }
    }
}

private struct SearchPanel: View {
    let model: SearchViewModel

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @FocusState private var focused: Bool
    @State private var toolbarWidth: CGFloat = 0

    var body: some View {
        let chat = app.chat.state
        let projects = app.sidebar.state.projects
        // 筛选里把当前聊天所在的项目排在最前；在聊天界面时 Chats 组在前，在笔记界面时 Notes 在前。
        let currentProjectId = chat.sessions.first { $0.id == chat.activeSessionId }?.projectId
        let chatFirst = app.notes.state.workspace == .chat
        let state = model.state
        let view = model.view(currentProjectId: currentProjectId, chatFirst: chatFirst)

        VStack(spacing: 0) {
            inputRow(state, view)
            toolbar(state, view)
            results(state, view)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .onChange(of: projects, initial: true) { _, list in
            model.setProjects(list)
        }
        .task {
            // 等面板进了窗口再聚焦，太早设会被忽略。
            try? await Task.sleep(nanoseconds: 80_000_000)
            focused = true
        }
    }

    // ---- 输入行 ----

    private func inputRow(_ state: SearchUiState, _ view: SearchView) -> some View {
        HStack(spacing: 9.6) {
            LucideIcon(Lucide.search, size: 18, color: Sm.muted)
            TextField(
                "",
                text: Binding(get: { model.state.input }, set: { model.setInput($0) }),
                prompt: Text(L("search_chats_and_notes")).foregroundStyle(Sm.faint)
            )
            .textFieldStyle(.plain)
            .font(.nf(16))
            .foregroundStyle(Sm.text)
            .tint(Sm.ink)
            .focused($focused)
            .submitLabel(.search)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .onSubmit {
                // 网页的 Enter：结果是当前条件的才打开高亮的那一行。
                if let hit = view.submitTarget(state.active) { select(hit) }
            }
            .frame(height: 48)
            .frame(maxWidth: .infinity)
            .accessibilityLabel(L("search_chats_and_notes"))

            if view.loading {
                Spinner(size: 16, duration: 0.8)
            }
            NFIconButton(Lucide.x, label: L("search_close"), iconSize: 18, cornerRadius: 6) {
                router.searchOpen = false
            }
        }
        .padding(.leading, 14.4)
        .padding(.trailing, 8)
        .frame(height: 60)
        .overlay(alignment: .bottom) { NFDivider() }
    }

    // ---- 工具行：标签 + 项目筛选 ----

    private func toolbar(_ state: SearchUiState, _ view: SearchView) -> some View {
        HStack(spacing: 0) {
            HStack(spacing: 4) {
                SearchTab(title: L("search_tab_all"), selected: state.scope == .all) { model.setScope(.all) }
                SearchTab(title: L("search_tab_chats"), selected: state.scope == .chats) { model.setScope(.chats) }
                SearchTab(title: L("notes"), selected: state.scope == .notes) { model.setScope(.notes) }
            }
            Spacer(minLength: 8)
            if state.scope == .chats && !view.projectOptions.isEmpty {
                SearchProjectFilter(options: view.projectOptions, selected: view.projectId) { id in
                    model.setProject(id)
                }
                .frame(maxWidth: max(0, toolbarWidth * 0.48), alignment: .trailing)
            }
        }
        .frame(maxWidth: .infinity)
        .nfOnSizeChange { size in
            if toolbarWidth != size.width { toolbarWidth = size.width }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6.4)
        .overlay(alignment: .bottom) { NFDivider() }
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

    /// 选了一条结果：聊天结果切到聊天并定位到命中的消息；笔记结果用结果里的标题、图标和页面类型打开（列表还没读过也能开）。
    /// 两个入口都会先关掉检索面板和抽屉（和网页一样先关检索再跳转）。
    private func select(_ hit: SearchHit) {
        switch hit {
        case .note(let note):
            router.openNote(note.id, title: note.title, icon: note.icon, kind: note.pageKind)
        case .chat(let chat):
            router.openChat(chat.id, messageId: chat.messageId)
        }
    }
}

// MARK: - 标签和筛选

private struct SearchTab: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.nf(15, weight: selected ? 600 : 500))
                .foregroundStyle(selected ? Sm.text : Sm.muted)
                .lineLimit(1)
                .padding(.horizontal, 14.4)
                .frame(height: 40)
        }
        .buttonStyle(.pressable(background: selected ? Sm.active : Color.clear, cornerRadius: 6))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// 项目筛选（网页是原生 <select>，这里用系统的菜单）：触发框按最长的选项定宽（外面再限制到 48%），箭头在行尾。
private struct SearchProjectFilter: View {
    let options: [ChatProjectSummary]
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        let allLabel = L("search_all_projects")
        let names = [allLabel] + options.map(\.name)
        let current = options.first { $0.id == selected }?.name ?? allLabel
        Menu {
            Picker(L("search_project"), selection: Binding(get: { selected }, set: { onSelect($0) })) {
                Text(allLabel).tag("")
                ForEach(options) { project in
                    Text(project.name).tag(project.id)
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
                        .foregroundStyle(Sm.muted)
                        .lineLimit(1)
                }
                LucideIcon(Lucide.chevronDown, size: 14, color: Sm.muted)
                    .layoutPriority(1)
            }
            .padding(.horizontal, 7.4)
            .frame(height: 40)
            .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(Sm.border, lineWidth: 1) }
            .contentShape(Rectangle())
        }
        .accessibilityLabel(L("search_project"))
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
        }
        .scrollDismissesKeyboard(.interactively)
        // 检索中的旧结果淡到 0.5：.search-list.is-stale 的 transition 只写在 is-stale 上，所以变淡用 120ms ease，恢复是立即的。
        .opacity(view.loading ? 0.5 : 1)
        .animation(view.loading && !reduceMotion ? NFMotion.cssEase(0.12) : nil, value: view.loading)
        .accessibilityLabel(L("search_results"))
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
