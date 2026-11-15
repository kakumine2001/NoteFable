package com.kakumine.notefable.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** 举报 AI 回答（网页 answer-actions.tsx 的 ReportAnswerDialog，Google Play 的 AI 生成内容政策）。 */
fun interface ReportBackend {
    /** `POST /api/reports`：[reason] 可以是空字符串。失败抛 [ApiException]（带服务端的错误文字）或 IOException。 */
    suspend fun reportAnswer(messageId: String, reason: String)
}

class ReportApi(
    private val client: OkHttpClient,
    private val absoluteUrl: (String) -> String,
) : ReportBackend {
    override suspend fun reportAnswer(messageId: String, reason: String) {
        val body = buildJsonObject {
            put("messageId", messageId)
            put("reason", reason.trim())
        }.toString().toRequestBody(NoteFableHttp.JSON)
        val request = Request.Builder().url(absoluteUrl("/api/reports")).post(body).header("Accept", "application/json").build()
        client.newCall(request).await().use {
            val text = withContext(Dispatchers.IO) { runCatching { it.body.string() }.getOrDefault("") }
            if (!it.isSuccessful) throw ApiException.from(it.code, text)
        }
    }
}

/** 举报理由的上限（服务端 MAX_REPORT_REASON）。 */
const val MAX_REPORT_REASON = 1000
