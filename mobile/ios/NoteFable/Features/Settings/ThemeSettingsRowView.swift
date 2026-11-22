import SwiftUI

/// 设置 → 通用里的"外观"一行（网页 ThemeSettings + settings-dialog.css 的 .settings-theme-row / .settings-theme-group，手机尺寸；
/// Android 的 ThemeSettings）：行最小高 56、内边距 10×16，左边"外观"16/500，右边是三选一的分段（跟随系统 / 浅色 / 深色）。
/// 一行放不下时分段换到标题下面（网页 flex-wrap，行距 10、列距 16）。
/// 分段：内边距 2、间距 2、圆角 8、1px 细线（--notion-border）、灰底（--notion-sidebar）；每项最小高 32、左右 10.4、圆角 6、
/// 图标 14 + 间距 5.6 + 13/500 灰字；选中的是 --notion-surface 底、墨色字、0 1px 2px rgba(0,0,0,.08) 的阴影加 1px 细环。
/// 选了就存，只存在这台设备上（`app.appTheme`），不随账号同步；整个 App（含打开着的网页编辑器）马上跟着换。
struct ThemeSettingsRowView: View {
    @Environment(AppEnvironment.self) private var app

    init() {}

    var body: some View {
        let selected = app.appTheme.preference
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 16) {
                title
                Spacer(minLength: 0)
                group(selected)
            }
            VStack(alignment: .leading, spacing: 10) {
                title
                group(selected)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(minHeight: 56)
    }

    private var title: some View {
        Text(L("appearance"))
            .font(.nf(16, weight: 500))
            .foregroundStyle(Sm.text)
            .lineLimit(1)
            .fixedSize()
    }

    private func group(_ selected: ThemePreference) -> some View {
        let shape = RoundedRectangle(cornerRadius: 8)
        let store = app.appTheme
        return HStack(spacing: 2) {
            ForEach(ThemePreference.allCases, id: \.self) { option in
                ThemeOptionButton(option: option, selected: option == selected) {
                    _ = store.save(option)
                }
            }
        }
        // 内边距 2 + 1px 的边（网页的 border 在内边距外面）。
        .padding(3)
        .background(Sm.sidebar, in: shape)
        .overlay { shape.strokeBorder(Sm.border, lineWidth: 1) }
        .fixedSize()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("appearance"))
    }
}

/// 分段里的一项（网页 .settings-theme-option，role="radio"）。
private struct ThemeOptionButton: View {
    let option: ThemePreference
    let selected: Bool
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 网页 THEME_OPTIONS 的图标：Monitor / Sun / Moon。
    private var icon: [String] {
        switch option {
        case .system: return Lucide.monitor
        case .light: return Lucide.sun
        case .dark: return Lucide.moon
        }
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6)
        let ink = selected ? Sm.ink : Sm.muted
        Button(action: action) {
            HStack(spacing: 5.6) {
                LucideIcon(icon, size: 14, color: ink)
                Text(L(option.labelKey))
                    .font(.nf(13, weight: 500))
                    .foregroundStyle(ink)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10.4)
            .frame(minHeight: 32)
            .background {
                if selected {
                    // box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 0 0 1px var(--notion-border)。
                    shape
                        .fill(Sm.surface)
                        .shadow(color: Color(argb: 0x14000000), radius: 1, x: 0, y: 1)
                        .overlay {
                            RoundedRectangle(cornerRadius: 6.5)
                                .stroke(Sm.border, lineWidth: 1)
                                .padding(-0.5)
                        }
                }
            }
        }
        .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 6, scale: 0.97))
        // transition: background-color 120ms ease, color 120ms ease。
        .animation(NFMotion.unlessReduced(NFMotion.cssEase(0.12), reduceMotion), value: selected)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
