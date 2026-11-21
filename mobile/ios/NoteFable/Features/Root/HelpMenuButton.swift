import SwiftUI

/// 侧栏底部的“?”（网页 help-menu.tsx 的 `.sidebar-help-trigger`，Android `HelpMenuButton`）：手机宽度下 44×44、圆角 6.4，
/// 17 的 CircleHelp，--notion-faint 色；打开时底色 --notion-hover、图标 --notion-text。
/// 点了在按钮上方开帮助菜单（`.chat-actions-menu.help-menu`，宽 228，从靠按钮的下角展开）：访问官网、隐私政策、服务条款、特商法标示；
/// 未登录时多一项界面语言（行尾是当前语言），点了换成语言菜单。登录用户的语言在设置里选。
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
                languageValue: languageLabel(app.language.preference, showing: app.language.active),
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

/// 语言那一行：`.chat-menu-item`（最小高 44、内边距 9.6×12、间距 12、14 的字）+ 行尾的当前语言（13 灰字，最多占 65% 宽）
/// 和 ChevronRight 15（从右到左的界面里镜像）。
private struct HelpLanguageItem: View {
    let value: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                LucideIcon(Lucide.languages, size: 16, color: Sm.muted)
                Text(L("language"))
                    .font(.nf(14))
                    .nfLineHeight(21, fontSize: 14)
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    // 标题保持自己的宽度，当前语言用剩下的宽度、放不下就折行（网页 flex: 1 + max-width: 65%）。
                    .fixedSize()
                Text(value)
                    .font(.nf(13))
                    .foregroundStyle(Sm.muted)
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                LucideIcon(Lucide.chevronRight, size: 15, color: Sm.muted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9.6)
            .frame(minHeight: 44)
        }
        .buttonStyle(.pressable(cornerRadius: 6.4))
    }
}
