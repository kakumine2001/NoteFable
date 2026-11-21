import Foundation
import Observation

struct ReportAnswerState: Equatable, Sendable {
    /// 理由，选填，最多 [MAX_REPORT_REASON] 字。
    var reason = ""
    /// 正在发送：期间窗口不能关。
    var busy = false
    /// 发出去了：同一个框里换成"已发送，谢谢"和"完成"。
    var sent = false
    /// 发送失败：服务端原句，否则 report_failed。
    var error: RequestFailure? = nil
}

/// 报告这条回答（网页 answer-actions.tsx 的 ReportAnswerDialog；应用商店对 AI 生成内容的要求）。
@MainActor
@Observable
final class ReportAnswerModel {
    private(set) var state = ReportAnswerState()
    let messageId: String

    @ObservationIgnored private let backend: ReportBackend
    @ObservationIgnored private let onClose: @MainActor () -> Void
    @ObservationIgnored private let work = PendingWork()

    init(messageId: String, backend: ReportBackend, onClose: @escaping @MainActor () -> Void) {
        self.messageId = messageId
        self.backend = backend
        self.onClose = onClose
    }

    var canClose: Bool { !state.busy }
    /// 发送键上的字（文案键）。
    var sendLabelKey: String { state.busy ? "report_sending" : "report_send" }

    func setReason(_ text: String) {
        state.reason = clipUtf16(text, MAX_REPORT_REASON)
    }

    func send() {
        if state.busy || state.sent { return }
        state.busy = true
        state.error = nil
        let reason = state.reason
        work.launch { [weak self] in
            guard let self else { return }
            do {
                try await self.backend.reportAnswer(messageId: self.messageId, reason: reason)
                self.state.sent = true
            } catch is CancellationError {
                // 取消不算失败。
            } catch {
                self.state.error = RequestFailure(error)
            }
            self.state.busy = false
        }
    }

    /// 取消 / 完成 / 返回键 / 点遮罩：发送中不关。
    func close() {
        if !state.busy { onClose() }
    }

    func idle() async {
        await work.idle()
    }
}
