import SwiftUI
import UIKit

// 项目设置（网页 ChatProjectSettings，dialog.chat-project-settings 的手机尺寸；Android ui/ProjectSettings.kt）：
// 宽 374（412 屏宽时，左右各 19；最宽 544）、无内边距、圆角 8、--notion-shadow；遮罩 rgba(15,15,15,.2)；最高到可用高度 − 38。
// 头部 16 / 16 / 8（标题 16 / 600 + 项目名 13 灰）；正文左右 16、上 4、下 16、可滚动；
// 底部上边 1px 线、内边距 12 / 16 / 16，取消 / 保存靠右。点遮罩关闭；保存中整个窗口锁住，不能关；有没保存的改动时先确认。
// 状态和规则在 Core 的 `ProjectSettingsModel`（打开时读详情和笔记，失败可以重试；保存只发改了的字段）。
//
// 这个窗口有固定的头尾、中间滚动，放不进 `.nfDialog` 的卡片（整卡滚动、内边距 24），所以借“全屏面板”那一层：
// 面板的底色就是遮罩，卡片自己摆在中间。

private let ProjectCountFull = Color(argb: 0xFFB45309) // .project-settings-count.is-full

struct ProjectSettingsDialog: View {
    let model: ProjectSettingsModel

    @Environment(AppEnvironment.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var headerHeight: CGFloat = 0
    @State private var footerHeight: CGFloat = 0

    /// 借用的面板层：底色是对话框的遮罩，120ms 淡入（网页的 <dialog> 没有进场动画）。
    static var panelStyle: NFPanelStyle {
        NFPanelStyle(background: Sm.dialogScrim, rise: 0, animation: NFMotion.cssEaseOut(0.12))
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                // 点遮罩关闭（保存中不关，由 model.close() 判断）。
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { model.close() }
                    .accessibilityHidden(true)
                card(maxHeight: max(200, proxy.size.height - 38))
                    .frame(width: max(0, min(proxy.size.width - 38, 544)))
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }

    private func card(maxHeight: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        let state = model.state
        return VStack(alignment: .leading, spacing: 0) {
            header
                .nfOnSizeChange { size in
                    if headerHeight != size.height { headerHeight = size.height }
                }
            FittingScrollView(maxHeight: max(88, maxHeight - headerHeight - footerHeight)) {
                content(state)
            }
            footer(state)
                .nfOnSizeChange { size in
                    if footerHeight != size.height { footerHeight = size.height }
                }
        }
        // 先裁内容再上玻璃（玻璃自己的边缘和高光不被裁掉）；自定义阴影只在非原生玻璃时画。
        .clipShape(shape)
        .nfGlassBackground(.regular, in: shape, solidFill: Sm.surface, stroke: Sm.panelRing)
        .contentShape(shape)
        .onTapGesture {}
        .nfChromeShadow(Sm.panelShadow, radius: 10, y: 4)
        .accessibilityAddTraits(.isModal)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(L("sb_project_settings"))
                .font(.nf(16, weight: 600))
                .nfLineHeight(24, fontSize: 16)
                .foregroundStyle(Sm.text)
                .accessibilityAddTraits(.isHeader)
            Text(model.project.name)
                .font(.nf(13))
                .nfLineHeight(19.5, fontSize: 13)
                .foregroundStyle(Sm.muted)
                .lineLimit(1)
                .padding(.top, 2.4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }

    // 没保存就想关时，底栏换成“未保存的更改”+ 放弃 / 保存（网页 .project-settings-unsaved），每次想关晃一下并念出来。
    private func footer(_ state: ProjectSettingsState) -> some View {
        HStack(spacing: 8) {
            if model.confirming {
                Text(L("settings_unsaved"))
                    .font(.nf(14, weight: 500))
                    .foregroundStyle(Sm.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                NotionButton(L("proposal_discard")) { model.discard() }
                    .disabled(state.busy)
            } else {
                Spacer(minLength: 0)
                NotionButton(L("cancel")) { model.close() }
                    .disabled(state.busy)
            }
            NotionButton(L(state.busy ? "sb_saving" : "save"), kind: .primary) { model.save() }
                .disabled(!model.canSave)
        }
        .modifier(SettingsShakeEffect(progress: CGFloat(state.attention)))
        .animation(reduceMotion || state.attention == 0 ? nil : .linear(duration: 0.36), value: state.attention)
        .onChange(of: state.attention) { _, value in
            if value > 0 { UIAccessibility.post(notification: .announcement, argument: L("settings_unsaved")) }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 16)
        .overlay(alignment: .top) { NFDivider() }
    }

    private func content(_ state: ProjectSettingsState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let loadError = state.loadError {
                ProjectSettingsError(sidebarErrorText(loadError, app.systemText))
                NotionButton(L("try_again")) { model.retry() }
                    .padding(.top, 8)
            } else if state.loaded == nil {
                HStack(spacing: 4) {
                    Spinner(size: 14)
                    Text(L("sb_loading"))
                        .font(.nf(13))
                        .foregroundStyle(Sm.muted)
                }
                .padding(.top, 9.6)
            } else {
                loaded(state)
            }
            if let error = state.error {
                ProjectSettingsError(sidebarErrorText(error, app.systemText))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private func loaded(_ state: ProjectSettingsState) -> some View {
        let untitled = L("sb_untitled")
        let matching = model.matching(untitled: untitled)
        let listed = Array(matching.prefix(MAX_LISTED_NOTES))

        // 共通指示
        ProjectSettingsLabel(L("sb_instructions"), count: model.instructionsCount, full: false)
        ProjectInstructionsField(
            text: Binding(get: { model.state.instructions }, set: { model.setInstructions($0) }),
            enabled: !state.busy,
            label: L("sb_instructions"),
            placeholder: L("sb_instructions_placeholder")
        )

        // 参考笔记
        ProjectSettingsLabel(L("sb_reference_notes"), count: model.notesCount, full: model.full)
            .padding(.top, 20)
        if !state.selected.isEmpty {
            let chips = ProjectChipFlow(spacing: 5.6)
            chips {
                ForEach(state.selected) { note in
                    ProjectNoteChip(title: note.title.isEmpty ? untitled : note.title, kind: note.kind, enabled: !state.busy) {
                        model.toggle(note)
                    }
                }
            }
            .padding(.top, 9.6)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(L("sb_selected_notes"))
        }
        ProjectFilterField(
            text: Binding(get: { model.state.filter }, set: { model.setFilter($0) }),
            placeholder: L("sb_filter_notes")
        )
        if listed.isEmpty {
            ProjectSettingsEmpty(L(model.emptyNotesKey))
        } else {
            // .project-settings-list：上距 6.4、最高 176、里面滚动。
            FittingScrollView(maxHeight: 176) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(listed) { note in
                        ProjectNoteOption(
                            note: note,
                            title: note.title.isEmpty ? untitled : note.title,
                            checked: model.isChecked(note),
                            blocked: model.isBlocked(note),
                            busy: state.busy
                        ) {
                            model.toggle(note)
                        }
                    }
                }
            }
            .padding(.top, 6.4)
        }
        if matching.count > MAX_LISTED_NOTES {
            ProjectSettingsEmpty(L("sb_showing_first_notes", MAX_LISTED_NOTES))
        }
        if model.full {
            ProjectSettingsEmpty(L("sb_notes_limit", MAX_PROJECT_NOTES))
        }
    }
}

// MARK: - 部件

/// `.project-settings-label`：14 / 600，右侧计数 12 灰（满了 #b45309）。
private struct ProjectSettingsLabel: View {
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
                .foregroundStyle(full ? ProjectCountFull : Sm.muted)
                .monospacedDigit()
        }
        .frame(minHeight: 21)
    }
}

/// `.project-settings-empty`：13 灰，上距 9.6。
private struct ProjectSettingsEmpty: View {
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
private struct ProjectSettingsError: View {
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

/// `.project-settings-textarea`（手机）：高 144、上距 8、1px 深描边、圆角 6、内边距 8.8×11.2、16 / 行高 1.55；聚焦 2px 蓝框。
/// 写多了在框里滚动（网页的 textarea 也是）。
private struct ProjectInstructionsField: View {
    @Binding var text: String
    let enabled: Bool
    let label: String
    let placeholder: String
    @FocusState private var focused: Bool

    /// 行高 24.8 比 SF 16 的自然行高（约 19.1）多出来的部分。
    private static let lineGap: CGFloat = 5.7

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(placeholder)
                    .font(.nf(16))
                    .lineSpacing(Self.lineGap)
                    .foregroundStyle(Sm.faint)
                    .padding(.horizontal, 12.2)
                    .padding(.vertical, 9.8)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $text)
                .font(.nf(16))
                .lineSpacing(Self.lineGap)
                .foregroundStyle(Sm.text)
                .tint(Sm.text)
                .scrollContentBackground(.hidden)
                .focused($focused)
                .disabled(!enabled)
                // TextEditor 自带的留白：上下 8、左右 5（UITextView 的 textContainerInset 和 lineFragmentPadding）。
                .padding(.horizontal, 7.2)
                .padding(.vertical, 1.8)
                .accessibilityLabel(label)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 144)
        .background(Color.primary.opacity(0.05), in: shape)
        .clipShape(shape)
        .overlay { shape.strokeBorder(Sm.borderStrong.opacity(0.45), lineWidth: 1) }
        .overlay { shape.stroke(focused ? Sm.blue.opacity(0.75) : Color.clear, lineWidth: 1.5) }
        .padding(.top, 8)
    }
}

/// 项目关联笔记的搜索栏：Glass 友好的柔和填充 + 14pt 连续圆角。
private struct ProjectFilterField: View {
    @Binding var text: String
    let placeholder: String
    @FocusState private var focused: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
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
        // 网页的内边距在 1px 描边里面，这里描边画在框内，所以各加 1。
        .padding(.horizontal, 10.6)
        .padding(.vertical, 9)
        .frame(minHeight: 42)
        .background(Color.primary.opacity(0.05), in: shape)
        .overlay { shape.strokeBorder(Sm.borderStrong.opacity(0.45), lineWidth: 1) }
        .overlay { shape.stroke(focused ? Sm.blue.opacity(0.75) : Color.clear, lineWidth: 1.5) }
        .contentShape(shape)
        .onTapGesture { focused = true }
        .padding(.top, 9.6)
    }
}

/// `.project-settings-chip`：Capsule 半透明胶囊标签、13 字、内边距 2.4 / 3.2 / 2.4 / 8.8；页面类型图标 13 + 4.8；
/// 移除键 28 圆（✕ 12 灰）。标题最宽 220，放不下省略。
private struct ProjectNoteChip: View {
    let title: String
    let kind: PageKind
    let enabled: Bool
    let onRemove: () -> Void

    var body: some View {
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
            .disabled(!enabled)
            .accessibilityLabel(L("sb_remove_title", title))
        }
        .padding(.leading, 8.8)
        .padding(.trailing, 3.2)
        .padding(.vertical, 2.4)
        .background(Color.primary.opacity(0.06), in: Capsule())
        .overlay { Capsule().strokeBorder(Sm.borderStrong.opacity(0.4), lineWidth: 0.75) }
    }
}

/// `.project-settings-option`（手机）：最小高 44、12pt 连续圆角、左右 8、间距 8.8、15 字；圆形勾选框 20（蓝）；图标区 20；
/// 选中灰底；选满了以后没选的变浅灰且不能点。
private struct ProjectNoteOption: View {
    let note: ChatProjectNote
    let title: String
    let checked: Bool
    let blocked: Bool
    let busy: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 8.8) {
                ProjectCheckbox(checked: checked, enabled: !busy && !blocked)
                NFIconTile(emoji: note.icon, fallback: pageKindIcon(note.kind), box: 20, glyph: 14)
                Text(title)
                    .font(.nf(15))
                    .foregroundStyle(blocked ? Sm.faint : Sm.text)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 8)
            .frame(minHeight: 44)
        }
        .buttonStyle(.pressable(background: checked ? Sm.hover : Color.clear, cornerRadius: 12))
        .disabled(busy || blocked)
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}

/// 圆形 20×20 勾选框：选中蓝底白勾，没选浅填充描边，禁用变淡。
private struct ProjectCheckbox: View {
    let checked: Bool
    let enabled: Bool

    var body: some View {
        let alpha = enabled ? 1.0 : 0.5
        ZStack {
            if checked {
                Circle().fill(Sm.blue.opacity(alpha))
                LucideIcon(Lucide.check, size: 12, color: .white)
            } else {
                Circle().fill(Color.primary.opacity(0.05))
                Circle().strokeBorder(Sm.borderStrong.opacity(0.6 * alpha), lineWidth: 1.2)
            }
        }
        .frame(width: 20, height: 20)
        .accessibilityHidden(true)
    }
}

/// 已选笔记的标签：从行首排起，一行放不下就换行（网页 flex-wrap，间距 5.6）。
private struct ProjectChipFlow: Layout {
    var spacing: CGFloat = 5.6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, frame) in result.frames.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(width: frame.width, height: frame.height)
            )
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var frames: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            var size = subview.sizeThatFits(.unspecified)
            // 比整行还宽的标签压到行宽。
            if size.width > width { size.width = width }
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(x: x, y: y, width: size.width, height: size.height))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (CGSize(width: widest, height: y + rowHeight), frames)
    }
}
