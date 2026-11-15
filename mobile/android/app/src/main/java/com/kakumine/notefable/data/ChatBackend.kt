package com.kakumine.notefable.data

import kotlinx.coroutines.flow.Flow

/** ViewModel 依赖的服务端能力。拆成接口是为了单元测试时换成假实现。 */
interface ChatBackend {
    suspend fun sessions(): List<SessionSummary>
    suspend fun messages(sessionId: String): List<MessageDto>
    suspend fun models(): ModelsResponse
    fun streamChat(request: ChatRequest): Flow<ChatStreamEvent>

    /** 生成图片（网页的「生成图片」模式）。完成后一次性返回，没有流。 */
    suspend fun generateImage(request: ChatRequest): ImageResult

    /** 为要发送的附件申请上传凭证。 */
    suspend fun prepareUploads(files: List<LocalFile>): UploadPlan

    /** 把一个文件传到凭证指定的位置；[onProgress] 收到 0..100 的百分比。 */
    suspend fun uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: (Int) -> Unit)

    /** 发送没成功时，删掉已经传上去的文件。失败不抛出。 */
    suspend fun discardUploads(tickets: List<String>)

    /** 相对路径（如附件图片 `/api/attachments/..`）补成完整地址。 */
    fun absoluteUrl(path: String): String
}
