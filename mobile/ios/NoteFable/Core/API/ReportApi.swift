import Foundation

/// 举报 AI 回答（网页 answer-actions.tsx 的 ReportAnswerDialog；应用商店对 AI 生成内容的要求）。
protocol ReportBackend {
    /// `POST /api/reports`：[reason] 可以是空字符串。失败抛 [ApiException]（带服务端的错误文字）或网络错误。
    func reportAnswer(messageId: String, reason: String) async throws
}

final class ReportApi: ReportBackend, @unchecked Sendable {
    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func reportAnswer(messageId: String, reason: String) async throws {
        let body: JSONValue = ["messageId": .string(messageId), "reason": .string(ApiText.trim(reason))]
        _ = try await http.sendForData(try http.request("POST", "/api/reports", json: body))
    }
}

/// 举报理由的上限（服务端 MAX_REPORT_REASON）。
let MAX_REPORT_REASON = 1000
