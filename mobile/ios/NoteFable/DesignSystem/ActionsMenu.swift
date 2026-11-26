import SwiftUI

// “更多”菜单（网页 `.chat-actions-menu`，Android `ActionsMenu` / `AnswerMenu`）：贴着按钮弹出的白色小面板。
// 宽 228（笔记页面菜单 248）、内边距 5.6、圆角 12、1px 细线、阴影 0 8 32 #0002；最高到离上下边各 8，再高就在里面滚动。
// 位置：按钮下方 4，和按钮的行首或行尾对齐；下方放不下就翻到上方；离边至少 8。点外面关闭（遮罩是透明的）。
// 进场（`.chat-row-menu` / `.help-menu`）：从靠按钮的那个角 140ms 展开（透明度 0 → 1、位移 4 → 0、缩放 .96 → 1，
// cubic-bezier(.2,.8,.2,1)）；网页关的时候没有动画，这里也直接消失。“减弱动态效果”时不动。
// 系统的 Menu / UIMenu 外观对不上，所以自己画在 `.nfOverlayHost()` 上。

// MARK: - 显示

/// 菜单和按钮哪一边对齐。
enum ActionsMenuAlignment {
    /// 菜单的行首边对齐按钮的行首边（回答下面的“…”）。
    case leading
    /// 菜单的行尾边对齐按钮的行尾边（侧栏行、顶栏右边的“…”）。
    case trailing
}

/// 先试着放在按钮的哪一边；放不下时换到另一边。
enum ActionsMenuPlacement {
    case below
    /// 侧栏底部的帮助菜单：在按钮上方打开。
    case above
}

struct ActionsMenuConfiguration {
    var width: CGFloat = 228
    var alignment: ActionsMenuAlignment = .trailing
    var placement: ActionsMenuPlacement = .below
    var animated = true
    /// 读屏念的菜单名（网页 dialog 的 aria-label）。
    var label: String?
}

extension View {
    /// 贴着这个视图（一般是“…”按钮）弹出菜单。内容用 `ActionsMenuItem`、`ActionsMenuDivider`、`ActionsMenuToggle`、
    /// `ActionsMenuLabel`、`ActionsMenuError` 搭，也可以放别的视图。需要根上装了 `.nfOverlayHost()`（或 `.actionsMenuHost()`）。
    /// `dismissDisabled` 为 true 时点外面不关（菜单里的操作正在保存）。选了一项要不要关由调用方决定：
    /// 一般先把绑定设回 false 再做事；也可以留着菜单显示进度（`isBusy`）和错误。
    ///
    /// ```swift
    /// NFIconButton(Lucide.ellipsis, label: L("sb_more")) { menuOpen = true }
    ///     .actionsMenu(isPresented: $menuOpen, label: L("sb_actions_for_title", session.title)) {
    ///         ActionsMenuItem(L("sb_rename"), icon: Lucide.pencil) { menuOpen = false; rename() }
    ///         ActionsMenuItem(L("move_to_project"), icon: Lucide.folderInput) { menuOpen = false; move() }
    ///         ActionsMenuDivider()
    ///         ActionsMenuItem(L("sb_delete_"), icon: Lucide.trash2, role: .danger) { menuOpen = false; delete() }
    ///     }
    /// ```
    func actionsMenu<MenuContent: View>(
        isPresented: Binding<Bool>,
        width: CGFloat = 228,
        alignment: ActionsMenuAlignment = .trailing,
        placement: ActionsMenuPlacement = .below,
        animated: Bool = true,
        dismissDisabled: Bool = false,
        label: String? = nil,
        @ViewBuilder content: @escaping () -> MenuContent
    ) -> some View {
        modifier(NFAnchoredOverlayPresenter(
            isPresented: isPresented.wrappedValue,
            configuration: ActionsMenuConfiguration(width: width, alignment: alignment, placement: placement, animated: animated, label: label),
            dismissDisabled: dismissDisabled,
            overlayContent: { AnyView(content()) },
            dismiss: { isPresented.wrappedValue = false }
        ))
    }
}

// MARK: - 位置

/// 菜单放在哪里。坐标是宿主里的坐标（行首为 0；从右到左的界面里 SwiftUI 整体镜像，算法不用分方向）。
enum ActionsMenuGeometry {
    struct Result: Equatable {
        var origin: CGPoint
        /// 菜单在按钮上方（展开动画从下面的角开始）。
        var opensAbove: Bool
    }

    static func place(
        anchor: CGRect,
        menu: CGSize,
        bounds: CGSize,
        alignment: ActionsMenuAlignment,
        placement: ActionsMenuPlacement,
        gap: CGFloat = 4,
        edge: CGFloat = 8
    ) -> Result {
        let preferredX = alignment == .trailing ? anchor.maxX - menu.width : anchor.minX
        let x = max(edge, min(preferredX, bounds.width - menu.width - edge))

        let below = anchor.maxY + gap
        let above = anchor.minY - gap - menu.height
        let fitsBelow = below + menu.height <= bounds.height - edge
        let fitsAbove = above >= edge
        let opensAbove: Bool
        switch placement {
        case .below: opensAbove = !fitsBelow && fitsAbove
        case .above: opensAbove = fitsAbove || !fitsBelow
        }
        // 两边都放不下时留在选定的一边，往里收到离边 8。
        let lowest = max(edge, bounds.height - edge - menu.height)
        let y = min(max(edge, opensAbove ? above : below), lowest)
        return Result(origin: CGPoint(x: x, y: y), opensAbove: opensAbove)
    }
}

// MARK: - 这一层的样子

struct ActionsMenuLayer: View {
    let item: NFOverlayItem
    let configuration: ActionsMenuConfiguration
    let globalAnchorRect: CGRect
    let metrics: NFOverlayMetrics
    let zBase: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    @State private var contentHeight: CGFloat?
    @State private var shown = false

    var body: some View {
        // 点外面关闭。
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture {
                if !item.dismissDisabled { item.dismiss() }
            }
            .ignoresSafeArea()
            .accessibilityHidden(true)
            .zIndex(zBase)

        GeometryReader { proxy in
            // 离上下边至少 8；将全局坐标转换为宿主逻辑坐标（RTL 下 X 从右侧起算以配合 SwiftUI 自动镜像）。
            let edge: CGFloat = 8
            let hostGlobal = proxy.frame(in: .global)
            let localX = (layoutDirection == .rightToLeft)
                ? (hostGlobal.maxX - globalAnchorRect.maxX)
                : (globalAnchorRect.minX - hostGlobal.minX)
            let localAnchor = CGRect(
                x: localX,
                y: globalAnchorRect.minY - hostGlobal.minY,
                width: globalAnchorRect.width,
                height: globalAnchorRect.height
            )
            let maxHeight = max(44, metrics.availableHeight - edge * 2)
            let height = min(contentHeight ?? 0, maxHeight)
            let placed = ActionsMenuGeometry.place(
                anchor: localAnchor,
                menu: CGSize(width: configuration.width, height: height),
                bounds: CGSize(width: metrics.size.width, height: metrics.availableHeight),
                alignment: configuration.alignment,
                placement: configuration.placement,
                edge: edge
            )
            let visible = shown && contentHeight != nil
            let resting = visible || !animates

            card(maxHeight: maxHeight)
                // 从靠按钮的那个角展开。
                .scaleEffect(resting ? 1 : 0.96, anchor: corner(opensAbove: placed.opensAbove))
                .offset(x: placed.origin.x, y: placed.origin.y + (resting ? 0 : (placed.opensAbove ? 4 : -4)))
                .opacity(visible ? 1 : 0)
        }
        // 菜单里再打开的东西画在这一层上面。
        .nfOverlayHost()
        .zIndex(zBase + 0.5)
        // 量到内容高度、位置定下来之后再开始展开。
        .onChange(of: contentHeight != nil, initial: true) { _, measured in
            guard measured, !shown else { return }
            withAnimation(animates ? NFMotion.emphasized(0.14) : nil) { shown = true }
        }
    }

    private var animates: Bool {
        configuration.animated && !reduceMotion
    }

    private func corner(opensAbove: Bool) -> UnitPoint {
        switch (configuration.alignment, opensAbove) {
        case (.trailing, false): return .topTrailing
        case (.trailing, true): return .bottomTrailing
        case (.leading, false): return .topLeading
        case (.leading, true): return .bottomLeading
        }
    }

    private func card(maxHeight: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        return ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                item.content()
            }
            .nfOverlayContentDefaults()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(5.6)
            .nfOnSizeChange { size in
                if contentHeight != size.height { contentHeight = size.height }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(width: configuration.width, height: min(contentHeight ?? maxHeight, maxHeight))
        // 先裁内容再上玻璃（玻璃自己的边缘和高光不被裁掉）；普通玻璃、不可交互；自定义阴影只在非原生玻璃时画。
        .clipShape(shape)
        .nfGlassBackground(.regular, in: shape, solidFill: Sm.surface, stroke: Sm.border)
        .nfChromeShadow(Sm.menuShadow, radius: 16, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(configuration.label ?? "")
        .accessibilityAddTraits(.isModal)
    }
}

// MARK: - 菜单里的部件

enum ActionsMenuItemRole {
    case normal
    /// `.chat-menu-item.is-danger`：红字 `#b91c1c`。
    case danger
}

/// 菜单的一项（`.chat-menu-item`，手机）：最小高 44、内边距 9.6×12、圆角 6.4、图标 16 + 间距 12、字 14 / 行高 21，文字不省略、可以折行。
/// 按下灰底。`isBusy` 时图标的位置换成转圈（“正在保存…”）。不可用（`.disabled(true)`）时字和图标变灰；危险项保持红色。
/// `value` 是行尾的灰色小字（帮助菜单里的当前语言），`isSelected` 是行尾的蓝色 ✓ 加深灰底（语言菜单的当前项）。
/// `iconColor` 不给时图标和字同色（帮助菜单的图标是灰的：`iconColor: Sm.muted`）。
///
/// ```swift
/// ActionsMenuItem(L("sb_pin"), icon: Lucide.pin) { pin() }
/// ActionsMenuItem(saving ? L("save_saving") : L("answer_save_to_page"), icon: Lucide.filePlus2, isBusy: saving) { save() }
///     .disabled(saving)
/// ActionsMenuItem(L("sb_delete_"), icon: Lucide.trash2, role: .danger) { delete() }
/// ```
struct ActionsMenuItem: View {
    private let title: String
    private let icon: [String]?
    private let leading: AnyView?
    private let role: ActionsMenuItemRole
    private let iconColor: Color?
    private let isBusy: Bool
    private let value: String?
    private let isSelected: Bool
    private let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    init(
        _ title: String,
        icon: [String]? = nil,
        role: ActionsMenuItemRole = .normal,
        iconColor: Color? = nil,
        isBusy: Bool = false,
        value: String? = nil,
        isSelected: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.icon = icon
        self.leading = nil
        self.role = role
        self.iconColor = iconColor
        self.isBusy = isBusy
        self.value = value
        self.isSelected = isSelected
        self.action = action
    }

    init<Leading: View>(
        _ title: String,
        role: ActionsMenuItemRole = .normal,
        isBusy: Bool = false,
        @ViewBuilder leading: () -> Leading,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.icon = nil
        self.leading = AnyView(leading())
        self.role = role
        self.iconColor = nil
        self.isBusy = isBusy
        self.value = nil
        self.isSelected = false
        self.action = action
    }

    private var color: Color {
        if role == .danger { return Sm.danger }
        return isEnabled ? Sm.text : Sm.muted
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if isBusy {
                    Spinner(size: 16, color: color)
                } else if let leading {
                    leading
                } else if let icon {
                    LucideIcon(icon, size: 16, color: isEnabled ? (iconColor ?? color) : color)
                }
                ActionsMenuText(title, color: color)
                if let value {
                    // .help-menu-value：13 灰字，最多占 65% 宽，靠行尾。
                    Text(value)
                        .font(.nf(13))
                        .foregroundStyle(Sm.muted)
                        .multilineTextAlignment(.trailing)
                }
                if isSelected {
                    LucideIcon(Lucide.check, size: 16, color: Sm.blue)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9.6)
            .frame(minHeight: 44)
        }
        .buttonStyle(.pressable(background: isSelected ? Sm.active : .clear, cornerRadius: 6.4))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// 开关项（`.chat-menu-item` + `.notes-menu-switch`）：和 `ActionsMenuItem` 同样的行，行尾是小开关。点一下调 `action`，菜单不关。
///
/// ```swift
/// ActionsMenuToggle(L("pg_lock_page"), icon: Lucide.lock, isOn: page.locked) { toggleLock() }
/// ```
struct ActionsMenuToggle: View {
    private let title: String
    private let icon: [String]?
    private let isOn: Bool
    private let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    init(_ title: String, icon: [String]? = nil, isOn: Bool, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.isOn = isOn
        self.action = action
    }

    var body: some View {
        let color = isEnabled ? Sm.text : Sm.muted
        Button(action: action) {
            HStack(spacing: 12) {
                if let icon { LucideIcon(icon, size: 16, color: color) }
                ActionsMenuText(title, color: color)
                NFSwitch(isOn: isOn)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9.6)
            .frame(minHeight: 44)
        }
        .buttonStyle(.pressable(cornerRadius: 6.4))
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(Text(verbatim: isOn ? "1" : "0"))
    }
}

/// 菜单项的文字：14 / 行高 21，占满剩下的宽度、左对齐、可以折行。
private struct ActionsMenuText: View {
    let title: String
    let color: Color

    init(_ title: String, color: Color) {
        self.title = title
        self.color = color
    }

    var body: some View {
        Text(title)
            .font(.nf(14))
            .nfLineHeight(21, fontSize: 14)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 分隔线（`.chat-menu-divider`）：1px 细线，上下 4.8、左右 8。
struct ActionsMenuDivider: View {
    var body: some View {
        NFDivider()
            .padding(.horizontal, 8)
            .padding(.vertical, 4.8)
    }
}

/// 小标题（`.notes-menu-label`）：12 / 500 灰字，内边距 5.6 / 12 / 2.4。笔记页面菜单的“样式”。
struct ActionsMenuLabel: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.nf(12, weight: 500))
            .nfLineHeight(16, fontSize: 12)
            .foregroundStyle(Sm.muted)
            .padding(.horizontal, 12)
            .padding(.top, 5.6)
            .padding(.bottom, 2.4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 菜单里的错误文：13 / 行高 18.2。操作失败时菜单不关，原因显示在项目下面。
/// - `.chat`（`.chat-menu-error`）：红字 `#b91c1c`，外边距 4.8 / 12 / 6.4。侧栏的菜单。
/// - `.answer`（`.answer-menu-error`）：`#933b34`，上下 5.6、左右 12。回答和笔记页面的菜单。
///
/// ```swift
/// if let error { ActionsMenuError(error) }
/// ```
struct ActionsMenuError: View {
    enum Tone {
        case chat
        case answer
    }

    private let text: String
    private let tone: Tone

    init(_ text: String, tone: Tone = .chat) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(text)
            .font(.nf(13))
            .nfLineHeight(18.2, fontSize: 13)
            .foregroundStyle(tone == .chat ? Sm.danger : Sm.errorText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12)
            .padding(.top, tone == .chat ? 4.8 : 5.6)
            .padding(.bottom, tone == .chat ? 6.4 : 5.6)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
