import Foundation

/// 侧栏里改一篇没打开的笔记的图标（网页 use-note-pages.ts 的 changeIcon：`PUT /api/pages/:id/icon {icon}`，nil 是去掉）。
/// 服务端会把笔记的版本号加一；打开着的笔记要走编辑器自己的保存，不走这里。
protocol NoteIconBackend {
    func setNoteIcon(id: String, icon: String?) async throws -> NotePageSummary
}

final class NoteIconApi: NoteIconBackend, @unchecked Sendable {
    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func setNoteIcon(id: String, icon: String?) async throws -> NotePageSummary {
        let body: JSONValue = ["icon": ApiJson.string(icon)]
        return try await http.send(
            try http.request("PUT", "/api/pages/\(ApiUrl.encode(id))/icon", json: body), as: PageResponse.self
        ).page
    }
}
