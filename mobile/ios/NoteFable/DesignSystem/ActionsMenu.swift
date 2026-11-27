import SwiftUI

// 弹出菜单已迁移到系统原生 `Menu` 或原生 `.nfPopover(...)`；这里保留 `.nfPopover` 内部使用的行与开关组件。

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
    @Environment(\.nfChromePath) private var chromePath

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
        let base = chromePath == .native ? chromePath.primaryInk : Sm.text
        return isEnabled ? base : Sm.muted
    }

    var body: some View {
        let selectedBg = chromePath == .native ? Color.primary.opacity(0.08) : Sm.active
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
            .padding(.vertical, 9)
            .frame(minHeight: 44)
        }
        .buttonStyle(.pressable(background: isSelected ? selectedBg : .clear, cornerRadius: 12))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// 开关项（`.chat-menu-item` + `.notes-menu-switch`）：和 `ActionsMenuItem` 同样的行，行尾是系统原生 `Toggle`。点一下调 `action`，不关面板。
struct ActionsMenuToggle: View {
    private let title: String
    private let icon: [String]?
    private let isOn: Bool
    private let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.nfChromePath) private var chromePath

    init(_ title: String, icon: [String]? = nil, isOn: Bool, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.isOn = isOn
        self.action = action
    }

    var body: some View {
        let base = chromePath == .native ? chromePath.primaryInk : Sm.text
        let color = isEnabled ? base : Sm.muted
        let binding = Binding<Bool>(
            get: { isOn },
            set: { _ in
                Haptics.selection()
                action()
            }
        )
        Toggle(isOn: binding) {
            HStack(spacing: 12) {
                if let icon { LucideIcon(icon, size: 16, color: color) }
                ActionsMenuText(title, color: color)
            }
        }
        .tint(Sm.blue)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .frame(minHeight: 44)
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

/// 分隔线（`.chat-menu-divider`）：1px 细线，上下 4、左右 10。
struct ActionsMenuDivider: View {
    var body: some View {
        NFDivider()
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
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
