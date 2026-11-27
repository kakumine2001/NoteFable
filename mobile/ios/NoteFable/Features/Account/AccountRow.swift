import SwiftUI

// 侧栏最下面账号的那一块（网页 SidebarFooter 的左半边，Android AccountUi.kt 的 SignInButton / ProfileRow）。
// 右边的"?"帮助菜单（`HelpMenuButton`）由侧栏自己放。

/// 侧栏底部的账号：服务端开了登录才显示。未登录是"登录"按钮（点了打开登录窗口），登录后是账号行（点了打开设置）。
/// 占满给它的宽度，没有内容时也占着（右边的"?"留在行尾）。
struct AccountRow: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    private let glassStyle: Bool

    init(glassStyle: Bool = false) {
        self.glassStyle = glassStyle
    }

    var body: some View {
        let account = app.account.state
        Group {
            if account.configured {
                if let user = account.user {
                    AccountProfileRow(user: user, glassStyle: glassStyle) { router.openSettings() }
                } else {
                    // 网页 SignInButton：只放"登录"，点了打开登录窗口（SignInDialog）。
                    SignInButton(subtle: true, glassStyle: glassStyle) { router.openSignIn() }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// "登录"按钮（网页 SignInButton / .signin-open-button 的手机尺寸）。
struct SignInButton: View {
    private let cornerRadius: CGFloat
    private let subtle: Bool
    private let glassStyle: Bool
    private let action: () -> Void
    @Environment(\.nfChromePath) private var chromePath

    init(cornerRadius: CGFloat? = nil, subtle: Bool = false, glassStyle: Bool = false, action: @escaping () -> Void) {
        self.subtle = subtle
        self.glassStyle = glassStyle
        self.cornerRadius = cornerRadius ?? (subtle ? 9 : 6)
        self.action = action
    }

    var body: some View {
        if glassStyle {
            let fill = chromePath == .native ? Color.primary.opacity(0.075) : Sm.surface
            let ink = chromePath == .native ? chromePath.primaryInk : Sm.ink
            let iconInk = chromePath == .native ? chromePath.secondaryInk : Sm.muted
            Button(action: action) {
                HStack(spacing: 7) {
                    LucideIcon(Lucide.circleUser, size: 16, color: iconInk)
                    Text(L("sign_in"))
                        .font(.nf(15, weight: 600))
                        .foregroundStyle(ink)
                        .lineLimit(1)
                }
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .overlay {
                    if chromePath == .solid {
                        Capsule().strokeBorder(Sm.borderStrong, lineWidth: 1)
                    }
                }
            }
            .buttonStyle(.pressable(
                background: fill,
                pressedBackground: Sm.hover,
                cornerRadius: 20,
                scale: 0.97
            ))
        } else if subtle {
            let shape = RoundedRectangle(cornerRadius: cornerRadius)
            Button(action: action) {
                HStack(spacing: 7) {
                    LucideIcon(Lucide.circleUser, size: 16, color: Sm.muted)
                    Text(L("sign_in"))
                        .font(.nf(15, weight: 600))
                        .foregroundStyle(Sm.ink)
                        .lineLimit(1)
                }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
            }
            .buttonStyle(.pressable(background: Sm.surface, pressedBackground: Sm.hover, cornerRadius: cornerRadius, scale: 0.98))
            .overlay { shape.strokeBorder(Sm.borderStrong, lineWidth: 1).allowsHitTesting(false) }
            .shadow(color: Color(light: 0x0D0F172A, dark: 0x40000000), radius: 1.5, x: 0, y: 1)
        } else {
            Button(action: action) {
                Text(L("sign_in"))
                    .font(.nf(15, weight: 600))
                    .foregroundStyle(Sm.onInk)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
            }
            .buttonStyle(.pressable(background: Sm.ink, pressedBackground: Sm.inkHover, cornerRadius: cornerRadius, scale: 0.97))
        }
    }
}

/// 登录后的账号行（.notion-sidebar-action.profile-row，手机）：头像 22、名字、设置图标。
private struct AccountProfileRow: View {
    let user: AccountUser
    let glassStyle: Bool
    let action: () -> Void
    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let name = user.rowName ?? L("account")
        let ink = (glassStyle && chromePath == .native) ? chromePath.primaryInk : Sm.text
        let gearInk = (glassStyle && chromePath == .native) ? chromePath.secondaryInk : Sm.faint
        let fill: Color = glassStyle ? (chromePath == .native ? Color.primary.opacity(0.075) : Sm.surface) : .clear
        Button(action: action) {
            HStack(spacing: 8.8) {
                UserAvatar(user: user, size: 22)
                Text(name)
                    .font(.nf(15, weight: glassStyle ? 550 : 400))
                    .foregroundStyle(ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                LucideIcon(Lucide.settings, size: 15, color: gearInk)
            }
            .padding(.horizontal, glassStyle ? 12 : 8)
            .frame(height: glassStyle ? 40 : 44)
            .overlay {
                if glassStyle && chromePath == .solid {
                    Capsule().strokeBorder(Sm.borderStrong, lineWidth: 1)
                }
            }
        }
        .buttonStyle(.pressable(
            background: fill,
            pressedBackground: Sm.hover,
            cornerRadius: glassStyle ? 20 : 4.8,
            scale: glassStyle ? 0.97 : 1
        ))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name + " · " + L("acct_settings"))
        .accessibilityAddTraits(.isButton)
    }
}
