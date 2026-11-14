package com.kakumine.studymate.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

// 服务端 JSON 的形状。字段与 src/app/api 保持一致；未知字段一律忽略，网页端加字段不会让 App 崩溃。
val StudyMateJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
}

@Serializable
data class SessionSummary(
    val id: String,
    val title: String,
    val icon: String? = null,
    val pinned: Boolean = false,
    val position: Int = 0,
    val projectId: String? = null,
    val updatedAt: String = "",
)

@Serializable
data class SessionsResponse(val sessions: List<SessionSummary> = emptyList())

@Serializable
data class AttachmentDto(
    val id: String,
    val filename: String = "",
    val mimeType: String = "",
    val size: Long = 0,
    val dataUrl: String? = null,
)

@Serializable
data class GeneratedImageDto(
    val id: String,
    val dataUrl: String,
    val mimeType: String = "image/png",
)

@Serializable
data class MessageDto(
    val id: String,
    val role: String,
    val content: String = "",
    val model: String? = null,
    val reasoningEffort: String? = null,
    val thinkingMs: Long? = null,
    val createdAt: String = "",
    val attachments: List<AttachmentDto> = emptyList(),
    val generatedImages: List<GeneratedImageDto> = emptyList(),
    // activity / proposals 的结构较复杂，第一版只保留原始 JSON，后续再做原生进度条和提案卡片。
    val activity: JsonElement? = null,
    val proposals: JsonElement? = null,
)

@Serializable
data class MessagesResponse(val messages: List<MessageDto> = emptyList())

@Serializable
data class ModelInfo(
    val id: String,
    val label: String,
    val provider: String = "",
    val supportsImageInput: Boolean = false,
    val supportsWebSearch: Boolean = false,
    val reasoningEfforts: List<String> = emptyList(),
    val defaultReasoning: String = "medium",
)

@Serializable
data class ModelsResponse(
    val defaultModel: String,
    val models: List<ModelInfo> = emptyList(),
)

@Serializable
data class ApiError(val error: String? = null)

// POST /api/uploads：每个文件一张上传凭证（ticket）和存放路径；mode 是 "blob"（线上）或 "local"（本机开发）。
@Serializable
data class UploadSlot(val path: String, val ticket: String)

@Serializable
data class UploadPlan(val uploads: List<UploadSlot> = emptyList(), val mode: String = "blob")

@Serializable
data class ClientTokenResponse(val clientToken: String)

// POST /api/images 的结果：只在图片完成后返回一次。
@Serializable
data class GeneratedImagePayload(val dataUrl: String = "", val mimeType: String = "image/png")

@Serializable
data class ImageResult(val sessionId: String? = null, val image: GeneratedImagePayload? = null, val error: String? = null)

// GET /api/account（src/app/api/account/route.ts）。configured=false 表示服务端没开 Google 登录，不显示登录入口。
@Serializable
data class AccountUser(
    val name: String? = null,
    val googleName: String? = null,
    val email: String? = null,
    val image: String? = null,
    val displayName: String? = null,
    val icon: String? = null,
    val avatarUrl: String? = null,
)

@Serializable
data class AccountResponse(
    val configured: Boolean = false,
    val user: AccountUser? = null,
    val googleClientId: String? = null,
)

@Serializable
data class ProfileResponse(val user: AccountUser? = null)

@Serializable
data class NonceResponse(val nonce: String)

@Serializable
data class CsrfResponse(val csrfToken: String)
