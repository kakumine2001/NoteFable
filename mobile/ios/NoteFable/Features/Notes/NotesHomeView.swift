import SwiftUI

// 工作区首页（网页 NotesHome；Android ui/NotesUi.kt 的 NotesHome）：悬浮顶栏放菜单与类型筛选，内容从下方滚过；
// Studio 头部（"Workspace" 30 / 750 + 胶囊按钮 New project / Import Markdown）→ Studio Quick-Create Deck 卡片 →
// 最近编辑 → 圆角卡片分组列表（带语义色图标块、Favorites 类型标签）。
// 笔记行长按后可以拖动排序；标题"Workspace"和分区小标题是"移出项目"的投放区，项目小标题是"移进项目"的。

@MainActor
struct NotesHomeView: View {
    @Binding private var dialog: NotesDialogState?
    @State private var reorder = ReorderDragController()
    @State private var importing = false
    @State private var kindFilter: PageKind?
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    // 网页 .notes-home 的含边距宽度上限。
    private static let columnMaxWidth: CGFloat = 960

    init(dialog: Binding<NotesDialogState?>) {
        self._dialog = dialog
    }

    var body: some View {
        let state = app.notes.state
        let selection = kindFilter
        #if DEBUG
        let workspaceSelected = router.selectedTab == .workspace
        let sceneKey = "\(ScreenshotHooks.sceneTick)-\(state.pages.count)-\(workspaceSelected)"
        #endif

        ScrollViewReader { scrollProxy in
            GeometryReader { geometry in
                home(state, selection: selection, gutter: geometry.size.width < 640 ? 20 : 48)
            }
            #if DEBUG
            .task(id: sceneKey) {
                guard ScreenshotHooks.isActive, ScreenshotHooks.scene == .workspaceScrolled,
                      workspaceSelected, !state.pages.isEmpty else { return }
                // 等列表排版后再滚动；FixtureLaunch 会等待画面稳定。
                try? await Task.sleep(for: .milliseconds(150))
                guard !Task.isCancelled, ScreenshotHooks.consume(.workspaceScrolled) else { return }
                scrollProxy.scrollTo(notesHomeFirstSectionID, anchor: .top)
                ScreenshotHooks.markReady(.workspaceScrolled)
            }
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .noteMarkdownImporter(isPresented: $importing)
        .onChange(of: app.identityGeneration) { _, _ in kindFilter = nil }
    }

    private func home(_ state: NotesUiState, selection: PageKind?, gutter: CGFloat) -> some View {
        let notes = app.notes
        let busy = state.busy || state.loading
        let nothing = state.pages.isEmpty && state.groups.isEmpty
        let kinds = state.kinds
        let filterKinds = !nothing && kinds.count > 1 ? kinds : []
        let activeFilter = selection.flatMap { filterKinds.contains($0) ? $0 : nil }

        return ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                if let error = state.error {
                    NotesErrorBar(notesErrorText(error, app.systemText), onRetry: { notes.refresh() })
                        .padding(.top, 12)
                }
                if state.loading && nothing {
                    Text(L("loading_notes"))
                        .font(.nf(14))
                        .foregroundStyle(Sm.muted)
                        .padding(.top, 96)
                        .padding(.bottom, 16)
                } else if nothing {
                    if state.error == nil && state.loaded {
                        NotesEmptyView(
                            kinds: kinds,
                            busy: busy,
                            onCreate: { notes.createNote(kind: $0) },
                            onGenerate: { router.openAiGenerate($0) },
                            onImportPptx: { router.openPptxImport() },
                            onImport: { importing = true }
                        )
                    }
                } else {
                    NotesHomeList(
                        busy: busy,
                        reorder: reorder,
                        onGenerate: { router.openAiGenerate($0) },
                        onImportPptx: { router.openPptxImport() },
                        onImport: { importing = true },
                        activeFilter: activeFilter,
                        dialog: $dialog
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, gutter)
            .padding(.bottom, 96)
            .frame(maxWidth: Self.columnMaxWidth)
            .reorderContainer(reorder, onStart: { [reorder] _ in
                NoteReorderOrigin.shared.surface = .home
                reorder.rules = { noteDropRules(notes.state) }
                notes.dismissReorderError()
            }) { id, target in
                notes.drop(id, on: target)
            }
            .frame(maxWidth: .infinity)
        }
        .nfReportsBottomChrome(.workspace)
        .nfFloatingHeader(edge: .top) {
            // 按钮行跟内容一样收窄，底条（降低透明度 / iOS 17–18）仍铺满窗口宽度。
            WorkspaceHomeBar(kinds: filterKinds, activeFilter: activeFilter) { kindFilter = $0 }
                .frame(maxWidth: Self.columnMaxWidth)
                .frame(maxWidth: .infinity)
                // 浮动顶栏排在滚动区后面（safeAreaBar）：读屏仍先念菜单和类型筛选，再进列表。
                .accessibilityElement(children: .contain)
                .accessibilitySortPriority(1)
        }
    }
}

@MainActor
private struct WorkspaceHomeBar: View {
    let kinds: [PageKind]
    let activeFilter: PageKind?
    let onSelect: (PageKind?) -> Void
    @Environment(AppRouter.self) private var router

    var body: some View {
        let showsSidebarToggle = !router.isSidebarDockedVisible
        NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
            HStack(spacing: NFChromeMetrics.gap) {
                if showsSidebarToggle {
                    NFGlassIconButton(Lucide.menu, label: L("open_menu"), size: NFChromeMetrics.control, iconSize: 20) {
                        router.openSidebar()
                    }
                }
                if kinds.isEmpty {
                    Spacer(minLength: 0)
                } else {
                    KindFilterBar(kinds: kinds, active: activeFilter, onSelect: onSelect)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(.horizontal, NFChromeMetrics.sideInset)
        .frame(height: NFChromeMetrics.barHeight)
    }
}

// MARK: - 列表

private struct HomeGroupEntry: Identifiable {
    let group: NoteGroupSummary
    let members: [NotePageSummary]
    let total: Int
    var id: String { group.id }
}

private struct HomeSectionEntry: Identifiable {
    let kind: PageKind
    let roots: [NotePageSummary]
    let count: Int
    var id: PageKind { kind }
}

@MainActor
private struct NotesHomeList: View {
    let busy: Bool
    let reorder: ReorderDragController
    let onGenerate: (AiGenerateTarget) -> Void
    let onImportPptx: () -> Void
    let onImport: () -> Void
    let activeFilter: PageKind?
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let kinds = state.kinds
        let multiKind = kinds.count > 1
        let groupIds = Set(state.groups.map(\.id))
        let matches: (NotePageSummary) -> Bool = { page in
            activeFilter == nil || state.sectionKind(of: page) == activeFilter
        }
        let visibleFavorites = state.favorites.filter(matches)
        let visibleGroups: [HomeGroupEntry] = {
            if activeFilter != nil {
                return state.groups.compactMap { group in
                    let members = state.pages.filter { $0.groupId == group.id && matches($0) }
                    return members.isEmpty ? nil : HomeGroupEntry(group: group, members: members, total: members.count)
                }
            }
            return state.groups.map { group in
                HomeGroupEntry(group: group, members: state.members(group.id), total: state.memberCount(group.id))
            }
        }()
        let visibleSections: [HomeSectionEntry] = {
            if let filter = activeFilter {
                let items = state.pages.filter { page in
                    let loose = page.groupId.map { !groupIds.contains($0) } ?? true
                    return loose && matches(page)
                }
                return items.isEmpty ? [] : [HomeSectionEntry(kind: filter, roots: items, count: items.count)]
            }
            return state.sections.filter { !$0.roots.isEmpty }.map {
                HomeSectionEntry(kind: $0.kind, roots: $0.roots, count: $0.count)
            }
        }()
        let filterEmpty = activeFilter != nil && visibleFavorites.isEmpty && visibleGroups.isEmpty && visibleSections.isEmpty

        // Studio 头部：Workspace 标题（移出项目投放区）+ 胶囊按钮 New project / Import Markdown / Import PowerPoint（仅幻灯片）
        VStack(alignment: .leading, spacing: 10) {
            Text(L("workspace"))
                .font(.nf(30, weight: 750))
                .tracking(layoutDirection == .rightToLeft ? 0 : -1.2)
                .nfLineHeight(36, fontSize: 30)
                .foregroundStyle(Sm.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .reorderDropZone("", in: reorder)
                .accessibilityAddTraits(.isHeader)
            ChatFlowLayout(spacing: 8, lineSpacing: 8) {
                NotesHomeUtilPill(icon: Lucide.folderPlus, title: L("new_project"), busy: busy) {
                    dialog = .newGroup
                }
                if state.showsImportMarkdown(for: activeFilter) {
                    NotesHomeUtilPill(icon: Lucide.upload, title: L("import_markdown"), busy: busy, action: onImport)
                }
                if kinds.contains(.slides) && (activeFilter == nil || activeFilter == .slides) {
                    NotesHomeUtilPill(icon: Lucide.upload, title: L("slides_import_pptx"), busy: busy, action: onImportPptx)
                }
            }
        }
        .padding(.top, 12)
        .padding(.bottom, 14)

        // 统一「用 AI 生成」输入卡（网页 WorkspaceAiEntry）：主输入区 + 角色 + 笔记 → 白板 → 幻灯片切换（与筛选同步）+ 选项 / 生成
        WorkspaceAiEntryView(kinds: kinds, activeFilter: activeFilter, busy: busy, onOpen: onGenerate)
            .padding(.bottom, 16)

        // Studio Quick-Create Deck 卡片（All 显示全部类型，选中单类型时仅显示该类型）
        CreateDeckCards(kinds: state.createKinds(for: activeFilter), busy: busy, onCreate: { notes.createNote(kind: $0) })
            .padding(.bottom, 18)

        // 最近编辑（网页 notes-recent-list）：仅显示当前筛选类型的页面，没有则隐藏。
        let recent = state.recentPages(for: activeFilter)
        if !recent.isEmpty {
            RecentNotesCarousel(recent: recent, busy: busy, multiKind: multiKind) { notes.openNote($0) }
                .padding(.bottom, 18)
        }

        // Favorites（圆角卡片 + 类型胶囊标签）
        if !visibleFavorites.isEmpty {
            let firstFavId = visibleFavorites.first?.id
            NotesHomeHeading(name: L("pg_favorites"), count: visibleFavorites.count, icon: Lucide.star, iconColor: Sm.kindFav)
                .notesHomeHeadingMargins()
                .notesHomeFirstSection(true)
            NotesHomeCard {
                ForEach(visibleFavorites) { page in
                    NotesHomeFavoriteItem(page: page, busy: busy, multiKind: multiKind, showTopDivider: page.id != firstFavId)
                }
            }
        }

        // Projects
        ForEach(visibleGroups) { entry in
            NotesHomeHeading(name: entry.group.name, count: entry.total, icon: Lucide.folder, iconColor: Sm.muted)
                .reorderDropZone(entry.group.id, in: reorder)
                .notesHomeHeadingMargins()
                .notesHomeFirstSection(visibleFavorites.isEmpty && entry.id == visibleGroups.first?.id)
            if entry.members.isEmpty {
                NotesHomeEmptyCard(L("no_notes_in_project"))
            } else {
                let firstMemberId = entry.members.first?.id
                NotesHomeCard {
                    ForEach(entry.members) { page in
                        NotesHomeTree(page: page, busy: busy, flat: activeFilter != nil, showTopDivider: page.id != firstMemberId, reorder: reorder, dialog: $dialog)
                    }
                }
            }
        }

        // 不在项目里的页面分区（Notes / Whiteboards / Slides）
        ForEach(visibleSections) { section in
            let hasHeading = multiKind || !state.groups.isEmpty
            let firstSection = visibleFavorites.isEmpty && visibleGroups.isEmpty && section.id == visibleSections.first?.id
            if hasHeading {
                NotesHomeHeading(
                    name: multiKind ? L(pageKindSectionLabel(section.kind)) : L("no_project"),
                    count: section.count,
                    icon: multiKind ? pageKindIcon(section.kind) : nil,
                    iconColor: multiKind ? pageKindColor(section.kind) : Sm.muted
                )
                .reorderDropZone(noteSectionZone(section.kind), in: reorder)
                .notesHomeHeadingMargins()
                .notesHomeFirstSection(firstSection)
            }
            let firstRootId = section.roots.first?.id
            NotesHomeCard {
                ForEach(section.roots) { page in
                    NotesHomeTree(page: page, busy: busy, flat: activeFilter != nil, showTopDivider: page.id != firstRootId, reorder: reorder, dialog: $dialog)
                }
            }
            .notesHomeFirstSection(firstSection && !hasHeading)
        }

        if filterEmpty {
            NotesHomeEmptyCard(L("sb_no_notes_match"))
                .notesHomeFirstSection(true)
        }
    }
}

// MARK: - Studio 组件（工具胶囊、快速创建卡、筛选栏、卡片容器）

struct NoteCoverBanner: View {
    let cover: String?
    let coverPosition: Int?
    let kind: PageKind
    @Environment(AppEnvironment.self) private var app
    @State private var loaded: LoadedImage? = nil

    var body: some View {
        let preset = NoteCovers.preset(cover)
        let imagePath = NoteCovers.imagePath(cover)
        ZStack {
            if let preset {
                if preset.startArgb == preset.endArgb {
                    Color(argb: preset.startArgb)
                } else {
                    LinearGradient(
                        colors: [Color(argb: preset.startArgb), Color(argb: preset.endArgb)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
            } else {
                LinearGradient(
                    colors: [pageKindSoft(kind), Sm.sidebar],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
            if let imagePath, let image = currentImage(imagePath) {
                GeometryReader { proxy in
                    let pos = Double(min(100, max(0, coverPosition ?? 50))) / 100.0
                    let targetW = proxy.size.width
                    let targetH = proxy.size.height
                    let imgAspect = image.size.height > 0 ? image.size.width / image.size.height : 1
                    let boxAspect = targetH > 0 ? targetW / targetH : 1
                    let renderedH = imgAspect > boxAspect ? targetH : targetW / max(imgAspect, 0.01)
                    let overflowY = max(0, renderedH - targetH)
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: targetW, height: renderedH)
                        .offset(y: -(overflowY * pos))
                        .frame(width: targetW, height: targetH, alignment: .top)
                        .clipped()
                }
            }
        }
        .clipped()
        .accessibilityHidden(true)
        .task(id: RemoteImageRequest(path: imagePath ?? "", generation: app.identityGeneration)) {
            guard let imagePath else { loaded = nil; return }
            let image = await RemoteImageLoader.image(imagePath, app: app)
            if Task.isCancelled { return }
            loaded = image.map { LoadedImage(path: imagePath, generation: app.identityGeneration, image: $0) }
        }
    }

    private func currentImage(_ path: String) -> UIImage? {
        if let image = loaded?.current(path, app: app) { return image }
        return RemoteImageLoader.cachedImage(path, app: app)
    }
}

@MainActor
private struct RecentNotesCarousel: View {
    let recent: [NotePageSummary]
    let busy: Bool
    let multiKind: Bool
    let onOpen: (String) -> Void
    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                LucideIcon(Lucide.clock3, size: 14, color: Sm.muted)
                Text(L("recently_edited"))
                    .font(.nf(13, weight: 600))
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, 4)

            ScrollView(.horizontal) {
                HStack(spacing: 10) {
                    ForEach(recent) { page in
                        let shape = RoundedRectangle(cornerRadius: 14)
                        let iconShape = RoundedRectangle(cornerRadius: 9)
                        let title = page.title.isEmpty ? L("sb_untitled") : page.title
                        Button {
                            onOpen(page.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 0) {
                                ZStack(alignment: .topTrailing) {
                                    NoteCoverBanner(cover: page.cover, coverPosition: page.coverPosition, kind: page.kind)
                                        .frame(height: 44)
                                        .overlay(alignment: .bottom) { NFDivider() }
                                    if multiKind {
                                        Text(L(pageKindLabel(page.kind)))
                                            .font(.nf(10.5, weight: 600))
                                            .foregroundStyle(pageKindTextColor(page.kind))
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 1.5)
                                            .background(chromePath == .solid ? AnyShapeStyle(Sm.surface.opacity(0.88)) : AnyShapeStyle(.ultraThinMaterial), in: Capsule())
                                            .overlay { Capsule().strokeBorder(Sm.border, lineWidth: 1) }
                                            .padding(6)
                                    }
                                }
                                VStack(alignment: .leading, spacing: 0) {
                                    NFIconTile(emoji: page.icon, fallback: pageKindIcon(page.kind), box: 30, glyph: 15, color: pageKindColor(page.kind))
                                        .background(Sm.surface, in: iconShape)
                                        .overlay { iconShape.strokeBorder(Sm.border, lineWidth: 1) }
                                        .shadow(color: Color(argb: 0x120F172A), radius: 2, x: 0, y: 1)
                                        .offset(y: -14)
                                    Text(title)
                                        .font(.nf(13.5, weight: 600))
                                        .nfLineHeight(18, fontSize: 13.5)
                                        .foregroundStyle(Sm.ink)
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                        .offset(y: -8)
                                    Spacer(minLength: 0)
                                    Text(noteShortDate(page.updatedAt))
                                        .font(.nf(11.5))
                                        .foregroundStyle(Sm.faint)
                                        .lineLimit(1)
                                }
                                .padding(.horizontal, 12)
                                .padding(.bottom, 10)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            }
                            .frame(width: 168, height: 132, alignment: .topLeading)
                        }
                        .buttonStyle(.pressable(background: Sm.surface, cornerRadius: 14, scale: 0.99, disabledOpacity: 0.55))
                        .overlay { shape.strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
                        .clipShape(shape)
                        .shadow(color: Color(argb: 0x0A0F172A), radius: 1, x: 0, y: 1)
                        .disabled(busy)
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
        }
    }
}

/// 头部的胶囊按钮（New project / Import Markdown）：它们是随列表滚动的内容，不是浮动外壳，所以保持网页的白底细线样式，
/// 不用玻璃（滚到玻璃顶栏下面时不会出现玻璃叠玻璃）。
private struct NotesHomeUtilPill<Leading: View>: View {
    let title: String
    let busy: Bool
    let leading: Leading
    let action: () -> Void

    init(title: String, busy: Bool, action: @escaping () -> Void, @ViewBuilder leading: () -> Leading) {
        self.title = title
        self.busy = busy
        self.leading = leading()
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                leading
                Text(title)
                    .font(.nf(13, weight: 520))
                    .foregroundStyle(Sm.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, 11.2)
            .frame(height: 34.4)
        }
        .buttonStyle(.pressable(background: Sm.surface, cornerRadius: 17.2, scale: 0.98, disabledOpacity: 0.5))
        .overlay { Capsule().strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
        .disabled(busy)
    }
}

extension NotesHomeUtilPill where Leading == LucideIcon {
    init(icon: [String], title: String, busy: Bool, action: @escaping () -> Void) {
        self.init(title: title, busy: busy, action: action) {
            LucideIcon(icon, size: 14, color: Sm.faint)
        }
    }
}

private let aiEntryKindOrder: [PageKind] = [.note, .whiteboard, .slides]

/// 工作区统一「用 AI 生成」输入卡（网页 .ws-ai-studio，适配 iPhone / iPad / iPhone Duo、深色与 RTL）：
/// 主输入区 + 角色 + 笔记 → 白板 → 幻灯片切换（与工作区筛选同步）+ 选项 / 生成。
@MainActor
private struct WorkspaceAiEntryView: View {
    let kinds: [PageKind]
    let activeFilter: PageKind?
    let busy: Bool
    let onOpen: (AiGenerateTarget) -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(\.layoutDirection) private var layoutDirection
    @State private var selectedKind: PageKind?
    @State private var prompt = ""
    @FocusState private var promptFocused: Bool

    private var available: [PageKind] {
        let filtered = aiEntryKindOrder.filter { kinds.contains($0) }
        return filtered.isEmpty ? [.note] : filtered
    }

    private var effectiveKind: PageKind {
        if let selectedKind, available.contains(selectedKind) { return selectedKind }
        if let activeFilter, available.contains(activeFilter) { return activeFilter }
        return available.first ?? .note
    }

    private var hasPrompt: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func launch(autoStart: Bool) {
        guard !busy else { return }
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { prompt = "" }
        if autoStart && !trimmed.isEmpty {
            onOpen(AiGenerateTarget(kind: effectiveKind, prompt: trimmed, autoStart: true))
        } else {
            onOpen(AiGenerateTarget(kind: effectiveKind, prompt: trimmed.isEmpty ? nil : trimmed, autoStart: false))
        }
    }

    var body: some View {
        let cardShape = RoundedRectangle(cornerRadius: 17.6, style: .continuous)
        let mascotShape = RoundedRectangle(cornerRadius: 11, style: .continuous)
        let trackShape = RoundedRectangle(cornerRadius: 10.4, style: .continuous)
        let pillShape = RoundedRectangle(cornerRadius: 7.7, style: .continuous)
        let currentKind = effectiveKind
        let borderColor = promptFocused ? pageKindBorder(currentKind) : Sm.borderStrong
        let tintCenter: UnitPoint = layoutDirection == .rightToLeft ? .topLeading : .topTrailing

        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 11) {
                AppIconView(icon: app.appIcon.icon, state: hasPrompt ? .typing : .idle, size: 28, animated: true)
                    .frame(width: 36, height: 36)
                    .background(Sm.hover, in: mascotShape)
                    .overlay { mascotShape.strokeBorder(Sm.border, lineWidth: 1) }
                    .padding(.top, 2)
                    .accessibilityHidden(true)

                TextField(L("ai_gen_placeholder"), text: $prompt, axis: .vertical)
                    .font(.nf(15))
                    .foregroundStyle(Sm.text)
                    .lineLimit(2...4)
                    .focused($promptFocused)
                    .disabled(busy)
                    .submitLabel(hasPrompt ? .send : .return)
                    .onSubmit {
                        if hasPrompt { launch(autoStart: true) }
                    }
                    .onChange(of: prompt) { _, value in
                        if value.count > 2000 { prompt = String(value.prefix(2000)) }
                    }
                    .frame(maxWidth: .infinity, minHeight: 46, alignment: .topLeading)
                    .padding(.vertical, 3)
                    .accessibilityLabel(L("slides_generate_with_ai"))
            }

            NFDivider()

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    kindPills(trackShape: trackShape, pillShape: pillShape, currentKind: currentKind)
                    Spacer(minLength: 4)
                    actionButtons
                }
                VStack(alignment: .leading, spacing: 8) {
                    ScrollView(.horizontal) {
                        kindPills(trackShape: trackShape, pillShape: pillShape, currentKind: currentKind)
                    }
                    .scrollIndicators(.hidden)
                    HStack {
                        Spacer(minLength: 0)
                        actionButtons
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 13)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack {
                cardShape.fill(Sm.surface)
                cardShape.fill(
                    RadialGradient(
                        colors: [pageKindSoft(currentKind).opacity(0.72), .clear],
                        center: tintCenter,
                        startRadius: 4,
                        endRadius: 240
                    )
                )
            }
        }
        .overlay { cardShape.strokeBorder(borderColor, lineWidth: 1).allowsHitTesting(false) }
        .clipShape(cardShape)
        .shadow(color: Color(light: 0x120F172A, dark: 0x3D000000), radius: 6, x: 0, y: 2)
        .onChange(of: activeFilter) { _, next in
            if let next, available.contains(next) {
                selectedKind = next
            }
        }
    }

    private func kindPills(trackShape: RoundedRectangle, pillShape: RoundedRectangle, currentKind: PageKind) -> some View {
        HStack(spacing: 2) {
            ForEach(available, id: \.self) { kind in
                let active = currentKind == kind
                Button {
                    Haptics.selection()
                    selectedKind = kind
                } label: {
                    HStack(spacing: 5.5) {
                        LucideIcon(pageKindIcon(kind), size: 13.5, color: active ? pageKindColor(kind) : Sm.muted)
                        Text(L(pageKindLabel(kind)))
                            .font(.nf(13, weight: active ? 600 : 540))
                            .foregroundStyle(active ? pageKindTextColor(kind) : Sm.muted)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 29.6)
                    .background {
                        if active {
                            pillShape.fill(Sm.surface)
                                .overlay { pillShape.strokeBorder(pageKindBorder(kind), lineWidth: 1).allowsHitTesting(false) }
                        }
                    }
                }
                .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 7.7, scale: 0.98))
                .disabled(busy)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(2)
        .background(Sm.hover, in: trackShape)
        .overlay { trackShape.strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("ws_page_type"))
    }

    private var actionButtons: some View {
        HStack(spacing: 6.4) {
            Button {
                launch(autoStart: false)
            } label: {
                HStack(spacing: 5.5) {
                    LucideIcon(Lucide.slidersHorizontal, size: 13.5, color: Sm.muted)
                    Text(L("ai_gen_options"))
                        .font(.nf(13, weight: 520))
                        .foregroundStyle(Sm.muted)
                        .lineLimit(1)
                }
                .padding(.horizontal, 10.4)
                .frame(height: 32)
            }
            .buttonStyle(.pressable(background: Color.clear, cornerRadius: 16, scale: 0.97, disabledOpacity: 0.5))
            .overlay { Capsule().strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
            .disabled(busy)

            Button {
                launch(autoStart: hasPrompt)
            } label: {
                HStack(spacing: 5.5) {
                    Text(L("ai_gen_generate"))
                        .font(.nf(13, weight: 600))
                        .foregroundStyle(Sm.onInk)
                        .lineLimit(1)
                    LucideIcon(Lucide.arrowUp, size: 14, color: Sm.onInk)
                }
                .padding(.horizontal, 13.6)
                .frame(height: 32)
            }
            .buttonStyle(.pressable(background: Sm.ink, pressedBackground: Sm.inkHover, cornerRadius: 16, scale: 0.97, disabledOpacity: 0.5))
            .disabled(busy)
            .accessibilityLabel(L("slides_generate_with_ai"))
        }
    }
}

private struct CreateDeckCards: View {
    let kinds: [PageKind]
    let busy: Bool
    let onCreate: (PageKind) -> Void

    var body: some View {
        VStack(spacing: 8) {
            ForEach(kinds, id: \.self) { kind in
                let cardShape = RoundedRectangle(cornerRadius: 14)
                let iconShape = RoundedRectangle(cornerRadius: 9)
                Button {
                    onCreate(kind)
                } label: {
                    HStack(spacing: 10) {
                        LucideIcon(pageKindIcon(kind), size: 17, color: pageKindColor(kind))
                            .frame(width: 32, height: 32)
                            .background(pageKindSoft(kind), in: iconShape)
                            .overlay { iconShape.strokeBorder(pageKindBorder(kind), lineWidth: 1) }
                        Text(L(pageKindNewLabel(kind)))
                            .font(.nf(14, weight: 580))
                            .nfLineHeight(19, fontSize: 14)
                            .foregroundStyle(Sm.ink)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        LucideIcon(Lucide.plus, size: 14, color: Sm.muted)
                            .frame(width: 26, height: 26)
                            .background(Sm.hover, in: Circle())
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                }
                .buttonStyle(.pressable(background: Sm.surface, cornerRadius: 14, scale: 0.99, disabledOpacity: 0.55))
                .overlay { cardShape.strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
                .shadow(color: Color(argb: 0x0A0F172A), radius: 1, x: 0, y: 1)
                .disabled(busy)
            }
        }
    }
}

private struct KindFilterBar: View {
    let kinds: [PageKind]
    let active: PageKind?
    let onSelect: (PageKind?) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            KindFilterSegments(kinds: kinds, active: active, onSelect: onSelect)
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    KindFilterSegments(kinds: kinds, active: active, onSelect: onSelect)
                }
                .scrollIndicators(.hidden)
                .onChange(of: active, initial: true) { _, selected in
                    proxy.scrollTo(selected)
                }
            }
        }
        .frame(height: NFChromeMetrics.control)
        .clipShape(Capsule())
        .nfGlassCapsule(solidFill: Sm.hover, stroke: Sm.border)
        .nfChromeShadow(NFChromeMetrics.controlShadow, radius: 6, y: 2)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("ws_page_type"))
    }
}

private struct KindFilterSegments: View {
    let kinds: [PageKind]
    let active: PageKind?
    let onSelect: (PageKind?) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var thumb

    var body: some View {
        HStack(spacing: 2) {
            FilterPill(title: L("search_tab_all"), kind: nil, selected: active == nil, thumb: thumb) {
                onSelect(nil)
            }
            .id(Optional<PageKind>.none)
            ForEach(kinds, id: \.self) { kind in
                FilterPill(
                    title: L(pageKindSectionLabel(kind)),
                    kind: kind,
                    selected: active == kind,
                    thumb: thumb
                ) {
                    onSelect(kind)
                }
                .id(Optional(kind))
            }
        }
        .padding(4)
        .animation(NFMotion.unlessReduced(NFMotion.spring(0.28), reduceMotion), value: active)
    }
}

private struct FilterPill: View {
    let title: String
    let kind: PageKind?
    let selected: Bool
    let thumb: Namespace.ID
    let action: () -> Void
    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let shape = Capsule()
        let nativeThumb = Color(light: 0x1A0F172A, dark: 0x29FFFFFF)
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: 5) {
                if let kind {
                    LucideIcon(pageKindIcon(kind), size: 13, color: pageKindColor(kind))
                }
                Text(title)
                    .font(.nf(13, weight: selected ? 600 : 520))
                    .foregroundStyle(selected ? (chromePath == .native ? chromePath.primaryInk : Sm.ink) : chromePath.secondaryInk)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10.4)
            .frame(height: 36)
            .background {
                if selected {
                    if chromePath == .native {
                        shape.fill(nativeThumb)
                            .matchedGeometryEffect(id: "kindFilterThumb", in: thumb)
                    } else {
                        shape.fill(Sm.surface)
                            .overlay { shape.strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
                            .matchedGeometryEffect(id: "kindFilterThumb", in: thumb)
                    }
                }
            }
        }
        .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 18, scale: 0.98))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct NotesHomeCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14)
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Sm.surface, in: shape)
        .overlay { shape.strokeBorder(Sm.border, lineWidth: 1).allowsHitTesting(false) }
        .clipShape(shape)
        .shadow(color: Color(argb: 0x0A0F172A), radius: 1, x: 0, y: 1)
        .padding(.bottom, 18)
    }
}

private struct NotesHomeEmptyCard: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14)
        Text(text)
            .font(.nf(13.5))
            .foregroundStyle(Sm.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Sm.sidebar.opacity(0.55), in: shape)
            .overlay { shape.strokeBorder(Sm.borderStrong, lineWidth: 1) }
            .padding(.bottom, 18)
    }
}

private struct NotesHomeKindBadge: View {
    let kind: PageKind

    var body: some View {
        Text(L(pageKindLabel(kind)))
            .font(.nf(11, weight: 550))
            .nfLineHeight(14, fontSize: 11)
            .foregroundStyle(pageKindTextColor(kind))
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(pageKindSoft(kind), in: Capsule())
            .layoutPriority(1)
    }
}

private struct NotesHomeIconTile: View {
    let icon: String?
    let kind: PageKind

    var body: some View {
        let bg = (icon != nil && !(icon?.isEmpty ?? true)) ? Sm.hover : pageKindSoft(kind)
        NFIconTile(emoji: icon, fallback: pageKindIcon(kind), box: 30, glyph: 16, color: pageKindColor(kind))
            .background(bg, in: RoundedRectangle(cornerRadius: 8))
    }
}

/// 分组小标题：图标 + 名称 13 / 600 灰 + 数量胶囊。只有文字那么宽（拖到上面时高亮框只包住这一行）。
private struct NotesHomeHeading: View {
    let name: String
    let count: Int
    var icon: [String]? = nil
    var iconColor: Color = Sm.muted

    var body: some View {
        HStack(spacing: 6) {
            if let icon {
                LucideIcon(icon, size: 13.5, color: iconColor)
            }
            Text(name)
                .font(.nf(13, weight: 600))
                .nfLineHeight(19, fontSize: 13)
                .foregroundStyle(Sm.muted)
                .lineLimit(1)
            NotesCountPill(count: count)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private extension View {
    /// 小标题的外边距放在投放区外面：高亮框不包住它。
    func notesHomeHeadingMargins() -> some View {
        self
            .padding(.horizontal, 4)
            .padding(.top, 4)
            .padding(.bottom, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 截图场景滚到第一个可见分组；正式版不引入额外的视图身份。
    @ViewBuilder
    func notesHomeFirstSection(_ isFirst: Bool) -> some View {
        #if DEBUG
        if isFirst {
            id(notesHomeFirstSectionID)
        } else {
            self
        }
        #else
        self
        #endif
    }
}

#if DEBUG
private let notesHomeFirstSectionID = "nf-home-first-section"
#endif

// MARK: - 子页面的树

/// 一篇笔记和它展开的子页面（网页 notes-home）：子页面在展开的父页面下缩进并带竖线；筛选时平铺显示。
@MainActor
private struct NotesHomeTree: View {
    let page: NotePageSummary
    let busy: Bool
    let flat: Bool
    let showTopDivider: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let state = app.notes.state
        let kids = state.children(page.id)
        let isOpen = !flat && state.expanded.contains(page.id)
        NotesHomeItem(page: page, busy: busy, expanded: isOpen, flat: flat, showTopDivider: showTopDivider, reorder: reorder, dialog: $dialog)
        if isOpen {
            VStack(alignment: .leading, spacing: 0) {
                if kids.isEmpty {
                    Text(L("pg_no_pages_inside"))
                        .font(.nf(13.5))
                        .foregroundStyle(Sm.faint)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .overlay(alignment: .top) { NFDivider() }
                } else {
                    ForEach(kids) { child in
                        NotesHomeTree(page: child, busy: busy, flat: false, showTopDivider: true, reorder: reorder, dialog: $dialog)
                    }
                }
            }
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(Sm.border)
                    .frame(width: 1)
                    .accessibilityHidden(true)
            }
            .padding(.leading, 22)
        }
    }
}

// MARK: - 行

/// 首页卡片内的一行：展开箭头 26×40（筛选时隐藏）；主体最小高 52（30 语义色图标块、15.5/530 标题、12.5 浅灰日期）；右侧 36×40 移到项目。
@MainActor
private struct NotesHomeItem: View {
    let page: NotePageSummary
    let busy: Bool
    let expanded: Bool
    let flat: Bool
    let showTopDivider: Bool
    let reorder: ReorderDragController
    @Binding var dialog: NotesDialogState?
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let notes = app.notes
        let state = notes.state
        let pageId = page.id
        HStack(spacing: 0) {
            if !flat {
                Button {
                    notes.toggleExpanded(pageId)
                } label: {
                    LucideIcon(expanded ? Lucide.chevronDown : Lucide.chevronRight, size: 15, color: Sm.faint)
                        .frame(width: 26, height: 40)
                }
                .buttonStyle(.pressable(cornerRadius: 6))
                .padding(.leading, 4)
                .accessibilityLabel(expanded ? L("pg_collapse_title", page.title) : L("pg_expand_title", page.title))
            }
            Button {
                if !reorder.swallowsTap() { notes.openNote(pageId) }
            } label: {
                HStack(spacing: 10) {
                    NotesHomeIconTile(icon: page.icon, kind: page.kind)
                    Text(page.title)
                        .font(.nf(15.5, weight: 530))
                        .nfLineHeight(22, fontSize: 15.5)
                        .foregroundStyle(Sm.text)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(noteShortDate(page.updatedAt))
                        .font(.nf(12.5))
                        .nfLineHeight(18, fontSize: 12.5)
                        .foregroundStyle(Sm.faint)
                        .lineLimit(1)
                        .layoutPriority(1)
                }
                .padding(.leading, flat ? 12 : 4)
                .padding(.trailing, 6)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            }
            .buttonStyle(.pressable(cornerRadius: 0))
            .disabled(busy)
            .reorderHandle(pageId, in: reorder, locked: busy || flat || state.moveBusy.contains(pageId))
            Button {
                dialog = .move(pageId: pageId)
            } label: {
                LucideIcon(Lucide.folderInput, size: 16, color: Sm.faint)
                    .frame(width: 36, height: 40)
            }
            .buttonStyle(.pressable(cornerRadius: 7))
            .padding(.trailing, 4)
            .disabled(busy)
            .accessibilityLabel(L("move_title_to_project", page.title))
        }
        .overlay(alignment: .top) {
            if showTopDivider { NFDivider() }
        }
        .reorderRow(pageId, in: reorder)
        .reorderError(errorText(state), rowHeight: 52) { notes.dismissReorderError() }
    }

    /// 这一篇的拖动失败提示（只在发起拖动的列表里显示）。
    private func errorText(_ state: NotesUiState) -> String? {
        guard let failure = state.reorderError, failure.id == page.id,
              NoteReorderOrigin.shared.surface == .home else { return nil }
        return reorderFailureText(failure, app.systemText)
    }
}

/// 收藏的行（圆角卡片内）：最小高 52、图标块 30、间距 10、标题 15.5 / 530、多类型时右侧类型胶囊。
@MainActor
private struct NotesHomeFavoriteItem: View {
    let page: NotePageSummary
    let busy: Bool
    let multiKind: Bool
    let showTopDivider: Bool
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let notes = app.notes
        let pageId = page.id
        Button {
            notes.openNote(pageId)
        } label: {
            HStack(spacing: 10) {
                NotesHomeIconTile(icon: page.icon, kind: page.kind)
                Text(page.title)
                    .font(.nf(15.5, weight: 530))
                    .nfLineHeight(22, fontSize: 15.5)
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if multiKind {
                    NotesHomeKindBadge(kind: page.kind)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        }
        .buttonStyle(.pressable(cornerRadius: 0))
        .disabled(busy)
        .overlay(alignment: .top) {
            if showTopDivider { NFDivider() }
        }
    }
}

// MARK: - 空状态

/// 一篇笔记都没有（网页 NotesWorkspace 的空状态，手机）：居中 Studio 徽章（LayoutGrid）、标题、说明、Quick-Create Deck 卡片、Import 胶囊。
@MainActor
private struct NotesEmptyView: View {
    let kinds: [PageKind]
    let busy: Bool
    let onCreate: (PageKind) -> Void
    let onGenerate: (AiGenerateTarget) -> Void
    let onImportPptx: () -> Void
    let onImport: () -> Void
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        let emblemShape = RoundedRectangle(cornerRadius: 16)
        VStack(alignment: .center, spacing: 0) {
            LucideIcon(Lucide.layoutGrid, size: 26, strokeWidth: 1.6, color: Sm.ink)
                .frame(width: 56, height: 56)
                .background(Sm.accentSoft, in: emblemShape)
                .overlay { emblemShape.strokeBorder(Sm.border, lineWidth: 1) }
            Text(L("workspace"))
                .font(.nf(32, weight: 750))
                .tracking(layoutDirection == .rightToLeft ? 0 : -1.2)
                .nfLineHeight(38, fontSize: 32)
                .foregroundStyle(Sm.ink)
                .padding(.top, 18)
                .accessibilityAddTraits(.isHeader)
            Text(intro)
                .font(.nf(14.5))
                .nfLineHeight(22, fontSize: 14.5)
                .foregroundStyle(Sm.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            WorkspaceAiEntryView(kinds: kinds, activeFilter: nil, busy: busy, onOpen: onGenerate)
                .frame(maxWidth: 576)
                .padding(.top, 24)
            CreateDeckCards(kinds: kinds, busy: busy, onCreate: onCreate)
                .padding(.top, 14)
            ChatFlowLayout(spacing: 8, lineSpacing: 8) {
                NotesHomeUtilPill(icon: Lucide.upload, title: L("import_markdown"), busy: busy, action: onImport)
                if kinds.contains(.slides) {
                    NotesHomeUtilPill(icon: Lucide.upload, title: L("slides_import_pptx"), busy: busy, action: onImportPptx)
                }
            }
            .padding(.top, 14)
            Text(L("notes_storage_hint"))
                .font(.nf(12))
                .nfLineHeight(19, fontSize: 12)
                .foregroundStyle(Sm.faint)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 384)
                .padding(.top, 36)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 56)
    }

    /// 说明文里的占位符换成“/”键帽：等宽 13、浅灰底（--notes-code-bg）。
    private var intro: AttributedString {
        var key = AttributedString(" / ")
        // 显式写出类型：UIKit 也有同名的 font / backgroundColor 属性（UIFont / UIColor）。
        let keyFont: Font = .nfMono(13)
        let keyBackground: Color = Sm.codeBackground
        key.font = keyFont
        key.backgroundColor = keyBackground
        var text = AttributedString()
        let parts = L("notes_intro").components(separatedBy: "%1$s")
        for (index, part) in parts.enumerated() {
            if index > 0 { text.append(key) }
            text.append(AttributedString(part))
        }
        return text
    }
}
