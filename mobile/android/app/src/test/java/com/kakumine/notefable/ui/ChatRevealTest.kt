package com.kakumine.notefable.ui

import com.kakumine.notefable.data.ChatBackend
import com.kakumine.notefable.data.ChatRequest
import com.kakumine.notefable.data.ChatStreamEvent
import com.kakumine.notefable.data.ImageResult
import com.kakumine.notefable.data.LocalFile
import com.kakumine.notefable.data.MessageDto
import com.kakumine.notefable.data.ModelsResponse
import com.kakumine.notefable.data.SessionSummary
import com.kakumine.notefable.data.UploadPlan
import com.kakumine.notefable.data.UploadSlot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/** 检索结果 / 链接打开聊天时的定位请求，以及链接 ID 不对时的提示（Batch 4）。 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatRevealTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class Backend : ChatBackend {
        var extra = emptyList<MessageDto>()
        var loads = 0
        override suspend fun sessions() = listOf(SessionSummary("s1", "One"), SessionSummary("s2", "Two"))
        override suspend fun messages(sessionId: String): List<MessageDto> {
            loads++
            return listOf(MessageDto("m1", "USER", "q"), MessageDto("m2", "ASSISTANT", "a")) + extra
        }
        override suspend fun models() = ModelsResponse(defaultModel = "a")
        override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> = emptyFlow()
        override suspend fun generateImage(request: ChatRequest) = ImageResult()
        override suspend fun prepareUploads(files: List<LocalFile>) = UploadPlan(emptyList<UploadSlot>(), "local")
        override suspend fun uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: (Int) -> Unit) = Unit
        override suspend fun discardUploads(tickets: List<String>) = Unit
        override fun absoluteUrl(path: String) = path
    }

    private class Settings : SettingsStore {
        override var modelId: String? = null
        override var reasoning: String? = null
    }

    @Test
    fun `opening at a message keeps a reveal request until the screen consumes it`() = runTest(dispatcher) {
        val vm = ChatViewModel(Backend(), Settings())
        vm.openSessionAt("s1", "m2")
        advanceUntilIdle()
        val reveal = vm.state.value.reveal!!
        assertEquals("s1" to "m2", reveal.sessionId to reveal.messageId)
        assertEquals(2, vm.state.value.messages.size)
        vm.consumeReveal(reveal.token - 1)
        assertEquals(reveal, vm.state.value.reveal)
        vm.consumeReveal(reveal.token)
        assertNull(vm.state.value.reveal)

        // 同一个聊天再定位一次：新的 token。
        vm.openSessionAt("s1", "m1")
        val again = vm.state.value.reveal!!
        assertEquals("m1", again.messageId)
        assertEquals(reveal.token + 1, again.token)
        // 换到别的聊天就作废。
        vm.openSession("s2")
        assertNull(vm.state.value.reveal)
        vm.openSessionAt("s1", null)
        advanceUntilIdle()
        assertNull(vm.state.value.reveal)
    }

    @Test
    fun `an invalid link returns to a new chat with the load error until the next navigation`() = runTest(dispatcher) {
        val vm = ChatViewModel(Backend(), Settings())
        vm.openSession("s1")
        advanceUntilIdle()
        vm.showLinkFailed()
        assertNull(vm.state.value.activeSessionId)
        assertEquals(ComposerNotice.LinkFailed, vm.state.value.notice)
        vm.openSession("s2")
        assertNull(vm.state.value.notice)
    }

    @Test
    fun `a hit missing from the open chat's cached history reloads it before revealing`() = runTest(dispatcher) {
        val backend = Backend()
        val vm = ChatViewModel(backend, Settings())
        vm.openSession("s1")
        advanceUntilIdle()
        val before = backend.loads
        backend.extra = listOf(MessageDto("m3", "USER", "from another device"))
        vm.openSessionAt("s1", "m3")
        // 重读完成前保持"读取中"，界面不会把它当成不存在的消息。
        assertEquals(true, vm.state.value.messagesLoading)
        advanceUntilIdle()
        assertEquals(before + 1, backend.loads)
        assertEquals("m3", vm.state.value.reveal!!.messageId)
        assertEquals(3, vm.state.value.messages.size)
        // 已经在本地的消息不重读。
        vm.openSessionAt("s1", "m1")
        advanceUntilIdle()
        assertEquals(before + 1, backend.loads)
    }
}
