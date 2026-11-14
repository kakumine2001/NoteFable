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
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.OutputStream
import okhttp3.RequestBody
import okio.BufferedSink
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.CookieJar
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.io.InputStream
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/** 服务端返回了错误（含「今日次数已用完」这类业务错误），message 可以直接给用户看。 */
class ApiException(val status: Int, message: String) : IOException(message)

/** 发给 `/api/chat` 的一次提问。字段名与网页端的 FormData 一致。 */
data class ChatRequest(
    val message: String,
    val sessionId: String?,
    val model: String?,
    val reasoning: String?,
    val webSearch: String = "auto",
    /** 已上传附件的凭证（`uploads` 字段，JSON 数组）。 */
    val uploads: List<String> = emptyList(),
)

class StudyMateApi(
    private val baseUrl: String,
    private val cookieJar: CookieJar,
    /** 按 content:// 地址打开附件。由 Application 提供，单元测试里不需要。 */
    private val openFile: (String) -> InputStream = { throw IOException("no file access") },
) : ChatBackend, AccountBackend, NotesBackend {
    /** 身份没确定前只放一个请求（见 [IdentityGate]）；所有客户端都由 [client] 派生，都经过它。 */
    val identityGate = IdentityGate(baseUrl.toHttpUrl().host)

    private val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .addInterceptor(identityGate)
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

    // 大文件在手机网络上可能传一分多钟：不设总超时，只要求一直有进展。
    private val uploadClient: OkHttpClient = client.newBuilder()
        .writeTimeout(60, TimeUnit.SECONDS)
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
            .addFormDataPart("uploads", uploadsJson(request.uploads))
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

    // ---- 图片生成与附件 ----

    override suspend fun generateImage(request: ChatRequest): ImageResult {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("prompt", request.message)
            .apply { request.model?.let { addFormDataPart("model", it) } }
            .apply { request.reasoning?.let { addFormDataPart("reasoning", it) } }
            .apply { request.sessionId?.let { addFormDataPart("sessionId", it) } }
            .addFormDataPart("uploads", uploadsJson(request.uploads))
            .build()
        // 生成一张图常常超过一分钟，和流式回答一样不设总超时，靠取消结束。
        return send(Request.Builder().url(absoluteUrl("/api/images")).post(body), streamClient)
    }

    override suspend fun prepareUploads(files: List<LocalFile>): UploadPlan {
        val body = buildJsonObject {
            putJsonArray("files") {
                files.forEach { file ->
                    addJsonObject {
                        put("name", file.name)
                        put("type", file.mimeType)
                        put("size", file.size)
                    }
                }
            }
        }.toString()
        val plan = send<UploadPlan>(Request.Builder().url(absoluteUrl("/api/uploads")).post(body.toRequestBody(JSON)))
        if (plan.uploads.size != files.size) throw IOException("Invalid upload response.")
        return plan
    }

    override suspend fun uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: (Int) -> Unit) {
        val content = FileBody(file, openFile, onProgress)
        val request = if (mode == "local") {
            // 本机开发服务器没有配置 Blob 时，直接把字节交给它。
            Request.Builder().url(absoluteUrl("/api/uploads/local?ticket=" + URLEncoder.encode(slot.ticket, "UTF-8"))).put(content)
        } else {
            // 线上：和网页的 @vercel/blob 客户端走同一套流程。先用凭证向自己的服务器换一个只能写这一个文件的令牌，
            // 再把字节直接传给 Vercel Blob（不经过服务器函数，避开 4.5 MB 的请求上限）。
            val event = buildJsonObject {
                put("type", "blob.generate-client-token")
                putJsonObject("payload") {
                    put("pathname", slot.path)
                    put("clientPayload", slot.ticket)
                    put("multipart", false)
                }
            }.toString()
            val token = send<ClientTokenResponse>(Request.Builder().url(absoluteUrl("/api/uploads")).post(event.toRequestBody(JSON))).clientToken
            Request.Builder().url(BLOB_API + "/?pathname=" + URLEncoder.encode(slot.path, "UTF-8")).put(content)
                .header("authorization", "Bearer " + token)
                .header("x-api-version", BLOB_API_VERSION)
                // 令牌形如 vercel_blob_client_<storeId>_…，存储 ID 要单独放进请求头。
                .header("x-vercel-blob-store-id", token.split("_").getOrElse(3) { "" })
                .header("x-vercel-blob-access", "private")
                .header("x-content-type", file.mimeType)
                .header("x-content-length", file.size.toString())
        }
        val response = uploadClient.newCall(request.build()).await()
        response.use { if (!it.isSuccessful) throw it.toApiException() }
    }

    override suspend fun discardUploads(tickets: List<String>) {
        if (tickets.isEmpty()) return
        runCatching {
            val body = buildJsonObject { putJsonArray("uploads") { tickets.forEach { add(it) } } }.toString()
            client.newCall(Request.Builder().url(absoluteUrl("/api/uploads")).delete(body.toRequestBody(JSON)).build()).await().close()
        }
    }

    private fun uploadsJson(tickets: List<String>) = buildJsonArray { tickets.forEach { add(it) } }.toString()

    // ---- 笔记（列表、项目、回收站；正文由网页的 /note-embed 编辑） ----

    override suspend fun notes(): NotesList = getJson("/api/pages")

    // 与网页 use-note-pages.ts 的 create() 发送的内容相同。
    override suspend fun createNote(): NotePageSummary {
        val body = """{"title":"Untitled","icon":null,"cover":null,"coverPosition":null,"blocks":[]}"""
        return send<PageResponse>(Request.Builder().url(absoluteUrl("/api/pages")).post(body.toRequestBody(JSON))).page
    }

    override suspend fun trashNote(id: String) {
        send<JsonObjectResponse>(Request.Builder().url(absoluteUrl("/api/pages/${segment(id)}")).delete())
    }

    override suspend fun moveNote(id: String, groupId: String?) {
        val body = buildJsonObject { put("groupId", groupId) }.toString()
        send<JsonObjectResponse>(Request.Builder().url(absoluteUrl("/api/pages/${segment(id)}/group")).put(body.toRequestBody(JSON)))
    }

    override suspend fun createGroup(name: String): NoteGroupSummary {
        val body = buildJsonObject { put("name", name) }.toString()
        return send<GroupResponse>(Request.Builder().url(absoluteUrl("/api/pages/groups")).post(body.toRequestBody(JSON))).group
    }

    override suspend fun renameGroup(id: String, name: String): NoteGroupSummary {
        val body = buildJsonObject { put("name", name) }.toString()
        return send<GroupResponse>(Request.Builder().url(absoluteUrl("/api/pages/groups/${segment(id)}")).patch(body.toRequestBody(JSON))).group
    }

    override suspend fun deleteGroup(id: String) {
        send<JsonObjectResponse>(Request.Builder().url(absoluteUrl("/api/pages/groups/${segment(id)}")).delete())
    }

    override suspend fun trash(): List<NoteTrashItem> = getJson<TrashResponse>("/api/pages/trash").pages

    override suspend fun restoreNote(id: String): NotePageSummary =
        send<PageResponse>(Request.Builder().url(absoluteUrl("/api/pages/trash/${segment(id)}")).post(ByteArray(0).toRequestBody(null))).page

    override suspend fun deleteForever(id: String) {
        send<JsonObjectResponse>(Request.Builder().url(absoluteUrl("/api/pages/trash/${segment(id)}")).delete())
    }

    override suspend fun emptyTrash(before: String) {
        send<JsonObjectResponse>(Request.Builder().url(absoluteUrl("/api/pages/trash?before=" + URLEncoder.encode(before, "UTF-8"))).delete())
    }

    override fun noteEmbedUrl(pageId: String, lang: String?, model: String?, reasoning: String?): String =
        absoluteUrl(
            "/note-embed?page=" + segment(pageId) +
                (lang?.let { "&lang=$it" } ?: "") +
                (model?.let { "&model=" + segment(it) } ?: "") +
                (reasoning?.let { "&reasoning=" + segment(it) } ?: ""),
        )

    /**
     * 下载笔记里的文件（`/api/pages/files?key=…`）。文件是私有的，要带 App 的 Cookie，所以不能交给系统浏览器。
     * 拿到响应头后用文件名和类型调用 [target] 要一个输出流，再把内容写进去。服务端出错时抛 [ApiException]。
     */
    suspend fun downloadNoteFile(url: String, target: (name: String, mimeType: String) -> OutputStream): NoteFileDownload {
        val response = client.newCall(Request.Builder().url(absoluteUrl(url)).get().build()).await()
        return response.use {
            if (!it.isSuccessful) throw it.toApiException()
            val name = NoteFileLinks.fileName(it.header("Content-Disposition"), it.request.url)
            val mimeType = it.body.contentType()?.let { type -> "${type.type}/${type.subtype}" } ?: "application/octet-stream"
            withContext(Dispatchers.IO) {
                target(name, mimeType).use { out -> it.body.byteStream().copyTo(out) }
            }
            NoteFileDownload(name, mimeType)
        }
    }

    private fun segment(id: String) = URLEncoder.encode(id, "UTF-8")

    // ---- 账号 ----

    override suspend fun account(): AccountResponse = getJson("/api/account")

    override suspend fun updateProfile(displayName: String?, resetToGoogle: Boolean): AccountUser? {
        val body = if (resetToGoogle) """{"displayName":null,"icon":null}"""
        else buildJsonObject { put("displayName", displayName) }.toString()
        return send<ProfileResponse>(Request.Builder().url(absoluteUrl("/api/account")).patch(body.toRequestBody(JSON))).user
    }

    override suspend fun nativeSignInNonce(): String =
        send<NonceResponse>(Request.Builder().url(absoluteUrl("/api/native-auth/nonce")).post(ByteArray(0).toRequestBody(null))).nonce

    override suspend fun nativeSignIn(idToken: String) {
        val body = buildJsonObject { put("idToken", idToken) }.toString()
        send<ApiError>(Request.Builder().url(absoluteUrl("/api/native-auth/google")).post(body.toRequestBody(JSON)))
        identityGate.reset()
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
            // 设备 Cookie 指向的是已绑定 Google 的用户，服务端会给下一个请求签发新的匿名身份：让它单独走。
            identityGate.reset()
        }
    }

    private suspend inline fun <reified T> send(builder: Request.Builder, with: OkHttpClient = client): T {
        val response = with.newCall(builder.header("Accept", "application/json").build()).await()
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

        // Vercel Blob 的上传接口和协议版本，取自网页使用的 @vercel/blob 客户端；升级那个包时一起核对。
        private const val BLOB_API = "https://vercel.com/api/blob"
        private const val BLOB_API_VERSION = "12"
    }
}

/** 边读边传一个本地文件，并报告进度。长度固定为选文件时读到的大小，服务端按它校验。 */
private class FileBody(
    private val file: LocalFile,
    private val open: (String) -> InputStream,
    private val onProgress: (Int) -> Unit,
) : RequestBody() {
    override fun contentType(): MediaType? = file.mimeType.toMediaTypeOrNull()
    override fun contentLength(): Long = file.size

    override fun writeTo(sink: BufferedSink) {
        open(file.uri).use { input ->
            val buffer = ByteArray(64 * 1024)
            var sent = 0L
            var last = -1
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                sink.write(buffer, 0, read)
                sent += read
                val percent = if (file.size > 0) (sent * 100 / file.size).toInt().coerceIn(0, 100) else 0
                if (percent != last) {
                    last = percent
                    onProgress(percent)
                }
            }
        }
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
