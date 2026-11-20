import Foundation

/// ViewModel 依赖的服务端能力。拆成协议是为了单元测试时换成假实现。
protocol ChatBackend {
    func sessions() async throws -> [SessionSummary]
    func messages(sessionId: String) async throws -> [MessageDto]
    func models() async throws -> ModelsResponse

    /// 提问并以流的形式收回答案。第一个事件一定是 `.started`；服务端出错（4xx / 5xx）时以 [ApiException] 结束。
    ///
    /// 读这个流的任务被取消时，底层的网络请求也取消，流直接结束（不抛错）：读完循环后用 `Task.isCancelled` 区分。
    /// 只是 break 出循环而不取消任务的话，请求会继续到服务端发完为止。
    func streamChat(_ request: ChatRequest) -> AsyncThrowingStream<ChatStreamEvent, Error>

    /// 生成图片（网页的「生成图片」模式）。完成后一次性返回，没有流。
    func generateImage(_ request: ChatRequest) async throws -> ImageResult

    /// 为要发送的附件申请上传凭证。
    func prepareUploads(_ files: [LocalFile]) async throws -> UploadPlan

    /// 把一个文件传到凭证指定的位置；[onProgress] 收到 0...100 的百分比，在后台线程上调用。
    func uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: @escaping @Sendable (Int) -> Void) async throws

    /// 发送没成功时，删掉已经传上去的文件。失败不抛出；调用它的任务已被取消也照样发出去。
    func discardUploads(_ tickets: [String]) async

    /// 相对路径（如附件图片 `/api/attachments/..`）补成完整地址。
    func absoluteUrl(_ path: String) -> String

    /// 告诉服务端停止这个聊天正在生成的回答：`POST /api/sessions/:id/stop`。服务端把已生成的部分存好再结束流，
    /// 所以这边不取消请求，等流自己结束（断开连接不一定能传到服务端）。
    func stopSession(sessionId: String) async throws

    /// 显示另一个版本（编辑前的提问、之前的回答），它后面的对话一起换：`POST /api/sessions/:id/versions`。之后重读消息。
    func showVersion(sessionId: String, messageId: String) async throws

    /// 把到这条消息为止的对话复制成一个新聊天：`POST /api/sessions/:id/branch`。[title] 是新聊天的名字。
    func branchSession(sessionId: String, messageId: String, title: String) async throws -> SessionSummary
}

// 和 Kotlin 接口的默认实现一样：假实现不写这几个时，调到就抛错。
extension ChatBackend {
    func stopSession(sessionId: String) async throws {
        throw UnsupportedOperationError()
    }

    func showVersion(sessionId: String, messageId: String) async throws {
        throw UnsupportedOperationError()
    }

    func branchSession(sessionId: String, messageId: String, title: String) async throws -> SessionSummary {
        throw UnsupportedOperationError()
    }
}
