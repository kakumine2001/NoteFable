import Foundation

/// 检索范围（网页 src/types/search.ts 的 SEARCH_SCOPES）。
enum SearchScope: String, CaseIterable, Sendable {
    case all
    case chats
    case notes

    /// 请求里 `scope=` 的值。
    var wire: String { rawValue }
}

struct NoteSearchResult: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String = ""
    var icon: String? = nil
    var snippet: String = ""
    /// 命中的块；只命中标题时为 nil。
    var blockId: String? = nil
    var updatedAt: String = ""
}

extension NoteSearchResult: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), title: try f.or("title", ""), icon: try f.opt("icon"), snippet: try f.or("snippet", ""),
            blockId: try f.opt("blockId"), updatedAt: try f.or("updatedAt", "")
        )
    }
}

struct ChatSearchResult: Encodable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String = ""
    var icon: String? = nil
    /// 命中的消息（或其附件）的摘录；只命中标题时为空。
    var snippet: String = ""
    var messageId: String? = nil
    /// USER / ASSISTANT。
    var role: String? = nil
    /// 摘录来自附件正文时的文件名。
    var attachmentName: String? = nil
    var projectId: String? = nil
    var titleMatch: Bool = false
    var updatedAt: String = ""
}

extension ChatSearchResult: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(
            id: try f.req("id"), title: try f.or("title", ""), icon: try f.opt("icon"), snippet: try f.or("snippet", ""),
            messageId: try f.opt("messageId"), role: try f.opt("role"), attachmentName: try f.opt("attachmentName"),
            projectId: try f.opt("projectId"), titleMatch: try f.or("titleMatch", false), updatedAt: try f.or("updatedAt", "")
        )
    }
}

struct SearchResponse: Encodable, Equatable, Sendable {
    var query: String = ""
    var notes: [NoteSearchResult] = []
    var chats: [ChatSearchResult] = []
}

extension SearchResponse: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        self.init(query: try f.or("query", ""), notes: try f.or("notes", []), chats: try f.or("chats", []))
    }
}

/// 聊天和笔记的横断检索：`GET /api/search?q=&scope=&projectId=`（和网页 search-dialog.tsx 同一个接口）。
protocol SearchBackend {
    func search(query: String, scope: SearchScope, projectId: String?) async throws -> SearchResponse
}

final class SearchApi: SearchBackend, @unchecked Sendable {
    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func search(query: String, scope: SearchScope, projectId: String?) async throws -> SearchResponse {
        var path = "/api/search?q=" + ApiUrl.encode(query) + "&scope=" + scope.wire
        if let projectId, !projectId.isEmpty { path += "&projectId=" + ApiUrl.encode(projectId) }
        return try await http.getJson(path)
    }
}
