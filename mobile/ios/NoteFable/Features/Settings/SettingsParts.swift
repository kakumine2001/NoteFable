import SwiftUI
import UIKit

// 设置画面的共用部件（网页 src/components/settings-dialog.css 的手机宽度的值，Android ui/SettingsParts.kt）：
// 入口列表的账号行和各栏的行、卡片、行、说明文字、读取中的一行、"未保存的更改"条。
// 顶栏的关闭 / 返回圆按钮是 DesignSystem 的玻璃圆按钮 `NFGlassIconButton`（SettingsScreen 的 topBar）；小按钮用 `SettingsChip`。
// 卡片是内容，保持不透明的白底；"未保存的更改"条是提醒（会晃、会念出来），也保持不透明的墨色底，不做成玻璃。

/// .settings-saved 的绿色。
let settingsSavedGreen = Color(argb: 0xFF15803D)

extension SettingsPage {
    /// 入口列表里那一行的图标（网页 TABS 的 icon）。
    var icon: [String] {
        switch self {
        case .general: return Lucide.slidersHorizontal
        case .personalization: return Lucide.penLine
        case .plan: return Lucide.creditCard
        case .account: return Lucide.circleUser
        }
    }
}

/// .settings-card.settings-identity：入口列表最上面的账号行，点了进"账号"那一栏。白底、1px 细线、圆角 20、内边距 14×16；
/// 头像 44 + 间距 14 + 名字 17/600 墨色（一行，放不下截断）和它下面间距 2 的邮箱 14 灰（一行；没有邮箱、或名字写的就是邮箱时没有），
/// 行尾 ChevronRight 18 浅灰（从右到左的界面里镜像）。行高都是 1.5（25.5 / 21）。
struct SettingsIdentityCard: View {
    private let user: AccountUser
    private let action: () -> Void
    @Environment(\.nfChromePath) private var chromePath
    @Environment(\.colorScheme) private var colorScheme

    init(user: AccountUser, action: @escaping () -> Void) {
        self.user = user
        self.action = action
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        let showBorder = !(chromePath == .native && colorScheme == .light)
        Button(action: action) {
            HStack(alignment: .center, spacing: 14) {
                UserAvatar(user: user, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(user.rowName ?? L("account"))
                        .font(.nf(17, weight: 600))
                        .nfLineHeight(25.5, fontSize: 17)
                        .foregroundStyle(Sm.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if let email = user.identityEmail {
                        Text(email)
                            .font(.nf(14))
                            .nfLineHeight(21, fontSize: 14)
                            .foregroundStyle(Sm.muted)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                LucideIcon(Lucide.chevronRight, size: 18, color: Sm.faint)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .overlay {
                if showBorder {
                    shape.strokeBorder(Sm.border, lineWidth: 1)
                }
            }
        }
        // 白底由样式画（按下的灰底叠在它上面，网页是悬停的 --notion-hover）。
        .buttonStyle(.pressable(background: Sm.surface, cornerRadius: 24))
    }
}

/// .settings-row.settings-row-button.settings-home-row：入口列表里一栏的行。最小高 56、内边距 10×16，
/// 图标 20（正文色）+ 间距 14 + 名字 16/500，行尾 ChevronRight 18 浅灰（从右到左的界面里镜像）。
/// `divided`（第二行起）在行的上沿画 1px 细线：从行首 50 处（名字的左边，图标下面不画）到行尾，不占高度（网页 ::before）。
struct SettingsHomeRow: View {
    private let label: String
    private let icon: [String]
    private let divided: Bool
    private let action: () -> Void

    init(_ label: String, icon: [String], divided: Bool, action: @escaping () -> Void) {
        self.label = label
        self.icon = icon
        self.divided = divided
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                LucideIcon(icon, size: 20, color: Sm.text)
                Text(label)
                    .font(.nf(16, weight: 500))
                    .foregroundStyle(Sm.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                LucideIcon(Lucide.chevronRight, size: 18, color: Sm.faint)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(minHeight: 56)
        }
        .buttonStyle(.pressable(cornerRadius: 0))
        .overlay(alignment: .top) {
            if divided {
                NFDivider()
                    .padding(.leading, 50)
                    .allowsHitTesting(false)
            }
        }
    }
}

/// .settings-card（手机）：白底、连续 24 圆角（原生浅色省去生硬外框线，深色与降透明保持 1px 细线）；`padded` 时内边距 16。
/// 行与行之间用 `SettingsRowDivider` 隔开。
struct SettingsCard<Content: View>: View {
    private let padded: Bool
    private let content: Content
    @Environment(\.nfChromePath) private var chromePath
    @Environment(\.colorScheme) private var colorScheme

    init(padded: Bool = false, @ViewBuilder content: () -> Content) {
        self.padded = padded
        self.content = content()
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        let showBorder = !(chromePath == .native && colorScheme == .light)
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(padded ? 16 : 0)
        .background(Sm.surface, in: shape)
        .clipShape(shape)
        .overlay {
            if showBorder {
                shape.strokeBorder(Sm.border, lineWidth: 1)
            }
        }
    }
}

/// 卡片里行之间的 1px 线（.settings-card > * + *）。
struct SettingsRowDivider: View {
    var body: some View {
        NFDivider()
    }
}

/// .settings-row.settings-row-button（手机）：整行可点，最小高 56、内边距 10×16、图标 16（灰）+ 间距 12 + 16/500 的字；
/// `danger` 时图标和字都是红色；不可用（`.disabled(true)`）时 0.55。
struct SettingsRowButton: View {
    private let icon: [String]
    private let label: String
    private let danger: Bool
    private let action: () -> Void

    init(_ label: String, icon: [String], danger: Bool = false, action: @escaping () -> Void) {
        self.label = label
        self.icon = icon
        self.danger = danger
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                LucideIcon(icon, size: 16, color: danger ? Sm.danger : Sm.muted)
                Text(label)
                    .font(.nf(16, weight: 500))
                    .foregroundStyle(danger ? Sm.danger : Sm.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(minHeight: 56)
        }
        .buttonStyle(.pressable(cornerRadius: 0, disabledOpacity: 0.55))
    }
}

/// .project-settings-help：13 / 行高 1.5 灰，上距 4。
struct SettingsHelpLine: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.nf(13))
            .nfLineHeight(19.5, fontSize: 13)
            .foregroundStyle(Sm.muted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
    }
}

/// 设置里的错误文：14 / 行高 21、红字 #b91c1c。
struct SettingsErrorLine: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.nf(14))
            .nfLineHeight(21, fontSize: 14)
            .foregroundStyle(Sm.danger)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 读取中的一行：转圈 14 + 间距 4 + "正在加载…"13 灰，上距 9.6。
struct SettingsLoadingLine: View {
    var body: some View {
        HStack(spacing: 4) {
            Spinner(size: 14)
            Text(L("sb_loading"))
                .font(.nf(13))
                .foregroundStyle(Sm.muted)
        }
        .padding(.top, 9.6)
    }
}

/// .settings-unsaved（手机）："未保存的更改"悬浮 Liquid Glass 条，改了自定义指令还没保存时浮在画面下方：
/// 圆角 28 玻璃胶囊条；`attention` 每变一次左右晃一下（360ms）并通知读屏。
struct SettingsUnsavedBar: View {
    let attention: Int
    let busy: Bool
    let onDiscard: () -> Void
    let onSave: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.nfChromePath) private var chromePath

    init(attention: Int, busy: Bool, onDiscard: @escaping () -> Void, onSave: @escaping () -> Void) {
        self.attention = attention
        self.busy = busy
        self.onDiscard = onDiscard
        self.onSave = onSave
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        let labelColor = chromePath == .solid ? Sm.onInk : chromePath.primaryInk
        HStack(spacing: 8) {
            Text(L("settings_unsaved"))
                .font(.nf(14, weight: 550))
                .foregroundStyle(labelColor)
                .frame(maxWidth: .infinity, alignment: .leading)
            SettingsUnsavedButton(label: L("proposal_discard"), filled: false, action: onDiscard)
                .disabled(busy)
            SettingsUnsavedButton(label: L(busy ? "sb_saving" : "save"), filled: true, action: onSave)
                .disabled(busy)
        }
        .padding(.leading, 18)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .frame(minHeight: 54)
        // 吸收条上空白处的点击，防止透传到下方的卡片按钮。
        .background {
            Color.clear
                .contentShape(shape)
                .onTapGesture {}
                .accessibilityHidden(true)
        }
        .clipShape(shape)
        .nfGlassBackground(.regular, in: shape, solidFill: Sm.ink, stroke: Sm.borderStrong)
        .nfChromeShadow(Color(argb: 0x470C1730), radius: 14, y: 8)
        .modifier(SettingsShakeEffect(progress: CGFloat(attention)))
        .animation(reduceMotion || attention == 0 ? nil : .linear(duration: 0.36), value: attention)
        .onChange(of: attention) { _, value in
            if value > 0 { UIAccessibility.post(notification: .announcement, argument: L("settings_unsaved")) }
        }
    }
}

private struct SettingsUnsavedButton: View {
    let label: String
    let filled: Bool
    let action: () -> Void

    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let solid = chromePath == .solid
        let ink: Color = filled
            ? (solid ? Sm.ink : Sm.onInk)
            : (solid ? Sm.onInk.opacity(0.85) : chromePath.secondaryInk)
        let bg: Color = filled
            ? (solid ? Sm.onInk : Sm.ink)
            : (solid ? .clear : (chromePath == .native ? Color.primary.opacity(0.08) : Sm.hover))
        let pressedBg: Color = filled
            ? (solid ? Sm.hover : Sm.inkHover)
            : (solid ? Color(argb: 0x2E7F7F7F) : Sm.active)
        Button(action: action) {
            Text(label)
                .font(.nf(14, weight: 600))
                .foregroundStyle(ink)
                .lineLimit(1)
                .padding(.horizontal, 16)
                .frame(minHeight: 40)
        }
        .buttonStyle(.pressable(
            background: bg,
            pressedBackground: pressedBg,
            cornerRadius: 20,
            scale: 0.97,
            disabledOpacity: 0.6
        ))
    }
}

/// 左右晃一下（网页 settings-unsaved-shake）：360ms 里 0 → −6 → 6 → −6 → 6 → 0。
/// `progress` 每加 1 晃一次：小数部分是这一次晃到哪里了。
struct SettingsShakeEffect: GeometryEffect {
    var progress: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        let fraction = progress - progress.rounded(.down)
        // 五段等长的直线：每 72ms 一个关键帧。
        let stops: [CGFloat] = [0, -6, 6, -6, 6, 0]
        let scaled = fraction * 5
        let index = min(4, max(0, Int(scaled)))
        let local = scaled - CGFloat(index)
        let x = stops[index] + (stops[index + 1] - stops[index]) * local
        return ProjectionTransform(CGAffineTransform(translationX: x, y: 0))
    }
}
