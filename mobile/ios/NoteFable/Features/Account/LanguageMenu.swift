import SwiftUI

// 语言菜单（网页 language-menu.tsx 的 .chat-actions-menu.language-menu，Android LanguageUi.kt 的 LanguageMenu）：
// 宽 min(320, 屏宽 − 16)、最高 min(368, 屏高 − 16)，内边距 5.6、圆角 12、1px 细线、白底、阴影（`.actionsMenu` 的卡片）。
// 开在按钮下方，放不下就上方（间距 4），行尾边和按钮对齐，离边至少 8。
// 第一行是搜索框（按原生名 / 代码 / 标签找），下面是"自动" + 17 种语言，自己滚动。
// 项是 .chat-menu-item（最小高 44、内边距 9.6×12、圆角 6.4、14 字）：打对勾的是保存的偏好（行尾 15 的蓝色 ✓、深一点的灰底），
// 正在显示的语言下面有一行 12 灰字"当前语言"。

extension View {
    /// 贴着这个视图弹出语言菜单。未登录时只改本机（`app.language.chooseOnDevice`，帮助菜单里用）；
    /// 登录后存到账号（`LanguageSettingsRow.choose`，设置里用），界面跟着账号上的语言切换。选了就关。
    /// 需要根上装了 `.nfOverlayHost()`。
    ///
    /// ```swift
    /// Button { open = true } label: { … }
    ///     .languageMenu(isPresented: $open)
    /// ```
    func languageMenu(isPresented: Binding<Bool>) -> some View {
        // iOS 17 的 iPhone 最窄 375，min(320, 屏宽 − 16) 总是 320。
        actionsMenu(isPresented: isPresented, width: 320, alignment: .trailing, placement: .below, label: L("language")) {
            LanguageMenuContent(isPresented: isPresented)
        }
    }
}

private struct LanguageMenuContent: View {
    @Binding var isPresented: Bool

    @Environment(AppEnvironment.self) private var app
    @State private var query = ""
    @FocusState private var searching: Bool

    /// 菜单最高 368：去掉上下内边距 11.2 和搜索框那一行（44）剩下的给列表。
    private static let listMaxHeight: CGFloat = 368 - 11.2 - 44

    var body: some View {
        let account = app.account.state
        let showing = app.language.active
        // 登录后标的是账号上保存的偏好（读不到时哪一项都不标）；未登录标本机的选择。
        let row = account.user.map { LanguageSettingsRow(user: $0, showing: showing) }
        let checked: AppLanguage.Preference? = account.user == nil ? app.language.preference : row?.checked
        let options = AppLanguage.options(matching: query)

        VStack(alignment: .leading, spacing: 0) {
            searchField
            FittingScrollView(maxHeight: Self.listMaxHeight) {
                VStack(alignment: .leading, spacing: 0) {
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
        }
    }

    /// 搜索框：四周留 4，1px 细线、圆角 6.4、内边距 8、14 的字。
    private var searchField: some View {
        let shape = RoundedRectangle(cornerRadius: 6.4)
        return TextField("", text: $query, prompt: Text(L("language_search")).foregroundStyle(Sm.muted))
            .textFieldStyle(.plain)
            .font(.nf(14))
            .foregroundStyle(Sm.text)
            .tint(Sm.text)
            .lineLimit(1)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .submitLabel(.search)
            .focused($searching)
            .padding(8)
            .frame(minHeight: 36)
            // 菜单是玻璃的：输入框自己铺白底，不然看着像个透明的洞（网页是白底菜单上的白底框）。
            .background(Sm.surface, in: shape)
            .overlay { shape.strokeBorder(Sm.border, lineWidth: 1) }
            .contentShape(shape)
            .onTapGesture { searching = true }
            .padding(4)
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

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(name)
                        .font(.nf(14))
                        .nfLineHeight(21, fontSize: 14)
                        .foregroundStyle(Sm.text)
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
        .buttonStyle(.pressable(background: selected ? Sm.active : .clear, cornerRadius: 6.4))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
