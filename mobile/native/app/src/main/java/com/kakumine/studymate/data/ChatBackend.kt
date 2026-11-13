package com.kakumine.studymate.data

import kotlinx.coroutines.flow.Flow

/** ViewModel 依赖的服务端能力。拆成接口是为了单元测试时换成假实现。 */
interface ChatBackend {
    suspend fun sessions(): List<SessionSummary>
    suspend fun messages(sessionId: String): List<MessageDto>
    suspend fun models(): ModelsResponse
    fun streamChat(request: ChatRequest): Flow<ChatStreamEvent>

    /** 相对路径（如附件图片 `/api/attachments/..`）补成完整地址。 */
    fun absoluteUrl(path: String): String
}
