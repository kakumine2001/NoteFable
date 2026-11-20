import Foundation
import Observation

/// 回答的"…"菜单（网页 answer-actions.tsx）：存到笔记、下载整段对话。
/// 网页在浏览器里用 answer-export.ts 生成笔记块和 Markdown；App 没有这套转换，交给服务端用同一组函数生成：
/// - `POST /api/pages/from-answer` `{ markdown, sessionId, messageId, savedOn }` → 201 `{ page }`
/// - `GET /api/sessions/:id/export?date=` → `{ fileName, markdown }`
/// savedOn / date 是本机日期（YYYY-MM-DD），出处里的日期按用户所在时区，与网页一致。
protocol ExportBackend {
    /// 新建笔记，返回它的 ID。失败抛 [ApiException]（status 和服务端原句）。
    func saveAnswer(markdown: String, sessionId: String, messageId: String, savedOn: String) async throws -> String

    func exportConversation(sessionId: String, date: String) async throws -> ConversationExport

    /// 「整理成笔记」（网页 createPageFromChat）：`POST /api/sessions/:id/page` `{ model, savedOn }` → 201 `{ page, partial }`。
    /// 失败抛 [ApiException]（status 和服务端原句）。
    func createPageFromChat(sessionId: String, model: String?, savedOn: String) async throws -> CreatedPage
}

struct ConversationExport: Encodable, Equatable, Sendable {
    var fileName: String
    var markdown: String
}

extension ConversationExport: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(fileName: try f.req("fileName"), markdown: try f.req("markdown"))
    }
}

/// 整理好的笔记。[partial]：对话太长，旧的消息或长消息的后半没用上。
struct CreatedPage: Equatable, Sendable {
    var id: String
    var title: String
    var partial: Bool
}

final class ExportApi: ExportBackend, @unchecked Sendable {
    // 整理一段长对话要等一次完整的生成（服务端最多 300 秒）：不按普通请求的 30 / 60 秒超时断开。
    private static let PAGE_TIMEOUT = HTTPTimeout(idle: nil, total: 320)

    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func createPageFromChat(sessionId: String, model: String?, savedOn: String) async throws -> CreatedPage {
        var fields: [String: JSONValue] = ["savedOn": .string(savedOn)]
        if let model { fields["model"] = .string(model) }
        let data = try await http.sendForData(
            try http.request("POST", "/api/sessions/\(ApiUrl.encode(sessionId))/page", json: .object(fields), timeout: Self.PAGE_TIMEOUT)
        )
        // 网页：没有 page.id 也算失败（通用的"无法整理"）。
        guard let root = JSONValue.parse(data), let page = root["page"], let id = page["id"]?.stringValue else {
            throw ApiException(status: 500, message: "HTTP 500")
        }
        let partial = root["partial"] == .bool(true) || root["partial"] == .string("true")
        return CreatedPage(id: id, title: page["title"]?.stringValue ?? "", partial: partial)
    }

    func saveAnswer(markdown: String, sessionId: String, messageId: String, savedOn: String) async throws -> String {
        let body: JSONValue = [
            "markdown": .string(markdown), "sessionId": .string(sessionId), "messageId": .string(messageId),
            "savedOn": .string(savedOn),
        ]
        let data = try await http.sendForData(try http.request("POST", "/api/pages/from-answer", json: body))
        // 网页：没有 page.id 也算失败（显示通用的"无法保存"）。
        guard let id = JSONValue.parse(data)?["page"]?["id"]?.stringValue else {
            throw ApiException(status: 500, message: "HTTP 500")
        }
        return id
    }

    func exportConversation(sessionId: String, date: String) async throws -> ConversationExport {
        let path = "/api/sessions/\(ApiUrl.encode(sessionId))/export?date=\(ApiUrl.encode(date))"
        let export = try NoteFableJson.decode(ConversationExport.self, from: try await http.sendForData(try http.request("GET", path)))
        // 网页：没有消息就当作取不到会话。
        if ApiText.isBlank(export.markdown) { throw ApiException(status: 404, message: "HTTP 404") }
        return export
    }
}

/// 存到笔记的状态（网页 SaveState）。
enum AnswerSave: Equatable, Sendable {
    case saving
    case saved(pageId: String)
}

/// 存到笔记失败的原因：[serverMessage] 是服务端原句（界面翻译后显示）；否则按 [tooLarge] 选本地文案。
struct AnswerSaveError: Equatable, Sendable {
    var tooLarge: Bool = false
    var serverMessage: String? = nil
}

enum AnswerSaveResult: Equatable, Sendable {
    case ok
    /// 同一条回答已经在保存中或已保存：什么也不做（网页 { ok: "pending" }）。
    case pending
    case failed(AnswerSaveError)
}

/// 网页 saveErrorMessage：413 → 太大；400 带服务端原句 → 原句；其余（503、网络、不是 JSON）→ "无法保存到笔记"。
func answerSaveError(_ error: Error) -> AnswerSaveError {
    guard let api = error as? ApiException else { return AnswerSaveError() }
    if api.status == 413 { return AnswerSaveError(tooLarge: true) }
    if api.status == 400, let message = api.serverMessage() { return AnswerSaveError(serverMessage: message) }
    return AnswerSaveError()
}

/// "存到笔记"的状态按 `会话ID\n消息ID` 存在界面外（网页模块级的 saves Map）：回答重新绘制、切换对话再回来，
/// 都还是"正在保存 / 已保存"，不会重复建笔记。和网页一样只在本次运行内记住（重开 App 就忘了，服务端不去重）。
/// 保存在 Store 自己开的任务里跑，离开对话也不会被取消。建好后通过 [created] 发出新笔记的 ID（网页 notefable:page-created），
/// 根界面据此刷新笔记列表。回答的 ID 由 ChatViewModel 对账时通过 [rename] 换成服务端 ID。
@MainActor
@Observable
final class AnswerExportStore {
    private(set) var saves: [String: AnswerSave] = [:]

    /// 每个聊天的「整理成笔记」状态。窗口关掉也继续生成；重开窗口时进行中的还是同样的显示，同一聊天不会重复建。
    private(set) var pageJobs: [String: CreatePageJob] = [:]

    private let backend: ExportBackend
    private let createdEvents = StoreEvents<String>()

    // 旧 key → 新 key（对账把 local-N 换成服务端 ID）：在途的保存完成时写到最新的 key 下。
    @ObservationIgnored private var renamed: [String: String] = [:]
    // 等着写进保存位置的 Markdown，按会话：保存位置的选择器开着时界面可能重建，界面状态没了，这里还在。
    @ObservationIgnored private var heldExports: [String: String] = [:]
    // 换身份的次数。进行中的整理按开始时的值判断结果还要不要。
    @ObservationIgnored private var pageGeneration = 0

    init(backend: ExportBackend) {
        self.backend = backend
    }

    /// 存到笔记 / 整理成笔记成功后新笔记的 ID（在后台完成也会发出）。先开始听，再触发；之前发过的不补。
    func created() -> AsyncStream<String> {
        createdEvents.stream()
    }

    /// 下载整段对话（不在 Store 的任务里跑：和网页一样，离开对话就不再触发下载）。
    func exportConversation(sessionId: String, date: String) async throws -> ConversationExport {
        try await backend.exportConversation(sessionId: sessionId, date: date)
    }

    func holdExport(sessionId: String, markdown: String) {
        heldExports[sessionId] = markdown
    }

    func takeExport(sessionId: String) -> String? {
        heldExports.removeValue(forKey: sessionId)
    }

    /// 回答的 ID 从 [from] 换成 [to]：把保存状态搬过去，在途的保存完成后也记在 [to] 下。
    func rename(sessionId: String, from: String, to: String) {
        if from == to { return }
        let old = Self.key(sessionId, from)
        let new = Self.key(sessionId, to)
        renamed[old] = new
        guard let value = saves.removeValue(forKey: old) else { return }
        if saves[new] == nil { saves[new] = value }
    }

    private func current(_ key: String) -> String {
        var key = key
        while let next = renamed[key] { key = next }
        return key
    }

    /// 存到笔记。返回的任务给出结果；状态在 [saves] 里（调用后马上是 `.saving`）。
    @discardableResult
    func save(sessionId: String, messageId: String, markdown: String, savedOn: String) -> Task<AnswerSaveResult, Never> {
        let key = Self.key(sessionId, messageId)
        if saves[key] != nil { return Task { AnswerSaveResult.pending } }
        saves[key] = .saving
        return Task {
            do {
                let pageId = try await backend.saveAnswer(markdown: markdown, sessionId: sessionId, messageId: messageId, savedOn: savedOn)
                saves[key] = nil
                saves[current(key)] = .saved(pageId: pageId)
                createdEvents.emit(pageId)
                return .ok
            } catch {
                saves[key] = nil
                saves[current(key)] = nil
                return .failed(error is CancellationError ? AnswerSaveError() : answerSaveError(error))
            }
        }
    }

    // MARK: - 整理成笔记（网页 create-page-dialog.tsx 模块级的 jobs）

    /// 开始整理（进行中就什么也不做，返回 nil）。完成后通过 [created] 发出新笔记的 ID，笔记列表据此刷新。
    @discardableResult
    func createPage(sessionId: String, model: String?, savedOn: String) -> Task<Void, Never>? {
        if pageJobs[sessionId] == .working { return nil }
        pageJobs[sessionId] = .working
        let generation = pageGeneration
        return Task {
            let next: CreatePageJob
            do {
                let page = try await backend.createPageFromChat(sessionId: sessionId, model: model, savedOn: savedOn)
                createdEvents.emit(page.id)
                next = .done(pageId: page.id, title: page.title, partial: page.partial)
            } catch is CancellationError {
                pageJobs[sessionId] = nil
                return
            } catch {
                next = .failed(message: createPageErrorMessage(error))
            }
            // 期间换过身份：结果不留（那篇笔记可能打不开），只把"进行中"去掉。
            pageJobs[sessionId] = generation == pageGeneration ? next : nil
        }
    }

    /// 关窗口时忘掉已结束的结果（下次打开能从继续写的对话重新整理）；进行中的留着。
    func forgetFinishedPage(sessionId: String) {
        if pageJobs[sessionId] != .working { pageJobs[sessionId] = nil }
    }

    /// 换身份（登录 / 退出）时清掉已结束的结果（别的身份的笔记打不开）。进行中的留着、直到它结束：
    /// 这期间又登回同一个账号时，同一个聊天不会再发一次（重复建笔记、多扣一次额度）。
    func clearPageJobs() {
        pageGeneration += 1
        pageJobs = pageJobs.filter { $0.value == .working }
    }

    nonisolated static func key(_ sessionId: String, _ messageId: String) -> String {
        "\(sessionId)\n\(messageId)"
    }
}

/// 「整理成笔记」的状态（网页 CreatePageJob）。
enum CreatePageJob: Equatable, Sendable {
    case working
    case done(pageId: String, title: String, partial: Bool)
    /// [message] 是英文原句（服务端的，或网页的兜底句），界面经系统文词典翻译。
    case failed(message: String)
}

/// 网页 createPageErrorMessage 的兜底句。
let CREATE_PAGE_FAILED = "Could not create a page from this chat. Try again."

/// 网页 createPageErrorMessage：只有上限（429）、校验（400 / 413）的服务端原句照样显示；会话不存在（404）是 "Session not found."；
/// 其余（5xx、网络错误、回复不对）都是通用的兜底句。
func createPageErrorMessage(_ error: Error) -> String {
    guard let api = error as? ApiException else { return CREATE_PAGE_FAILED }
    if [400, 413, 429].contains(api.status), let message = api.serverMessage() { return message }
    if api.status == 404 { return "Session not found." }
    return CREATE_PAGE_FAILED
}
