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

    func testRowsNeverMoveBetweenTheStacks() {
        // 发送新回合、再发一个：上一个回合留在下面，不搬进懒加载栈。
        XCTAssertEqual(historyCount(after: [q1, a1, q2, a2, q3, a3]), 2)
        // 回答结束后对账换了 ID、沿用 key。
        var saved = a2
        saved.id = "server-a2"
        XCTAssertEqual(historyCount(after: [q1, a1, q2, saved]), 2)
    }

    func testReplacedRowsGoBelowTheLazyStack() {
        // 重新生成最后的回答。
        XCTAssertEqual(historyCount(after: [q1, a1, q2, UiMessage("a4", .assistant, "")]), 2)
        // 重新生成更早的回答：它的提问留在懒加载栈里。
        XCTAssertEqual(historyCount(after: [q1, UiMessage("a4", .assistant, "")]), 1)
        // 改写更早的提问。
        XCTAssertEqual(historyCount(after: [UiMessage("q4", .user, "Edited"), a3]), 0)
        // 发送失败退回原样。
        XCTAssertEqual(historyCount(after: [q1, a1, q2, a2]), 2)
        XCTAssertEqual(historyCount(after: []), 0)
    }

    func testNewChatStaysBelowTheLazyStack() {
        let split = ChatTailSplit()
        XCTAssertEqual(split.historyCount([q3, a3]), 0)
        XCTAssertEqual(split.historyCount([q3, a3, q2, a2]), 0)
    }

    func testListWithoutAQuestionIsNotLazy() {
        XCTAssertEqual(ChatTailSplit().historyCount([a1]), 0)
    }
}
