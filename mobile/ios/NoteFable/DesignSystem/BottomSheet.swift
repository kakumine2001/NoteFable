import SwiftUI

// 底部抽屉（网页 `.model-sheet`：模型 / 强度、“＋”，Android `ModalBottomSheet`）和全屏面板（搜索、设置）。
//
// 抽屉：整宽、贴底，顶部圆角 17.6，白底，阴影 0 −8 24 rgba(15,15,15,.2)；内边距 8 / 16 / 16 + 底部安全区；
// 最高 88% 屏高，再高在里面滚动。顶上是把手（40×4、rgba(55,53,47,.2)，把手条 `.sheet-grip` 上 7.2 下 6.4）。
// 遮罩 rgba(15,15,15,.35)，150ms 淡入，点了关闭。
// 进场 `model-sheet-up`：从下方 32 处淡入上移。globals.css 写的是 200ms ease-out，motion.css 用更高的优先级
// 改成了 260ms（--dur-base）、cubic-bezier(.23,1,.32,1)（--ease-out），以后者为准。
// 把手可以往下拖（`use-swipe-dismiss.ts`）：超过自身高度的 33%，或者松手时够快（> 0.5 px/ms 且拖过 24）就关，
// 200ms 滑出去；否则 340ms 带一点回弹地回到原位。“减弱动态效果”时都不做动画。
// 用按钮关（“完成”）时网页是直接消失，这里和 Android 一样滑下去（200ms）。

// MARK: - 抽屉

struct BottomSheetStyle {
    /// 顶部两个角的圆角。
    var cornerRadius: CGFloat = 17.6
    /// 顶上的把手；有把手才能下拉关闭。
    var showsGrabber = true
    /// 内容四周的留白（底部另外加安全区）。
    var contentInsets = EdgeInsets(top: 0, leading: 16, bottom: 16, trailing: 16)
    /// 最高占屏高的比例（`max-height: 88dvh`）。
    var maxHeightFraction: CGFloat = 0.88

    /// `.model-sheet`：模型抽屉、“＋”抽屉。
    static let standard = BottomSheetStyle()

    /// 自己排版的全宽面板：没有把手、内容不留白。回收站（顶部圆角 16）用它。
    static func plain(cornerRadius: CGFloat = 16, maxHeightFraction: CGFloat = 0.88) -> BottomSheetStyle {
        BottomSheetStyle(
            cornerRadius: cornerRadius, showsGrabber: false,
            contentInsets: EdgeInsets(), maxHeightFraction: maxHeightFraction
        )
    }
}

extension View {
    /// 从底部出来的抽屉。内容是一列（左对齐、间距 0），高度跟内容；可以用 `SheetSectionTitle`、`NFOptionRow(style: .sheet)`、
    /// `SheetActionRow`、`SheetDoneButton` 搭。点遮罩或下拉把手关闭；`dismissDisabled` 为 true 时都不关。
    /// 需要根上装了 `.nfOverlayHost()`。
    ///
    /// ```swift
    /// .nfBottomSheet(isPresented: $choosingModel) {
    ///     SheetSectionTitle(L("model"))
    ///     ForEach(models) { model in
    ///         NFOptionRow(model.label, isSelected: model.id == selectedId, style: .sheet) { select(model) }
    ///     }
    ///     SheetDoneButton(L("done")) { choosingModel = false }
    /// }
    /// ```
    func nfBottomSheet<SheetContent: View>(
        isPresented: Binding<Bool>,
        style: BottomSheetStyle = .standard,
        dismissDisabled: Bool = false,
        @ViewBuilder content: @escaping () -> SheetContent
    ) -> some View {
        modifier(NFOverlayPresenter(
            isPresented: isPresented.wrappedValue,
            key: nil,
            kind: .sheet(style),
            dismissDisabled: dismissDisabled,
            overlayContent: { AnyView(content()) },
            dismiss: { isPresented.wrappedValue = false }
        ))
    }

    /// 同上，按一个可选的值显示：有值时显示，关闭时把它设回 nil。
    func nfBottomSheet<Item: Identifiable, SheetContent: View>(
        item: Binding<Item?>,
        style: BottomSheetStyle = .standard,
        dismissDisabled: Bool = false,
        @ViewBuilder content: @escaping (Item) -> SheetContent
    ) -> some View {
        let current = item.wrappedValue
        return modifier(NFOverlayPresenter(
            isPresented: current != nil,
            key: current.map { AnyHashable($0.id) },
            kind: .sheet(style),
            dismissDisabled: dismissDisabled,
            overlayContent: { current.map { AnyView(content($0)) } ?? AnyView(EmptyView()) },
            dismiss: { item.wrappedValue = nil }
        ))
    }
}

struct BottomSheetLayer: View {
    let item: NFOverlayItem
    let style: BottomSheetStyle
    let metrics: NFOverlayMetrics
    let zBase: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 把手往下拖了多少。
    @State private var dragOffset: CGFloat = 0
    @State private var panelHeight: CGFloat = 0
    /// 下拉松手后正在滑出去。
    @State private var closing = false

    /// 下拉的进度（0…1）：遮罩跟着变淡（网页 `--swipe-progress`）。
    private var progress: CGFloat {
        panelHeight > 0 ? min(1, dragOffset / panelHeight) : 0
    }

    var body: some View {
        Sm.sheetScrim
            .opacity(1 - progress)
            .contentShape(Rectangle())
            .onTapGesture {
                if !item.dismissDisabled, !closing { item.dismiss() }
            }
            .ignoresSafeArea()
            .accessibilityHidden(true)
            .zIndex(zBase)
            .transition(scrimTransition)

        VStack(spacing: 0) {
            Spacer(minLength: 0)
            panel
        }
        // 有键盘时整块抬到键盘上面。
        .padding(.bottom, metrics.keyboardInset)
        .offset(y: dragOffset)
        // 抽屉里再打开的对话框 / 菜单画在这一层上面。
        .nfOverlayHost()
        .zIndex(zBase + 0.5)
        .transition(panelTransition)
    }

    private var scrimTransition: AnyTransition {
        if reduceMotion { return .identity }
        return AnyTransition.opacity.animation(NFMotion.cssEaseOut(0.15))
    }

    private var panelTransition: AnyTransition {
        if reduceMotion { return .identity }
        return .asymmetric(
            insertion: AnyTransition.nfRise(offsetY: 32).animation(NFMotion.easeOut(NFMotion.base)),
            removal: AnyTransition.move(edge: .bottom).combined(with: .opacity).animation(NFMotion.easeOut(0.2))
        )
    }

    private var panel: some View {
        // 把手条：面板上内边距 8 + 把手上 7.2 + 4 + 下 6.4。
        let chrome: CGFloat = style.showsGrabber ? 25.6 : 0
        let maxPanel = min(metrics.size.height * style.maxHeightFraction, metrics.availableHeight)
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: style.cornerRadius, bottomLeadingRadius: 0,
            bottomTrailingRadius: 0, topTrailingRadius: style.cornerRadius, style: .circular
        )
        return VStack(spacing: 0) {
            if style.showsGrabber { grabber }
            FittingScrollView(maxHeight: max(88, maxPanel - chrome)) {
                VStack(alignment: .leading, spacing: 0) {
                    item.content()
                }
                .nfOverlayContentDefaults()
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(style.contentInsets)
            }
        }
        .frame(maxWidth: .infinity)
        .clipShape(shape)
        .background {
            // 白底一直铺到屏幕底（底部安全区也是白的）。
            shape
                .fill(Sm.surface)
                .shadow(color: Sm.sheetShadow, radius: 12, x: 0, y: -8)
                .ignoresSafeArea(edges: .bottom)
        }
        .nfOnSizeChange { size in
            if panelHeight != size.height { panelHeight = size.height }
        }
        .accessibilityAddTraits(.isModal)
    }

    private var grabber: some View {
        Capsule()
            .fill(Sm.sheetGrab)
            .frame(width: 40, height: 4)
            .padding(.top, 15.2)
            .padding(.bottom, 6.4)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .gesture(dragGesture)
            .accessibilityHidden(true)
    }

    private var dragGesture: some Gesture {
        // 用屏幕坐标量位移：面板跟着手指动，用它自己的坐标会抖。
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
                guard !item.dismissDisabled, !closing else { return }
                dragOffset = max(0, value.translation.height)
            }
            .onEnded { value in
                guard !item.dismissDisabled, !closing else { return }
                let offset = max(0, value.translation.height)
                // 网页的阈值：超过高度的 33%，或速度 > 0.5 px/ms（500 pt/s）且拖过 24。
                let flicked = value.velocity.height > 500 && offset > 24
                if offset > panelHeight * 0.33 || flicked {
                    slideAway()
                } else {
                    withAnimation(NFMotion.unlessReduced(NFMotion.spring(0.34), reduceMotion)) { dragOffset = 0 }
                }
            }
    }

    /// 松手后滑到屏幕外再关（网页：200ms 的 transform，190ms 后卸载）。
    private func slideAway() {
        if reduceMotion {
            item.dismiss()
            return
        }
        closing = true
        withAnimation(NFMotion.easeOut(0.2)) { dragOffset = panelHeight + 64 }
        let dismiss = item.dismiss
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.19) { dismiss() }
    }
}

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
///
/// ```swift
/// SheetActionRow(L("attach_files"), icon: Lucide.paperclip) { pickFiles() }
/// SheetActionRow(L("create_image"), detail: L("create_image_desc"), icon: Lucide.imagePlus, isOn: imageMode) { toggle() }
/// ```
struct SheetActionRow: View {
    private let title: String
    private let detail: String?
    private let icon: [String]
    private let isOn: Bool
    private let action: () -> Void

    init(_ title: String, detail: String? = nil, icon: [String], isOn: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.detail = detail
        self.icon = icon
        self.isOn = isOn
        self.action = action
    }

    var body: some View {
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
                if isOn { LucideIcon(Lucide.check, size: 20, color: Sm.text) }
            }
            .padding(.horizontal, 13.6)
            .padding(.vertical, 6.4)
            .frame(minHeight: 60)
        }
        .buttonStyle(.pressable(background: isOn ? Sm.hover : .clear, cornerRadius: 11.2, scale: 0.97))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// 抽屉最下面的“完成”（`.model-sheet-done`）：整宽、最小高 48、圆角 12、`--notion-text` 底白字 16 / 600，上距 16。
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
                // .model-sheet-done：--notion-text 底上的字，深色时是 --nf-on-ink。
                .foregroundStyle(Sm.onInk)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 48)
        }
        .buttonStyle(.pressable(background: Sm.text, pressedBackground: nil, cornerRadius: 12, scale: 0.97))
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

    /// 搜索（网页手机宽度的 `.search-panel`）：白底，`model-sheet-up` 200ms ease-out，从下方 32。
    static let search = NFPanelStyle()

    /// 设置（`dialog.settings-dialog` 手机宽度）：灰底 `--notion-sidebar`，`settings-slide` 220ms cubic-bezier(.2,.8,.2,1)，从下方 16。
    static let settings = NFPanelStyle(background: Sm.sidebar, rise: 16, animation: NFMotion.emphasized(0.22))
}

extension View {
    /// 盖住整个屏幕的面板（搜索、设置）：内容排在安全区里，底色铺满；有键盘时内容让到键盘上面。
    /// 没有遮罩，关闭由内容里的返回 / 关闭键负责（`@Environment(\.nfDismiss)` 或直接改绑定）。需要根上装了 `.nfOverlayHost()`。
    ///
    /// ```swift
    /// .nfPanel(isPresented: $searching, style: .search) {
    ///     SearchScreen(onClose: { searching = false })
    /// }
    /// ```
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
            // 面板里再打开的对话框 / 菜单 / 抽屉画在这一层上面。
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
