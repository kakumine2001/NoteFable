import Foundation

/// 报告的对象（网页 answer-actions.tsx 的 ReportTarget；应用商店对 AI 生成内容的要求）：聊天的回答、
/// AI 的提案卡片（页面的修改 / 新建建议）、AI 写过内容的页面（`aiUpdatedAt` 不是 null 的）。
enum ReportTarget: Equatable, Sendable {
    case answer(messageId: String)
    case proposal(proposalId: String)
    case page(pageId: String)

    /// 请求体里放对象的字段：三个里只放一个（服务端要求正好一个）。
    var field: (name: String, id: String) {
        switch self {
        case .answer(let messageId): return ("messageId", messageId)
        case .proposal(let proposalId): return ("proposalId", proposalId)
        case .page(let pageId): return ("pageId", pageId)
        }
    }

    /// 报告窗口的标题和说明（文案键）：回答是"报告这条回答"，提案和页面是"报告 AI 内容"。
    var titleKey: String {
        if case .answer = self { return "report_title" }
        return "report_ai_content"
    }

    var helpKey: String {
        if case .answer = self { return "report_help" }
        return "report_ai_help"
    }
}

/// 报告 AI 的内容（网页 answer-actions.tsx 的 ReportDialog）。
protocol ReportBackend {
    /// `POST /api/reports`：[reason] 可以是空字符串。失败抛 [ApiException]（带服务端的错误文字）或网络错误。
    func report(_ target: ReportTarget, reason: String) async throws
}

final class ReportApi: ReportBackend, @unchecked Sendable {
    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func report(_ target: ReportTarget, reason: String) async throws {
        let field = target.field
        let body: JSONValue = .object([field.name: .string(field.id), "reason": .string(ApiText.trim(reason))])
        _ = try await http.sendForData(try http.request("POST", "/api/reports", json: body))
    }
}

/// 报告理由的上限（服务端 MAX_REPORT_REASON）。
let MAX_REPORT_REASON = 1000
