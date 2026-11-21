import XCTest
@testable import NoteFableCore

/// 对应 Android 的 `ChatFollowTest`（附件来源的两条属于附件模块，不在这里）。
final class ChatFollowTests: XCTestCase {
    private func action(
        following: Bool,
        distance: Double,
        scrolling: Bool = false,
        programmatic: Bool = false,
        hasItems: Bool = true,
        revealPending: Bool = false
    ) -> FollowAction {
        followAction(
            following: following, distanceToBottom: distance, threshold: 5, scrolling: scrolling,
            programmaticScroll: programmatic, hasItems: hasItems, revealPending: revealPending
        )
    }

    func testPendingRevealNeitherPinsNorChangesFollowing() {
        // 定位到检索结果时：跟随中、离开底部也不贴底；定位自己的滚动不算用户滚动。
        XCTAssertEqual(action(following: true, distance: 500, revealPending: true), .none)
        XCTAssertEqual(action(following: true, distance: 500, scrolling: true, revealPending: true), .none)
        XCTAssertEqual(action(following: false, distance: 0, revealPending: true), .none)
        XCTAssertEqual(action(following: true, distance: 500), .pin)
    }

    func testDragStartedAtBottomDoesNotResumeFollowingWhileScrolling() {
        // 拖动开始时已经关掉跟随；拖动还在进行、离底部仍在阈值内，不能马上又跟随。
        XCTAssertEqual(action(following: false, distance: 3, scrolling: true), .none)
    }

    func testUserScrollAwayFromBottomStopsFollowing() {
        XCTAssertEqual(action(following: true, distance: 200, scrolling: true), .unfollow)
    }

    func testProgrammaticScrollKeepsFollowing() {
        XCTAssertEqual(action(following: true, distance: 200, scrolling: true, programmatic: true), .none)
    }

    func testScrollSettlingAtBottomResumesFollowing() {
        XCTAssertEqual(action(following: false, distance: 2), .follow)
    }

    func testScrollSettlingAwayFromBottomStaysUnfollowed() {
        XCTAssertEqual(action(following: false, distance: 200), .none)
    }

    func testFollowingAndGrownPastBottomPins() {
        XCTAssertEqual(action(following: true, distance: 40), .pin)
        XCTAssertEqual(action(following: true, distance: 40, hasItems: false), .none)
        XCTAssertEqual(action(following: true, distance: 0), .none)
    }
}
