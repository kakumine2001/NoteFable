package com.kakumine.studymate.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.CookieJar
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** 服务端返回了错误（含「今日次数已用完」这类业务错误），message 可以直接给用户看。 */
class ApiException(val status: Int, message: String) : IOException(message)

/** 发给 `/api/chat` 的一次提问。字段名与网页端的 FormData 一致。 */
data class ChatRequest(
    val message: String,
    val sessionId: String?,
    val model: String?,
    val reasoning: String?,
    val webSearch: String = "auto",
)

class StudyMateApi(
    private val baseUrl: String,
    private val cookieJar: CookieJar,
) : ChatBackend, AccountBackend {
    private val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("User-Agent", USER_AGENT)
                    .build(),
            )
        }
        .build()

    // 思考型模型可能很久没有任何输出，流式请求不设读超时和总超时，靠取消结束。
    private val streamClient: OkHttpClient = client.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    val httpClient: OkHttpClient get() = client

    override fun absoluteUrl(path: String): String =
        if (path.startsWith("http://") || path.startsWith("https://")) path else baseUrl + path

    override suspend fun sessions(): List<SessionSummary> =
        getJson<SessionsResponse>("/api/sessions").sessions

    override suspend fun messages(sessionId: String): List<MessageDto> =
        getJson<MessagesResponse>("/api/sessions/$sessionId/messages").messages

    override suspend fun models(): ModelsResponse = getJson("/api/models")

    /**
     * 提问并以流的形式收回答案。第一个事件一定是 [ChatStreamEvent.Started]；
     * 服务端出错（4xx/5xx）时以 [ApiException] 结束。取消收集会取消底层网络请求。
     */
    override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> = callbackFlow {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("message", request.message)
            .apply { request.model?.let { addFormDataPart("model", it) } }
            .apply { request.reasoning?.let { addFormDataPart("reasoning", it) } }
            .addFormDataPart("webSearch", request.webSearch)
            .apply { request.sessionId?.let { addFormDataPart("sessionId", it) } }
            .build()
        val call = streamClient.newCall(
            Request.Builder().url(absoluteUrl("/api/chat")).post(body)
                .header("Accept", "text/event-stream").build(),
        )

        val reader = launch(Dispatchers.IO) {
            try {
                call.execute().use { response ->
                    if (!response.isSuccessful) throw response.toApiException()
                    trySend(ChatStreamEvent.Started(response.header("X-Session-Id")))
                    val source = response.body.source()
                    while (true) {
                        val line = source.readUtf8Line() ?: break
                        ChatStreamParser.parseLine(line)?.let { trySend(it) }
                    }
                }
                close()
            } catch (error: Throwable) {
                close(error)
            }
        }
        awaitClose {
            call.cancel()
            reader.cancel()
        }
    }.buffer(Channel.UNLIMITED)

    // ---- 账号 ----

    override suspend fun account(): AccountResponse = getJson("/api/account")

    override suspend fun updateProfile(displayName: String?, resetToGoogle: Boolean): AccountUser? {
        val body = if (resetToGoogle) """{"displayName":null,"avatarIcon":null}"""
        else buildJsonObject { put("displayName", displayName) }.toString()
        return send<ProfileResponse>(Request.Builder().url(absoluteUrl("/api/account")).patch(body.toRequestBody(JSON))).user
    }

    override suspend fun nativeSignInNonce(): String =
        send<NonceResponse>(Request.Builder().url(absoluteUrl("/api/native-auth/nonce")).post(ByteArray(0).toRequestBody(null))).nonce

    override suspend fun nativeSignIn(idToken: String) {
        val body = buildJsonObject { put("idToken", idToken) }.toString()
        send<ApiError>(Request.Builder().url(absoluteUrl("/api/native-auth/google")).post(body.toRequestBody(JSON)))
    }

    // 和网页的 next-auth signOut() 一样走 Auth.js 的 CSRF 流程；无论服务端是否成功，都删掉本地的会话 Cookie，
    // 会话是 JWT、服务端不存状态，本地删掉就等于退出。
    override suspend fun signOut() {
        try {
            val csrf = getJson<CsrfResponse>("/api/auth/csrf").csrfToken
            val form = FormBody.Builder().add("csrfToken", csrf).add("callbackUrl", baseUrl).build()
            val response = client.newCall(Request.Builder().url(absoluteUrl("/api/auth/signout")).post(form).build()).await()
            response.close()
        } finally {
            (cookieJar as? PersistentCookieJar)?.removeWhere { it.name.contains("authjs.session-token") }
        }
    }

    private suspend inline fun <reified T> send(builder: Request.Builder): T {
        val response = client.newCall(builder.header("Accept", "application/json").build()).await()
        return response.use {
            if (!it.isSuccessful) throw it.toApiException()
            val text = withContext(Dispatchers.IO) { it.body.string() }
            StudyMateJson.decodeFromString(text)
        }
    }

    private suspend inline fun <reified T> getJson(path: String): T {
        val request = Request.Builder().url(absoluteUrl(path)).get()
            .header("Accept", "application/json").build()
        val response = client.newCall(request).await()
        return response.use {
            if (!it.isSuccessful) throw it.toApiException()
            val text = withContext(Dispatchers.IO) { it.body.string() }
            StudyMateJson.decodeFromString(text)
        }
    }

    private fun Response.toApiException(): ApiException {
        val text = runCatching { body.string() }.getOrDefault("")
        val message = runCatching { StudyMateJson.decodeFromString<ApiError>(text).error }.getOrNull()
        return ApiException(code, message?.takeIf { it.isNotBlank() } ?: "HTTP $code")
    }

    companion object {
        const val USER_AGENT = "StudyMateNative/0.1 (Android)"
        private val JSON = "application/json".toMediaType()
    }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
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
