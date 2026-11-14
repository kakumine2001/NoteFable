package com.kakumine.studymate.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class ChatFollowTest {
    private fun action(
        following: Boolean,
        distance: Int,
        scrolling: Boolean = false,
        programmatic: Boolean = false,
        hasItems: Boolean = true,
    ) = followAction(following, distance, thresholdPx = 5f, scrolling = scrolling, programmaticScroll = programmatic, hasItems = hasItems)

    @Test
    fun dragStartedAtBottomDoesNotResumeFollowingWhileScrolling() {
        // DragInteraction.Start 已经关掉跟随；拖动还在进行、离底部仍在 2dp 内，不能马上又跟随。
        assertEquals(FollowAction.None, action(following = false, distance = 3, scrolling = true))
    }

    @Test
    fun userScrollAwayFromBottomStopsFollowing() {
        // 滚轮、无障碍滚动等不产生 DragInteraction 的滚动，也要停止跟随。
        assertEquals(FollowAction.Unfollow, action(following = true, distance = 200, scrolling = true))
    }

    @Test
    fun programmaticScrollKeepsFollowing() {
        assertEquals(FollowAction.None, action(following = true, distance = 200, scrolling = true, programmatic = true))
    }

    @Test
    fun scrollSettlingAtBottomResumesFollowing() {
        assertEquals(FollowAction.Follow, action(following = false, distance = 2))
    }

    @Test
    fun scrollSettlingAwayFromBottomStaysUnfollowed() {
        assertEquals(FollowAction.None, action(following = false, distance = 200))
    }

    @Test
    fun followingAndGrownPastBottomPins() {
        assertEquals(FollowAction.Pin, action(following = true, distance = 40))
        assertEquals(FollowAction.None, action(following = true, distance = 40, hasItems = false))
        assertEquals(FollowAction.None, action(following = true, distance = 0))
    }

    @Test
    fun pickedFilesWinOverCameraTarget() {
        assertEquals(listOf("a", "b"), pickedAttachmentSources(listOf("a", "b"), "camera") { true })
    }

    @Test
    fun emptyResultUsesCameraTargetOnlyWhenPhotoWasWritten() {
        assertEquals(listOf("camera"), pickedAttachmentSources(emptyList(), "camera") { true })
        assertEquals(emptyList<String>(), pickedAttachmentSources(emptyList(), "camera") { false })
        assertEquals(emptyList<String>(), pickedAttachmentSources(emptyList<String>(), null) { true })
    }
}
