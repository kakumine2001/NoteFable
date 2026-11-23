import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// 服务端返回了错误（含「今日次数已用完」这类业务错误）。[message] 是服务端的英文原句，
/// 显示前用 SystemText 翻译；读不到错误文时是 "HTTP <status>"。
/// [code]、[tier]、[kind] 来自错误 JSON（目前只有 429 的使用上限：`{error, code: "usage_limit", tier, kind}`，
/// 见 `src/lib/usage-limits.ts`）。
struct ApiException: Error, Equatable, Sendable {
    let status: Int
    let message: String
    let code: String?
    let tier: String?
    let kind: String?
    /// 容量上限（413 storage_limit）时的已用量和上限（字节）。
    let used: Int?
    let limit: Int?

    init(status: Int, message: String, code: String? = nil, tier: String? = nil, kind: String? = nil, used: Int? = nil, limit: Int? = nil) {
        self.status = status
        self.message = message
        self.code = code
        self.tier = tier
        self.kind = kind
        self.used = used
        self.limit = limit
    }

    static let USAGE_LIMIT_CODE = "usage_limit"
    static let STORAGE_LIMIT_CODE = "storage_limit"

    /// 当日使用次数已用完（`src/lib/usage-plans.ts` 的 USAGE_LIMIT_CODE）。
    var isUsageLimit: Bool { status == 429 && code == Self.USAGE_LIMIT_CODE }

    /// 文件存储空间不够，新的上传被拒绝（`src/lib/usage-plans.ts` 的 STORAGE_LIMIT_CODE）。
    var isStorageLimit: Bool { status == 413 && code == Self.STORAGE_LIMIT_CODE && used != nil && limit != nil }

    /// 存储空间不够时的档位和用量；别的错误是 nil。
    var storageLimitInfo: StorageLimitInfo? {
        guard isStorageLimit, let used, let limit else { return nil }
        return StorageLimitInfo(tier: tier ?? "guest", used: used, limit: limit)
    }

    /// 按错误响应的状态码和正文构造。正文不是 JSON 或没有 `error` 时退回 "HTTP <status>"。
    static func from(status: Int, body: String) -> ApiException {
        let error = try? NoteFableJson.decodeFromString(ApiError.self, body)
        let sentence = error?.error.flatMap { ApiText.isBlank($0) ? nil : $0 }
        return ApiException(
            status: status, message: sentence ?? "HTTP \(status)", code: error?.code, tier: error?.tier, kind: error?.kind,
            used: error?.used, limit: error?.limit
        )
    }

    static func from(status: Int, body: Data) -> ApiException {
        from(status: status, body: String(decoding: body, as: UTF8.self))
    }
}

extension ApiException: LocalizedError {
    var errorDescription: String? { message }
}

/// Kotlin 接口里"默认抛 UnsupportedOperationException"的方法在这边的对应（测试用的假实现不必每个都写）。
struct UnsupportedOperationError: Error, Equatable, Sendable {}

/// 文字的小工具，对应 Kotlin 的 isBlank / trim（按 Unicode 空白，换行也算）。
enum ApiText {
    static func trim(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func isBlank(_ text: String) -> Bool {
        trim(text).isEmpty
    }
}

enum ApiUrl {
    /// 放进路径或查询串的值。保留的字符和 Android 的 `URLEncoder.encode` 相同（字母、数字和 `.-*_`），
    /// 其余按 UTF-8 写成 %XX；空格写成 %20（URLEncoder 写成 +，在路径里那是加号本身）。
    static func encode(_ value: String) -> String {
        var out = ""
        out.reserveCapacity(value.utf8.count)
        for byte in value.utf8 {
            switch byte {
            case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"),
                 UInt8(ascii: "0")...UInt8(ascii: "9"),
                 UInt8(ascii: "."), UInt8(ascii: "-"), UInt8(ascii: "*"), UInt8(ascii: "_"):
                out.unicodeScalars.append(Unicode.Scalar(byte))
            default:
                out.append("%")
                out.append(hexDigits[Int(byte >> 4)])
                out.append(hexDigits[Int(byte & 0x0f)])
            }
        }
        return out
    }

    private static let hexDigits = Array("0123456789ABCDEF")
}

/// NoteFableApi 共用的 HTTP 部分：默认请求头、身份闸门、Cookie、重定向、JSON 请求和错误转换。
/// 拆出来是为了让各个接口文件（聊天、笔记、搜索……）都能用同一套，而不是都往 NoteFableApi 里加。
///
/// 一次请求的流程（Android 这几步分别在 OkHttp 的拦截器、CookieJar 和它自己的重定向里）：
/// 1. 加 `User-Agent` 和 `Accept-Language`；
/// 2. 过 [IdentityGate]：身份没确定时本站的请求一个一个走；
/// 3. 从 [CookieStore] 取这个地址的 Cookie 放进请求头，交给 [HTTPTransport]；
/// 4. 响应头回来就把 Set-Cookie 存进 [CookieStore]；
/// 5. 3xx 且有 Location 时回到第 3 步发新地址（Cookie 按新地址重新取，不会带到别的站）。
final class NoteFableHttp: @unchecked Sendable {
    static let USER_AGENT = "NoteFableNative/0.1 (iOS)"
    static let JSON = "application/json; charset=utf-8"
    private static let MAX_REDIRECTS = 20

    let baseUrl: String
    let cookieStore: CookieStore
    let identityGate: IdentityGate
    private let transport: HTTPTransport
    private let acceptLanguage: @Sendable () -> String

    /// [acceptLanguage]：每次请求时取 `Accept-Language` 的值，和界面语言一致（Android 的 AppLanguage.acceptLanguage），
    /// 服务端按它决定语言的地方与网页相同。
    init(
        baseUrl: String,
        transport: HTTPTransport,
        cookieStore: CookieStore,
        acceptLanguage: @escaping @Sendable () -> String
    ) {
        self.baseUrl = baseUrl
        self.transport = transport
        self.cookieStore = cookieStore
        self.acceptLanguage = acceptLanguage
        identityGate = IdentityGate(host: URL(string: baseUrl)?.host ?? "")
    }

    func absoluteUrl(_ path: String) -> String {
        path.hasPrefix("http://") || path.hasPrefix("https://") ? path : baseUrl + path
    }

    // MARK: - 组请求

    /// 组一个请求。[json] 不为空时作为 JSON 请求体；POST / PUT / PATCH 没有 [json] 时带一个空请求体（Content-Length: 0）。
    func request(
        _ method: String = "GET",
        _ path: String,
        json: JSONValue? = nil,
        timeout: HTTPTimeout = .standard
    ) throws -> HTTPRequest {
        guard let url = URL(string: absoluteUrl(path)) else { throw URLError(.badURL) }
        var request = HTTPRequest(method: method, url: url, timeout: timeout)
        if let json {
            request.body = .data(Data(json.encodedString().utf8))
            request.setHeader("Content-Type", Self.JSON)
        } else if method == "POST" || method == "PUT" || method == "PATCH" {
            request.body = .data(Data())
        }
        return request
    }

    // MARK: - JSON

    /// 发请求并把 2xx 的 JSON 解析成 [T]；其它状态码抛 [ApiException]。
    func send<T: Decodable>(_ request: HTTPRequest, as type: T.Type = T.self) async throws -> T {
        try NoteFableJson.decode(T.self, from: try await sendForData(request))
    }

    func getJson<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try await send(try request("GET", path))
    }

    /// 2xx 的正文原样返回；其它状态码抛 [ApiException]（带服务端的错误文字）。
    func sendForData(_ request: HTTPRequest) async throws -> Data {
        var request = request
        request.setHeader("Accept", "application/json")
        let (data, response) = try await execute(request)
        guard response.isSuccessful else { throw ApiException.from(status: response.statusCode, body: data) }
        return data
    }

    // MARK: - 原始请求

    /// 普通请求：整个响应读完后返回，不论状态码。
    func execute(_ request: HTTPRequest) async throws -> (Data, HTTPURLResponse) {
        try await exchange(request, response: { $0.1 }, discard: { _ in }) { try await self.transport.send($0) }
    }

    /// 上传：[onProgress] 收到已发送和总共的字节数，在后台线程上调用。
    func executeUpload(
        _ request: HTTPRequest,
        onProgress: @escaping @Sendable (_ sent: Int64, _ total: Int64) -> Void
    ) async throws -> (Data, HTTPURLResponse) {
        try await exchange(request, response: { $0.1 }, discard: { _ in }) {
            try await self.transport.upload($0, onProgress: onProgress)
        }
    }

    /// 流式：响应头到了就返回（身份闸门也在这时放开，不等正文读完）。
    func executeStream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        try await exchange(request, response: { $0.response }, discard: { $0.cancel() }) {
            try await self.transport.stream($0)
        }
    }

    private func exchange<R>(
        _ original: HTTPRequest,
        response: (R) -> HTTPURLResponse,
        discard: (R) -> Void,
        _ call: (HTTPRequest) async throws -> R
    ) async throws -> R {
        var first = original
        first.setHeader("User-Agent", Self.USER_AGENT)
        first.setHeader("Accept-Language", acceptLanguage())
        let prepared = first
        return try await identityGate.run(for: prepared.url) {
            var current = prepared
            var redirects = 0
            while true {
                current.setHeader("Cookie", cookieStore.cookieHeader(for: current.url))
                let result = try await call(current)
                let head = response(result)
                cookieStore.saveFromResponse(head, for: current.url)
                guard original.followRedirects, redirects < Self.MAX_REDIRECTS,
                      let next = Self.redirect(from: current, response: head) else { return result }
                discard(result)
                current = next
                redirects += 1
            }
        }
    }

    /// 3xx 之后要发的请求（规则同 OkHttp）：307 / 308 保留方法和请求体，其余换成 GET；跳到别的站时去掉 Authorization。
    /// 不是重定向、没有 Location 或地址读不懂时返回 nil（把这个响应原样交回去）。
    static func redirect(from request: HTTPRequest, response: HTTPURLResponse) -> HTTPRequest? {
        guard [300, 301, 302, 303, 307, 308].contains(response.statusCode),
              let location = response.header("Location"),
              let target = URL(string: location, relativeTo: request.url)?.absoluteURL,
              let scheme = target.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
        var next = request
        next.url = target
        let keepsBody = response.statusCode == 307 || response.statusCode == 308
        if !keepsBody, request.method != "GET", request.method != "HEAD" {
            next.method = "GET"
            next.body = nil
            next.setHeader("Content-Type", nil)
            next.setHeader("Content-Length", nil)
            next.setHeader("Transfer-Encoding", nil)
        }
        let sameSite = target.scheme?.lowercased() == request.url.scheme?.lowercased()
            && target.host?.lowercased() == request.url.host?.lowercased()
            && target.port == request.url.port
        if !sameSite { next.setHeader("Authorization", nil) }
        return next
    }
}
