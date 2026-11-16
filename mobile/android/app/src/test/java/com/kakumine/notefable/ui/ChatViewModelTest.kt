package com.kakumine.notefable.ui

import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.ChatBackend
import com.kakumine.notefable.data.ChatRequest
import com.kakumine.notefable.data.AttachError
import com.kakumine.notefable.data.ChatStreamEvent
import com.kakumine.notefable.data.FailureInfo
import com.kakumine.notefable.data.ActivityStep
import com.kakumine.notefable.data.Proposal
import com.kakumine.notefable.data.WebAction
import com.kakumine.notefable.data.GeneratedImagePayload
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import com.kakumine.notefable.data.ImageResult
import com.kakumine.notefable.data.LocalFile
import com.kakumine.notefable.data.UploadPlan
import com.kakumine.notefable.data.UploadSlot
import com.kakumine.notefable.data.MessageDto
import com.kakumine.notefable.data.ModelInfo
import com.kakumine.notefable.data.ModelsResponse
import com.kakumine.notefable.data.SessionSummary
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
import org.junit.Assert.assertNotNull
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

        val imageRequests = mutableListOf<ChatRequest>()
        var imageResult = ImageResult(sessionId = "img-1", image = GeneratedImagePayload("data:image/png;base64,AAAA"))
        val uploaded = mutableListOf<String>()
        val discarded = mutableListOf<String>()
        var uploadError: Throwable? = null

        override suspend fun generateImage(request: ChatRequest): ImageResult {
            imageRequests += request
            return imageResult
        }

        override suspend fun prepareUploads(files: List<LocalFile>) =
            UploadPlan(files.indices.map { UploadSlot("path-$it", "ticket-$it") }, "local")

        override suspend fun uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: (Int) -> Unit) {
            uploadError?.let { throw it }
            onProgress(50)
            uploaded += slot.ticket
        }

        override suspend fun discardUploads(tickets: List<String>) {
            discarded += tickets
        }
    }

    private val notes = LocalFile("content://notes", "notes.txt", "text/plain", 1200)
    private val photo = LocalFile("content://photo", "photo.png", "image/png", 3400)

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

    // ---- 添加页面（网页 attachedPages） ----

    private val planNote = com.kakumine.notefable.data.ChatProjectNote("n1", "Plan", "📘")
    private val todoNote = com.kakumine.notefable.data.ChatProjectNote("n2", "Todo", null)

    @Test
    fun `attached pages go out as ids, show on the question and clear from the composer`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)
        vm.setAttachedPages(listOf(planNote, todoNote))
        vm.removeAttachedPage("n2")
        assertEquals(listOf(planNote), vm.state.value.attachedPages)

        vm.send("summarize")
        settle()
        assertEquals(listOf("n1"), backend.requests.single().pages)
        assertEquals(listOf(planNote), vm.state.value.messages.first().pages)
        assertTrue(vm.state.value.attachedPages.isEmpty())

        // 历史里的页面（标题和图标由服务端从笔记取）。
        backend.stored = listOf(MessageDto("db-1", "USER", "summarize", pages = listOf(planNote)), MessageDto("db-2", "ASSISTANT", "ok"))
        backend.events.close()
        advanceUntilIdle()
        assertEquals(listOf(planNote), vm.state.value.messages.first().pages)
    }

    @Test
    fun `pages are refused in image mode and over the limit instead of being dropped`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)
        vm.setAttachedPages(listOf(planNote))
        vm.setImageMode(true)
        vm.send("draw it")
        advanceUntilIdle()
        assertEquals(ComposerNotice.PagesInImageMode, vm.state.value.notice)
        assertTrue(backend.imageRequests.isEmpty())
        assertEquals(listOf(planNote), vm.state.value.attachedPages)

        vm.setImageMode(false)
        vm.setAttachedPages((1..6).map { com.kakumine.notefable.data.ChatProjectNote("p$it", "P$it") })
        vm.send("hi")
        advanceUntilIdle()
        assertEquals(ComposerNotice.TooManyPages, vm.state.value.notice)
        assertTrue(backend.requests.isEmpty())
        // 移除一篇就清掉提示。
        vm.removeAttachedPage("p6")
        assertNull(vm.state.value.notice)
    }

    @Test
    fun `restored pages go first and pages picked meanwhile stay`() {
        assertEquals(listOf(planNote, todoNote), ChatViewModel.mergeRestoredPages(listOf(planNote), listOf(todoNote, planNote)))
        assertEquals(listOf(todoNote), ChatViewModel.mergeRestoredPages(emptyList(), listOf(todoNote)))
    }

    @Test
    fun `the attach dialog keeps current titles and drops trashed pages`() {
        val renamed = planNote.copy(title = "Plan v2")
        assertEquals(listOf(renamed), refreshAttachedPages(listOf(planNote, todoNote), listOf(renamed)))
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
    fun `remembers where the server appended its failure text, live and from stored activity`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)
        val failure = FailureInfo(9, "Note not found.")

        vm.send("hi")
        backend.events.send(ChatStreamEvent.Started("s1"))
        backend.events.send(ChatStreamEvent.Delta("Partial\n\nRequest failed: Note not found."))
        backend.events.send(
            ChatStreamEvent.Activity(
                Json.parseToJsonElement("""{"type":"failure","id":"request-failure","offset":9,"detail":"Note not found."}""").jsonObject,
            ),
        )
        settle()
        assertEquals(failure, vm.state.value.messages.last().failure)

        backend.stored = listOf(
            MessageDto("db-1", "USER", "hi"),
            MessageDto(
                "db-2", "ASSISTANT", "Partial\n\nRequest failed: Note not found.",
                activity = Json.parseToJsonElement(
                    """[{"id":"t","kind":"thought","text":"x"},{"id":"request-failure","kind":"failure","offset":9,"detail":"Note not found."}]""",
                ),
            ),
        )
        backend.events.close()
        advanceUntilIdle()
        assertEquals(listOf("db-1", "db-2"), vm.state.value.messages.map { it.id })
        assertEquals(failure, vm.state.value.messages.last().failure)
        assertNull(vm.state.value.messages.first().failure)
    }

    @Test
    fun `merges live activity into the answer and restores activity and proposals from history`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)

        vm.send("hi")
        backend.events.send(ChatStreamEvent.Started("s1"))
        fun activity(json: String) = ChatStreamEvent.Activity(Json.parseToJsonElement(json).jsonObject)
        backend.events.send(activity("""{"type":"thought","id":"rs:0","delta":"**Plan**"}"""))
        backend.events.send(activity("""{"type":"thought","id":"rs:0","delta":" more"}"""))
        backend.events.send(activity("""{"type":"web","id":"ws","status":"running"}"""))
        settle()
        val waiting = vm.state.value.messages.last()
        assertEquals(listOf(ActivityStep.Thought("rs:0", "**Plan** more"), ActivityStep.Web("ws", false)), waiting.activity)
        assertNotNull(waiting.startedAt)
        assertNull(waiting.thinkingMs)

        backend.events.send(activity("""{"type":"web","id":"ws","status":"done","action":{"kind":"open_page","url":"https://a.com/x"}}"""))
        backend.events.send(ChatStreamEvent.Delta("Answer"))
        settle()
        val answering = vm.state.value.messages.last()
        assertEquals(ActivityStep.Web("ws", true, WebAction.OpenPage("https://a.com/x")), answering.activity[1])
        assertNotNull(answering.thinkingMs)

        backend.stored = listOf(
            MessageDto("db-1", "USER", "hi"),
            MessageDto(
                "db-2", "ASSISTANT", "Answer",
                activity = Json.parseToJsonElement("""[{"id":"rs:0","kind":"thought","text":"**Plan** more"}]"""),
                proposals = Json.parseToJsonElement(
                    """[{"kind":"create_proposal","id":"np1","title":"Plan","content":"","proposed":{"title":"Plan","blocks":[]},"status":"applied","appliedPageId":"pg1"}]""",
                ),
            ),
        )
        backend.events.close()
        advanceUntilIdle()
        val stored = vm.state.value.messages.last()
        assertEquals(listOf(ActivityStep.Thought("rs:0", "**Plan** more")), stored.activity)
        assertEquals(listOf(Proposal.Create("np1", "Plan", null, "", status = "applied", appliedPageId = "pg1")), stored.proposals)
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
    fun `stopping while the answer is still only thinking leaves what the server kept`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)

        vm.send("q")
        backend.events.send(ChatStreamEvent.Started("s1"))
        backend.events.send(ChatStreamEvent.Activity(Json.parseToJsonElement("""{"type":"thought","id":"rs:0","delta":"Plan"}""").jsonObject))
        settle()
        vm.stop()
        runCurrent()
        // 停下的那一刻，已有的过程还在，只是不再转圈。
        val answer = vm.state.value.messages.last()
        assertEquals(listOf(ActivityStep.Thought("rs:0", "Plan")), answer.activity)
        assertFalse(answer.streaming)

        // 没有正文的回答服务端不保存：对账后只剩提问。
        backend.stored = listOf(MessageDto("db-1", "USER", "q"))
        advanceUntilIdle()
        assertEquals(listOf("db-1"), vm.state.value.messages.map { it.id })
    }

    @Test
    fun `switching chats keeps the running answer in its own chat without leaking into the other one`() = runTest(dispatcher) {
        val backend = FakeBackend().apply { messagesHandler = { id -> if (id == "s2") listOf(MessageDto("o-1", "USER", "other")) else stored } }
        val vm = newViewModel(backend)

        vm.send("q")
        backend.events.send(ChatStreamEvent.Started("s1"))
        settle()
        vm.openSession("s2")
        backend.events.send(ChatStreamEvent.Delta("late"))
        settle()

        assertFalse(vm.state.value.sending)
        assertEquals("s2", vm.state.value.activeSessionId)
        assertEquals(listOf("other"), vm.state.value.messages.map { it.content })
        assertEquals(setOf("s1"), vm.state.value.generatingSessionIds)

        vm.openSession("s1")
        assertTrue(vm.state.value.sending)
        assertEquals(listOf("q", "late"), vm.state.value.messages.map { it.content })
        vm.stop()
        advanceUntilIdle()
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
    fun `the bundled model list is used when the server cannot supply one`() = runTest(dispatcher) {
        val backend = FakeBackend().apply { models = null }
        val bundled = ModelsResponse("b", listOf(ModelInfo("b", "Model B", reasoningEfforts = listOf("low", "high"), defaultReasoning = "high")))
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10, bundledModels = { bundled })
        advanceUntilIdle()

        assertEquals(listOf("b"), vm.state.value.models.map { it.id })
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

    @Test
    fun `uploads attachments first, then sends their tickets and clears the composer`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)
        vm.addFiles(listOf(notes))

        vm.send("summarise")
        settle()

        assertEquals(listOf("ticket-0"), backend.uploaded)
        assertEquals(listOf("ticket-0"), backend.requests.single().uploads)
        assertTrue(vm.state.value.files.isEmpty())
        assertNull(vm.state.value.upload)
        assertEquals(1, vm.state.value.sentCount)
        assertEquals("notes.txt", vm.state.value.messages.first().attachments.single().filename)

        // 结束这次回答，否则刷新定时器会一直排队。
        backend.events.close()
        advanceUntilIdle()
    }

    @Test
    fun `sending waits until imported attachments are copied, then includes them`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)
        val copied = CompletableDeferred<List<LocalFile>>()

        vm.importFiles { copied.await() }
        runCurrent()
        assertEquals(1, vm.state.value.importing)

        // 还在拷贝：发送被拦下，没有请求，草稿里的附件也不会丢到下一条。
        vm.send("summarise")
        advanceUntilIdle()
        assertTrue(backend.requests.isEmpty())
        assertFalse(vm.state.value.sending)

        copied.complete(listOf(notes))
        advanceUntilIdle()
        assertEquals(0, vm.state.value.importing)
        assertEquals(listOf(notes), vm.state.value.files)

        vm.send("summarise")
        settle()
        assertEquals(listOf("ticket-0"), backend.requests.single().uploads)

        backend.events.close()
        advanceUntilIdle()
    }

    @Test
    fun `a failed import releases the send lock and adds nothing`() = runTest(dispatcher) {
        val vm = newViewModel(FakeBackend())

        vm.importFiles { throw IOException("revoked") }
        vm.importFiles { emptyList() }
        advanceUntilIdle()

        assertEquals(0, vm.state.value.importing)
        assertTrue(vm.state.value.files.isEmpty())
        assertNull(vm.state.value.notice)
    }

    @Test
    fun `a failed upload keeps the files and the draft, removes what was uploaded and sends nothing`()= runTest(dispatcher) {
        val backend = FakeBackend().apply { uploadError = IOException("offline") }
        val vm = newViewModel(backend)
        vm.addFiles(listOf(notes))

        vm.send("summarise")
        advanceUntilIdle()

        assertTrue(backend.requests.isEmpty())
        assertEquals(listOf("ticket-0"), backend.discarded)
        assertEquals(listOf(notes), vm.state.value.files)
        assertEquals(ComposerNotice.UploadFailed, vm.state.value.notice)
        assertFalse(vm.state.value.sending)
        assertEquals(0, vm.state.value.sentCount)
        assertTrue(vm.state.value.messages.isEmpty())
    }

    @Test
    fun `an image is refused while the model cannot read images, and accepted in image mode`() = runTest(dispatcher) {
        val vm = newViewModel(FakeBackend())

        vm.addFiles(listOf(photo))
        assertTrue(vm.state.value.files.isEmpty())
        assertEquals(ComposerNotice.Rejected(AttachError.NotAdded(AttachError.ModelCannotReadImages)), vm.state.value.notice)

        vm.setImageMode(true)
        vm.addFiles(listOf(photo))
        assertEquals(listOf(photo), vm.state.value.files)
        assertNull(vm.state.value.notice)

        // 关掉图片模式后，这张图对当前模型又不能用了：留在输入栏里，但不能发送。
        vm.setImageMode(false)
        assertEquals(AttachError.ModelCannotReadImages, vm.state.value.filesError)
        vm.send("describe")
        advanceUntilIdle()
        assertTrue(vm.state.value.messages.isEmpty())
    }

    @Test
    fun `image mode sends the prompt to the image API and shows the result`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)
        vm.setImageMode(true)
        backend.stored = listOf(MessageDto("db-1", "USER", "a red kite"), MessageDto("db-2", "ASSISTANT", ""))

        vm.send("a red kite")
        assertTrue(vm.state.value.messages.last().generatingImage)
        advanceUntilIdle()

        assertTrue(backend.requests.isEmpty())
        assertEquals("a red kite", backend.imageRequests.single().message)
        assertEquals("img-1", vm.state.value.activeSessionId)
        assertFalse(vm.state.value.sending)
        assertEquals(listOf("db-1", "db-2"), vm.state.value.messages.map { it.id })
    }

    @Test
    fun `a usage limit shows the server sentence as the answer, not as a failure`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val vm = newViewModel(backend)
        val limit = "You've used today's free messages. Sign in for more, or try again tomorrow."
        backend.streamError = ApiException(429, limit, code = ApiException.USAGE_LIMIT_CODE, tier = "guest", kind = "chat")

        vm.send("hi")
        advanceUntilIdle()

        val assistant = vm.state.value.messages.last()
        assertEquals(limit, assistant.content)
        assertTrue(assistant.usageLimit)
        assertEquals(null, assistant.errorDetail)
        assertFalse(assistant.streaming)
        assertFalse(vm.state.value.sending)
    }

    @Test
    fun `a failed image request ends the placeholder with the reason`() = runTest(dispatcher) {
        val backend = FakeBackend().apply { imageResult = ImageResult(error = "No image today.") }
        val vm = newViewModel(backend)
        vm.setImageMode(true)

        vm.send("a red kite")
        advanceUntilIdle()

        val answer = vm.state.value.messages.last()
        assertFalse(answer.generatingImage)
        assertEquals("No image today.", answer.errorDetail)
        assertFalse(vm.state.value.sending)
    }

    @Test
    fun `the composer draft lives in the view model and clears only once the message is sent`() = runTest(dispatcher) {
        val backend = FakeBackend().apply { uploadError = IOException("offline") }
        val vm = newViewModel(backend)
        vm.updateDraft("half-written question")
        // 切到笔记再回来时 ChatScreen 重新组合，草稿从 ViewModel 读回。
        vm.onIdentityChanged()
        advanceUntilIdle()
        assertEquals("half-written question", vm.draft)

        vm.addFiles(listOf(notes))
        vm.send(vm.draft)
        advanceUntilIdle()
        assertEquals("half-written question", vm.draft)

        backend.uploadError = null
        vm.send(vm.draft)
        settle()
        assertEquals("", vm.draft)
        backend.events.close()
        advanceUntilIdle()
    }

    @Test
    fun `the draft survives the process being recreated`() {
        val saved = androidx.lifecycle.SavedStateHandle()
        val first = ChatViewModel(FakeBackend(), MemorySettings(), flushIntervalMs = 10, savedState = saved)
        first.updateDraft("keep me")
        val second = ChatViewModel(FakeBackend(), MemorySettings(), flushIntervalMs = 10, savedState = saved)
        assertEquals("keep me", second.draft)
    }

    @Test
    fun `reconcile keeps the list keys of the turn that was just sent`() {
        val old = listOf(
            UiMessage("cm0", MessageRole.Assistant, "Earlier"),
            UiMessage("local-1", MessageRole.User, "Q"),
            UiMessage("local-2", MessageRole.Assistant, "A"),
        )
        val loaded = listOf(
            UiMessage("cm0", MessageRole.Assistant, "Earlier"),
            UiMessage("cm1", MessageRole.User, "Q"),
            UiMessage("cm2", MessageRole.Assistant, "A"),
        )
        val merged = carryLocalKeys(old, loaded)
        assertEquals(listOf("cm0", "cm1", "cm2"), merged.map { it.id })
        assertEquals(listOf("cm0", "local-1", "local-2"), merged.map { it.key })
    }

    @Test
    fun `reconcile keeps local keys of earlier turns that already have stored ids`() {
        // 第一回合对账后：id 是服务端的，key 还是 local-*；第二回合刚发送。
        val old = listOf(
            UiMessage("cm1", MessageRole.User, "Q1", key = "local-1"),
            UiMessage("cm2", MessageRole.Assistant, "A1", key = "local-2"),
            UiMessage("local-3", MessageRole.User, "Q2"),
            UiMessage("local-4", MessageRole.Assistant, "A2"),
        )
        val loaded = listOf(
            UiMessage("cm1", MessageRole.User, "Q1"),
            UiMessage("cm2", MessageRole.Assistant, "A1"),
            UiMessage("cm3", MessageRole.User, "Q2"),
            UiMessage("cm4", MessageRole.Assistant, "A2"),
        )
        val merged = carryLocalKeys(old, loaded)
        assertEquals(listOf("cm1", "cm2", "cm3", "cm4"), merged.map { it.id })
        assertEquals(listOf("local-1", "local-2", "local-3", "local-4"), merged.map { it.key })
        // 只有这次换了 ID 的消息才需要搬保存状态。
        assertEquals(listOf("local-3" to "cm3", "local-4" to "cm4"), replacedLocalIds(old, merged))
    }

    @Test
    fun `reconcile reports replaced ids even when the answer is not on screen`() = runTest(dispatcher) {
        val backend = FakeBackend()
        val renames = mutableListOf<Triple<String, String, String>>()
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10, onMessageIdChanged = { s, from, to -> renames += Triple(s, from, to) })
        advanceUntilIdle()

        vm.send("hi")
        backend.events.send(ChatStreamEvent.Started("s1"))
        backend.events.send(ChatStreamEvent.Delta("Hello"))
        settle()
        val localIds = vm.state.value.messages.map { it.id }
        backend.stored = listOf(MessageDto("db-1", "USER", "hi"), MessageDto("db-2", "ASSISTANT", "Hello"))
        backend.events.close()
        advanceUntilIdle()

        assertEquals(listOf(Triple("s1", localIds[0], "db-1"), Triple("s1", localIds[1], "db-2")), renames)
        assertEquals(localIds, vm.state.value.messages.map { it.key })
    }
}
