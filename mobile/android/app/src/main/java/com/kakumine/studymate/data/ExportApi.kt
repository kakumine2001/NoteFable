package com.kakumine.studymate.data

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
}

@Serializable
data class ConversationExport(val fileName: String, val markdown: String)

class ExportApi(
    private val client: OkHttpClient,
    private val absoluteUrl: (String) -> String,
) : ExportBackend {
    override suspend fun saveAnswer(markdown: String, sessionId: String, messageId: String, savedOn: String): String {
        val body = buildJsonObject {
            put("markdown", markdown)
            put("sessionId", sessionId)
            put("messageId", messageId)
            put("savedOn", savedOn)
        }.toString().toRequestBody(StudyMateHttp.JSON)
        val text = call(Request.Builder().url(absoluteUrl("/api/pages/from-answer")).post(body))
        val page = runCatching { StudyMateJson.parseToJsonElement(text) as? JsonObject }.getOrNull()?.get("page") as? JsonObject
        // 网页：没有 page.id 也算失败（显示通用的"无法保存"）。
        return (page?.get("id") as? JsonPrimitive)?.takeIf { it.isString }?.content ?: throw ApiException(500, "HTTP 500")
    }

    override suspend fun exportConversation(sessionId: String, date: String): ConversationExport {
        val path = "/api/sessions/${encode(sessionId)}/export?date=${encode(date)}"
        val export = StudyMateJson.decodeFromString<ConversationExport>(call(Request.Builder().url(absoluteUrl(path)).get()))
        // 网页：没有消息就当作取不到会话。
        if (export.markdown.isBlank()) throw ApiException(404, "HTTP 404")
        return export
    }

    private suspend fun call(builder: Request.Builder): String {
        val response = client.newCall(builder.header("Accept", "application/json").build()).await()
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
 * 保存在 App 级的作用域里跑，离开对话也不会被取消。建好后在 [created] 里发出新笔记的 ID（网页 studymate:page-created），
 * StudyMateRoot 据此刷新笔记列表。回答的 ID 由 ChatViewModel 对账时通过 [rename] 换成服务端 ID。
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

    companion object {
        fun key(sessionId: String, messageId: String) = "$sessionId\n$messageId"
    }
}
