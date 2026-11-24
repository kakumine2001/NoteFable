import SwiftUI

// 网页里到处用的按钮和行（globals.css 的 .notion-icon-button / .notion-button / .sidebar-primary-action、
// settings-dialog.css 的 .settings-chip、.notes-dialog-option / .model-sheet-row），数值是手机宽度（< 640）下的。
// 按下的手感照 motion.css：`:active { transform: scale(.97) }`，140ms、--ease-out；“减弱动态效果”时不缩放。

// MARK: - 按下的反馈

/// 按下时换底色、稍微缩小的按钮样式。别的按钮和行都在它上面搭。
/// 网页用鼠标悬停的灰底（`--notion-hover`）表示“这里能点”，触屏没有悬停，所以原生把它放在按下的时候（Android 是水波）。
///
/// ```swift
/// Button { open() } label: { RowContent() }
///     .buttonStyle(.pressable(cornerRadius: 6.4))                 // 行：按下灰底，不缩放
/// Button { pick() } label: { Label() }
///     .buttonStyle(.pressable(background: Sm.hover, cornerRadius: 10.4, scale: 0.97))   // 选中的行：常驻灰底
/// ```
struct PressableButtonStyle: ButtonStyle {
    /// 平时的底色（选中态等）。
    var background: Color = .clear
    /// 按下时叠在上面的底色；nil 表示按下不换色。
    var pressedBackground: Color? = Sm.hover
    var cornerRadius: CGFloat = 4.8
    /// 按下时的缩放（网页大多数按钮是 .97，列表行不缩放）。
    var scale: CGFloat = 1
    /// 不可用时整体的不透明度（网页各处不同：.55、.6；不想变淡传 1）。
    var disabledOpacity: Double = 1

    func makeBody(configuration: Configuration) -> some View {
        PressableBody(configuration: configuration, style: self)
    }
}

extension ButtonStyle where Self == PressableButtonStyle {
    /// 见 `PressableButtonStyle`。
    static func pressable(
        background: Color = .clear,
        pressedBackground: Color? = Sm.hover,
        cornerRadius: CGFloat = 4.8,
        scale: CGFloat = 1,
        disabledOpacity: Double = 1
    ) -> PressableButtonStyle {
        PressableButtonStyle(
            background: background, pressedBackground: pressedBackground, cornerRadius: cornerRadius,
            scale: scale, disabledOpacity: disabledOpacity
        )
    }
}

/// 样式里要读环境（是否可用、是否减弱动态效果），所以放在一个视图里。
private struct PressableBody: View {
    let configuration: ButtonStyleConfiguration
    let style: PressableButtonStyle
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let pressed = configuration.isPressed && isEnabled
        configuration.label
            .background {
                RoundedRectangle(cornerRadius: style.cornerRadius)
                    .fill(style.background)
                    .overlay {
                        RoundedRectangle(cornerRadius: style.cornerRadius)
                            .fill(pressed ? (style.pressedBackground ?? .clear) : .clear)
                    }
            }
            .contentShape(RoundedRectangle(cornerRadius: style.cornerRadius))
            .opacity(isEnabled ? 1 : style.disabledOpacity)
            .scaleEffect(pressed && !reduceMotion ? style.scale : 1)
            .animation(NFMotion.unlessReduced(NFMotion.press, reduceMotion), value: pressed)
    }
}

// MARK: - 图标按钮

/// `.notion-icon-button`（手机）：40×40、圆角 4.8、灰色图标 20，按下灰底并缩到 .97。顶栏、侧栏头部、输入栏的“＋”都是它。
/// 尺寸可调：回答下面的操作键是 36（图标 16，线宽 1.9），侧栏的小按钮是 25.6。不可用时图标变成 `--notion-faint`（.36）。
///
/// ```swift
/// NFIconButton(Lucide.menu, label: L("open_menu")) { openDrawer() }
/// NFIconButton(Lucide.copy, label: L("copy"), size: 36, iconSize: 16, strokeWidth: 1.9) { copy() }
/// ```
/// `label` 是读屏念的名字（网页的 aria-label）。
struct NFIconButton: View {
    private let icon: [String]
    private let label: String
    private let size: CGFloat
    private let iconSize: CGFloat
    private let strokeWidth: CGFloat
    private let color: Color
    private let disabledColor: Color
    private let cornerRadius: CGFloat
    private let action: () -> Void

    init(
        _ icon: [String],
        label: String,
        size: CGFloat = 40,
        iconSize: CGFloat = 20,
        strokeWidth: CGFloat = 2,
        color: Color = Sm.muted,
        disabledColor: Color = Sm.faint,
        cornerRadius: CGFloat = 4.8,
        action: @escaping () -> Void
    ) {
        self.icon = icon
        self.label = label
        self.size = size
        self.iconSize = iconSize
        self.strokeWidth = strokeWidth
        self.color = color
        self.disabledColor = disabledColor
        self.cornerRadius = cornerRadius
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            NFIconButtonLabel(icon: icon, iconSize: iconSize, strokeWidth: strokeWidth, color: color, disabledColor: disabledColor)
                .frame(width: size, height: size)
        }
        .buttonStyle(.pressable(cornerRadius: cornerRadius, scale: 0.97))
        .accessibilityLabel(label)
    }
}

private struct NFIconButtonLabel: View {
    let icon: [String]
    let iconSize: CGFloat
    let strokeWidth: CGFloat
    let color: Color
    let disabledColor: Color
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        LucideIcon(icon, size: iconSize, strokeWidth: strokeWidth, color: isEnabled ? color : disabledColor)
    }
}

// MARK: - 文字按钮（.notion-button）

/// `.notion-button` 的几种样子。
enum NotionButtonKind {
    /// 透明底、正文色的字，按下灰底。对话框的“取消”。
    case plain
    /// `.notion-button-primary`：墨色底白字；不可用时整体 .45。对话框的“保存 / 创建”。
    case primary
    /// 红字 `#b91c1c`（`.notes-delete`）。“删除”“移到回收站”。
    case danger
    /// `.notion-button-quiet`：白底 + 1px 深描边。
    case quiet
}

/// `.notion-button` 的外观：最小高 32、左右 12、圆角 4.8、12.8 / 500，图标和字的间距 6.4；`large` 是回收站里放大的那种（高 44、左右 16、15）。
/// 不可用时：`primary` 整体 .45（网页 `:disabled { opacity: .45 }`），其它的字淡到 .6（网页没有单独的样式，取 Android 的值）。
///
/// ```swift
/// Button(L("cancel")) { close() }.buttonStyle(.notion())
/// Button(L("save")) { save() }.buttonStyle(.notion(.primary)).disabled(name.isEmpty)
/// ```
struct NotionButtonStyle: ButtonStyle {
    var kind: NotionButtonKind = .plain
    var large = false

    func makeBody(configuration: Configuration) -> some View {
        NotionButtonBody(configuration: configuration, kind: kind, large: large)
    }
}

extension ButtonStyle where Self == NotionButtonStyle {
    /// 见 `NotionButtonStyle`。
    static func notion(_ kind: NotionButtonKind = .plain, large: Bool = false) -> NotionButtonStyle {
        NotionButtonStyle(kind: kind, large: large)
    }
}

private struct NotionButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let kind: NotionButtonKind
    let large: Bool
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var foreground: Color {
        switch kind {
        case .primary: return Sm.onInk
        case .danger: return Sm.danger.opacity(isEnabled ? 1 : 0.6)
        case .plain, .quiet: return Sm.text.opacity(isEnabled ? 1 : 0.6)
        }
    }

    private func fill(pressed: Bool) -> Color {
        switch kind {
        case .primary: return pressed ? Sm.inkHover : Sm.ink
        case .quiet: return Sm.surface
        case .plain, .danger: return .clear
        }
    }

    var body: some View {
        let pressed = configuration.isPressed && isEnabled
        let shape = RoundedRectangle(cornerRadius: 4.8)
        configuration.label
            .font(.nf(large ? 15 : 12.8, weight: 500))
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, large ? 16 : 12)
            .frame(minHeight: large ? 44 : 32)
            .background {
                shape.fill(fill(pressed: pressed))
                    // .notion-button:hover 的灰底（primary 是换成 --nf-ink-hover）。
                    .overlay { shape.fill(pressed && kind != .primary ? Sm.hover : .clear) }
                    .overlay { shape.strokeBorder(kind == .quiet ? Sm.borderStrong : .clear, lineWidth: 1) }
            }
            .contentShape(shape)
            .opacity(kind == .primary && !isEnabled ? 0.45 : 1)
            .scaleEffect(pressed && !reduceMotion ? 0.97 : 1)
            .animation(NFMotion.unlessReduced(NFMotion.press, reduceMotion), value: pressed)
    }
}

/// `.notion-button`：文字按钮，可以带图标（前面的 `icon` 或后面的 `trailingIcon`，都是 15）。
///
/// ```swift
/// NotionButton(L("cancel")) { close() }
/// NotionButton(L("save"), kind: .primary) { save() }.disabled(!canSave)
/// NotionButton(L("sb_delete_"), kind: .danger) { delete() }
/// ```
struct NotionButton: View {
    private let title: String
    private let kind: NotionButtonKind
    private let large: Bool
    private let icon: [String]?
    private let trailingIcon: [String]?
    private let action: () -> Void

    init(
        _ title: String,
        kind: NotionButtonKind = .plain,
        large: Bool = false,
        icon: [String]? = nil,
        trailingIcon: [String]? = nil,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.kind = kind
        self.large = large
        self.icon = icon
        self.trailingIcon = trailingIcon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            // .notion-button 的 gap 是 6.4；图标不给颜色，跟着样式里的字色。
            HStack(spacing: 6.4) {
                if let icon { LucideIcon(icon, size: 15) }
                Text(title)
                if let trailingIcon { LucideIcon(trailingIcon, size: 15) }
            }
        }
        .buttonStyle(.notion(kind, large: large))
    }
}

// MARK: - 侧栏的主按钮

/// `.sidebar-primary-action`（手机）：侧栏最上面的“新聊天 / 新笔记”。整行宽、高 44、圆角 8、墨色底、左对齐，
/// 图标 16 + 间距 8 + 16 / 550 白字，左右 11.2，阴影 0 1 2 rgba(12,23,48,.12)；按下缩到 .97，不可用 .6。
///
/// ```swift
/// SidebarPrimaryButton(L("new_chat")) { newChat() }
/// ```
struct SidebarPrimaryButton: View {
    private let title: String
    private let icon: [String]
    private let trailingIcon: [String]?
    private let action: () -> Void

    init(_ title: String, icon: [String] = Lucide.plus, trailingIcon: [String]? = nil, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.trailingIcon = trailingIcon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                LucideIcon(icon, size: 16, color: Sm.onInk)
                Text(title)
                    .font(.nf(15, weight: 560))
                    .foregroundStyle(Sm.onInk)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if let trailingIcon {
                    LucideIcon(trailingIcon, size: 14, color: Sm.onInk.opacity(0.65))
                }
            }
            .padding(.horizontal, 11.2)
            .frame(maxWidth: .infinity)
            .frame(height: 42)
        }
        .buttonStyle(.pressable(background: Sm.ink, pressedBackground: Sm.inkHover, cornerRadius: 9, scale: 0.97, disabledOpacity: 0.6))
        .shadow(color: Sm.primaryShadow, radius: 1, x: 0, y: 1)
    }
}

// MARK: - 设置里的小按钮

/// `.settings-chip`（手机）：设置里的小操作（选表情、上传图片、管理订阅…）。最小高 40、左右 14、全圆角、1px 深描边、白底，
/// 图标 14（灰）+ 间距 6.4 + 14 / 500 的字；按下灰底，不可用 .55。
///
/// ```swift
/// SettingsChip(L("acct_choose_emoji"), icon: Lucide.smile) { pickEmoji() }
/// ```
struct SettingsChip: View {
    private let title: String
    private let icon: [String]?
    private let action: () -> Void

    init(_ title: String, icon: [String]? = nil, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6.4) {
                if let icon { LucideIcon(icon, size: 14, color: Sm.muted) }
                Text(title)
                    .font(.nf(14, weight: 500))
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            .overlay { Capsule().strokeBorder(Sm.borderStrong, lineWidth: 1) }
        }
        // 白底由样式画（按下的灰底叠在它上面）。全圆角：圆角给得比高度的一半大就行。
        .buttonStyle(.pressable(background: Sm.surface, cornerRadius: 999, disabledOpacity: 0.55))
    }
}

// MARK: - 选项行（带 ✓）

/// 可以选中的一行：左边文字，选中的那一行灰底、600 字重、右边 ✓。
/// - `.dialog`：`.notes-dialog-option`，对话框里选项目 / 页面用。最小高 40、圆角 6、左右 9.6、15 的字，✓ 16。
/// - `.sheet`：`.model-sheet-row`，底部抽屉里选模型用。最小高 52、圆角 10.4、左右 13.6、17 的字，✓ 20，按下缩到 .97。
///
/// ```swift
/// NFOptionRow(project.name, isSelected: note.groupId == project.id) { move(to: project) }
/// NFOptionRow(model.label, isSelected: model.id == selected, style: .sheet) { select(model) }
/// ```
/// `highlightsSelection: false` 时选中只打 ✓、不加灰底（聊天的“移到项目”）。`icon` 画在文字前面（16，间距 8）。
struct NFOptionRow: View {
    enum Style {
        case dialog
        case sheet
    }

    private let title: String
    private let isSelected: Bool
    private let style: Style
    private let icon: [String]?
    private let highlightsSelection: Bool
    private let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    init(
        _ title: String,
        isSelected: Bool = false,
        style: Style = .dialog,
        icon: [String]? = nil,
        highlightsSelection: Bool = true,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.isSelected = isSelected
        self.style = style
        self.icon = icon
        self.highlightsSelection = highlightsSelection
        self.action = action
    }

    var body: some View {
        let sheet = style == .sheet
        let emphasized = isSelected && highlightsSelection
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { LucideIcon(icon, size: 16, color: Sm.text) }
                Text(title)
                    .font(.nf(sheet ? 17 : 15, weight: emphasized ? 600 : 400))
                    .foregroundStyle(Sm.text.opacity(isEnabled ? 1 : 0.6))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if isSelected { LucideIcon(Lucide.check, size: sheet ? 20 : 16, color: Sm.text) }
            }
            .padding(.horizontal, sheet ? 13.6 : 9.6)
            .frame(minHeight: sheet ? 52 : 40)
        }
        .buttonStyle(.pressable(
            background: emphasized ? Sm.hover : .clear,
            cornerRadius: sheet ? 10.4 : 6,
            scale: sheet ? 0.97 : 1
        ))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - 开关

/// `.notes-menu-switch`：菜单项右边的小开关。26×14 的全圆角，关是 rgba(55,53,47,.2)、开是蓝色，里面 10 的白点（开时右移 12），120ms。
/// 只管外观，点按由所在的行处理（`ActionsMenuToggle`）。网页写死 `direction: ltr`，从右到左的界面里白点也是往右走。
struct NFSwitch: View {
    private let isOn: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(isOn: Bool) {
        self.isOn = isOn
    }

    var body: some View {
        Capsule()
            .fill(isOn ? Sm.blue : Sm.sheetGrab)
            .frame(width: 26, height: 14)
            .overlay(alignment: .leading) {
                Circle()
                    .fill(Color.white)
                    .frame(width: 10, height: 10)
                    .offset(x: isOn ? 14 : 2)
            }
            .environment(\.layoutDirection, .leftToRight)
            .animation(NFMotion.unlessReduced(NFMotion.cssEase(0.12), reduceMotion), value: isOn)
            .accessibilityHidden(true)
    }
}
