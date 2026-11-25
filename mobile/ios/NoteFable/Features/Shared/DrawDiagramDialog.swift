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

    init(source: DiagramSource) {
        self.source = source
    }

    var body: some View {
        let job = app.diagrams.job(source)

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
            if let mermaid = failure.source {
                copySourceButton(mermaid)
                    .padding(.top, 8)
            }
        }

        NFDialogButtons {
            NotionButton(L("close")) { router.closeDiagram() }
            switch job {
            case let .done(page, _)?:
                // 网页：先打开白板，再关窗口。
                NotionButton(L("diagram_open"), kind: .primary, trailingIcon: Lucide.arrowUpRight) {
                    router.openDrawnDiagram(page)
                }
            case .failed?:
                NotionButton(L("try_again"), kind: .primary) { router.retryDiagram(source) }
            case nil:
                // 任务不在了（进行中换了身份，结果没留下）：可以重新开始。
                NotionButton(L("diagram_draw"), kind: .primary) { router.drawDiagram(source) }
            case .working?:
                EmptyView()
            }
        }
        .onChange(of: job) { _, next in announce(next) }
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
            kind: .quiet,
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
