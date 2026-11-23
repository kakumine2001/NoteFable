package com.kakumine.notefable.ui

import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.ChatBackend
import com.kakumine.notefable.data.ChatRequest
import com.kakumine.notefable.data.ChatStreamEvent
import com.kakumine.notefable.data.ImageResult
import com.kakumine.notefable.data.LocalFile
import com.kakumine.notefable.data.MessageDto
import com.kakumine.notefable.data.ModelInfo
import com.kakumine.notefable.data.ModelsResponse
import com.kakumine.notefable.data.SessionSummary
import com.kakumine.notefable.data.UploadPlan
import com.kakumine.notefable.data.UploadSlot
import com.kakumine.notefable.data.UsageLimits
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/** 429 使用上限：被拒的草稿和附件放回输入栏、未登录时的登录提示（网页 page.tsx 的 UsageLimitError 分支）。 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelUsageLimitTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class MemorySettings : SettingsStore {
        override var modelId: String? = null
        override var reasoning: String? = null
    }

    /** 每次发送都等 [release] 放行后以 [error] 结束。 */
    private class LimitedBackend(var error: Throwable) : ChatBackend {
        var release = CompletableDeferred<Unit>()
        /** 设了的话，准备上传（POST /api/uploads）就以它失败。 */
        var uploadError: Throwable? = null
        override suspend fun sessions(): List<SessionSummary> = emptyList()
        override suspend fun messages(sessionId: String): List<MessageDto> = emptyList()
        override suspend fun models() = ModelsResponse(
            defaultModel = "a",
            models = listOf(ModelInfo("a", "Model A", supportsWebSearch = true, supportsImageInput = true, reasoningEfforts = listOf("low"), defaultReasoning = "low")),
        )
        override fun absoluteUrl(path: String) = "https://example.test$path"
        override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> = flow {
            release.await()
            throw error
        }
        override suspend fun generateImage(request: ChatRequest): ImageResult {
            release.await()
            throw error
        }
        override suspend fun prepareUploads(files: List<LocalFile>): UploadPlan {
            uploadError?.let { throw it }
            return UploadPlan(files.indices.map { UploadSlot("path-$it", "ticket-$it") }, "local")
        }
        override suspend fun uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: (Int) -> Unit) = Unit
        override suspend fun discardUploads(tickets: List<String>) = Unit
    }

    private fun limit(tier: String, kind: String = "chat") =
        ApiException(429, "You've reached today's limit.", code = ApiException.USAGE_LIMIT_CODE, tier = tier, kind = kind)

    private fun storageFull(tier: String) = ApiException(
        413, "There isn't enough storage space left. Delete files you no longer need to free up space.",
        code = ApiException.STORAGE_LIMIT_CODE, tier = tier, used = 500L * 1024 * 1024, limit = 500L * 1024 * 1024,
    )

    // 回答进行中刷新定时器一直在排队，advanceUntilIdle 等不到空闲；只推进一小段虚拟时间。
    private fun kotlinx.coroutines.test.TestScope.settle() {
        advanceTimeBy(100)
        runCurrent()
    }

    private val photo = LocalFile("content://photo", "photo.png", "image/png", 3400)
    private val notes = LocalFile("content://notes", "notes.txt", "text/plain", 1200)

    @Test
    fun `a rejected message goes back into the composer ahead of text typed meanwhile`() = runTest(dispatcher) {
        val backend = LimitedBackend(limit("guest"))
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10)
        advanceUntilIdle()

        vm.updateDraft("first question  ")
        vm.send(vm.draft)
        settle()
        assertEquals("", vm.draft)
        vm.updateDraft("added later")
        backend.release.complete(Unit)
        advanceUntilIdle()

        assertEquals("first question\n\nadded later", vm.draft)
        assertEquals("chat", vm.state.value.guestLimit)
        assertTrue(vm.state.value.messages.last().usageLimit)
    }

    @Test
    fun `without text typed meanwhile the rejected text comes back unchanged`() {
        assertEquals("hello  ", ChatViewModel.mergeRejectedDraft("hello  ", ""))
        assertEquals("hello  ", ChatViewModel.mergeRejectedDraft("hello  ", "  \n"))
        assertEquals("hello\n\nmore", ChatViewModel.mergeRejectedDraft("hello \n", "more"))
    }

    @Test
    fun `rejected pages come back first without dropping pages picked meanwhile`() = runTest(dispatcher) {
        val backend = LimitedBackend(limit("member"))
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10)
        advanceUntilIdle()
        val plan = com.kakumine.notefable.data.ChatProjectNote("n1", "Plan")
        val todo = com.kakumine.notefable.data.ChatProjectNote("n2", "Todo")

        vm.setAttachedPages(listOf(plan))
        vm.send("summarize")
        settle()
        assertTrue(vm.state.value.attachedPages.isEmpty())
        vm.setAttachedPages(listOf(todo))
        backend.release.complete(Unit)
        advanceUntilIdle()

        assertEquals(listOf(plan, todo), vm.state.value.attachedPages)
    }

    @Test
    fun `rejected attachments are restored first and the sent bubble drops its local image preview`() = runTest(dispatcher) {
        val backend = LimitedBackend(limit("member"))
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10)
        advanceUntilIdle()

        vm.addFiles(listOf(photo))
        vm.send("look")
        settle()
        assertTrue(vm.state.value.files.isEmpty())
        vm.addFiles(listOf(notes))
        backend.release.complete(Unit)
        advanceUntilIdle()

        assertEquals(listOf(photo, notes), vm.state.value.files)
        val sent = vm.state.value.messages.first { it.role == MessageRole.User }
        assertNull(sent.attachments.single().dataUrl)
        // 已登录用户撞到上限不显示登录提示。
        assertNull(vm.state.value.guestLimit)
    }

    @Test
    fun `an image limit for a guest shows the image prompt, closing it or changing identity hides it`() = runTest(dispatcher) {
        val backend = LimitedBackend(limit("guest", kind = "image"))
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10)
        advanceUntilIdle()

        vm.setImageMode(true)
        vm.send("a cat")
        backend.release.complete(Unit)
        advanceUntilIdle()
        assertEquals("image", vm.state.value.guestLimit)
        assertEquals("a cat", vm.draft)

        vm.dismissGuestLimit()
        assertNull(vm.state.value.guestLimit)

        backend.release = CompletableDeferred()
        vm.addFiles(listOf(photo))
        vm.send(vm.draft)
        backend.release.complete(Unit)
        advanceUntilIdle()
        assertEquals("image", vm.state.value.guestLimit)

        // 登录后：草稿留着，附件和网页一样不跨登录保留，提示关闭。
        vm.onIdentityChanged()
        advanceUntilIdle()
        assertEquals("a cat", vm.draft)
        assertTrue(vm.state.value.files.isEmpty())
        assertNull(vm.state.value.guestLimit)
    }

    @Test
    fun `other failures do not touch the composer`() = runTest(dispatcher) {
        val backend = LimitedBackend(java.io.IOException("offline"))
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10)
        advanceUntilIdle()

        vm.send("hi")
        backend.release.complete(Unit)
        advanceUntilIdle()
        assertEquals("", vm.draft)
        assertNull(vm.state.value.guestLimit)
        assertEquals("offline", vm.state.value.messages.last().errorDetail)
    }

    @Test
    fun `bundled usage limits parse and carry the member numbers`() {
        val asset = File("src/main/assets/usage-limits.json")
        val limits = UsageLimits.parse(asset.readText())
        assertTrue(limits.member.chat > limits.guest.chat)
        assertTrue(limits.member.image > 0)
        // 存储上限（字节）：Pro 的 10 GiB 超过 Int 的范围。
        assertEquals(500L * 1024 * 1024, limits.member.storage)
        assertEquals(10L * 1024 * 1024 * 1024, limits.pro.storage)
    }

    @Test
    fun `a storage refusal before uploading keeps the text and files and shows the storage prompt`() = runTest(dispatcher) {
        val backend = LimitedBackend(java.io.IOException("unused")).apply { uploadError = storageFull("member") }
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10)
        advanceUntilIdle()

        vm.updateDraft("look at this")
        vm.addFiles(listOf(photo))
        vm.send(vm.draft)
        advanceUntilIdle()

        assertEquals("look at this", vm.draft)
        assertEquals(listOf(photo), vm.state.value.files)
        assertEquals(StorageLimitInfo("member", 500L * 1024 * 1024, 500L * 1024 * 1024), vm.state.value.storageLimit)
        // 不是网络问题，不显示"检查网络"的上传失败。
        assertNull(vm.state.value.notice)
        assertTrue(vm.state.value.messages.isEmpty())

        vm.dismissStorageLimit()
        assertNull(vm.state.value.storageLimit)
    }

    @Test
    fun `an image generation refused for storage comes back into the composer with the storage prompt`() = runTest(dispatcher) {
        val backend = LimitedBackend(storageFull("guest"))
        val vm = ChatViewModel(backend, MemorySettings(), flushIntervalMs = 10)
        advanceUntilIdle()

        vm.setImageMode(true)
        vm.send("a cat")
        backend.release.complete(Unit)
        advanceUntilIdle()

        assertEquals("a cat", vm.draft)
        assertEquals("guest", vm.state.value.storageLimit?.tier)
        // 次数上限的提示不出现；气泡里是服务端的说明（按语言显示）。
        assertNull(vm.state.value.guestLimit)
        assertTrue(vm.state.value.messages.last().usageLimit)

        vm.onIdentityChanged()
        advanceUntilIdle()
        assertNull(vm.state.value.storageLimit)
    }
}
