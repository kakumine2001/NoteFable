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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

/** 应用 / 放弃 AI 的笔记提案（`POST /api/proposals/:id/apply|discard`）。拆成接口便于单元测试。 */
interface ProposalBackend {
    /** 应用提案，返回响应里的笔记（`page`）。失败时抛出，消息是服务端原句或 null。 */
    suspend fun apply(proposalId: String): AppliedPage

    suspend fun discard(proposalId: String)
}

/** 应用提案后服务端返回的笔记：[id] 是 `page.id`，[json] 是整个 `page` 对象的 JSON（转给打开着的网页编辑器）。 */
data class AppliedPage(val id: String?, val json: String?)

/** 服务端拒绝了操作。[serverMessage] 是响应里的 `error`（英文原句），没有时界面用"无法应用修改建议。"。 */
class ProposalException(val serverMessage: String?) : Exception(serverMessage)

class ProposalApi(
    private val client: OkHttpClient,
    private val absoluteUrl: (String) -> String,
) : ProposalBackend {
    override suspend fun apply(proposalId: String): AppliedPage {
        val body = post(proposalId, "apply")
        val page = runCatching { NoteFableJson.parseToJsonElement(body) as? JsonObject }.getOrNull()?.get("page") as? JsonObject
        val id = (page?.get("id") as? JsonPrimitive)?.takeIf { it.isString }?.content
        return AppliedPage(id, page?.toString())
    }

    override suspend fun discard(proposalId: String) {
        post(proposalId, "discard")
    }

    private suspend fun post(proposalId: String, action: String): String {
        val path = "/api/proposals/${URLEncoder.encode(proposalId, "UTF-8").replace("+", "%20")}/$action"
        val request = Request.Builder().url(absoluteUrl(path))
            .post(ByteArray(0).toRequestBody(null))
            .header("Accept", "application/json")
            .build()
        val response = client.newCall(request).await()
        return response.use {
            val text = withContext(Dispatchers.IO) { runCatching { it.body.string() }.getOrDefault("") }
            if (!it.isSuccessful) {
                val error = runCatching { NoteFableJson.decodeFromString<ApiError>(text) }.getOrNull()?.error
                throw ProposalException(error?.takeIf { message -> message.isNotBlank() })
            }
            text
        }
    }
}

/** 一张提案卡片的操作状态。[error] 为 null 表示没有错误；空字符串表示用本地的"无法应用 / 放弃"文案。 */
data class ProposalState(
    val status: Status = Status.Idle,
    val error: ProposalError? = null,
    /** 应用后的笔记 ID（"打开笔记"的目标）。 */
    val pageId: String? = null,
) {
    enum class Status { Idle, Applying, Discarding, Applied, Discarded }

    val settled: Boolean get() = status == Status.Applied || status == Status.Discarded
    val busy: Boolean get() = status == Status.Applying || status == Status.Discarding
}

/** 操作失败：[serverMessage] 是服务端原句（界面用系统文词典翻译），null 时用 [action] 对应的本地文案。 */
data class ProposalError(val action: Action, val serverMessage: String?) {
    enum class Action { Apply, Discard }
}

/**
 * 提案卡片的状态按提案 ID 存在卡片外（网页 page-edit-proposal.tsx 的 states Map）。
 * 回答结束后重新读历史时卡片会重建，但状态还在，不会退回"未应用"。服务端保存的确定状态（已应用 / 已放弃）优先。
 */
class ProposalStore(private val backend: ProposalBackend, private val scope: CoroutineScope) {
    private val _states = MutableStateFlow<Map<String, ProposalState>>(emptyMap())
    val states: StateFlow<Map<String, ProposalState>> = _states.asStateFlow()

    private val _changes = MutableSharedFlow<ProposalChangeEvent>(extraBufferCapacity = 8)

    /** 应用成功后发出：笔记列表要刷新，打开着的笔记要重读。 */
    val changes: SharedFlow<ProposalChangeEvent> = _changes.asSharedFlow()

    /** 卡片显示用的状态：服务端已确定的结果优先，否则用本机的操作状态（网页的 useProposalState）。 */
    fun stateOf(proposal: Proposal, local: Map<String, ProposalState> = _states.value): ProposalState {
        val initial = initialState(proposal)
        return if (initial.settled) initial else local[proposal.id] ?: initial
    }

    fun apply(proposal: Proposal) {
        if (stateOf(proposal).status != ProposalState.Status.Idle) return
        set(proposal.id, ProposalState(ProposalState.Status.Applying))
        scope.launch {
            try {
                val applied = backend.apply(proposal.id)
                val pageId = when (proposal) {
                    is Proposal.Edit -> proposal.pageId
                    is Proposal.Create -> applied.id
                }
                set(proposal.id, ProposalState(ProposalState.Status.Applied, pageId = pageId))
                _changes.tryEmit(ProposalChangeEvent(pageId, created = proposal is Proposal.Create, page = applied.json))
            } catch (e: CancellationException) {
                set(proposal.id, ProposalState())
                throw e
            } catch (e: Throwable) {
                set(proposal.id, ProposalState(error = ProposalError(ProposalError.Action.Apply, (e as? ProposalException)?.serverMessage)))
            }
        }
    }

    fun discard(proposal: Proposal) {
        if (stateOf(proposal).status != ProposalState.Status.Idle) return
        set(proposal.id, ProposalState(ProposalState.Status.Discarding))
        scope.launch {
            try {
                backend.discard(proposal.id)
                set(proposal.id, ProposalState(ProposalState.Status.Discarded))
            } catch (e: CancellationException) {
                set(proposal.id, ProposalState())
                throw e
            } catch (e: Throwable) {
                set(proposal.id, ProposalState(error = ProposalError(ProposalError.Action.Discard, (e as? ProposalException)?.serverMessage)))
            }
        }
    }

    private fun set(id: String, state: ProposalState) = _states.update { it + (id to state) }

    companion object {
        fun initialState(proposal: Proposal) = ProposalState(
            status = when (proposal.status) {
                "applied" -> ProposalState.Status.Applied
                "discarded" -> ProposalState.Status.Discarded
                else -> ProposalState.Status.Idle
            },
            pageId = when (proposal) {
                is Proposal.Edit -> proposal.pageId
                is Proposal.Create -> proposal.appliedPageId
            },
        )
    }
}

/**
 * 应用提案后改动或新建的笔记。[page] 是服务端返回的新版本（`page` 的 JSON）：改动的笔记正开在编辑器里时，
 * 交给网页的 `window.notefableEmbed.pageUpdated`，和网页 notefable:page-updated 一样换成新版本（有未保存的编辑则提示冲突）。
 */
data class ProposalChangeEvent(val pageId: String?, val created: Boolean, val page: String? = null)
