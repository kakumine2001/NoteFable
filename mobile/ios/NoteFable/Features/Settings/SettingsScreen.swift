import SwiftUI
import UIKit

// 设置（网页 SettingsDialog 的手机宽度，Android ui/SettingsDialog.kt；从侧栏的账号行打开，登录后才有）。全屏，灰底（--notion-sidebar）。
// 两级（和 ChatGPT、Claude 的手机 App 一样）：先是入口列表，点一行进那一栏自己的画面。
// - 顶栏高 64、左右 16，浮在内容上面（#195 `nfFloatingHeader`）：卡片从它下面滚过（iOS 26 系统的滚动边缘效果；
//   iOS 17–18 是 Material.bar 底；减弱透明度时是不透明的 --notion-sidebar 底，都没有分隔线）。顶栏不跟着换画面的横移走。
//   行首 44 的玻璃圆按钮（`NFGlassIconButton`，1px 细线；列表上是"关闭" X 18，一栏里是"返回" ArrowLeft 20），
//   标题在整条顶栏的正中，17/650 墨色（列表上是"设置"，一栏里是那一栏的名字；普通文字，不放在玻璃上）；行尾空着（留 44，让标题居中）。
// - 下面是左右 16、上 8、下 32 的滚动区。名字、头像、语言保存失败的提示在它的最上面，列表和每一栏里都有。
// - 入口列表（.settings-home）：账号行（头像、名字、邮箱，点了进"账号"），下面 24 是四行的卡片：通用、个性化、方案、账号。
// - 一栏的画面只有那一栏的内容，没有栏标题（名字在顶栏上）。卡片都是白底、1px 细线、圆角 20：
//   通用（语言、外观、图标）；个性化（自定义指令）；方案；账号（个人资料，下面 24 是退出登录、删除账号）。
// - 换画面：200ms cubic-bezier(.2,.8,.2,1)，新画面淡入并横移 16（进一栏从行尾一侧来，回列表从行首一侧来，从右到左的界面里反过来），
//   旧画面直接消失。"减弱动态效果"时没有，刚打开时的列表也没有。换了以后从最上面开始看。
// 资料、语言和图标改了就存。只有自定义指令要按"保存"：改了以后下方浮出"未保存的更改"条（放弃 / 保存），
// 保存或放弃之前不关、也不回列表（只让那条晃一下）。保存后留在设置里，标题右边显示"已保存"。
// 什么时候能关、能回列表、被拦下来时切到哪一栏，规则都在 Core 的 `SettingsDialogModel`。
// iOS 没有返回键，设置面板也没有边缘滑动的手势：回列表只有顶栏的"返回"（读屏的"返回"手势走 `requestClose`，一次退一步）。

/// 设置面板的内容：每次打开建一份新的状态（上一次的错误、没存的指令不带进来）。由 `accountOverlays()` 放进 `.nfPanel(style: .settings)`。
struct SettingsScreenHost: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @State private var model: SettingsDialogModel?
    @State private var plan: PlanSettingsModel?

    init() {}

    var body: some View {
        ZStack {
            if let model, let plan, let user = app.account.state.user {
                SettingsScreen(model: model, plan: plan, user: user)
            } else {
                Color.clear
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            if model == nil {
                let created = makeModel()
                if let page = router.settingsInitialPage { created.show(page) }
                model = created
            }
            if plan == nil {
                let account = app.account
                plan = PlanSettingsModel(load: { await account.loadPlan() })
            }
        }
    }

    private func makeModel() -> SettingsDialogModel {
        let app = self.app
        let router = self.router
        return SettingsDialogModel(
            account: app.account,
            // 退出后按新的匿名身份重新加载（AppEnvironment.signOut 里通知）。
            onSignOut: { Task { @MainActor in await app.signOut() } },
            deleteAccount: { await app.deleteAccount() },
            onClose: { router.settingsOpen = false }
        )
    }
}

struct SettingsScreen: View {
    let model: SettingsDialogModel
    let plan: PlanSettingsModel
    let user: AccountUser

    @Environment(AppEnvironment.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        let account = app.account.state
        let state = model.state
        let dirty = model.dirty
        let page = state.page
        GeometryReader { bounds in
            // 宽窗口（iPad、展开的 iPhone Duo）：左边常驻入口列表（280），右边是选中的一栏；窄窗口是两级切换。
            let split = bounds.size.width >= 720
            ScrollViewReader { proxy in
                HStack(spacing: 0) {
                    if split {
                        scrollBody(account: account, dirty: dirty) { homeContent }
                            .frame(width: 280)
                        Divider()
                    }
                    // 入口列表和一栏的画面各是一个滚动区：换画面就是换一个新的，所以总是从最上面开始（网页 scrollTop = 0）。
                    // 这里不用 transition：旧画面要马上没有（网页 display: none），新画面出现时自己从起点动到位（SettingsEntrance）。
                    // 只有在列表和一栏之间换才重新出场（网页：animation-name 变了才重新播放）；从一栏直接换到另一栏时不动。
                    let animated = state.navigated && !reduceMotion
                    ZStack(alignment: .top) {
                        if let page {
                            SettingsEntrance(offset: entranceOffset(forward: true), animated: animated) {
                                scrollBody(account: account, dirty: dirty) {
                                    pageContent(page, state)
                                }
                                // 被拦下来、从一栏直接换到另一栏时（保存失败等）也换一个新的滚动区。
                                .id(page)
                            }
                        } else if split {
                            scrollBody(account: account, dirty: dirty) { pageContent(.general, state) }
                        } else {
                            SettingsEntrance(offset: entranceOffset(forward: false), animated: animated) {
                                scrollBody(account: account, dirty: dirty) {
                                    homeContent
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .task(id: ScreenshotHooks.sceneTick) {
                    await showScreenshotPage(proxy)
                }
            }
            // 顶栏浮在滚动区上面，放在 SettingsEntrance 外面：换画面时只有内容横移，顶栏不动。
            .nfFloatingHeader(edge: .top, solidFill: Sm.sidebar, divider: false) {
                topBar(page, split: split)
                    .padding(.horizontal, NFChromeMetrics.sideInset)
                    .frame(height: 64)
                    // 浮动顶栏排在滚动区后面（safeAreaBar）：读屏仍然先念顶栏，换画面后从"返回"/"关闭"接着念。
                    .accessibilityElement(children: .contain)
                    .accessibilitySortPriority(1)
            }
        }
        .overlay(alignment: .bottom) {
            ZStack {
                if dirty {
                    SettingsUnsavedBar(
                        attention: state.attention, busy: state.busy,
                        onDiscard: { model.discard() }, onSave: { model.save() }
                    )
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.nfRise(offsetY: 16))
                }
            }
            .padding(16)
            .animation(reduceMotion ? nil : NFMotion.emphasized(0.2), value: dirty)
        }
        // 账号的资料变了（保存成功、失败回滚）：没在编辑时名字输入框跟着走。
        .onChange(of: user) { _, _ in model.userChanged() }
        // 换了画面：读屏从新画面的开头（顶栏的按钮）接着念（网页把焦点移到"返回"上）。
        .onChange(of: page) { _, _ in UIAccessibility.post(notification: .screenChanged, argument: nil) }
        // 读屏的"返回"手势（两指搓擦）= 网页的 Esc：一次退一步。
        .accessibilityAction(.escape) { model.requestClose() }
    }

    // MARK: 顶栏

    /// .settings-header（手机）：三列 44 | 1fr | 44、间距 8（左右 16、高 64 由放它的地方加）。标题在中间那一列里居中，
    /// 所以也在整条顶栏的正中。行首是玻璃圆按钮（这条顶栏唯一的玻璃，也放在一个 GlassEffectContainer 里）。
    /// 宽窗口（左边常驻入口列表）时行首总是"关闭"，标题是右边那一栏的名字（还没选时是"通用"）。
    private func topBar(_ page: SettingsPage?, split: Bool) -> some View {
        let home = split || page == nil
        return NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
            HStack(spacing: 8) {
                NFGlassIconButton(
                    home ? Lucide.x : Lucide.arrowLeft,
                    label: L(home ? "close" : "back"),
                    size: NFChromeMetrics.control,
                    iconSize: home ? 18 : 20,
                    stroke: Sm.border
                ) {
                    // 列表上和宽窗口里是关闭（网页 closeAll），窄窗口的一栏里是回列表（网页 backHome）；拦不拦由模型决定。
                    if split || model.state.page == nil {
                        model.closeAll()
                    } else {
                        model.backHome()
                    }
                }
                Text(L(page?.titleKey ?? (split ? "settings_general" : "acct_settings")))
                    .font(.nf(17, weight: 650))
                    .foregroundStyle(Sm.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .accessibilityAddTraits(.isHeader)
                // 行尾那一列空着，只为让标题居中。
                Color.clear
                    .frame(width: NFChromeMetrics.control, height: NFChromeMetrics.control)
                    .accessibilityHidden(true)
            }
        }
    }

    // MARK: 截图场景

    /// settings-page：进"通用"，打开图标的角色选择（这一栏最长的样子），滚到这张卡片的底，让卡片从浮动顶栏下面过去。
    /// 内容不够一屏时滚不动（系统把位置夹在范围里），画面停在原处。
    private func showScreenshotPage(_ proxy: ScrollViewProxy) async {
        guard ScreenshotHooks.isActive, ScreenshotHooks.scene == .settingsPage else { return }
        try? await Task.sleep(for: .milliseconds(150))
        guard !Task.isCancelled, ScreenshotHooks.consume(.settingsPage) else { return }
        model.show(.general)
        model.setAppIconPicking(true)
        // 换画面的出场（200ms）走完、角色网格排好。
        try? await Task.sleep(for: .milliseconds(450))
        proxy.scrollTo(SettingsScreenshotAnchor.generalCard, anchor: .bottom)
        try? await Task.sleep(for: .milliseconds(300))
        ScreenshotHooks.markReady(.settingsPage)
    }

    // MARK: 滚动区

    /// .settings-body（手机）：左右 16、上 8、下 32；"未保存的更改"条出来时下面多留出条的高度（.has-unsaved，96），最后一块不被挡住。
    /// 最上面是名字、头像、语言保存失败的提示（.settings-save-error，下距 12）：列表和每一栏里都在。
    private func scrollBody<Content: View>(account: AccountUiState, dirty: Bool, @ViewBuilder content: () -> Content) -> some View {
        let inner = content()
        return ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                if let error = account.profileError {
                    SettingsErrorLine(profileErrorText(error, app.systemText))
                        .padding(.bottom, 12)
                }
                inner
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, dirty ? 96 : 32)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    /// 新画面出场的起点（网页 settings-page-forward / settings-page-back 的 16px）：进一栏从行尾一侧来，回列表从行首一侧来。
    /// offset 不随布局方向镜像，所以自己分左右。
    private func entranceOffset(forward: Bool) -> CGFloat {
        let towardTrailing: CGFloat = layoutDirection == .rightToLeft ? -16 : 16
        return forward ? towardTrailing : -towardTrailing
    }

    // MARK: 入口列表

    /// .settings-home：账号行，下面 24 是各栏的行（顺序同网页 TABS）。
    private var homeContent: some View {
        let pages = SettingsPage.allCases
        return VStack(alignment: .leading, spacing: 24) {
            SettingsIdentityCard(user: user) { model.show(.account) }
            SettingsCard {
                ForEach(pages, id: \.self) { page in
                    SettingsHomeRow(L(page.titleKey), icon: page.icon, divided: page != pages.first) {
                        model.show(page)
                    }
                }
            }
        }
    }

    // MARK: 各栏

    /// 一栏的内容（网页 .settings-group.is-active；"账号"是个人资料和账号两块，间距 24）。
    @ViewBuilder
    private func pageContent(_ page: SettingsPage, _ state: SettingsDialogState) -> some View {
        switch page {
        case .general:
            SettingsCard {
                LanguageSettingsRowView(user: user)
                SettingsRowDivider()
                ThemeSettingsRowView()
                SettingsRowDivider()
                AppIconSettings(model: model)
            }
            // 截图场景 settings-page 滚到这里（固定的 id，不影响视图的身份）。
            .id(SettingsScreenshotAnchor.generalCard)
        case .personalization:
            SettingsCard(padded: true) {
                CustomInstructionsSection(model: model)
                if let error = state.error {
                    SettingsErrorLine(error.text("acct_err_save_custom_instructions", app.systemText))
                        .padding(.top, 12)
                }
            }
        case .plan:
            SettingsCard(padded: true) {
                PlanSettingsCard(model: plan)
            }
        case .account:
            SettingsCard(padded: true) {
                ProfileSettings(model: model, user: user)
            }
            SettingsCard {
                SettingsRowButton(L("sign_out"), icon: Lucide.logOut) { model.signOut() }
                    .disabled(!model.signOutEnabled)
                SettingsRowDivider()
                DeleteAccountSection(model: model)
            }
            .padding(.top, 24)
        }
    }
}

/// 截图场景里 `ScrollViewReader` 滚动的目标。
private enum SettingsScreenshotAnchor {
    static let generalCard = "settings-general-card"
}

// MARK: - 自定义指令

/// 自定义指令：标题 15/500 + 右边的计数 12 灰（读到后才有；刚保存完换成绿色的"✓ 已保存"12/500）、说明 13 灰、
/// 读取中 / 失败 + 重试、输入框。
private struct CustomInstructionsSection: View {
    let model: SettingsDialogModel

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let state = model.state
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            Text(L("acct_custom_instructions"))
                .font(.nf(15, weight: 500))
                .nfLineHeight(22.5, fontSize: 15)
                .foregroundStyle(Sm.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            if model.saved {
                HStack(spacing: 4) {
                    LucideIcon(Lucide.check, size: 13, color: settingsSavedGreen)
                    Text(L("save_saved"))
                        .font(.nf(12, weight: 500))
                        .foregroundStyle(settingsSavedGreen)
                }
                .accessibilityElement(children: .combine)
            } else if let count = model.instructionsCount {
                Text(count)
                    .font(.nf(12))
                    .foregroundStyle(Sm.muted)
                    .monospacedDigit()
            }
        }
        SettingsHelpLine(L("acct_custom_instructions_help"))
        if let loadError = state.loadError {
            SettingsErrorLine(loadError.text("acct_err_load_custom_instructions", app.systemText))
                .padding(.top, 12)
            NotionButton(L("try_again")) { model.retryLoad() }
                .padding(.top, 8)
        } else if state.initial == nil {
            SettingsLoadingLine()
        } else {
            SettingsInstructionsField(
                text: Binding(get: { model.state.instructions }, set: { model.setInstructions($0) }),
                label: L("acct_custom_instructions"),
                placeholder: L("acct_custom_instructions_placeholder")
            )
            .disabled(state.busy)
        }
    }
}

/// textarea.settings-textarea（手机）：上距 12、最小高 240、1px 深描边、圆角 10、内边距 10×12、16 / 行高 1.55；
/// 聚焦时蓝边 + 外侧 3px 的 rgba(35,131,226,.16) 光圈。
private struct SettingsInstructionsField: View {
    @Binding var text: String
    let label: String
    let placeholder: String

    @FocusState private var focused: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10)
        // 行高 24.8：比字体自然行高多出来的部分当行距。
        let spacing: CGFloat = 24.8 - 16 * 1.193
        TextEditor(text: $text)
            .font(.nf(16))
            .lineSpacing(spacing)
            .foregroundStyle(Sm.text)
            .tint(Sm.text)
            .scrollContentBackground(.hidden)
            .focused($focused)
            // TextEditor 自带上下 8、左右 5 的留白，补到 10×12。
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .frame(minHeight: 240, maxHeight: 480)
            .background(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .font(.nf(16))
                        .lineSpacing(spacing)
                        .foregroundStyle(Sm.faint)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .background(Sm.surface, in: shape)
            .overlay { shape.strokeBorder(focused ? Sm.blue : Sm.borderStrong, lineWidth: 1) }
            .background {
                // 光圈画在描边外侧 3px。
                RoundedRectangle(cornerRadius: 13)
                    .fill(focused ? Sm.focusRing : Color.clear)
                    .padding(-3)
            }
            .padding(.top, 12)
            .accessibilityLabel(label)
    }
}

/// 新画面的出场（网页 settings-page-forward / settings-page-back）：从横向 `offset` 外淡入，200ms cubic-bezier(.2,.8,.2,1)。
/// 每个画面一个：这个视图出现时自己从起点动到位，所以旧画面不用留着陪它。`animated` 为 false 时（"减弱动态效果"、
/// 刚打开的列表）一出现就在位。
private struct SettingsEntrance<Content: View>: View {
    private let offset: CGFloat
    private let content: Content
    @State private var shown: Bool

    init(offset: CGFloat, animated: Bool, @ViewBuilder content: () -> Content) {
        self.offset = offset
        self.content = content()
        _shown = State(initialValue: !animated)
    }

    var body: some View {
        content
            .offset(x: shown ? 0 : offset)
            .opacity(shown ? 1 : 0)
            .onAppear {
                if shown { return }
                withAnimation(NFMotion.emphasized(0.2)) { shown = true }
            }
    }
}
