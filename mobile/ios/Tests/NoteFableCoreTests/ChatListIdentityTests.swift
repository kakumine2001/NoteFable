import XCTest
@testable import NoteFableCore

/// 消息列表视图身份里"有行换掉"的规则（`ChatUiState.noteReplacedRows`）。
final class ChatListIdentityTests: XCTestCase {
    private let question = UiMessage("q1", .user, "Question")
    private let answer = UiMessage("a1", .assistant, "Answer")

    private func replacedRowsId(after next: [UiMessage]) -> Int {
        var state = ChatUiState()
        state.messages = [question, answer]
        state.noteReplacedRows(next)
        return state.replacedRowsId
    }

    func testAppendingAndUpdatingInPlaceKeepTheIdentity() {
        var longer = answer
        longer.content = "Answer, still streaming"
        var saved = answer
        saved.id = "server-a1"

        XCTAssertEqual(replacedRowsId(after: [question, answer]), 0)
        XCTAssertEqual(replacedRowsId(after: [question, longer]), 0)
        XCTAssertEqual(replacedRowsId(after: [question, saved]), 0)
        XCTAssertEqual(replacedRowsId(after: [question, answer, UiMessage("q2", .user, "More")]), 0)
    }

    func testRemovingOrReplacingARowChangesTheIdentity() {
        XCTAssertEqual(replacedRowsId(after: [question, UiMessage("a2", .assistant, "")]), 1)
        XCTAssertEqual(replacedRowsId(after: [question]), 1)
        XCTAssertEqual(replacedRowsId(after: []), 1)
    }
}
