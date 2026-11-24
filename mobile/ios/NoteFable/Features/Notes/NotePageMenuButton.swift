import SwiftUI

// 笔记顶栏的“…”（网页 note-page-menu.tsx 的 .notes-page-menu = .chat-actions-menu 宽 248；Android ui/NotePageMenu.kt）：
// “Style”小标题（12 / 500 灰）；三个字体按钮（三等分、间距 4、外边距 4 / 8 / 5.6；每个上下 6.4、圆角 6.4；“Ag”22、标签 12 灰，选中的蓝色）；
// 分隔线；Small text / Full width / Lock page 三个开关；分隔线；收藏、复制、添加子页面、移动到、导出 Markdown、报告 AI 内容；
// 分隔线；移到回收站（红字）。
// 项目按页面类型出（`PageKindFeatures`，网页 PAGE_KIND_FEATURES）：白板、幻灯片没有 Style 到 Full width 这一段和导出 Markdown，
// 从 Lock page 开始（服务端也拒绝这些操作）。"报告 AI 内容"（Flag 16）只给 AI 写过的页面（`aiUpdatedAt`，`notePageReportable`），
// 打开和回答同一个报告窗口（`reportDialog`，对象是这个页面）。
// 选了操作先关菜单再执行（和网页 run() 一样，不和对话框、换页叠在一起）；字体和开关留在菜单里。

/// 顶栏最右边的“…”按钮和它的菜单。`actions` 是各项的动作（Core 的 `NotePageMenuActions`）。
@MainActor
struct NotePageMenuButton: View {
    private let pageId: String
    private let actions: NotePageMenuActions
    @State private var open = false
    /// "报告 AI 内容"的窗口（网页 NotePageMenu 的 reporting）。
    @State private var reporting = false

    init(pageId: String, actions: NotePageMenuActions) {
        self.pageId = pageId
        self.actions = actions
    }

    var body: some View {
        let label = L("pg_page_options")
        let actions = self.actions
        let pageId = self.pageId
        NFIconButton(Lucide.ellipsis, label: label) {
            if !actions.busy { open = true }
        }
        .actionsMenu(isPresented: $open, width: 248, label: label) {
            NotePageMenuContent(pageId: pageId, actions: actions, close: { open = false }, report: { reporting = true })
        }
        .reportDialog(.page(pageId: pageId), isPresented: $reporting)
    }
}

/// 菜单的内容。页面的设置直接从笔记列表里读，开关点了以后跟着服务端的结果变。
@MainActor
private struct NotePageMenuContent: View {
    let pageId: String
    let actions: NotePageMenuActions
    let close: () -> Void
    /// 打开"报告 AI 内容"的窗口。
    let report: () -> Void
    @Environment(AppEnvironment.self) private var app

    var body: some View {
        if let page = app.notes.state.pages.first(where: { $0.id == pageId }) {
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

    /// 关掉菜单再执行。
    private func run(_ action: @escaping () -> Void) -> () -> Void {
        let close = self.close
        return {
            close()
            action()
        }
    }

    private func fonts(_ page: NotePageSummary) -> some View {
        HStack(spacing: 4) {
            ForEach(NotePageFontOption.all, id: \.key) { option in
                fontButton(option, checked: page.font == option.key)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .padding(.bottom, 5.6)
    }

    private func fontButton(_ option: NotePageFontOption, checked: Bool) -> some View {
        Button {
            actions.onSettings(NotePageSettings(font: option.key))
        } label: {
            VStack(spacing: 0) {
                Text(verbatim: "Ag")
                    .font(sampleFont(option.key))
                    .nfLineHeight(26.4, fontSize: 22)
                    .foregroundStyle(checked ? Sm.blue : Sm.text)
                Text(L(option.label))
                    .font(.nf(12))
                    .nfLineHeight(16, fontSize: 12)
                    .foregroundStyle(checked ? Sm.blue : Sm.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 6.4)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.pressable(cornerRadius: 6.4))
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
