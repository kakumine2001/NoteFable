package com.kakumine.studymate.ui

import androidx.lifecycle.createSavedStateHandle

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.kakumine.studymate.StudyMateApp
import com.kakumine.studymate.data.ApiException
import com.kakumine.studymate.data.AttachError
import com.kakumine.studymate.data.AttachmentDto
import com.kakumine.studymate.data.LocalFile
import com.kakumine.studymate.data.attachmentError
import com.kakumine.studymate.data.selectionError
import com.kakumine.studymate.data.ChatBackend
import com.kakumine.studymate.data.ChatLink
import com.kakumine.studymate.data.ChatRequest
import com.kakumine.studymate.data.ChatStreamEvent
import com.kakumine.studymate.data.Activity
import com.kakumine.studymate.data.ActivityEvent
import com.kakumine.studymate.data.ActivityStep
import com.kakumine.studymate.data.FailureInfo
import com.kakumine.studymate.data.Proposal
import com.kakumine.studymate.data.GeneratedImageDto
import com.kakumine.studymate.data.MessageDto
import com.kakumine.studymate.data.ModelInfo
import com.kakumine.studymate.data.SessionSummary
import kotlinx.coroutines.CancellationException
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
    val streaming: Boolean = false,
    /** 生成这条回答的模型 ID，用来在回答上方显示"StudyMate · 模型名"。 */
    val modelId: String? = null,
    /** 请求失败时的原因（服务端或网络给出的文字），界面再套本地化外壳。 */
    val errorDetail: String? = null,
    val thinkingMs: Long? = null,
    /** 正在生成图片：显示占位卡片而不是转圈。 */
    val generatingImage: Boolean = false,
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
)

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
    /** 链接（?chat=）里的 ID 不对：网页在输入栏上方显示 "Failed to load conversation."。 */
    data object LinkFailed : ComposerNotice
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
    val sending: Boolean = false,
    /** 选好、还没发送的附件。 */
    val files: List<LocalFile> = emptyList(),
    /** 「生成图片」模式：下一条消息交给图片接口。 */
    val imageMode: Boolean = false,
    val upload: UploadProgress? = null,
    val notice: ComposerNotice? = null,
    /** 每成功发出一条消息加一；输入栏据此清空草稿（上传失败时不清，文字还在）。 */
    val sentCount: Int = 0,
    /** 等消息读完后要定位的消息（Batch 4）。 */
    val reveal: MessageReveal? = null,
    /**
     * 未登录用户撞到当日上限（429 usage_limit、tier = guest）时是 "chat" 或 "image"：
     * 输入栏上方显示登录提示（网页 GuestLimitPrompt）。关掉、登录或退出后清空。
     */
    val guestLimit: String? = null,
    /** 还在拷贝、校验的附件（粘贴的图片、刚选的文件）有几批；没处理完前不能发送，否则它们会漏掉、跑到下一条里。 */
    val importing: Int = 0,
) {
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

    val activeIcon: String?
        get() = sessions.firstOrNull { it.id == activeSessionId }?.icon
}

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
    private val bundledModels: () -> com.kakumine.studymate.data.ModelsResponse? = { null },
    /** 草稿也存进这里，App 在后台被系统杀掉后回来仍在（和原来的 rememberSaveable 一样）。 */
    private val savedState: androidx.lifecycle.SavedStateHandle = androidx.lifecycle.SavedStateHandle(),
    /**
     * 对账把一条消息的本地 ID（`local-N`）换成服务端 ID 时调用（会话 ID、旧 ID、新 ID）。
     * "存到笔记"的状态据此搬到新 ID 下，不依赖那条回答此刻是否在屏幕上（AnswerExportStore.rename）。主线程调用。
     */
    private val onMessageIdChanged: (sessionId: String, from: String, to: String) -> Unit = { _, _, _ -> },
) : ViewModel() {
    private val _state = MutableStateFlow(
        ChatUiState(chosenModelId = settings.modelId, chosenReasoning = settings.reasoning),
    )
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    /**
     * 输入栏里还没发出的文字。放在 ViewModel 里，切到笔记再切回来、换屏幕方向都还在。
     * 用 Compose 的状态而不是 StateFlow：输入框每次按键同步更新，光标不会跳。
     */
    var draft by mutableStateOf(savedState.get<String>(DRAFT_KEY) ?: "")
        private set

    fun updateDraft(text: String) {
        draft = text
        savedState[DRAFT_KEY] = text
    }

    private var streamJob: Job? = null
    private var loadJob: Job? = null
    private var sessionsJob: Job? = null
    private var localIds = 0L

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
            val result = runCatching { backend.sessions() }
            ensureActive()
            result
                .onSuccess { list -> _state.update { it.copy(sessions = list, sessionsLoading = false, sessionsFailed = false) } }
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
        if (_state.value.activeSessionId == id) newChat()
        patchSessions { list -> list.filterNot { it.id == id } }
    }

    /** 刚在项目里建好的空聊天：放到列表最前并打开（网页 createSession(projectId)）。 */
    fun openCreatedSession(session: SessionSummary) {
        navigationCount++
        stop()
        loadJob?.cancel()
        _state.update {
            it.copy(
                sessions = listOf(session) + it.sessions.filterNot { s -> s.id == session.id },
                activeSessionId = session.id, messages = emptyList(), messagesLoading = false, messagesFailed = false,
                reveal = null, notice = it.notice.clearLinkFailed(),
            )
        }
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

    /** 登录或退出后身份变了：清掉当前聊天和列表，按新身份重新加载。 */
    fun onIdentityChanged() {
        stop()
        loadJob?.cancel()
        // 草稿文字留着（网页登录前把它预存起来、回来后放回输入栏）；附件和网页一样不跨登录保留（网页登录会重载页面，
        // 登录提示里也写着"登录时不会保留附件"）。
        _state.update {
            it.copy(
                sessions = emptyList(), sessionsLoading = true, sessionsFailed = false,
                activeSessionId = null, messages = emptyList(), messagesLoading = false, messagesFailed = false,
                files = if (it.upload == null) emptyList() else it.files, notice = null, guestLimit = null, reveal = null,
            )
        }
        refreshSessions()
    }

    /** 每次换到别的聊天（新聊天、打开历史聊天、打开刚建的聊天）加一，用来判断慢请求回来时用户是否已经去了别处。 */
    var navigationCount = 0L
        private set

    fun newChat() {
        navigationCount++
        stop()
        loadJob?.cancel()
        _state.update {
            it.copy(activeSessionId = null, messages = emptyList(), messagesLoading = false, messagesFailed = false, reveal = null, notice = it.notice.clearLinkFailed())
        }
    }

    fun openSession(id: String) {
        navigationCount++
        // 换了聊天：之前的定位请求和链接错误都作废（网页 loadMessages 的 cancelReveal / setSendError("")）。
        _state.update { it.copy(reveal = null, notice = it.notice.clearLinkFailed()) }
        if (_state.value.activeSessionId == id) return
        // 切换会话时停掉进行中的回答，避免它的文字写进别的会话。
        stop()
        _state.update { it.copy(activeSessionId = id, messages = emptyList(), messagesLoading = true, messagesFailed = false) }
        loadMessages(id)
    }

    /** 从检索结果或链接打开聊天，有 [messageId] 时读完后滚到那条消息并闪一下（网页 openChatFromLink）。 */
    fun openSessionAt(id: String, messageId: String?) {
        val wasActive = _state.value.activeSessionId == id
        openSession(id)
        if (messageId == null) return
        // 已经开着这段聊天、但本地历史里没有这条（别的设备后来加的）：先重读历史再定位，免得把存在的消息当成已删除。
        // 正在生成时不重读，免得覆盖进行中的回答；这时找不到就按不存在处理。
        val current = _state.value
        val reload = wasActive && !current.sending && !current.messagesLoading && current.messages.none { it.id == messageId }
        _state.update {
            it.copy(reveal = MessageReveal(id, messageId, ++revealTokens), messagesLoading = it.messagesLoading || reload)
        }
        if (reload) loadMessages(id)
    }

    /** 链接里的 ID 形式不对：和网页一样回到新聊天，在输入栏上方提示读不到。 */
    fun showLinkFailed() {
        newChat()
        _state.update { it.copy(notice = ComposerNotice.LinkFailed) }
    }

    // 外部链接（VIEW intent）：交给 StudyMateRoot，先关掉检索面板和抽屉再打开（它们是界面状态，不在 ViewModel 里）。
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

    private fun ComposerNotice?.clearLinkFailed() = takeUnless { it == ComposerNotice.LinkFailed }

    fun reloadActive() {
        _state.value.activeSessionId?.let { loadMessages(it) }
    }

    private fun loadMessages(sessionId: String, quiet: Boolean = false, keepLocalKeys: Boolean = false) {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            if (!quiet) _state.update { it.copy(messagesLoading = true, messagesFailed = false) }
            val result = runCatching { backend.messages(sessionId) }
            // 在途请求被取消（切换会话、开始发送）后不能再写回界面。
            ensureActive()
            result
                .onSuccess { list ->
                    val current = _state.value
                    if (current.activeSessionId != sessionId) return@onSuccess
                    val loaded = list.map(::toUiMessage)
                    // 同一段聊天的任何重读（回答结束后的对账、重试、检索前补读）都沿用本地 key 并报告换掉的 ID：
                    // 对账可能被后来的重读取消，那时这里接着做，免得行重建、"已存到笔记"挂在旧 ID 上。
                    // （换聊天时 messages 已清空，这两步什么都不做。）
                    val messages = carryLocalKeys(current.messages, loaded)
                    replacedLocalIds(current.messages, messages).forEach { (from, to) -> onMessageIdChanged(sessionId, from, to) }
                    _state.update { it.copy(messages = messages, messagesLoading = false, messagesFailed = false) }
                }
                .onFailure {
                    _state.update { s ->
                        if (s.activeSessionId != sessionId || quiet) s.copy(messagesLoading = false)
                        else s.copy(messagesLoading = false, messagesFailed = true)
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

    fun dismissGuestLimit() {
        _state.update { it.copy(guestLimit = null) }
    }

    fun setImageMode(on: Boolean) {
        _state.update { it.copy(imageMode = on) }
    }

    // ---- 发送 ----

    fun stop() {
        streamJob?.cancel()
    }

    fun send(text: String) {
        val prompt = text.trim()
        val current = _state.value
        // 历史还在加载、或加载失败时发送，新消息会插进空列表（失败页还会盖住它们）；而回答结束后的对账又会换掉整个列表。读到历史再发。
        if (prompt.isEmpty() || current.sending || current.messagesLoading || current.messagesFailed) return
        if (current.upload != null || current.filesError != null || current.importing > 0) return
        // 正在进行的静默对账返回的是发送前的快照，会抹掉刚加进去的消息，所以先取消。
        loadJob?.cancel()

        val files = current.files
        val imageMode = current.imageMode
        val request = ChatRequest(
            message = prompt,
            sessionId = current.activeSessionId,
            model = current.selectedModel?.id,
            reasoning = current.selectedReasoning,
            webSearch = if (current.selectedModel?.supportsWebSearch == false) "off" else "auto",
        )

        if (files.isEmpty()) {
            val turn = beginTurn(prompt, text, files, imageMode, current.selectedModel?.id)
            streamJob = viewModelScope.launch { runTurn(turn, request, imageMode) }
            return
        }

        // 和网页一样先上传、成功后才把这条消息放进对话；上传失败时文字和附件都留在输入栏。
        _state.update { it.copy(sending = true, upload = UploadProgress.Preparing, notice = null) }
        streamJob = viewModelScope.launch {
            val tickets = uploadFiles(files) ?: return@launch
            val turn = beginTurn(prompt, text, files, imageMode, current.selectedModel?.id)
            runTurn(turn, request.copy(uploads = tickets), imageMode)
        }
    }

    /** 一次发送：两个气泡的本地 ID，以及被上限拒绝时要放回输入栏的原文和附件。 */
    private class Turn(val assistantId: String, val userId: String, val rawText: String, val files: List<LocalFile>)

    /** 把提问和等待中的回答放进对话，并清空输入栏里的附件。 */
    private fun beginTurn(prompt: String, rawText: String, files: List<LocalFile>, imageMode: Boolean, modelId: String?): Turn {
        val assistantId = "local-${++localIds}"
        val userId = "local-${++localIds}"
        val userMessage = UiMessage(
            userId, MessageRole.User, prompt,
            // 发送后先用本机文件显示缩略图，回答结束后换成服务器保存的版本。
            attachments = files.map { AttachmentDto(it.uri, it.name, it.mimeType, it.size, it.uri.takeIf { _ -> it.isImage }) },
        )
        val assistantMessage = UiMessage(
            assistantId, MessageRole.Assistant, "", streaming = true,
            // 图片不是聊天模型画的，回答上方不显示模型名（和网页一致）。
            modelId = modelId.takeIf { !imageMode }, generatingImage = imageMode,
        )
        _state.update {
            it.copy(
                messages = it.messages + userMessage + assistantMessage, sending = true,
                files = emptyList(), upload = null, notice = null, sentCount = it.sentCount + 1,
            )
        }
        // 消息真正发出去之后才清空草稿：附件上传失败时文字还留在输入栏里。
        updateDraft("")
        return Turn(assistantId, userId, rawText, files)
    }

    /** 逐个上传附件，返回凭证；失败或被取消时清掉已上传的文件并返回 null（被取消时向上抛出）。 */
    private suspend fun uploadFiles(files: List<LocalFile>): List<String>? {
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
            return tickets
        } catch (error: Throwable) {
            withContext(NonCancellable) { backend.discardUploads(tickets) }
            _state.update {
                it.copy(sending = false, upload = null, notice = if (error is CancellationException) it.notice else ComposerNotice.UploadFailed)
            }
            if (error is CancellationException) throw error
            return null
        }
    }

    private suspend fun runTurn(turn: Turn, request: ChatRequest, imageMode: Boolean) {
        if (imageMode) runImage(turn, request) else runStream(turn, request)
    }

    private suspend fun runImage(turn: Turn, request: ChatRequest) {
        val assistantId = turn.assistantId
        var sessionId = request.sessionId
        var failure: Throwable? = null
        var completed = false
        // 网页在分到 /api/images 之前就记下开始时间：等待秒数不因界面重组而归零。
        updateAssistant(assistantId) { it.copy(startedAt = System.currentTimeMillis()) }
        try {
            awaitSessionsRequest()
            val result = backend.generateImage(request)
            result.error?.let { throw java.io.IOException(it) }
            val image = result.image?.takeIf { it.dataUrl.isNotEmpty() } ?: throw java.io.IOException("Failed to generate image.")
            if (sessionId == null && result.sessionId != null) {
                sessionId = result.sessionId
                _state.update { it.copy(activeSessionId = result.sessionId) }
            }
            updateAssistant(assistantId) {
                it.copy(generatingImage = false, images = listOf(GeneratedImageDto("local-${++localIds}", image.dataUrl, image.mimeType)))
            }
            completed = true
        } catch (cancelled: CancellationException) {
            // 用户点了停止，或切换了会话。
        } catch (error: Throwable) {
            failure = error
        } finally {
            withContext(NonCancellable) { finishAssistant(turn, failure) }
        }
        reconcile(sessionId, completed)
    }

    /** 回答结束（完成、失败或被停止）时收尾：去掉"进行中"状态，失败则记下原因。 */
    private fun finishAssistant(turn: Turn, failed: Throwable?) {
        val assistantId = turn.assistantId
        val limited = failed is ApiException && failed.isUsageLimit
        if (limited) restoreRejected(turn, failed as ApiException)
        _state.update { state ->
            val messages = state.messages.mapNotNull { message ->
                // 被拒的提问不再显示本机图片：附件已经放回输入栏（网页 stripAttachmentPreviewUrls）。
                if (limited && message.id == turn.userId) {
                    return@mapNotNull message.copy(attachments = message.attachments.map { it.copy(dataUrl = null) })
                }
                if (message.id != assistantId) return@mapNotNull message
                val done = message.copy(streaming = false, generatingImage = false)
                when {
                    limited -> done.copy(content = failed?.message.orEmpty(), usageLimit = true, failure = null)
                    failed != null -> done.copy(errorDetail = failed.message ?: failed.javaClass.simpleName)
                    // 没收到任何内容就被停止：不留空气泡。已有过程或提案卡片（服务器已存了提案）时保留，和网页一样。
                    message.content.isEmpty() && message.images.isEmpty() &&
                        message.activity.isEmpty() && message.proposals.isEmpty() -> null
                    else -> done
                }
            }
            state.copy(messages = messages, sending = false)
        }
    }

    /**
     * 上限拒绝的发送没有保存在任何地方：和网页一样把原文和附件放回输入栏。
     * 等待期间又写了字或加了附件的话不覆盖，被拒的原文放在前面（空一行），附件也排在前面。
     * 未登录用户（tier = guest）另外显示登录提示。
     */
    private fun restoreRejected(turn: Turn, error: ApiException) {
        val typedMeanwhile = draft
        updateDraft(mergeRejectedDraft(turn.rawText, typedMeanwhile))
        _state.update { state ->
            state.copy(
                files = if (turn.files.isEmpty()) state.files
                else turn.files + state.files.filterNot { current -> turn.files.any { it.uri == current.uri } },
                guestLimit = if (error.tier == "guest") (if (error.kind == "image") "image" else "chat") else state.guestLimit,
            )
        }
    }

    private fun reconcile(sessionId: String?, completed: Boolean) {
        val finishedSession = sessionId ?: return
        refreshSessions()
        // 正常结束时用服务器上保存的版本对账（拿到真实 ID、生成的图片、思考时长）。
        // 被停止时不对账：服务器不一定保存了已生成的半截回答，替换后屏幕上的文字可能凭空消失。
        if (completed && _state.value.activeSessionId == finishedSession) {
            loadMessages(finishedSession, quiet = true, keepLocalKeys = true)
        }
    }

    private suspend fun runStream(turn: Turn, request: ChatRequest) {
        val assistantId = turn.assistantId
        val pending = StringBuilder()
        // 过程事件（推理摘要是很碎的增量）和正文一起攒着，每次刷新只重组一次（网页每次 read 合并一次）。
        val activityEvents = mutableListOf<ActivityEvent>()
        var sessionId = request.sessionId
        var failure: Throwable? = null
        var completed = false
        val startedAt = System.currentTimeMillis()
        updateAssistant(assistantId) { it.copy(startedAt = startedAt) }

        fun flush() {
            if (pending.isEmpty() && activityEvents.isEmpty()) return
            val chunk = pending.toString()
            pending.setLength(0)
            val events = activityEvents.toList()
            activityEvents.clear()
            val receivedAt = System.currentTimeMillis()
            updateAssistant(assistantId) {
                it.copy(
                    content = it.content + chunk,
                    activity = Activity.apply(it.activity, events),
                    // 正文开始出现前的时间就是"思考了多久"。
                    thinkingMs = it.thinkingMs ?: if (chunk.isNotEmpty()) receivedAt - startedAt else null,
                )
            }
        }

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
                                _state.update { it.copy(activeSessionId = event.sessionId) }
                                refreshSessions()
                            }
                            is ChatStreamEvent.Delta -> pending.append(event.text)
                            // 进度条与提案卡片的事件；服务端追加的失败文的位置另外记下。
                            is ChatStreamEvent.Activity -> {
                                Activity.parseEvent(event.payload)?.let(activityEvents::add)
                                FailureInfo.from(event.payload)?.let { failure ->
                                    updateAssistant(assistantId) { it.copy(failure = failure) }
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
            // 用户点了停止，或切换了会话：保留已经收到的文字。
        } catch (error: Throwable) {
            failure = error
        } finally {
            withContext(NonCancellable) {
                flush()
                finishAssistant(turn, failure)
            }
        }
        reconcile(sessionId, completed)
    }

    private fun updateAssistant(id: String, transform: (UiMessage) -> UiMessage) {
        _state.update { state ->
            state.copy(messages = state.messages.map { if (it.id == id) transform(it) else it })
        }
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
        thinkingMs = dto.thinkingMs,
        modelId = dto.model,
        failure = FailureInfo.fromActivity(dto.activity),
        activity = Activity.parseStored(dto.activity),
        proposals = Activity.parseStoredProposals(dto.proposals),
    )

    companion object {
        private const val DRAFT_KEY = "draft"

        /** 被拒的原文 + 等待期间写的字（网页 page.tsx 的 restored）。 */
        internal fun mergeRejectedDraft(rejected: String, typedMeanwhile: String): String =
            if (typedMeanwhile.isNotBlank()) rejected.trimEnd() + "\n\n" + typedMeanwhile else rejected

        val Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                val app = extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as StudyMateApp
                return ChatViewModel(
                    app.api,
                    PrefsSettingsStore(app),
                    bundledModels = {
                        app.assets.open("models.json").use {
                            com.kakumine.studymate.data.StudyMateJson.decodeFromString<com.kakumine.studymate.data.ModelsResponse>(it.readBytes().decodeToString())
                        }
                    },
                    savedState = extras.createSavedStateHandle(),
                    onMessageIdChanged = app.answerExports()::rename,
                ) as T
            }
        }
    }
}

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
