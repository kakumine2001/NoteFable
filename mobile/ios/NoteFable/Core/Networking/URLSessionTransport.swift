import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// 正式的传输层：一个 URLSession，所有回调走 delegate，再用 continuation 包成 async。
///
/// 不用 `URLSession.bytes` / `data(for:)`：Linux 的 Foundation 没有，而 Core 要在 Linux 上编译和测试。
/// 这个 URLSession 不碰 Cookie（`HTTPCookieStorage.shared` 也不用）、不缓存、不跟重定向：
/// Cookie 和重定向由 [NoteFableHttp] 处理，身份只存在 App 自己的 [CookieStore] 里。
final class URLSessionTransport: NSObject, HTTPTransport, @unchecked Sendable {
    /// "不设超时"：URLSession 没有无限大，给一个用不到的长度（Linux 的实现把它换算成整数毫秒，不能用 infinity）。
    private static let noTimeout: TimeInterval = 7 * 24 * 3600

    private let lock = NSLock()
    /// 进行中的请求，按 taskIdentifier。只在 lock 里读写。
    private var exchanges: [Int: Exchange] = [:]
    private var session: URLSession!

    override init() {
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = HTTPTimeout.standard.idle ?? 30
        configuration.timeoutIntervalForResource = Self.noTimeout
        // 回调排成一列：同一个请求的响应头、数据、结束不会并发，Exchange 的状态就不用再加锁。
        let queue = OperationQueue()
        queue.name = "NoteFable.URLSessionTransport"
        queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }

    /// 取消所有请求并放开 URLSession（它强引用着 delegate）。App 里整个进程只有一个，不用调；测试结束时调。
    func invalidate() {
        session.invalidateAndCancel()
    }

    func send(_ request: HTTPRequest) async throws -> (Data, HTTPURLResponse) {
        try await buffered(request, uploadTask: false, onProgress: nil)
    }

    func upload(
        _ request: HTTPRequest,
        onProgress: @escaping @Sendable (_ sent: Int64, _ total: Int64) -> Void
    ) async throws -> (Data, HTTPURLResponse) {
        try await buffered(request, uploadTask: true, onProgress: onProgress)
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        try Task.checkCancellation()
        let handle = TaskHandle()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let exchange = Exchange(handle: handle)
                exchange.head = continuation
                start(request, uploadTask: false, exchange: exchange)
            }
        } onCancel: {
            handle.cancel()
        }
    }

    private func buffered(
        _ request: HTTPRequest,
        uploadTask: Bool,
        onProgress: (@Sendable (Int64, Int64) -> Void)?
    ) async throws -> (Data, HTTPURLResponse) {
        try Task.checkCancellation()
        let handle = TaskHandle()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let exchange = Exchange(handle: handle)
                exchange.completion = continuation
                exchange.onProgress = onProgress
                start(request, uploadTask: uploadTask, exchange: exchange)
            }
        } onCancel: {
            handle.cancel()
        }
    }

    private func start(_ request: HTTPRequest, uploadTask: Bool, exchange: Exchange) {
        let task = makeTask(request, uploadTask: uploadTask)
        lock.withLock { exchanges[task.taskIdentifier] = exchange }
        if let total = request.timeout.total {
            // URLSession 只有按会话设的资源超时，没有按请求的总时限：自己计时，到点取消并报超时。
            let watchdog = DispatchWorkItem { [weak self, weak task] in
                self?.lock.withLock { exchange.timedOut = true }
                task?.cancel()
            }
            exchange.watchdog = watchdog
            DispatchQueue.global().asyncAfter(deadline: .now() + total, execute: watchdog)
        }
        task.resume()
        // 先 resume 再交出去：调用方在这之前就取消了的话，这里马上取消，结束回调照常会来。
        exchange.handle.attach(task)
    }

    private func makeTask(_ request: HTTPRequest, uploadTask: Bool) -> URLSessionTask {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method
        urlRequest.httpShouldHandleCookies = false
        urlRequest.cachePolicy = .reloadIgnoringLocalCacheData
        urlRequest.timeoutInterval = request.timeout.idle ?? Self.noTimeout
        for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }
        switch request.body {
        case nil:
            return session.dataTask(with: urlRequest)
        case .data(let data):
            if uploadTask { return session.uploadTask(with: urlRequest, from: data) }
            urlRequest.httpBody = data
            return session.dataTask(with: urlRequest)
        case .file(let url):
            return session.uploadTask(with: urlRequest, fromFile: url)
        }
    }

    private func exchange(for task: URLSessionTask) -> Exchange? {
        lock.withLock { exchanges[task.taskIdentifier] }
    }

    /// 响应头到了：流式请求在这里把结果交出去，之后的数据进 body。只在 delegate 队列上调用。
    private func deliverHead(_ exchange: Exchange, _ response: HTTPURLResponse) {
        guard let head = exchange.head else { return }
        exchange.head = nil
        let (body, continuation) = AsyncThrowingStream<Data, Error>.makeStream()
        let handle = exchange.handle
        // 读的那一方被取消（停止生成）时，把网络请求也取消。
        continuation.onTermination = { termination in
            if case .cancelled = termination { handle.cancel() }
        }
        exchange.body = continuation
        if !exchange.buffer.isEmpty {
            continuation.yield(exchange.buffer)
            exchange.buffer = Data()
        }
        head.resume(returning: HTTPStreamResponse(response: response, body: body, cancel: { handle.cancel() }))
    }
}

extension URLSessionTransport: URLSessionDataDelegate {
    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        if let exchange = exchange(for: dataTask), exchange.response == nil, let http = response as? HTTPURLResponse {
            exchange.response = http
            deliverHead(exchange, http)
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let exchange = exchange(for: dataTask) else { return }
        if let body = exchange.body {
            body.yield(data)
        } else {
            exchange.buffer.append(data)
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        exchange(for: task)?.onProgress?(totalBytesSent, totalBytesExpectedToSend)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // 不跟：把 3xx 原样交回去，由 NoteFableHttp 存下它的 Set-Cookie、给新地址重新配 Cookie 后再发。
        // 让 URLSession 自己跟的话，手动加的 Cookie 请求头会被原样带到别的站（附件图片会跳到存储服务的地址）。
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let found: (exchange: Exchange, timedOut: Bool)? = lock.withLock {
            guard let exchange = exchanges.removeValue(forKey: task.taskIdentifier) else { return nil }
            return (exchange, exchange.timedOut)
        }
        guard let (exchange, timedOut) = found else { return }
        exchange.watchdog?.cancel()

        let failure: Error? = error.map { error in
            if timedOut { return URLError(.timedOut) }
            if exchange.handle.isCancelled || (error as? URLError)?.code == .cancelled { return CancellationError() }
            return error
        }
        // Linux 的 Foundation 在不跟重定向时不调 didReceive response，响应只在 task 上。
        let response = exchange.response ?? (task.response as? HTTPURLResponse)

        if let completion = exchange.completion {
            exchange.completion = nil
            if let failure {
                completion.resume(throwing: failure)
            } else if let response {
                completion.resume(returning: (exchange.buffer, response))
            } else {
                completion.resume(throwing: URLError(.badServerResponse))
            }
            return
        }

        if let failure {
            if let head = exchange.head {
                exchange.head = nil
                head.resume(throwing: failure)
            } else {
                exchange.body?.finish(throwing: failure)
            }
        } else if let head = exchange.head {
            if let response {
                deliverHead(exchange, response)
                exchange.body?.finish()
            } else {
                exchange.head = nil
                head.resume(throwing: URLError(.badServerResponse))
            }
        } else {
            exchange.body?.finish()
        }
    }
}

/// 一个进行中的请求的状态。除了 [timedOut]（在 transport 的锁里读写）都只在 delegate 队列上碰。
private final class Exchange {
    let handle: TaskHandle
    var response: HTTPURLResponse?
    var buffer = Data()
    var timedOut = false
    var watchdog: DispatchWorkItem?
    var onProgress: (@Sendable (Int64, Int64) -> Void)?
    /// 普通请求和上传：读完后一次交回。
    var completion: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    /// 流式请求：响应头到了就交回，正文之后进 [body]。
    var head: CheckedContinuation<HTTPStreamResponse, Error>?
    var body: AsyncThrowingStream<Data, Error>.Continuation?

    init(handle: TaskHandle) {
        self.handle = handle
    }
}

/// 把"取消"接到 URLSessionTask 上。任务还没建好就取消的话，建好时马上取消。
private final class TaskHandle: @unchecked Sendable {
    private let lock = NSLock()
    private var task: URLSessionTask?
    private var cancelled = false

    var isCancelled: Bool { lock.withLock { cancelled } }

    func attach(_ task: URLSessionTask) {
        let cancelNow: Bool = lock.withLock {
            self.task = task
            return cancelled
        }
        if cancelNow { task.cancel() }
    }

    func cancel() {
        let task: URLSessionTask? = lock.withLock {
            cancelled = true
            return self.task
        }
        task?.cancel()
    }
}
