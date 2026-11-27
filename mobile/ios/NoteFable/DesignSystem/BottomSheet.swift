import SwiftUI

// 底部抽屉里的通用部件（ModelSheet / AttachSheet 已迁到系统的 .nfSheet）和全屏面板（设置、登录、项目设置、添加页面、表情弹出框）。

// MARK: - 抽屉里的部件

/// 小标题（`.model-sheet-title`）：13 / 600 灰字，外边距 12 / 4 / 5.6。“模型”“推理强度”。
struct SheetSectionTitle: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.nf(13, weight: 600))
            .foregroundStyle(Sm.muted)
            .padding(.horizontal, 4)
            .padding(.top, 12)
            .padding(.bottom, 5.6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// 一行操作（`.attach-row`）：“＋”抽屉里的“添加文件或照片 / 添加页面 / 生成图片”。
/// 最小高 60、圆角 11.2、内边距 6.4×13.6、图标 22 + 间距 14.4；标题 17 / 600，说明 14 灰；按下缩到 .97。
/// `isOn` 时整行灰底、行尾 ✓ 20（已打开「生成图片」）。
struct SheetActionRow: View {
    private let title: String
    private let detail: String?
    private let icon: [String]
    private let isOn: Bool
    private let action: () -> Void

    @Environment(\.nfChromePath) private var chromePath

    init(_ title: String, detail: String? = nil, icon: [String], isOn: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.detail = detail
        self.icon = icon
        self.isOn = isOn
        self.action = action
    }

    var body: some View {
        let activeBg = chromePath == .native ? Color.primary.opacity(0.08) : Sm.hover
        Button(action: action) {
            HStack(spacing: 14.4) {
                LucideIcon(icon, size: 22, color: Sm.text)
                VStack(alignment: .leading, spacing: 0) {
                    Text(title)
                        .font(.nf(17, weight: 600))
                        .nfLineHeight(25.5, fontSize: 17)
                        .foregroundStyle(Sm.text)
                    if let detail {
                        Text(detail)
                            .font(.nf(14))
                            .nfLineHeight(21, fontSize: 14)
                            .foregroundStyle(Sm.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if isOn { LucideIcon(Lucide.check, size: 20, color: Sm.blue) }
            }
            .padding(.horizontal, 13.6)
            .padding(.vertical, 6.4)
            .frame(minHeight: 60)
        }
        .buttonStyle(.pressable(background: isOn ? activeBg : .clear, cornerRadius: 14, scale: 0.97))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// 抽屉最下面的“完成”（`.model-sheet-done`）：整宽、最小高 50、全圆角胶囊、`--nf-ink` 底白字 16 / 600，上距 16。
struct SheetDoneButton: View {
    private let title: String
    private let action: () -> Void

    init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.nf(16, weight: 600))
                .foregroundStyle(Sm.onInk)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 50)
        }
        .buttonStyle(.pressable(background: Sm.ink, pressedBackground: Sm.inkHover, cornerRadius: 25, scale: 0.97))
        .padding(.top, 16)
    }
}

// MARK: - 全屏面板

/// 全屏面板的进场。
struct NFPanelStyle {
    /// 面板的底色（铺满整个屏幕，包括安全区）。
    var background: Color = Sm.surface
    /// 从下方多远处淡入上移。
    var rise: CGFloat = 32
    var animation: Animation = NFMotion.cssEaseOut(0.2)

    /// 搜索 / 通用全屏：页面底 `--notion-bg`，从下方 32。
    static let search = NFPanelStyle(background: Sm.background)

    /// 设置（`dialog.settings-dialog` 手机宽度）：灰底 `--notion-sidebar`，`settings-slide` 220ms，从下方 16。
    static let settings = NFPanelStyle(background: Sm.sidebar, rise: 16, animation: NFMotion.emphasized(0.22))
}

extension View {
    /// 盖住整个屏幕的面板（设置、登录、项目设置等）：内容排在安全区里，底色铺满；有键盘时内容让到键盘上面。
    func nfPanel<PanelContent: View>(
        isPresented: Binding<Bool>,
        style: NFPanelStyle = .search,
        @ViewBuilder content: @escaping () -> PanelContent
    ) -> some View {
        modifier(NFOverlayPresenter(
            isPresented: isPresented.wrappedValue,
            key: nil,
            kind: .panel(style),
            dismissDisabled: false,
            overlayContent: { AnyView(content()) },
            dismiss: { isPresented.wrappedValue = false }
        ))
    }
}

struct NFPanelLayer: View {
    let item: NFOverlayItem
    let style: NFPanelStyle
    let metrics: NFOverlayMetrics
    let zBase: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        item.content()
            .nfOverlayContentDefaults()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.bottom, metrics.keyboardInset)
            .background {
                // 不透明的底：盖住下面的画面，触摸也不会穿过去。
                style.background
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
            }
            // 面板里再打开的对话框 / 菜单画在这一层上面。
            .nfOverlayHost()
            .zIndex(zBase)
            .transition(panelTransition)
            .accessibilityAddTraits(.isModal)
    }

    private var panelTransition: AnyTransition {
        if reduceMotion { return .identity }
        return .asymmetric(
            insertion: AnyTransition.nfRise(offsetY: style.rise).animation(style.animation),
            removal: AnyTransition.nfRise(offsetY: style.rise).animation(NFMotion.cssEaseOut(0.16))
        )
    }
}
