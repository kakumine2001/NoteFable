package com.kakumine.notefable.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

// 服务端 JSON 的形状。字段与 src/app/api 保持一致；未知字段一律忽略，网页端加字段不会让 App 崩溃。
val NoteFableJson = Json {
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

/** 同一位置的其它版本（编辑过的提问、重新生成的回答）里，这条是第几个，以及前后版本的消息 ID（网页 MessageVersions）。 */
@Serializable
data class MessageVersions(val index: Int, val total: Int, val prevId: String? = null, val nextId: String? = null)

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
    // activity / proposals 保留原始 JSON，由 Activity.parseStored / parseStoredProposals 逐项校验后再用（坏的丢掉）。
    val activity: JsonElement? = null,
    val proposals: JsonElement? = null,
    /** 用户给这条提问添加的笔记（网页 Message.pages）。标题和图标每次读历史都从笔记取；回收站里的不返回。 */
    val pages: List<ChatProjectNote> = emptyList(),
    /** 有别的版本时才有；只有一个版本时为空。 */
    val versions: MessageVersions? = null,
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

// 错误响应。429 的使用上限还带 code / tier / kind（src/lib/usage-limits.ts）。
@Serializable
data class ApiError(
    val error: String? = null,
    val code: String? = null,
    val tier: String? = null,
    val kind: String? = null,
)

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
    /**
     * 设置里选的界面语言（en / zh / zh-Hant / ja）。JSON 里是 null＝没选过（按环境语言显示）；
     * 没有这个字段＝服务端没读到用户行、不知道（[LOCALE_UNKNOWN]），这时不用本机的选择覆盖账号（网页 AccountUser.locale）。
     */
    val locale: String? = LOCALE_UNKNOWN,
)

/** [AccountUser.locale] 不知道（服务端没返回这个字段）。 */
const val LOCALE_UNKNOWN = "?"

@Serializable
data class AccountResponse(
    val configured: Boolean = false,
    val user: AccountUser? = null,
    val googleClientId: String? = null,
    /** 服务端开了哪些登录方式（登录窗口只列这些）。旧服务端不返回：按网页的规则，Google 缺省算开、邮箱缺省算关。 */
    val google: Boolean? = null,
    val email: Boolean? = null,
)

@Serializable
data class ProfileResponse(val user: AccountUser? = null)

@Serializable
data class NonceResponse(val nonce: String)

@Serializable
data class CsrfResponse(val csrfToken: String)

// ---- 聊天项目（侧栏的 Projects，src/app/api/chat-projects；类型见 src/types/chat.ts） ----

/** 侧栏列表、新建和保存的返回值。noteCount 只数没进回收站的参考笔记。 */
@Serializable
data class ChatProjectSummary(
    val id: String,
    val name: String,
    val noteCount: Int = 0,
    val hasInstructions: Boolean = false,
)

@Serializable
data class ChatProjectsResponse(val projects: List<ChatProjectSummary> = emptyList())

@Serializable
data class ChatProjectResponse(val project: ChatProjectSummary)

/** 设置窗口用的详情：notes 按选的顺序，不含回收站里的笔记。 */
@Serializable
data class ChatProjectNote(val id: String, val title: String = "", val icon: String? = null)

@Serializable
data class ChatProjectDetail(
    val id: String,
    val name: String,
    val instructions: String? = null,
    val notes: List<ChatProjectNote> = emptyList(),
)

@Serializable
data class ChatProjectDetailResponse(val project: ChatProjectDetail)

/** 与 src/types/chat.ts 相同的上限。 */
const val MAX_PROJECT_INSTRUCTIONS = 4000
const val MAX_PROJECT_NOTES = 5

/** 一条消息最多能添加的笔记数（网页 MAX_MESSAGE_NOTES，服务端同一个值）。 */
const val MAX_MESSAGE_NOTES = 5

/** 用户的自定义指令（适用于所有聊天）的上限，与网页 MAX_CUSTOM_INSTRUCTIONS 相同。 */
const val MAX_CUSTOM_INSTRUCTIONS = MAX_PROJECT_INSTRUCTIONS

/** `GET /api/billing` 里一种用量（chat / image）：本期用了多少、上限、按天还是按月（day / month）、何时重新计算。 */
@Serializable
data class PlanUsage(val used: Int = 0, val limit: Int = 0, val period: String = "day", val resetsAt: String? = null)

/** `GET /api/billing` 的订阅状态（网页 src/lib/billing-client.ts 的 PlanInfo.subscription）。 */
@Serializable
data class PlanSubscription(val status: String = "", val periodEnd: String? = null, val cancelAt: String? = null)

/** `GET /api/billing`：当前方案（free / pro）、订阅和本期用量。原生端只显示，不提供购买（见 android-native.md）。 */
@Serializable
data class PlanInfo(
    val plan: String = "free",
    val subscription: PlanSubscription? = null,
    val usage: Map<String, PlanUsage> = emptyMap(),
)

/** `GET / PUT /api/custom-instructions` 的回复；null 表示没有设置。 */
@Serializable
data class CustomInstructionsResponse(val instructions: String? = null)
