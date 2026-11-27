import SwiftUI

/// 侧栏底部的“?”（系统原生 Liquid Glass 菜单）：访问官网、隐私政策、服务条款、特商法标示；
/// 未登录时多两项：界面语言和内嵌外观子菜单。登录用户的语言和外观在设置里选。
/// 侧栏本身是浮层玻璃时，触发钮用通透胶囊 / 圆底，避免玻璃叠玻璃与嵌套容器闪屏（FORUM 826863）。
struct HelpMenuButton: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(\.openURL) private var openURL
    @Environment(\.nfChromePath) private var chromePath
    @State private var languageOpen = false
    private let glassStyle: Bool

    init(glassStyle: Bool = false) {
        self.glassStyle = glassStyle
    }

    var body: some View {
        Menu {
            Button { openSite("/?intro") } label: {
                NFMenuLabel(title: L("visit_website"), icon: Lucide.info)
            }
            Button { openSite("/privacy") } label: {
                NFMenuLabel(title: L("privacy"), icon: Lucide.shield)
            }
            Button { openSite("/terms") } label: {
                NFMenuLabel(title: L("terms"), icon: Lucide.fileText)
            }
            Button { openSite("/legal-notice") } label: {
                NFMenuLabel(title: L("commercial_disclosure"), icon: Lucide.scale)
            }
            if isGuest {
                Divider()
                Button {
                    Task { @MainActor in languageOpen = true }
                } label: {
                    NFMenuLabel(title: "\(L("language")) · \(languageValue)", icon: Lucide.languages)
                }
                Menu {
                    Picker(L("appearance"), selection: Binding(
                        get: { app.appTheme.preference },
                        set: { option in
                            Haptics.selection()
                            _ = app.appTheme.save(option)
                        }
                    )) {
                        ForEach(ThemePreference.allCases, id: \.self) { option in
                            NFMenuLabel(title: L(option.labelKey), icon: helpThemeIcon(option))
                                .tag(option)
                        }
                    }
                } label: {
                    NFMenuLabel(title: "\(L("appearance")) · \(L(app.appTheme.preference.labelKey))", icon: helpThemeIcon(app.appTheme.preference))
                }
            }
        } label: {
            if glassStyle {
                let fill = chromePath == .native ? Color.primary.opacity(0.075) : Sm.surface
                let ink = chromePath == .native ? chromePath.secondaryInk : Sm.muted
                LucideIcon(Lucide.circleHelp, size: 17, color: ink)
                    .frame(width: 40, height: 40)
                    .background(fill, in: Circle())
                    .overlay {
                        if chromePath == .solid {
                            Circle().strokeBorder(Sm.borderStrong, lineWidth: 1)
                        }
                    }
                    .contentShape(Circle())
            } else {
                LucideIcon(Lucide.circleHelp, size: 17, color: Sm.faint)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
        }
        .accessibilityLabel(L("help"))
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

/// 网页 THEME_OPTIONS 的图标：Monitor / Sun / Moon。
private func helpThemeIcon(_ option: ThemePreference) -> [String] {
    switch option {
    case .system: return Lucide.monitor
    case .light: return Lucide.sun
    case .dark: return Lucide.moon
    }
}
