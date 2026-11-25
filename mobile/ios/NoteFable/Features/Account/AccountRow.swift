import SwiftUI

// 侧栏最下面账号的那一块（网页 SidebarFooter 的左半边，Android AccountUi.kt 的 SignInButton / ProfileRow）。
// 右边的"?"帮助菜单（`HelpMenuButton`）由侧栏自己放。

/// 侧栏底部的账号：服务端开了登录才显示。未登录是"登录"按钮（点了打开登录窗口），登录后是账号行（点了打开设置）。
/// 占满给它的宽度，没有内容时也占着（右边的"?"留在行尾）。
struct AccountRow: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    init() {}

    var body: some View {
        let account = app.account.state
        Group {
            if account.configured {
                if let user = account.user {
                    AccountProfileRow(user: user) { router.openSettings() }
                } else {
                    // 网页 SignInButton：只放"登录"，点了打开登录窗口（SignInDialog）。侧栏底部使用柔和卡片样式。
                    SignInButton(subtle: true) { router.openSignIn() }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// "登录"按钮（网页 SignInButton / .signin-open-button 的手机尺寸）：整行、高 44（侧栏底部为 42）、圆角 6（侧栏底部为 9）。
/// `subtle` 为 true 时采用侧栏底部的柔和白卡片样式（1pt 强细框 + CircleUser 图标 + 墨色字），避免与顶部主按钮抢焦点。
/// 侧栏底部和上限提示都只放这一个按钮，点了打开登录窗口（`router.openSignIn()`）。
///
/// ```swift
/// SignInButton(subtle: true) { router.openSignIn() }
/// ```
struct SignInButton: View {
    private let cornerRadius: CGFloat
    private let subtle: Bool
    private let action: () -> Void

    init(cornerRadius: CGFloat? = nil, subtle: Bool = false, action: @escaping () -> Void) {
        self.subtle = subtle
        self.cornerRadius = cornerRadius ?? (subtle ? 9 : 6)
        self.action = action
    }

    var body: some View {
        if subtle {
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

/// 登录后的账号行（.notion-sidebar-action.profile-row，手机）：高 44、左右 8、圆角 4.8、间距 8.8；
/// 头像 22、名字 16、右边齿轮 15（--notion-faint）。点了打开设置：个人资料、界面语言、自定义指令、退出登录都在里面。
private struct AccountProfileRow: View {
    let user: AccountUser
    let action: () -> Void

    var body: some View {
        let name = user.rowName ?? L("account")
        Button(action: action) {
            HStack(spacing: 8.8) {
                UserAvatar(user: user, size: 22)
                Text(name)
                    .font(.nf(16))
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                LucideIcon(Lucide.settings, size: 15, color: Sm.faint)
            }
            .padding(.horizontal, 8)
            .frame(height: 44)
        }
        .buttonStyle(.pressable(cornerRadius: 4.8))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name + " · " + L("acct_settings"))
        .accessibilityAddTraits(.isButton)
    }
}
