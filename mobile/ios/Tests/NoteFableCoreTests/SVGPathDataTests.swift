import XCTest
@testable import NoteFableCore

/// SVG 路径数据解析（`SVGPathData`）。例子都取自 `Lucide.swift` 里实际用到的写法。
final class SVGPathDataTests: XCTestCase {
    /// 四分之一圆用三次贝塞尔逼近时控制柄的长度系数：4/3 · tan(π/8)。
    private let kappa = 0.5522847498307936

    // MARK: 紧凑的数字写法

    func testImplicitLineToAfterRelativeMoveTo() {
        // ArrowUp："m5 12 7-7 7 7"：m 后面多出来的坐标对是相对的 l，负号直接当分隔。
        assertCommands(SVGPathData.parse("m5 12 7-7 7 7"), [
            .move(x: 5, y: 12),
            .line(x: 12, y: 5),
            .line(x: 19, y: 12),
        ])
    }

    func testImplicitLineToAfterAbsoluteMoveTo() {
        // Check："M20 6 9 17l-5-5"：M 后面多出来的是绝对的 L。
        assertCommands(SVGPathData.parse("M20 6 9 17l-5-5"), [
            .move(x: 20, y: 6),
            .line(x: 9, y: 17),
            .line(x: 4, y: 12),
        ])
    }

    func testCompactDecimalsWithoutSeparators() {
        // ".71.71" 是两个数字 0.71、0.71；"-.5-.5" 是 −0.5、−0.5。
        assertCommands(SVGPathData.parse("M.71.71l-.5-.5 1.25.25"), [
            .move(x: 0.71, y: 0.71),
            .line(x: 0.21, y: 0.21),
            .line(x: 1.46, y: 0.46),
        ])
    }

    func testCommasWhitespaceAndExponents() {
        assertCommands(SVGPathData.parse(" M1e1,2E0\n\tL 1.5e-1 , +3. "), [
            .move(x: 10, y: 2),
            .line(x: 0.15, y: 3),
        ])
    }

    // MARK: 相对指令

    func testHorizontalAndVerticalLines() {
        // Menu 的一条线 "M4 5h16"；再加绝对 / 相对的 H V。
        assertCommands(SVGPathData.parse("M4 5h16v2H1V0"), [
            .move(x: 4, y: 5),
            .line(x: 20, y: 5),
            .line(x: 20, y: 7),
            .line(x: 1, y: 7),
            .line(x: 1, y: 0),
        ])
    }

    func testRelativeCubicUsesCurrentPointForAllThreePairs() {
        // Copy 的第二条："M4 16c-1.1 0-2-.9-2-2V4"。
        assertCommands(SVGPathData.parse("M4 16c-1.1 0-2-.9-2-2V4"), [
            .move(x: 4, y: 16),
            .cubic(x1: 2.9, y1: 16, x2: 2, y2: 15.1, x: 2, y: 14),
            .line(x: 2, y: 4),
        ])
    }

    func testImplicitRepeatOfRelativeCubic() {
        // 每一组的基准点是上一组的终点。
        assertCommands(SVGPathData.parse("M0 0c1 0 2 1 2 2 0 1 1 2 2 2"), [
            .move(x: 0, y: 0),
            .cubic(x1: 1, y1: 0, x2: 2, y2: 1, x: 2, y: 2),
            .cubic(x1: 2, y1: 3, x2: 3, y2: 4, x: 4, y: 4),
        ])
    }

    // MARK: 平滑曲线与二次曲线

    func testSmoothCubicReflectsPreviousControlPoint() {
        // Smile 的嘴："M8 14s1.5 2 4 2 4-2 4-2"。第一段前面没有曲线，第一个控制点就是当前点；
        // 第二段的第一个控制点是 (9.5, 16) 关于 (12, 16) 的对称点。
        assertCommands(SVGPathData.parse("M8 14s1.5 2 4 2 4-2 4-2"), [
            .move(x: 8, y: 14),
            .cubic(x1: 8, y1: 14, x2: 9.5, y2: 16, x: 12, y: 16),
            .cubic(x1: 14.5, y1: 16, x2: 16, y2: 14, x: 16, y: 14),
        ])
    }

    func testSmoothCubicAfterLineStartsAtCurrentPoint() {
        assertCommands(SVGPathData.parse("M0 0C0 5 5 10 10 10L20 10S30 20 40 20"), [
            .move(x: 0, y: 0),
            .cubic(x1: 0, y1: 5, x2: 5, y2: 10, x: 10, y: 10),
            .line(x: 20, y: 10),
            .cubic(x1: 20, y1: 10, x2: 30, y2: 20, x: 40, y: 20),
        ])
    }

    func testQuadraticAndSmoothQuadraticBecomeCubics() {
        assertCommands(SVGPathData.parse("M0 0Q10 0 10 10T20 20"), [
            .move(x: 0, y: 0),
            .cubic(x1: 20.0 / 3, y1: 0, x2: 10, y2: 10.0 / 3, x: 10, y: 10),
            // T 的控制点是 (10, 0) 关于 (10, 10) 的对称点 (10, 20)。
            .cubic(x1: 10, y1: 50.0 / 3, x2: 40.0 / 3, y2: 20, x: 20, y: 20),
        ])
        // 前面不是 Q / T 时，T 的控制点就是当前点，画出来是直线。
        assertCommands(SVGPathData.parse("M0 0t6 6"), [
            .move(x: 0, y: 0),
            .cubic(x1: 0, y1: 0, x2: 2, y2: 2, x: 6, y: 6),
        ])
    }

    // MARK: 椭圆弧

    func testArcFlagsFollowedDirectlyByNegativeNumber() {
        // ImagePlus："…V19a2 2 0 0 1-2 2H5"：标志位 0、1，后面的 "-2" 是终点的 x。
        // 圆心 (19, 19)，从 0° 顺时针（屏幕坐标 y 向下）到 90°，一段。
        assertCommands(SVGPathData.parse("M21 11.5V19a2 2 0 0 1-2 2H5"), [
            .move(x: 21, y: 11.5),
            .line(x: 21, y: 19),
            .cubic(x1: 21, y1: 19 + 2 * kappa, x2: 19 + 2 * kappa, y2: 21, x: 19, y: 21),
            .line(x: 5, y: 21),
        ])
    }

    func testArcFlagsWithoutAnySeparator() {
        // "011 1"：标志位各占一个字符，是 0、1，然后终点 (1, 1)。
        let compact = SVGPathData.parse("M0 0a1 1 0 011 1")
        assertCommands(compact, SVGPathData.parse("M0 0a1 1 0 0 1 1 1"))
        // 圆心 (0, 1)：从正上方顺时针到正右方。
        assertCommands(compact, [
            .move(x: 0, y: 0),
            .cubic(x1: kappa, y1: 0, x2: 1, y2: 1 - kappa, x: 1, y: 1),
        ])
        // "10.5.5"：标志位 1、0，终点 (0.5, 0.5)。
        XCTAssertEqual(lastPoint(SVGPathData.parse("M0 0a.5.5 0 10.5.5")), Point(x: 0.5, y: 0.5))
        XCTAssertTrue(SVGPathData.isValid("M0 0a.5.5 0 10.5.5"))
    }

    func testLargeArcSweepFlagsPickTheRightHalf() {
        // Globe 的外圈："M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0"：两个半圆，sweep = 0 是逆时针（屏幕上经过下方）。
        let radius = 10.0
        assertCommands(SVGPathData.parse("M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0"), [
            .move(x: 2, y: 12),
            .cubic(x1: 2, y1: 12 + radius * kappa, x2: 12 - radius * kappa, y2: 22, x: 12, y: 22),
            .cubic(x1: 12 + radius * kappa, y1: 22, x2: 22, y2: 12 + radius * kappa, x: 22, y: 12),
            .cubic(x1: 22, y1: 12 - radius * kappa, x2: 12 + radius * kappa, y2: 2, x: 12, y: 2),
            .cubic(x1: 12 - radius * kappa, y1: 2, x2: 2, y2: 12 - radius * kappa, x: 2, y: 12),
        ])
        // 同样的两端点，sweep = 1 走上方。
        assertCommands(SVGPathData.parse("M2 12a10 10 0 1 1 20 0"), [
            .move(x: 2, y: 12),
            .cubic(x1: 2, y1: 12 - radius * kappa, x2: 12 - radius * kappa, y2: 2, x: 12, y: 2),
            .cubic(x1: 12 + radius * kappa, y1: 2, x2: 22, y2: 12 - radius * kappa, x: 22, y: 12),
        ])
    }

    func testSmallArcVersusLargeArc() {
        // 从 (1, 0) 到 (0, 1)、半径 1：小弧是四分之一圆（一段），大弧是四分之三圆（三段）。
        XCTAssertEqual(SVGPathData.parse("M1 0A1 1 0 0 1 0 1").count, 2)
        let large = SVGPathData.parse("M1 0A1 1 0 1 1 0 1")
        XCTAssertEqual(large.count, 4)
        XCTAssertEqual(lastPoint(large), Point(x: 0, y: 1))
        // 大弧（sweep = 1）的圆心在 (1, 1)：经过 (2, 1) 和 (1, 2)。
        assertCommands(Array(large.prefix(3)), [
            .move(x: 1, y: 0),
            .cubic(x1: 1 + kappa, y1: 0, x2: 2, y2: 1 - kappa, x: 2, y: 1),
            .cubic(x1: 2, y1: 1 + kappa, x2: 1 + kappa, y2: 2, x: 1, y: 2),
        ])
    }

    func testArcRadiiAreScaledUpWhenTooSmall() {
        // 半径 1 够不着相距 4 的两点：按规范放大到 2，画成半圆。
        assertCommands(SVGPathData.parse("M0 0A1 1 0 0 1 4 0"), [
            .move(x: 0, y: 0),
            .cubic(x1: 0, y1: -2 * kappa, x2: 2 - 2 * kappa, y2: -2, x: 2, y: -2),
            .cubic(x1: 2 + 2 * kappa, y1: -2, x2: 4, y2: -2 * kappa, x: 4, y: 0),
        ])
    }

    func testRotatedEllipseArcEndsAtTheGivenPoint() {
        // 旋转过的椭圆：每一段的起点是上一段的终点，最后停在给定的终点上。
        let commands = SVGPathData.parse("M10 10a6 3 30 1 0 5 4")
        XCTAssertTrue(commands.count >= 3)
        XCTAssertEqual(lastPoint(commands), Point(x: 15, y: 14))
        XCTAssertTrue(SVGPathData.isValid("M10 10a6 3 30 1 0 5 4"))
    }

    func testDegenerateArcs() {
        // 半径为 0：直线。起点和终点相同：省略。
        assertCommands(SVGPathData.parse("M0 0A0 5 0 0 1 3 4"), [.move(x: 0, y: 0), .line(x: 3, y: 4)])
        assertCommands(SVGPathData.parse("M3 4a5 5 0 1 1 0 0L1 1"), [.move(x: 3, y: 4), .line(x: 1, y: 1)])
    }

    func testImplicitRepeatOfArcs() {
        // Globe 的经线："M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"：第二组参数不写指令字母。
        let commands = SVGPathData.parse("M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20")
        XCTAssertTrue(SVGPathData.isValid("M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"))
        XCTAssertEqual(lastPoint(commands), Point(x: 12, y: 2))
        // 半径 14.5 的小弧，弦长 20，不到 90°：每组一段。
        XCTAssertEqual(commands.count, 3)
        guard case let .cubic(_, _, _, _, x, y) = commands[1] else { return XCTFail("expected a cubic") }
        XCTAssertEqual(x, 12, accuracy: 1e-9)
        XCTAssertEqual(y, 22, accuracy: 1e-9)
    }

    // MARK: 闭合

    func testDrawingAfterCloseRestartsAtSubpathStart() {
        // Scale 的一条："m19 8 3 8a5 5 0 0 1-6 0zV7"：z 之后的 V 从子路径起点 (19, 8) 接着画。
        let commands = SVGPathData.parse("m19 8 3 8a5 5 0 0 1-6 0zV7")
        XCTAssertEqual(Array(commands.suffix(3)), [.close, .move(x: 19, y: 8), .line(x: 19, y: 7)])
        // z 之后的相对指令也以子路径起点为基准。
        assertCommands(SVGPathData.parse("M1 1h2v2zl-1-1"), [
            .move(x: 1, y: 1),
            .line(x: 3, y: 1),
            .line(x: 3, y: 3),
            .close,
            .move(x: 1, y: 1),
            .line(x: 0, y: 0),
        ])
        // z 后面跟新的 M 时不补 move。
        assertCommands(SVGPathData.parse("M1 1h2zM5 5h1Z"), [
            .move(x: 1, y: 1),
            .line(x: 3, y: 1),
            .close,
            .move(x: 5, y: 5),
            .line(x: 6, y: 5),
            .close,
        ])
    }

    // MARK: 写错的数据

    func testMalformedDataKeepsWhatWasParsedBeforeTheError() {
        XCTAssertEqual(SVGPathData.parse(""), [])
        XCTAssertTrue(SVGPathData.isValid(""))
        // 不以 M 开头：整条不画。
        XCTAssertEqual(SVGPathData.parse("L1 1"), [])
        XCTAssertFalse(SVGPathData.isValid("L1 1"))
        XCTAssertEqual(SVGPathData.parse("1 1"), [])
        // 参数不够：前面的照常返回。
        XCTAssertEqual(SVGPathData.parse("M1 2L3"), [.move(x: 1, y: 2)])
        XCTAssertFalse(SVGPathData.isValid("M1 2L3"))
        // 标志位只能是 0 或 1。
        XCTAssertEqual(SVGPathData.parse("M0 0a1 1 0 2 1 1 1"), [.move(x: 0, y: 0)])
        XCTAssertFalse(SVGPathData.isValid("M0 0a1 1 0 2 1 1 1"))
        // 不认识的字符。
        XCTAssertEqual(SVGPathData.parse("M0 0L1 1X2 2"), [.move(x: 0, y: 0), .line(x: 1, y: 1)])
        // Z 后面不能直接跟数字。
        XCTAssertFalse(SVGPathData.isValid("M0 0h1z1 1"))
    }

    func testRealIconPathsParseCompletely() {
        // 各种写法最密的几条（Paperclip、Settings、Pencil、MessageSquareText、Star 的开头）。
        let paths = [
            "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551",
            "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
            "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
            "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
            "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904",
        ]
        for path in paths {
            XCTAssertTrue(SVGPathData.isValid(path), path)
            XCTAssertFalse(SVGPathData.parse(path).isEmpty, path)
        }
        // Settings 的齿轮首尾相接：最后回到起点（数据只有三位小数，差在 0.01 以内）。
        let gear = lastPoint(SVGPathData.parse(paths[1]))
        XCTAssertEqual(gear.x, 9.671, accuracy: 0.01)
        XCTAssertEqual(gear.y, 4.136, accuracy: 0.01)
    }

    // MARK: 辅助

    private struct Point: Equatable {
        var x: Double
        var y: Double
    }

    /// 最后一条带坐标的指令的终点。
    private func lastPoint(_ commands: [SVGPathCommand]) -> Point {
        for command in commands.reversed() {
            switch command {
            case let .move(x, y), let .line(x, y): return Point(x: x, y: y)
            case let .cubic(_, _, _, _, x, y): return Point(x: x, y: y)
            case .close: continue
            }
        }
        return Point(x: .nan, y: .nan)
    }

    private func numbers(_ command: SVGPathCommand) -> (kind: String, values: [Double]) {
        switch command {
        case let .move(x, y): return ("move", [x, y])
        case let .line(x, y): return ("line", [x, y])
        case let .cubic(x1, y1, x2, y2, x, y): return ("cubic", [x1, y1, x2, y2, x, y])
        case .close: return ("close", [])
        }
    }

    private func assertCommands(_ actual: [SVGPathCommand], _ expected: [SVGPathCommand], accuracy: Double = 1e-9,
                                file: StaticString = #filePath, line: UInt = #line) {
        guard actual.count == expected.count else {
            return XCTFail("expected \(expected.count) commands, got \(actual.count): \(actual)", file: file, line: line)
        }
        for (index, pair) in zip(actual, expected).enumerated() {
            let (a, e) = (numbers(pair.0), numbers(pair.1))
            guard a.kind == e.kind else {
                return XCTFail("command \(index): expected \(pair.1), got \(pair.0)", file: file, line: line)
            }
            for (got, want) in zip(a.values, e.values) where abs(got - want) > accuracy {
                return XCTFail("command \(index): expected \(pair.1), got \(pair.0)", file: file, line: line)
            }
        }
    }
}
