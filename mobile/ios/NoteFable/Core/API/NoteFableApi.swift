import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// 发给 `/api/chat` 的一次提问。字段名与网页端的 FormData 一致。
struct ChatRequest: Equatable, Sendable {
    var message: String
    var sessionId: String? = nil
    var model: String? = nil
    var reasoning: String? = nil
    var webSearch: String = "auto"
    /// 已上传附件的凭证（`uploads` 字段，JSON 数组）。
    var uploads: [String] = []
    /// 添加的笔记 ID（`pages` 字段，JSON 数组；没有时不发）。正文由服务端每次发送时重新读取。
    var pages: [String] = []
    /// 编辑自己的提问：要改写的那条提问的 ID（`edit` 字段），[message] 是新的文字。原来的版本留在服务端。
    var edit: String? = nil
    /// 重新生成回答：要重做的那条回答的 ID（`regenerate` 字段）。不发 `message`。
    var regenerate: String? = nil
}

/// 组 JSON 请求体时用的小工具。
enum ApiJson {
    /// nil 写成 JSON 的 null（不是不写这个键）。
    static func string(_ value: String?) -> JSONValue {
        value.map(JSONValue.string) ?? .null
    }

    static func strings(_ values: [String]) -> JSONValue {
        .array(values.map(JSONValue.string))
    }
}

/// 聊天、附件、笔记、账号的服务端接口（Android 的 NoteFableApi.kt）。其它接口（侧栏、项目、搜索、导出……）在各自的
/// `…Api` 里，共用这里的 [http]。
final class NoteFableApi: ChatBackend, AccountBackend, NotesBackend, @unchecked Sendable {
    static let USER_AGENT = NoteFableHttp.USER_AGENT

    // Vercel Blob 的上传接口和协议版本，取自网页使用的 @vercel/blob 客户端；升级那个包时一起核对。
    private static let BLOB_API = "https://vercel.com/api/blob"
    private static let BLOB_API_VERSION = "12"

    let http: NoteFableHttp
    private let baseUrl: String
    private let cookieStore: CookieStore
    private let openFile: @Sendable (String) throws -> HTTPBody

    /// 身份没确定前只放一个请求（见 [IdentityGate]）；所有请求都经过 [http]，都经过它。
    var identityGate: IdentityGate { http.identityGate }

    /// - Parameters:
    ///   - cookieStore: 身份所在的 Cookie 存储（App 里是 [PersistentCookieJar]）。
    ///   - transport: 网络传输；测试里换成假的。
    ///   - acceptLanguage: 每次请求的 `Accept-Language`，和界面语言一致。
    ///   - openFile: 按 [LocalFile.uri] 给出要上传的内容（文件地址或字节）。由 App 提供，单元测试里不需要。
    init(
        baseUrl: String,
        cookieStore: CookieStore,
        transport: HTTPTransport = URLSessionTransport(),
        acceptLanguage: @escaping @Sendable () -> String,
        openFile: @escaping @Sendable (String) throws -> HTTPBody = { _ in throw URLError(.fileDoesNotExist) }
    ) {
        self.baseUrl = baseUrl
        self.cookieStore = cookieStore
        self.openFile = openFile
        http = NoteFableHttp(baseUrl: baseUrl, transport: transport, cookieStore: cookieStore, acceptLanguage: acceptLanguage)
    }

    func absoluteUrl(_ path: String) -> String {
        http.absoluteUrl(path)
    }

    func sessions() async throws -> [SessionSummary] {
        try await http.getJson("/api/sessions", as: SessionsResponse.self).sessions
    }

    func messages(sessionId: String) async throws -> [MessageDto] {
        try await http.getJson("/api/sessions/\(segment(sessionId))/messages", as: MessagesResponse.self).messages
    }

    func models() async throws -> ModelsResponse {
        try await http.getJson("/api/models")
    }

    func streamChat(_ request: ChatRequest) -> AsyncThrowingStream<ChatStreamEvent, Error> {
        let http = self.http
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let form = Self.chatForm(request)
                    var httpRequest = try http.request("POST", "/api/chat", timeout: .streaming)
                    httpRequest.body = .data(form.encoded())
                    httpRequest.setHeader("Content-Type", form.contentType)
                    httpRequest.setHeader("Accept", "text/event-stream")

                    let stream = try await http.executeStream(httpRequest)
                    defer { stream.cancel() }
                    guard stream.response.isSuccessful else {
                        throw ApiException.from(status: stream.response.statusCode, body: try await Self.collect(stream.body))
                    }
                    continuation.yield(.started(sessionId: stream.response.header("X-Session-Id")))
                    var lines = ChatStreamLineBuffer()
                    for try await chunk in stream.body {
                        for line in lines.append(chunk) {
                            if let event = ChatStreamParser.parseLine(line) { continuation.yield(event) }
                        }
                    }
                    if let last = lines.finish(), let event = ChatStreamParser.parseLine(last) { continuation.yield(event) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            // 读的一方不要了（任务被取消）：把网络请求也取消。
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func chatForm(_ request: ChatRequest) -> MultipartBody {
        // 编辑和重新生成沿用原来那条提问的附件和笔记，不带新的（网页 rerunTurn）。
        let rerun = request.edit != nil || request.regenerate != nil
        var form = MultipartBody()
        if request.regenerate == nil { form.addFormDataPart("message", request.message) }
        if let model = request.model { form.addFormDataPart("model", model) }
        if let reasoning = request.reasoning { form.addFormDataPart("reasoning", reasoning) }
        form.addFormDataPart("webSearch", request.webSearch)
        if let sessionId = request.sessionId { form.addFormDataPart("sessionId", sessionId) }
        if !rerun { form.addFormDataPart("uploads", uploadsJson(request.uploads)) }
        if !rerun, !request.pages.isEmpty { form.addFormDataPart("pages", uploadsJson(request.pages)) }
        if let edit = request.edit { form.addFormDataPart("edit", edit) }
        if let regenerate = request.regenerate { form.addFormDataPart("regenerate", regenerate) }
        return form
    }

    private static func collect(_ body: AsyncThrowingStream<Data, Error>) async throws -> Data {
        var data = Data()
        for try await chunk in body { data.append(chunk) }
        return data
    }

    func stopSession(sessionId: String) async throws {
        let _: JsonObjectResponse = try await http.send(try http.request("POST", "/api/sessions/\(segment(sessionId))/stop"))
    }

    func showVersion(sessionId: String, messageId: String) async throws {
        let body: JSONValue = ["messageId": .string(messageId)]
        let _: JsonObjectResponse = try await http.send(
            try http.request("POST", "/api/sessions/\(segment(sessionId))/versions", json: body)
        )
    }

    func branchSession(sessionId: String, messageId: String, title: String) async throws -> SessionSummary {
        let body: JSONValue = ["messageId": .string(messageId), "title": .string(title)]
        return try await http.send(
            try http.request("POST", "/api/sessions/\(segment(sessionId))/branch", json: body), as: SessionEnvelope.self
        ).session
    }

    // MARK: - 图片生成与附件

    func generateImage(_ request: ChatRequest) async throws -> ImageResult {
        var form = MultipartBody()
        form.addFormDataPart("prompt", request.message)
        if let model = request.model { form.addFormDataPart("model", model) }
        if let reasoning = request.reasoning { form.addFormDataPart("reasoning", reasoning) }
        if let sessionId = request.sessionId { form.addFormDataPart("sessionId", sessionId) }
        form.addFormDataPart("uploads", Self.uploadsJson(request.uploads))
        // 生成一张图常常超过一分钟，和流式回答一样不设总超时，靠取消结束。
        var httpRequest = try http.request("POST", "/api/images", timeout: .streaming)
        httpRequest.body = .data(form.encoded())
        httpRequest.setHeader("Content-Type", form.contentType)
        return try await http.send(httpRequest)
    }

    func prepareUploads(_ files: [LocalFile]) async throws -> UploadPlan {
        let body: JSONValue = [
            "files": .array(files.map { file in
                ["name": .string(file.name), "type": .string(file.mimeType), "size": .number(Double(file.size))]
            }),
        ]
        let plan: UploadPlan = try await http.send(try http.request("POST", "/api/uploads", json: body))
        // 凭证和文件对不上（"Invalid upload response."）。
        guard plan.uploads.count == files.count else { throw URLError(.cannotParseResponse) }
        return plan
    }

    func uploadFile(
        slot: UploadSlot,
        mode: String,
        file: LocalFile,
        onProgress: @escaping @Sendable (Int) -> Void
    ) async throws {
        let content = try openFile(file.uri)
        var request: HTTPRequest
        if mode == "local" {
            // 本机开发服务器没有配置 Blob 时，直接把字节交给它。
            request = try http.request("PUT", "/api/uploads/local?ticket=" + ApiUrl.encode(slot.ticket))
        } else {
            // 线上：和网页的 @vercel/blob 客户端走同一套流程。先用凭证向自己的服务器换一个只能写这一个文件的令牌，
            // 再把字节直接传给 Vercel Blob（不经过服务器函数，避开 4.5 MB 的请求上限）。
            let event: JSONValue = [
                "type": "blob.generate-client-token",
                "payload": ["pathname": .string(slot.path), "clientPayload": .string(slot.ticket), "multipart": false],
            ]
            let token = try await http.send(
                try http.request("POST", "/api/uploads", json: event), as: ClientTokenResponse.self
            ).clientToken
            request = try http.request("PUT", Self.BLOB_API + "/?pathname=" + ApiUrl.encode(slot.path))
            request.setHeader("authorization", "Bearer " + token)
            request.setHeader("x-api-version", Self.BLOB_API_VERSION)
            // 令牌形如 vercel_blob_client_<storeId>_…，存储 ID 要单独放进请求头。
            let tokenParts = token.components(separatedBy: "_")
            request.setHeader("x-vercel-blob-store-id", tokenParts.count > 3 ? tokenParts[3] : "")
            request.setHeader("x-vercel-blob-access", "private")
            request.setHeader("x-content-type", file.mimeType)
            request.setHeader("x-content-length", String(file.size))
        }
        request.body = content
        request.timeout = .upload
        if !file.mimeType.isEmpty { request.setHeader("Content-Type", file.mimeType) }

        let progress = UploadProgress(total: file.size, report: onProgress)
        let (data, response) = try await http.executeUpload(request) { sent, _ in progress.sent(sent) }
        guard response.isSuccessful else { throw ApiException.from(status: response.statusCode, body: data) }
    }

    func discardUploads(_ tickets: [String]) async {
        guard !tickets.isEmpty else { return }
        let http = self.http
        // 另开一个任务：调用方多半是在失败或取消之后清理（Android 的 NonCancellable），不能跟着一起被取消。
        await Task {
            let body: JSONValue = ["uploads": ApiJson.strings(tickets)]
            guard let request = try? http.request("DELETE", "/api/uploads", json: body) else { return }
            _ = try? await http.execute(request)
        }.value
    }

    private static func uploadsJson(_ tickets: [String]) -> String {
        ApiJson.strings(tickets).encodedString()
    }

    // MARK: - 笔记（列表、项目、回收站；正文由网页的 /note-embed 编辑）

    func notes() async throws -> NotesList {
        try await http.getJson("/api/pages")
    }

    /// 新对话输入框上方的"最近编辑"：`GET /api/pages?recent=1`。
    func recentNotes() async throws -> [NotePageSummary] {
        try await http.getJson("/api/pages?recent=1", as: NotesList.self).pages
    }

    // 与网页 use-note-pages.ts 的 create()（canvas-save.ts 的 newPageBody）发送的内容相同：
    // 笔记是空的正文，白板 / 幻灯片是 { kind, title, icon }（不发 data，服务端建空的本体）。子页面不发 groupId（项目随父页面）。
    func createNote(parentId: String?, kind: PageKind, groupId: String?) async throws -> NotePageSummary {
        var fields: [String: JSONValue] = kind.isCanvas
            ? ["kind": .string(kind.wire), "title": "Untitled", "icon": .null]
            : ["title": "Untitled", "icon": .null, "cover": .null, "coverPosition": .null, "blocks": .array([])]
        if let parentId { fields["parentId"] = .string(parentId) } else if let groupId { fields["groupId"] = .string(groupId) }
        return try await http.send(try http.request("POST", "/api/pages", json: .object(fields)), as: PageResponse.self).page
    }

    func trashNote(id: String) async throws -> [String] {
        let ids = try await http.send(try http.request("DELETE", "/api/pages/\(segment(id))"), as: IdsResponse.self).ids
        return ids.isEmpty ? [id] : ids
    }

    func moveNote(id: String, groupId: String?) async throws -> [String] {
        let body: JSONValue = ["groupId": ApiJson.string(groupId)]
        let ids = try await http.send(
            try http.request("PUT", "/api/pages/\(segment(id))/group", json: body), as: IdsResponse.self
        ).ids
        return ids.isEmpty ? [id] : ids
    }

    func moveToPage(id: String, parentId: String?) async throws -> [NotePageSummary] {
        let body: JSONValue = ["parentId": ApiJson.string(parentId)]
        return try await http.send(
            try http.request("PUT", "/api/pages/\(segment(id))/parent", json: body), as: PagesResponse.self
        ).pages
    }

    func setFavorite(id: String, favorite: Bool) async throws -> NotePageSummary {
        let body: JSONValue = ["favorite": .bool(favorite)]
        return try await http.send(
            try http.request("PUT", "/api/pages/\(segment(id))/favorite", json: body), as: PageResponse.self
        ).page
    }

    func updateSettings(id: String, settings: NotePageSettings) async throws -> NotePageSummary {
        var fields: [String: JSONValue] = [:]
        if let fullWidth = settings.fullWidth { fields["fullWidth"] = .bool(fullWidth) }
        if let smallText = settings.smallText { fields["smallText"] = .bool(smallText) }
        if let font = settings.font { fields["font"] = .string(font) }
        if let locked = settings.locked { fields["locked"] = .bool(locked) }
        return try await http.send(
            try http.request("PUT", "/api/pages/\(segment(id))/settings", json: .object(fields)), as: PageResponse.self
        ).page
    }

    func getShare(id: String) async throws -> NoteShareState {
        try await http.send(
            try http.request("GET", "/api/pages/\(segment(id))/share"), as: ShareStateResponse.self
        ).share
    }

    func updateShare(id: String, patch: NoteSharePatch) async throws -> ShareUpdateResult {
        var fields: [String: JSONValue] = [:]
        if let enabled = patch.enabled { fields["enabled"] = .bool(enabled) }
        if let includeSubpages = patch.includeSubpages { fields["includeSubpages"] = .bool(includeSubpages) }
        if patch.setExpiresAt { fields["expiresAt"] = ApiJson.string(patch.expiresAt) }
        if let excludeFromParent = patch.excludeFromParent { fields["excludeFromParent"] = .bool(excludeFromParent) }
        let res = try await http.send(
            try http.request("PUT", "/api/pages/\(segment(id))/share", json: .object(fields)), as: ShareStateResponse.self
        )
        return ShareUpdateResult(share: res.share, page: res.page)
    }

    func duplicate(id: String) async throws -> DuplicateResult {
        let response = try await sendForObject(try http.request("POST", "/api/pages/\(segment(id))/duplicate"))
        guard let pageJson = response["page"] else { throw URLError(.cannotParseResponse) }
        let page = try NoteFableJson.decodeFromJsonElement(NotePageSummary.self, pageJson)
        let pages = try NoteFableJson.decodeFromJsonElement([NotePageSummary].self, response["pages"] ?? .array([]))
        return DuplicateResult(page: page, pages: pages, order: NoteOrderUpdate.parse(response))
    }

    func reorderNote(id: String, targetId: String, after: Bool) async throws -> [NoteOrderUpdate] {
        let body: JSONValue = ["id": .string(id), "targetId": .string(targetId), "after": .bool(after)]
        return NoteOrderUpdate.parse(try await sendForObject(try http.request("POST", "/api/pages/reorder", json: body)))
    }

    func createGroup(name: String) async throws -> NoteGroupSummary {
        let body: JSONValue = ["name": .string(name)]
        return try await http.send(try http.request("POST", "/api/pages/groups", json: body), as: GroupResponse.self).group
    }

    func renameGroup(id: String, name: String) async throws -> NoteGroupSummary {
        let body: JSONValue = ["name": .string(name)]
        return try await http.send(
            try http.request("PATCH", "/api/pages/groups/\(segment(id))", json: body), as: GroupResponse.self
        ).group
    }

    func deleteGroup(id: String) async throws {
        let _: JsonObjectResponse = try await http.send(try http.request("DELETE", "/api/pages/groups/\(segment(id))"))
    }

    func renameNote(id: String, title: String) async throws -> NoteIconWrite {
        let body: JSONValue = ["title": .string(title)]
        let response = try await sendForObject(try http.request("PUT", "/api/pages/\(segment(id))/title", json: body))
        guard let pageJson = response["page"], case .object = pageJson else { throw URLError(.cannotParseResponse) }
        let page = try NoteFableJson.decodeFromJsonElement(NotePageSummary.self, pageJson)
        return NoteIconWrite(page: page, json: pageJson.encodedString())
    }

    func trash() async throws -> [NoteTrashItem] {
        try await http.getJson("/api/pages/trash", as: TrashResponse.self).pages
    }

    func restoreNote(id: String) async throws -> [NotePageSummary] {
        let response = try await http.send(
            try http.request("POST", "/api/pages/trash/\(segment(id))"), as: PagesResponse.self
        )
        // 旧服务端只回 page。这一篇放在最前面。
        guard let page = response.page else { return response.pages }
        return [page] + response.pages.filter { $0.id != page.id }
    }

    func deleteForever(id: String) async throws -> [String] {
        let ids = try await http.send(
            try http.request("DELETE", "/api/pages/trash/\(segment(id))"), as: IdsResponse.self
        ).ids
        return ids.isEmpty ? [id] : ids
    }

    func emptyTrash(before: String) async throws {
        let _: JsonObjectResponse = try await http.send(
            try http.request("DELETE", "/api/pages/trash?before=" + ApiUrl.encode(before))
        )
    }

    func exportNote(id: String) async throws -> ExportedNote {
        try await http.getJson("/api/pages/\(segment(id))/export")
    }

    // 与网页 use-note-pages.ts 的 importMarkdown() 发送的内容相同。
    func importMarkdown(files: [ImportMarkdownFile], groupId: String?) async throws -> [NotePageSummary] {
        try await http.send(
            try http.request("POST", "/api/pages/import", json: noteImportBody(files, groupId: groupId)), as: PagesResponse.self
        ).pages
    }

    func noteEmbedUrl(pageId: String, lang: String?, model: String?, reasoning: String?, theme: String?, reveal: String?) -> String {
        absoluteUrl(
            "/note-embed?page=" + segment(pageId)
                + (lang.map { "&lang=" + $0 } ?? "")
                + (model.map { "&model=" + segment($0) } ?? "")
                + (reasoning.map { "&reasoning=" + segment($0) } ?? "")
                + (theme.map { "&theme=" + segment($0) } ?? "")
                + (reveal.flatMap { $0.isEmpty ? nil : "&reveal=" + segment($0) } ?? "")
        )
    }

    /// 下载笔记里的文件（`/api/pages/files?key=…`）。文件是私有的，要带 App 的 Cookie，所以不能交给系统浏览器。
    /// 拿到响应头后用文件名和类型调用 [target] 要一个保存位置，再把内容边收边写进去；中途失败时删掉写了一半的文件。
    /// 服务端出错时抛 [ApiException]。
    func downloadNoteFile(
        _ url: String,
        target: (_ name: String, _ mimeType: String) throws -> URL
    ) async throws -> NoteFileDownload {
        let request = try http.request("GET", url)
        let stream = try await http.executeStream(request)
        defer { stream.cancel() }
        guard stream.response.isSuccessful else {
            throw ApiException.from(status: stream.response.statusCode, body: try await Self.collect(stream.body))
        }
        let name = NoteFileLinks.fileName(
            contentDisposition: stream.response.header("Content-Disposition"), url: stream.response.url ?? request.url
        )
        let mimeType = Self.mediaType(stream.response.header("Content-Type")) ?? "application/octet-stream"
        let destination = try target(name, mimeType)
        guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
            throw URLError(.cannotCreateFile)
        }
        do {
            let handle = try FileHandle(forWritingTo: destination)
            defer { try? handle.close() }
            for try await chunk in stream.body { try handle.write(contentsOf: chunk) }
            // 被取消时流只是提前结束，不抛错：这里补上，免得留下半个文件还当成功。
            try Task.checkCancellation()
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
        return NoteFileDownload(name: name, mimeType: mimeType)
    }

    /// 带着 App 的 Cookie 读一个地址的全部内容（附件图片 `/api/attachments/…/image`、生成的图片）。
    /// 服务端只把它们给主人，所以图片加载要走这里（Android 让 Coil 复用同一个 OkHttp 客户端）。
    func fetchData(_ pathOrUrl: String) async throws -> (data: Data, mimeType: String?) {
        let (data, response) = try await http.execute(try http.request("GET", pathOrUrl))
        guard response.isSuccessful else { throw ApiException.from(status: response.statusCode, body: data) }
        return (data, Self.mediaType(response.header("Content-Type")))
    }

    /// Content-Type 里的 `类型/子类型`（小写，不带参数）。
    private static func mediaType(_ contentType: String?) -> String? {
        guard let contentType else { return nil }
        let type = contentType.prefix { $0 != ";" }.trimmingCharacters(in: .whitespaces).lowercased()
        return type.contains("/") ? type : nil
    }

    private func sendForObject(_ request: HTTPRequest) async throws -> JSONValue {
        let value: JSONValue = try await http.send(request)
        guard case .object = value else { throw URLError(.cannotParseResponse) }
        return value
    }

    private func segment(_ id: String) -> String {
        ApiUrl.encode(id)
    }

    // MARK: - 账号

    func account() async throws -> AccountResponse {
        try await http.getJson("/api/account")
    }

    func nativeSignInNonce() async throws -> String {
        try await http.send(try http.request("POST", "/api/native-auth/nonce"), as: NonceResponse.self).nonce
    }

    func nativeSignIn(idToken: String) async throws {
        let body: JSONValue = ["idToken": .string(idToken)]
        let _: ApiError = try await http.send(try http.request("POST", "/api/native-auth/google", json: body))
        identityGate.reset()
    }

    func emailSignInStart(email: String, locale: String) async throws {
        let body: JSONValue = ["email": .string(email), "locale": .string(locale)]
        let _: ApiError = try await http.send(try http.request("POST", "/api/auth/email/start", json: body))
    }

    func emailSignInVerify(email: String, code: String) async throws {
        let body: JSONValue = ["email": .string(email), "code": .string(code)]
        let _: ApiError = try await http.send(try http.request("POST", "/api/auth/email/verify", json: body))
        identityGate.reset()
    }

    func deleteAccount() async throws {
        let _: ApiError = try await http.send(try http.request("DELETE", "/api/account"))
        // 服务端已经用过期的 Set-Cookie 删掉了登录 Cookie，这里再删一次本地的。设备 Cookie 留着（和网页一样，见 DELETE /api/account）。
        cookieStore.removeWhere { $0.name.contains("authjs.") }
        identityGate.reset()
    }

    // 和网页的 next-auth signOut() 一样走 Auth.js 的 CSRF 流程；无论服务端是否成功，都删掉本地的会话 Cookie，
    // 会话是 JWT、服务端不存状态，本地删掉就等于退出。
    func signOut() async throws {
        defer {
            cookieStore.removeWhere { $0.name.contains("authjs.session-token") }
            // 设备 Cookie 指向的是已绑定 Google 的用户，服务端会给下一个请求签发新的匿名身份：让它单独走。
            identityGate.reset()
        }
        let csrf = try await http.getJson("/api/auth/csrf", as: CsrfResponse.self).csrfToken
        var request = try http.request("POST", "/api/auth/signout")
        request.body = .data(Data("csrfToken=\(ApiUrl.encode(csrf))&callbackUrl=\(ApiUrl.encode(baseUrl))".utf8))
        request.setHeader("Content-Type", "application/x-www-form-urlencoded")
        // 服务端回 302 跳到 callbackUrl（首页）。删 Cookie 的 Set-Cookie 就在这个 302 上，不用再去读首页。
        request.followRedirects = false
        _ = try await http.execute(request)
    }
}

private struct SessionEnvelope: Decodable {
    let session: SessionSummary

    init(from decoder: Decoder) throws {
        session = try DtoFields(decoder).req("session")
    }
}

/// 把已发送的字节数换成 0...100 的百分比，数值变了才报告（回调在 URLSession 的后台队列上）。
private final class UploadProgress: @unchecked Sendable {
    private let lock = NSLock()
    private var last = -1
    private let total: Int
    private let report: @Sendable (Int) -> Void

    init(total: Int, report: @escaping @Sendable (Int) -> Void) {
        self.total = total
        self.report = report
    }

    func sent(_ bytes: Int64) {
        let percent = total > 0 ? Int(min(100, max(0, bytes * 100 / Int64(total)))) : 0
        let changed: Bool = lock.withLock {
            guard percent != last else { return false }
            last = percent
            return true
        }
        if changed { report(percent) }
    }
}
