package com.kakumine.studymate.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.kakumine.studymate.StudyMateApp
import com.kakumine.studymate.data.AttachmentDto
import com.kakumine.studymate.data.ChatBackend
import com.kakumine.studymate.data.ChatRequest
import com.kakumine.studymate.data.ChatStreamEvent
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
)

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
) {
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
) : ViewModel() {
    private val _state = MutableStateFlow(
        ChatUiState(chosenModelId = settings.modelId, chosenReasoning = settings.reasoning),
    )
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

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
        _state.update {
            it.copy(
                sessions = emptyList(), sessionsLoading = true, sessionsFailed = false,
                activeSessionId = null, messages = emptyList(), messagesLoading = false, messagesFailed = false,
            )
        }
        refreshSessions()
    }

    fun newChat() {
        stop()
        loadJob?.cancel()
        _state.update { it.copy(activeSessionId = null, messages = emptyList(), messagesLoading = false, messagesFailed = false) }
    }

    fun openSession(id: String) {
        if (_state.value.activeSessionId == id) return
        // 切换会话时停掉进行中的回答，避免它的文字写进别的会话。
        stop()
        _state.update { it.copy(activeSessionId = id, messages = emptyList(), messagesLoading = true, messagesFailed = false) }
        loadMessages(id)
    }

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
            result
                .onSuccess { list ->
                    _state.update {
                        if (it.activeSessionId != sessionId) it
                        else it.copy(messages = list.map(::toUiMessage), messagesLoading = false, messagesFailed = false)
                    }
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

    // ---- 发送 ----

    fun stop() {
        streamJob?.cancel()
    }

    fun send(text: String) {
        val prompt = text.trim()
        val current = _state.value
        // 历史还在加载、或加载失败时发送，新消息会插进空列表（失败页还会盖住它们）；而回答结束后的对账又会换掉整个列表。读到历史再发。
        if (prompt.isEmpty() || current.sending || current.messagesLoading || current.messagesFailed) return
        // 正在进行的静默对账返回的是发送前的快照，会抹掉刚加进去的消息，所以先取消。
        loadJob?.cancel()

        val assistantId = "local-${++localIds}"
        val userMessage = UiMessage("local-${++localIds}", MessageRole.User, prompt)
        val assistantMessage = UiMessage(assistantId, MessageRole.Assistant, "", streaming = true, modelId = current.selectedModel?.id)
        _state.update { it.copy(messages = it.messages + userMessage + assistantMessage, sending = true) }

        val request = ChatRequest(
            message = prompt,
            sessionId = current.activeSessionId,
            model = current.selectedModel?.id,
            reasoning = current.selectedReasoning,
            webSearch = if (current.selectedModel?.supportsWebSearch == false) "off" else "auto",
        )
        streamJob = viewModelScope.launch { runStream(assistantId, request) }
    }

    private suspend fun runStream(assistantId: String, request: ChatRequest) {
        val pending = StringBuilder()
        var sessionId = request.sessionId
        var failure: Throwable? = null
        var completed = false

        fun flush() {
            if (pending.isEmpty()) return
            val chunk = pending.toString()
            pending.setLength(0)
            updateAssistant(assistantId) { it.copy(content = it.content + chunk) }
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
                            is ChatStreamEvent.Activity -> Unit // 推理/搜索进度条后续再做原生展示
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
                val failed = failure
                _state.update { state ->
                    val messages = state.messages.mapNotNull { message ->
                        if (message.id != assistantId) return@mapNotNull message
                        when {
                            failed != null -> message.copy(streaming = false, errorDetail = failed.message ?: failed.javaClass.simpleName)
                            // 没收到任何文字就被停止：不留空气泡。
                            message.content.isEmpty() -> null
                            else -> message.copy(streaming = false)
                        }
                    }
                    state.copy(messages = messages, sending = false)
                }
            }
        }

        val finishedSession = sessionId ?: return
        refreshSessions()
        // 正常结束时用服务器上保存的版本对账（拿到真实 ID、生成的图片、思考时长）。
        // 被停止时不对账：服务器不一定保存了已生成的半截回答，替换后屏幕上的文字可能凭空消失。
        if (completed && _state.value.activeSessionId == finishedSession) {
            loadMessages(finishedSession, quiet = true)
        }
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
    )

    companion object {
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
                ) as T
            }
        }
    }
}
