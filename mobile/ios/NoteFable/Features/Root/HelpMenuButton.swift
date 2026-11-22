import SwiftUI

/// 侧栏底部的“?”（网页 help-menu.tsx 的 `.sidebar-help-trigger`，Android `HelpMenuButton`）：手机宽度下 44×44、圆角 6.4，
/// 17 的 CircleHelp，--notion-faint 色；打开时底色 --notion-hover、图标 --notion-text。
/// 点了在按钮上方开帮助菜单（`.chat-actions-menu.help-menu`，宽 228，从靠按钮的下角展开）：访问官网、隐私政策、服务条款、特商法标示；
/// 未登录时多两项：界面语言和外观（标题下面小字写当前的选择），点了换成语言菜单 / 外观菜单。登录用户的语言和外观在设置里选。
/// 这些页面在官网的主机（`app.siteUrl`），用系统浏览器打开。
struct HelpMenuButton: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var menuOpen = false
    @State private var languageOpen = false
    @State private var themeOpen = false

    init() {}

    var body: some View {
        let open = menuOpen || languageOpen || themeOpen
        Button {
            if languageOpen {
                languageOpen = false
            } else if themeOpen {
                themeOpen = false
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
                theme: app.appTheme.preference,
                onLink: { path in
                    menuOpen = false
                    openSite(path)
                },
                onLanguage: {
                    menuOpen = false
                    languageOpen = true
                },
                onTheme: {
                    menuOpen = false
                    themeOpen = true
                }
            )
        }
        .languageMenu(isPresented: $languageOpen)
        // 外观菜单和帮助菜单同一个外框、同一个位置（网页 help-menu.tsx 的 theme 面板）。
        .actionsMenu(isPresented: $themeOpen, alignment: .trailing, placement: .above, label: L("appearance")) {
            HelpThemeMenuContent(selected: app.appTheme.preference) { option in
                themeOpen = false
                _ = app.appTheme.save(option)
            }
        }
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
    let theme: ThemePreference
    let onLink: (String) -> Void
    let onLanguage: () -> Void
    let onTheme: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 介绍页（/?intro：回访的人也不会被送回工作区）和法律页面。
            ActionsMenuItem(L("visit_website"), icon: Lucide.info, iconColor: Sm.muted) { onLink("/?intro") }
            ActionsMenuItem(L("privacy"), icon: Lucide.shield, iconColor: Sm.muted) { onLink("/privacy") }
            ActionsMenuItem(L("terms"), icon: Lucide.fileText, iconColor: Sm.muted) { onLink("/terms") }
            ActionsMenuItem(L("commercial_disclosure"), icon: Lucide.scale, iconColor: Sm.muted) { onLink("/legal-notice") }
            if guest {
                ActionsMenuDivider()
                HelpValueItem(icon: Lucide.languages, title: L("language"), value: languageValue, action: onLanguage)
                // 外观：图标是现在选的那一项的（Monitor / Sun / Moon），下面小字是它的名字。
                HelpValueItem(icon: helpThemeIcon(theme), title: L("appearance"), value: L(theme.labelKey), action: onTheme)
            }
        }
    }
}

/// 网页 THEME_OPTIONS 的图标：Monitor / Sun / Moon。
private func helpThemeIcon(_ option: ThemePreference) -> [String] {
    switch option {
    case .system: return Lucide.monitor
    case .light: return Lucide.sun
    case .dark: return Lucide.moon
    }
}

/// 语言、外观那两行：`.chat-menu-item`（最小高 44、内边距 9.6×12、间距 12）；标题 14，当前的选择写在标题下面
/// （`.help-menu-label .help-menu-value`：12 灰字、上距 2.4；并排时标题会被挤成一字一行），行尾 ChevronRight 15（从右到左的界面里镜像）。
private struct HelpValueItem: View {
    let icon: [String]
    let title: String
    let value: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                LucideIcon(icon, size: 16, color: Sm.muted)
                VStack(alignment: .leading, spacing: 2.4) {
                    Text(title)
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

/// 外观菜单（网页 help-menu.tsx 的 theme 面板，Android `ThemeMenu`）：跟随系统 / 浅色 / 深色三项，
/// 左边 16 的灰色图标、名字占满中间、选中的行尾 15 的蓝色 ✓；点了保存（只存在这台设备上）并关闭。
private struct HelpThemeMenuContent: View {
    let selected: ThemePreference
    let onChoose: (ThemePreference) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(ThemePreference.allCases, id: \.self) { option in
                Button {
                    onChoose(option)
                } label: {
                    HStack(spacing: 12) {
                        LucideIcon(helpThemeIcon(option), size: 16, color: Sm.muted)
                        Text(L(option.labelKey))
                            .font(.nf(14))
                            .foregroundStyle(Sm.text)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if option == selected {
                            LucideIcon(Lucide.check, size: 15, color: Sm.blue)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9.6)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.pressable(cornerRadius: 6.4))
                .accessibilityAddTraits(option == selected ? .isSelected : [])
            }
        }
    }
}
