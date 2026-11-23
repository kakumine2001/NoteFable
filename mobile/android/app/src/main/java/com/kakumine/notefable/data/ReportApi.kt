package com.kakumine.notefable.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * 要报告的 AI 内容（网页 answer-actions.tsx 的 ReportTarget）：聊天的回答、AI 的提案卡片、AI 写过的页面（页面的"…"菜单）。
 * 请求体里只放其中一个 ID（`messageId` / `proposalId` / `pageId`）。
 */
sealed interface ReportTarget {
    data class Answer(val messageId: String) : ReportTarget
    data class Proposal(val proposalId: String) : ReportTarget
    data class Page(val pageId: String) : ReportTarget
}

/** 举报 AI 生成的内容（网页 answer-actions.tsx 的 ReportDialog，Google Play 的 AI 生成内容政策）。 */
fun interface ReportBackend {
    /** `POST /api/reports`：[reason] 可以是空字符串。失败抛 [ApiException]（带服务端的错误文字）或 IOException。 */
    suspend fun report(target: ReportTarget, reason: String)
}

class ReportApi(
    private val client: OkHttpClient,
    private val absoluteUrl: (String) -> String,
) : ReportBackend {
    override suspend fun report(target: ReportTarget, reason: String) {
        val body = reportBody(target, reason).toRequestBody(NoteFableHttp.JSON)
        val request = Request.Builder().url(absoluteUrl("/api/reports")).post(body).header("Accept", "application/json").build()
        client.newCall(request).await().use {
            val text = withContext(Dispatchers.IO) { runCatching { it.body.string() }.getOrDefault("") }
            if (!it.isSuccessful) throw ApiException.from(it.code, text)
        }
    }

    companion object {
        /** `{messageId | proposalId | pageId, reason}`：理由去掉首尾空白（网页 reason.trim()）。 */
        fun reportBody(target: ReportTarget, reason: String): String = buildJsonObject {
            when (target) {
                is ReportTarget.Answer -> put("messageId", target.messageId)
                is ReportTarget.Proposal -> put("proposalId", target.proposalId)
                is ReportTarget.Page -> put("pageId", target.pageId)
            }
            put("reason", reason.trim())
        }.toString()
    }
}

/** 举报理由的上限（服务端 MAX_REPORT_REASON）。 */
const val MAX_REPORT_REASON = 1000
