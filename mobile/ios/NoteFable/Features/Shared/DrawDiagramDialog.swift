import SwiftUI
import UIKit

// 「画成图」的进度窗口（#153；规则见 docs/architecture/chat-flow.md 的“画成图”，样子照「整理成笔记」的 .notes-dialog，CreatePageDialog.swift）：
// 标题行 Workflow 18 + 间距 8、16/600；说明 14 灰、上 12（这条回答 / 笔记会画成新白板上可编辑的图，算 1 次聊天）；
// 进行中下面一行转圈 16 +“正在画图…”、上 12；完成时换成“图已经画好了。”（材料太长时再加一句只画了前一部分）；
// 失败是红字的原因（上 8，服务端原句经系统文翻译），转不成可编辑的图（422）时下面还有“复制图的源码”（上 8，复制后 2 秒显示“已复制”）。
// 按钮行上 20、间距 8 靠右：关闭；完成时“打开白板”（主按钮，ArrowUpRight），失败时“重试”（主按钮，同一个 clientRequestId）。
// 状态在窗口外（`app.diagrams`）：关掉窗口也继续生成，同一素材再点回到同一个任务；关掉已结束的窗口时忘掉任务。
// 窗口挂在根上（回答的菜单在聊天里，笔记的菜单在编辑页），打开 / 关闭都经 `AppRouter`。

extension View {
    /// 「画成图」窗口：`router.diagramSource` 有值时显示，关闭时经 `router.closeDiagram()`。根视图挂一次（在 `.nfOverlayHost()` 里面）。
    ///
    /// ```swift
    /// RootContent().drawDiagramDialog().nfOverlayHost()
    /// ```
    func drawDiagramDialog() -> some View {
        modifier(DrawDiagramDialogModifier())
    }
}

/// `.nfDialog(item:)` 要一个 Identifiable：换了素材就是新的一个窗口。
private struct DrawDiagramTarget: Identifiable {
    let source: DiagramSource
    var id: String { source.key }
}

private struct DrawDiagramDialogModifier: ViewModifier {
    @Environment(AppRouter.self) private var router

    init() {}

    func body(content: Content) -> some View {
        let router = self.router
        let target = Binding<DrawDiagramTarget?>(
            get: { router.diagramSource.map { DrawDiagramTarget(source: $0) } },
            set: { value in
                // 点遮罩关闭也和“关闭”一样：忘掉已结束的任务。
                if let value {
                    router.diagramSource = value.source
                } else {
                    router.closeDiagram()
                }
            }
        )
        return content.nfDialog(item: target) { item in
            DrawDiagramDialogBody(source: item.source)
        }
    }
}

private struct DrawDiagramDialogBody: View {
    let source: DiagramSource

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    /// 每复制一次源码加一，2 秒后归零（按钮这时显示“已复制”）；连续点时重新计时。
    @State private var copiedTick = 0
    /// 使用次数上限的登录提示被关闭。
    @State private var limitClosed = false

    init(source: DiagramSource) {
        self.source = source
    }

    var body: some View {
        let job = app.diagrams.job(source)

        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                LucideIcon(Lucide.workflow, size: 18, color: Sm.text)
                Text(L("diagram_draw"))
                    .font(.nf(16, weight: 600))
                    .nfLineHeight(24, fontSize: 16)
                    .foregroundStyle(Sm.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            statusText(job)
                .padding(.top, 12)

            if case let .failed(failure) = job {
                NFDialogError(app.systemText.localize(failure.message))
                if !limitClosed,
                   failure.usageLimitTier == "guest",
                   app.account.state.configured,
                   app.account.state.user == nil {
                    GuestLimitPrompt(
                        usage: UsageLimitInfo(tier: "guest", kind: "chat"),
                        attachmentsLost: false,
                        onClose: { limitClosed = true }
                    )
                    .padding(.top, 12)
                }
            }

            DiagramButtonsFlow(spacing: 8, lineSpacing: 8) {
                NotionButton(L("close")) { router.closeDiagram() }
                switch job {
                case let .done(page, _)?:
                    // 网页：先打开白板，再关窗口。
                    NotionButton(L("diagram_open"), kind: .primary, trailingIcon: Lucide.arrowUpRight) {
                        router.openDrawnDiagram(page)
                    }
                case let .failed(failure)?:
                    if let mermaid = failure.source {
                        copySourceButton(mermaid)
                    }
                    NotionButton(L("try_again"), kind: .primary) {
                        copiedTick = 0
                        limitClosed = false
                        router.retryDiagram(source)
                    }
                case .working?, nil:
                    EmptyView()
                }
            }
            .padding(.top, 20)
        }
        .onAppear {
            if job == nil { router.closeDiagram() }
        }
        .onChange(of: job) { _, next in
            if next == nil {
                router.closeDiagram()
                return
            }
            announce(next)
        }
        .task(id: copiedTick) {
            guard copiedTick > 0 else { return }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !Task.isCancelled { copiedTick = 0 }
        }
    }

    private func statusText(_ job: DiagramJob?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if case let .done(_, partial)? = job {
                bodyText(doneText(partial))
            } else {
                bodyText(L("diagram_description"))
                if job == DiagramJob.working {
                    HStack(alignment: .top, spacing: 8) {
                        // mt-0.5：和第一行文字对齐。
                        Spinner(size: 16)
                            .padding(.top, 2)
                        bodyText(L("diagram_working"))
                    }
                    .padding(.top, 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func bodyText(_ text: String) -> some View {
        Text(text)
            .font(.nf(14))
            .nfLineHeight(20, fontSize: 14)
            .foregroundStyle(Sm.muted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func doneText(_ partial: Bool) -> String {
        L("diagram_done") + (partial ? " " + L("diagram_partial") : "")
    }

    /// 422：模型写的 Mermaid 原文复制到剪贴板（可以贴到别的工具里自己改）。
    private func copySourceButton(_ mermaid: String) -> some View {
        let copied = copiedTick > 0
        return NotionButton(
            copied ? L("answer_copied") : L("diagram_copy_source"),
            icon: copied ? Lucide.check : Lucide.copy
        ) {
            UIPasteboard.general.string = mermaid
            copiedTick += 1
            UIAccessibility.post(notification: .announcement, argument: L("answer_copied"))
        }
    }

    /// 网页的 aria-live：进行中 / 完成念出说明（polite），失败念出原因（assertive）。
    private func announce(_ job: DiagramJob?) {
        let text: String
        switch job {
        case .working?:
            text = L("diagram_working")
        case let .done(_, partial)?:
            text = doneText(partial)
        case let .failed(failure)?:
            text = app.systemText.localize(failure.message)
        case nil:
            return
        }
        UIAccessibility.post(notification: .announcement, argument: text)
    }
}

/// 靠右对齐的换行按钮行（网页 `flex flex-wrap justify-end gap-2`、Android `FlowRow(Alignment.End)`）。
private struct DiagramButtonsFlow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let layout = arrange(width: maxWidth, subviews: subviews)
        let width = maxWidth.isFinite ? maxWidth : layout.widest
        return CGSize(width: width, height: layout.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let layout = arrange(width: bounds.width, subviews: subviews)
        var y = bounds.minY
        for row in layout.rows {
            var x = bounds.maxX - row.width
            for item in row.items {
                subviews[item.index].place(
                    at: CGPoint(x: x, y: y + (row.height - item.size.height) / 2),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(width: item.size.width, height: item.size.height)
                )
                x += item.size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row {
        var items: [(index: Int, size: CGSize)] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (rows: [Row], widest: CGFloat, height: CGFloat) {
        let bounded = width.isFinite
        let limit = bounded ? max(0, width) : CGFloat.greatestFiniteMagnitude
        var rows: [Row] = []
        var current = Row()
        for (index, subview) in subviews.enumerated() {
            var size = subview.sizeThatFits(ProposedViewSize(width: bounded ? limit : nil, height: nil))
            if bounded { size.width = min(size.width, limit) }
            let nextWidth = current.items.isEmpty ? size.width : current.width + spacing + size.width
            if !current.items.isEmpty, nextWidth > limit {
                rows.append(current)
                current = Row()
            }
            current.items.append((index, size))
            current.width = current.items.count == 1 ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
        }
        if !current.items.isEmpty { rows.append(current) }
        let widest = rows.map(\.width).max() ?? 0
        let totalHeight = rows.enumerated().reduce(CGFloat(0)) { sum, entry in
            sum + entry.element.height + (entry.offset > 0 ? lineSpacing : 0)
        }
        return (rows, widest, totalHeight)
    }
}
