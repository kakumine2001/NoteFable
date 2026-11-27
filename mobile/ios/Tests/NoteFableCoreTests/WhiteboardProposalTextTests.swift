import XCTest
@testable import NoteFableCore

/// 用网页实现算出的用例（scripts/gen-native-whiteboard-proposal-cases.ts 生成的
/// Fixtures/whiteboard-proposal-cases.json，和 Android 的那份相同）核对白板提案说明的翻译。
final class WhiteboardProposalTextTests: XCTestCase {
    private struct Cases: Decodable {
        struct Target: Decodable {
            let type: String
            let number: Int?
            let count: Int?
            let name: String?
        }

        struct Change: Decodable {
            let op: String
            let block: Int
            let target: Target?
            let before: String?
            let after: String?
        }

        struct ChangeCase: Decodable {
            let input: Change
            let expected: Change
        }

        struct SummaryCase: Decodable {
            let input: String
            let expected: String
        }

        let keys: [String]
        let changes: [ChangeCase]
        let summaries: [SummaryCase]
    }

    private func loadCases() throws -> Cases {
        try JSONDecoder().decode(Cases.self, from: TextTestSupport.fixture("whiteboard-proposal-cases.json"))
    }

    private func change(_ value: Cases.Change) throws -> ProposalChange {
        let target: ProposalChangeTarget? = value.target.map { target in
            target.type == "slide" ? .slide(number: target.number ?? 0) : .elements(count: target.count ?? 0, name: target.name)
        }
        return ProposalChange(
            op: try XCTUnwrap(ProposalOp(rawValue: value.op)), block: value.block, target: target, before: value.before, after: value.after
        )
    }

    func testChangesAndSummariesAreTranslatedLikeTheWeb() throws {
        let cases = try loadCases()
        // 记号译文表：每一句包在 ‹› 里（和生成用例时一样）。
        let marked = SystemText(templates: [], messages: ["zh": Dictionary(uniqueKeysWithValues: cases.keys.map { ($0, "‹\($0)›") })])
            .translator("zh")
        XCTAssertGreaterThan(cases.changes.count, 40)
        for item in cases.changes {
            let input = try change(item.input)
            XCTAssertEqual(WhiteboardProposalText.change(input, marked), try change(item.expected), "\(input)")
        }
        for item in cases.summaries {
            TextTestSupport.assertSameUnits(WhiteboardProposalText.summary(item.input, marked), item.expected, item.input.debugDescription)
        }
    }
}
