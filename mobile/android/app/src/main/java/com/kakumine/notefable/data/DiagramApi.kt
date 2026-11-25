package com.kakumine.notefable.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
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
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * 「画成图」（#153，网页 draw-diagram-dialog.tsx）：AI 把聊天里已保存的回答或一篇笔记画成可编辑的图，存成新的白板。
 * `POST /api/pages/diagram` `{ source: "answer", messageId } | { source: "note", pageId }` + `model?` + `clientRequestId`
 * → 201 `{ page, partial? }`（新白板的一览形；笔记来的是那篇的子页面）/ 200 `{ page }`（同一个 clientRequestId 的重放，不再扣次数）。
 * 失败：400 / 404 / 413 / 429 带服务端原句；422 `{ error, code: "diagram_invalid", source }`（转换不了，source 是 Mermaid 原文）；
 * 502 / 503 是通用句。失败的都退还次数。规则见 docs/architecture/chat-flow.md 的「画成图」。
 */
sealed interface DiagramSource {
    /** 任务的 key（网页 jobs 的 key）：`answer:会话ID\n消息ID` 或 `note:笔记ID`。 */
    val key: String

    /** 聊天里已保存的回答（服务端 ID，不是 local-N）。 */
    data class Answer(val sessionId: String, val messageId: String) : DiagramSource {
        override val key: String get() = "answer:$sessionId\n$messageId"
    }

    /** 一篇笔记（服务端读已保存的内容，所以开始前先让编辑器存上）。 */
    data class Note(val pageId: String) : DiagramSource {
        override val key: String get() = "note:$pageId"
    }
}

/** 画好的白板。[partial]：素材太长，只画了前面一部分。 */
data class DrawnDiagram(val page: NotePageSummary, val partial: Boolean)

interface DiagramBackend {
    /**
     * 画成图。[clientRequestId] 每个任务一个，重试时不变：上次其实建好了（只是回复丢了）时服务端返回那一页，不重复建、不再扣次数。
     * 失败抛 [ApiException]（status 和服务端原句）；422 转换不了时抛 [DiagramInvalidException]（带 Mermaid 原文）。
     */
    suspend fun drawDiagram(source: DiagramSource, model: String?, clientRequestId: String): DrawnDiagram
}

/** 422 diagram_invalid：AI 写的图转换不成可编辑的图形。[mermaid] 是它写的原文（"复制图的源码"用）。 */
class DiagramInvalidException(val error: ApiException, val mermaid: String) : IOException(error.message, error)

@Serializable
private data class DiagramResponse(val page: NotePageSummary? = null, val partial: Boolean = false)

class DiagramApi(
    private val client: OkHttpClient,
    private val absoluteUrl: (String) -> String,
) : DiagramBackend {
    // 画一张图要等一次完整的生成（转换不了时再让 AI 改一次，服务端最多 300 秒）：和「整理成笔记」一样不按普通请求的超时断开。
    private val diagramClient: OkHttpClient by lazy {
        client.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).callTimeout(320, TimeUnit.SECONDS).build()
    }

    override suspend fun drawDiagram(source: DiagramSource, model: String?, clientRequestId: String): DrawnDiagram {
        val body = buildJsonObject {
            when (source) {
                is DiagramSource.Answer -> {
                    put("source", "answer")
                    put("messageId", source.messageId)
                }
                is DiagramSource.Note -> {
                    put("source", "note")
                    put("pageId", source.pageId)
                }
            }
            model?.let { put("model", it) }
            put("clientRequestId", clientRequestId)
        }.toString().toRequestBody(NoteFableHttp.JSON)
        val request = Request.Builder().url(absoluteUrl("/api/pages/diagram")).post(body).header("Accept", "application/json").build()
        val (status, text) = diagramClient.newCall(request).await().use { response ->
            response.code to withContext(Dispatchers.IO) { runCatching { response.body.string() }.getOrDefault("") }
        }
        if (status !in 200..299) {
            val error = ApiException.from(status, text)
            if (status == 422 && error.code == DIAGRAM_INVALID_CODE) {
                val mermaid = runCatching { (NoteFableJson.parseToJsonElement(text) as? JsonObject)?.get("source") as? JsonPrimitive }
                    .getOrNull()?.takeIf { it.isString }?.content
                if (!mermaid.isNullOrBlank()) throw DiagramInvalidException(error, mermaid)
            }
            throw error
        }
        // 网页：没有 page.id 也算失败（通用的"没能画成图"）。
        val data = runCatching { NoteFableJson.decodeFromString<DiagramResponse>(text) }.getOrNull()
        val page = data?.page?.takeIf { it.id.isNotBlank() } ?: throw ApiException(500, "HTTP 500")
        return DrawnDiagram(page, data.partial)
    }

    companion object {
        const val DIAGRAM_INVALID_CODE = "diagram_invalid"
    }
}

/** 「画成图」任务的状态（网页 DiagramJob）。[requestId] 是这个任务的 clientRequestId，重试时沿用。 */
sealed interface DiagramJob {
    val source: DiagramSource
    val requestId: String

    data class Working(override val source: DiagramSource, override val requestId: String) : DiagramJob

    data class Done(
        override val source: DiagramSource,
        override val requestId: String,
        val page: NotePageSummary,
        val partial: Boolean,
    ) : DiagramJob

    /**
     * [message] 是英文原句（服务端的，或兜底句），界面经系统文词典翻译。
     * [mermaid]：422 转换不了时 AI 写的 Mermaid 原文，有它时窗口里多一个"复制图的源码"。
     */
    data class Failed(
        override val source: DiagramSource,
        override val requestId: String,
        val message: String,
        val mermaid: String? = null,
    ) : DiagramJob
}

/** 网页 diagramErrorMessage 的兜底句。 */
const val DIAGRAM_FAILED = "Could not draw a diagram. Try again."

/**
 * 和「整理成笔记」同样的规则：校验（400 / 413）、找不到（404）、转换不了（422）、上限（429）显示服务端原句；
 * 其余（5xx、网络错误、回复不对）都是通用的兜底句。
 */
fun diagramErrorMessage(error: Throwable): String {
    val api = (error as? DiagramInvalidException)?.error ?: error as? ApiException ?: return DIAGRAM_FAILED
    val message = api.serverMessage()
    if (api.status in setOf(400, 404, 413, 422, 429) && message != null) return message
    return DIAGRAM_FAILED
}

/**
 * 「画成图」的任务按素材存在界面外（网页模块级的 jobs，key 见 [DiagramSource.key]）：窗口关掉也继续画，
 * 再从菜单选同一份素材时重开同一个任务，不另起一个。在 App 级的作用域里跑，离开对话、笔记也不会被取消。
 * 画好后在 [created] 里发出新白板（网页 notefable:page-created），NoteFableRoot 据此刷新笔记列表。只在主线程读写。
 */
class DiagramStore(
    private val backend: DiagramBackend,
    private val scope: CoroutineScope,
    private val newRequestId: () -> String = { UUID.randomUUID().toString() },
) {
    private val _jobs = MutableStateFlow<Map<String, DiagramJob>>(emptyMap())
    val jobs: StateFlow<Map<String, DiagramJob>> = _jobs.asStateFlow()
    private val _created = MutableSharedFlow<NotePageSummary>(extraBufferCapacity = 8)
    /** 画好的新白板（窗口关着、在后台画完也会发出）。 */
    val created: SharedFlow<NotePageSummary> = _created.asSharedFlow()

    // 换身份的次数。进行中的任务按开始时的值判断结果还要不要。
    private var generation = 0

    /**
     * 开始画 [source]，返回任务的 key（窗口按它显示）。这份素材已经有任务（进行中、画好了或失败了）时不另起，
     * 窗口重开在那个任务上；关窗口忘掉已结束的任务后再选，才是新的任务（新的 clientRequestId）。
     */
    fun start(source: DiagramSource, model: String?): String {
        val key = source.key
        if (_jobs.value[key] == null) launchJob(source, model, newRequestId())
        return key
    }

    /** 先做 [prepare]（笔记：让编辑器把这篇存上），成功了才 [start]。返回任务的 key；没准备好时 null（不开始）。 */
    suspend fun startWhenReady(source: DiagramSource, model: String?, prepare: suspend () -> Boolean): String? =
        if (prepare()) start(source, model) else null

    /** 失败后"重试"：沿用同一个 clientRequestId（上次其实建好了的话服务端直接返回那一页，不重复建、不再扣次数）。 */
    fun retry(key: String, model: String?) {
        val failed = _jobs.value[key] as? DiagramJob.Failed ?: return
        launchJob(failed.source, model, failed.requestId)
    }

    private fun launchJob(source: DiagramSource, model: String?, requestId: String) {
        val key = source.key
        _jobs.update { it + (key to DiagramJob.Working(source, requestId)) }
        val startedIn = generation
        scope.launch {
            val next = try {
                val drawn = backend.drawDiagram(source, model, requestId)
                if (startedIn == generation) _created.tryEmit(drawn.page)
                DiagramJob.Done(source, requestId, drawn.page, drawn.partial)
            } catch (e: CancellationException) {
                _jobs.update { it - key }
                throw e
            } catch (e: Throwable) {
                DiagramJob.Failed(source, requestId, diagramErrorMessage(e), (e as? DiagramInvalidException)?.mermaid)
            }
            // 期间换过身份：结果不留（那张白板是别的身份的，打不开），只把"进行中"去掉。
            _jobs.update { if (startedIn == generation) it + (key to next) else it - key }
        }
    }

    /** 关窗口：忘掉已结束的任务（下次再选是新的任务）；进行中的留着，重开窗口还是它。 */
    fun dismiss(key: String) {
        _jobs.update { jobs -> if (jobs[key] is DiagramJob.Working) jobs else jobs - key }
    }

    /**
     * 换身份（登录 / 退出）时清掉已结束的结果（别的身份的白板打不开）。进行中的留着、直到它结束（结果不再要）：
     * 这期间又选了同一份素材时不会再发一次。
     */
    fun clear() {
        generation++
        _jobs.update { jobs -> jobs.filterValues { it is DiagramJob.Working } }
    }
}
