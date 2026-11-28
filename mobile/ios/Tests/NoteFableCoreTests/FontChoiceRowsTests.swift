import XCTest
@testable import NoteFableCore

final class FontChoiceRowsTests: XCTestCase {
    func testShortNamesShareOneRow() {
        XCTAssertEqual(fontChoiceRows(available: 218, gap: 4, mins: [40, 30, 50]), [[70, 70, 70]])
    }

    func testWiderNameTakesItsWidthAndTheOthersShareTheRest() {
        XCTAssertEqual(fontChoiceRows(available: 218, gap: 4, mins: [40, 90, 50]), [[60, 90, 60]])
    }

    /// 俄语：「умолчанию｜засечками｜Моноширинный」放不进一行，第三个占第二行。
    func testNamesThatDoNotFitMoveToTheNextRow() {
        XCTAssertEqual(fontChoiceRows(available: 230, gap: 4, mins: [78, 76, 95]), [[113, 113], [230]])
    }

    func testWordWiderThanTheRowTakesTheWholeRow() {
        XCTAssertEqual(fontChoiceRows(available: 100, gap: 4, mins: [60, 140]), [[100], [100]])
        XCTAssertEqual(fontChoiceRows(available: 100, gap: 4, mins: []), [])
    }
}
