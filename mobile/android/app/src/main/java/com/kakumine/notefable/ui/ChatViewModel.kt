package com.kakumine.notefable.ui

import androidx.lifecycle.createSavedStateHandle

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.AttachError
import com.kakumine.notefable.data.AttachmentDto
import com.kakumine.notefable.data.ChatQuote
import com.kakumine.notefable.data.LocalFile
import com.kakumine.notefable.data.attachmentError
import com.kakumine.notefable.data.selectionError
import com.kakumine.notefable.data.ChatBackend
import com.kakumine.notefable.data.ChatLink
import com.kakumine.notefable.data.ChatProjectNote
import com.kakumine.notefable.data.MAX_MESSAGE_NOTES
import com.kakumine.notefable.data.ChatRequest
import com.kakumine.notefable.data.ChatStreamEvent
import com.kakumine.notefable.data.Activity
import com.kakumine.notefable.data.ActivityEvent
import com.kakumine.notefable.data.ActivityStep
import com.kakumine.notefable.data.CharacterOutcome
import com.kakumine.notefable.data.CharacterState
import com.kakumine.notefable.data.deriveTurnCharacterState
import com.kakumine.notefable.data.FailureInfo
import com.kakumine.notefable.data.Proposal
import com.kakumine.notefable.data.GeneratedImageDto
import com.kakumine.notefable.data.MessageDto
import com.kakumine.notefable.data.MessageVersions
import com.kakumine.notefable.data.ModelInfo
import com.kakumine.notefable.data.SessionSummary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class MessageRole { User, Assistant, System }

data class UiMessage(
    val id: String,
    val role: MessageRole,
    val content: String,
    val attachments: List<AttachmentDto> = emptyList(),
    val images: List<GeneratedImageDto> = emptyList(),
    /** 提问时添加的笔记（网页 Message.pages），点一下打开那篇笔记。 */
    val pages: List<ChatProjectNote> = emptyList(),
    val streaming: Boolean = false,
    /** 生成这条回答的模型 ID，用来在回答上方显示"NoteFable · 模型名"。 */
    val modelId: String? = null,
    /** 请求失败时的原因（服务端或网络给出的文字），界面再套本地化外壳。 */
    val errorDetail: String? = null,
    val thinkingMs: Long? = null,
    /** 正在生成图片：显示占位卡片而不是转圈。 */
    val generatingImage: Boolean = false,
    /** 图片生成回合（失败后 generatingImage 变回 false、images 为空时仍保留，避免误显示文字聊天模型名或允许按文字改写）。 */
    val imageTurn: Boolean = generatingImage || images.isNotEmpty(),
    /** 服务端在正文末尾追加的"Request failed: …"的位置（activity 里的 failure），界面据此换成译文。 */
    val failure: FailureInfo? = null,
    /**
     * 当日使用次数已用完（429 usage_limit）。和网页一样：正文换成服务端的英文原句，界面只翻译、
     * 当普通回答显示，不套"请求失败："也不标红（chat-message.tsx 的 usageLimit 分支）。
     */
    val usageLimit: Boolean = false,
    /** 推理、搜索、笔记工具、项目上下文与提案（data/Activity.kt）。流里实时合并，历史里从 activity 读出。 */
    val activity: List<ActivityStep> = emptyList(),
    /** 服务端保存的提案（历史的 proposals 字段）；流里新出的提案在 [activity] 里。 */
    val proposals: List<Proposal> = emptyList(),
    /** 开始等待回答的时刻（System.currentTimeMillis），进度条的"已等 N 秒"用。 */
    val startedAt: Long? = null,
    /**
     * 列表项的 key（LazyColumn）。默认等于 [id]；发送后对账把 `local-N` 换成服务端 ID 时沿用原来的 key，
     * 这一回合的界面状态（回答"…"菜单的保存、下载、保存位置选择）就不会因为换 ID 被丢掉（网页的临时 ID 留到切换对话为止）。
     */
    val key: String = id,
    /** 这条消息还有别的版本（编辑过的提问、重新生成的回答）时的位置和前后版本；只有一个版本时为空。 */
    val versions: MessageVersions? = null,
) {
    /** 图片生成回合（生成中、已完成或生成失败）：回答顶部不标文字聊天模型名，提问不开放按文字改写。 */
    val isImageAnswer: Boolean
        get() = imageTurn || generatingImage || images.isNotEmpty()
}

/** 发送前上传附件的进度（网页输入栏下方的那一行）。 */
sealed interface UploadProgress {
    data object Preparing : UploadProgress
    data class Uploading(val index: Int, val total: Int, val name: String, val percent: Int) : UploadProgress
}

/** 输入栏上方的提示。 */
sealed interface ComposerNotice {
    /** 新选的文件整批没有加进去。 */
    data class Rejected(val error: AttachError) : ComposerNotice
    data object UploadFailed : ComposerNotice
    /** 打开已有缓存的聊天时读历史失败（网页 "Failed to load conversation."）：缓存照常显示。 */
    data object LoadFailed : ComposerNotice
    /** 聊天图标没保存成功（网页 "Failed to change the chat icon."，显示在输入栏上方）。 */
    data object IconFailed : ComposerNotice
    /** 链接（?chat=）里的 ID 不对：网页在输入栏上方显示 "Failed to load conversation."。 */
    data object LinkFailed : ComposerNotice
    /** 生成图片时不能带笔记（网页 sendMessage 的同名检查）：不悄悄丢掉，让用户自己移除。 */
    data object PagesInImageMode : ComposerNotice
    /** 放回被拒的提问后笔记超过上限（网页同样不悄悄删减）。 */
    data object TooManyPages : ComposerNotice
    /** 编辑、重新生成、切换版本或分支没成功（网页 setSendError(detail)）：[detail] 是服务端或字典里的英文原句，界面翻译。 */
    data class Failed(val detail: String) : ComposerNotice
}

/** 打开聊天后要滚到并闪一下的消息（检索结果、?chat=&message= 链接）。[token] 区分同一条消息的多次请求。 */
data class MessageReveal(val sessionId: String, val messageId: String, val token: Long)

data class ChatUiState(
    val sessions: List<SessionSummary> = emptyList(),
    val sessionsLoading: Boolean = true,
    val sessionsFailed: Boolean = false,
    /** 空表示还没读到（或服务端没有 /api/models）；这时请求不带模型，由服务端用默认值。 */
    val models: List<ModelInfo> = emptyList(),
    val defaultModelId: String? = null,
    val chosenModelId: String? = null,
    val chosenReasoning: String? = null,
    val activeSessionId: String? = null,
    val messages: List<UiMessage> = emptyList(),
    val messagesLoading: Boolean = false,
    val messagesFailed: Boolean = false,
    /** 当前看着的聊天正在发送（上传附件或等待 / 接收回答）；别的聊天在后台生成时不影响这里。 */
    val sending: Boolean = false,
    /** 已经按了停止，正在等服务端把已生成的部分存好、结束回答：停止键这时不能再点（网页的 stopping）。 */
    val stopping: Boolean = false,
    /** 发出去但被拒绝的改写（上限、断网等）：那条提问的编辑框带着这段文字重新打开，写的字不丢（网页 rejectedEdit）。 */
    val rejectedEdit: RejectedEdit? = null,
    /** 选好、还没发送的附件。 */
    val files: List<LocalFile> = emptyList(),
    /** 下一条消息要添加的笔记（ID、标题、图标）。正文由服务端每次发送时重新读取（网页 attachedPages）。 */
    val attachedPages: List<ChatProjectNote> = emptyList(),
    /** 从回答里选中、点「问 NoteFable」引用的文字。发送时作为引用块放在正文前面（[ChatQuote]，网页 quote）。 */
    val quote: String? = null,
    /** 「生成图片」模式：下一条消息交给图片接口。 */
    val imageMode: Boolean = false,
    val upload: UploadProgress? = null,
    val notice: ComposerNotice? = null,
    /** 每成功发出一条消息加一；输入栏据此清空草稿（上传失败时不清，文字还在）。 */
    val sentCount: Int = 0,
    /** 当前（还没保存的）新聊天里先选的图标（网页 draftIcon）：会话建好后再保存到它上面。 */
    val draftIcon: String? = null,
    /** 等消息读完后要定位的消息（Batch 4）。 */
    val reveal: MessageReveal? = null,
    /**
     * 未登录用户撞到当日上限（429 usage_limit、tier = guest）时是 "chat" 或 "image"：
     * 输入栏上方显示登录提示（网页 GuestLimitPrompt）。关掉、登录或退出后清空。
     */
    val guestLimit: String? = null,
    /** 免费用户撞到上限（tier = member）时是 "chat" 或 "image"：输入栏上方显示 Pro 的升级提示（网页 UpgradePrompt）。 */
    val upgradeLimit: String? = null,
    /** 还在拷贝、校验的附件（粘贴的图片、刚选的文件）有几批；没处理完前不能发送，否则它们会漏掉、跑到下一条里。 */
    val importing: Int = 0,
    /**
     * 正在发送（上传附件或生成回答）的聊天的会话 ID，包括后台的（切换聊天不会停掉它们）。[sending] 只说当前聊天。
     * 还没拿到会话 ID 的新聊天不在里面。侧栏据此不让删生成中的聊天。
     */
    val generatingSessionIds: Set<String> = emptySet(),
    /** 当前聊天的角色完成 / 出错短暂状态反馈（网页 characterOutcome）。 */
    val characterOutcome: CharacterOutcome? = null,
) {
    private val hasActiveTurnOutput: Boolean
        get() {
            val last = messages.lastOrNull() ?: return false
            if (last.role != MessageRole.Assistant) return false
            return last.content.isNotEmpty() ||
                last.images.isNotEmpty() ||
                last.proposals.isNotEmpty() ||
                last.activity.any { it is ActivityStep.ProposalStep }
        }

    fun heroCharacterState(isTyping: Boolean = false, hidden: Boolean = false): CharacterState =
        deriveTurnCharacterState(
            isBusy = sending || upload != null,
            isStopping = stopping,
            hasOutput = hasActiveTurnOutput,
            outcome = characterOutcome,
            isTyping = isTyping,
            hidden = hidden,
        )

    fun activeReplyCharacterState(hidden: Boolean = false): CharacterState =
        deriveTurnCharacterState(
            isBusy = sending && upload == null,
            isStopping = stopping,
            hasOutput = hasActiveTurnOutput,
            outcome = characterOutcome,
            hidden = hidden,
        )
    /** 图片交给图片接口时不受聊天模型限制。 */
    val supportsImages: Boolean
        get() = imageMode || selectedModel?.supportsImageInput != false

    /** 当前这组附件不能发送的原因（例如换成了不能读图的模型）。 */
    val filesError: AttachError?
        get() = attachmentError(files, supportsImages)

    val selectedModel: ModelInfo?
        get() = models.firstOrNull { it.id == chosenModelId }
            ?: models.firstOrNull { it.id == defaultModelId }
            ?: models.firstOrNull()

    val selectedReasoning: String?
        get() {
            val model = selectedModel ?: return null
            return chosenReasoning?.takeIf { it in model.reasoningEfforts } ?: model.defaultReasoning
        }

    val activeTitle: String?
        get() = sessions.firstOrNull { it.id == activeSessionId }?.title

    /** 当前聊天的图标；还没保存的新聊天是草稿图标。 */
    val activeIcon: String?
        get() = if (activeSessionId == null) draftIcon else sessions.firstOrNull { it.id == activeSessionId }?.icon
}

/** 被拒绝的改写：哪条提问、写了什么。 */
data class RejectedEdit(val messageId: String, val text: String)

/** 模型和推理强度的选择要在重开 App 后保留。 */
interface SettingsStore {
    var modelId: String?
    var reasoning: String?
}

class PrefsSettingsStore(context: Context) : SettingsStore {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    override var modelId: String?
        get() = prefs.getString("modelId", null)
        set(value) = prefs.edit().putString("modelId", value).apply()
    override var reasoning: String?
        get() = prefs.getString("reasoning", null)
        set(value) = prefs.edit().putString("reasoning", value).apply()
}

class ChatViewModel(
    private val backend: ChatBackend,
    private val settings: SettingsStore,
    /** 流式文字攒一小段再刷新界面，避免每个 token 都触发一次重组。 */
    private val flushIntervalMs: Long = 40,
    /** 线上 /api/models 读不到（例如网站还没发布这个接口）时用的后备列表，来自安装包自带的 models.json。 */
    private val bundledModels: () -> com.kakumine.notefable.data.ModelsResponse? = { null },
    /** 草稿也存进这里，App 在后台被系统杀掉后回来仍在（和原来的 rememberSaveable 一样）。 */
    private val savedState: androidx.lifecycle.SavedStateHandle = androidx.lifecycle.SavedStateHandle(),
    /** 保存聊天图标（PATCH /api/sessions/:id {icon}），返回是否成功。 */
    saveIcon: suspend (sessionId: String, icon: String?) -> Boolean = { _, _ -> false },
    /**
     * 对账把一条消息的本地 ID（`local-N`）换成服务端 ID 时调用（会话 ID、旧 ID、新 ID）。后台聊天的对账也会调用。
     * "存到笔记"的状态据此搬到新 ID 下，不依赖那条回答此刻是否在屏幕上（AnswerExportStore.rename）。主线程调用。
     */
    private val onMessageIdChanged: (sessionId: String, from: String, to: String) -> Unit = { _, _, _ -> },
) : ViewModel() {
    private val _state = MutableStateFlow(
        // 引用和草稿一起存进 SavedStateHandle：进程被系统回收后（比如登录时离开了 App），提问和它引用的文字一起回来。
        ChatUiState(chosenModelId = settings.modelId, chosenReasoning = settings.reasoning, quote = savedState.get<String>(QUOTE_KEY)),
    )
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    /**
     * 输入栏里还没发出的文字。放在 ViewModel 里，切到笔记再切回来、换屏幕方向都还在。
     * 用 Compose 的状态而不是 StateFlow：输入框每次按键同步更新，光标不会跳。
     */
    var draft by mutableStateOf(savedState.get<String>(DRAFT_KEY) ?: "")
        private set

    fun updateDraft(text: String) {
        val changed = text != draft
        draft = text
        savedState[DRAFT_KEY] = text
        val activeKey = keyOf(_state.value)
        if (changed && outcomes[activeKey] == CharacterOutcome.Error) {
            flashOutcome(activeKey, null)
        }
    }

    // ---- 每个聊天各自的消息与回答（网页 page.tsx 的 sessionMessagesRef / streamingSessionsRef） ----
    //
    // 切换聊天、开新聊天都不停掉正在生成的回答：每个聊天有自己的消息缓存和自己的流，界面只显示当前聊天那一份。
    // 键是会话 ID；还没有 ID 的新聊天用本机键（每开一次新聊天换一个），拿到 X-Session-Id 后迁到真正的 ID 下。
    // 这些表只在主线程上读写（viewModelScope）。

    /** 当前新聊天的本机键。和网页不同（网页发送前先建好会话），所以每次开新聊天换一个，免得两个新聊天共用一份缓存。 */
    private var newChatKey = "$NEW_CHAT_PREFIX${0}"
    private var newChats = 0L

    /** 每个聊天显示的消息（含进行中的回答）。 */
    private val cache = mutableMapOf<String, List<UiMessage>>()

    /**
     * 正在发送（上传附件或等待 / 接收回答）的聊天 → 它的任务。通常一个聊天只有一个；新聊天拿到会话 ID 之前，
     * 用户可能已经从侧栏打开了这个会话并又发了一条，迁过来后这个聊天下就有两个，停止键两个都停。
     */
    private val streams = mutableMapOf<String, MutableList<Job>>()

    private fun addStream(key: String, job: Job) {
        streams.getOrPut(key) { mutableListOf() } += job
    }

    private fun removeStream(key: String, job: Job): Boolean {
        val jobs = streams[key] ?: return false
        val removed = jobs.remove(job)
        if (jobs.isEmpty()) streams.remove(key)
        return removed
    }

    /** 回答正常结束后用服务器版本对账的请求，按会话 ID 各一个。 */
    private val reconcileJobs = mutableMapOf<String, Job>()

    /**
     * 还没有会话 ID 的新聊天先选的图标（网页 draftIcon），按新聊天的本机键存：发出去后用户去了别的聊天，
     * 拿到 X-Session-Id 时图标仍跟着这次发送迁过去并保存（网页 send 里的 sentIcon / latestIcon）。
     */
    private val draftIcons = mutableMapOf<String, String>()

    private val iconSync = SessionIconSync(saveIcon)

    /** 登录 / 退出后加一：旧身份下还在收尾的回答不再写进缓存。 */
    private var epoch = 0L

    private var loadJob: Job? = null
    private var sessionsJob: Job? = null
    private var localIds = 0L

    private fun keyOf(state: ChatUiState) = state.activeSessionId ?: newChatKey

    /** 写入某个聊天的消息；是当前聊天就同时更新界面。 */
    private fun setCached(key: String, messages: List<UiMessage>) {
        cache[key] = messages
        _state.update { if (keyOf(it) == key) it.copy(messages = messages) else it }
    }

    private fun updateCached(key: String, transform: (List<UiMessage>) -> List<UiMessage>) {
        setCached(key, transform(cache[key] ?: emptyList()))
    }

    /**
     * 服务器版本换掉某个聊天的缓存（打开时的读取、重试、检索前补读、回答结束后的对账，前台后台都一样）：
     * 沿用本地 key 并报告换掉的 ID，行不会重建，"已存到笔记"也不会挂在旧 ID 上。
     */
    private fun applyLoaded(sessionId: String, list: List<MessageDto>) {
        val old = cache[sessionId].orEmpty()
        val messages = carryLocalKeys(old, list.map(::toUiMessage))
        replacedLocalIds(old, messages).forEach { (from, to) -> onMessageIdChanged(sessionId, from, to) }
        setCached(sessionId, messages)
    }

    /** 界面上的草稿图标只属于当前新聊天；打开的是已保存的聊天时为空。 */
    private fun syncDraftIcon() {
        _state.update { it.copy(draftIcon = if (it.activeSessionId == null) draftIcons[newChatKey] else null) }
    }

    /** [ChatUiState.sending] 只看当前聊天；[ChatUiState.generatingSessionIds] 是所有在发送的聊天。 */
    private fun syncBusy() {
        val generating = streams.keys.filterNot { it.startsWith(NEW_CHAT_PREFIX) }.toSet()
        stopping.retainAll(streams.keys)
        _state.update { it.copy(sending = keyOf(it) in streams, stopping = keyOf(it) in stopping, generatingSessionIds = generating) }
    }

    /** 正在接收回答（不是上传附件、不是生成图片）的任务：只有它们能请服务端停止。 */
    private val chatJobs = mutableSetOf<Job>()

    /** 已经请服务端停止、在等回答结束的聊天。 */
    private val stopping = mutableSetOf<String>()

    /** 每个聊天各自的角色短暂完成 / 出错反馈与计时任务（切换聊天或在别的聊天里发送不会取消其它聊天的计时）。 */
    private val outcomes = mutableMapOf<String, CharacterOutcome>()
    private val outcomeJobs = mutableMapOf<String, Job>()

    private fun syncOutcome() {
        _state.update { it.copy(characterOutcome = outcomes[keyOf(it)]) }
    }

    private fun flashOutcome(key: String, kind: CharacterOutcome?) {
        outcomeJobs.remove(key)?.cancel()
        if (kind == null) {
            if (outcomes.remove(key) != null) syncOutcome()
            return
        }
        outcomes[key] = kind
        syncOutcome()
        val job = viewModelScope.launch {
            delay(if (kind == CharacterOutcome.Completed) 650L else 950L)
            if (outcomes[key] == kind) {
                outcomes.remove(key)
                outcomeJobs.remove(key)
                syncOutcome()
            }
        }
        outcomeJobs[key] = job
    }

    init {
        viewModelScope.launch { loadModels() }
        refreshSessions()
    }

    // ---- 聊天列表 ----

    // 同时只保留最新的一次刷新：旧请求被取消，在途结果丢弃，避免旧列表盖掉新列表。
    fun refreshSessions() {
        sessionsJob?.cancel()
        sessionsJob = viewModelScope.launch {
            _state.update { it.copy(sessionsLoading = it.sessions.isEmpty(), sessionsFailed = false) }
            val iconMark = iconSync.mark()
            val result = runCatching { backend.sessions() }
            ensureActive()
            result
                .onSuccess { fetched ->
                    // 读列表期间改过（或还在保存）的图标盖回去，旧列表不能把刚选的图标冲掉。
                    val list = iconSync.reconcile(fetched, iconMark)
                    _state.update { it.copy(sessions = list, sessionsLoading = false, sessionsFailed = false) }
                }
                .onFailure { _state.update { s -> s.copy(sessionsLoading = false, sessionsFailed = s.sessions.isEmpty()) } }
        }
    }

    // ---- 侧栏整理（置顶、改名、移动、删除、排序、在项目里新建）：接口调用在 SidebarViewModel，这里只改本地状态 ----

    /** 服务端已保存的改动写进本地列表。进行中的刷新可能读到改动前的列表，所以让它重读一次。 */
    fun patchSessions(transform: (List<SessionSummary>) -> List<SessionSummary>) {
        _state.update { it.copy(sessions = transform(it.sessions)) }
        if (sessionsJob?.isActive == true) refreshSessions()
    }

    /** 聊天已删除：从列表去掉；删的是正在看的聊天时回到新聊天（网页 deleteSession）。 */
    fun onSessionDeleted(id: String) {
        cache.remove(id)
        outcomeJobs.remove(id)?.cancel()
        outcomes.remove(id)
        if (_state.value.activeSessionId == id) newChat()
        patchSessions { list -> list.filterNot { it.id == id } }
    }

    /** 刚在项目里建好的空聊天：放到列表最前并打开（网页 createSession(projectId)）。别的聊天的回答照常继续。 */
    fun openCreatedSession(session: SessionSummary) {
        // 从还没发过东西的新聊天过来：先选的图标带到建好的聊天上（网页 createEmptySession(carriedIcon, projectId)）。
        // 已经发出去、还在等会话 ID 的新聊天的图标属于那次发送，不带走。附件还在上传（缓存里还没有消息）的不算发出去：
        // 离开后这次上传不会发出（见 send），图标也跟着到建好的聊天上。
        val from = keyOf(_state.value)
        val carried = if (_state.value.activeSessionId == null && cache[from].isNullOrEmpty()) draftIcons.remove(from) else null
        val icon = session.icon ?: carried
        cache[session.id] = emptyList()
        // 先把带图标的聊天放进列表再打开、再保存：保存时先显示的那一步要能找到这一行。
        _state.update { it.copy(sessions = listOf(session.copy(icon = icon)) + it.sessions.filterNot { s -> s.id == session.id }) }
        show(session.id)
        if (carried != null && session.icon == null) saveCreatedIcon(session.id, carried)
        // 进行中的刷新可能读到建好之前的列表，回来会把新聊天盖掉：让它重读。
        if (sessionsJob?.isActive == true) refreshSessions()
    }

    /** 建好了，但用户在等待期间已经去了别的聊天：只加进列表，不打开。 */
    fun addCreatedSession(session: SessionSummary) {
        patchSessions { list -> listOf(session) + list.filterNot { it.id == session.id } }
    }

    // 首次启动时，设备 Cookie 由第一个到达服务端的请求签发。发送前先等会话列表请求结束，
    // 否则它和 /api/chat 各签发一个身份，后到的 Cookie 会覆盖先到的，第一个聊天就读不回来了。
    private suspend fun awaitSessionsRequest() {
        while (true) {
            val job = sessionsJob?.takeIf { it.isActive } ?: return
            job.join()
        }
    }

    /** 登录或退出后身份变了：停掉所有聊天的回答，清掉缓存和列表，按新身份重新加载。 */
    fun onIdentityChanged() {
        epoch++
        // 等着放回的提问：文字留着，附件和待发送附件一样不跨登录保留。
        pendingRestores.replaceAll { Restore(it.text, emptyList(), emptyList()) }
        // 被拒的改写：输入栏空着时把那段文字放进输入栏，登录后还在（网页登录前把它预存为草稿）。
        _state.value.rejectedEdit?.let { if (draft.isBlank()) updateDraft(it.text) }
        streams.values.flatten().forEach { it.cancel() }
        streams.clear()
        // 取消可能同步触发完成回调、从 map 里删掉自己：先拷一份再取消。
        reconcileJobs.values.toList().forEach { it.cancel() }
        reconcileJobs.clear()
        cache.clear()
        draftIcons.clear()
        loadJob?.cancel()
        outcomeJobs.values.toList().forEach { it.cancel() }
        outcomeJobs.clear()
        outcomes.clear()
        newChatKey = "$NEW_CHAT_PREFIX${++newChats}"
        // 草稿文字留着（网页登录前把它预存起来、回来后放回输入栏）；附件和网页一样不跨登录保留（网页登录会重载页面，
        // 登录提示里也写着"登录时不会保留附件"）。
        _state.update {
            it.copy(
                sessions = emptyList(), sessionsLoading = true, sessionsFailed = false,
                activeSessionId = null, messages = emptyList(), messagesLoading = false, messagesFailed = false,
                files = if (it.upload == null) emptyList() else it.files, attachedPages = emptyList(),
                notice = null, guestLimit = null, upgradeLimit = null, reveal = null, rejectedEdit = null,
                draftIcon = null, characterOutcome = null,
            )
        }
        syncBusy()
        refreshSessions()
    }

    // ---- 聊天图标（网页 changeSessionIcon / changeDraftIcon） ----

    /** 顶栏或空白页标题旁的图标：已保存的聊天直接保存；还没保存的新聊天先记成草稿。 */
    fun changeIcon(icon: String?) {
        val id = _state.value.activeSessionId
        if (id != null) return changeSessionIcon(id, icon)
        if (icon == null) draftIcons.remove(newChatKey) else draftIcons[newChatKey] = icon
        syncDraftIcon()
    }

    /** 先显示，保存按聊天排队；失败时退回最后保存成功的图标并在输入栏上方提示。 */
    fun changeSessionIcon(sessionId: String, icon: String?) {
        val current = _state.value.sessions.firstOrNull { it.id == sessionId }?.icon
        viewModelScope.launch {
            iconSync.change(sessionId, icon, current, show = { value -> showIcon(sessionId, value) },
                fail = { _state.update { it.copy(notice = ComposerNotice.IconFailed) } })
        }
    }

    private fun showIcon(sessionId: String, icon: String?) =
        _state.update { it.copy(sessions = it.sessions.map { s -> if (s.id == sessionId) s.copy(icon = icon) else s }) }

    /** 新聊天在服务端建好了：把草稿图标存上去（原生的会话由 /api/chat 建，建的时候不带图标）。 */
    private fun saveCreatedIcon(sessionId: String, icon: String) {
        viewModelScope.launch {
            iconSync.change(sessionId, icon, null, show = { value -> showIcon(sessionId, value) },
                fail = { _state.update { it.copy(notice = ComposerNotice.IconFailed) } })
        }
    }

    /** 每次换到别的聊天（新聊天、打开历史聊天、打开刚建的聊天）加一，用来判断慢请求回来时用户是否已经去了别处。 */
    var navigationCount = 0L
        private set

    /** 换到另一个聊天：先显示它缓存里的消息（生成中的回答也在里面）。 */
    private fun show(sessionId: String?, loading: Boolean = false) {
        navigationCount++
        loadJob?.cancel()
        val previous = keyOf(_state.value)
        // 离开的是不在发送中的新聊天：没有会话 ID，之后再也回不来，缓存和草稿图标都不再有用
        // （打开别的聊天时丢掉草稿图标，网页 loadMessages 里的 changeDraftIcon(null)）。
        if (previous.startsWith(NEW_CHAT_PREFIX) && previous !in streams) {
            cache.remove(previous)
            draftIcons.remove(previous)
            outcomeJobs.remove(previous)?.cancel()
            outcomes.remove(previous)
        }
        if (sessionId == null) newChatKey = "$NEW_CHAT_PREFIX${++newChats}"
        val key = sessionId ?: newChatKey
        // 换聊天时清掉输入栏上方的提示（网页 loadSession / createSession 的 setSendError("")）和之前的定位请求。
        _state.update {
            it.copy(
                activeSessionId = sessionId, messages = cache[key] ?: emptyList(), messagesLoading = loading, messagesFailed = false,
                notice = null, reveal = null, rejectedEdit = null,
                characterOutcome = outcomes[key],
            )
        }
        syncDraftIcon()
        syncBusy()
    }

    fun newChat() {
        // 已经在一个还没发过东西的新聊天里：不换（网页 createSession 同样直接返回），上传中的附件照常发出。
        val current = _state.value
        if (current.activeSessionId == null && current.messages.isEmpty()) return
        show(null)
    }

    fun openSession(id: String) {
        if (_state.value.activeSessionId == id) {
            navigationCount++
            // 之前的定位请求和链接错误都作废（网页 loadMessages 的 cancelReveal / setSendError("")）。
            _state.update { it.copy(reveal = null, notice = it.notice.takeUnless { n -> n == ComposerNotice.LinkFailed }) }
            return
        }
        // 生成中的聊天以本机显示为准（服务器还没存下进行中的回答），不读历史（网页 loadMessages）。
        if (id in streams) {
            show(id)
            return
        }
        val cached = cache[id]
        show(id, loading = cached.isNullOrEmpty())
        // 缓存里有（例如刚在后台答完）就先显示，再静默换成服务器版本。
        loadMessages(id, quiet = !cached.isNullOrEmpty())
    }

    /**
     * 从检索结果或链接打开聊天，有 [messageId] 时读完后滚到那条消息并闪一下（网页 openChatFromLink）。
     * 在那个聊天自己的缓存里找：没有这条（别的设备后来加的）就先读服务器版本再定位，读完前保持"读取中"，
     * 免得把存在的消息当成已删除。正在生成的聊天不重读（会盖掉进行中的回答），找不到就按不存在处理。
     */
    fun openSessionAt(id: String, messageId: String?) {
        val wasActive = _state.value.activeSessionId == id
        openSession(id)
        if (messageId == null) return
        val reveal = MessageReveal(id, messageId, ++revealTokens)
        val cached = cache[id].orEmpty()
        if (id in streams || cached.any { it.id == messageId }) {
            _state.update { it.copy(reveal = reveal) }
            return
        }
        // 刚打开的聊天已经在读（有缓存时是静默读）；本来就开着的要补读一次。
        val reload = wasActive && !_state.value.messagesLoading
        _state.update { it.copy(reveal = reveal, messagesLoading = true) }
        if (reload) loadMessages(id, quiet = cached.isNotEmpty())
    }

    /** 链接里的 ID 形式不对：和网页一样回到新聊天，在输入栏上方提示读不到。 */
    fun showLinkFailed() {
        newChat()
        _state.update { it.copy(notice = ComposerNotice.LinkFailed) }
    }

    // 外部链接（VIEW intent）：交给 NoteFableRoot，先关掉检索面板和抽屉再打开（它们是界面状态，不在 ViewModel 里）。
    // 有缓冲：冷启动时 onCreate 先于界面开始收集。
    private val externalLinks = Channel<ChatLink>(Channel.UNLIMITED)
    val linkRequests: Flow<ChatLink> = externalLinks.receiveAsFlow()

    fun requestLink(link: ChatLink) {
        externalLinks.trySend(link)
    }

    /** 界面处理完（滚到了、或消息已不存在）后清掉这次定位请求。 */
    fun consumeReveal(token: Long) {
        _state.update { if (it.reveal?.token == token) it.copy(reveal = null) else it }
    }

    private var revealTokens = 0L

    fun reloadActive() {
        _state.value.activeSessionId?.let { loadMessages(it) }
    }

    private fun loadMessages(sessionId: String, quiet: Boolean = false) {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            if (!quiet) _state.update { it.copy(messagesLoading = true, messagesFailed = false) }
            val result = runCatching { backend.messages(sessionId) }
            // 在途请求被取消（切换会话、开始发送）后不能再写回界面。
            ensureActive()
            val current = _state.value.activeSessionId == sessionId && sessionId !in streams
            result
                .onSuccess { list ->
                    if (current) applyLoaded(sessionId, list)
                    _state.update { if (it.activeSessionId == sessionId) it.copy(messagesLoading = false, messagesFailed = false) else it }
                }
                .onFailure { error ->
                    when {
                        !current -> _state.update { it.copy(messagesLoading = false) }
                        // 会话已不存在（别处删了）：和网页一样解除绑定，当作新聊天用，并提示读取失败。
                        error is ApiException && error.status == 404 -> {
                            cache.remove(sessionId)
                            show(null)
                            _state.update { it.copy(notice = ComposerNotice.LoadFailed) }
                        }
                        // 已显示缓存：保留它，只在输入栏上方提示（网页 setSendError）。
                        quiet -> _state.update { it.copy(messagesLoading = false, notice = ComposerNotice.LoadFailed) }
                        else -> _state.update { it.copy(messagesLoading = false, messagesFailed = true) }
                    }
                }
        }
    }

    // ---- 模型 ----

    private suspend fun loadModels() {
        val response = runCatching { backend.models() }.getOrNull() ?: runCatching { bundledModels() }.getOrNull() ?: return
        _state.update { it.copy(models = response.models, defaultModelId = response.defaultModel) }
    }

    fun selectModel(id: String) {
        settings.modelId = id
        _state.update { it.copy(chosenModelId = id) }
        // 新模型不支持当前推理强度时，退回它的默认值。
        val reasoning = _state.value.selectedReasoning
        settings.reasoning = reasoning
        _state.update { it.copy(chosenReasoning = reasoning) }
    }

    fun selectReasoning(effort: String) {
        settings.reasoning = effort
        _state.update { it.copy(chosenReasoning = effort) }
    }

    // ---- 附件与图片模式 ----

    fun addFiles(incoming: List<LocalFile>) {
        _state.update { withFiles(it, incoming) }
    }

    /**
     * 附件要先在后台读出来（拷贝粘贴的图片、读文件名和大小）：读的期间 [ChatUiState.importing] 加一，发送键不可用；
     * 读完后在同一次状态更新里减一并加进附件，中间不会有可以发送的空档。
     */
    fun importFiles(load: suspend () -> List<LocalFile>) {
        _state.update { it.copy(importing = it.importing + 1) }
        viewModelScope.launch {
            var files = emptyList<LocalFile>()
            try {
                files = load()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // 读不出来的附件当作没选（和读取函数里返回 null 的情况一样）。
            } finally {
                _state.update { withFiles(it.copy(importing = (it.importing - 1).coerceAtLeast(0)), files) }
            }
        }
    }

    private fun withFiles(state: ChatUiState, incoming: List<LocalFile>): ChatUiState {
        if (incoming.isEmpty() || state.upload != null) return state
        val error = selectionError(state.files, incoming, state.supportsImages)
        return if (error != null) state.copy(notice = ComposerNotice.Rejected(error))
        else state.copy(files = state.files + incoming, notice = null)
    }

    fun removeFile(uri: String) {
        _state.update { state ->
            if (state.upload != null) state
            else state.copy(files = state.files.filterNot { it.uri == uri }, notice = null)
        }
    }

    /** 添加笔记窗口点了「添加」：换成选好的这组（网页 setAttachedPages），清掉输入栏上方的提示。上传中不改。 */
    fun setAttachedPages(pages: List<ChatProjectNote>) {
        _state.update { if (it.upload != null) it else it.copy(attachedPages = pages, notice = null) }
    }

    fun toggleRecentNote(note: ChatProjectNote) {
        _state.update { state ->
            if (state.upload != null) state
            else state.copy(attachedPages = toggleProjectNote(state.attachedPages, note, MAX_MESSAGE_NOTES), notice = null)
        }
    }

    /** 回答里选中文字点了「问 NoteFable」：放到输入栏上方作为引用（再引用会换掉之前的）。 */
    fun setQuote(text: String) {
        val quote = ChatQuote.normalize(text)
        // 上传附件时发出的内容已定，引用和附件一样不能改（网页同样）。
        if (quote.isNotEmpty()) _state.update { if (it.upload != null) it else it.copy(quote = quote, notice = null) }
        saveQuote()
    }

    private fun saveQuote() {
        savedState[QUOTE_KEY] = _state.value.quote
    }

    /** 点掉输入栏上方的引用。 */
    fun clearQuote() {
        _state.update { if (it.upload != null) it else it.copy(quote = null) }
        saveQuote()
    }

    /** 点掉输入栏上方的一篇笔记。 */
    fun removeAttachedPage(id: String) {
        _state.update { state ->
            if (state.upload != null) state
            else state.copy(attachedPages = state.attachedPages.filterNot { it.id == id }, notice = null)
        }
    }

    fun dismissGuestLimit() {
        _state.update { it.copy(guestLimit = null) }
    }

    fun dismissUpgradeLimit() {
        _state.update { it.copy(upgradeLimit = null) }
    }

    fun setImageMode(on: Boolean) {
        // 关掉「生成图片」正是"带着笔记不能生成图片"提示要用户做的事：提示随之消失。
        _state.update { it.copy(imageMode = on, notice = if (!on && it.notice == ComposerNotice.PagesInImageMode) null else it.notice) }
    }

    // ---- 发送 ----

    /**
     * 停止键：只停当前看着的这个聊天（上传附件中或回答中），别的聊天照常生成。
     *
     * 正在接收的回答：请服务端停止（`POST /api/sessions/:id/stop`），它把已生成的部分存好再结束流，这边像正常结束一样对账
     * （断开连接不一定能传到服务端，回答可能照样生成完）。请求没成功、或等了一阵流还没结束，就自己取消。
     * 还在上传附件、生成图片、或新聊天还没拿到会话 ID 时没有可停的回答，直接取消。
     */
    fun stop() {
        val key = keyOf(_state.value)
        val jobs = streams[key]?.toList().orEmpty()
        if (jobs.isEmpty() || key in stopping) return
        val (answering, others) = jobs.partition { it in chatJobs }
        others.forEach { it.cancel() }
        if (answering.isEmpty()) return
        if (key.startsWith(NEW_CHAT_PREFIX)) {
            answering.forEach { it.cancel() }
            return
        }
        stopping += key
        syncBusy()
        viewModelScope.launch {
            val acknowledged = runCatching { backend.stopSession(key) }.isSuccess
            if (acknowledged) {
                // 服务端每秒看一次停止的请求。等一阵还没结束就不等了。
                val deadline = STOP_WAIT_MS / STOP_WAIT_STEP_MS
                var waited = 0L
                while (waited < deadline && answering.any { it.isActive }) {
                    delay(STOP_WAIT_STEP_MS)
                    waited++
                }
            }
            answering.filter { it.isActive }.forEach { it.cancel() }
        }
    }

    /** 关掉重新打开的编辑框（取消）：被拒的改写不再留着。 */
    fun dismissRejectedEdit() {
        _state.update { it.copy(rejectedEdit = null) }
    }

    fun send(text: String) {
        val prompt = text.trim()
        val current = _state.value
        // 历史还在加载、或加载失败时发送，新消息会插进空列表（失败页还会盖住它们）；而回答结束后的对账又会换掉整个列表。读到历史再发。
        if (prompt.isEmpty() || current.sending || current.messagesLoading || current.messagesFailed) return
        if (current.upload != null || current.filesError != null || current.importing > 0) return
        val key = keyOf(current)
        // 图片接口只收文字和参考图，不读笔记：不悄悄丢掉，提示用户（网页同样）。
        if (current.imageMode && current.attachedPages.isNotEmpty()) {
            _state.update { it.copy(notice = ComposerNotice.PagesInImageMode) }
            flashOutcome(key, CharacterOutcome.Error)
            return
        }
        // 放回被拒的提问时可能超过上限：不悄悄删减，让用户自己移除。
        if (current.attachedPages.size > MAX_MESSAGE_NOTES) {
            _state.update { it.copy(notice = ComposerNotice.TooManyPages) }
            flashOutcome(key, CharacterOutcome.Error)
            return
        }
        flashOutcome(key, null)
        // 正在进行的静默对账返回的是发送前的快照，会抹掉刚加进去的消息，所以先取消。
        loadJob?.cancel()
        reconcileJobs.remove(key)?.cancel()

        val files = current.files
        val pages = current.attachedPages
        val imageMode = current.imageMode
        val modelId = current.selectedModel?.id
        // 有引用时，引用块放在提问前面一起发（网页 composeQuotedMessage）。被拒时整段放回，引用回到输入栏上方。
        val quote = current.quote
        val message = ChatQuote.compose(quote, prompt)
        val rawText = if (quote != null) message else text
        val request = ChatRequest(
            message = message,
            sessionId = current.activeSessionId,
            model = modelId,
            reasoning = current.selectedReasoning,
            webSearch = if (current.selectedModel?.supportsWebSearch == false) "off" else "auto",
            pages = pages.map { it.id },
        )

        if (files.isEmpty()) {
            // 提问立即出现在对话里（不等任务被调度）。
            val run = TurnRun(key, epoch)
            val turn = beginTurn(run, message, rawText, files, pages, imageMode, modelId)
            launchTurn(run) { runTurn(run, turn, request, imageMode) }
            return
        }

        // 和网页一样先上传、成功后才把这条消息放进对话；上传失败时文字和附件都留在输入栏。
        _state.update { it.copy(upload = UploadProgress.Preparing, notice = null) }
        val navigation = navigationCount
        val run = TurnRun(key, epoch)
        launchTurn(run) {
            val tickets = uploadFiles(files, navigation)
            if (tickets == null) {
                dropLeftNewChat(run.key)
                return@launchTurn null
            }
            // 上传期间去了别的聊天：和网页一样不发了，清掉传上去的文件；文字和附件还在输入栏。
            if (navigation != navigationCount) {
                flushRestores()
                dropLeftNewChat(run.key)
                withContext(NonCancellable) { backend.discardUploads(tickets) }
                return@launchTurn null
            }
            // 上传期间笔记不能改（按钮不可用），所以发的还是开始上传时的这组。
            val turn = beginTurn(run, message, rawText, files, pages, imageMode, modelId)
            runTurn(run, turn, request.copy(uploads = tickets), imageMode)
        }
    }

    /** 没发出去的新聊天，而用户已经离开它：再也回不来，它的缓存和草稿图标都不留。 */
    private fun dropLeftNewChat(key: String) {
        if (!key.startsWith(NEW_CHAT_PREFIX) || key == keyOf(_state.value)) return
        cache.remove(key)
        draftIcons.remove(key)
    }

    /** 一次发送所属的聊天。新聊天拿到会话 ID 后 [key] 换成它（[migrate]）。 */
    private class TurnRun(var key: String, val epoch: Long) {
        lateinit var job: Job
    }

    /**
     * 一次发送的结果：会话 ID 和是否正常结束（决定要不要对账）。
     * [stopped]：用户点了停止，服务端会把已经生成的部分存下来；[hasAnswer] 是停止时本机已经收到正文或提案。
     * [resync]：编辑 / 重新生成没开始就失败了，画面已经退回原样，再按服务端的状态核对一次。
     */
    private class TurnOutcome(
        val sessionId: String?,
        val completed: Boolean,
        val streamFailed: Boolean = false,
        val stopped: Boolean = false,
        val hasAnswer: Boolean = false,
        val resync: Boolean = false,
        /** 编辑 / 重新生成开始前就已经保存在服务端的消息 ID：对账时不能把它们当成"新存下的回答"。 */
        val knownBefore: Set<String> = emptySet(),
    )

    /** 登记这个聊天的发送任务再启动，结束（完成、失败、停止）后注销并对账。 */
    private fun launchTurn(run: TurnRun, body: suspend () -> TurnOutcome?) {
        // 先登记再启动：主线程立即调度时，任务可能在 launch 返回前就跑完。
        run.job = viewModelScope.launch(start = CoroutineStart.LAZY) {
            var outcome: TurnOutcome? = null
            var stopRequested = false
            try {
                outcome = body()
            } finally {
                stopRequested = run.key in stopping
                removeStream(run.key, run.job)
                syncBusy()
            }
            if (run.epoch == epoch) outcome?.let {
                when {
                    it.streamFailed -> flashOutcome(run.key, CharacterOutcome.Error)
                    it.completed && !it.stopped && !stopRequested -> flashOutcome(run.key, CharacterOutcome.Completed)
                }
                if (it.stopped) reconcileStopped(it.sessionId, it.hasAnswer, it.knownBefore) else reconcile(it.sessionId, it.completed || it.resync)
            }
        }
        addStream(run.key, run.job)
        syncBusy()
        run.job.start()
    }

    /**
     * 新聊天拿到了服务端的会话 ID：缓存和进行中的任务迁过去；用户还在看它的话，当前聊天也换成这个 ID。
     *
     * 服务端先建会话、稍后才回 `X-Session-Id`，这期间用户可能已从侧栏打开了这个会话（读到的历史只有这次的提问），
     * 甚至又发了一条。所以不覆盖已有的东西：读来的历史只会是这次发送自己的半份，换成本机这份；
     * 之后在那边新发的消息（本机 ID）接在后面，它的任务也留着。
     */
    private fun migrate(run: TurnRun, sessionId: String) {
        val from = run.key
        if (from == sessionId || run.epoch != epoch) return
        val moved = cache.remove(from) ?: emptyList()
        // 读来的历史开头是这次发送自己的提问（服务端先存提问、回答结束才存回答）：去掉它，其余都留着——
        // 包括用户在那边又发、已经对过账（ID 已换成服务端 ID）的后续回合。
        // 这是新建的会话，读来的历史第一条一定是这次的提问（服务端 ID）。
        val dest = cache[sessionId].orEmpty()
        // 去掉开头这次回合的服务端副本（提问，以及图片模式下已存好的回答），从下一条提问起都留着。
        val later = if (dest.firstOrNull()?.let { it.role == MessageRole.User && !it.id.startsWith(LOCAL_ID_PREFIX) } == true) {
            val next = dest.drop(1).indexOfFirst { it.role == MessageRole.User }
            if (next < 0) emptyList() else dest.drop(1 + next)
        } else dest
        if (removeStream(from, run.job)) addStream(sessionId, run.job)
        outcomes.remove(from)?.let { kind ->
            outcomeJobs.remove(from)?.cancel()
            flashOutcome(sessionId, kind)
        }
        run.key = sessionId
        if (_state.value.activeSessionId == null && newChatKey == from) _state.update { it.copy(activeSessionId = sessionId) }
        if (keyOf(_state.value) == sessionId) {
            // 正在看它：本机这份更新，不再用读到的历史盖掉。
            loadJob?.cancel()
            _state.update { it.copy(messagesLoading = false, messagesFailed = false) }
        }
        setCached(sessionId, moved + later)
        // 草稿图标跟着这次发送走，用户已经去了别的聊天也一样（网页 send 里的 sentIcon / latestIcon）。
        draftIcons.remove(from)?.let { saveCreatedIcon(sessionId, it) }
        syncDraftIcon()
        syncBusy()
    }

    /** 一次发送：两个气泡的本地 ID，以及被上限拒绝时要放回输入栏的原文、附件和笔记。 */
    private class Turn(
        val assistantId: String,
        val userId: String,
        val rawText: String,
        val files: List<LocalFile>,
        val pages: List<ChatProjectNote>,
        /** 编辑 / 重新生成：开始前这个聊天显示的消息。没开始就失败时退回它（提问不放回输入栏）。 */
        val before: List<UiMessage>? = null,
        /** 编辑：改写的是哪条提问、改成了什么。被拒绝时把这段文字放回那条提问的编辑框。 */
        val edit: RejectedEdit? = null,
    )

    /** 把提问和等待中的回答放进对话，并清空输入栏里的附件和笔记。 */
    private fun beginTurn(
        run: TurnRun,
        prompt: String,
        rawText: String,
        files: List<LocalFile>,
        pages: List<ChatProjectNote>,
        imageMode: Boolean,
        modelId: String?,
    ): Turn {
        val assistantId = "$LOCAL_ID_PREFIX${++localIds}"
        val userId = "$LOCAL_ID_PREFIX${++localIds}"
        val userMessage = UiMessage(
            userId, MessageRole.User, prompt,
            // 发送后先用本机文件显示缩略图，回答结束后换成服务器保存的版本。
            attachments = files.map { AttachmentDto(it.uri, it.name, it.mimeType, it.size, it.uri.takeIf { _ -> it.isImage }) },
            pages = pages,
        )
        val assistantMessage = UiMessage(
            assistantId, MessageRole.Assistant, "", streaming = true,
            // 图片不是聊天模型画的，回答上方不显示模型名（和网页一致）。
            modelId = modelId.takeIf { !imageMode }, generatingImage = imageMode,
        )
        updateCached(run.key) { it + userMessage + assistantMessage }
        _state.update { it.copy(files = emptyList(), attachedPages = emptyList(), quote = null, upload = null, notice = null, sentCount = it.sentCount + 1) }
        saveQuote()
        // 消息真正发出去之后才清空草稿：附件上传失败时文字还留在输入栏里。
        updateDraft("")
        // 上传期间别的聊天退回来的提问，等这里清空输入栏后再放回去。
        flushRestores()
        return Turn(assistantId, userId, rawText, files, pages)
    }

    /** 逐个上传附件，返回凭证；失败或被取消时清掉已上传的文件并返回 null（被取消时向上抛出）。 */
    private suspend fun uploadFiles(files: List<LocalFile>, navigation: Long): List<String>? {
        var tickets = emptyList<String>()
        try {
            awaitSessionsRequest()
            val plan = backend.prepareUploads(files)
            tickets = plan.uploads.map { it.ticket }
            files.forEachIndexed { index, file ->
                fun report(percent: Int) = _state.update {
                    it.copy(upload = UploadProgress.Uploading(index + 1, files.size, file.name, percent))
                }
                report(0)
                backend.uploadFile(plan.uploads[index], plan.mode, file, ::report)
                report(100)
            }
            _state.update { it.copy(upload = null) }
            return tickets
        } catch (error: Throwable) {
            withContext(NonCancellable) { backend.discardUploads(tickets) }
            // 用户已经去了别的聊天：不在那边的输入栏报错（网页只在 navigationIntent 没变时 setSendError）。
            val report = error !is CancellationException && navigation == navigationCount
            _state.update { it.copy(upload = null, notice = if (report) ComposerNotice.UploadFailed else it.notice) }
            if (report) flashOutcome(keyOf(_state.value), CharacterOutcome.Error)
            flushRestores()
            if (error is CancellationException) throw error
            return null
        }
    }

    private suspend fun runTurn(run: TurnRun, turn: Turn, request: ChatRequest, imageMode: Boolean): TurnOutcome =
        if (imageMode) runImage(run, turn, request) else runStream(run, turn, request)

    private suspend fun runImage(run: TurnRun, turn: Turn, request: ChatRequest): TurnOutcome {
        val assistantId = turn.assistantId
        var sessionId = request.sessionId
        var failure: Throwable? = null
        var completed = false
        // 网页在分到 /api/images 之前就记下开始时间：等待秒数不因界面重组而归零。
        updateAssistant(run, assistantId) { it.copy(startedAt = System.currentTimeMillis()) }
        try {
            awaitSessionsRequest()
            val result = backend.generateImage(request)
            result.error?.let { throw java.io.IOException(it) }
            val image = result.image?.takeIf { it.dataUrl.isNotEmpty() } ?: throw java.io.IOException("Failed to generate image.")
            if (sessionId == null && result.sessionId != null) {
                sessionId = result.sessionId
                migrate(run, result.sessionId)
            }
            updateAssistant(run, assistantId) {
                it.copy(generatingImage = false, images = listOf(GeneratedImageDto("local-${++localIds}", image.dataUrl, image.mimeType)))
            }
            completed = true
        } catch (cancelled: CancellationException) {
            // 用户点了停止。
        } catch (error: Throwable) {
            failure = error
        } finally {
            withContext(NonCancellable) { finishAssistant(run, turn, failure) }
        }
        return TurnOutcome(sessionId, completed)
    }

    /** 回答结束（完成、失败或被停止）时收尾：去掉"进行中"状态，失败则记下原因。 */
    private fun finishAssistant(run: TurnRun, turn: Turn, failed: Throwable?) {
        if (run.epoch != epoch) return
        if (failed != null) flashOutcome(run.key, CharacterOutcome.Error)
        val assistantId = turn.assistantId
        val limited = failed is ApiException && failed.isUsageLimit
        // 还没拿到会话 ID 的新聊天失败了，而用户已经离开它：这个聊天再也打不开（网页发送前就建好了会话，
        // 侧栏里能找回）。把提问和附件放回输入栏，不留看不到的缓存。撞到上限也一样（未登录时照常显示登录提示）。
        if (failed != null && run.key.startsWith(NEW_CHAT_PREFIX) && run.key != keyOf(_state.value)) {
            if (limited) restoreRejected(turn, failed as ApiException) else restoreDraft(turn)
            dropLeftNewChat(run.key)
            return
        }
        // 编辑 / 重新生成在收到任何内容之前失败（上限、断网、消息已不存在）：服务端没有留下新版本，
        // 退回开始前的画面，在输入栏上方说明原因（网页 rerunTurn 的同一分支）。
        val before = turn.before
        if (before != null && failed != null &&
            cache[run.key]?.firstOrNull { it.id == assistantId }?.let { it.content.isEmpty() && it.activity.isEmpty() } != false
        ) {
            setCached(run.key, before)
            val guest = limited && (failed as ApiException).tier == "guest"
            val member = limited && (failed as ApiException).tier == "member"
            _state.update {
                val shown = keyOf(it) == run.key
                it.copy(
                    notice = if (shown) ComposerNotice.Failed(chatFailureDetail(failed)) else it.notice,
                    guestLimit = if (guest) (if ((failed as ApiException).kind == "image") "image" else "chat") else it.guestLimit,
                    upgradeLimit = if (member) (if ((failed as ApiException).kind == "image") "image" else "chat") else it.upgradeLimit,
                    // 改写的文字不丢：那条提问的编辑框带着它重新打开。
                    rejectedEdit = if (shown && turn.edit != null) turn.edit else it.rejectedEdit,
                )
            }
            return
        }
        if (limited) restoreRejected(turn, failed as ApiException)
        updateCached(run.key) { list ->
            list.mapNotNull { message ->
                // 被拒的提问不再显示本机图片：附件已经放回输入栏（网页 stripAttachmentPreviewUrls）。
                if (limited && message.id == turn.userId) {
                    return@mapNotNull message.copy(attachments = message.attachments.map { it.copy(dataUrl = null) })
                }
                if (message.id != assistantId) return@mapNotNull message
                val done = message.copy(streaming = false, generatingImage = false)
                when {
                    limited -> done.copy(content = failed?.message.orEmpty(), usageLimit = true, failure = null)
                    failed != null -> done.copy(errorDetail = chatFailureDetail(failed))
                    // 没收到任何内容就被停止：不留空气泡。已有过程或提案卡片（服务器已存了提案）时保留，和网页一样。
                    message.content.isEmpty() && message.images.isEmpty() &&
                        message.activity.isEmpty() && message.proposals.isEmpty() -> null
                    else -> done
                }
            }
        }
        // 重新生成什么都没收到就停了：服务端的原回答还显示着（新回答存下时才换），画面也退回原样。
        if (failed == null && before != null && turn.edit == null && cache[run.key]?.none { it.id == assistantId } == true) {
            setCached(run.key, before)
        }
    }

    /**
     * 上限拒绝的发送没有保存在任何地方：和网页一样把原文和附件放回输入栏。
     * 等待期间又写了字或加了附件的话不覆盖，被拒的原文放在前面（空一行），附件也排在前面。
     * 未登录用户（tier = guest）另外显示登录提示，免费用户（tier = member）显示升级提示。
     */
    private fun restoreRejected(turn: Turn, error: ApiException) {
        restoreDraft(turn)
        val kind = if (error.kind == "image") "image" else "chat"
        if (error.tier == "guest") _state.update { it.copy(guestLimit = kind) }
        if (error.tier == "member") _state.update { it.copy(upgradeLimit = kind) }
    }

    /** 要放回输入栏的原文、附件和笔记。 */
    private class Restore(val text: String, val files: List<LocalFile>, val pages: List<ChatProjectNote>)

    /**
     * 当前聊天正在上传附件时退回来的提问：上传成功后 [beginTurn] 会清空输入栏，现在放回去会被一起清掉，
     * 所以等上传结束（发出、失败或离开后不发）再放。
     */
    private val pendingRestores = mutableListOf<Restore>()

    private fun restoreDraft(turn: Turn) = restoreDraft(Restore(turn.rawText, turn.files, turn.pages))

    /** 没发出去的原文和附件放回输入栏，排在等待期间新写的字和新加的附件前面。 */
    private fun restoreDraft(restore: Restore) {
        if (_state.value.upload != null) {
            pendingRestores += restore
            return
        }
        // 带引用的提问：引用回到输入栏上方，输入栏只放提问。等待期间已经选了别的引用时留着它，
        // 被拒的提问连同引用块整段放回输入栏（网页 restoreComposerText 同样）。
        val keepQuote = _state.value.quote != null
        val (quote, text) = if (keepQuote) null to restore.text else ChatQuote.split(restore.text)
        updateDraft(mergeRejectedDraft(text, draft))
        _state.update { state ->
            state.copy(
                quote = quote ?: state.quote,
                files = if (restore.files.isEmpty()) state.files
                else restore.files + state.files.filterNot { current -> restore.files.any { it.uri == current.uri } },
                // 笔记也排在前面；合起来超过上限也不删减（发送前提示用户移除，网页同样）。
                attachedPages = mergeRestoredPages(restore.pages, state.attachedPages),
            )
        }
        saveQuote()
    }

    /** 上传结束了：放回等着的提问。 */
    private fun flushRestores() {
        if (pendingRestores.isEmpty() || _state.value.upload != null) return
        val restores = pendingRestores.toList()
        pendingRestores.clear()
        restores.forEach(::restoreDraft)
    }

    /**
     * 这边自己取消了回答（没能请服务端停止时的后备路径；请到了的话流正常结束，走 [reconcile]）。
     * 服务端可能已经把生成的部分存下：本机收到过内容时，等那条新回答出现再换成服务器版本（网页 finishStoppedStream），
     * 免得屏幕上的半截文字消失；一直没等到就保留本机这份。什么都没收到时不知道服务端的状态，不动画面。
     * 期间又在这个聊天里发送就作废。
     */
    private fun reconcileStopped(sessionId: String?, hasAnswer: Boolean, knownBefore: Set<String>) {
        val finished = sessionId ?: return
        refreshSessions()
        if (!hasAnswer) return
        reconcileJobs.remove(finished)?.cancel()
        // 重新生成时原来的回答已经从画面上拿掉，但服务端还显示着它：它不是新存下的回答。
        val known = cache[finished].orEmpty().mapTo(knownBefore.toMutableSet()) { it.id }
        val job = viewModelScope.launch(start = CoroutineStart.LAZY) {
            for (wait in STOP_SYNC_WAITS) {
                delay(wait)
                val list = runCatching { backend.messages(finished) }.getOrNull()
                ensureActive()
                if (finished in streams) return@launch
                if (list == null) continue
                val last = list.lastOrNull()
                if (!(last != null && last.role.equals("ASSISTANT", ignoreCase = true) && last.id !in known)) continue
                applyLoaded(finished, list)
                break
            }
        }
        reconcileJobs[finished] = job
        job.invokeOnCompletion { if (reconcileJobs[finished] === job) reconcileJobs.remove(finished) }
        job.start()
    }

    // ---- 重新生成、编辑、版本切换、分支（网页 page.tsx 的 rerunTurn / showVersion / branchChat） ----

    /** 用现在选的模型和推理强度重做这条回答。原来的回答留在服务端，用「‹ 2/3 ›」切回去。 */
    fun regenerate(messageId: String) = rerun(messageId, null)

    /** 改写自己的提问并重新回答。原来的提问和它后面的对话留在服务端，用「‹ 2/3 ›」切回去。 */
    fun editMessage(messageId: String, text: String) {
        val content = text.trim()
        if (content.isNotEmpty()) rerun(messageId, content)
    }

    private fun rerun(messageId: String, text: String?) {
        val current = _state.value
        val sessionId = current.activeSessionId ?: return
        if (current.sending || current.messagesLoading || current.messagesFailed || current.upload != null) return
        if (versionJob?.isActive == true) return
        val before = cache[sessionId].orEmpty()
        val index = before.indexOfFirst { it.id == messageId }
        val target = before.getOrNull(index) ?: return
        if (target.role != (if (text != null) MessageRole.User else MessageRole.Assistant)) return
        loadJob?.cancel()
        reconcileJobs.remove(sessionId)?.cancel()
        flashOutcome(sessionId, null)

        // 从这条消息起先从画面上拿掉，放上新版本的位置；服务端只是把它们隐藏，不删除。
        val modelId = current.selectedModel?.id
        val assistantId = "$LOCAL_ID_PREFIX${++localIds}"
        val userId = "$LOCAL_ID_PREFIX${++localIds}"
        val edited = text?.let { target.copy(id = userId, key = userId, content = it, versions = null) }
        setCached(
            sessionId,
            before.take(index) + listOfNotNull(edited) +
                UiMessage(assistantId, MessageRole.Assistant, "", streaming = true, modelId = modelId),
        )
        _state.update { it.copy(notice = null, reveal = null, rejectedEdit = null) }
        val request = ChatRequest(
            message = text.orEmpty(),
            sessionId = sessionId,
            model = modelId,
            reasoning = current.selectedReasoning,
            webSearch = if (current.selectedModel?.supportsWebSearch == false) "off" else "auto",
            edit = messageId.takeIf { text != null },
            regenerate = messageId.takeIf { text == null },
        )
        val run = TurnRun(sessionId, epoch)
        val turn = Turn(
            assistantId, userId, rawText = "", files = emptyList(), pages = emptyList(), before = before,
            edit = text?.let { RejectedEdit(messageId, it) },
        )
        launchTurn(run) { runStream(run, turn, request) }
    }

    private var versionJob: Job? = null

    /** 显示另一个版本（编辑前的提问、之前的回答），它后面的对话一起换。 */
    fun showVersion(messageId: String) {
        val current = _state.value
        val sessionId = current.activeSessionId ?: return
        if (current.sending || current.messagesLoading || sessionId in streams || versionJob?.isActive == true) return
        loadJob?.cancel()
        reconcileJobs.remove(sessionId)?.cancel()
        flashOutcome(sessionId, null)
        _state.update { it.copy(notice = null, reveal = null) }
        val identity = epoch
        versionJob = viewModelScope.launch {
            val result = runCatching {
                backend.showVersion(sessionId, messageId)
                backend.messages(sessionId)
            }
            ensureActive()
            if (identity != epoch) return@launch
            result
                .onSuccess { list -> if (sessionId !in streams) applyLoaded(sessionId, list) }
                .onFailure { error ->
                    val detail = (error as? ApiException)?.message ?: VERSION_SWITCH_FAILED
                    _state.update { if (it.activeSessionId == sessionId) it.copy(notice = ComposerNotice.Failed(detail)) else it }
                }
        }
    }

    private var branchJob: Job? = null

    /** 把到这条回答为止的对话复制成一个新聊天并打开它（[title] 是界面按语言拼好的「分支 · 原标题」）。原聊天不变。 */
    fun branch(messageId: String, title: String) {
        val sessionId = _state.value.activeSessionId ?: return
        if (branchJob?.isActive == true) return
        _state.update { it.copy(notice = null) }
        val navigation = navigationCount
        val identity = epoch
        branchJob = viewModelScope.launch {
            val result = runCatching { backend.branchSession(sessionId, messageId, title) }
            ensureActive()
            // 等待期间登录 / 退出了：那是之前身份的聊天，不放进现在的列表。
            if (identity != epoch) return@launch
            result
                .onSuccess { session ->
                    // 等待期间去了别的聊天：只加进列表，不把用户拉走。
                    if (navigation != navigationCount) return@onSuccess addCreatedSession(session)
                    _state.update { it.copy(sessions = listOf(session) + it.sessions.filterNot { s -> s.id == session.id }) }
                    openSession(session.id)
                    if (sessionsJob?.isActive == true) refreshSessions()
                }
                .onFailure { error ->
                    val detail = (error as? ApiException)?.message ?: BRANCH_FAILED
                    _state.update { if (it.activeSessionId == sessionId) it.copy(notice = ComposerNotice.Failed(detail)) else it }
                }
        }
    }

    /**
     * 正常结束时用服务器上保存的版本对账（拿到真实 ID、生成的图片、思考时长），只换这个聊天自己的缓存，
     * 不管用户现在看的是哪个聊天（网页 refreshSessionMessages）。
     * 被停止时走 [reconcileStopped]：要等服务端把半截回答存好，换早了屏幕上的文字会凭空消失。
     */
    private fun reconcile(sessionId: String?, completed: Boolean) {
        val finished = sessionId ?: return
        refreshSessions()
        if (!completed) return
        reconcileJobs.remove(finished)?.cancel()
        val job = viewModelScope.launch(start = CoroutineStart.LAZY) {
            val list = runCatching { backend.messages(finished) }.getOrNull()
            ensureActive()
            // 这期间又在这个聊天里发了新消息：快照是旧的，不用；空列表也不冲掉本机已收到的回答。
            if (!list.isNullOrEmpty() && finished !in streams) applyLoaded(finished, list)
        }
        reconcileJobs[finished] = job
        job.invokeOnCompletion { if (reconcileJobs[finished] === job) reconcileJobs.remove(finished) }
        job.start()
    }

    private suspend fun runStream(run: TurnRun, turn: Turn, request: ChatRequest): TurnOutcome {
        val assistantId = turn.assistantId
        val pending = StringBuilder()
        // 过程事件（推理摘要是很碎的增量）和正文一起攒着，每次刷新只重组一次（网页每次 read 合并一次）。
        val activityEvents = mutableListOf<ActivityEvent>()
        var sessionId = request.sessionId
        var failure: Throwable? = null
        var streamFailed = false
        var completed = false
        var stopped = false
        val startedAt = System.currentTimeMillis()
        updateAssistant(run, assistantId) { it.copy(startedAt = startedAt) }

        fun flush() {
            if (pending.isEmpty() && activityEvents.isEmpty()) return
            val chunk = pending.toString()
            pending.setLength(0)
            val events = activityEvents.toList()
            activityEvents.clear()
            val receivedAt = System.currentTimeMillis()
            updateAssistant(run, assistantId) {
                it.copy(
                    content = it.content + chunk,
                    activity = Activity.apply(it.activity, events),
                    // 正文开始出现前的时间就是"思考了多久"。
                    thinkingMs = it.thinkingMs ?: if (chunk.isNotEmpty()) receivedAt - startedAt else null,
                )
            }
        }

        chatJobs += run.job
        try {
            awaitSessionsRequest()
            coroutineScope {
                val ticker = launch {
                    while (true) {
                        delay(flushIntervalMs)
                        flush()
                    }
                }
                try {
                    backend.streamChat(request).collect { event ->
                        when (event) {
                            is ChatStreamEvent.Started -> if (sessionId == null && event.sessionId != null) {
                                sessionId = event.sessionId
                                migrate(run, event.sessionId)
                                refreshSessions()
                            }
                            is ChatStreamEvent.Delta -> pending.append(event.text)
                            // 进度条与提案卡片的事件；服务端追加的失败文的位置另外记下，并把本回合标为出错（不播完成反馈）。
                            is ChatStreamEvent.Activity -> {
                                val parsed = Activity.parseEvent(event.payload)
                                if (parsed != null) {
                                    if (parsed is ActivityEvent.Failure) streamFailed = true
                                    activityEvents += parsed
                                }
                                FailureInfo.from(event.payload)?.let { failureInfo ->
                                    streamFailed = true
                                    updateAssistant(run, assistantId) { it.copy(failure = failureInfo) }
                                }
                            }
                        }
                    }
                } finally {
                    ticker.cancel()
                }
            }
            completed = true
        } catch (cancelled: CancellationException) {
            // 用户点了停止：保留已经收到的文字。
            stopped = true
        } catch (error: Throwable) {
            failure = error
        } finally {
            chatJobs -= run.job
            withContext(NonCancellable) {
                flush()
                finishAssistant(run, turn, failure)
            }
        }
        // 停止时本机还留着这条回答（有正文或提案）：服务端也会把它存下来。
        val hasAnswer = stopped && cache[run.key]?.any { it.id == assistantId && (it.content.isNotBlank() || it.proposals.isNotEmpty() || it.activity.any { step -> step is ActivityStep.ProposalStep }) } == true
        // 编辑 / 重新生成没开始就失败：finishAssistant 已经退回原样，再核对一次服务端的状态。
        val resync = failure != null && turn.before != null && cache[run.key]?.none { it.id == assistantId } == true
        return TurnOutcome(
            sessionId, completed, streamFailed = streamFailed, stopped = stopped, hasAnswer = hasAnswer, resync = resync,
            knownBefore = turn.before.orEmpty().mapTo(mutableSetOf()) { it.id },
        )
    }

    private fun updateAssistant(run: TurnRun, id: String, transform: (UiMessage) -> UiMessage) {
        if (run.epoch != epoch) return
        updateCached(run.key) { list -> list.map { if (it.id == id) transform(it) else it } }
    }

    private fun toUiMessage(dto: MessageDto) = UiMessage(
        id = dto.id,
        role = when (dto.role.uppercase()) {
            "USER" -> MessageRole.User
            "ASSISTANT" -> MessageRole.Assistant
            else -> MessageRole.System
        },
        content = dto.content,
        attachments = dto.attachments.map { it.copy(dataUrl = it.dataUrl?.let(backend::absoluteUrl)) },
        images = dto.generatedImages.map { it.copy(dataUrl = backend.absoluteUrl(it.dataUrl)) },
        pages = dto.pages,
        thinkingMs = dto.thinkingMs,
        modelId = dto.model,
        failure = FailureInfo.fromActivity(dto.activity),
        activity = Activity.parseStored(dto.activity),
        proposals = Activity.parseStoredProposals(dto.proposals),
        versions = dto.versions,
    )

    companion object {
        private const val DRAFT_KEY = "draft"
        private const val QUOTE_KEY = "quote"

        /** 还没有会话 ID 的新聊天的本机键前缀（服务端的 ID 不会这样开头）。 */
        private const val NEW_CHAT_PREFIX = "new-chat:"

        /** 本机先放进对话的消息的 ID 前缀（服务端的 ID 不会这样开头）。 */
        private const val LOCAL_ID_PREFIX = "local-"

        /** 自己取消回答后，等服务端存好半截回答再对账：每次读取前等的毫秒数（网页 finishStoppedStream 的 500 / 1000 / 2000）。 */
        private val STOP_SYNC_WAITS = listOf(500L, 1000L, 2000L)

        /** 请服务端停止后，最多等这么久让回答自己结束（网页 8 秒），每隔一小段看一次。 */
        private const val STOP_WAIT_MS = 8000L
        private const val STOP_WAIT_STEP_MS = 200L

        /** 网页字典里的原句（译文在 system-text.json），服务端没给出原因时用。 */
        internal const val VERSION_SWITCH_FAILED = "Could not switch versions. Try again."
        internal const val BRANCH_FAILED = "Could not branch this chat. Try again."

        /** 被拒的提问的笔记排在前面，等待期间新选的笔记接在后面（同一篇只留一份；网页 setAttachedPages 的合并）。 */
        internal fun mergeRestoredPages(restored: List<ChatProjectNote>, current: List<ChatProjectNote>): List<ChatProjectNote> =
            if (restored.isEmpty()) current else restored + current.filterNot { page -> restored.any { it.id == page.id } }

        /** 被拒的原文 + 等待期间写的字（网页 page.tsx 的 restored）。 */
        internal fun mergeRejectedDraft(rejected: String, typedMeanwhile: String): String =
            if (typedMeanwhile.isNotBlank()) rejected.trimEnd() + "\n\n" + typedMeanwhile else rejected

        val Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                val app = extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as NoteFableApp
                return ChatViewModel(
                    app.api,
                    PrefsSettingsStore(app),
                    bundledModels = {
                        app.assets.open("models.json").use {
                            com.kakumine.notefable.data.NoteFableJson.decodeFromString<com.kakumine.notefable.data.ModelsResponse>(it.readBytes().decodeToString())
                        }
                    },
                    savedState = extras.createSavedStateHandle(),
                    saveIcon = com.kakumine.notefable.data.SessionsApi(app.api.http)::updateSessionIcon,
                    onMessageIdChanged = app.answerExports()::rename,
                ) as T
            }
        }
    }
}

/**
 * 回答失败时显示在"Request failed: …"后面的原因。连不上服务器（断网、域名解析失败、连接被拒或超时、TLS 握手失败）时
 * OkHttp 的原句是英文的技术信息（还带着主机地址），换成网页字典里的 [CONNECTION_FAILED]，界面按语言显示译文；
 * 服务端返回的错误（[ApiException]）和其它异常保持原句，和网页一样。
 */
internal fun chatFailureDetail(error: Throwable): String = when (error) {
    is ApiException -> error.message ?: error.javaClass.simpleName
    is java.net.UnknownHostException, is java.net.SocketException,
    is java.net.SocketTimeoutException, is javax.net.ssl.SSLException -> CONNECTION_FAILED
    else -> error.message ?: error.javaClass.simpleName
}

/** 网页字典里的 "Check your connection and try again."（界面用 R.string.check_connection 显示译文）。 */
internal const val CONNECTION_FAILED = "Check your connection and try again."

/**
 * 对账：先按服务端 ID 沿用旧列表里已有的 key（之前的回合对账过、key 还是 `local-N` 的消息，不能退回服务端 ID 而重建，
 * 否则它进行中的下载等界面状态会被丢掉）。再处理刚发送的这一回合：服务端列表末尾就是它，从两边末尾往前，
 * 旧列表里还是本地 ID 且角色相同的消息，把它的 key 交给服务端的那条（见 [UiMessage.key]）。
 */
internal fun carryLocalKeys(old: List<UiMessage>, loaded: List<UiMessage>): List<UiMessage> {
    val keysById = old.asSequence().filter { !it.id.startsWith("local-") && it.key != it.id }.associate { it.id to it.key }
    val result = loaded.mapTo(mutableListOf()) { m -> keysById[m.id]?.let { m.copy(key = it) } ?: m }
    var i = old.lastIndex
    var j = result.lastIndex
    while (i >= 0 && j >= 0 && old[i].id.startsWith("local-") && old[i].role == result[j].role) {
        result[j] = result[j].copy(key = old[i].key)
        i--
        j--
    }
    return result
}

/** 这次对账里从本地 ID 换成服务端 ID 的消息：(旧 ID, 新 ID)。 */
internal fun replacedLocalIds(old: List<UiMessage>, merged: List<UiMessage>): List<Pair<String, String>> {
    val oldByKey = old.filter { it.id.startsWith("local-") }.associateBy { it.key }
    return merged.mapNotNull { m -> oldByKey[m.key]?.takeIf { it.id != m.id }?.let { it.id to m.id } }
}
