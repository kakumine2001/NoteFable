import SwiftUI

/// 设置里的"语言"一行（网页 LanguageSettings + .settings-row / .settings-select，手机尺寸；Android LanguageUi.kt 的 LanguageSettings）：
/// 行最小高 56、内边距 10×16，左边"语言"16/500，右边是选择按钮（最宽 200、高 ≥40、左 12 右 10、1px 深描边、圆角 8、白底、
/// 15 字 + 间距 8 + 14 的 ChevronsUpDown 浅灰；打开时蓝边 + 外侧 3px 的浅蓝光圈），写的是标着的语言。
/// 点了在按钮下方打开语言菜单（行尾边和按钮对齐）。标的是保存的偏好（null 选"自动"）；读不到账号的语言时哪一项都不标
/// （按钮上写正在显示的语言）。只保存到账号，切换交给语言同步。内容规则在 Core 的 `LanguageSettingsRow`。
struct LanguageSettingsRowView: View {
    let user: AccountUser?

    @Environment(AppEnvironment.self) private var app
    @Environment(\.nfChromePath) private var chromePath
    @State private var menuOpen = false

    init(user: AccountUser?) {
        self.user = user
    }

    var body: some View {
        let showing = app.language.active
        let row = user.map { LanguageSettingsRow(user: $0, showing: showing) }
        let shown = row?.shown ?? app.language.preference
        let label = languageLabel(shown, showing: showing)
        let fill = chromePath == .solid ? Sm.surface : Sm.hover
        let stroke: Color = menuOpen ? Sm.blue : (chromePath == .solid ? Sm.borderStrong : .clear)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Text(L("language"))
                    .font(.nf(16, weight: 500))
                    .foregroundStyle(Sm.text)
                    .lineLimit(1)
                    .fixedSize()
                Spacer(minLength: 16)
                Button {
                    menuOpen = true
                } label: {
                    HStack(spacing: 8) {
                        Text(label)
                            .font(.nf(15))
                            .foregroundStyle(Sm.text)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                            // 语言名按它自己的语言排版（网页 lang=）。
                            .environment(\.locale, Locale(identifier: shown.tag ?? showing.tag ?? "en"))
                        LucideIcon(Lucide.chevronsUpDown, size: 14, color: Sm.faint)
                    }
                    .padding(.leading, 14)
                    .padding(.trailing, 12)
                    .padding(.vertical, 5.6)
                    .frame(minHeight: 40)
                    .overlay { Capsule().strokeBorder(stroke, lineWidth: 1) }
                }
                .buttonStyle(.pressable(background: fill, pressedBackground: Sm.active, cornerRadius: 999, scale: 0.98))
                .background {
                    if chromePath == .solid {
                        Capsule()
                            .fill(menuOpen ? Sm.focusRing : Color.clear)
                            .padding(-3)
                    }
                }
                .accessibilityLabel(L("language_current", label))
                .languageMenu(isPresented: $menuOpen)
                .frame(maxWidth: 200, alignment: .trailing)
                .layoutPriority(1)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(minHeight: 56)

            // 上一次切换失败（网页 changeError）：红字 + "重试"（再切到上次选择的项）。
            if app.language.changeFailed {
                let retryTarget = user != nil ? row?.saved : (app.language.lastFailedPreference ?? app.language.preference)
                VStack(alignment: .leading, spacing: 0) {
                    SettingsErrorLine(L("language_change_failed"))
                    if let retryTarget {
                        NotionButton(L("try_again")) { app.language.choose(retryTarget) }
                            .padding(.top, 8)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
        }
    }
}
