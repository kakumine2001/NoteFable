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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

/** 应用 / 放弃 / 撤销 AI 的页面提案（`POST /api/proposals/:id/apply|discard|undo`）。拆成接口便于单元测试。 */
interface ProposalBackend {
    /** 应用提案，返回响应里的页面（`page`）。失败时抛出，消息是服务端原句或 null。 */
    suspend fun apply(proposalId: String): AppliedPage

    suspend fun discard(proposalId: String)

    /** 撤销已应用的提案：编辑改回应用前的内容，新建的页面（连同子页面）移进回收站。重复发送结果相同。 */
    suspend fun undo(proposalId: String): UndoneProposal
}

/** 应用提案后服务端返回的页面：[id] 是 `page.id`，[json] 是整个 `page` 对象的 JSON（转给打开着的网页编辑器）。 */
data class AppliedPage(val id: String?, val json: String?)

/** 撤销的结果：编辑提案是改回后的页面 [page]；新建提案是移进回收站的页面 ID [trashedIds]（含子页面，已撤销过的为空）。 */
data class UndoneProposal(val page: AppliedPage? = null, val trashedIds: List<String> = emptyList())

/**
 * 服务端拒绝了操作。[serverMessage] 是响应里的 `error`（英文原句），没有时界面用"无法应用修改建议。"等本地文案。
 * 提案已经在别的标签页 / 设备处理过时，[finalStatus] 是服务端的状态（applied / discarded / undone），[pageId] 是应用到的页面。
 */
class ProposalException(
    val serverMessage: String?,
    val finalStatus: String? = null,
    val pageId: String? = null,
    /** 已应用的提案能不能撤销（服务端记下了应用的版本）。 */
    val undoable: Boolean = false,
) : Exception(serverMessage)

class ProposalApi(
    private val client: OkHttpClient,
    private val absoluteUrl: (String) -> String,
) : ProposalBackend {
    override suspend fun apply(proposalId: String): AppliedPage = page(json(post(proposalId, "apply")))

    override suspend fun discard(proposalId: String) {
        post(proposalId, "discard")
    }

    // 编辑：{status:"undone", kind:"edit", page}；新建：{status:"undone", kind:"create", ids:[…]}。
    override suspend fun undo(proposalId: String): UndoneProposal {
        val body = json(post(proposalId, "undo"))
        val ids = (body?.get("ids") as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { id -> id.isString }?.content }
        return UndoneProposal(page(body).takeIf { it.json != null }, ids)
    }

    private fun json(text: String): JsonObject? = runCatching { NoteFableJson.parseToJsonElement(text) as? JsonObject }.getOrNull()

    private fun page(body: JsonObject?): AppliedPage {
        val page = body?.get("page") as? JsonObject
        val id = (page?.get("id") as? JsonPrimitive)?.takeIf { it.isString }?.content
        return AppliedPage(id, page?.toString())
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
                val body = json(text)
                fun field(name: String) = (body?.get(name) as? JsonPrimitive)?.takeIf { value -> value.isString }?.content?.takeIf { value -> value.isNotBlank() }
                val undoable = (body?.get("undoable") as? JsonPrimitive)?.takeIf { value -> !value.isString }?.content == "true"
                throw ProposalException(field("error"), field("status"), field("pageId"), undoable)
            }
            text
        }
    }
}

/** 一张提案卡片的操作状态。[error] 为 null 表示没有错误。 */
data class ProposalState(
    val status: Status = Status.Idle,
    val error: ProposalError? = null,
    /** 应用后的页面 ID（"打开"的目标）。 */
    val pageId: String? = null,
    /** 能撤销：服务端说可以（undoable），或者刚在这个 App 里应用过。 */
    val undoable: Boolean = false,
) {
    enum class Status { Idle, Applying, Discarding, Applied, Discarded, Undoing, Undone }

    /** 标题行的徽章：已应用（撤销中也是）、已放弃、已撤销；没处理时没有。 */
    enum class Badge { Done, Discarded, Undone }

    /** 已处理（应用 / 放弃 / 撤销，撤销中也算，同网页）：卡片默认最小化、变淡（网页 is-settled）。 */
    val settled: Boolean get() = status == Status.Applied || status == Status.Undoing || status == Status.Discarded || status == Status.Undone

    /** 还没处理（包括应用中、放弃中）：显示"应用"和"放弃"。 */
    val pending: Boolean get() = status == Status.Idle || status == Status.Applying || status == Status.Discarding

    val busy: Boolean get() = status == Status.Applying || status == Status.Discarding || status == Status.Undoing

    val badge: Badge?
        get() = when (status) {
            Status.Applied, Status.Undoing -> Badge.Done
            Status.Discarded -> Badge.Discarded
            Status.Undone -> Badge.Undone
            Status.Idle, Status.Applying, Status.Discarding -> null
        }

    /** 显示"撤销"：服务端说能撤销、或刚在这里应用过；撤销中是转圈。 */
    val showsUndo: Boolean get() = status == Status.Undoing || (status == Status.Applied && undoable)

    /**
     * "打开"的目标：已应用的页面，和撤销中 / 撤销了的编辑（页面还在，内容回到应用前）。
     * 撤销中 / 撤销了的新建页面要进 / 已在回收站里，不给。
     */
    fun openPageId(isEdit: Boolean): String? =
        pageId?.takeIf { status == Status.Applied || ((status == Status.Undoing || status == Status.Undone) && isEdit) }
}

/** 操作失败：[serverMessage] 是服务端原句（界面用系统文词典翻译），null 时用 [action] 对应的本地文案。 */
data class ProposalError(val action: Action, val serverMessage: String?) {
    enum class Action { Apply, Discard, Undo }
}

/**
 * 提案卡片的状态按提案 ID 存在卡片外（网页 page-proposal.tsx 的 states Map）。
 * 回答结束后重新读历史时卡片会重建，但状态还在，不会退回"未应用"。服务端保存的确定状态优先（[stateOf]）。
 */
class ProposalStore(private val backend: ProposalBackend, private val scope: CoroutineScope) {
    private val _states = MutableStateFlow<Map<String, ProposalState>>(emptyMap())
    val states: StateFlow<Map<String, ProposalState>> = _states.asStateFlow()

    private val _changes = MutableSharedFlow<ProposalChangeEvent>(extraBufferCapacity = 8)

    /** 应用、撤销成功后发出：笔记列表要刷新，打开着的页面要换成新版本或关掉。 */
    val changes: SharedFlow<ProposalChangeEvent> = _changes.asSharedFlow()

    /**
     * 卡片显示用的状态（网页的 useProposalState）：服务端说已放弃 / 已撤销时用服务端的；服务端说已应用时，
     * 只有本机的"已应用（带撤销失败的错误）/ 撤销中 / 已撤销"能盖过它；还没处理的用本机的操作状态。
     * 这样别的标签页、别的设备先处理过的结果，重读历史后就会显示出来。
     */
    fun stateOf(proposal: Proposal, local: Map<String, ProposalState> = _states.value): ProposalState {
        val initial = initialState(proposal)
        val mine = local[proposal.id]
        return when (initial.status) {
            ProposalState.Status.Discarded, ProposalState.Status.Undone -> initial
            ProposalState.Status.Applied -> mine?.takeIf {
                it.status == ProposalState.Status.Applied || it.status == ProposalState.Status.Undoing || it.status == ProposalState.Status.Undone
            } ?: initial
            else -> mine ?: initial
        }
    }

    fun apply(proposal: Proposal) {
        val before = stateOf(proposal)
        if (before.status != ProposalState.Status.Idle) return
        set(proposal.id, before.copy(status = ProposalState.Status.Applying, error = null))
        scope.launch {
            try {
                val applied = backend.apply(proposal.id)
                val pageId = when (proposal) {
                    is Proposal.Edit -> proposal.pageId
                    is Proposal.Create -> applied.id
                }
                // 刚在这里应用的都能撤销（网页同样）；真的能不能撤销，按下时服务端再确认。
                set(proposal.id, ProposalState(ProposalState.Status.Applied, pageId = pageId, undoable = true))
                _changes.tryEmit(ProposalChangeEvent(pageId, created = proposal is Proposal.Create, page = applied.json))
            } catch (e: CancellationException) {
                set(proposal.id, before.copy(error = null))
                throw e
            } catch (e: Throwable) {
                if (!settledByServer(proposal.id, before, e)) {
                    set(proposal.id, before.copy(error = ProposalError(ProposalError.Action.Apply, (e as? ProposalException)?.serverMessage)))
                }
            }
        }
    }

    fun discard(proposal: Proposal) {
        val before = stateOf(proposal)
        if (before.status != ProposalState.Status.Idle) return
        set(proposal.id, before.copy(status = ProposalState.Status.Discarding, error = null))
        scope.launch {
            try {
                backend.discard(proposal.id)
                set(proposal.id, before.copy(status = ProposalState.Status.Discarded, error = null))
            } catch (e: CancellationException) {
                set(proposal.id, before.copy(error = null))
                throw e
            } catch (e: Throwable) {
                if (!settledByServer(proposal.id, before, e)) {
                    set(proposal.id, before.copy(error = ProposalError(ProposalError.Action.Discard, (e as? ProposalException)?.serverMessage)))
                }
            }
        }
    }

    /**
     * 撤销（网页 page-proposal.tsx 的 undo）：编辑改回应用前的内容（现在的内容留在页面历史里），新建的页面移进回收站。
     * 成功后和应用一样发 [changes]：编辑带上改回后的页面（打开着就交给编辑器），新建带上移进回收站的页面 ID。
     * 失败时保持"已应用"并显示服务端原句（例如之后页面又被改过）或"无法撤销这项修改。"。
     */
    fun undo(proposal: Proposal) {
        val before = stateOf(proposal)
        if (before.status != ProposalState.Status.Applied) return
        set(proposal.id, before.copy(status = ProposalState.Status.Undoing, error = null))
        scope.launch {
            try {
                val undone = backend.undo(proposal.id)
                set(proposal.id, before.copy(status = ProposalState.Status.Undone, error = null, undoable = false))
                _changes.tryEmit(
                    when (proposal) {
                        is Proposal.Edit -> ProposalChangeEvent(proposal.pageId, created = false, page = undone.page?.json)
                        is Proposal.Create -> ProposalChangeEvent(before.pageId, created = true, trashed = undone.trashedIds)
                    },
                )
            } catch (e: CancellationException) {
                set(proposal.id, before.copy(error = null))
                throw e
            } catch (e: Throwable) {
                val final = (e as? ProposalException)?.finalStatus
                if ((final != "discarded" && final != "undone") || !settledByServer(proposal.id, before, e)) {
                    set(proposal.id, before.copy(error = ProposalError(ProposalError.Action.Undo, (e as? ProposalException)?.serverMessage)))
                }
            }
        }
    }

    /**
     * 提案已经在别处处理过（服务端返回了状态）：不显示错误、也不再出"应用 / 放弃"，卡片换成服务端的状态（网页 settledByServer）。
     * 服务端没说状态（版本冲突、网络错误等）时返回 false，照常显示错误。
     */
    private fun settledByServer(id: String, before: ProposalState, e: Throwable): Boolean {
        val failure = e as? ProposalException ?: return false
        val status = when (failure.finalStatus) {
            "applied" -> ProposalState.Status.Applied
            "discarded" -> ProposalState.Status.Discarded
            "undone" -> ProposalState.Status.Undone
            else -> return false
        }
        set(id, ProposalState(status, pageId = failure.pageId ?: before.pageId, undoable = status == ProposalState.Status.Applied && failure.undoable))
        return true
    }

    private fun set(id: String, state: ProposalState) = _states.update { it + (id to state) }

    companion object {
        fun initialState(proposal: Proposal) = ProposalState(
            status = when (proposal.status) {
                "applied" -> ProposalState.Status.Applied
                "discarded" -> ProposalState.Status.Discarded
                "undone" -> ProposalState.Status.Undone
                else -> ProposalState.Status.Idle
            },
            pageId = when (proposal) {
                is Proposal.Edit -> proposal.pageId
                is Proposal.Create -> proposal.appliedPageId
            },
            undoable = proposal.undoable,
        )
    }
}

/**
 * 应用 / 撤销提案后改动、新建或移进回收站的页面。[page] 是服务端返回的新版本（`page` 的 JSON）：改动的页面正开在编辑器里时，
 * 交给网页的 `window.notefableEmbed.pageUpdated`，和网页 notefable:page-updated 一样换成新版本（有未保存的编辑则提示冲突）。
 * [trashed]：撤销新建时移进回收站的页面（含子页面），从列表里去掉，开着的话关掉（网页 notefable:pages-trashed）。
 */
data class ProposalChangeEvent(
    val pageId: String?,
    val created: Boolean,
    val page: String? = null,
    val trashed: List<String> = emptyList(),
)
