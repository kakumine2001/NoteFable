import XCTest
@testable import NoteFableCore

final class UsageLimitsTests: XCTestCase {
    func testParsesTheGeneratedFormat() throws {
        let limits = try UsageLimits.parse(#"{"guest":{"chat":20,"image":10},"member":{"chat":40,"image":20},"pro":{"chat":2000,"image":60},"future":1}"#)
        XCTAssertEqual(limits.guest, UsageLimit(chat: 20, image: 10))
        XCTAssertEqual(limits.member, UsageLimit(chat: 40, image: 20))
        XCTAssertEqual(limits.pro, UsageLimit(chat: 2000, image: 60))
    }

    func testRejectsMissingPlansAndOtherJson() {
        XCTAssertThrowsError(try UsageLimits.parse(#"{"guest":{"chat":20,"image":10},"member":{"chat":40,"image":20}}"#))
        XCTAssertThrowsError(try UsageLimits.parse(#"{"guest":{"chat":"20","image":10},"member":{"chat":40,"image":20},"pro":{"chat":1,"image":1}}"#))
        XCTAssertThrowsError(try UsageLimits.parse("[]"))
    }

    func testTheBundledAssetHasEveryPlan() throws {
        let limits = try UsageLimits.parse(TextTestSupport.androidAsset("usage-limits.json"))
        for plan in [limits.guest, limits.member, limits.pro] {
            XCTAssertGreaterThan(plan.chat, 0)
            XCTAssertGreaterThan(plan.image, 0)
        }
        // 登录提示里显示的是 member 的数值，比访客多。
        XCTAssertGreaterThan(limits.member.chat, limits.guest.chat)
    }
}
