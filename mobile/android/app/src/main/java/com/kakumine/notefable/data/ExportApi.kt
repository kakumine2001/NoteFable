package com.kakumine.notefable.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

/**
 * 回答的"…"菜单（网页 answer-actions.tsx）：存到笔记、下载整段对话。
 * 网页在浏览器里用 answer-export.ts 生成笔记块和 Markdown；App 没有这套转换，交给服务端用同一组函数生成：
 * - `POST /api/pages/from-answer` `{ markdown, sessionId, messageId, savedOn }` → 201 `{ page }`
 * - `GET /api/sessions/:id/export?date=` → `{ fileName, markdown }`
 * savedOn / date 是本机日期（YYYY-MM-DD），出处里的日期按用户所在时区，与网页一致。
 */
interface ExportBackend {
    /** 新建笔记，返回它的 ID。失败抛 [ApiException]（status 和服务端原句）。 */
    suspend fun saveAnswer(markdown: String, sessionId: String, messageId: String, savedOn: String): String

    suspend fun exportConversation(sessionId: String, date: String): ConversationExport

    /**
     * 「整理成笔记」（网页 createPageFromChat）：`POST /api/sessions/:id/page` `{ model, savedOn }` → 201 `{ page, partial }`。
     * 失败抛 [ApiException]（status 和服务端原句）。
     */
    suspend fun createPageFromChat(sessionId: String, model: String?, savedOn: String): CreatedPage
}

@Serializable
data class ConversationExport(val fileName: String, val markdown: String)

/** 整理好的笔记。[partial]：对话太长，旧的消息或长消息的后半没用上。 */
data class CreatedPage(val id: String, val title: String, val partial: Boolean)

class ExportApi(
    private val client: OkHttpClient,
    private val absoluteUrl: (String) -> String,
) : ExportBackend {
    // 整理一段长对话要等一次完整的生成（服务端最多 300 秒）：不按普通请求的 30 / 60 秒超时断开。
    private val pageClient: OkHttpClient by lazy {
        client.newBuilder().readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
            .callTimeout(320, java.util.concurrent.TimeUnit.SECONDS).build()
    }

    override suspend fun createPageFromChat(sessionId: String, model: String?, savedOn: String): CreatedPage {
        val body = buildJsonObject {
            model?.let { put("model", it) }
            put("savedOn", savedOn)
        }.toString().toRequestBody(NoteFableHttp.JSON)
        val text = call(Request.Builder().url(absoluteUrl("/api/sessions/${encode(sessionId)}/page")).post(body), pageClient)
        // 网页：没有 page.id 也算失败（通用的"无法整理"）。
        val data = runCatching { NoteFableJson.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: throw ApiException(500, "HTTP 500")
        val page = data["page"] as? JsonObject ?: throw ApiException(500, "HTTP 500")
        val id = (page["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: throw ApiException(500, "HTTP 500")
        val title = (page["title"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
        val partial = (data["partial"] as? JsonPrimitive)?.content == "true"
        return CreatedPage(id, title, partial)
    }
    override suspend fun saveAnswer(markdown: String, sessionId: String, messageId: String, savedOn: String): String {
        val body = buildJsonObject {
            put("markdown", markdown)
            put("sessionId", sessionId)
            put("messageId", messageId)
            put("savedOn", savedOn)
        }.toString().toRequestBody(NoteFableHttp.JSON)
        val text = call(Request.Builder().url(absoluteUrl("/api/pages/from-answer")).post(body))
        val page = runCatching { NoteFableJson.parseToJsonElement(text) as? JsonObject }.getOrNull()?.get("page") as? JsonObject
        // 网页：没有 page.id 也算失败（显示通用的"无法保存"）。
        return (page?.get("id") as? JsonPrimitive)?.takeIf { it.isString }?.content ?: throw ApiException(500, "HTTP 500")
    }

    override suspend fun exportConversation(sessionId: String, date: String): ConversationExport {
        val path = "/api/sessions/${encode(sessionId)}/export?date=${encode(date)}"
        val export = NoteFableJson.decodeFromString<ConversationExport>(call(Request.Builder().url(absoluteUrl(path)).get()))
        // 网页：没有消息就当作取不到会话。
        if (export.markdown.isBlank()) throw ApiException(404, "HTTP 404")
        return export
    }

    private suspend fun call(builder: Request.Builder, with: OkHttpClient = client): String {
        val response = with.newCall(builder.header("Accept", "application/json").build()).await()
        return response.use {
            val text = withContext(Dispatchers.IO) { runCatching { it.body.string() }.getOrDefault("") }
            if (!it.isSuccessful) throw ApiException.from(it.code, text)
            text
        }
    }

    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
}

/** 存到笔记的状态（网页 SaveState）。 */
sealed interface AnswerSave {
    data object Saving : AnswerSave
    data class Saved(val pageId: String) : AnswerSave
}

/** 存到笔记失败的原因：[serverMessage] 是服务端原句（界面翻译后显示）；否则按 [tooLarge] 选本地文案。 */
data class AnswerSaveError(val tooLarge: Boolean = false, val serverMessage: String? = null)

sealed interface AnswerSaveResult {
    data object Ok : AnswerSaveResult
    /** 同一条回答已经在保存中或已保存：什么也不做（网页 { ok: "pending" }）。 */
    data object Pending : AnswerSaveResult
    data class Failed(val error: AnswerSaveError) : AnswerSaveResult
}

/** 网页 saveErrorMessage：413 → 太大；400 带服务端原句 → 原句；其余（503、网络、不是 JSON）→ "无法保存到笔记"。 */
fun answerSaveError(error: Throwable): AnswerSaveError {
    val api = error as? ApiException ?: return AnswerSaveError()
    if (api.status == 413) return AnswerSaveError(tooLarge = true)
    val message = api.message
    if (api.status == 400 && message != null && message.isNotBlank() && message != "HTTP 400") return AnswerSaveError(serverMessage = message)
    return AnswerSaveError()
}

/**
 * "存到笔记"的状态按 `会话ID\n消息ID` 存在界面外（网页模块级的 saves Map）：回答重新绘制、切换对话再回来，
 * 都还是"正在保存 / 已保存"，不会重复建笔记。和网页一样只在本次运行内记住（重开 App 就忘了，服务端不去重）。
 * 保存在 App 级的作用域里跑，离开对话也不会被取消。建好后在 [created] 里发出新笔记的 ID（网页 notefable:page-created），
 * NoteFableRoot 据此刷新笔记列表。回答的 ID 由 ChatViewModel 对账时通过 [rename] 换成服务端 ID。
 */
class AnswerExportStore(private val backend: ExportBackend, private val scope: CoroutineScope) {
    private val _saves = MutableStateFlow<Map<String, AnswerSave>>(emptyMap())
    val saves: StateFlow<Map<String, AnswerSave>> = _saves.asStateFlow()
    private val _created = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** 存到笔记成功后新笔记的 ID（在后台完成也会发出）。 */
    val created: SharedFlow<String> = _created.asSharedFlow()

    // 旧 key → 新 key（对账把 local-N 换成服务端 ID）：在途的保存完成时写到最新的 key 下。只在主线程读写。
    private val renamed = mutableMapOf<String, String>()
    // 等着写进保存位置的 Markdown，按会话：选择器开着时 Activity 重建，界面状态没了，这里还在。只在主线程读写。
    private val heldExports = mutableMapOf<String, String>()

    /** 下载整段对话（不在 App 级作用域里跑：和网页一样，离开对话就不再触发下载）。 */
    suspend fun exportConversation(sessionId: String, date: String): ConversationExport = backend.exportConversation(sessionId, date)

    fun holdExport(sessionId: String, markdown: String) {
        heldExports[sessionId] = markdown
    }

    fun takeExport(sessionId: String): String? = heldExports.remove(sessionId)

    /** 回答的 ID 从 [from] 换成 [to]：把保存状态搬过去，在途的保存完成后也记在 [to] 下。 */
    fun rename(sessionId: String, from: String, to: String) {
        if (from == to) return
        val old = key(sessionId, from)
        val new = key(sessionId, to)
        renamed[old] = new
        _saves.update { saves ->
            val value = saves[old] ?: return@update saves
            if (saves.containsKey(new)) saves - old else saves - old + (new to value)
        }
    }

    private fun current(key: String): String {
        var k = key
        while (true) k = renamed[k] ?: return k
    }

    fun save(sessionId: String, messageId: String, markdown: String, savedOn: String): Deferred<AnswerSaveResult> {
        val key = key(sessionId, messageId)
        if (_saves.value.containsKey(key)) return CompletableDeferred(AnswerSaveResult.Pending)
        _saves.update { it + (key to AnswerSave.Saving) }
        val result = CompletableDeferred<AnswerSaveResult>()
        scope.launch {
            try {
                val pageId = backend.saveAnswer(markdown, sessionId, messageId, savedOn)
                _saves.update { it - key + (current(key) to AnswerSave.Saved(pageId)) }
                _created.tryEmit(pageId)
                result.complete(AnswerSaveResult.Ok)
            } catch (e: CancellationException) {
                _saves.update { it - key - current(key) }
                result.complete(AnswerSaveResult.Failed(AnswerSaveError()))
                throw e
            } catch (e: Throwable) {
                _saves.update { it - key - current(key) }
                result.complete(AnswerSaveResult.Failed(answerSaveError(e)))
            }
        }
        return result
    }

    // ---- 整理成笔记（网页 create-page-dialog.tsx 模块级的 jobs） ----

    private val _pageJobs = MutableStateFlow<Map<String, CreatePageJob>>(emptyMap())
    /** 每个聊天的「整理成笔记」状态。窗口关掉也继续生成；重开窗口时进行中的还是同样的显示，同一聊天不会重复建。 */
    val pageJobs: StateFlow<Map<String, CreatePageJob>> = _pageJobs.asStateFlow()

    /** 开始整理（进行中就什么也不做）。完成后在 [created] 里发出新笔记的 ID，笔记列表据此刷新。 */
    fun createPage(sessionId: String, model: String?, savedOn: String) {
        if (_pageJobs.value[sessionId] is CreatePageJob.Working) return
        _pageJobs.update { it + (sessionId to CreatePageJob.Working) }
        scope.launch {
            val next = try {
                val page = backend.createPageFromChat(sessionId, model, savedOn)
                _created.tryEmit(page.id)
                CreatePageJob.Done(page.id, page.title, page.partial)
            } catch (e: CancellationException) {
                _pageJobs.update { it - sessionId }
                throw e
            } catch (e: Throwable) {
                CreatePageJob.Failed(createPageErrorMessage(e))
            }
            _pageJobs.update { it + (sessionId to next) }
        }
    }

    /** 关窗口时忘掉已结束的结果（下次打开能从继续写的对话重新整理）；进行中的留着。 */
    fun forgetFinishedPage(sessionId: String) {
        _pageJobs.update { jobs -> if (jobs[sessionId] is CreatePageJob.Working) jobs else jobs - sessionId }
    }

    /** 换身份（登录 / 退出）时清掉结果：别的身份的笔记打不开。进行中的请求跑完会再写回，网页刷新页面后也一样看不到。 */
    fun clearPageJobs() {
        _pageJobs.value = emptyMap()
    }

    companion object {
        fun key(sessionId: String, messageId: String) = "$sessionId\n$messageId"
    }
}

/** 「整理成笔记」的状态（网页 CreatePageJob）。 */
sealed interface CreatePageJob {
    data object Working : CreatePageJob
    data class Done(val pageId: String, val title: String, val partial: Boolean) : CreatePageJob
    /** [message] 是英文原句（服务端的，或网页的兜底句），界面经系统文词典翻译。 */
    data class Failed(val message: String) : CreatePageJob
}

/** 网页 createPageErrorMessage 的兜底句。 */
const val CREATE_PAGE_FAILED = "Could not create a page from this chat. Try again."

/**
 * 网页 createPageErrorMessage：只有上限（429）、校验（400 / 413）的服务端原句照样显示；会话不存在（404）是 "Session not found."；
 * 其余（5xx、网络错误、回复不对）都是通用的兜底句。
 */
fun createPageErrorMessage(error: Throwable): String {
    val api = error as? ApiException ?: return CREATE_PAGE_FAILED
    val message = api.serverMessage()
    if (api.status in setOf(400, 413, 429) && message != null) return message
    if (api.status == 404) return "Session not found."
    return CREATE_PAGE_FAILED
}
