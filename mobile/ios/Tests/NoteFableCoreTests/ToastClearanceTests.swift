import Foundation
import XCTest
@testable import NoteFableCore

/// 提示条离宿主底边的距离（`toastBottomClearance`）：键盘优先、标签栏隐藏时贴底、没量到时沿用 84、量到时躲开遮挡。
final class ToastClearanceTests: XCTestCase {
    func testKeyboardWinsOverEverythingElse() {
        XCTAssertEqual(
            toastBottomClearance(keyboardInset: 300, tabBarVisible: true, obstructionFromScreenBottom: 180, hostBottomGap: 0),
            312
        )
        XCTAssertEqual(
            toastBottomClearance(keyboardInset: 300, tabBarVisible: false, obstructionFromScreenBottom: nil, hostBottomGap: 20),
            312
        )
    }

    func testHiddenTabBarSitsSixteenAboveTheBottom() {
        XCTAssertEqual(
            toastBottomClearance(keyboardInset: 0, tabBarVisible: false, obstructionFromScreenBottom: 180, hostBottomGap: 0),
            16
        )
        XCTAssertEqual(
            toastBottomClearance(keyboardInset: 0, tabBarVisible: false, obstructionFromScreenBottom: nil, hostBottomGap: 0),
            16
        )
    }

    func testTabWithoutAReportKeepsTheLegacyClearance() {
        XCTAssertEqual(
            toastBottomClearance(keyboardInset: 0, tabBarVisible: true, obstructionFromScreenBottom: nil, hostBottomGap: 0),
            84
        )
        XCTAssertEqual(
            toastBottomClearance(keyboardInset: 0, tabBarVisible: true, obstructionFromScreenBottom: nil, hostBottomGap: 30),
            84
        )
    }

    func testMeasuredObstructionClearsTheChromeByEight() {
        // 标签栏 + 输入框从屏幕底边盖住 180，宿主盖满屏幕。
        XCTAssertEqual(
            toastBottomClearance(keyboardInset: 0, tabBarVisible: true, obstructionFromScreenBottom: 180, hostBottomGap: 0),
            188
        )
        // 宿主底边离屏幕底边 34 时，从宿主底边算起少 34。
        XCTAssertEqual(
            toastBottomClearance(keyboardInset: 0, tabBarVisible: true, obstructionFromScreenBottom: 180, hostBottomGap: 34),
            154
        )
    }

    func testResultIsClampedAtSixteen() {
        XCTAssertEqual(
            toastBottomClearance(keyboardInset: 0, tabBarVisible: true, obstructionFromScreenBottom: 20, hostBottomGap: 34),
            16
        )
        XCTAssertEqual(
            toastBottomClearance(keyboardInset: 0, tabBarVisible: true, obstructionFromScreenBottom: 0, hostBottomGap: 0),
            16
        )
    }
}
