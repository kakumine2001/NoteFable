import SwiftUI

// 对话框（网页 `.notes-dialog`，Android `NotesDialog`）：屏幕正中的白色卡片。
// 宽 min(100% − 48, 400)、内边距 24、圆角 8、--notion-shadow；遮罩 rgba(15,15,15,.2)。内容比屏幕高时整个卡片里面滚动
// （网页 <dialog> 的 max-height 是视口 − 38）。有键盘时卡片在键盘上方的区域里居中。
// 网页的 <dialog> 没有进场动画（只有回收站 / 历史那个是 120ms 淡入），这里取同一套数值里最接近的：
// 遮罩 120ms 淡入，卡片照 `motion-menu-enter`（上移 4、缩放 .98 → 1，160ms ease-out）；“减弱动态效果”时直接出现。

// MARK: - 显示

extension View {
    /// 显示一个对话框。内容是一列（左对齐、间距 0），用下面的 `NFDialogTitle`、`NFDialogDescription`、`NFDialogTextField`、
    /// `NFOptionRow`、`NFDialogButtons` 搭；间距都已经带在这些部件里。
    /// 点遮罩关闭；`dismissDisabled` 为 true 时不关（请求进行中，和网页 run() 锁住窗口一样）。
    /// 需要根上装了 `.nfOverlayHost()`。
    ///
    /// ```swift
    /// .nfDialog(isPresented: $renaming, dismissDisabled: busy) {
    ///     NFDialogTitle(L("sb_rename_chat"))
    ///     NFDialogTextField(text: $name, label: L("sb_chat_name"), maxLength: 120) { save() }
    ///     if let error { NFDialogError(error) }
    ///     NFDialogButtons {
    ///         NotionButton(L("cancel")) { renaming = false }.disabled(busy)
    ///         NotionButton(L("save"), kind: .primary) { save() }.disabled(busy || name.isEmpty)
    ///     }
    /// }
    /// ```
    func nfDialog<DialogContent: View>(
        isPresented: Binding<Bool>,
        dismissDisabled: Bool = false,
        @ViewBuilder content: @escaping () -> DialogContent
    ) -> some View {
        modifier(NFOverlayPresenter(
            isPresented: isPresented.wrappedValue,
            key: nil,
            kind: .dialog,
            dismissDisabled: dismissDisabled,
            overlayContent: { AnyView(content()) },
            dismiss: { isPresented.wrappedValue = false }
        ))
    }

    /// 同上，按一个可选的值显示：有值时显示，关闭时把它设回 nil。换成另一个值（`id` 不同）时重新进场。
    ///
    /// ```swift
    /// .nfDialog(item: $deleting) { session in
    ///     NFDialogTitle(L("sb_delete_name_q", session.title))
    ///     NFDialogDescription(L("sb_chat_delete_body"))
    ///     NFDialogButtons {
    ///         NotionButton(L("cancel")) { deleting = nil }
    ///         NotionButton(L("sb_delete_"), kind: .danger) { delete(session) }
    ///     }
    /// }
    /// ```
    func nfDialog<Item: Identifiable, DialogContent: View>(
        item: Binding<Item?>,
        dismissDisabled: Bool = false,
        @ViewBuilder content: @escaping (Item) -> DialogContent
    ) -> some View {
        let current = item.wrappedValue
        return modifier(NFOverlayPresenter(
            isPresented: current != nil,
            key: current.map { AnyHashable($0.id) },
            kind: .dialog,
            dismissDisabled: dismissDisabled,
            overlayContent: { current.map { AnyView(content($0)) } ?? AnyView(EmptyView()) },
            dismiss: { item.wrappedValue = nil }
        ))
    }
}

// MARK: - 这一层的样子

struct NFDialogLayer: View {
    let item: NFOverlayItem
    let metrics: NFOverlayMetrics
    let zBase: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // 遮罩：点了关闭。
        Sm.dialogScrim
            .contentShape(Rectangle())
            .onTapGesture {
                if !item.dismissDisabled { item.dismiss() }
            }
            .ignoresSafeArea()
            .accessibilityHidden(true)
            .zIndex(zBase)
            .transition(scrimTransition)

        card
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.bottom, metrics.keyboardInset)
            // 对话框里再打开的菜单 / 对话框画在这一层上面。
            .nfOverlayHost()
            .zIndex(zBase + 0.5)
            .transition(cardTransition)
    }

    private var scrimTransition: AnyTransition {
        if reduceMotion { return .identity }
        return AnyTransition.opacity.animation(NFMotion.cssEaseOut(0.12))
    }

    private var cardTransition: AnyTransition {
        if reduceMotion { return .identity }
        return .asymmetric(
            insertion: AnyTransition.nfRise(offsetY: 4, scale: 0.98).animation(NFMotion.cssEaseOut(0.16)),
            removal: AnyTransition.opacity.animation(NFMotion.cssEaseOut(0.1))
        )
    }

    private var card: some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        // 卡片最高到“可用高度 − 38”，再高就在里面滚动。
        return FittingScrollView(maxHeight: max(120, metrics.availableHeight - 38)) {
            VStack(alignment: .leading, spacing: 0) {
                item.content()
            }
            .nfOverlayContentDefaults()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .frame(width: max(0, min(metrics.size.width - 48, 400)))
        .nfGlassBackground(.regular, in: shape, solidFill: Sm.surface, stroke: Sm.panelRing)
        .clipShape(shape)
        .shadow(color: Sm.panelShadow, radius: 10, x: 0, y: 4)
        .accessibilityAddTraits(.isModal)
    }
}

// MARK: - 对话框里的部件

/// 标题：16 / 600、行高 24。
struct NFDialogTitle: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.nf(16, weight: 600))
            .nfLineHeight(24, fontSize: 16)
            .foregroundStyle(Sm.text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// 说明：14 / 行高 20、灰色，上距 8。
struct NFDialogDescription: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.nf(14))
            .nfLineHeight(20, fontSize: 14)
            .foregroundStyle(Sm.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 8)
    }
}

/// 小标题（`.notes-dialog-subtitle`）：13 / 600、灰色，上距 16。“移到”窗口里的“页面”。
struct NFDialogSubtitle: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.nf(13, weight: 600))
            .nfLineHeight(19.5, fontSize: 13)
            .foregroundStyle(Sm.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 16)
            .accessibilityAddTraits(.isHeader)
    }
}

/// 出错的原因：14 / 行高 20、红字 `#b91c1c`，上距 8。操作失败时留在窗口里显示。
struct NFDialogError: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.nf(14))
            .nfLineHeight(20, fontSize: 14)
            .foregroundStyle(Sm.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 8)
    }
}

/// 按钮行：上距 20、按钮间距 8、靠行尾（网页 `mt-5 flex justify-end gap-2`）。`topSpacing` 可以改上距（“移到”窗口的关闭键是 16）。
///
/// ```swift
/// NFDialogButtons {
///     NotionButton(L("cancel")) { close() }
///     NotionButton(L("create"), kind: .primary) { create() }
/// }
/// ```
struct NFDialogButtons<Content: View>: View {
    private let topSpacing: CGFloat
    private let content: Content

    init(topSpacing: CGFloat = 20, @ViewBuilder content: () -> Content) {
        self.topSpacing = topSpacing
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            content
        }
        .padding(.top, topSpacing)
    }
}

/// 输入框（`.notes-dialog-input`）：上距 12、1px 深描边、圆角 6、内边距 8.8×11.2、16 的字；聚焦时 2px 蓝框（盖住描边、再往外 1）。
/// 超过 `maxLength` 的输入截掉（网页 maxLength）。`autoFocus` 时出现后自动聚焦（名字输入框），筛选框不要。
/// `label` 是读屏念的名字；`placeholder` 是空着时的灰字。键盘上按“完成”调 `onSubmit`。
///
/// ```swift
/// NFDialogTextField(text: $name, label: L("project_name"), placeholder: L("project_name"), maxLength: 60) { submit() }
/// ```
struct NFDialogTextField: View {
    @Binding private var text: String
    private let label: String
    private let placeholder: String
    private let maxLength: Int
    private let autoFocus: Bool
    private let topSpacing: CGFloat
    private let onSubmit: () -> Void
    @FocusState private var focused: Bool

    init(
        text: Binding<String>,
        label: String,
        placeholder: String = "",
        maxLength: Int = 200,
        autoFocus: Bool = true,
        topSpacing: CGFloat = 12,
        onSubmit: @escaping () -> Void = {}
    ) {
        self._text = text
        self.label = label
        self.placeholder = placeholder
        self.maxLength = maxLength
        self.autoFocus = autoFocus
        self.topSpacing = topSpacing
        self.onSubmit = onSubmit
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6)
        TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Sm.faint))
            .textFieldStyle(.plain)
            .font(.nf(16))
            .foregroundStyle(Sm.text)
            .tint(Sm.text)
            .focused($focused)
            .submitLabel(.done)
            .onSubmit(onSubmit)
            .onChange(of: text) { _, value in
                let clipped = Self.clipUtf16(value, maxLength: maxLength)
                if clipped != value { text = clipped }
            }
            // 网页的内边距 8.8×11.2 在 1px 描边里面，这里描边画在框内，所以各加 1。
            .padding(.horizontal, 12.2)
            .padding(.vertical, 9.8)
            .frame(minHeight: 43.6)
            .background(Sm.surface, in: shape)
            .overlay { shape.strokeBorder(Sm.borderStrong, lineWidth: 1) }
            // outline: 2px solid --notion-blue; outline-offset: -1px。
            .overlay { shape.stroke(focused ? Sm.blue : .clear, lineWidth: 2) }
            .contentShape(shape)
            .onTapGesture { focused = true }
            .padding(.top, topSpacing)
            .accessibilityLabel(label)
            .task {
                guard autoFocus else { return }
                // 等对话框进场、输入框进了窗口再聚焦，太早设会被忽略。
                try? await Task.sleep(nanoseconds: 80_000_000)
                focused = true
            }
    }

    /// 服务端按 JS 字符串长度（UTF-16 码元）校验，避免含 emoji / 代理对的标题超过 200 码元却未被截断，同时不拆分完整字符。
    private static func clipUtf16(_ value: String, maxLength: Int) -> String {
        guard value.utf16.count > maxLength else { return value }
        var end = value.startIndex
        var used = 0
        for ch in value {
            let cost = ch.utf16.count
            if used + cost > maxLength { break }
            used += cost
            end = value.index(after: end)
        }
        return String(value[..<end])
    }
}
