package com.kakumine.studymate.ui

import com.kakumine.studymate.data.ChatBackend
import com.kakumine.studymate.data.ChatRequest
import com.kakumine.studymate.data.ChatStreamEvent
import com.kakumine.studymate.data.MessageDto
import com.kakumine.studymate.data.ModelInfo
import com.kakumine.studymate.data.ModelsResponse
import com.kakumine.studymate.data.SessionSummary
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class MemorySettings : SettingsStore {
        override var modelId: String? = null
        override var reasoning: String? = null
    }

    private class FakeBackend : ChatBackend {
        val requests = mutableListOf<ChatRequest>()
        var models: ModelsResponse? = ModelsResponse(
            defaultModel = "a",
            models = listOf(
                ModelInfo("a", "Model A", supportsWebSearch = true, reasoningEfforts = listOf("low", "medium", "high"), defaultReasoning = "medium"),
                ModelInfo("b", "Model B", supportsWebSearch = false, reasoningEfforts = listOf("low", "high"), defaultReasoning = "high"),
            ),
        )
        var stored = listOf<MessageDto>()
        var events = Channel<ChatStreamEvent>(Channel.UNLIMITED)
        var streamError: Throwable? = null

        var sessionsHandler: suspend (call: Int) -> List<SessionSummary> = { emptyList() }
        var messagesHandler: suspend (sessionId: String) -> List<MessageDto> = { stored }
        private var sessionsCalls = 0

        override suspend fun sessions(): List<SessionSummary> = sessionsHandler(++sessionsCalls)
        override suspend fun messages(sessionId: String): List<MessageDto> = messagesHandler(sessionId)
        override suspend fun models(): ModelsResponse = models ?: throw IOException("404")
        override fun absoluteUrl(path: String) = "https://example.test$path"
        override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> {
            requests += request
            val error = streamError
            return if (error != null) flow { throw error } else events.receiveAsFlow()
        }
    }

    // 回答进行中刷新定时器一直在排队，advanceUntilIdle 永远等不到空闲；这里只推进一小段虚拟时间。
    private fun TestScope.settle() {
        advanceTimeBy(100)
        runCurrent()
    }

    private fun TestScope.newViewModel(backend: FakeBackend, settings: SettingsStore = MemorySettings()): ChatViewModel {
        val viewModel = ChatViewModel(backend, settings, flushIntervalMs = 10)
        advanceUntilIdle()
        return viewModel
    }

    @Test
    fun `streams text into the assistant bubble, adopts the new session id and reconciles with the server`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)

        vm.send("  hi  ")
        backend.events.send(ChatStreamEvent.Started("s1"))
        backend.events.send(ChatStreamEvent.Delta("Hel"))
        backend.events.send(ChatStreamEvent.Delta("lo"))
        settle()

        assertEquals("s1", vm.state.value.activeSessionId)
        assertTrue(vm.state.value.sending)
        assertEquals(listOf("hi", "Hello"), vm.state.value.messages.map { it.content })
        assertTrue(vm.state.value.messages.last().streaming)

        backend.stored = listOf(
            MessageDto("db-1", "USER", "hi"),
            MessageDto("db-2", "ASSISTANT", "Hello", thinkingMs = 1200),
        )
        backend.events.close()
        advanceUntilIdle()

        val state = vm.state.value
        assertFalse(state.sending)
        assertEquals(listOf("db-1", "db-2"), state.messages.map { it.id })
        assertEquals(1200L, state.messages.last().thinkingMs)
        assertFalse(state.messages.last().streaming)
    }

    @Test
    fun `a failed request records the reason on the assistant bubble`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)
        backend.streamError = IOException("Daily limit reached")

        vm.send("hi")
        advanceUntilIdle()

        val assistant = vm.state.value.messages.last()
        assertEquals("Daily limit reached", assistant.errorDetail)
        assertFalse(assistant.streaming)
        assertFalse(vm.state.value.sending)
    }

    @Test
    fun `stopping keeps what arrived, and drops an empty bubble`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)

        vm.send("one")
        backend.events.send(ChatStreamEvent.Started("s1"))
        backend.events.send(ChatStreamEvent.Delta("partial"))
        settle()
        vm.stop()
        advanceUntilIdle()
        assertEquals(listOf("one", "partial"), vm.state.value.messages.map { it.content }.take(2))
        assertFalse(vm.state.value.sending)

        backend.events = Channel(Channel.UNLIMITED)
        vm.newChat()
        vm.send("two")
        settle()
        vm.stop()
        advanceUntilIdle()
        assertEquals(listOf("two"), vm.state.value.messages.map { it.content })
    }

    @Test
    fun `switching chats stops the running answer so it cannot leak into the other chat`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)

        vm.send("q")
        backend.events.send(ChatStreamEvent.Started("s1"))
        settle()
        vm.openSession("s2")
        advanceUntilIdle()

        assertFalse(vm.state.value.sending)
        assertEquals("s2", vm.state.value.activeSessionId)
    }

    @Test
    fun `a second send while one is running is ignored`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)

        vm.send("first")
        vm.send("second")
        settle()

        assertEquals(1, backend.requests.size)
        vm.stop()
        advanceUntilIdle()
    }

    @Test
    fun `request carries the chosen model, a supported reasoning level and web search support`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val settings = MemorySettings()
        val vm = newViewModel(backend, settings)

        vm.selectModel("a")
        vm.selectReasoning("medium") // b 不支持 medium
        vm.selectModel("b")
        assertEquals("high", vm.state.value.selectedReasoning)

        vm.selectModel("a")
        vm.selectReasoning("low") // b 也支持 low，切换后保留
        vm.selectModel("b")
        assertEquals("low", vm.state.value.selectedReasoning)

        vm.send("x")
        settle()
        val request = backend.requests.single()
        assertEquals("b", request.model)
        assertEquals("low", request.reasoning)
        assertEquals("off", request.webSearch)
        assertEquals("b", settings.modelId)
        vm.stop()
        advanceUntilIdle()
    }

    @Test
    fun `an unsupported saved reasoning level falls back to the model default`() = runTest(dispatcher) {
        val settings = MemorySettings().apply {
            modelId = "b"
            reasoning = "medium"
        }
        val vm = newViewModel(FakeBackend(), settings)
        assertEquals("high", vm.state.value.selectedReasoning)
    }

    @Test
    fun `without a model list the request leaves model and reasoning to the server`() = runTest(dispatcher) {
        val backend = FakeBackend().apply { models = null }
        val vm = newViewModel(backend)

        vm.send("x")
        settle()

        val request = backend.requests.single()
        assertNull(request.model)
        assertNull(request.reasoning)
        vm.stop()
        advanceUntilIdle()
    }

    @Test
    fun `the first chat request waits for the initial session list so only one device identity is created`() = runTest(dispatcher) {
        val gate = CompletableDeferred<Unit>()
        val backend = FakeBackend().apply {
            sessionsHandler = {
                gate.await()
                emptyList()
            }
        }
        val vm = newViewModel(backend)

        vm.send("hello")
        settle()
        assertTrue("chat request must not start while the session list is in flight", backend.requests.isEmpty())
        assertTrue(vm.state.value.sending)

        gate.complete(Unit)
        settle()
        assertEquals(1, backend.requests.size)

        vm.stop()
        advanceUntilIdle()
    }

    @Test
    fun `an older session list response cannot overwrite a newer one`() = runTest(dispatcher) {
        val slow = CompletableDeferred<List<SessionSummary>>()
        val backend = FakeBackend().apply {
            sessionsHandler = { call -> if (call == 1) slow.await() else listOf(SessionSummary("new", "New")) }
        }
        val vm = newViewModel(backend) // 第 1 次刷新卡在 slow 上
        vm.refreshSessions() // 第 2 次立即返回
        advanceUntilIdle()
        assertEquals(listOf("new"), vm.state.value.sessions.map { it.id })

        slow.complete(listOf(SessionSummary("old", "Old")))
        advanceUntilIdle()
        assertEquals(listOf("new"), vm.state.value.sessions.map { it.id })
    }

    @Test
    fun `a later successful refresh clears the failed state`() = runTest(dispatcher) {
        val backend = FakeBackend().apply {
            sessionsHandler = { call -> if (call == 1) throw IOException("offline") else listOf(SessionSummary("a", "A")) }
        }
        val vm = newViewModel(backend)
        assertTrue(vm.state.value.sessionsFailed)

        vm.refreshSessions()
        advanceUntilIdle()
        assertFalse(vm.state.value.sessionsFailed)
        assertEquals(listOf("a"), vm.state.value.sessions.map { it.id })
    }

    @Test
    fun `sending starts a new question that a late history response cannot erase`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)

        // 第一个回答正常结束，触发静默对账；让对账请求卡住。
        vm.send("first")
        backend.events.send(ChatStreamEvent.Started("s1"))
        backend.events.send(ChatStreamEvent.Delta("answer"))
        val reconcile = CompletableDeferred<List<MessageDto>>()
        backend.messagesHandler = { reconcile.await() }
        backend.events.close()
        advanceUntilIdle()
        assertFalse(vm.state.value.sending)

        // 对账还没返回时就追问。
        backend.events = Channel(Channel.UNLIMITED)
        vm.send("second")
        backend.events.send(ChatStreamEvent.Delta("again"))
        settle()

        // 迟到的快照（发送前的内容）不应该覆盖屏幕。
        reconcile.complete(listOf(MessageDto("db-1", "USER", "first"), MessageDto("db-2", "ASSISTANT", "answer")))
        settle()
        assertEquals(listOf("first", "answer", "second", "again"), vm.state.value.messages.map { it.content })

        vm.stop()
        advanceUntilIdle()
    }

    @Test
    fun `sending is ignored while the chat history is still loading`() = runTest(dispatcher) {
        val gate = CompletableDeferred<List<MessageDto>>()
        val backend = FakeBackend().apply { messagesHandler = { gate.await() } }
        val vm = newViewModel(backend)

        vm.openSession("s1")
        advanceUntilIdle()
        assertTrue(vm.state.value.messagesLoading)

        vm.send("too early")
        advanceUntilIdle()
        assertTrue(backend.requests.isEmpty())
        assertFalse(vm.state.value.sending)

        gate.complete(listOf(MessageDto("db-1", "USER", "old")))
        advanceUntilIdle()
        assertEquals(listOf("old"), vm.state.value.messages.map { it.content })
    }

    @Test
    fun `sending is ignored after the history failed to load, until a reload succeeds`() = runTest(dispatcher) {
        var failing = true
        val backend = FakeBackend().apply {
            messagesHandler = {
                if (failing) throw IOException("offline")
                listOf(MessageDto("db-1", "USER", "old"))
            }
        }
        val vm = newViewModel(backend)

        vm.openSession("s1")
        advanceUntilIdle()
        assertTrue(vm.state.value.messagesFailed)

        // 失败页盖在消息列表上，此时发出去的提问和回答用户看不到。
        vm.send("hello")
        advanceUntilIdle()
        assertTrue(backend.requests.isEmpty())
        assertFalse(vm.state.value.sending)

        failing = false
        vm.reloadActive()
        advanceUntilIdle()
        assertFalse(vm.state.value.messagesFailed)
        vm.send("hello")
        settle()
        assertEquals(1, backend.requests.size)
        vm.stop()
        advanceUntilIdle()
    }
}
