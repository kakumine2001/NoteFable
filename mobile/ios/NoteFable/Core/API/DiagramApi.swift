import Foundation
import Observation

/// 「画成图」（#153，规则见 docs/architecture/chat-flow.md 的“画成图”）：AI 把一条回答或一篇笔记画成可编辑的图，放进新白板。
/// `POST /api/pages/diagram` `{ source: "answer", messageId } | { source: "note", pageId }` + `model?` + `clientRequestId`
/// → 201 `{ page, partial? }`（新白板的摘要；从笔记来的是那篇笔记的子页面），同一个 clientRequestId 再发 → 200 `{ page }`（不再扣额度）。
/// 失败：400 / 404 / 413 / 429 带服务端原句；422 `{ error, code: "diagram_invalid", source }`（转不成可编辑的图，额度已退还）；
/// 502 / 503 "Could not draw a diagram. Try again."（额度已退还）。
protocol DiagramBackend {
    /// 失败抛 [ApiException]（status 和服务端原句）或 [DiagramInvalidError]（422 diagram_invalid）。
    func drawDiagram(source: DiagramSource, model: String?, clientRequestId: String) async throws -> DrawnDiagram
}

/// 画什么：已经存进服务端的一条回答（不是 local-N 的临时 ID），或一篇笔记（服务端读已保存的正文）。
enum DiagramSource: Hashable, Sendable {
    case answer(sessionId: String, messageId: String)
    case note(pageId: String)

    /// 任务的键（和网页、Android 同一个写法）：`answer:<会话ID>\n<消息ID>`、`note:<笔记ID>`。
    var key: String {
        switch self {
        case let .answer(sessionId, messageId): return "answer:\(sessionId)\n\(messageId)"
        case let .note(pageId): return "note:\(pageId)"
        }
    }
}

/// 画好的白板。[partial]：材料太长只画了前面一部分（或思维导图被裁剪）。
struct DrawnDiagram: Equatable, Sendable {
    var page: NotePageSummary
    var partial: Bool
}

/// 422 `diagram_invalid`：模型写的图转不成可编辑的图形（额度已退还）。[source] 是那段 Mermaid 原文，界面可以复制；可能是空的。
struct DiagramInvalidError: Error, Equatable, Sendable {
    var message: String
    var source: String
}

final class DiagramApi: DiagramBackend, @unchecked Sendable {
    // 和「整理成笔记」一样要等一次完整的生成（服务端最多 300 秒）：不按普通请求的 30 / 60 秒超时断开。
    private static let DIAGRAM_TIMEOUT = HTTPTimeout(idle: nil, total: 320)

    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func drawDiagram(source: DiagramSource, model: String?, clientRequestId: String) async throws -> DrawnDiagram {
        var fields: [String: JSONValue] = ["clientRequestId": .string(clientRequestId)]
        switch source {
        case let .answer(_, messageId):
            fields["source"] = .string("answer")
            fields["messageId"] = .string(messageId)
        case let .note(pageId):
            fields["source"] = .string("note")
            fields["pageId"] = .string(pageId)
        }
        if let model { fields["model"] = .string(model) }
        var request = try http.request("POST", "/api/pages/diagram", json: .object(fields), timeout: Self.DIAGRAM_TIMEOUT)
        request.setHeader("Accept", "application/json")
        // 不用 sendForData：422 的 Mermaid 原文（source）在错误的正文里，ApiException 不带它。
        let (data, response) = try await http.execute(request)
        guard response.isSuccessful else { throw Self.failure(status: response.statusCode, body: data) }
        // 没有 page.id 也算失败（通用的"没能画成图"）。
        guard let root = JSONValue.parse(data), root["page"]?["id"]?.stringValue != nil else {
            throw ApiException(status: 500, message: "HTTP 500")
        }
        let page = try NoteFableJson.decode(PageResponse.self, from: data).page
        return DrawnDiagram(page: page, partial: root["partial"] == .bool(true))
    }

    static func failure(status: Int, body: Data) -> Error {
        let api = ApiException.from(status: status, body: body)
        guard status == 422, api.code == DIAGRAM_INVALID_CODE else { return api }
        return DiagramInvalidError(
            message: api.serverMessage() ?? DIAGRAM_NOT_CONVERTED,
            source: JSONValue.parse(body)?["source"]?.stringValue ?? ""
        )
    }
}

let DIAGRAM_INVALID_CODE = "diagram_invalid"
/// 服务端的兜底句（5xx、网络错误、回复不对时界面也用它）。
let DIAGRAM_FAILED = "Could not draw a diagram. Try again."
/// 422 diagram_invalid 的服务端原句（正文里没有 error 时用）。
let DIAGRAM_NOT_CONVERTED = "Could not turn this into an editable diagram."

/// 失败时窗口里显示的东西：[message] 是英文原句（服务端的，或兜底句），界面经系统文词典翻译；
/// [source] 是 422 时模型写的 Mermaid 原文（有它才显示"复制图的源码"）；
/// [usageLimitTier] 是 429 usage_limit 时的档位（"guest" / "member"），游客用于窗口内显示登录入口。
struct DiagramFailure: Equatable, Sendable {
    var message: String
    var source: String? = nil
    var usageLimitTier: String? = nil
}

/// 和「整理成笔记」同一条规则：400 / 404 / 413 / 422 / 429 显示服务端原句（429 是上限的说明），其余（5xx、网络错误、回复不对）是兜底句。
func diagramFailure(_ error: Error) -> DiagramFailure {
    if let invalid = error as? DiagramInvalidError {
        return DiagramFailure(message: invalid.message, source: ApiText.isBlank(invalid.source) ? nil : invalid.source)
    }
    guard let api = error as? ApiException else { return DiagramFailure(message: DIAGRAM_FAILED) }
    if [400, 404, 413, 422, 429].contains(api.status), let message = api.serverMessage() {
        return DiagramFailure(message: message, usageLimitTier: api.isUsageLimit ? api.tier : nil)
    }
    return DiagramFailure(message: DIAGRAM_FAILED)
}

/// 一个素材的「画成图」状态。
enum DiagramJob: Equatable, Sendable {
    case working
    case done(page: NotePageSummary, partial: Bool)
    case failed(DiagramFailure)
}

/// 「画成图」的任务，按素材（[DiagramSource.key]）存在界面外（网页 / Android 模块级的 jobs）：窗口关掉也继续生成，
/// 重开窗口时还是同一个任务；同一素材同时只有一个任务，不会重复建白板、重复扣额度。
/// 每个任务生成一次 clientRequestId，失败后"重试"也用它：上一次其实建好了、只是回复丢了时，服务端直接返回那一页（不再扣）。
/// 关掉已结束的窗口时忘掉任务（[forgetFinished]），之后再点是新的任务、新的 clientRequestId。
/// 建好后通过 [created] 发出新白板（App 级据此刷新笔记列表，网页 notefable:page-created）。
@MainActor
@Observable
final class DiagramStore {
    private(set) var jobs: [String: DiagramJob] = [:]

    @ObservationIgnored private let backend: DiagramBackend
    @ObservationIgnored private let newRequestId: () -> String
    @ObservationIgnored private let createdEvents = StoreEvents<NotePageSummary>()
    // 每个任务的 clientRequestId（重试时再用）。
    @ObservationIgnored private var requestIds: [String: String] = [:]
    // 换身份的次数。进行中的任务按开始时的值判断结果还要不要。
    @ObservationIgnored private var generation = 0

    /// [newRequestId]：生成 clientRequestId（服务端要 8〜64 个 `[A-Za-z0-9_-]`；UUID 是 36 个）。测试里换成固定的。
    init(backend: DiagramBackend, newRequestId: @escaping () -> String = { UUID().uuidString }) {
        self.backend = backend
        self.newRequestId = newRequestId
    }

    func job(_ source: DiagramSource) -> DiagramJob? {
        jobs[source.key]
    }

    /// 画好的新白板（在后台完成也会发出）。先开始听，再触发；之前发过的不补。
    func created() -> AsyncStream<NotePageSummary> {
        createdEvents.stream()
    }

    /// 菜单的「画成图」：这个素材还没有任务时开始一个（新的 clientRequestId）。已有任务（进行中、已完成、失败）时什么也不做、返回 nil，
    /// 窗口显示那个任务。
    @discardableResult
    func start(_ source: DiagramSource, model: String?) -> Task<Void, Never>? {
        let key = source.key
        if jobs[key] != nil { return nil }
        let requestId = newRequestId()
        requestIds[key] = requestId
        return run(source, model: model, requestId: requestId)
    }

    /// 失败后的"重试"：用同一个 clientRequestId 再发。不是失败状态时什么也不做、返回 nil。
    @discardableResult
    func retry(_ source: DiagramSource, model: String?) -> Task<Void, Never>? {
        let key = source.key
        guard case .failed? = jobs[key], let requestId = requestIds[key] else { return nil }
        return run(source, model: model, requestId: requestId)
    }

    private func run(_ source: DiagramSource, model: String?, requestId: String) -> Task<Void, Never> {
        let key = source.key
        jobs[key] = .working
        let generation = self.generation
        let backend = self.backend
        // 在 Store 自己开的任务里跑：离开对话、关掉窗口都不取消。
        return Task {
            let next: DiagramJob
            do {
                let drawn = try await backend.drawDiagram(source: source, model: model, clientRequestId: requestId)
                next = .done(page: drawn.page, partial: drawn.partial)
            } catch {
                next = .failed(diagramFailure(error))
            }
            // 期间换过身份：结果不留（那块白板属于别的身份，打不开），只把"进行中"去掉。
            guard generation == self.generation else {
                jobs[key] = nil
                requestIds[key] = nil
                return
            }
            jobs[key] = next
            if case let .done(page, _) = next { createdEvents.emit(page) }
        }
    }

    /// 关窗口时忘掉已结束的任务（之后再点是新的任务）；进行中的留着。
    func forgetFinished(_ source: DiagramSource) {
        let key = source.key
        guard let job = jobs[key], job != .working else { return }
        jobs[key] = nil
        requestIds[key] = nil
    }

    /// 换身份（登录 / 退出）时清掉已结束的任务（别的身份的白板打不开）。进行中的留着、直到它结束（结果不留）：
    /// 这期间又登回同一个账号时，同一个素材不会再发一次。
    func clearJobs() {
        generation += 1
        let working = Set(jobs.keys.filter { jobs[$0] == .working })
        jobs = jobs.filter { working.contains($0.key) }
        requestIds = requestIds.filter { working.contains($0.key) }
    }
}
