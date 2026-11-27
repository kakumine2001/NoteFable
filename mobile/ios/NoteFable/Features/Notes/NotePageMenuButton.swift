import SwiftUI

// 笔记顶栏的“…”（网页 note-page-menu.tsx 的 .notes-page-menu = .chat-actions-menu 宽 248；Android ui/NotePageMenu.kt）：
// “Style”小标题（12 / 500 灰）；三个字体按钮（三等分、间距 4、外边距 4 / 8 / 5.6；每个上下 6.4、圆角 6.4；“Ag”22、标签 12 灰，选中的蓝色）；
// 分隔线；Small text / Full width / Lock page 三个开关；分隔线；收藏、复制、添加子页面、画成图（Workflow，只给笔记）、移动到、
// 导出 Markdown、报告 AI 内容；分隔线；移到回收站（红字）。
// 项目按页面类型出（`PageKindFeatures`，网页 PAGE_KIND_FEATURES）：白板、幻灯片没有 Style 到 Full width 这一段和导出 Markdown，
// 从 Lock page 开始（服务端也拒绝这些操作）。"报告 AI 内容"（Flag 16）只给 AI 写过的页面（`aiUpdatedAt`，`notePageReportable`），
// 打开和回答同一个报告窗口（`reportDialog`，对象是这个页面）。
// 选了操作先关菜单再执行（和网页 run() 一样，不和对话框、换页叠在一起）；字体和开关留在菜单里。

/// 顶栏最右边的“…”按钮和它的菜单。`actions` 是各项的动作（Core 的 `NotePageMenuActions`）。
@MainActor
struct NotePageMenuButton: View {
    private let pageId: String
    private let actions: NotePageMenuActions
    private let buttonWidth: CGFloat
    @State private var open = false
    /// 菜单收起动画结束后再执行的动作（避免导出文件的 `.fileExporter` 或后续弹窗与 `.popover` 收起冲突）。
    @State private var pendingAction: (() -> Void)? = nil
    /// "报告 AI 内容"的窗口（网页 NotePageMenu 的 reporting）。
    @State private var reporting = false

    init(pageId: String, actions: NotePageMenuActions, buttonWidth: CGFloat) {
        self.pageId = pageId
        self.actions = actions
        self.buttonWidth = buttonWidth
    }

    var body: some View {
        let label = L("pg_page_options")
        let actions = self.actions
        let pageId = self.pageId
        NFGlassBarButton(Lucide.ellipsis, label: label, width: buttonWidth) {
            if !actions.busy { open = true }
        }
        .nfPopover(
            isPresented: $open,
            width: 268,
            adaptCompactToSheet: false,
            onDismiss: {
                guard let action = pendingAction else { return }
                pendingAction = nil
                action()
            }
        ) {
            NotePageMenuContent(
                pageId: pageId,
                actions: actions,
                scheduleAfterDismiss: { action in
                    pendingAction = action
                    open = false
                },
                report: { reporting = true }
            )
        }
        .reportDialog(.page(pageId: pageId), isPresented: $reporting)
        .onDisappear {
            pendingAction = nil
        }
        .onChange(of: ScreenshotHooks.dismissTick) { _, _ in
            pendingAction = nil
            open = false
        }
        .task(id: ScreenshotHooks.sceneTick) {
            guard ScreenshotHooks.isActive, ScreenshotHooks.scene == .pageMenu else { return }
            try? await Task.sleep(for: .milliseconds(150))
            if !actions.busy, ScreenshotHooks.consume(.pageMenu) {
                open = true
                // 等系统原生 .popover 进场与动态高度测量落稳。
                try? await Task.sleep(for: .milliseconds(400))
                ScreenshotHooks.markReady(.pageMenu)
            }
        }
    }
}

/// 菜单的内容。页面的设置直接从笔记列表里读，开关点了以后跟着服务端的结果变。
@MainActor
private struct NotePageMenuContent: View {
    let pageId: String
    let actions: NotePageMenuActions
    let scheduleAfterDismiss: (@escaping () -> Void) -> Void
    /// 打开"报告 AI 内容"的窗口。
    let report: () -> Void
    @Environment(AppEnvironment.self) private var app
    @Environment(\.nfChromePath) private var chromePath

    var body: some View {
        if let page = app.notes.state.pages.first(where: { $0.id == pageId }) {
            VStack(alignment: .leading, spacing: 0) {
                if page.kind.features.typography {
                    ActionsMenuLabel(L("pg_style"))
                    fonts(page)
                    ActionsMenuDivider()
                }
                ForEach(NotePageToggle.visible(for: page.kind), id: \.self) { toggle in
                    ActionsMenuToggle(L(toggle.label), icon: toggle == .locked ? Lucide.lock : nil, isOn: toggle.isOn(page)) {
                        actions.onSettings(toggle.toggled(page))
                    }
                }
                ActionsMenuDivider()
                if notePageSupportsPresentation(page.kind), let onSlides = actions.onSlides {
                    ActionsMenuItem(L("slides_present"), icon: Lucide.presentation, action: run { onSlides(#"{"action":"present"}"#) })
                    if page.kind == .slides {
                        slideExportCommands(onSlides)
                        ActionsMenuDivider()
                    }
                }
                commands(page)
                if let error = app.notes.state.groupError {
                    ActionsMenuError(notesErrorText(error, app.systemText), tone: .answer)
                }
            }
        }
    }

    /// 先收起 `.popover`，等 UIKit 收起完成后再执行动作（避免和 `.fileExporter` 等系统弹窗抢呈现）。
    private func run(_ action: @escaping () -> Void) -> () -> Void {
        let schedule = self.scheduleAfterDismiss
        return {
            schedule(action)
        }
    }

    private func fonts(_ page: NotePageSummary) -> some View {
        let trackShape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        let trackFill = chromePath == .native ? Color.primary.opacity(0.06) : Sm.hover
        return HStack(spacing: 4) {
            ForEach(NotePageFontOption.all, id: \.key) { option in
                fontButton(option, checked: page.font == option.key)
            }
        }
        .padding(4)
        .background(trackFill, in: trackShape)
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .padding(.bottom, 5.6)
    }

    private func fontButton(_ option: NotePageFontOption, checked: Bool) -> some View {
        Button {
            Haptics.selection()
            actions.onSettings(NotePageSettings(font: option.key))
        } label: {
            VStack(spacing: 0) {
                Text(verbatim: "Ag")
                    .font(sampleFont(option.key))
                    .nfLineHeight(26.4, fontSize: 22)
                    .foregroundStyle(checked ? Sm.blue : Sm.text)
                Text(L(option.label))
                    .font(.nf(12, weight: checked ? 600 : 400))
                    .nfLineHeight(16, fontSize: 12)
                    .foregroundStyle(checked ? Sm.blue : Sm.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 6.4)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.pressable(background: checked ? Sm.accentSoft : .clear, cornerRadius: 9, scale: 0.97))
        .accessibilityAddTraits(checked ? .isSelected : [])
    }

    /// “Ag”用各自的字体画：默认、衬线、等宽。
    private func sampleFont(_ key: String) -> Font {
        switch key {
        case "serif": return .system(size: 22, design: .serif)
        case "mono": return .system(size: 22, design: .monospaced)
        default: return .system(size: 22)
        }
    }

    /// 幻灯片的导出：PDF / 带备注的 PDF / PNG / PPTX（Android NotePageMenu.kt）。
    @ViewBuilder
    private func slideExportCommands(_ onSlides: @escaping (String) -> Void) -> some View {
        ActionsMenuItem(L("slides_export_pdf"), icon: Lucide.download, action: run { onSlides(#"{"action":"export","format":"pdf"}"#) })
        ActionsMenuItem(L("slides_export_pdf_notes"), icon: Lucide.download, action: run { onSlides(#"{"action":"export","format":"pdf-notes"}"#) })
        ActionsMenuItem(L("slides_export_png"), icon: Lucide.download, action: run { onSlides(#"{"action":"export","format":"png"}"#) })
        ActionsMenuItem(L("slides_export_pptx"), icon: Lucide.download, action: run { onSlides(#"{"action":"export","format":"pptx"}"#) })
        Text(L("slides_export_pptx_transition_note"))
            .font(.nf(11.5))
            .nfLineHeight(16, fontSize: 11.5)
            .foregroundStyle(Sm.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.top, 2)
            .padding(.bottom, 6)
    }

    @ViewBuilder
    private func commands(_ page: NotePageSummary) -> some View {
        let favorite = page.favoritedAt != nil
        let onFavorite = actions.onFavorite
        ActionsMenuItem(
            L(notePageFavoriteLabel(page)), icon: favorite ? Lucide.starOff : Lucide.star,
            action: run { onFavorite(!favorite) }
        )
        ActionsMenuItem(L("pg_duplicate"), icon: Lucide.copy, action: run(actions.onDuplicate))
        ActionsMenuItem(L("pg_add_page_inside"), icon: Lucide.filePlus2, action: run(actions.onAddInside))
        if notePageDrawable(page), let onDrawDiagram = actions.onDrawDiagram {
            ActionsMenuItem(
                L(actions.drawingDiagram ? "diagram_working" : "diagram_draw"), icon: Lucide.workflow,
                isBusy: actions.drawingDiagram, action: run(onDrawDiagram)
            )
        }
        if notePageDrawable(page), let onGenerateSlides = actions.onGenerateSlides {
            ActionsMenuItem(
                L(actions.generatingSlides ? "slides_generating" : "slides_generate"), icon: Lucide.presentation,
                isBusy: actions.generatingSlides, action: run(onGenerateSlides)
            )
        }
        ActionsMenuItem(L("pg_move_to"), icon: Lucide.folderInput, action: run(actions.onMove))
        if page.kind.features.markdownExport {
            ActionsMenuItem(L("export_markdown"), icon: Lucide.download, action: run(actions.onExport))
        }
        if notePageReportable(page) {
            ActionsMenuItem(L("report_ai_content"), icon: Lucide.flag, action: run(report))
        }
        ActionsMenuDivider()
        ActionsMenuItem(L("move_to_trash"), icon: Lucide.trash2, role: .danger, action: run(actions.onTrash))
    }
}
