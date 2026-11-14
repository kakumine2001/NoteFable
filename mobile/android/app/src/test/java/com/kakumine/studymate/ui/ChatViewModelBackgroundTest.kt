package com.kakumine.studymate.ui

import com.kakumine.studymate.data.ApiException
import com.kakumine.studymate.data.ChatBackend
import com.kakumine.studymate.data.ChatRequest
import com.kakumine.studymate.data.ChatStreamEvent
import com.kakumine.studymate.data.GeneratedImagePayload
import com.kakumine.studymate.data.ImageResult
import com.kakumine.studymate.data.LocalFile
import com.kakumine.studymate.data.MessageDto
import com.kakumine.studymate.data.ModelsResponse
import com.kakumine.studymate.data.SessionSummary
import com.kakumine.studymate.data.UploadPlan
import com.kakumine.studymate.data.UploadSlot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
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

/** 切换聊天、开新聊天时回答在后台继续（网页 page.tsx 的 streamingSessions / sessionMessagesRef）。 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelBackgroundTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class MemorySettings : SettingsStore {
        override var modelId: String? = null
        override var reasoning: String? = null
    }

    /** 每个请求一条自己的流，按发送顺序编号。 */
    private class Backend : ChatBackend {
        val requests = mutableListOf<ChatRequest>()
        val streams = mutableListOf<Channel<ChatStreamEvent>>()
        val stored = mutableMapOf<String, List<MessageDto>>()
        val messageCalls = mutableListOf<String>()
        var messagesGate: CompletableDeferred<Unit>? = null
        var messagesError: Throwable? = null
        var imageGate = CompletableDeferred<ImageResult>()

        override suspend fun sessions(): List<SessionSummary> = emptyList()
        override suspend fun messages(sessionId: String): List<MessageDto> {
            messageCalls += sessionId
            messagesGate?.await()
            messagesError?.let { throw it }
            return stored[sessionId] ?: emptyList()
        }
        override suspend fun models(): ModelsResponse = ModelsResponse(defaultModel = "")
        override fun absoluteUrl(path: String) = "https://example.test$path"
        override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> {
            requests += request
            val channel = Channel<ChatStreamEvent>(Channel.UNLIMITED)
            streams += channel
            return channel.receiveAsFlow()
        }
        override suspend fun generateImage(request: ChatRequest): ImageResult {
            requests += request
            return imageGate.await()
        }
        override suspend fun prepareUploads(files: List<LocalFile>) =
            UploadPlan(files.indices.map { UploadSlot("path-$it", "ticket-$it") }, "local")
        val uploadGate = CompletableDeferred<Unit>()
        val discarded = mutableListOf<String>()
        override suspend fun uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: (Int) -> Unit) {
            uploadGate.await()
        }
        override suspend fun discardUploads(tickets: List<String>) {
            discarded += tickets
        }
    }

    private fun TestScope.settle() {
        advanceTimeBy(100)
        runCurrent()
    }

    private val created = mutableListOf<ChatViewModel>()

    private fun TestScope.newViewModel(backend: Backend): ChatViewModel {
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10)
        created += vm
        advanceUntilIdle()
        return vm
    }

    /** 断言失败时还在跑的回答会让 runTest 收尾时的 advanceUntilIdle 永远等下去：先全部停掉。 */
    private fun test(body: suspend TestScope.() -> Unit) = runTest(dispatcher) {
        try {
            body()
        } finally {
            created.forEach { it.onIdentityChanged() }
        }
    }

    private fun ChatViewModel.contents() = state.value.messages.map { it.content }

    @Test
    fun `a new chat keeps generating after starting another new chat, and moves to its session id`() = test {
        val backend = Backend()
        val vm = newViewModel(backend)

        vm.send("first")
        settle()
        // 还没拿到 X-Session-Id 就开了新聊天：新聊天是空的，可以直接发。
        vm.newChat()
        assertNull(vm.state.value.activeSessionId)
        assertTrue(vm.state.value.messages.isEmpty())
        assertFalse(vm.state.value.sending)

        backend.streams[0].send(ChatStreamEvent.Started("s1"))
        backend.streams[0].send(ChatStreamEvent.Delta("one"))
        settle()
        // 迁到 s1 的是第一个聊天，不是现在看着的新聊天。
        assertNull(vm.state.value.activeSessionId)
        assertTrue(vm.state.value.messages.isEmpty())
        assertEquals(setOf("s1"), vm.state.value.generatingSessionIds)

        vm.send("second")
        settle()
        assertEquals(2, backend.requests.size)
        assertNull(backend.requests[1].sessionId)
        backend.streams[1].send(ChatStreamEvent.Started("s2"))
        backend.streams[1].send(ChatStreamEvent.Delta("two"))
        settle()
        assertEquals("s2", vm.state.value.activeSessionId)
        assertEquals(listOf("second", "two"), vm.contents())
        assertEquals(setOf("s1", "s2"), vm.state.value.generatingSessionIds)

        // 回到 s1：显示它的进行中状态，不去读历史。
        val callsBefore = backend.messageCalls.size
        vm.openSession("s1")
        assertEquals(listOf("first", "one"), vm.contents())
        assertTrue(vm.state.value.sending)
        assertTrue(vm.state.value.messages.last().streaming)
        assertFalse(vm.state.value.messagesLoading)
        settle()
        assertEquals(callsBefore, backend.messageCalls.size)

        // 停止只停当前聊天。
        vm.stop()
        advanceTimeBy(50)
        runCurrent()
        assertFalse(vm.state.value.sending)
        assertEquals(setOf("s2"), vm.state.value.generatingSessionIds)
        backend.streams[1].send(ChatStreamEvent.Delta(" more"))
        settle()
        vm.openSession("s2")
        assertEquals(listOf("second", "two more"), vm.contents())
        assertTrue(vm.state.value.sending)
        backend.streams[1].close()
        advanceUntilIdle()
    }

    @Test
    fun `a chat finishing in the background reconciles only its own cache`() = test {
        val backend = Backend()
        backend.stored["s9"] = listOf(MessageDto("o-1", "USER", "other chat"))
        val vm = newViewModel(backend)

        vm.send("q")
        runCurrent()
        backend.streams[0].send(ChatStreamEvent.Started("s1"))
        backend.streams[0].send(ChatStreamEvent.Delta("answer"))
        settle()
        vm.openSession("s9")
        settle()
        assertEquals(listOf("other chat"), vm.contents())

        backend.stored["s1"] = listOf(MessageDto("db-1", "USER", "q"), MessageDto("db-2", "ASSISTANT", "answer", thinkingMs = 900))
        backend.streams[0].close()
        advanceUntilIdle()
        // 当前看着的聊天不受影响。
        assertEquals(listOf("other chat"), vm.contents())
        assertTrue(vm.state.value.generatingSessionIds.isEmpty())

        // 回到 s1：先显示对账后的缓存，再静默刷新，不出现加载中。
        backend.messagesGate = CompletableDeferred()
        vm.openSession("s1")
        assertFalse(vm.state.value.messagesLoading)
        assertEquals(listOf("db-1", "db-2"), vm.state.value.messages.map { it.id })
        assertEquals(900L, vm.state.value.messages.last().thinkingMs)
        backend.messagesGate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("db-1", "db-2"), vm.state.value.messages.map { it.id })
    }

    @Test
    fun `another chat can send while one is generating`() = test {
        val backend = Backend()
        backend.stored["s5"] = listOf(MessageDto("o-1", "USER", "old"))
        val vm = newViewModel(backend)

        vm.send("first")
        runCurrent()
        backend.streams[0].send(ChatStreamEvent.Started("s1"))
        settle()
        vm.openSession("s5")
        settle()
        vm.send("second")
        settle()

        assertEquals(2, backend.requests.size)
        assertEquals("s5", backend.requests[1].sessionId)
        assertEquals(setOf("s1", "s5"), vm.state.value.generatingSessionIds)
        // 同一个聊天里在回答结束前不能再发。
        vm.send("third")
        settle()
        assertEquals(2, backend.requests.size)

        backend.streams.forEach { it.close() }
        advanceUntilIdle()
    }

    @Test
    fun `image generation for a new chat continues in the background and lands in its session`() = test {
        val backend = Backend()
        val vm = newViewModel(backend)

        vm.setImageMode(true)
        vm.send("a cat")
        settle()
        vm.newChat()
        backend.stored["img-1"] = listOf(MessageDto("db-1", "USER", "a cat"))
        backend.imageGate.complete(ImageResult(sessionId = "img-1", image = GeneratedImagePayload("data:image/png;base64,AAAA")))
        advanceUntilIdle()

        assertNull(vm.state.value.activeSessionId)
        assertTrue(vm.state.value.messages.isEmpty())
        vm.openSession("img-1")
        advanceUntilIdle()
        assertEquals(listOf("db-1"), vm.state.value.messages.map { it.id })
    }

    @Test
    fun `leaving a chat while its attachments upload cancels nothing else and sends nothing`() = test {
        val backend = Backend()
        val vm = newViewModel(backend)
        val notes = LocalFile("content://notes", "notes.txt", "text/plain", 1200)

        vm.addFiles(listOf(notes))
        vm.updateDraft("with file")
        vm.send("with file")
        settle()
        assertTrue(vm.state.value.sending)
        vm.openSession("s7")
        backend.uploadGate.complete(Unit)
        advanceUntilIdle()

        // 和网页一样：上传期间去了别处就不发，清掉传上去的文件，文字和附件留在输入栏。
        assertTrue(backend.requests.isEmpty())
        assertEquals(listOf("ticket-0"), backend.discarded)
        assertEquals(listOf(notes), vm.state.value.files)
        assertEquals("with file", vm.draft)
        assertNull(vm.state.value.upload)
        assertFalse(vm.state.value.sending)
    }

    @Test
    fun `signing in or out stops every chat's answer and forgets their caches`() = test {
        val backend = Backend()
        val vm = newViewModel(backend)

        vm.send("q")
        runCurrent()
        backend.streams[0].send(ChatStreamEvent.Started("s1"))
        backend.streams[0].send(ChatStreamEvent.Delta("partial"))
        settle()
        vm.newChat()
        vm.onIdentityChanged()
        advanceUntilIdle()

        assertTrue(vm.state.value.generatingSessionIds.isEmpty())
        vm.openSession("s1")
        advanceUntilIdle()
        // 旧身份的半截回答不会冒出来，显示的是服务器读回的内容。
        assertTrue(vm.state.value.messages.isEmpty())
        assertFalse(vm.state.value.sending)
    }

    @Test
    fun `deleting the open chat returns to a new chat without touching another chat's answer`() = test {
        val backend = Backend()
        val vm = newViewModel(backend)

        vm.send("q")
        runCurrent()
        backend.streams[0].send(ChatStreamEvent.Started("s1"))
        settle()
        vm.openSession("s3")
        settle()
        vm.onSessionDeleted("s3")
        assertNull(vm.state.value.activeSessionId)
        assertEquals(setOf("s1"), vm.state.value.generatingSessionIds)
        backend.streams[0].close()
        advanceUntilIdle()
    }

    @Test
    fun `opening a new chat's session before its id arrives keeps both sends`() = test {
        val backend = Backend()
        val vm = newViewModel(backend)

        vm.send("first")
        runCurrent()
        // 服务端已经建好 s1（还没回 X-Session-Id），用户从侧栏打开了它：读到的历史只有这次的提问。
        vm.newChat()
        backend.stored["s1"] = listOf(MessageDto("db-1", "USER", "first"))
        vm.openSession("s1")
        settle()
        assertEquals(listOf("first"), vm.contents())
        vm.send("second")
        runCurrent()

        backend.streams[0].send(ChatStreamEvent.Started("s1"))
        backend.streams[0].send(ChatStreamEvent.Delta("one"))
        settle()
        // 本机这份换掉读来的历史，后发的那条接在后面，两个任务都还在。
        assertEquals(listOf("first", "one", "second", ""), vm.contents())
        assertTrue(vm.state.value.sending)

        backend.streams[0].close()
        settle()
        assertTrue(vm.state.value.sending)
        backend.streams[1].send(ChatStreamEvent.Delta("two"))
        settle()
        assertEquals(listOf("first", "one", "second", "two"), vm.contents())
        vm.stop()
        advanceUntilIdle()
        assertFalse(vm.state.value.sending)
    }

    @Test
    fun `a new chat that fails after the user left puts the prompt back`() = test {
        val backend = Backend()
        backend.stored["s9"] = listOf(MessageDto("o-1", "USER", "other chat"))
        val vm = newViewModel(backend)

        vm.updateDraft("lost?")
        vm.send("lost?")
        runCurrent()
        assertEquals("", vm.draft)
        vm.openSession("s9")
        settle()
        backend.streams[0].close(java.io.IOException("boom"))
        advanceUntilIdle()

        assertEquals("lost?", vm.draft)
        assertEquals(listOf("other chat"), vm.contents())
        assertTrue(vm.state.value.generatingSessionIds.isEmpty())
    }

    @Test
    fun `new chat on an unsent new chat keeps the upload going`() = test {
        val backend = Backend()
        val vm = newViewModel(backend)
        val notes = LocalFile("content://notes", "notes.txt", "text/plain", 1200)

        vm.addFiles(listOf(notes))
        vm.send("with file")
        settle()
        vm.newChat()
        backend.uploadGate.complete(Unit)
        settle()

        assertEquals(1, backend.requests.size)
        assertEquals(listOf("ticket-0"), backend.requests[0].uploads)
        assertEquals("with file", vm.contents().first())
        backend.streams[0].close()
        advanceUntilIdle()
    }

    @Test
    fun `an upload failing after the user left shows no error in the other chat`() = test {
        val backend = Backend()
        val vm = newViewModel(backend)

        vm.addFiles(listOf(LocalFile("content://notes", "notes.txt", "text/plain", 1200)))
        vm.send("with file")
        settle()
        vm.openSession("s7")
        backend.uploadGate.completeExceptionally(java.io.IOException("offline"))
        advanceUntilIdle()

        assertNull(vm.state.value.notice)
        assertNull(vm.state.value.upload)
    }

    @Test
    fun `a failed quiet reload keeps the cache and shows a notice, and a missing chat unbinds`() = test {
        val backend = Backend()
        val vm = newViewModel(backend)

        vm.send("q")
        runCurrent()
        backend.streams[0].send(ChatStreamEvent.Started("s1"))
        settle()
        backend.stored["s1"] = listOf(MessageDto("db-1", "USER", "q"), MessageDto("db-2", "ASSISTANT", "a"))
        backend.streams[0].close()
        advanceUntilIdle()
        vm.openSession("s9")
        advanceUntilIdle()

        backend.messagesError = java.io.IOException("offline")
        vm.openSession("s1")
        advanceUntilIdle()
        assertEquals("s1", vm.state.value.activeSessionId)
        assertEquals(listOf("q", "a"), vm.contents())
        assertEquals(ComposerNotice.LoadFailed, vm.state.value.notice)
        assertFalse(vm.state.value.messagesFailed)

        vm.openSession("s9")
        assertNull(vm.state.value.notice)
        advanceUntilIdle()
        backend.messagesError = ApiException(404, "Session not found")
        vm.openSession("s1")
        advanceUntilIdle()
        assertNull(vm.state.value.activeSessionId)
        assertTrue(vm.state.value.messages.isEmpty())
        assertEquals(ComposerNotice.LoadFailed, vm.state.value.notice)
    }
}
