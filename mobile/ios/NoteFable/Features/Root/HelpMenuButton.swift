import SwiftUI

/// 侧栏底部的“?”（网页 help-menu.tsx 的 `.sidebar-help-trigger`，Android `HelpMenuButton`）：手机宽度下 44×44、圆角 6.4，
/// 17 的 CircleHelp，--notion-faint 色；打开时底色 --notion-hover、图标 --notion-text。
/// 点了在按钮上方开帮助菜单（`.chat-actions-menu.help-menu`，宽 228，从靠按钮的下角展开）：访问官网、隐私政策、服务条款、特商法标示；
/// 未登录时多一项界面语言（标题下面小字写当前的选择），点了换成语言菜单。登录用户的语言在设置里选。
/// 这些页面在官网的主机（`app.siteUrl`），用系统浏览器打开。
struct HelpMenuButton: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var menuOpen = false
    @State private var languageOpen = false

    init() {}

    var body: some View {
        let open = menuOpen || languageOpen
        Button {
            if languageOpen {
                languageOpen = false
            } else {
                menuOpen.toggle()
            }
        } label: {
            LucideIcon(Lucide.circleHelp, size: 17, color: open ? Sm.text : Sm.faint)
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.pressable(background: open ? Sm.hover : .clear, cornerRadius: 6.4))
        .accessibilityLabel(L("help"))
        .actionsMenu(isPresented: $menuOpen, alignment: .trailing, placement: .above, label: L("help")) {
            HelpMenuContent(
                guest: isGuest,
                languageValue: languageValue,
                onLink: { path in
                    menuOpen = false
                    openSite(path)
                },
                onLanguage: {
                    menuOpen = false
                    languageOpen = true
                }
            )
        }
        .languageMenu(isPresented: $languageOpen)
    }

    /// 语言项下面的小字（和网页一样短）："自动"只写 language_auto（实际的语言就是界面的语言），别的写语言名。
    private var languageValue: String {
        let preference = app.language.preference
        return preference == .auto ? L("language_auto") : languageLabel(preference, showing: app.language.active)
    }

    /// 账号读到之前不放语言项，免得登录用户看到一下（网页 guest）。
    private var isGuest: Bool {
        let account = app.account.state
        return account.loaded && (!account.configured || account.user == nil)
    }

    private func openSite(_ path: String) {
        guard let url = URL(string: app.siteUrl + path) else { return }
        openURL(url)
    }
}

private struct HelpMenuContent: View {
    let guest: Bool
    let languageValue: String
    let onLink: (String) -> Void
    let onLanguage: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 介绍页（/?intro：回访的人也不会被送回工作区）和法律页面。
            ActionsMenuItem(L("visit_website"), icon: Lucide.info, iconColor: Sm.muted) { onLink("/?intro") }
            ActionsMenuItem(L("privacy"), icon: Lucide.shield, iconColor: Sm.muted) { onLink("/privacy") }
            ActionsMenuItem(L("terms"), icon: Lucide.fileText, iconColor: Sm.muted) { onLink("/terms") }
            ActionsMenuItem(L("commercial_disclosure"), icon: Lucide.scale, iconColor: Sm.muted) { onLink("/legal-notice") }
            if guest {
                ActionsMenuDivider()
                HelpLanguageItem(value: languageValue, action: onLanguage)
            }
        }
    }
}

/// 语言那一行：`.chat-menu-item`（最小高 44、内边距 9.6×12、间距 12）；标题 14，当前语言写在标题下面
/// （`.help-menu-label .help-menu-value`：12 灰字、上距 2.4；并排时标题会被挤成一字一行），行尾 ChevronRight 15（从右到左的界面里镜像）。
private struct HelpLanguageItem: View {
    let value: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                LucideIcon(Lucide.languages, size: 16, color: Sm.muted)
                VStack(alignment: .leading, spacing: 2.4) {
                    Text(L("language"))
                        .font(.nf(14))
                        .foregroundStyle(Sm.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(value)
                        .font(.nf(12))
                        .foregroundStyle(Sm.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                LucideIcon(Lucide.chevronRight, size: 15, color: Sm.muted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9.6)
            .frame(minHeight: 44)
        }
        .buttonStyle(.pressable(cornerRadius: 6.4))
        .accessibilityElement(children: .combine)
    }
}
