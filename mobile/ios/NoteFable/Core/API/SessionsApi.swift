import Foundation

/// 聊天的整理操作（侧栏的置顶、改名、移到项目、删除、拖动排序，以及在项目里新建聊天）。
/// 和网页 `/app` 用同一组接口：`PATCH / DELETE /api/sessions/:id`、`POST /api/sessions`、`POST /api/sessions/reorder`。
protocol SessionsBackend {
    /// 只改不是 nil 的字段；[project] 用 [ProjectChange] 区分"不改"和"移出项目（nil）"。
    /// 协议方法不能有默认参数，不改的项要写 nil（不另加带默认值的同名重载：假实现漏写时会变成自己调自己）。
    func updateSession(id: String, title: String?, pinned: Bool?, project: ProjectChange?) async throws
    func deleteSession(id: String) async throws

    /// 新建一个空聊天（标题 "New chat"）；[projectId] 不为空时直接建在那个项目里。
    func createSession(projectId: String?) async throws -> SessionSummary

    /// 把 [id] 移到 [targetId] 的前面或后面；跨组时服务端顺便改它的项目和置顶。返回所有聊天的新位置。
    func reorderSession(id: String, targetId: String, after: Bool) async throws -> [SessionOrderUpdate]
}

/// PATCH 里的 projectId：nil 表示移出项目（"无项目"）。
struct ProjectChange: Equatable, Sendable {
    var projectId: String?

    init(projectId: String?) {
        self.projectId = projectId
    }
}

struct SessionOrderUpdate: Equatable, Sendable {
    var id: String
    var position: Int
    // 只有被移动的那一条带这两个字段。
    var pinned: Bool? = nil
    var projectId: String? = nil
    /// 响应里有没有 projectId 字段（null 本身也是有效值：移出项目）。
    var movedGroup: Bool = false
}

extension SessionOrderUpdate: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), position: try f.req("position"), pinned: try f.opt("pinned"),
            projectId: try f.opt("projectId"), movedGroup: f.has("projectId")
        )
    }
}

final class SessionsApi: SessionsBackend, @unchecked Sendable {
    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func updateSession(id: String, title: String?, pinned: Bool?, project: ProjectChange?) async throws {
        var fields: [String: JSONValue] = [:]
        if let title { fields["title"] = .string(title) }
        if let pinned { fields["pinned"] = .bool(pinned) }
        if let project { fields["projectId"] = ApiJson.string(project.projectId) }
        let _: JsonObjectResponse = try await http.send(try http.request("PATCH", url(id), json: .object(fields)))
    }

    /// 改聊天图标（`PATCH /api/sessions/:id {icon}`，nil 是去掉）。和网页 saveSessionIcon 一样只回报成败，
    /// 失败时界面退回原来的图标并提示。任务被取消时抛 CancellationError。
    func updateSessionIcon(id: String, icon: String?) async throws -> Bool {
        do {
            let body: JSONValue = ["icon": ApiJson.string(icon)]
            let _: JsonObjectResponse = try await http.send(try http.request("PATCH", url(id), json: body))
            return true
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            return false
        }
    }

    func deleteSession(id: String) async throws {
        let _: JsonObjectResponse = try await http.send(try http.request("DELETE", url(id)))
    }

    func createSession(projectId: String?) async throws -> SessionSummary {
        var fields: [String: JSONValue] = [:]
        if let projectId { fields["projectId"] = .string(projectId) }
        return try await http.send(try http.request("POST", "/api/sessions", json: .object(fields)), as: CreatedSession.self).session
    }

    func reorderSession(id: String, targetId: String, after: Bool) async throws -> [SessionOrderUpdate] {
        let body: JSONValue = ["id": .string(id), "targetId": .string(targetId), "after": .bool(after)]
        let response: JSONValue = try await http.send(try http.request("POST", "/api/sessions/reorder", json: body))
        guard case .object = response else { throw URLError(.cannotParseResponse) }
        return Self.parseOrderUpdates(response)
    }

    private func url(_ id: String) -> String {
        "/api/sessions/" + ApiUrl.encode(id)
    }

    /// `{items:[{id, position, pinned?, projectId?}]}`。projectId 可能是 null（移到 Chats），所以要看字段在不在。格式不对的项跳过。
    static func parseOrderUpdates(_ response: JSONValue) -> [SessionOrderUpdate] {
        guard let items = response["items"]?.arrayValue else { return [] }
        return items.compactMap { item in
            guard case .object = item else { return nil }
            return try? NoteFableJson.decodeFromJsonElement(SessionOrderUpdate.self, item)
        }
    }
}

private struct CreatedSession: Decodable {
    let session: SessionSummary

    init(from decoder: Decoder) throws {
        session = try DtoFields(decoder).req("session")
    }
}
