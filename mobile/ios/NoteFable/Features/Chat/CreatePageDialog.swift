import SwiftUI
import UIKit

// 「整理成笔记」（网页 create-page-dialog.tsx，.notes-dialog；Android ui/CreatePageDialog.kt）：AI 把整段对话改写成一篇笔记
// （POST /api/sessions/:id/page，规则见 docs/architecture/chat-flow.md 的“整理成笔记”）。
// 标题行 FilePlus 18 + 间距 8、16/600；正文 14 灰、上 12（进行中前面是转圈 16）；错误 14 红、上 8；按钮行上 20、间距 8 靠右。
// 状态在窗口外（`app.answerExports.pageJobs`）：关掉窗口也继续生成，重开时进行中的照样显示，同一聊天不重复建。
// 关窗口时忘掉已结束的结果。当前聊天在发送或回答中（含上传附件）时最后的回答还没存下，所以不能开始。

extension View {
    /// 「整理成笔记」窗口：`router.createPageSessionId` 有值时显示，关闭时设回 nil。Root / 聊天界面挂一次。
    ///
    /// ```swift
    /// ChatWorkspace().createPageDialog()
    /// ```
    func createPageDialog() -> some View {
        modifier(CreatePageDialogModifier())
    }
}

/// `.nfDialog(item:)` 要一个 Identifiable：聊天 ID 换了就是新的一个窗口（Android 的 key(sessionId)）。
private struct CreatePageTarget: Identifiable {
    let id: String
}

private struct CreatePageDialogModifier: ViewModifier {
    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    init() {}

    func body(content: Content) -> some View {
        let app = self.app
        let router = self.router
        let target = Binding<CreatePageTarget?>(
            get: { router.createPageSessionId.map { CreatePageTarget(id: $0) } },
            set: { value in
                // 点遮罩关闭也和“取消 / 关闭”一样：忘掉已结束的结果。
                if value == nil, let sessionId = router.createPageSessionId {
                    app.answerExports.forgetFinishedPage(sessionId: sessionId)
                }
                router.createPageSessionId = value?.id
            }
        )
        return content.nfDialog(item: target) { item in
            CreatePageDialogBody(sessionId: item.id)
        }
    }
}

private struct CreatePageDialogBody: View {
    let sessionId: String

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router

    init(sessionId: String) {
        self.sessionId = sessionId
    }

    var body: some View {
        let job = app.answerExports.pageJobs[sessionId]
        let state = app.chat.state
        let busy = sessionId == state.activeSessionId && (state.sending || state.upload != nil)

        HStack(spacing: 8) {
            LucideIcon(Lucide.filePlus, size: 18, color: Sm.text)
            Text(L("create_page_title"))
                .font(.nf(16, weight: 600))
                .nfLineHeight(24, fontSize: 16)
                .foregroundStyle(Sm.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        statusText(job)
            .padding(.top, 12)

        if case let .failed(message) = job {
            NFDialogError(app.systemText.localize(message))
        }

        NFDialogButtons {
            NotionButton(L(job == CreatePageJob.working || isDone(job) ? "close" : "cancel")) { close() }
            if case let .done(pageId, title, _) = job {
                // 网页：先打开笔记，再关窗口。
                NotionButton(L("open_page"), kind: .primary, trailingIcon: Lucide.arrowUpRight) {
                    router.openNote(pageId, title: title, icon: nil)
                    close()
                }
            } else {
                NotionButton(L(isFailed(job) ? "try_again" : "create_page"), kind: .primary) {
                    app.answerExports.createPage(
                        sessionId: sessionId,
                        model: app.chat.state.selectedModel?.id,
                        savedOn: createPageLocalDate()
                    )
                }
                .disabled(job == CreatePageJob.working || busy)
            }
        }
        .onChange(of: job) { _, next in announce(next) }
    }

    @ViewBuilder
    private func statusText(_ job: CreatePageJob?) -> some View {
        switch job {
        case .working:
            HStack(alignment: .top, spacing: 8) {
                // mt-0.5：和第一行文字对齐。
                Spinner(size: 16)
                    .padding(.top, 2)
                bodyText(L("create_page_working"))
            }
        case let .done(_, title, partial):
            bodyText(L("create_page_done", title) + (partial ? " " + L("create_page_partial") : ""))
        default:
            bodyText(L("create_page_body"))
        }
    }

    private func bodyText(_ text: String) -> some View {
        Text(text)
            .font(.nf(14))
            .nfLineHeight(20, fontSize: 14)
            .foregroundStyle(Sm.muted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func isDone(_ job: CreatePageJob?) -> Bool {
        if case .done = job { return true }
        return false
    }

    private func isFailed(_ job: CreatePageJob?) -> Bool {
        if case .failed = job { return true }
        return false
    }

    private func close() {
        app.answerExports.forgetFinishedPage(sessionId: sessionId)
        router.createPageSessionId = nil
    }

    /// 网页的 aria-live：进行中 / 完成念出说明（polite），失败念出原因（assertive）。
    private func announce(_ job: CreatePageJob?) {
        let text: String
        switch job {
        case .working:
            text = L("create_page_working")
        case let .done(_, title, partial):
            text = L("create_page_done", title) + (partial ? " " + L("create_page_partial") : "")
        case let .failed(message):
            text = app.systemText.localize(message)
        case nil:
            return
        }
        UIAccessibility.post(notification: .announcement, argument: text)
    }
}

/// 本地日期 yyyy-MM-dd（Android LocalDate.now().toString()，网页浏览器的本地日期）：写进笔记的来源段落。
private func createPageLocalDate() -> String {
    let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: Date())
    func pad(_ value: Int, _ width: Int) -> String {
        let digits = String(value)
        return String(repeating: "0", count: max(0, width - digits.count)) + digits
    }
    return "\(pad(parts.year ?? 1970, 4))-\(pad(parts.month ?? 1, 2))-\(pad(parts.day ?? 1, 2))"
}
