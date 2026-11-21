import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// 请求体：内存里的字节，或一个本地文件（上传附件时边读边传，不整个读进内存）。
enum HTTPBody: Equatable, Sendable {
    case data(Data)
    case file(URL)
}

/// 超时（秒）。nil 表示不限。对应 Android 的三个 OkHttp 客户端（NoteFableHttp.kt）。
struct HTTPTimeout: Equatable, Sendable {
    /// 多久没有任何进展就算超时（OkHttp 的 read / write timeout）。
    var idle: TimeInterval?
    /// 整个请求最多多久（OkHttp 的 call timeout）。
    var total: TimeInterval?

    /// 普通请求：30 秒没动静或总共 60 秒。
    static let standard = HTTPTimeout(idle: 30, total: 60)
    /// 流式回答、生成图片：思考型模型可能很久没有任何输出，不设超时，靠取消结束。
    static let streaming = HTTPTimeout(idle: nil, total: nil)
    /// 上传：大文件在手机网络上可能传一分多钟，不设总超时，只要求一直有进展。
    static let upload = HTTPTimeout(idle: 60, total: nil)
}

/// 一次 HTTP 请求。请求头的名字不分大小写，[setHeader] 会替换掉同名的。
struct HTTPRequest: Equatable, Sendable {
    var method: String
    var url: URL
    private(set) var headers: [String: String] = [:]
    var body: HTTPBody?
    var timeout: HTTPTimeout
    /// 3xx 时要不要跟着跳（由 NoteFableHttp 自己跟，见那里的说明）。
    var followRedirects: Bool

    init(
        method: String = "GET",
        url: URL,
        headers: [String: String] = [:],
        body: HTTPBody? = nil,
        timeout: HTTPTimeout = .standard,
        followRedirects: Bool = true
    ) {
        self.method = method
        self.url = url
        self.body = body
        self.timeout = timeout
        self.followRedirects = followRedirects
        for (name, value) in headers { setHeader(name, value) }
    }

    func header(_ name: String) -> String? {
        let wanted = name.lowercased()
        return headers.first { $0.key.lowercased() == wanted }?.value
    }

    /// 设置请求头；[value] 为 nil 时删掉。
    mutating func setHeader(_ name: String, _ value: String?) {
        let wanted = name.lowercased()
        for key in headers.keys where key.lowercased() == wanted { headers[key] = nil }
        if let value { headers[name] = value }
    }
}

/// 流式响应：响应头先到，正文一块一块给。[cancel] 取消底层的网络请求（读完以后再调没有作用）；
/// 读 [body] 的任务被取消时也会取消请求。
struct HTTPStreamResponse: Sendable {
    let response: HTTPURLResponse
    let body: AsyncThrowingStream<Data, Error>
    let cancel: @Sendable () -> Void

    init(response: HTTPURLResponse, body: AsyncThrowingStream<Data, Error>, cancel: @escaping @Sendable () -> Void = {}) {
        self.response = response
        self.body = body
        self.cancel = cancel
    }
}

/// 最底层的网络传输。正式实现是 [URLSessionTransport]，单元测试换成记录请求、回放应答的假实现。
///
/// 这一层不管 Cookie、不跟重定向、不加默认请求头：这些都在 [NoteFableHttp] 里做，
/// 所以假的传输层也能测到，而且 iOS 和 Linux 上的行为相同。调用方的任务被取消时要取消底层请求并抛 `CancellationError`。
protocol HTTPTransport: Sendable {
    /// 普通请求：整个响应读完后返回（不论状态码）。
    func send(_ request: HTTPRequest) async throws -> (Data, HTTPURLResponse)

    /// 流式响应（`POST /api/chat` 的 SSE、文件下载）：响应头到了就返回。
    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse

    /// 上传：[onProgress] 收到已发送和总共的字节数，在后台线程上调用。
    func upload(
        _ request: HTTPRequest,
        onProgress: @escaping @Sendable (_ sent: Int64, _ total: Int64) -> Void
    ) async throws -> (Data, HTTPURLResponse)
}

extension HTTPURLResponse {
    /// 按名字读响应头，不分大小写（Linux 的 Foundation 保留服务端发来的大小写，HTTP/2 下全是小写）。
    func header(_ name: String) -> String? {
        let wanted = name.lowercased()
        for (key, value) in allHeaderFields {
            if let key = key as? String, key.lowercased() == wanted { return value as? String }
        }
        return nil
    }

    var isSuccessful: Bool { (200..<300).contains(statusCode) }
}
