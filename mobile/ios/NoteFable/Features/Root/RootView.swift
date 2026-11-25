import SwiftUI
import UIKit

/// 整个界面的根（Android `ui/NoteFableRoot.kt`）：
/// - 内层：底部原生 `TabView`（聊天 / 工作区 / 搜索），编辑器或幻灯片放映中隐藏底栏；
/// - 外层：交互式行首推入圆角抽屉（合并聊天与工作区目录），底部悬浮玻璃操作栏；
/// - 顶层：登录、设置、回收站 `.nfSheet`、全局 `.nfOverlayHost()` 与独立窗口 `.toastHost()`。
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

        AppDrawer(isOpen: $router.drawerOpen, edgeOpens: allowEdgeDrawer) {
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
        // 每次打开抽屉都同时刷新聊天、项目与笔记列表，拿到其它设备或网页上的新内容。
        .onChange(of: router.drawerOpen) { _, open in
            if open { refreshDrawerLists() }
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
        // 在搜索标签切走失败（草稿未能保存，包含重复触发的失败）时回到工作区展示编辑器内的保存失败提示。
        .onChange(of: app.notes.leaveBlockedCount) { _, _ in
            if router.selectedTab == .search {
                router.selectedTab = .workspace
            }
        }
        // 登录 / 退出后：旧身份的窗口关掉，常驻 WebView 与其缓存一并销毁。
        .onChange(of: app.identityGeneration) { _, _ in
            noteEditorPool.destroy()
            router.onIdentityChanged()
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
        .noteTrashSheet()
        .nfOverlayHost()
        .toastHost(tabBarVisible: !hideTabBar)
    }

    @ViewBuilder
    private func mainTabs(hideTabBar: Bool) -> some View {
        let tabSelection = Binding<AppTab>(
            get: { router.selectedTab },
            set: { router.selectTab($0) }
        )
        if #available(iOS 18.0, *) {
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
                // 显式传本地化标题，避免 role: .search 在应用内切语言时仍用系统语言。
                Tab(value: AppTab.search, role: .search) {
                    SearchScreen()
                        .nfTabBarHidden(false)
                } label: {
                    Label { Text(L("search")) } icon: { Image(uiImage: NFGlassTabIcons.search) }
                }
            }
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
private struct DrawerPanel: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        VStack(spacing: 0) {
            header
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
            .nfFloatingBar(edge: .bottom) {
                DrawerFooter()
            }
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
            NFGlassIconButton(
                Lucide.panelLeftClose,
                label: L("sb_close_sidebar"),
                size: 34,
                iconSize: 16,
                color: Sm.muted
            ) {
                router.closeDrawer()
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
            NFGlassContainer(spacing: 8) {
                HStack(spacing: 8) {
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
            }
        }
    }
}

// MARK: - 推入式圆角抽屉

/// 交互式推入式圆角抽屉（RTL 镜像）：
/// - 抽屉停留在主视图下方并带轻微视差；主视图向右（RTL 向左）推开并收出连续圆角与柔和阴影；
/// - `shown == 0` 时外部遮罩外扩 120pt，避免裁切底部 TabView 液态玻璃边缘效果；
/// - 白板页和幻灯片放映中禁用边缘拉出手势，关闭手势与按钮照常。
private struct AppDrawer<Panel: View, Content: View>: View {
    @Binding var isOpen: Bool
    let edgeOpens: Bool
    let panel: Panel
    let content: Content

    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 露出来的比例：0 = 收起，1 = 全开。
    @State private var shown: CGFloat = 0
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

    init(isOpen: Binding<Bool>, edgeOpens: Bool = true, @ViewBuilder panel: () -> Panel, @ViewBuilder content: () -> Content) {
        self._isOpen = isOpen
        self.edgeOpens = edgeOpens
        self.panel = panel()
        self.content = content()
    }

    var body: some View {
        GeometryReader { proxy in
            let width = min(Self.maxWidth, proxy.size.width * 0.84)
            let rtl = layoutDirection == .rightToLeft
            let maskInset = -max(0, 1 - shown * 20) * 120
            ZStack(alignment: .leading) {
                panel
                    .frame(width: width)
                    .frame(maxHeight: .infinity)
                    .background {
                        Sm.sidebar
                            .contentShape(Rectangle())
                            .ignoresSafeArea()
                    }
                    // SwiftUI 在 RTL 下自动镜像 offset(x:)，不要再乘方向系数。
                    .offset(x: -(1 - shown) * 28)
                    .opacity(shown > 0.01 ? 1 : 0)
                    .simultaneousGesture(closeGesture(width: width, rtl: rtl))
                    .allowsHitTesting(shown > 0.5)
                    .accessibilityHidden(shown == 0)
                    .accessibilityAddTraits(.isModal)
                    .accessibilityAction(.escape) { isOpen = false }

                content
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .overlay {
                        if shown > 0.01 {
                            Self.scrim
                                .opacity(shown)
                                .ignoresSafeArea()
                                .contentShape(Rectangle())
                                .onTapGesture { isOpen = false }
                                .gesture(closeGesture(width: width, rtl: rtl))
                                .accessibilityHidden(true)
                        }
                    }
                    .mask {
                        RoundedRectangle(cornerRadius: shown * 32, style: .continuous)
                            .padding(maskInset)
                    }
                    .shadow(color: Color.black.opacity(0.16 * shown), radius: 18 * shown, x: 0, y: 0)
                    .offset(x: shown * width)
                    .simultaneousGesture(
                        openGesture(width: width, containerWidth: proxy.size.width, rtl: rtl),
                        including: (edgeOpens && !isOpen) ? .all : .subviews
                    )
                    .accessibilityHidden(shown > 0)
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .leading)
            .background { Sm.sidebar.ignoresSafeArea() }
        }
        .onChange(of: isOpen, initial: true) { _, open in
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
