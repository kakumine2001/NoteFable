import SwiftUI

// 语言菜单（网页 language-menu.tsx 的 .chat-actions-menu.language-menu，Android LanguageUi.kt 的 LanguageMenu）：
// 使用原生自适应 `.nfPopover`（紧凑宽度自动适配系统 `.sheet`，宽窗口呈现宽 320 的 `.popover`）。
// 第一行是胶囊搜索框（按原生名 / 代码 / 标签找），下面是"自动" + 17 种语言，自己滚动。
// 选中的语言行有柔和底色与蓝色 ✓；正在显示的语言下面有一行 12 灰字"当前语言"。

extension View {
    /// 贴着这个视图以原生自适应 Liquid Glass Popover / Sheet 弹出语言菜单。
    func languageMenu(isPresented: Binding<Bool>) -> some View {
        modifier(LanguageMenuModifier(isPresented: isPresented))
    }
}

/// 将搜索词保留在系统 `.popover` / `.sheet` 呈现边界之外，窗口跨 compact/regular 缩放或折叠时搜索输入不丢失。
private struct LanguageMenuModifier: ViewModifier {
    @Binding var isPresented: Bool
    @State private var query = ""

    func body(content: Content) -> some View {
        content
            .nfPopover(
                isPresented: $isPresented,
                width: 320,
                arrowEdge: .top,
                adaptCompactToSheet: true,
                contentInsets: EdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10),
                onDismiss: { query = "" }
            ) {
                LanguageMenuContent(isPresented: $isPresented, query: $query)
            }
    }
}

private struct LanguageMenuContent: View {
    @Binding var isPresented: Bool
    @Binding var query: String

    @Environment(AppEnvironment.self) private var app
    @Environment(\.nfChromePath) private var chromePath
    @FocusState private var searching: Bool

    var body: some View {
        let account = app.account.state
        let showing = app.language.active
        // 登录后标的是账号上保存的偏好（读不到时哪一项都不标）；未登录标本机的选择。
        let row = account.user.map { LanguageSettingsRow(user: $0, showing: showing) }
        let checked: AppLanguage.Preference? = account.user == nil ? app.language.preference : row?.checked
        let options = AppLanguage.options(matching: query)

        VStack(alignment: .leading, spacing: 8) {
            searchField
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(options, id: \.self) { option in
                        // Auto 行：「自动检测」下面用小字写「当前：○○」（Android LanguageMenu，不重复「自动检测」）。
                        let auto = option == .auto
                        LanguageOptionRow(
                            name: auto ? L("language_auto") : languageLabel(option, showing: showing),
                            detail: auto ? L("language_auto_now", AppLanguage.nativeName(showing) ?? "") : nil,
                            tag: option.tag ?? showing.tag,
                            effective: option == showing,
                            selected: option == checked
                        ) {
                            choose(option, row: row)
                        }
                    }
                    if options.count == 1, !ApiText.isBlank(query) {
                        Text(L("language_no_results"))
                            .font(.nf(13))
                            .foregroundStyle(Sm.muted)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// 胶囊搜索框：放大镜 + 输入框 + 清除键，在玻璃面板上铺柔和半透明底。
    private var searchField: some View {
        let shape = Capsule()
        let fill = chromePath == .native ? Color.primary.opacity(0.065) : Sm.surface
        let stroke = searching ? Sm.blue : (chromePath == .solid ? Sm.borderStrong : .clear)
        return HStack(spacing: 8) {
            LucideIcon(Lucide.search, size: 15, color: Sm.muted)
                .allowsHitTesting(false)
            TextField("", text: $query, prompt: Text(L("language_search")).foregroundStyle(Sm.muted))
                .textFieldStyle(.plain)
                .font(.nf(15))
                .foregroundStyle(Sm.text)
                .tint(Sm.text)
                .lineLimit(1)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .focused($searching)
            if !query.isEmpty {
                NFIconButton(Lucide.x, label: L("em_clear_search"), size: 28, iconSize: 14, color: Sm.muted, cornerRadius: 14) {
                    query = ""
                }
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .frame(minHeight: 40)
        .background(fill, in: shape)
        .overlay { shape.strokeBorder(stroke, lineWidth: searching ? 2 : 1) }
        .contentShape(shape)
        .onTapGesture { searching = true }
        .padding(2)
        .accessibilityLabel(L("language_search"))
    }

    private func choose(_ option: AppLanguage.Preference, row: LanguageSettingsRow?) {
        isPresented = false
        if let row {
            // 只保存到账号；切换交给语言同步（AppEnvironment 里跟着账号状态走）。
            row.choose(option, app.account)
        } else {
            app.language.chooseOnDevice(option)
        }
    }
}

/// 菜单里的一种语言。语言名按它自己的语言排版（网页 lang=）。
private struct LanguageOptionRow: View {
    let name: String
    /// Auto 行的第二行（language_auto_now）。
    let detail: String?
    let tag: String?
    let effective: Bool
    let selected: Bool
    let action: () -> Void

    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let ink = chromePath == .native ? chromePath.primaryInk : Sm.text
        let selectedBg = chromePath == .native ? Color.primary.opacity(0.08) : Sm.active
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(name)
                        .font(.nf(15, weight: selected ? 600 : 400))
                        .nfLineHeight(21, fontSize: 15)
                        .foregroundStyle(ink)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .environment(\.locale, Locale(identifier: tag ?? "en"))
                    if let detail {
                        Text(detail)
                            .font(.nf(12))
                            .foregroundStyle(Sm.muted)
                    }
                    if effective {
                        Text(L("language_effective"))
                            .font(.nf(12))
                            .foregroundStyle(Sm.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                // 对勾的位置一直留着，各行的文字宽度一样。
                ZStack {
                    if selected { LucideIcon(Lucide.check, size: 15, color: Sm.blue) }
                }
                .frame(width: 15, height: 15)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9.6)
            .frame(minHeight: 44)
        }
        .buttonStyle(.pressable(background: selected ? selectedBg : .clear, cornerRadius: 12))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
