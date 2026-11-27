import SwiftUI

// 「添加页面」（网页 AttachPageDialog；Android ui/AttachPagesDialog.kt）：选自己的笔记，作为这段对话的参考。
// 外观和项目设置的参考笔记一栏用同一套部件（dialog.chat-project-settings 的手机尺寸，见 Features/Sidebar/ProjectSettingsDialog.swift）：
// 宽 min(屏宽 − 38, 544)、无内边距、圆角 8、--notion-shadow；遮罩 rgba(15,15,15,.2)；最高到可用高度 − 38。
// 头部只有标题（16 / 600，内边距 16 / 16 / 8）；正文左右 16、上 4、下 16、可滚动："你的笔记"一栏带 n/5 计数和说明，
// 已选的标签、筛选框、列表（最多列 100 篇）；底部上边 1px 线、内边距 12 / 16 / 16，取消 / 添加靠右。点遮罩关闭（不保存）。
//
// 和项目设置一样有固定的头尾、中间滚动，放不进 `.nfDialog` 的卡片，所以借“全屏面板”那一层：面板的底色就是遮罩，卡片自己摆在中间。

private let AttachPagesCountFull = Color(argb: 0xFFB45309) // .project-settings-count.is-full

extension View {
    /// 「添加页面」窗口。打开时读一次笔记列表（失败可以重试），已选的换成最新的标题、去掉已删的；
    /// 点“添加”把选好的这组交给 `app.chat.setAttachedPages`，取消 / 点遮罩不改。
    ///
    /// ```swift
    /// .attachPagesDialog(isPresented: $pagesOpen)
    /// ```
    func attachPagesDialog(isPresented: Binding<Bool>) -> some View {
        modifier(AttachPagesDialogModifier(isPresented: isPresented))
    }
}

private struct AttachPagesDialogModifier: ViewModifier {
    @Binding var isPresented: Bool
    @Environment(AppEnvironment.self) private var app

    init(isPresented: Binding<Bool>) {
        _isPresented = isPresented
    }

    /// 借用的面板层：底色是对话框的遮罩，120ms 淡入（网页的 <dialog> 没有进场动画）。
    private static var panelStyle: NFPanelStyle {
        NFPanelStyle(background: Sm.dialogScrim, rise: 0, animation: NFMotion.cssEaseOut(0.12))
    }

    func body(content: Content) -> some View {
        content.nfPanel(isPresented: $isPresented, style: Self.panelStyle) {
            AttachPagesDialogBody(initial: app.chat.state.attachedPages) {
                isPresented = false
            }
        }
    }
}

private struct AttachPagesDialogBody: View {
    let onClose: () -> Void

    @Environment(AppEnvironment.self) private var app
    /// 重试一次加一，重新读列表。
    @State private var attempt = 0
    /// 读到的全部笔记；nil 是还没读到。
    @State private var pages: [ChatProjectNote]?
    @State private var loadError: SidebarError?
    @State private var selected: [ChatProjectNote]
    @State private var filter = ""
    @State private var headerHeight: CGFloat = 0
    @State private var footerHeight: CGFloat = 0

    init(initial: [ChatProjectNote], onClose: @escaping () -> Void) {
        self.onClose = onClose
        _selected = State(initialValue: initial)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                // 点遮罩关闭（不保存）。
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { onClose() }
                    .accessibilityHidden(true)
                card(maxHeight: max(200, proxy.size.height - 38))
                    .frame(width: max(0, min(proxy.size.width - 38, 544)))
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .task(id: attempt) { await load() }
    }

    private func load() async {
        do {
            let live = try await app.api.notes().pages.map { ChatProjectNote(page: $0) }
            pages = live
            selected = refreshAttachedPages(selected, live)
        } catch is CancellationError {
            return
        } catch {
            loadError = SidebarError.of(error, "sb_err_load_your_notes")
        }
    }

    private func card(maxHeight: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        return VStack(alignment: .leading, spacing: 0) {
            Text(L("attach_pages"))
                .font(.nf(17, weight: 650))
                .nfLineHeight(24, fontSize: 17)
                .foregroundStyle(Sm.text)
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 8)
                .nfOnSizeChange { size in
                    if headerHeight != size.height { headerHeight = size.height }
                }
            FittingScrollView(maxHeight: max(88, maxHeight - headerHeight - footerHeight)) {
                content
            }
            footer
                .nfOnSizeChange { size in
                    if footerHeight != size.height { footerHeight = size.height }
                }
        }
        // 先裁内容再上玻璃，玻璃自己的边缘和高光不被裁掉；自定义阴影只在非原生玻璃时画。
        .clipShape(shape)
        .nfGlassBackground(.regular, in: shape, solidFill: Sm.surface, stroke: Sm.panelRing)
        // 卡片上的空白处不算"点外面"。
        .contentShape(shape)
        .onTapGesture {}
        .nfChromeShadow(Sm.panelShadow, radius: 10, y: 4)
        .accessibilityAddTraits(.isModal)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            NotionButton(L("cancel")) { onClose() }
            NotionButton(L("attach_pages_submit"), kind: .primary) {
                app.chat.setAttachedPages(selected)
                onClose()
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 18)
        .overlay(alignment: .top) { NFDivider() }
    }

    private var content: some View {
        let full = selected.count >= MAX_MESSAGE_NOTES
        let untitled = L("sb_untitled")
        return VStack(alignment: .leading, spacing: 0) {
            AttachPagesLabel(L("sb_your_notes"), count: "\(selected.count)/\(MAX_MESSAGE_NOTES)", full: full)
            if !selected.isEmpty {
                ChatFlowLayout(spacing: 5.6, lineSpacing: 5.6) {
                    ForEach(selected) { note in
                        AttachPagesChip(title: note.title.isEmpty ? untitled : note.title, kind: note.kind) {
                            selected = toggleProjectNote(selected, note, max: MAX_MESSAGE_NOTES)
                        }
                    }
                }
                .padding(.top, 9.6)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(L("sb_selected_notes"))
            }
            if let loadError {
                AttachPagesError(sidebarErrorText(loadError, app.systemText))
                NotionButton(L("try_again")) {
                    self.loadError = nil
                    attempt += 1
                }
                .padding(.top, 8)
            } else if let pages {
                loaded(pages, full: full, untitled: untitled)
            } else {
                HStack(spacing: 4) {
                    Spinner(size: 14)
                    Text(L("sb_loading"))
                        .font(.nf(13))
                        .foregroundStyle(Sm.muted)
                }
                .padding(.top, 9.6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private func loaded(_ pages: [ChatProjectNote], full: Bool, untitled: String) -> some View {
        let matching = filterProjectNotes(pages, filter, untitled)
        let listed = Array(matching.prefix(MAX_LISTED_NOTES))
        let ids = Set(selected.map(\.id))

        AttachPagesFilterField(text: $filter, placeholder: L("sb_filter_notes"))
        if listed.isEmpty {
            AttachPagesEmpty(L(pages.isEmpty ? "sb_no_notes_yet" : "sb_no_notes_match"))
        } else {
            // .project-settings-list：上距 6.4、最高 176、里面滚动。
            FittingScrollView(maxHeight: 176) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(listed) { page in
                        let checked = ids.contains(page.id)
                        AttachPagesOption(
                            note: page,
                            title: page.title.isEmpty ? untitled : page.title,
                            checked: checked,
                            blocked: !checked && full
                        ) {
                            selected = toggleProjectNote(selected, page, max: MAX_MESSAGE_NOTES)
                        }
                    }
                }
            }
            .padding(.top, 6.4)
        }
        if matching.count > MAX_LISTED_NOTES {
            AttachPagesEmpty(L("sb_showing_first_notes", MAX_LISTED_NOTES))
        }
        if full {
            AttachPagesEmpty(L("sb_notes_limit", MAX_MESSAGE_NOTES))
        }
    }
}

// MARK: - 部件（和 ProjectSettingsDialog.swift 里的同一套，那边是 private，这里照样画一份）

/// `.project-settings-label`：14 / 600，右侧计数 12 灰（满了 #b45309）。
private struct AttachPagesLabel: View {
    private let text: String
    private let count: String
    private let full: Bool

    init(_ text: String, count: String, full: Bool) {
        self.text = text
        self.count = count
        self.full = full
    }

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            Text(text)
                .font(.nf(14, weight: 600))
                .foregroundStyle(Sm.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(count)
                .font(.nf(12))
                .foregroundStyle(full ? AttachPagesCountFull : Sm.muted)
                .monospacedDigit()
        }
        .frame(minHeight: 21)
    }
}

/// `.project-settings-empty`：13 灰，上距 9.6。
private struct AttachPagesEmpty: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.nf(13))
            .nfLineHeight(19.5, fontSize: 13)
            .foregroundStyle(Sm.muted)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 9.6)
    }
}

/// `.project-settings-error`：14 / 行高 21 红字，上距 12。
private struct AttachPagesError: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.nf(14))
            .nfLineHeight(21, fontSize: 14)
            .foregroundStyle(Sm.danger)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 12)
    }
}

/// `.project-settings-search`：上距 9.6、1px 深描边、圆角 6、左右 9.6、放大镜 14 + 7.2；输入 16、上下 8；聚焦 2px 蓝框。
private struct AttachPagesFilterField: View {
    @Binding var text: String
    let placeholder: String
    @FocusState private var focused: Bool
    @Environment(\.nfChromePath) private var chromePath

    init(text: Binding<String>, placeholder: String) {
        _text = text
        self.placeholder = placeholder
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        let fill = chromePath == .native ? Color.primary.opacity(0.065) : Sm.surface
        let stroke = focused ? Sm.blue : (chromePath == .native ? Color.primary.opacity(0.10) : Sm.borderStrong)
        HStack(spacing: 7.2) {
            LucideIcon(Lucide.search, size: 14, color: Sm.muted)
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Sm.faint))
                .textFieldStyle(.plain)
                .font(.nf(16))
                .foregroundStyle(Sm.text)
                .tint(Sm.text)
                .focused($focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .accessibilityLabel(placeholder)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .frame(minHeight: 42)
        .background(fill, in: shape)
        .overlay { shape.strokeBorder(stroke, lineWidth: focused ? 2 : 1) }
        .contentShape(shape)
        .onTapGesture { focused = true }
        .padding(.top, 9.6)
    }
}

/// `.project-settings-chip`：全圆角胶囊，13 字、内边距 2.4 / 3.2 / 2.4 / 8.8；页面类型图标 13 + 4.8；
/// 移除键 28 圆（✕ 12 灰）。标题最宽 220，放不下省略。
private struct AttachPagesChip: View {
    let title: String
    let kind: PageKind
    let onRemove: () -> Void
    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let bg = chromePath == .native ? Color.primary.opacity(0.07) : Sm.sidebar
        HStack(spacing: 4.8) {
            LucideIcon(pageKindIcon(kind), size: 13, color: Sm.text)
            Text(title)
                .font(.nf(13))
                .foregroundStyle(Sm.text)
                .lineLimit(1)
                .frame(maxWidth: 220, alignment: .leading)
                .fixedSize(horizontal: true, vertical: false)
            Button(action: onRemove) {
                LucideIcon(Lucide.x, size: 12, color: Sm.muted)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.pressable(cornerRadius: 14))
            .accessibilityLabel(L("sb_remove_title", title))
        }
        .padding(.leading, 10)
        .padding(.trailing, 3.2)
        .padding(.vertical, 2.4)
        .background(bg, in: Capsule())
        .overlay {
            if chromePath == .solid {
                Capsule().strokeBorder(Sm.borderStrong, lineWidth: 1)
            }
        }
    }
}

/// `.project-settings-option`（手机）：最小高 44、圆角 12、左右 8、间距 8.8、15 字；圆形勾选框 20；图标区 20；
/// 选中柔底；选满了以后没选的变浅灰且不能点。
private struct AttachPagesOption: View {
    let note: ChatProjectNote
    let title: String
    let checked: Bool
    let blocked: Bool
    let onToggle: () -> Void
    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        let selectedBg = chromePath == .native ? Color.primary.opacity(0.08) : Sm.hover
        Button(action: onToggle) {
            HStack(spacing: 8.8) {
                AttachPagesCheckbox(checked: checked, enabled: !blocked)
                NFIconTile(emoji: note.icon, fallback: pageKindIcon(note.kind), box: 20, glyph: 14)
                Text(title)
                    .font(.nf(15))
                    .foregroundStyle(blocked ? Sm.faint : Sm.text)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
        }
        .buttonStyle(.pressable(background: checked ? selectedBg : Color.clear, cornerRadius: 12))
        .disabled(blocked)
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}

/// iOS 圆形勾选框 20×20：选中蓝底白勾，没选 1.5px 灰环，禁用变淡。
private struct AttachPagesCheckbox: View {
    let checked: Bool
    let enabled: Bool

    var body: some View {
        let alpha = enabled ? 1.0 : 0.45
        ZStack {
            if checked {
                Circle().fill(Sm.blue.opacity(alpha))
                LucideIcon(Lucide.check, size: 12, strokeWidth: 2.4, color: .white)
            } else {
                Circle().strokeBorder(Sm.borderStrong.opacity(alpha), lineWidth: 1.5)
            }
        }
        .frame(width: 20, height: 20)
        .accessibilityHidden(true)
    }
}
