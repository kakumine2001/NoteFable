package com.kakumine.studymate.data

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

/**
 * 侧栏里改一篇没打开的笔记的图标（网页 use-note-pages.ts 的 changeIcon：`PUT /api/pages/:id/icon {icon}`，null 是去掉）。
 * 服务端会把笔记的版本号加一；打开着的笔记要走编辑器自己的保存，不走这里。
 */
fun interface NoteIconBackend {
    suspend fun setNoteIcon(id: String, icon: String?): NotePageSummary
}

class NoteIconApi internal constructor(private val http: StudyMateHttp) : NoteIconBackend {
    override suspend fun setNoteIcon(id: String, icon: String?): NotePageSummary {
        val body = buildJsonObject { put("icon", icon?.let(::JsonPrimitive) ?: JsonNull) }.toString()
        val url = http.absoluteUrl("/api/pages/${URLEncoder.encode(id, "UTF-8")}/icon")
        return http.send<PageResponse>(Request.Builder().url(url).put(body.toRequestBody(StudyMateHttp.JSON))).page
    }
}
