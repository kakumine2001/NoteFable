package com.kakumine.notefable.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.TimeUnit

// 报告 AI 的内容（POST /api/reports，网页 answer-actions.tsx 的 ReportDialog）：回答、提案卡片、AI 写过的页面，请求体里只放一个对象。
class ReportApiTest {
    private fun MockWebServer.api() = ReportApi(OkHttpClient()) { path -> url("/").toString().trimEnd('/') + path }
    private fun MockWebServer.next() = takeRequest(1, TimeUnit.SECONDS)!!
    private fun body(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

    @Test
    fun `each target sends exactly one id with the trimmed reason`() {
        assertEquals(
            mapOf("messageId" to JsonPrimitive("m1"), "reason" to JsonPrimitive("wrong")),
            body(ReportApi.reportBody(ReportTarget.Answer("m1"), "  wrong \n")),
        )
        assertEquals(
            mapOf("proposalId" to JsonPrimitive("pr1"), "reason" to JsonPrimitive("")),
            body(ReportApi.reportBody(ReportTarget.Proposal("pr1"), "   ")),
        )
        assertEquals(
            mapOf("pageId" to JsonPrimitive("p1"), "reason" to JsonPrimitive("Made up facts")),
            body(ReportApi.reportBody(ReportTarget.Page("p1"), "Made up facts")),
        )
    }

    @Test
    fun `posts the report as json to the reports endpoint`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"ok":true}"""))
            server.api().report(ReportTarget.Proposal("pr 1"), " Offensive ")
            val request = server.next()
            assertEquals("POST", request.method)
            assertEquals("/api/reports", request.path)
            assertEquals("application/json; charset=utf-8", request.getHeader("Content-Type"))
            assertEquals(mapOf("proposalId" to JsonPrimitive("pr 1"), "reason" to JsonPrimitive("Offensive")), body(request.body.readUtf8()))
        }
    }

    @Test
    fun `a missing target or a full quota fails with the server sentence`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"This content is no longer available."}"""))
            server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":"You’ve sent many reports today. Try again tomorrow."}"""))
            server.enqueue(MockResponse().setResponseCode(502).setBody("bad gateway"))
            val api = server.api()
            val missing = runCatching { api.report(ReportTarget.Page("p1"), "") }.exceptionOrNull() as ApiException
            assertEquals(404, missing.status)
            assertEquals("This content is no longer available.", missing.serverMessage())
            val quota = runCatching { api.report(ReportTarget.Answer("m1"), "") }.exceptionOrNull() as ApiException
            assertEquals("You’ve sent many reports today. Try again tomorrow.", quota.serverMessage())
            // 没有服务端原句时界面用"无法发送报告。"。
            val broken = runCatching { api.report(ReportTarget.Proposal("pr1"), "") }.exceptionOrNull() as ApiException
            assertNull(broken.serverMessage())
        }
    }
}
