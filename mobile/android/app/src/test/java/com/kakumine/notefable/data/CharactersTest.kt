package com.kakumine.notefable.data

import com.kakumine.notefable.ui.ChatUiState
import com.kakumine.notefable.ui.MessageRole
import com.kakumine.notefable.ui.UiMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CharactersTest {
    @Test
    fun `all 7 round-1 characters are registered with D Quill as the default and contrast-fixed`() {
        assertEquals(
            listOf("quill", "foldie", "piko", "velo", "sora", "loop", "orbit"),
            CharacterId.entries.map { it.id },
        )
        assertEquals(CharacterId.Quill, CharacterId.Default)
        assertEquals(listOf(CharacterId.Quill), CharacterId.entries.filter { it.isDefault })

        val quill = CharacterCatalog.spec(CharacterId.Quill)
        val bodyFill = quill.bodyPaths.first().fillArgb
        // Contrast fix: Quill body fill is warm vellum (not cream 0xFFF7F6F2 or white 0xFFFFFFFF) and contour >= 8f.
        assertNotEquals(0xFFF7F6F2L, bodyFill)
        assertNotEquals(0xFFFFFFFFL, bodyFill)
        val contour = quill.bodyPaths.first { it.strokeArgb == 0xFF0F172AL }
        assertTrue(contour.strokeWidth >= 8f)

        for (id in CharacterId.entries) {
            val spec = CharacterCatalog.spec(id)
            assertTrue(spec.bodyPaths.isNotEmpty())
            assertTrue(spec.eyes.size >= 2)
            assertTrue(spec.motion.floatDurationMs >= 3000)
            for (state in CharacterState.entries) {
                val pose = CharacterCatalog.pose(id, state)
                assertTrue(pose.bodyScale.isFinite())
                assertTrue(pose.eyeScaleY.isFinite())
            }
            assertTrue(CharacterCatalog.pose(id, CharacterState.Typing).gazeY > 0f)
            assertTrue(CharacterCatalog.pose(id, CharacterState.Thinking).gazeX > 0f)
            assertTrue(CharacterCatalog.pose(id, CharacterState.Error).bodyOffsetY > 0f)
        }
    }

    @Test
    fun `state machine enforces priority Hidden gt Error gt Responding gt Thinking gt Completed gt Typing gt Idle`() {
        assertEquals(CharacterState.Idle, resolveCharacterState())
        assertEquals(CharacterState.Typing, resolveCharacterState(isTyping = true))
        assertEquals(CharacterState.Completed, resolveCharacterState(isTyping = true, isCompleted = true))
        assertEquals(CharacterState.Thinking, resolveCharacterState(isTyping = true, isCompleted = true, isThinking = true))
        assertEquals(CharacterState.Responding, resolveCharacterState(isTyping = true, isThinking = true, isResponding = true))
        assertEquals(
            CharacterState.Error,
            resolveCharacterState(hasError = true, isResponding = true, isThinking = true, isCompleted = true, isTyping = true),
        )
        assertEquals(
            CharacterState.Hidden,
            resolveCharacterState(hidden = true, hasError = true, isResponding = true, isThinking = true, isTyping = true),
        )
    }

    @Test
    fun `ChatUiState maps real chat turn events to character states and exits Thinking immediately on stop`() {
        val base = ChatUiState()
        assertEquals(CharacterState.Idle, base.heroCharacterState(isTyping = false))
        assertEquals(CharacterState.Typing, base.heroCharacterState(isTyping = true))

        // Waiting for first token -> Thinking
        val waiting = base.copy(
            sending = true,
            messages = listOf(
                UiMessage("u1", MessageRole.User, "Hi"),
                UiMessage("a1", MessageRole.Assistant, "", streaming = true),
            ),
        )
        assertEquals(CharacterState.Thinking, waiting.heroCharacterState(isTyping = true))
        assertEquals(CharacterState.Thinking, waiting.activeReplyCharacterState())

        // Streaming response -> Responding
        val streaming = waiting.copy(
            messages = listOf(
                UiMessage("u1", MessageRole.User, "Hi"),
                UiMessage("a1", MessageRole.Assistant, "Hello", streaming = true),
            ),
        )
        assertEquals(CharacterState.Responding, streaming.activeReplyCharacterState())

        // Stop requested -> exits Thinking/Responding immediately without lingering
        val stopping = waiting.copy(stopping = true)
        assertEquals(CharacterState.Idle, stopping.activeReplyCharacterState())
        assertEquals(CharacterState.Typing, stopping.heroCharacterState(isTyping = true))

        // Completed -> Completed then Idle
        val completed = base.copy(
            sending = false,
            characterOutcome = CharacterOutcome.Completed,
            messages = listOf(
                UiMessage("u1", MessageRole.User, "Hi"),
                UiMessage("a1", MessageRole.Assistant, "Done"),
            ),
        )
        assertEquals(CharacterState.Completed, completed.activeReplyCharacterState())

        // Error overrides Typing (e.g. 429 rejected draft restored to input)
        val errored = base.copy(sending = false, characterOutcome = CharacterOutcome.Error)
        assertEquals(CharacterState.Error, errored.heroCharacterState(isTyping = true))
        assertEquals(CharacterState.Hidden, errored.heroCharacterState(isTyping = true, hidden = true))
    }
}
