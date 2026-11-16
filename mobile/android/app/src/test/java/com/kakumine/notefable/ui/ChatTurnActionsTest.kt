package com.kakumine.notefable.ui

import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.ChatBackend
import com.kakumine.notefable.data.ChatRequest
import com.kakumine.notefable.data.ChatStreamEvent
import com.kakumine.notefable.data.ImageResult
import com.kakumine.notefable.data.LocalFile
import com.kakumine.notefable.data.MessageDto
import com.kakumine.notefable.data.MessageVersions
import com.kakumine.notefable.data.ModelsResponse
import com.kakumine.notefable.data.SessionSummary
import com.kakumine.notefable.data.UploadPlan
import com.kakumine.notefable.data.UploadSlot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
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

/** 重新生成、编辑、版本切换、分支，以及停止后与服务端对账（网页 page.tsx 的 rerunTurn / showVersion / branchChat / finishStoppedStream）。 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatTurnActionsTest {
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
        var stored = listOf(
            MessageDto("u1", "USER", "question"),
            MessageDto("a1", "ASSISTANT", "first answer"),
            MessageDto("u2", "USER", "follow-up"),
            MessageDto("a2", "ASSISTANT", "second answer"),
        )
        var events = Channel<ChatStreamEvent>(Channel.UNLIMITED)
        var streamError: Throwable? = null
        val shown = mutableListOf<Pair<String, String>>()
        var showError: Throwable? = null
        val branched = mutableListOf<Triple<String, String, String>>()
        var sessions = listOf(SessionSummary("s1", "Chat"))

        override suspend fun sessions(): List<SessionSummary> = sessions
        override suspend fun messages(sessionId: String): List<MessageDto> = if (sessionId == "s1") stored else emptyList()
        override suspend fun models(): ModelsResponse = throw IOException("404")
        override fun absoluteUrl(path: String) = "https://example.test$path"
        override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> {
            requests += request
            val error = streamError
            return if (error != null) flow { throw error } else events.receiveAsFlow()
        }
        override suspend fun generateImage(request: ChatRequest): ImageResult = throw IOException("unused")
        override suspend fun prepareUploads(files: List<LocalFile>) = UploadPlan(emptyList(), "local")
        override suspend fun uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: (Int) -> Unit) = Unit
        override suspend fun discardUploads(tickets: List<String>) = Unit

        /** 服务端认不认"停止"的请求。不认时 ViewModel 自己取消回答。 */
        var stopAcknowledged = false
        val stops = mutableListOf<String>()

        override suspend fun stopSession(sessionId: String) {
            if (!stopAcknowledged) throw IOException("offline")
            stops += sessionId
        }

        override suspend fun showVersion(sessionId: String, messageId: String) {
            showError?.let { throw it }
            shown += sessionId to messageId
        }

        override suspend fun branchSession(sessionId: String, messageId: String, title: String): SessionSummary {
            branched += Triple(sessionId, messageId, title)
            return SessionSummary("s2", title)
        }
    }

    // 回答进行中刷新定时器一直在排队，advanceUntilIdle 等不到空闲；只推进一小段虚拟时间。
    private fun TestScope.settle() {
        advanceTimeBy(100)
        runCurrent()
    }

    private fun TestScope.openChat(backend: FakeBackend): ChatViewModel {
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10)
        advanceUntilIdle()
        vm.openSession("s1")
        advanceUntilIdle()
        return vm
    }

    private fun contents(vm: ChatViewModel) = vm.state.value.messages.map { it.content }

    @Test
    fun `regenerating replaces the answer and what followed, and asks the server for a new version`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = openChat(backend)

        vm.regenerate("a1")
        // 这条回答和它后面的对话先从画面上拿掉，换成等待中的新回答。
        assertEquals(listOf("question", ""), contents(vm))
        assertTrue(vm.state.value.sending)
        backend.events.send(ChatStreamEvent.Started("s1"))
        backend.events.send(ChatStreamEvent.Delta("better answer"))
        settle()
        val request = backend.requests.single()
        assertEquals("a1", request.regenerate)
        assertNull(request.edit)
        assertEquals("s1", request.sessionId)

        backend.stored = listOf(
            MessageDto("u1", "USER", "question"),
            MessageDto("a3", "ASSISTANT", "better answer", versions = MessageVersions(2, 2, prevId = "a1")),
        )
        backend.events.close()
        advanceUntilIdle()
        assertEquals(listOf("question", "better answer"), contents(vm))
        assertEquals(MessageVersions(2, 2, prevId = "a1"), vm.state.value.messages.last().versions)
        assertFalse(vm.state.value.sending)
    }

    @Test
    fun `editing sends the new text for that message and keeps its attachments on screen`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = openChat(backend)

        vm.editMessage("u2", "  rewritten  ")
        assertEquals(listOf("question", "first answer", "rewritten", ""), contents(vm))
        backend.events.send(ChatStreamEvent.Started("s1"))
        settle()
        val request = backend.requests.single()
        assertEquals("u2", request.edit)
        assertEquals("rewritten", request.message)
        assertNull(request.regenerate)
        // 输入栏里的草稿不受影响。
        assertEquals("", vm.draft)
        // 让这次回答结束（进行中的流会让测试调度器一直不空闲）。
        backend.events.close()
        advanceUntilIdle()
    }

    @Test
    fun `only answers can be regenerated and only own messages edited`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = openChat(backend)

        vm.regenerate("u1")
        vm.editMessage("a1", "x")
        vm.editMessage("u1", "   ")
        vm.regenerate("missing")
        advanceUntilIdle()
        assertTrue(backend.requests.isEmpty())
        assertEquals(4, vm.state.value.messages.size)
    }

    @Test
    fun `a regeneration refused before it starts puts the conversation back and says why`() = runTest(dispatcher) {
        val backend = FakeBackend()
        backend.streamError = ApiException(429, "You’ve reached today’s limit.", code = "usage_limit", tier = "guest", kind = "chat")
        val vm = openChat(backend)
        vm.updateDraft("typing something else")

        vm.regenerate("a2")
        advanceUntilIdle()
        assertEquals(listOf("question", "first answer", "follow-up", "second answer"), contents(vm))
        assertEquals(ComposerNotice.Failed("You’ve reached today’s limit."), vm.state.value.notice)
        assertEquals("chat", vm.state.value.guestLimit)
        // 被拒的不是输入栏里的提问：草稿不动。
        assertEquals("typing something else", vm.draft)
    }

    @Test
    fun `stop asks the server, and the answer then ends like a finished one`() = runTest(dispatcher) {
        val backend = FakeBackend().apply { stopAcknowledged = true }
        val vm = openChat(backend)

        vm.regenerate("a2")
        backend.events.send(ChatStreamEvent.Started("s1"))
        backend.events.send(ChatStreamEvent.Delta("half an"))
        settle()
        vm.stop()
        runCurrent()
        // 不取消请求：等服务端存好、自己结束流。这期间停止键不能再点。
        assertEquals(listOf("s1"), backend.stops)
        assertTrue(vm.state.value.sending)
        assertTrue(vm.state.value.stopping)
        vm.stop()
        runCurrent()
        assertEquals(listOf("s1"), backend.stops)

        backend.stored = backend.stored.dropLast(1) + MessageDto("a3", "ASSISTANT", "half an", versions = MessageVersions(2, 2, prevId = "a2"))
        backend.events.close()
        advanceUntilIdle()
        assertEquals("a3", vm.state.value.messages.last().id)
        assertFalse(vm.state.value.sending)
        assertFalse(vm.state.value.stopping)
    }

    @Test
    fun `a rejected edit reopens the editor with the rewritten text`() = runTest(dispatcher) {
        val backend = FakeBackend()
        backend.streamError = IOException("offline")
        val vm = openChat(backend)

        vm.editMessage("u2", "rewritten")
        advanceUntilIdle()
        assertEquals(listOf("question", "first answer", "follow-up", "second answer"), contents(vm))
        assertEquals(RejectedEdit("u2", "rewritten"), vm.state.value.rejectedEdit)
        vm.dismissRejectedEdit()
        assertNull(vm.state.value.rejectedEdit)
    }

    @Test
    fun `when the server cannot be asked to stop, the partial answer is adopted once it shows up`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = openChat(backend)

        vm.regenerate("a2")
        // 服务端一开始重新生成就把原来的回答隐藏了。
        backend.stored = backend.stored.dropLast(1)
        backend.events.send(ChatStreamEvent.Started("s1"))
        backend.events.send(ChatStreamEvent.Delta("half an"))
        settle()
        vm.stop()
        runCurrent()
        // 服务端还没存好：先留着本机这半截。
        advanceTimeBy(300)
        runCurrent()
        assertEquals("half an", vm.state.value.messages.last().content)
        assertTrue(vm.state.value.messages.last().id.startsWith("local-"))

        backend.stored = backend.stored + MessageDto("a3", "ASSISTANT", "half an", versions = MessageVersions(2, 2, prevId = "a2"))
        advanceUntilIdle()
        assertEquals("a3", vm.state.value.messages.last().id)
        assertEquals(MessageVersions(2, 2, prevId = "a2"), vm.state.value.messages.last().versions)
    }

    @Test
    fun `stopping a regeneration before anything arrives brings the old answer back`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = openChat(backend)

        vm.regenerate("a2")
        backend.events.send(ChatStreamEvent.Started("s1"))
        settle()
        vm.stop()
        advanceUntilIdle()
        assertEquals(listOf("question", "first answer", "follow-up", "second answer"), contents(vm))
    }

    @Test
    fun `showing another version reloads the conversation from the server`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = openChat(backend)

        backend.stored = listOf(MessageDto("u1", "USER", "question"), MessageDto("a0", "ASSISTANT", "older answer", versions = MessageVersions(1, 2, nextId = "a1")))
        vm.showVersion("a0")
        advanceUntilIdle()
        assertEquals(listOf("s1" to "a0"), backend.shown)
        assertEquals(listOf("question", "older answer"), contents(vm))

        backend.showError = IOException("offline")
        vm.showVersion("a1")
        advanceUntilIdle()
        assertEquals(ComposerNotice.Failed(ChatViewModel.VERSION_SWITCH_FAILED), vm.state.value.notice)
        assertEquals(listOf("question", "older answer"), contents(vm))
    }

    @Test
    fun `branching opens the new chat and lists it first`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = openChat(backend)

        vm.branch("a1", "Branch · Chat")
        advanceUntilIdle()
        assertEquals(listOf(Triple("s1", "a1", "Branch · Chat")), backend.branched)
        assertEquals("s2", vm.state.value.activeSessionId)
        assertEquals("s2", vm.state.value.sessions.first().id)
    }
}
