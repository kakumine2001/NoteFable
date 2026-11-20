import Foundation

/// 聊天项目（侧栏的 Projects 和项目设置窗口）。和网页 `/app` 用同一组接口：
/// `GET / POST /api/chat-projects`、`GET / PATCH / DELETE /api/chat-projects/:id`；参考笔记的候选来自 `GET /api/pages`。
protocol ProjectsBackend {
    func projects() async throws -> [ChatProjectSummary]
    func createProject(name: String) async throws -> ChatProjectSummary
    func renameProject(id: String, name: String) async throws -> ChatProjectSummary
    func deleteProject(id: String) async throws
    func projectDetail(id: String) async throws -> ChatProjectDetail

    /// 只发改了的字段（网页 ChatProjectSettings.save）；noteIds 是整体替换。
    func updateProjectSettings(id: String, instructions: String?, noteIds: [String]?) async throws -> ChatProjectSummary

    /// 参考笔记的候选：用户的全部笔记（与笔记列表同一个接口）。
    func notesForPicker() async throws -> [NotePageSummary]
}

final class ProjectsApi: ProjectsBackend, @unchecked Sendable {
    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func projects() async throws -> [ChatProjectSummary] {
        try await http.getJson("/api/chat-projects", as: ChatProjectsResponse.self).projects
    }

    func createProject(name: String) async throws -> ChatProjectSummary {
        let body: JSONValue = ["name": .string(name)]
        return try await http.send(try http.request("POST", "/api/chat-projects", json: body), as: ChatProjectResponse.self).project
    }

    func renameProject(id: String, name: String) async throws -> ChatProjectSummary {
        let body: JSONValue = ["name": .string(name)]
        return try await http.send(try http.request("PATCH", url(id), json: body), as: ChatProjectResponse.self).project
    }

    func deleteProject(id: String) async throws {
        let _: JsonObjectResponse = try await http.send(try http.request("DELETE", url(id)))
    }

    func projectDetail(id: String) async throws -> ChatProjectDetail {
        try await http.send(try http.request("GET", url(id)), as: ChatProjectDetailResponse.self).project
    }

    func updateProjectSettings(id: String, instructions: String?, noteIds: [String]?) async throws -> ChatProjectSummary {
        var fields: [String: JSONValue] = [:]
        if let instructions { fields["instructions"] = .string(instructions) }
        if let noteIds { fields["noteIds"] = ApiJson.strings(noteIds) }
        return try await http.send(
            try http.request("PATCH", url(id), json: .object(fields)), as: ChatProjectResponse.self
        ).project
    }

    func notesForPicker() async throws -> [NotePageSummary] {
        try await http.getJson("/api/pages", as: NotesList.self).pages
    }

    private func url(_ id: String) -> String {
        "/api/chat-projects/" + ApiUrl.encode(id)
    }
}
