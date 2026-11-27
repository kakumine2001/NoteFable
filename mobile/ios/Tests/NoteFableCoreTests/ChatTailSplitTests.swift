import XCTest
@testable import NoteFableCore

/// 消息列表分成懒加载的历史和下面几行的规则（`ChatTailSplit`）。
final class ChatTailSplitTests: XCTestCase {
    private let q1 = UiMessage("q1", .user, "First question")
    private let a1 = UiMessage("a1", .assistant, "First answer")
    private let q2 = UiMessage("q2", .user, "Second question")
    private let a2 = UiMessage("a2", .assistant, "Second answer")
    private let q3 = UiMessage("local-1", .user, "Third question")
    private let a3 = UiMessage("local-2", .assistant, "")

    /// 用打开时有两个回合的列表分好，再看换成 `next` 之后懒加载栈里有几条。
    private func historyCount(after next: [UiMessage]) -> Int {
        let split = ChatTailSplit()
        XCTAssertEqual(split.historyCount([q1, a1, q2, a2]), 2)
        return split.historyCount(next)
    }

    /// 编号在 `turns` 里的回合：q0 a0 q1 a1 …；`tag` 区分另一个版本的 key。
    private func thread(_ turns: Range<Int>, _ tag: String = "") -> [UiMessage] {
        turns.flatMap { [UiMessage("q\($0)\(tag)", .user, "Question"), UiMessage("a\($0)\(tag)", .assistant, "Answer")] }
    }

    func testRowsDoNotMoveWhenTurnsArriveOrAreReconciled() {
        // 发送新回合：上一个回合留在下面，不搬进懒加载栈。
        XCTAssertEqual(historyCount(after: [q1, a1, q2, a2, q3, a3]), 2)
        // 回答结束后对账换了 ID、沿用 key。
        var saved = a2
        saved.id = "server-a2"
        XCTAssertEqual(historyCount(after: [q1, a1, q2, saved]), 2)
    }

    func testVersionSwitchPutsEarlierNewRowsInTheLazyStack() {
        let split = ChatTailSplit()
        XCTAssertEqual(split.historyCount(thread(0..<30)), 58)
        // 切换第 2 个提问的版本：换上来的长对话里只有最后一个回合当场建。
        let other = thread(0..<1) + thread(1..<40, "b")
        XCTAssertEqual(split.historyCount(other), 78)
        XCTAssertEqual(split.historyCount(other), 78)
        // 切回去：画过的行回到原来那一段。
        XCTAssertEqual(split.historyCount(thread(0..<30)), 58)
    }

    func testEditingAQuestion() {
        // 改写更早的提问：新提问和回答是最后一个回合。
        XCTAssertEqual(historyCount(after: [q3, a3]), 0)
        XCTAssertEqual(historyCount(after: [q1, a1, q3, a3]), 2)
        // 改写失败退回原样：每行回到原来那一段。
        let split = ChatTailSplit()
        XCTAssertEqual(split.historyCount([q1, a1, q2, a2]), 2)
        XCTAssertEqual(split.historyCount([q3, a3]), 0)
        XCTAssertEqual(split.historyCount([q1, a1, q2, a2]), 2)
        XCTAssertEqual(split.historyCount([]), 0)
    }

    func testRegenerate() {
        // 最后的回答。
        XCTAssertEqual(historyCount(after: [q1, a1, q2, UiMessage("a4", .assistant, "")]), 2)
        // 更早的回答：它的提问留在懒加载栈里。
        XCTAssertEqual(historyCount(after: [q1, UiMessage("a4", .assistant, "")]), 1)
    }

    func testNewRowsAfterAPlainRowStayPlain() {
        let split = ChatTailSplit()
        XCTAssertEqual(split.historyCount(thread(0..<1)), 0)
        XCTAssertEqual(split.historyCount(thread(0..<2)), 0)
        XCTAssertEqual(split.historyCount(thread(0..<1) + thread(1..<4, "b")), 0)
    }

    func testNewChatGrowingMovesOnlyTheOldestRowsPastTheLimit() {
        let split = ChatTailSplit()
        XCTAssertEqual(split.historyCount([]), 0)
        var lazy = 0
        for turns in 1...30 {
            let messages = thread(0..<turns)
            let count = split.historyCount(messages)
            // 不超过上限时一行也不动；超过时只搬最早的，下面正好剩上限那么多。
            XCTAssertEqual(count, max(0, messages.count - ChatTailSplit.tailLimit))
            XCTAssertGreaterThanOrEqual(count, lazy)
            lazy = count
        }
        // 行变少（发送失败退回）时，搬进懒加载栈的行不搬回来。
        XCTAssertEqual(split.historyCount(thread(0..<29)), lazy)
    }

    func testTheLastTurnIsNeverMovedIntoTheLazyStack() {
        let answers = (0..<30).map { UiMessage("x\($0)", .assistant, "Answer") }
        XCTAssertEqual(ChatTailSplit().historyCount([q1, a1, q2] + answers), 2)
    }

    func testListWithoutAQuestionIsNotLazy() {
        XCTAssertEqual(ChatTailSplit().historyCount([a1]), 0)
    }
}
