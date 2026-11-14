package com.kakumine.notefable.ui

import com.kakumine.notefable.data.ChatBackend
import com.kakumine.notefable.data.ChatRequest
import com.kakumine.notefable.data.ChatStreamEvent
import com.kakumine.notefable.data.EmojiCatalog
import com.kakumine.notefable.data.GeneratedImagePayload
import com.kakumine.notefable.data.ImageResult
import com.kakumine.notefable.data.LocalFile
import com.kakumine.notefable.data.MessageDto
import com.kakumine.notefable.data.ModelsResponse
import com.kakumine.notefable.data.SessionSummary
import com.kakumine.notefable.data.SkinTone
import com.kakumine.notefable.data.UploadPlan
import com.kakumine.notefable.data.UploadSlot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatIconTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class Settings : SettingsStore {
        override var modelId: String? = null
        override var reasoning: String? = null
    }

    private class Backend : ChatBackend {
        var sessions = listOf<SessionSummary>()
        val events = Channel<ChatStreamEvent>(Channel.UNLIMITED)
        override suspend fun sessions() = sessions
        override suspend fun messages(sessionId: String) = emptyList<MessageDto>()
        override suspend fun models() = ModelsResponse(defaultModel = "a", models = emptyList())
        override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> = events.receiveAsFlow()
        override suspend fun generateImage(request: ChatRequest) = ImageResult(sessionId = "img", image = GeneratedImagePayload("data:image/png;base64,AA"))
        override suspend fun prepareUploads(files: List<LocalFile>) = UploadPlan(emptyList<UploadSlot>(), "local")
        override suspend fun uploadFile(slot: UploadSlot, mode: String, file: LocalFile, onProgress: (Int) -> Unit) = Unit
        override suspend fun discardUploads(tickets: List<String>) = Unit
        override fun absoluteUrl(path: String) = path
    }

    private class Saver {
        val calls = mutableListOf<Pair<String, String?>>()
        var result = true
        var gate: CompletableDeferred<Unit>? = null
        var onSaved: (String, String?) -> Unit = { _, _ -> }
        suspend fun save(id: String, icon: String?): Boolean {
            calls += id to icon
            gate?.await()
            if (result) onSaved(id, icon)
            return result
        }
    }

    private fun TestScope.newViewModel(backend: Backend, saver: Saver): ChatViewModel {
        val vm = ChatViewModel(backend, Settings(), flushIntervalMs = 10, saveIcon = saver::save)
        advanceUntilIdle()
        return vm
    }

    @Test
    fun `a draft icon on an unsaved chat is saved to the session the first reply creates`() = runTest(dispatcher) {
        val backend = Backend()
        // 保存成功后服务端的列表里就有这个图标。
        val saver = Saver().apply { onSaved = { id, icon -> backend.sessions = backend.sessions.map { if (it.id == id) it.copy(icon = icon) else it } } }
        val vm = newViewModel(backend, saver)

        vm.changeIcon("🧪")
        assertEquals("🧪", vm.state.value.draftIcon)
        assertEquals("🧪", vm.state.value.activeIcon)
        assertEquals(emptyList<Pair<String, String?>>(), saver.calls)

        backend.sessions = listOf(SessionSummary("s1", "New chat"))
        vm.send("hi")
        // 回答没结束时刷新定时器一直在排队；无论断言成败都要结束这条流，测试才能收尾。
        try {
            backend.events.send(ChatStreamEvent.Started("s1"))
            advanceTimeBy(100); runCurrent()

            assertEquals(listOf("s1" to "🧪"), saver.calls)
            assertNull(vm.state.value.draftIcon)
            // 刷新回来的列表里还没有图标，但保存过的值不会被冲掉。
            assertEquals("🧪", vm.state.value.sessions.single { it.id == "s1" }.icon)
        } finally {
            backend.events.close()
        }
    }

    @Test
    fun `a chat made from a project keeps the carried draft icon from the first frame`() = runTest(dispatcher) {
        val backend = Backend()
        val saver = Saver().apply { gate = CompletableDeferred() }
        val vm = newViewModel(backend, saver)
        vm.changeIcon("📚")

        vm.openCreatedSession(SessionSummary("p1", "New chat"))
        // 保存还没开始（也还没结束），新行和标题已经是带过来的图标。
        assertEquals("📚", vm.state.value.sessions.single { it.id == "p1" }.icon)
        assertEquals("📚", vm.state.value.activeIcon)
        assertNull(vm.state.value.draftIcon)

        saver.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("p1" to "📚"), saver.calls)
        assertEquals("📚", vm.state.value.activeIcon)
    }

    @Test
    fun `the icon failure notice is cleared when another chat is opened`() = runTest(dispatcher) {
        val backend = Backend().apply { sessions = listOf(SessionSummary("s1", "One"), SessionSummary("s2", "Two")) }
        val saver = Saver().apply { result = false }
        val vm = newViewModel(backend, saver)
        vm.changeSessionIcon("s1", "📕")
        advanceUntilIdle()
        assertEquals(ComposerNotice.IconFailed, vm.state.value.notice)

        vm.openSession("s2")
        assertNull(vm.state.value.notice)

        vm.changeSessionIcon("s1", "📕")
        advanceUntilIdle()
        vm.newChat()
        assertNull(vm.state.value.notice)
    }

    @Test
    fun `opening another chat drops the draft icon`() = runTest(dispatcher) {
        val backend = Backend().apply { sessions = listOf(SessionSummary("old", "Old")) }
        val vm = newViewModel(backend, Saver())
        vm.changeIcon("🎒")
        vm.openSession("old")
        advanceUntilIdle()
        assertNull(vm.state.value.draftIcon)
    }

    @Test
    fun `a failed save puts the last saved icon back and shows the composer notice`() = runTest(dispatcher) {
        val backend = Backend().apply { sessions = listOf(SessionSummary("s1", "Chat", icon = "📘")) }
        val saver = Saver().apply { result = false }
        val vm = newViewModel(backend, saver)
        vm.openSession("s1")
        advanceUntilIdle()

        vm.changeIcon("📕")
        advanceUntilIdle()
        assertEquals("📘", vm.state.value.activeIcon)
        assertEquals(ComposerNotice.IconFailed, vm.state.value.notice)
    }

    @Test
    fun `quick changes only send the latest icon and survive a stale list refresh`() = runTest(dispatcher) {
        val backend = Backend().apply { sessions = listOf(SessionSummary("s1", "Chat")) }
        val saver = Saver().apply { gate = CompletableDeferred() }
        val vm = newViewModel(backend, saver)

        vm.changeSessionIcon("s1", "1️⃣")
        runCurrent()
        vm.changeSessionIcon("s1", "2️⃣")
        vm.changeSessionIcon("s1", "3️⃣")
        runCurrent()
        // 旧列表（没有图标）在保存期间回来。
        vm.refreshSessions()
        runCurrent()
        assertEquals("3️⃣", vm.state.value.sessions.single().icon)

        saver.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("s1" to "1️⃣", "s1" to "3️⃣"), saver.calls)
        assertEquals("3️⃣", vm.state.value.sessions.single().icon)
    }

    @Test
    fun `icon sync reconciles only edits made after the refresh started`() = runTest(dispatcher) {
        val sync = SessionIconSync { _, _ -> true }
        val shown = mutableMapOf<String, String?>()
        val before = sync.mark()
        launch { sync.change("a", "🍎", null, { shown["a"] = it }, {}) }
        advanceUntilIdle()
        val after = sync.mark()
        val fetched = listOf(SessionSummary("a", "A"), SessionSummary("b", "B", icon = "🍌"))
        assertEquals("🍎", sync.reconcile(fetched, before)[0].icon)
        // 改动结束后才开始的刷新以服务端为准。
        assertNull(sync.reconcile(fetched, after)[0].icon)
        assertEquals("🍌", sync.reconcile(fetched, before)[1].icon)
    }

    @Test
    fun `floating picker sits below the button, flips above near the bottom and stays on screen`() {
        val viewport = IntSize(412, 915)
        val popup = IntSize(388, 416)
        // 空白页标题的图标（24, 359 – 41.6 高）：下面放得下。
        assertEquals(IntOffset(12, 407), floatingEmojiPosition(IntRect(24, 359, 66, 401), viewport, popup, 12, 6))
        // 靠下的按钮：翻到上面。
        assertEquals(IntOffset(12, 800 - 416 - 6), floatingEmojiPosition(IntRect(20, 800, 60, 840), viewport, popup, 12, 6))
        // 屏幕很矮：夹在上下 12 之间。
        assertEquals(IntOffset(12, 12), floatingEmojiPosition(IntRect(20, 100, 60, 140), IntSize(412, 300), popup, 12, 6))
    }

    @Test
    fun `emoji rows fit as many 34dp cells as the width allows`() {
        // 412 宽的手机：弹出框 388、去掉左右 10 后 368 → 10 个；360 宽：336 → 9 个。
        assertEquals(10, emojiColumns(androidx.compose.ui.unit.Dp(388f)))
        assertEquals(9, emojiColumns(androidx.compose.ui.unit.Dp(336f)))
        assertEquals(1, emojiColumns(androidx.compose.ui.unit.Dp(10f)))
    }

    @Test
    fun `grid sections hide empty categories, apply the skin tone and keep recent emoji as picked`() {
        val json = """
            {"categories":["suggested","smileys_people","animals_nature"],"icons":{},
             "emojis":[
              {"u":"1f44b","c":1,"v":["1f44b-1f3fb"],"n":{"en":["waving hand"],"zh":[],"zh-Hant":[],"ja":[]}},
              {"u":"1f408","c":2,"n":{"en":["cat"],"zh":[],"zh-Hant":[],"ja":[]}}
             ]}
        """.trimIndent()
        val catalog = EmojiCatalog.parse(json, "en")
        val all = emojiGridSections(catalog, emptyList(), SkinTone.Light, "")
        assertEquals(listOf("smileys_people", "animals_nature"), all.map { it.first })
        assertEquals("1f44b-1f3fb", all[0].second.single().first)

        val withRecent = emojiGridSections(catalog, listOf("1f44b-1f3fb"), SkinTone.Neutral, "")
        assertEquals("suggested", withRecent[0].first)
        assertEquals("1f44b-1f3fb", withRecent[0].second.single().first)

        assertEquals(listOf("animals_nature"), emojiGridSections(catalog, emptyList(), SkinTone.Neutral, "CAT").map { it.first })
        assertEquals(emptyList<String>(), emojiGridSections(catalog, emptyList(), SkinTone.Neutral, "zebra").map { it.first })
    }
}
