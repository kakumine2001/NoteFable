import Foundation

/// 侧栏里改一篇没打开的笔记的图标（网页 use-note-pages.ts 的 changeIcon：`PUT /api/pages/:id/icon {icon}`，nil 是去掉）。
/// 服务端会把笔记的版本号加一；打开着的笔记要走编辑器自己的保存，不走这里。
protocol NoteIconBackend {
    func setNoteIcon(id: String, icon: String?) async throws -> NotePageSummary
    /// 同 `setNoteIcon`，另外带回服务端返回的整篇页面 JSON（含正文），交给常驻 WebView 的缓存（`pageUpdated`），
    /// 否则下次从缓存打开这一篇时还是改图标之前的版本，一编辑就 409。拿不到时 json 是 nil。
    func setNoteIconWithPage(id: String, icon: String?) async throws -> NoteIconWrite
}

struct NoteIconWrite: Sendable {
    var page: NotePageSummary
    var json: String?
}

extension NoteIconBackend {
    func setNoteIconWithPage(id: String, icon: String?) async throws -> NoteIconWrite {
        NoteIconWrite(page: try await setNoteIcon(id: id, icon: icon), json: nil)
    }
}

final class NoteIconApi: NoteIconBackend, @unchecked Sendable {
    private let http: NoteFableHttp

    init(http: NoteFableHttp) {
        self.http = http
    }

    func setNoteIcon(id: String, icon: String?) async throws -> NotePageSummary {
        try await setNoteIconWithPage(id: id, icon: icon).page
    }

    func setNoteIconWithPage(id: String, icon: String?) async throws -> NoteIconWrite {
        let body: JSONValue = ["icon": ApiJson.string(icon)]
        let data = try await http.sendForData(try http.request("PUT", "/api/pages/\(ApiUrl.encode(id))/icon", json: body))
        let page = try NoteFableJson.decode(PageResponse.self, from: data).page
        let raw = JSONValue.parse(data)?["page"]
        var json: String?
        if let raw, case .object = raw { json = raw.encodedString() }
        return NoteIconWrite(page: page, json: json)
    }
}
