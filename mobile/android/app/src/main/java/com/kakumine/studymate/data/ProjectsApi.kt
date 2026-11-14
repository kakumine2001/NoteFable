package com.kakumine.studymate.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

/**
 * 聊天项目（侧栏的 Projects 和项目设置窗口）。和网页 `/app` 用同一组接口：
 * `GET / POST /api/chat-projects`、`GET / PATCH / DELETE /api/chat-projects/:id`；参考笔记的候选来自 `GET /api/pages`。
 */
interface ProjectsBackend {
    suspend fun projects(): List<ChatProjectSummary>
    suspend fun createProject(name: String): ChatProjectSummary
    suspend fun renameProject(id: String, name: String): ChatProjectSummary
    suspend fun deleteProject(id: String)
    suspend fun projectDetail(id: String): ChatProjectDetail

    /** 只发改了的字段（网页 ChatProjectSettings.save）；noteIds 是整体替换。 */
    suspend fun updateProjectSettings(id: String, instructions: String?, noteIds: List<String>?): ChatProjectSummary

    /** 参考笔记的候选：用户的全部笔记（与笔记列表同一个接口）。 */
    suspend fun notesForPicker(): List<NotePageSummary>
}

class ProjectsApi internal constructor(private val http: StudyMateHttp) : ProjectsBackend {
    override suspend fun projects(): List<ChatProjectSummary> = http.getJson<ChatProjectsResponse>("/api/chat-projects").projects

    override suspend fun createProject(name: String): ChatProjectSummary {
        val body = buildJsonObject { put("name", name) }.toString()
        return http.send<ChatProjectResponse>(Request.Builder().url(http.absoluteUrl("/api/chat-projects")).post(body.toRequestBody(StudyMateHttp.JSON))).project
    }

    override suspend fun renameProject(id: String, name: String): ChatProjectSummary {
        val body = buildJsonObject { put("name", name) }.toString()
        return http.send<ChatProjectResponse>(Request.Builder().url(url(id)).patch(body.toRequestBody(StudyMateHttp.JSON))).project
    }

    override suspend fun deleteProject(id: String) {
        http.send<JsonObjectResponse>(Request.Builder().url(url(id)).delete())
    }

    override suspend fun projectDetail(id: String): ChatProjectDetail =
        http.send<ChatProjectDetailResponse>(Request.Builder().url(url(id)).get()).project

    override suspend fun updateProjectSettings(id: String, instructions: String?, noteIds: List<String>?): ChatProjectSummary {
        val body = buildJsonObject {
            instructions?.let { put("instructions", it) }
            noteIds?.let { ids -> put("noteIds", JsonArray(ids.map(::JsonPrimitive))) }
        }.toString()
        return http.send<ChatProjectResponse>(Request.Builder().url(url(id)).patch(body.toRequestBody(StudyMateHttp.JSON))).project
    }

    override suspend fun notesForPicker(): List<NotePageSummary> = http.getJson<NotesList>("/api/pages").pages

    private fun url(id: String) = http.absoluteUrl("/api/chat-projects/" + URLEncoder.encode(id, "UTF-8"))
}
