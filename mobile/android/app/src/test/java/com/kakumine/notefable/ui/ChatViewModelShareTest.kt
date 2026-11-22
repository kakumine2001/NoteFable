package com.kakumine.notefable.ui

import com.kakumine.notefable.data.AttachError
import com.kakumine.notefable.data.ChatBackend
import com.kakumine.notefable.data.ChatRequest
import com.kakumine.notefable.data.ChatStreamEvent
import com.kakumine.notefable.data.GeneratedImagePayload
import com.kakumine.notefable.data.ImageResult
import com.kakumine.notefable.data.IncomingShareRequest
import com.kakumine.notefable.data.LocalFile
import com.kakumine.notefable.data.MAX_UPLOAD_FILE_BYTES
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

/** 系统分享交来的内容：放进新聊天的输入栏，不自动发送，不丢用户写了一半的话。 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelShareTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class MemorySettings : SettingsStore {
        override var modelId: String? = null
        override var reasoning: String? = null
    }

    private class QuietBackend : ChatBackend {
        override suspend fun sessions(): List<SessionSummary> = emptyList()
        override suspend fun messages(sessionId: String): List<MessageDto> = listOf(MessageDto("m1", "USER", "old"))
        override suspend fun models(): ModelsResponse = throw IOException("404")
        override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> = emptyFlow()
        override suspend fun generateImage(request: ChatRequest) = ImageResult(sessionId = "img", image = GeneratedImagePayload("data:image/png;base64,AAAA"))
        override suspend fun prepareUploads(files: List<LocalFile>) = UploadPlan(files.indices.map { UploadSlot("p$it", "t$it") }, "local")
        override suspend fun uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: (Int) -> Unit) = Unit
        override suspend fun discardUploads(tickets: List<String>) = Unit
        override fun absoluteUrl(path: String) = "https://example.test$path"
    }

    private fun newViewModel(): ChatViewModel = ChatViewModel(QuietBackend(), MemorySettings(), flushIntervalMs = 10)

    private val notes = LocalFile("content://notes", "notes.txt", "text/plain", 1200)
    private val photo = LocalFile("content://photo", "photo.png", "image/png", 3400)

    @Test
    fun `from an opened chat it starts a new chat, drops the old quote and fills the draft and files`() = runTest(dispatcher) {
        val vm = newViewModel()
        advanceUntilIdle()
        vm.openSession("s1")
        advanceUntilIdle()
        vm.setQuote("quoted text")
        assertEquals("s1", vm.state.value.activeSessionId)

        vm.applyIncomingShare(IncomingShareRequest("shared link") { listOf(notes, photo) })
        advanceUntilIdle()

        assertNull(vm.state.value.activeSessionId)
        assertTrue(vm.state.value.messages.isEmpty())
        assertNull(vm.state.value.quote)
        assertEquals("shared link", vm.draft)
        assertEquals(listOf(notes, photo), vm.state.value.files)
        assertEquals(0, vm.state.value.importing)
        // 不会自动发送。
        assertTrue(!vm.state.value.sending)
    }

    @Test
    fun `in an empty new chat it keeps what was typed and keeps the quote`() = runTest(dispatcher) {
        val vm = newViewModel()
        advanceUntilIdle()
        vm.updateDraft("half written")
        vm.setQuote("kept quote")
        vm.addFiles(listOf(notes))

        vm.applyIncomingShare(IncomingShareRequest("shared") { listOf(photo) })
        advanceUntilIdle()

        assertEquals("half written\n\nshared", vm.draft)
        assertEquals("kept quote", vm.state.value.quote)
        assertEquals(listOf(notes, photo), vm.state.value.files)
    }

    @Test
    fun `text only share adds no files`() = runTest(dispatcher) {
        val vm = newViewModel()
        advanceUntilIdle()

        vm.applyIncomingShare(IncomingShareRequest("just text"))
        advanceUntilIdle()

        assertEquals("just text", vm.draft)
        assertTrue(vm.state.value.files.isEmpty())
    }

    @Test
    fun `an oversize or unsupported shared file is rejected as a whole with the usual notice`() = runTest(dispatcher) {
        val vm = newViewModel()
        advanceUntilIdle()
        val huge = LocalFile("content://huge", "huge.pdf", "application/pdf", MAX_UPLOAD_FILE_BYTES + 1)

        vm.applyIncomingShare(IncomingShareRequest("") { listOf(notes, huge) })
        advanceUntilIdle()

        assertTrue(vm.state.value.files.isEmpty())
        val rejected = (vm.state.value.notice as ComposerNotice.Rejected).error as AttachError.NotAdded
        assertTrue(rejected.cause is AttachError.FileTooLarge)

        val odd = LocalFile("content://odd", "video.mp4", "video/mp4", 100)
        vm.applyIncomingShare(IncomingShareRequest("") { listOf(odd) })
        advanceUntilIdle()
        assertTrue(vm.state.value.files.isEmpty())
        assertTrue(((vm.state.value.notice as ComposerNotice.Rejected).error as AttachError.NotAdded).cause is AttachError.Unsupported)
    }
}
