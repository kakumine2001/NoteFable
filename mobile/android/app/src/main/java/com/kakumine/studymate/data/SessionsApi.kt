package com.kakumine.studymate.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

/**
 * 聊天的整理操作（侧栏的置顶、改名、移到项目、删除、拖动排序，以及在项目里新建聊天）。
 * 和网页 `/app` 用同一组接口：`PATCH / DELETE /api/sessions/:id`、`POST /api/sessions`、`POST /api/sessions/reorder`。
 */
interface SessionsBackend {
    /** 只改传进来的字段；[projectId] 用 [ProjectChange] 区分"不改"和"移出项目（null）"。 */
    suspend fun updateSession(id: String, title: String? = null, pinned: Boolean? = null, project: ProjectChange? = null)
    suspend fun deleteSession(id: String)

    /** 新建一个空聊天（标题 "New chat"）；[projectId] 不为空时直接建在那个项目里。 */
    suspend fun createSession(projectId: String?): SessionSummary

    /** 把 [id] 移到 [targetId] 的前面或后面；跨组时服务端顺便改它的项目和置顶。返回所有聊天的新位置。 */
    suspend fun reorderSession(id: String, targetId: String, after: Boolean): List<SessionOrderUpdate>
}

/** PATCH 里的 projectId：null 表示移出项目（"无项目"）。 */
data class ProjectChange(val projectId: String?)

@Serializable
data class SessionOrderUpdate(
    val id: String,
    val position: Int,
    // 只有被移动的那一条带这两个字段。
    val pinned: Boolean? = null,
    val projectId: String? = null,
    /** 响应里有没有 projectId 字段（null 本身也是有效值：移出项目）。 */
    val movedGroup: Boolean = false,
)

@Serializable
private data class CreatedSession(val session: SessionSummary)

class SessionsApi internal constructor(private val http: StudyMateHttp) : SessionsBackend {
    override suspend fun updateSession(id: String, title: String?, pinned: Boolean?, project: ProjectChange?) {
        val body = buildJsonObject {
            title?.let { put("title", it) }
            pinned?.let { put("pinned", it) }
            project?.let { put("projectId", it.projectId?.let(::JsonPrimitive) ?: JsonNull) }
        }.toString()
        http.send<JsonObjectResponse>(Request.Builder().url(http.absoluteUrl("/api/sessions/${segment(id)}")).patch(body.toRequestBody(StudyMateHttp.JSON)))
    }

    override suspend fun deleteSession(id: String) {
        http.send<JsonObjectResponse>(Request.Builder().url(http.absoluteUrl("/api/sessions/${segment(id)}")).delete())
    }

    override suspend fun createSession(projectId: String?): SessionSummary {
        val body = buildJsonObject { if (projectId != null) put("projectId", projectId) }.toString()
        return http.send<CreatedSession>(Request.Builder().url(http.absoluteUrl("/api/sessions")).post(body.toRequestBody(StudyMateHttp.JSON))).session
    }

    override suspend fun reorderSession(id: String, targetId: String, after: Boolean): List<SessionOrderUpdate> {
        val body = buildJsonObject {
            put("id", id)
            put("targetId", targetId)
            put("after", after)
        }.toString()
        val response = http.send<kotlinx.serialization.json.JsonObject>(
            Request.Builder().url(http.absoluteUrl("/api/sessions/reorder")).post(body.toRequestBody(StudyMateHttp.JSON)),
        )
        return parseOrderUpdates(response)
    }

    private fun segment(id: String) = URLEncoder.encode(id, "UTF-8")

    companion object {
        /** `{items:[{id, position, pinned?, projectId?}]}`。projectId 可能是 null（移到 Chats），所以要看字段在不在。 */
        internal fun parseOrderUpdates(response: kotlinx.serialization.json.JsonObject): List<SessionOrderUpdate> {
            val items = response["items"] as? kotlinx.serialization.json.JsonArray ?: return emptyList()
            return items.mapNotNull { element ->
                val item = element as? kotlinx.serialization.json.JsonObject ?: return@mapNotNull null
                val parsed = runCatching { StudyMateJson.decodeFromJsonElement(SessionOrderUpdate.serializer(), item) }.getOrNull()
                    ?: return@mapNotNull null
                parsed.copy(movedGroup = "projectId" in item)
            }
        }
    }
}
