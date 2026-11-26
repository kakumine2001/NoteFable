import SwiftUI
import UIKit

/// 整个界面的根（Android `ui/NoteFableRoot.kt`）：
/// - 内层：底部原生 `TabView`（聊天 / 工作区 / 搜索），编辑器或幻灯片放映中隐藏底栏；
/// - 外层：自适应侧栏壳层（宽窗口常驻 280pt 侧栏 + 详情双栏并排、可手动收起；窄窗口交互式行首推入圆角抽屉，单一结构身份保证横竖屏 / 分屏 / 折叠切换不丢选中项和未保存草稿）；
/// - 顶层：登录、设置、回收站 `.nfSheet`、全局 `.nfOverlayHost()` 与独立窗口 `.toastHost(tabBarVisible:tab:leadingInset:)`。
struct RootView: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    /// 整个工作区共用的常驻 /note-embed WKWebView 池：按需创建，按身份变化 / 后台 / 内存警告 / 空闲超时释放。
    @State private var noteEditorPool = NoteEditorPool()

    init() {}

    var body: some View {
        @Bindable var router = router
        let hideTabBar = router.selectedTab == .workspace && (app.notes.state.open != nil || app.notes.state.presenting)
        let allowEdgeDrawer = !(router.selectedTab == .workspace && (app.notes.state.editorCapturesEdgeSwipes || app.notes.state.presenting))

        AdaptiveSidebarShell(
            isOpen: $router.drawerOpen,
            dockedVisible: router.dockedSidebarVisible,
            presenting: app.notes.state.presenting,
            edgeOpens: allowEdgeDrawer,
            onDockedChange: { router.setSidebarDocked($0) },
            onCollapseDocked: { router.closeSidebar() }
        ) {
            DrawerPanel()
        } content: {
            mainTabs(hideTabBar: hideTabBar)
        }
        .environment(noteEditorPool)
        .onAppear {
            noteEditorPool.bind(app: app)
        }
        .onDisappear {
            noteEditorPool.destroy()
        }
        // 每次侧栏变为可见（含宽屏启动常驻、重新展开常驻侧栏、或窄屏打开抽屉）都刷新聊天、项目与笔记列表，拿到其它设备或网页上的新内容。
        .onChange(of: router.isSidebarVisible, initial: true) { _, visible in
            if visible { refreshDrawerLists() }
        }
        // 同步 Core 工作区状态变化（例如空聊天底部最近笔记的“查看全部”切换到工作区，或笔记里切回聊天）。
        .onChange(of: app.notes.state.workspace) { old, new in
            if new == .chat && old != .chat {
                app.chat.refreshActiveQuietly()
                router.consumePendingShares()
                if router.selectedTab != .search { router.selectedTab = .chat }
            } else if new == .notes && old != .notes {
                if router.selectedTab != .search { router.selectedTab = .workspace }
            }
        }
        // 离开未保存的笔记被拒绝时（窄屏抽屉或搜索页）收起遮挡以展示编辑器里的保存失败提示；宽屏常驻侧栏不遮挡编辑器，保持原状。
        .onChange(of: app.notes.leaveBlockedCount) { _, _ in
            if router.drawerOpen { router.dismissDrawer() }
            if router.selectedTab != .workspace {
                router.selectedTab = .workspace
            }
        }
        // 登录 / 退出后：旧身份的窗口关掉，常驻 WebView 与其缓存一并销毁；宽屏常驻侧栏可见时顺带刷新工作区笔记列表。
        .onChange(of: app.identityGeneration) { _, _ in
            noteEditorPool.destroy()
            router.onIdentityChanged()
            if router.isSidebarVisible { app.notes.refresh() }
        }
        // App 退到后台且当前停留在列表 / 聊天时，立刻释放热缓存 WebView。
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { noteEditorPool.destroyIfParked() }
        }
        // 系统内存紧张且当前停留在列表 / 聊天时，立刻释放热缓存 WebView。
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            noteEditorPool.destroyIfParked()
        }
        .accountOverlays()
        // 「画成图」的进度窗口：回答的菜单（聊天）和笔记的菜单（编辑页）都从这里开。
        .drawDiagramDialog()
        .noteTrashSheet()
        .nfOverlayHost()
        // 提示条按当前标签页量到的底部遮挡（标签栏 + 悬浮底栏）摆放，宽屏常驻侧栏展开时在详情栏中水平居中。
        .toastHost(
            tabBarVisible: !hideTabBar,
            tab: router.selectedTab,
            leadingInset: router.isSidebarDockedVisible ? CGFloat(AdaptiveLayout.dockedSidebarWidth) : 0
        )
    }

    @ViewBuilder
    private func mainTabs(hideTabBar: Bool) -> some View {
        let tabSelection = Binding<AppTab>(
            get: { router.selectedTab },
            set: { router.selectTab($0) }
        )
        if #available(iOS 18.0, *) {
            let searchRole: TabRole = {
                if #available(iOS 27.0, *) { return .prominent }
                return .search
            }()
            TabView(selection: tabSelection) {
                Tab(value: AppTab.chat) {
                    ChatWorkspace()
                        .nfTabBarHidden(false)
                } label: {
                    Label { Text(L("chat_mode")) } icon: { Image(uiImage: NFGlassTabIcons.chat) }
                }
                Tab(value: AppTab.workspace) {
                    NotesWorkspace()
                        .nfTabBarHidden(hideTabBar)
                } label: {
                    Label { Text(L("note_mode")) } icon: { Image(uiImage: NFGlassTabIcons.workspace) }
                }
                // 显式传本地化标题，避免应用内切语言时仍用系统语言；
                // iOS 27 起使用 .prominent，使搜索保持与 iOS 26 一致的独立圆形玻璃按钮样式。
                Tab(value: AppTab.search, role: searchRole) {
                    SearchScreen()
                        .nfTabBarHidden(false)
                } label: {
                    Label { Text(L("search")) } icon: { Image(uiImage: NFGlassTabIcons.search) }
                }
            }
            .nfTabBarMinimize(router.selectedTab == .chat ? ChatChrome.tabBarMinimize : .never)
        } else {
            TabView(selection: tabSelection) {
                ChatWorkspace()
                    .nfTabBarHidden(false)
                    .tabItem { Label { Text(L("chat_mode")) } icon: { Image(uiImage: NFGlassTabIcons.chat) } }
                    .tag(AppTab.chat)
                NotesWorkspace()
                    .nfTabBarHidden(hideTabBar)
                    .tabItem { Label { Text(L("note_mode")) } icon: { Image(uiImage: NFGlassTabIcons.workspace) } }
                    .tag(AppTab.workspace)
                SearchScreen()
                    .nfTabBarHidden(false)
                    .tabItem { Label { Text(L("search")) } icon: { Image(uiImage: NFGlassTabIcons.search) } }
                    .tag(AppTab.search)
            }
        }
    }

    private func refreshDrawerLists() {
        app.chat.refreshSessions()
        app.sidebar.refreshProjects()
        app.sidebar.dismissCreateError()
        app.notes.refresh()
        // 网页的 iconError 是侧栏组件自己的状态，抽屉关掉就没了：重新打开时不再显示上次的失败。
        app.notes.dismissIconError()
    }
}

// MARK: - 合并抽屉面板

/// 合并侧边栏抽屉：顶部品牌栏、共享滚动区（聊天 + 工作区）、底部悬浮玻璃操作栏（账号 / 帮助 / 新建）。
/// 面板本身是内容（推入式抽屉，后面没有东西可折射），保持实色 `Sm.sidebar`；顶栏和底栏是浮在列表上的两条栏
/// （`nfFloatingHeader`）：iOS 26 起列表从它们下面滚过（系统滚动边缘效果），iOS 17–18 铺一条系统毛玻璃底，
/// “减少透明度”时铺一条 `Sm.sidebar` 实色底（底栏上边再加 1px 细线）。
private struct DrawerPanel: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                ChatDrawerBody()
                SidebarSectionDivider()
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                workspaceSectionHeader
                NotesDrawerBody()
            }
            .padding(.bottom, 12)
        }
        .nfFloatingHeader(edge: .top, solidFill: Sm.sidebar, divider: false) {
            header
        }
        .nfFloatingHeader(edge: .bottom, solidFill: Sm.sidebar, divider: true) {
            DrawerFooter()
        }
    }

    private var header: some View {
        HStack(spacing: 0) {
            AppIconView(icon: app.appIcon.icon, size: 20)
            Text(L("app_title"))
                .font(.nf(15, weight: 680))
                .tracking(-0.35)
                .foregroundStyle(Sm.ink)
                .lineLimit(1)
                .padding(.leading, 8)
            Spacer(minLength: 0)
            // 每条栏的玻璃各包在一个容器里（#195 规则 1.4）。
            NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
                NFGlassIconButton(
                    Lucide.panelLeftClose,
                    label: L("sb_close_sidebar"),
                    size: 34,
                    iconSize: 16,
                    color: Sm.muted
                ) {
                    router.closeSidebar()
                }
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 10)
        .frame(height: 48)
    }

    private var workspaceSectionHeader: some View {
        HStack(spacing: 6) {
            SidebarSectionBadge(
                icon: Lucide.layoutGrid,
                background: Sm.accentSoft,
                iconColor: Sm.blue,
                border: Sm.kindNoteBorder
            )
            NotesSectionLabel(L("workspace"))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 4)
    }
}

/// 抽屉底部悬浮玻璃操作栏：左边账号胶囊（登录或设置），右边“？”帮助菜单与“＋”新建菜单。
private struct DrawerFooter: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @State private var newMenuOpen = false

    var body: some View {
        let account = app.account.state
        let guest = account.loaded && (!account.configured || account.user == nil)
        VStack(alignment: .leading, spacing: 6) {
            if guest, app.language.changeFailed {
                Text(L("language_change_failed"))
                    .font(.nf(12))
                    .foregroundStyle(Sm.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 12)
                    .onAppear { UIAccessibility.post(notification: .announcement, argument: L("language_change_failed")) }
            }
            NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
                HStack(spacing: NFChromeMetrics.gap) {
                    AccountRow(glassStyle: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    HelpMenuButton(glassStyle: true)
                    newActionButton
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var newActionButton: some View {
        let kinds = app.notes.state.kinds
        let notesBusy = app.notes.state.busy || app.notes.state.loading
        return NFGlassIconButton(Lucide.plus, label: L("ws_new"), size: 40, iconSize: 18, color: Sm.ink) {
            newMenuOpen.toggle()
        }
        .actionsMenu(isPresented: $newMenuOpen, alignment: .trailing, placement: .above, label: L("ws_new")) {
            ActionsMenuItem(L("new_chat"), icon: Lucide.messageSquareText) {
                newMenuOpen = false
                router.openNewChat()
            }
            ActionsMenuDivider()
            ForEach(kinds, id: \.self) { kind in
                ActionsMenuItem(L(pageKindNewLabel(kind)), icon: pageKindIcon(kind), iconColor: pageKindColor(kind)) {
                    newMenuOpen = false
                    router.createNote(kind: kind)
                }
                .disabled(notesBusy)
            }
        }
    }
}

// MARK: - 自适应侧栏壳层（宽屏常驻双栏 / 窄屏推入式圆角抽屉）

/// 单一结构身份的自适应侧栏容器（RTL 自动镜像）：
/// - 宽窗口（`AdaptiveLayout.supportsDockedSidebar`：可用宽 >= 720pt 且未在幻灯片放映）：280pt 常驻侧栏与详情栏并排，
///   支持顶部按钮收起/展开，收起时详情区平滑占满窗口；
/// - 窄窗口：交互式推入式圆角抽屉（停留在主视图下方带轻微视差，主视图推开并收出连续圆角与柔和阴影；
///   `shown == 0` 时外部遮罩外扩 120pt，避免裁切底部 TabView 液态玻璃边缘效果；白板与放映中禁用边缘拉出）；
/// - 两种布局共享同一组 `panel` 与 `content` 视图节点，横竖屏旋转、分屏缩放、iPhone Duo 折展时保持选中项、WebView 与未保存草稿。
private struct AdaptiveSidebarShell<Panel: View, Content: View>: View {
    @Binding var isOpen: Bool
    let dockedVisible: Bool
    let presenting: Bool
    let edgeOpens: Bool
    let onDockedChange: (Bool) -> Void
    let onCollapseDocked: () -> Void
    let panel: Panel
    let content: Content

    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 窄屏抽屉露出来的比例：0 = 收起，1 = 全开。
    @State private var shown: CGFloat = 0
    /// 宽屏常驻侧栏展开比例：0 = 收起，1 = 展开。
    @State private var dockedShown: CGFloat
    /// 上一次测到的宽/窄模式，供 `onChange(of: dockedVisible / isOpen)` 判断是否需要播放对应动画。
    @State private var lastDocked = false
    /// 这次手势在做什么（开启与关闭手势各用独立状态，避免打开抽屉后在遮罩上滑动时互相抢占）。
    @State private var openDrag: DragState?
    @State private var closeDrag: DragState?
    @GestureState private var touching = false

    private enum DragState {
        case active
        case ignored
    }

    private static var maxWidth: CGFloat { 296 }
    /// 从屏幕边缘多宽以内开始的拖动算“拉出抽屉”。
    private static var edgeWidth: CGFloat { 24 }
    private static var scrim: Color { Color.black.opacity(0.18) }

    init(
        isOpen: Binding<Bool>,
        dockedVisible: Bool,
        presenting: Bool,
        edgeOpens: Bool = true,
        onDockedChange: @escaping (Bool) -> Void,
        onCollapseDocked: @escaping () -> Void,
        @ViewBuilder panel: () -> Panel,
        @ViewBuilder content: () -> Content
    ) {
        self._isOpen = isOpen
        self.dockedVisible = dockedVisible
        self.presenting = presenting
        self.edgeOpens = edgeOpens
        self.onDockedChange = onDockedChange
        self.onCollapseDocked = onCollapseDocked
        self.panel = panel()
        self.content = content()
        self._dockedShown = State(initialValue: dockedVisible ? 1 : 0)
    }

    var body: some View {
        GeometryReader { proxy in
            let layoutDocked = AdaptiveLayout.supportsDockedSidebar(
                windowWidth: Double(proxy.size.width),
                presenting: presenting
            )
            let dockedWidth = CGFloat(AdaptiveLayout.dockedSidebarWidth)
            let drawerWidth = min(Self.maxWidth, proxy.size.width * 0.84)
            let panelWidth = layoutDocked ? dockedWidth : drawerWidth
            let dockFactor: CGFloat = layoutDocked ? dockedShown : 0
            let drawerFactor: CGFloat = layoutDocked ? 0 : shown
            let rtl = layoutDirection == .rightToLeft
            let maskInset = layoutDocked ? -120 : -max(0, 1 - drawerFactor * 20) * 120
            let panelVisible = layoutDocked ? dockFactor > 0.01 : drawerFactor > 0.01
            let panelInteractive = layoutDocked ? dockFactor > 0.5 : drawerFactor > 0.5
            let panelOffsetX = layoutDocked ? -(1 - dockFactor) * dockedWidth : -(1 - drawerFactor) * 28
            let contentWidth = layoutDocked ? max(0, proxy.size.width - dockFactor * dockedWidth) : proxy.size.width
            let contentOffsetX = layoutDocked ? dockFactor * dockedWidth : drawerFactor * drawerWidth

            ZStack(alignment: .leading) {
                panel
                    .frame(width: panelWidth)
                    .frame(maxHeight: .infinity)
                    .background {
                        Sm.sidebar
                            .contentShape(Rectangle())
                            .ignoresSafeArea()
                    }
                    // SwiftUI 在 RTL 下自动镜像 offset(x:)，不要再乘方向系数。
                    .offset(x: panelOffsetX)
                    .opacity(panelVisible ? 1 : 0)
                    .simultaneousGesture(
                        closeGesture(width: drawerWidth, rtl: rtl),
                        including: layoutDocked ? .subviews : .all
                    )
                    .allowsHitTesting(panelInteractive)
                    .accessibilityHidden(!panelInteractive)
                    .accessibilityAddTraits(layoutDocked ? [] : .isModal)
                    .accessibilityAction(.escape) {
                        if layoutDocked {
                            onCollapseDocked()
                        } else {
                            isOpen = false
                        }
                    }

                content
                    .frame(width: contentWidth, height: proxy.size.height)
                    .overlay {
                        // 始终保持挂载，以免拖动接近 0 时卸载手势宿主触发系统取消并重新打开抽屉。
                        Self.scrim
                            .opacity(drawerFactor)
                            .ignoresSafeArea()
                            .contentShape(Rectangle())
                            .onTapGesture { isOpen = false }
                            .gesture(closeGesture(width: drawerWidth, rtl: rtl))
                            .allowsHitTesting(!layoutDocked && (isOpen || shown > 0 || closeDrag == .active))
                            .accessibilityHidden(true)
                    }
                    .mask {
                        // 宽屏常驻侧栏模式下行首裁齐 0，避免详情区横向滚动画布或安全区延展盖到侧栏上；上下与行尾仍外扩 120pt 保留玻璃边缘效果。
                        RoundedRectangle(cornerRadius: drawerFactor * 32, style: .continuous)
                            .padding(EdgeInsets(
                                top: maskInset,
                                leading: layoutDocked ? 0 : maskInset,
                                bottom: maskInset,
                                trailing: maskInset
                            ))
                    }
                    .shadow(color: Color.black.opacity(0.16 * drawerFactor), radius: 18 * drawerFactor, x: 0, y: 0)
                    .overlay(alignment: .leading) {
                        // 常驻侧栏与详情栏之间的 1pt 分隔线，延伸进上下安全区；RTL 下 `.leading` 自动落在右侧接缝。
                        Rectangle()
                            .fill(Sm.border)
                            .frame(width: 1)
                            .ignoresSafeArea(.container, edges: [.top, .bottom])
                            .opacity(layoutDocked ? dockFactor : 0)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                    .offset(x: contentOffsetX)
                    .simultaneousGesture(
                        openGesture(width: drawerWidth, containerWidth: proxy.size.width, rtl: rtl),
                        including: (!layoutDocked && edgeOpens && !isOpen) ? .all : .subviews
                    )
                    .accessibilityHidden(!layoutDocked && shown > 0)
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .leading)
            .background { Sm.sidebar.ignoresSafeArea() }
            .onChange(of: layoutDocked, initial: true) { _, docked in
                lastDocked = docked
                onDockedChange(docked)
                if docked {
                    openDrag = nil
                    closeDrag = nil
                    shown = 0
                    dockedShown = (dockedVisible || isOpen) ? 1 : 0
                }
            }
        }
        .onChange(of: dockedVisible) { _, visible in
            let target: CGFloat = visible ? 1 : 0
            guard dockedShown != target else { return }
            guard lastDocked else {
                dockedShown = target
                return
            }
            withAnimation(NFMotion.unlessReduced(NFMotion.spring(0.32), reduceMotion)) {
                dockedShown = target
            }
        }
        .onChange(of: isOpen, initial: true) { _, open in
            if lastDocked {
                openDrag = nil
                closeDrag = nil
                shown = 0
                return
            }
            if open {
                openDrag = nil
                hideKeyboard()
            } else {
                closeDrag = nil
            }
            settle(open: open, animation: open ? NFMotion.easeOut(NFMotion.base) : NFMotion.easeOut(0.2))
        }
        .onChange(of: touching) { _, active in
            guard !active else { return }
            Task { @MainActor in
                guard !touching, openDrag != nil || closeDrag != nil else { return }
                openDrag = nil
                closeDrag = nil
                settle(open: isOpen, animation: NFMotion.spring(0.34))
            }
        }
    }

    private func settle(open: Bool, animation: Animation) {
        let target: CGFloat = open ? 1 : 0
        guard shown != target else { return }
        withAnimation(NFMotion.unlessReduced(animation, reduceMotion)) { shown = target }
    }

    private func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    // ---- 手势 ----

    private func inward(_ value: DragGesture.Value, rtl: Bool) -> CGFloat {
        rtl ? -value.translation.width : value.translation.width
    }

    private func inwardVelocity(_ value: DragGesture.Value, rtl: Bool) -> CGFloat {
        rtl ? -value.velocity.width : value.velocity.width
    }

    private func isHorizontal(_ value: DragGesture.Value) -> Bool {
        abs(value.translation.width) > abs(value.translation.height)
    }

    private func openGesture(width: CGFloat, containerWidth: CGFloat, rtl: Bool) -> some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .updating($touching) { _, state, _ in state = true }
            .onChanged { value in
                if openDrag == nil {
                    let fromEdge = rtl ? containerWidth - value.startLocation.x : value.startLocation.x
                    let begins = edgeOpens && !isOpen && shown == 0 && fromEdge <= Self.edgeWidth
                        && isHorizontal(value) && inward(value, rtl: rtl) > 0 && !ReorderDragSession.isActive
                    openDrag = begins ? .active : .ignored
                    if begins { hideKeyboard() }
                }
                guard openDrag == .active else { return }
                shown = min(1, max(0, inward(value, rtl: rtl) / width))
            }
            .onEnded { value in
                let state = openDrag
                openDrag = nil
                guard state == .active else { return }
                let offset = max(0, inward(value, rtl: rtl))
                let flicked = inwardVelocity(value, rtl: rtl) > 500 && offset > 24
                finish(open: offset > width * 0.33 || flicked)
            }
    }

    private func closeGesture(width: CGFloat, rtl: Bool) -> some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .updating($touching) { _, state, _ in state = true }
            .onChanged { value in
                if closeDrag == nil {
                    let begins = isOpen && isHorizontal(value) && inward(value, rtl: rtl) < 0 && !ReorderDragSession.isActive
                    closeDrag = begins ? .active : .ignored
                }
                guard closeDrag == .active else { return }
                if ReorderDragSession.isActive {
                    closeDrag = .ignored
                    shown = 1
                    return
                }
                shown = min(1, max(0, 1 + inward(value, rtl: rtl) / width))
            }
            .onEnded { value in
                let state = closeDrag
                closeDrag = nil
                guard state == .active else { return }
                let offset = max(0, -inward(value, rtl: rtl))
                let flicked = -inwardVelocity(value, rtl: rtl) > 500 && offset > 24
                finish(open: !(offset > width * 0.33 || flicked))
            }
    }

    private func finish(open: Bool) {
        if open == isOpen {
            settle(open: open, animation: NFMotion.spring(0.34))
        } else {
            isOpen = open
        }
    }
}
