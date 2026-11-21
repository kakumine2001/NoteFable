import XCTest
@testable import NoteFableCore

/// 定位到消息时的纯逻辑：正常顺序的下标、旧布局的判断、闪烁强度。对应 Android 的 `ChatRevealLayoutTest`
/// （`ChatRevealTest` 测的是 ChatViewModel 的定位请求，在 ViewModel 的测试里）。
final class ChatRevealLayoutTests: XCTestCase {
    func testIndexFollowsNormalOrder() {
        let ids = ["a", "b", "c"]
        XCTAssertEqual(revealIndex(ids, "a"), 0)
        XCTAssertEqual(revealIndex(ids, "c"), 2)
        XCTAssertEqual(revealIndex(ids, "gone"), -1)
    }

    func testLayoutOfThePreviousChatIsStaleEvenWithTheSameItemCount() {
        let ids: Set<String> = ["n1", "n2"]
        // 上一段聊天也有两条消息：项数一样，但 key 不是这段聊天的。
        XCTAssertFalse(layoutIsCurrent(totalItems: 2, visibleKeys: ["o1", "o2"], messageCount: 2, ids: ids))
        XCTAssertFalse(layoutIsCurrent(totalItems: 3, visibleKeys: ["n1", "n2"], messageCount: 2, ids: ids))
        XCTAssertFalse(layoutIsCurrent(totalItems: 2, visibleKeys: [], messageCount: 2, ids: ids))
        XCTAssertTrue(layoutIsCurrent(totalItems: 2, visibleKeys: ["n1", "n2"], messageCount: 2, ids: ids))
    }

    func testFlashLevelResumesFromElapsedTimeInsteadOfRestarting() {
        XCTAssertEqual(revealFlashLevel(0), 1)
        XCTAssertEqual(revealFlashLevel(-50), 1)
        XCTAssertEqual(revealFlashLevel(1199), 1)
        let fading = revealFlashLevel(1600)
        XCTAssertTrue(fading > 0 && fading < 1)
        // ease-out：前半段淡得快，过半时已经淡掉一大半。
        XCTAssertEqual(fading, 0.31, accuracy: 0.02)
        XCTAssertGreaterThan(revealFlashLevel(1300), revealFlashLevel(1900))
        // 滚出屏幕再回来时按开始时间算：已经过了 2 秒就不再画。
        XCTAssertEqual(revealFlashLevel(2000), 0)
        XCTAssertEqual(revealFlashLevel(5000), 0)
        let flash = RevealFlash(messageId: "m", token: 1, startMs: 10_000)
        XCTAssertEqual(flash.level(at: 10_500), 1)
        XCTAssertEqual(flash.level(at: 12_000), 0)
    }

    func testEaseOutMatchesTheCssCurve() {
        // cubic-bezier(0, 0, 0.58, 1) 的几个点（和浏览器、Compose 的 EaseOut 一样）。
        XCTAssertEqual(cubicBezier(0, x1: 0, y1: 0, x2: 0.58, y2: 1), 0)
        XCTAssertEqual(cubicBezier(1, x1: 0, y1: 0, x2: 0.58, y2: 1), 1)
        XCTAssertEqual(cubicBezier(0.5, x1: 0, y1: 0, x2: 0.58, y2: 1), 0.6846, accuracy: 0.001)
        // 线性曲线。
        XCTAssertEqual(cubicBezier(0.3, x1: 1.0 / 3, y1: 1.0 / 3, x2: 2.0 / 3, y2: 2.0 / 3), 0.3, accuracy: 0.0001)
    }

    func testRevealWaitsForTheChatThenScrollsOrGivesUp() {
        func step(active: String? = "s1", loading: Bool = false, failed: Bool = false, target: String = "m2") -> RevealStep {
            revealStep(
                requestSessionId: "s1", activeSessionId: active, messagesLoading: loading, messagesFailed: failed,
                messageIds: ["m1", "m2"], messageId: target
            )
        }
        XCTAssertEqual(step(), .scroll(index: 1))
        // 还在别的聊天、或消息还在读：等。
        XCTAssertEqual(step(active: "s2"), .wait)
        XCTAssertEqual(step(active: nil), .wait)
        XCTAssertEqual(step(loading: true), .wait)
        // 读取失败或消息已不存在：和平常一样停在最底部。
        XCTAssertEqual(step(failed: true), .notFound)
        XCTAssertEqual(step(target: "gone"), .notFound)
    }

    func testScrollDeltaCentersTheMessage() {
        XCTAssertEqual(revealScrollDelta(viewportStart: 0, viewportEnd: 800, itemOffset: 900, itemSize: 100), 550)
        XCTAssertEqual(revealScrollDelta(viewportStart: 0, viewportEnd: 800, itemOffset: 350, itemSize: 100), 0)
        XCTAssertEqual(revealScrollDelta(viewportStart: 0, viewportEnd: 800, itemOffset: -200, itemSize: 100), -550)
    }
}
