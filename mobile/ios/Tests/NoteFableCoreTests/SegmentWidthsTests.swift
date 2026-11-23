import XCTest
@testable import NoteFableCore

/// Chat / Workspace 切换两键的宽度（Android SegmentWidthsTest）。
final class SegmentWidthsTests: XCTestCase {
    func testSplitsInHalfWhenBothNamesFit() {
        let widths = workspaceSegmentWidths(available: 218, first: 70, second: 100)
        XCTAssertEqual(widths.first, 109)
        XCTAssertEqual(widths.second, 109)
    }

    func testWiderNameTakesItsWidthAndTheOtherGetsTheRest() {
        // 日文「チャット｜ワークスペース」在抽屉里（14pt）：第二个比一半宽。
        let second = workspaceSegmentWidths(available: 218, first: 86, second: 128)
        XCTAssertEqual(second.first, 90)
        XCTAssertEqual(second.second, 128)
        let first = workspaceSegmentWidths(available: 218, first: 130, second: 60)
        XCTAssertEqual(first.first, 130)
        XCTAssertEqual(first.second, 88)
    }

    func testSharesByWidthWhenNeitherLayoutFits() {
        let widths = workspaceSegmentWidths(available: 200, first: 100, second: 300)
        XCTAssertEqual(widths.first, 50)
        XCTAssertEqual(widths.second, 150)
        let empty = workspaceSegmentWidths(available: 0, first: 10, second: 10)
        XCTAssertEqual(empty.first, 0)
        XCTAssertEqual(empty.second, 0)
    }
}
