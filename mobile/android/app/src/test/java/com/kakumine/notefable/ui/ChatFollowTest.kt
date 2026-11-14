package com.kakumine.notefable.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class ChatFollowTest {
    private fun action(
        following: Boolean,
        distance: Int,
        scrolling: Boolean = false,
        programmatic: Boolean = false,
        hasItems: Boolean = true,
        revealPending: Boolean = false,
    ) = followAction(
        following, distance, thresholdPx = 5f, scrolling = scrolling, programmaticScroll = programmatic, hasItems = hasItems,
        revealPending = revealPending,
    )

    @Test
    fun pendingRevealNeitherPinsNorChangesFollowing() {
        // 定位到检索结果时：跟随中、离开底部也不贴底；定位自己的滚动不算用户滚动。
        assertEquals(FollowAction.None, action(following = true, distance = 500, revealPending = true))
        assertEquals(FollowAction.None, action(following = true, distance = 500, scrolling = true, revealPending = true))
        assertEquals(FollowAction.None, action(following = false, distance = 0, revealPending = true))
        assertEquals(FollowAction.Pin, action(following = true, distance = 500))
    }

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
