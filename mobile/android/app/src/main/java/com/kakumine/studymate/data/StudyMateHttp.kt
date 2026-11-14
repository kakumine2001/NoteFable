package com.kakumine.studymate.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * 服务端返回了错误（含「今日次数已用完」这类业务错误）。[message] 是服务端的英文原句，
 * 显示前用 [SystemTextTranslator.localize] 翻译；读不到错误文时是 "HTTP <status>"。
 * [code]、[tier]、[kind] 来自错误 JSON（目前只有 429 的使用上限：`{error, code: "usage_limit", tier, kind}`，
 * 见 `src/lib/usage-limits.ts`）。
 */
class ApiException(
    val status: Int,
    message: String,
    val code: String? = null,
    val tier: String? = null,
    val kind: String? = null,
) : IOException(message) {
    /** 当日使用次数已用完（`src/lib/usage-plans.ts` 的 USAGE_LIMIT_CODE）。 */
    val isUsageLimit: Boolean get() = status == 429 && code == USAGE_LIMIT_CODE

    companion object {
        const val USAGE_LIMIT_CODE = "usage_limit"

        /** 按错误响应的状态码和正文构造。正文不是 JSON 或没有 `error` 时退回 "HTTP <status>"。 */
        fun from(status: Int, body: String): ApiException {
            val error = runCatching { StudyMateJson.decodeFromString<ApiError>(body) }.getOrNull()
            return ApiException(
                status,
                error?.error?.takeIf { it.isNotBlank() } ?: "HTTP $status",
                code = error?.code,
                tier = error?.tier,
                kind = error?.kind,
            )
        }
    }
}

/**
 * StudyMateApi 共用的 HTTP 部分：三个 OkHttp 客户端（普通、流式、上传）、JSON 请求和错误转换。
 * 拆出来是为了让各个接口文件（聊天、笔记、搜索……）都能用同一套，而不是都往 StudyMateApi 里加。
 */
internal class StudyMateHttp(private val baseUrl: String, cookieJar: CookieJar) {
    val identityGate = IdentityGate(baseUrl.toHttpUrl().host)

    val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .addInterceptor(identityGate)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("User-Agent", USER_AGENT)
                    // 和界面语言一致（见 AppLanguage），服务端按它决定语言的地方与网页相同。
                    .header("Accept-Language", AppLanguage.acceptLanguage(AppLanguage.uiLocale))
                    .build(),
            )
        }
        .build()

    // 思考型模型可能很久没有任何输出，流式请求不设读超时和总超时，靠取消结束。
    val streamClient: OkHttpClient = client.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    // 大文件在手机网络上可能传一分多钟：不设总超时，只要求一直有进展。
    val uploadClient: OkHttpClient = client.newBuilder()
        .writeTimeout(60, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    fun absoluteUrl(path: String): String =
        if (path.startsWith("http://") || path.startsWith("https://")) path else baseUrl + path

    suspend inline fun <reified T> send(builder: Request.Builder, with: OkHttpClient = client): T {
        val response = with.newCall(builder.header("Accept", "application/json").build()).await()
        return response.use {
            if (!it.isSuccessful) throw it.toApiException()
            val text = withContext(Dispatchers.IO) { it.body.string() }
            StudyMateJson.decodeFromString(text)
        }
    }

    suspend inline fun <reified T> getJson(path: String): T {
        val request = Request.Builder().url(absoluteUrl(path)).get()
            .header("Accept", "application/json").build()
        val response = client.newCall(request).await()
        return response.use {
            if (!it.isSuccessful) throw it.toApiException()
            val text = withContext(Dispatchers.IO) { it.body.string() }
            StudyMateJson.decodeFromString(text)
        }
    }

    companion object {
        const val USER_AGENT = "StudyMateNative/0.1 (Android)"
        val JSON: MediaType = "application/json".toMediaType()
    }
}

internal fun Response.toApiException(): ApiException =
    ApiException.from(code, runCatching { body.string() }.getOrDefault(""))

internal suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            // 响应送到时协程已被取消的话，没人会再去关它，这里负责关闭，避免连接泄漏。
            continuation.resume(response) { response.close() }
        }
    })
}
