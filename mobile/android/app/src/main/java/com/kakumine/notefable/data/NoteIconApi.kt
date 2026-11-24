package com.kakumine.notefable.data

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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

    /**
     * 同 [setNoteIcon]，另外带回服务端返回的整篇页面 JSON（含正文），交给常驻 WebView 的缓存（`pageUpdated`），
     * 否则下次从缓存打开这一篇时还是改图标之前的版本，一编辑就 409。拿不到时 json 是 null。
     */
    suspend fun setNoteIconWithPage(id: String, icon: String?): NoteIconWrite = NoteIconWrite(setNoteIcon(id, icon), null)
}

data class NoteIconWrite(val page: NotePageSummary, val json: String?)

class NoteIconApi internal constructor(private val http: NoteFableHttp) : NoteIconBackend {
    override suspend fun setNoteIcon(id: String, icon: String?): NotePageSummary = setNoteIconWithPage(id, icon).page

    override suspend fun setNoteIconWithPage(id: String, icon: String?): NoteIconWrite {
        val body = buildJsonObject { put("icon", icon?.let(::JsonPrimitive) ?: JsonNull) }.toString()
        val url = http.absoluteUrl("/api/pages/${URLEncoder.encode(id, "UTF-8")}/icon")
        val response = http.send<JsonObject>(Request.Builder().url(url).put(body.toRequestBody(NoteFableHttp.JSON)))
        val page = response["page"] as? JsonObject ?: throw IllegalStateException("missing page")
        return NoteIconWrite(NoteFableJson.decodeFromJsonElement(NotePageSummary.serializer(), page), page.toString())
    }
}
