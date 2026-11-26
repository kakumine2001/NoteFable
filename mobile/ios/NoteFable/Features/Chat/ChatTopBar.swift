import SwiftUI

/// 聊天的浮动顶栏（#195 Phase 2a，iOS 26 Liquid Glass）：由 `ChatWorkspace` 用 `nfFloatingHeader(edge: .top)` 浮在消息上面，
/// 消息从下面滚过去。高度在任何状态下都是 56（空白、读取中、发送中、有没有标题和“…”都一样），顶部安全区不会变，列表不跳。
/// - 行首：玻璃圆的菜单（44，图标 20），打开侧栏。
/// - 正中：有标题时是玻璃胶囊（`ChatSessionCapsule`）：AI 角色（28，回答时跟着动）+ 聊天图标和标题 + 模型 / 推理强度，
///   点开和输入栏模型按钮同一个模型抽屉。标题放得下时居中对齐；放不下时只让出各自按钮的宽度。
/// - 行尾：玻璃圆的“新建聊天”与独立圆形系统原生 Liquid Glass `Menu`“…”（放在 `GlassEffectContainer` 外，避免 FORUM 826863 收起闪烁）。
@MainActor
struct ChatTopBar: View {
    /// 没有消息时为 nil。
    let title: String?
    let icon: String?
    /// 当前会话（“…”菜单的对象）；空白首页和还没保存的新聊天是 nil，这时没有“…”。
    let session: SessionSummary?
    /// 行尾的“新建聊天”（和“…”）：空白首页不显示。
    let showTrailing: Bool
    /// 点了胶囊：打开模型抽屉（先收起键盘）。
    let onModelClick: () -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.nfChromePath) private var chromePath
    @State private var dialog: ChatDialogItem? = nil
    /// 表情选择器（菜单里的“更改聊天图标”）。
    @State private var pickingIcon = false

    var body: some View {
        let chat = app.chat.state
        // 截图钩子只在这段聊天的消息读完后动手。
        let messagesReady = !chat.messagesLoading && !chat.messages.isEmpty
        let capsuleAvailable = title != nil
        let showsSidebarToggle = !router.isSidebarDockedVisible
        let leadingReserve: CGFloat = showsSidebarToggle ? (NFChromeMetrics.control + NFChromeMetrics.gap) : 0
        let trailingReserve: CGFloat = showTrailing
            ? (NFChromeMetrics.control + (session != nil ? NFChromeMetrics.gap + NFChromeMetrics.control : 0) + NFChromeMetrics.gap)
            : 0
        ZStack {
            HStack(spacing: NFChromeMetrics.gap) {
                if showsSidebarToggle {
                    NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
                        NFGlassIconButton(Lucide.menu, label: L("open_menu"), size: NFChromeMetrics.control, iconSize: 20) {
                            router.openSidebar()
                        }
                    }
                    .accessibilitySortPriority(2)
                }
                Spacer(minLength: 0)
                if showTrailing {
                    HStack(spacing: NFChromeMetrics.gap) {
                        NFGlassContainer(spacing: NFChromeMetrics.containerSpacing) {
                            NFGlassIconButton(Lucide.plus, label: L("new_chat"), size: NFChromeMetrics.control, iconSize: 20) {
                                app.chat.newChat()
                            }
                        }
                        if let session {
                            moreButton(session)
                        }
                    }
                }
            }
            if let title {
                // 放得下完整标题时两边让出同样的宽度，胶囊在整条栏的正中；放不下（窄窗口、长标题）时
                // 两边只让出各自按钮的宽度，标题多占一些再省略。
                ZStack {
                    ViewThatFits(in: .horizontal) {
                        ChatSessionCapsule(title: title, icon: icon, onModelClick: onModelClick)
                            .padding(.horizontal, max(leadingReserve, trailingReserve))
                        ChatSessionCapsule(title: title, icon: icon, onModelClick: onModelClick)
                            .padding(.leading, leadingReserve)
                            .padding(.trailing, trailingReserve)
                    }
                }
                .emojiPicker(isPresented: $pickingIcon, current: icon) { picked in
                    app.chat.changeIcon(picked)
                }
                // 胶囊不在了（换成新聊天）：选择器的开关也归位，下次出现时不自己弹出来。
                .onDisappear { pickingIcon = false }
                .accessibilitySortPriority(1)
            }
        }
        // 读屏按 菜单 → 标题胶囊 → 新建聊天 → “…” 的顺序念（胶囊叠在按钮行上面，否则会排到最后）。
        .accessibilityElement(children: .contain)
        .padding(.horizontal, NFChromeMetrics.sideInset)
        .frame(height: NFChromeMetrics.barHeight)
        .frame(maxWidth: .infinity)
        .animation(NFMotion.unlessReduced(NFMotion.cssEase(0.18), reduceMotion), value: showTrailing)
        .nfDialog(item: $dialog, dismissDisabled: dialog?.runner.busy ?? false) { item in
            ChatActionDialog(item: item)
        }
        // 登录 / 退出后：旧身份的对话框和选择器都关掉（和侧栏一样）。
        .onChange(of: app.identityGeneration) { _, _ in
            dialog = nil
            pickingIcon = false
        }
        .onChange(of: ScreenshotHooks.dismissTick) { _, _ in
            pickingIcon = false
        }
        .task(id: "\(ScreenshotHooks.sceneTick)-\(session?.id ?? "")-\(messagesReady)") {
            await runScreenshotHook(ready: messagesReady, capsuleAvailable: capsuleAvailable)
        }
    }

    /// “…”：系统原生 Liquid Glass 菜单，放在 GlassEffectContainer 之外避免收起闪烁（FORUM 826863）。
    private func moreButton(_ session: SessionSummary) -> some View {
        let label = L("sb_actions_for_title", session.title)
        return Menu {
            ChatSessionMenuItems(
                session: session,
                onChangeIcon: {
                    Task { @MainActor in pickingIcon = true }
                },
                onAction: { action in
                    dialog = ChatDialogItem(action: action, runner: SidebarActionRunner(onClose: { dialog = nil }))
                }
            )
        } label: {
            LucideIcon(Lucide.moreHorizontal, size: 20, strokeWidth: 2, color: chromePath.primaryInk)
                .frame(width: NFChromeMetrics.control, height: NFChromeMetrics.control)
                .nfGlassBackground(.interactive, in: Circle(), solidFill: Sm.surface, stroke: Sm.borderStrong)
                .nfChromeShadow(NFChromeMetrics.controlShadow, radius: 6, y: 2)
                .contentShape(Circle())
        }
        .accessibilityLabel(label)
    }

    /// CI 截图：emoji-picker 打开表情选择器（先等排版落下）。
    private func runScreenshotHook(ready: Bool, capsuleAvailable: Bool) async {
        guard ScreenshotHooks.isActive, ready else { return }
        if ScreenshotHooks.scene == .emojiPicker, capsuleAvailable {
            try? await Task.sleep(for: .milliseconds(150))
            if Task.isCancelled { return }
            if ScreenshotHooks.consume(.emojiPicker) {
                pickingIcon = true
                // 等系统自适应 .sheet / .popover 进场动画落稳。
                try? await Task.sleep(for: .milliseconds(450))
                ScreenshotHooks.markReady(.emojiPicker)
            }
        }
    }
}

/// 顶栏正中的玻璃胶囊：AI 角色 28 + 两行字（聊天图标和 14 / 600 标题；12 / 500 的模型名和推理强度）+ ChevronDown 14。
/// 高 44、左 8 右 12，可交互的玻璃（按下时玻璃自己鼓起，iOS 26 上不再缩放）。字色按渲染路径：玻璃上用系统的
/// primary / secondary（跟着下面的内容翻转深浅），其他路径用品牌的 `Sm.text` / `Sm.muted`。
@MainActor
private struct ChatSessionCapsule: View {
    let title: String
    let icon: String?
    let onModelClick: () -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let state = app.chat.state
        // 和输入栏的模型按钮读同样的值。
        let modelLabel = state.selectedModel?.label
        let effort = state.selectedReasoning.map { ChatReasoningText.label($0) }
        let ink = chromePath.primaryInk
        let subInk = chromePath.secondaryInk
        Button(action: onModelClick) {
            HStack(spacing: 8) {
                ChatTopBarAvatar(size: 28)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 4) {
                        if let icon, !icon.isEmpty {
                            Text(icon)
                                .font(.system(size: 13))
                                .lineLimit(1)
                                .fixedSize()
                        }
                        Text(title)
                            .font(.nf(14, weight: 600))
                            .foregroundStyle(ink)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    if let modelLabel {
                        HStack(spacing: 4) {
                            Text(modelLabel)
                                .lineLimit(1)
                                .truncationMode(.tail)
                            if let effort {
                                Text(effort)
                                    .lineLimit(1)
                                    .fixedSize()
                            }
                        }
                        .font(.nf(12, weight: 500))
                        .foregroundStyle(subInk)
                    }
                }
                LucideIcon(Lucide.chevronDown, size: 14, color: subInk)
            }
            .padding(.leading, 8)
            .padding(.trailing, 12)
            .frame(height: NFChromeMetrics.control)
            .nfGlassBackground(.interactive, in: Capsule(), solidFill: Sm.surface, stroke: Sm.borderStrong)
            .contentShape(Capsule())
        }
        .buttonStyle(.pressable(
            pressedBackground: nil,
            cornerRadius: NFChromeMetrics.control / 2,
            scale: chromePath == .native ? 1 : 0.97
        ))
        .nfChromeShadow(NFChromeMetrics.controlShadow, radius: 6, y: 2)
        .accessibilityElement(children: .combine)
    }
}

/// 胶囊里的 AI 角色：和回答顶部的角色（`AssistantLabelRow`）一样，跟着这段聊天最新回答的生成状态动。
@MainActor
private struct ChatTopBarAvatar: View {
    let size: CGFloat

    @Environment(AppEnvironment.self) private var app

    var body: some View {
        let character = app.chat.state.activeReplyCharacterState()
        AppIconView(
            icon: app.appIcon.icon,
            state: character,
            size: size,
            animated: character != .idle && character != .hidden
        )
    }
}

/// 聊天图标按钮（网页 ChatTopbarIcon / ChatTitleIcon，aria-label "Change chat icon"）：有表情画表情，没有画 MessageSquareText；
/// 点开表情选择器，选了就改当前聊天的图标（还没保存的新聊天是草稿图标）。空白首页的标题块在用（顶栏改走“…”菜单）。
struct ChatIconButton: View {
    let icon: String?
    /// 按钮见方的边长。
    let box: CGFloat
    let cornerRadius: CGFloat
    let emojiSize: CGFloat
    let glyphSize: CGFloat
    let strokeWidth: CGFloat

    @Environment(AppEnvironment.self) private var app
    @State private var picking = false

    var body: some View {
        Button {
            picking.toggle()
        } label: {
            Group {
                if let icon, !icon.isEmpty {
                    // 表情按字号画，行高收紧到 1。
                    Text(icon)
                        .font(.system(size: emojiSize))
                        .lineLimit(1)
                        .fixedSize()
                } else {
                    LucideIcon(Lucide.messageSquareText, size: glyphSize, strokeWidth: strokeWidth, color: Sm.muted)
                }
            }
            .frame(width: box, height: box)
        }
        .buttonStyle(.pressable(cornerRadius: cornerRadius))
        .accessibilityLabel(L("em_change_chat_icon"))
        .emojiPicker(isPresented: $picking, current: icon) { picked in
            app.chat.changeIcon(picked)
        }
    }
}
