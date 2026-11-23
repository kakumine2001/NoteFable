import SwiftUI
import UIKit

/// 整个界面的根（Android `ui/NoteFableRoot.kt`）：抽屉（侧边栏）盖在主内容上，主内容按工作区是聊天或笔记。
/// 登录窗口、设置、全屏检索挂在这里；对话框、菜单、底部抽屉、提示都画在 `.nfOverlayHost().toastHost()` 上。
struct RootView: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    init() {}

    var body: some View {
        @Bindable var router = router
        // 开着白板时不从屏幕边缘拉出抽屉（画笔从边缘开始画）：用顶栏的菜单键开。
        AppDrawer(isOpen: $router.drawerOpen, edgeOpens: !app.notes.state.editorCapturesEdgeSwipes) {
            DrawerPanel()
        } content: {
            workspace
        }
        // 每次打开抽屉都刷新列表，拿到其它设备或网页上的新内容。
        .onChange(of: router.drawerOpen) { _, open in
            if open { refreshDrawerLists() }
        }
        // 从笔记切回聊天：当前会话可能刚在笔记的 AI 面板里聊过，重读一次。
        .onChange(of: app.notes.state.workspace) { old, new in
            if new == .chat && old != .chat { app.chat.refreshActiveQuietly() }
        }
        // 登录 / 退出后：旧身份的窗口关掉。
        .onChange(of: app.identityGeneration) { _, _ in
            router.onIdentityChanged()
        }
        // 从笔记切回聊天时：如果之前笔记保存失败没能立即接收分享，这里自动取走。
        .onChange(of: app.notes.state.workspace) { _, workspace in
            if workspace == .chat { router.consumePendingShares() }
        }
        .accountOverlays()
        .nfPanel(isPresented: $router.searchOpen, style: .search) {
            SearchScreen()
        }
        .nfOverlayHost()
        .toastHost()
    }

    @ViewBuilder
    private var workspace: some View {
        switch app.notes.state.workspace {
        case .chat:
            ChatWorkspace()
        case .notes:
            NotesWorkspace()
        }
    }

    private func refreshDrawerLists() {
        if app.notes.state.workspace == .notes {
            app.notes.refresh()
            // 网页的 iconError 是侧栏组件自己的状态，抽屉关掉就没了：重新打开时不再显示上次的失败。
            app.notes.dismissIconError()
        } else {
            app.chat.refreshSessions()
            app.sidebar.refreshProjects()
            // 上次“在项目里新建聊天”的失败原因只在当时那次打开里显示。
            app.sidebar.dismissCreateError()
        }
    }
}

// MARK: - 抽屉里的内容

/// 侧边栏（网页 `.notion-sidebar`，手机抽屉；Android `AppDrawer`）：宽 240、底色 #F7F7F5；头部高 48（品牌 + 关闭侧栏）；
/// 下面是 Chat / Workspace 切换（左右 8、上距 4，14 号字），再下面是当前工作区的内容，最底部是账号区。
private struct DrawerPanel: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    var body: some View {
        VStack(spacing: 0) {
            header
            WorkspaceSwitch(inDrawer: true)
                .padding(.horizontal, 8)
                .padding(.top, 4)
            Group {
                switch app.notes.state.workspace {
                case .chat:
                    ChatDrawerBody()
                case .notes:
                    NotesDrawerBody()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            SidebarFooter()
        }
    }

    /// 头部：网页 NoteFableLogo（设置里换过图标就画那个角色 / 图片）+ 名字 15 / 650、字距 -.02em，间距 7.2；
    /// 右边“关闭侧栏”（.notion-icon-button 40，PanelLeftClose 17 灰）。
    private var header: some View {
        HStack(spacing: 0) {
            AppIconView(icon: app.appIcon.icon, size: 20)
            Text(L("app_title"))
                .font(.nf(15, weight: 650))
                .tracking(-0.3)
                .foregroundStyle(Sm.ink)
                .lineLimit(1)
                .padding(.leading, 7.2)
            Spacer(minLength: 0)
            NFIconButton(Lucide.panelLeftClose, label: L("sb_close_sidebar"), iconSize: 17) {
                router.closeDrawer()
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 48)
    }
}

/// 侧栏最下面（网页 `.sidebar-footer`，Android `SidebarFooter`）：上方 1px 分隔线，四周 8；左边账号（“登录”，或打开设置的账号行，
/// 占满剩下的宽），右边“?”帮助菜单，间距 4。切换语言失败的红字只给未登录的人（登录用户的语言在设置里选，失败也显示在那里）。
private struct SidebarFooter: View {
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let account = app.account.state
        let guest = account.loaded && (!account.configured || account.user == nil)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                AccountRow()
                    .frame(maxWidth: .infinity, alignment: .leading)
                HelpMenuButton()
            }
            if guest, app.language.changeFailed {
                // .sidebar-footer .language-menu-error：12 红字，左右 8。
                Text(L("language_change_failed"))
                    .font(.nf(12))
                    .foregroundStyle(Sm.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 8)
                    // Android 的 liveRegion = Assertive：出现时读屏念出来。
                    .onAppear { UIAccessibility.post(notification: .announcement, argument: L("language_change_failed")) }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { NFDivider() }
    }
}

// MARK: - 抽屉

/// 盖在主内容上的抽屉（Android 的 `ModalNavigationDrawer`；网页手机宽度的侧栏：宽 w-60 = 240、最宽 88vw，遮罩 bg-black/15）。
/// 从行首一侧滑出（阿拉伯语界面在右边）。
/// - 打开：260ms（--dur-base）--ease-out；遮罩跟着淡入。
/// - 关闭：点遮罩、头部的关闭键、选了一项；或者把抽屉往行首方向拖（`use-swipe-dismiss.ts`）：拖过宽度的 33%，
///   或松手够快（> 0.5 px/ms 且拖过 24）就关，200ms 滑出去；否则 340ms 带一点回弹地回到原位。
/// - 从屏幕行首的边缘往里拖可以把它拉出来（Android 抽屉的手势；阈值同上）。`edgeOpens` 为 false 时（开着白板，
///   `NotesUiState.editorCapturesEdgeSwipes`）不装这个手势，触摸全留给主内容；关的手势和菜单键照常。
/// “减弱动态效果”时不做动画，直接到位。
private struct AppDrawer<Panel: View, Content: View>: View {
    @Binding var isOpen: Bool
    let edgeOpens: Bool
    let panel: Panel
    let content: Content

    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 露出来的比例：0 = 收起，1 = 全开。
    @State private var shown: CGFloat = 0
    /// 这次手势在做什么（一次拖动只判断一次）。
    @State private var drag: DragMode?
    @GestureState private var touching = false

    private enum DragMode {
        case opening
        case closing
        case ignored
    }

    private static var maxWidth: CGFloat { 240 }
    /// 从屏幕边缘多宽以内开始的拖动算“拉出抽屉”。
    private static var edgeWidth: CGFloat { 24 }
    private static var scrim: Color { Color.black.opacity(0.15) }

    init(isOpen: Binding<Bool>, edgeOpens: Bool = true, @ViewBuilder panel: () -> Panel, @ViewBuilder content: () -> Content) {
        self._isOpen = isOpen
        self.edgeOpens = edgeOpens
        self.panel = panel()
        self.content = content()
    }

    var body: some View {
        GeometryReader { proxy in
            let width = min(Self.maxWidth, proxy.size.width * 0.88)
            let rtl = layoutDirection == .rightToLeft
            // 收起时要移出屏幕的距离：底色铺到了安全区外面（横屏的刘海一侧），所以把那一段也算上。
            let travel = width + proxy.safeAreaInsets.leading
            ZStack(alignment: .leading) {
                content
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .simultaneousGesture(
                        openGesture(width: width, containerWidth: proxy.size.width, rtl: rtl),
                        including: edgeOpens ? .all : .subviews
                    )
                    .accessibilityHidden(shown > 0)

                Self.scrim
                    .opacity(shown)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { isOpen = false }
                    .gesture(closeGesture(width: width, rtl: rtl))
                    .allowsHitTesting(shown > 0)
                    .accessibilityHidden(true)

                panel
                    .frame(width: width)
                    .frame(maxHeight: .infinity)
                    .background {
                        // 底色铺到状态栏和底部安全区下面；内容留在安全区里。
                        Sm.sidebar
                            .contentShape(Rectangle())
                            .ignoresSafeArea()
                    }
                    // 收起时整个移到屏幕外。offset 不随布局方向镜像，所以自己分左右。
                    .offset(x: (rtl ? 1 : -1) * (1 - shown) * travel)
                    .opacity(shown > 0 ? 1 : 0)
                    .simultaneousGesture(closeGesture(width: width, rtl: rtl))
                    .allowsHitTesting(shown > 0)
                    .accessibilityHidden(shown == 0)
                    .accessibilityAddTraits(.isModal)
                    .accessibilityAction(.escape) { isOpen = false }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .leading)
        }
        .onChange(of: isOpen, initial: true) { _, open in
            // 打开抽屉时收起键盘（遮罩盖住了输入栏）。
            if open { hideKeyboard() }
            settle(open: open, animation: open ? NFMotion.easeOut(NFMotion.base) : NFMotion.easeOut(0.2))
        }
        // 手势被系统取消（来电、别的手势抢走）时不会走 onEnded：按当前的开关状态归位。
        .onChange(of: touching) { _, active in
            guard !active else { return }
            // 等这一轮手势回调（onEnded）走完再看：正常松手时 drag 已经清掉了。
            Task { @MainActor in
                guard drag != nil, !touching else { return }
                drag = nil
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

    /// 往“打开”方向的位移（从左到右的界面里是向右）。
    private func inward(_ value: DragGesture.Value, rtl: Bool) -> CGFloat {
        rtl ? -value.translation.width : value.translation.width
    }

    private func inwardVelocity(_ value: DragGesture.Value, rtl: Bool) -> CGFloat {
        rtl ? -value.velocity.width : value.velocity.width
    }

    private func isHorizontal(_ value: DragGesture.Value) -> Bool {
        abs(value.translation.width) > abs(value.translation.height)
    }

    /// 主内容上：从屏幕行首边缘往里拖，把抽屉拉出来。
    private func openGesture(width: CGFloat, containerWidth: CGFloat, rtl: Bool) -> some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .updating($touching) { _, state, _ in state = true }
            .onChanged { value in
                if drag == nil {
                    let fromEdge = rtl ? containerWidth - value.startLocation.x : value.startLocation.x
                    let begins = edgeOpens && !isOpen && shown == 0 && fromEdge <= Self.edgeWidth
                        && isHorizontal(value) && inward(value, rtl: rtl) > 0 && !ReorderDragSession.isActive
                    drag = begins ? .opening : .ignored
                    if begins { hideKeyboard() }
                }
                guard drag == .opening else { return }
                shown = min(1, max(0, inward(value, rtl: rtl) / width))
            }
            .onEnded { value in
                let mode = drag
                drag = nil
                guard mode == .opening else { return }
                let offset = max(0, inward(value, rtl: rtl))
                let flicked = inwardVelocity(value, rtl: rtl) > 500 && offset > 24
                finish(open: offset > width * 0.33 || flicked)
            }
    }

    /// 抽屉和遮罩上：往行首方向拖，把抽屉推回去。竖着的拖动（滚动列表）和拖动排序不算。
    private func closeGesture(width: CGFloat, rtl: Bool) -> some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .updating($touching) { _, state, _ in state = true }
            .onChanged { value in
                if drag == nil {
                    let begins = isOpen && isHorizontal(value) && inward(value, rtl: rtl) < 0 && !ReorderDragSession.isActive
                    drag = begins ? .closing : .ignored
                }
                guard drag == .closing else { return }
                // 排序的长按在这次触摸中途生效：抽屉回到全开，这次不再跟手。
                if ReorderDragSession.isActive {
                    drag = .ignored
                    shown = 1
                    return
                }
                shown = min(1, max(0, 1 + inward(value, rtl: rtl) / width))
            }
            .onEnded { value in
                let mode = drag
                drag = nil
                guard mode == .closing else { return }
                let offset = max(0, -inward(value, rtl: rtl))
                let flicked = -inwardVelocity(value, rtl: rtl) > 500 && offset > 24
                finish(open: !(offset > width * 0.33 || flicked))
            }
    }

    /// 松手：到位。开关没变（弹回去）时用回弹的曲线；变了的话由 `onChange(of: isOpen)` 负责滑到位。
    private func finish(open: Bool) {
        if open == isOpen {
            settle(open: open, animation: NFMotion.spring(0.34))
        } else {
            isOpen = open
        }
    }
}
