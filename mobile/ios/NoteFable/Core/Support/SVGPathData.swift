import Foundation

/// SVG 路径数据（`<path d="…">`）解析后的一条绘图指令：坐标都是绝对值，曲线统一成三次贝塞尔。
/// 相对指令、H / V、平滑曲线 S / T、二次曲线 Q、椭圆弧 A 在解析时就换算掉，调用方只需要处理这四种。
enum SVGPathCommand: Equatable {
    case move(x: Double, y: Double)
    case line(x: Double, y: Double)
    case cubic(x1: Double, y1: Double, x2: Double, y2: Double, x: Double, y: Double)
    case close
}

/// SVG 路径数据的解析器。只依赖 Foundation，界面层的 `SVGPath`（DesignSystem）在它上面包一层生成 SwiftUI `Path`。
/// Android 端用的是 Compose 的 `PathParser`，网页是浏览器自己解析；这里按 SVG 规范实现同样的语法：
/// - 全部指令 `MmLlHhVvCcSsQqTtAaZz`，指令后参数可以重复（`M` 后面多出来的坐标对按 `L` 处理，`m` 后按 `l`）；
/// - 紧凑写法：`m5 12 7-7 7 7`（负号当分隔）、`.71.71`（第二个小数点开始新数字）、`1e-3`；
/// - 椭圆弧的两个标志位各占一个字符，后面可以不带分隔直接接数字（`a2 2 0 0 1-2 2`、`a1 1 0 011 1`）；
/// - 椭圆弧按规范附录 F.6 换成三次贝塞尔（每段不超过 90°）。
/// - `Z` 之后不写 `M` 接着画时，从子路径起点开始，输出里补一条 `move`，调用方不用自己记起点。
///
/// 用法：`SVGPathData.parse("m5 12 7-7 7 7")` → `[.move(5, 12), .line(12, 5), .line(19, 12)]`。
/// 数据写错时和浏览器一样：出错位置之前的指令照常返回，后面的丢掉（`isValid` 可以用来检查整条数据）。
enum SVGPathData {
    static func parse(_ data: String) -> [SVGPathCommand] {
        var parser = Parser(data)
        parser.run()
        return parser.commands
    }

    /// 整条数据都符合语法（没有在中途停下）。测试和生成脚本用它检查图标路径。
    static func isValid(_ data: String) -> Bool {
        var parser = Parser(data)
        parser.run()
        return !parser.failed
    }

    // MARK: - 解析

    private struct Parser {
        private let bytes: [UInt8]
        private var index = 0
        private(set) var commands: [SVGPathCommand] = []
        private(set) var failed = false

        // 当前点、子路径起点。
        private var x = 0.0
        private var y = 0.0
        private var startX = 0.0
        private var startY = 0.0
        /// 上一条是 `Z`：下一条绘图指令之前要补一条 move 回到子路径起点。
        private var needsMove = false
        /// 上一条三次曲线的第二个控制点（S 用）；上一条不是 C / S 时为 nil。
        private var lastCubicControl: (x: Double, y: Double)?
        /// 上一条二次曲线的控制点（T 用）；上一条不是 Q / T 时为 nil。
        private var lastQuadControl: (x: Double, y: Double)?

        init(_ data: String) {
            bytes = Array(data.utf8)
        }

        mutating func run() {
            var command: UInt8 = 0
            skipSeparators()
            while index < bytes.count {
                let byte = bytes[index]
                if Self.isCommand(byte) {
                    command = byte
                    index += 1
                } else if command == 0 || command == UInt8(ascii: "Z") || command == UInt8(ascii: "z") {
                    // 路径必须以指令开头；Z 后面不能直接跟数字。
                    failed = true
                    return
                }
                guard step(command) else {
                    failed = true
                    return
                }
                // M / m 后面多出来的坐标对是隐含的 L / l。
                if command == UInt8(ascii: "M") { command = UInt8(ascii: "L") }
                if command == UInt8(ascii: "m") { command = UInt8(ascii: "l") }
                skipSeparators()
            }
        }

        /// 读一条指令的一组参数并输出。参数不够或写错时返回 false。
        private mutating func step(_ command: UInt8) -> Bool {
            // 路径必须从 M / m 开始（浏览器遇到别的开头整条不画）。
            if commands.isEmpty, command != UInt8(ascii: "M"), command != UInt8(ascii: "m") { return false }
            let relative = command >= UInt8(ascii: "a")
            let baseX = relative ? x : 0
            let baseY = relative ? y : 0
            switch command {
            case UInt8(ascii: "M"), UInt8(ascii: "m"):
                guard let px = number(), let py = number() else { return false }
                moveTo(baseX + px, baseY + py)
            case UInt8(ascii: "L"), UInt8(ascii: "l"):
                guard let px = number(), let py = number() else { return false }
                lineTo(baseX + px, baseY + py)
            case UInt8(ascii: "H"), UInt8(ascii: "h"):
                guard let px = number() else { return false }
                lineTo(baseX + px, y)
            case UInt8(ascii: "V"), UInt8(ascii: "v"):
                guard let py = number() else { return false }
                lineTo(x, baseY + py)
            case UInt8(ascii: "C"), UInt8(ascii: "c"):
                guard let x1 = number(), let y1 = number(), let x2 = number(), let y2 = number(),
                      let px = number(), let py = number() else { return false }
                cubicTo(baseX + x1, baseY + y1, baseX + x2, baseY + y2, baseX + px, baseY + py)
            case UInt8(ascii: "S"), UInt8(ascii: "s"):
                guard let x2 = number(), let y2 = number(), let px = number(), let py = number() else { return false }
                // 第一个控制点是上一条曲线第二个控制点关于当前点的对称点；上一条不是曲线时就是当前点。
                let x1 = lastCubicControl.map { 2 * x - $0.x } ?? x
                let y1 = lastCubicControl.map { 2 * y - $0.y } ?? y
                cubicTo(x1, y1, baseX + x2, baseY + y2, baseX + px, baseY + py)
            case UInt8(ascii: "Q"), UInt8(ascii: "q"):
                guard let qx = number(), let qy = number(), let px = number(), let py = number() else { return false }
                quadTo(baseX + qx, baseY + qy, baseX + px, baseY + py)
            case UInt8(ascii: "T"), UInt8(ascii: "t"):
                guard let px = number(), let py = number() else { return false }
                let qx = lastQuadControl.map { 2 * x - $0.x } ?? x
                let qy = lastQuadControl.map { 2 * y - $0.y } ?? y
                quadTo(qx, qy, baseX + px, baseY + py)
            case UInt8(ascii: "A"), UInt8(ascii: "a"):
                guard let rx = number(), let ry = number(), let rotation = number(),
                      let largeArc = flag(), let sweep = flag(),
                      let px = number(), let py = number() else { return false }
                arcTo(rx, ry, rotation, largeArc, sweep, baseX + px, baseY + py)
            case UInt8(ascii: "Z"), UInt8(ascii: "z"):
                closePath()
            default:
                return false
            }
            return true
        }

        // MARK: 输出

        private mutating func moveTo(_ px: Double, _ py: Double) {
            commands.append(.move(x: px, y: py))
            x = px
            y = py
            startX = px
            startY = py
            needsMove = false
            lastCubicControl = nil
            lastQuadControl = nil
        }

        /// 画之前：`Z` 之后没有新的 M，就从子路径起点接着画。
        private mutating func beginSegment() {
            if needsMove {
                commands.append(.move(x: startX, y: startY))
                needsMove = false
            }
        }

        private mutating func lineTo(_ px: Double, _ py: Double) {
            beginSegment()
            commands.append(.line(x: px, y: py))
            x = px
            y = py
            lastCubicControl = nil
            lastQuadControl = nil
        }

        private mutating func cubicTo(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ px: Double, _ py: Double) {
            beginSegment()
            commands.append(.cubic(x1: x1, y1: y1, x2: x2, y2: y2, x: px, y: py))
            x = px
            y = py
            lastCubicControl = (x2, y2)
            lastQuadControl = nil
        }

        /// 二次曲线升成三次：两个控制点各取在端点到二次控制点的 2/3 处。
        private mutating func quadTo(_ qx: Double, _ qy: Double, _ px: Double, _ py: Double) {
            let x1 = x + 2.0 / 3.0 * (qx - x)
            let y1 = y + 2.0 / 3.0 * (qy - y)
            let x2 = px + 2.0 / 3.0 * (qx - px)
            let y2 = py + 2.0 / 3.0 * (qy - py)
            cubicTo(x1, y1, x2, y2, px, py)
            lastCubicControl = nil
            lastQuadControl = (qx, qy)
        }

        private mutating func closePath() {
            commands.append(.close)
            x = startX
            y = startY
            needsMove = true
            lastCubicControl = nil
            lastQuadControl = nil
        }

        /// 椭圆弧（端点参数）→ 圆心参数 → 每段不超过 90° 的三次贝塞尔。SVG 规范附录 F.6.5 / F.6.6。
        private mutating func arcTo(_ radiusX: Double, _ radiusY: Double, _ rotation: Double, _ largeArc: Bool, _ sweep: Bool,
                                    _ px: Double, _ py: Double) {
            // 起点和终点相同：规范要求整条弧省略。
            if px == x && py == y { return }
            var rx = abs(radiusX)
            var ry = abs(radiusY)
            // 半径为 0：退化成直线。
            if rx == 0 || ry == 0 {
                lineTo(px, py)
                return
            }
            let phi = rotation * .pi / 180
            let cosPhi = cos(phi)
            let sinPhi = sin(phi)
            // 第 1 步：把起点移到以两端点中点为原点、去掉旋转后的坐标系。
            let dx = (x - px) / 2
            let dy = (y - py) / 2
            let x1p = cosPhi * dx + sinPhi * dy
            let y1p = -sinPhi * dx + cosPhi * dy
            // 半径太小、够不着两端点时按比例放大（F.6.6）。
            let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
            if lambda > 1 {
                let scale = lambda.squareRoot()
                rx *= scale
                ry *= scale
            }
            // 第 2 步：圆心（变换后的坐标系里）。
            let rx2 = rx * rx
            let ry2 = ry * ry
            let denominator = rx2 * y1p * y1p + ry2 * x1p * x1p
            var factor = 0.0
            if denominator != 0 {
                factor = max(0, (rx2 * ry2 - denominator) / denominator).squareRoot()
            }
            if largeArc == sweep { factor = -factor }
            let cxp = factor * rx * y1p / ry
            let cyp = -factor * ry * x1p / rx
            // 第 3 步：圆心（原坐标系）。
            let cx = cosPhi * cxp - sinPhi * cyp + (x + px) / 2
            let cy = sinPhi * cxp + cosPhi * cyp + (y + py) / 2
            // 第 4 步：起始角和扫过的角度。
            let ux = (x1p - cxp) / rx
            let uy = (y1p - cyp) / ry
            let vx = (-x1p - cxp) / rx
            let vy = (-y1p - cyp) / ry
            let startAngle = atan2(uy, ux)
            var delta = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            if !sweep && delta > 0 { delta -= 2 * .pi }
            if sweep && delta < 0 { delta += 2 * .pi }
            // 每段不超过 90°；减一个很小的量，正好 90° / 180° 的弧不会因为浮点误差多切一段。
            let segments = max(1, Int((abs(delta) / (.pi / 2) - 1e-9).rounded(.up)))
            let step = delta / Double(segments)
            let handle = 4.0 / 3.0 * tan(step / 4)
            var angle = startAngle
            var fromX = x
            var fromY = y
            for segment in 0..<segments {
                let next = angle + step
                let cosA = cos(angle)
                let sinA = sin(angle)
                let cosB = cos(next)
                let sinB = sin(next)
                // 最后一段的终点直接用给定的端点，不让误差累积。
                let last = segment == segments - 1
                let toX = last ? px : cx + rx * cosPhi * cosB - ry * sinPhi * sinB
                let toY = last ? py : cy + rx * sinPhi * cosB + ry * cosPhi * sinB
                // 椭圆在两个角度处的切线方向。
                let d1x = -rx * cosPhi * sinA - ry * sinPhi * cosA
                let d1y = -rx * sinPhi * sinA + ry * cosPhi * cosA
                let d2x = -rx * cosPhi * sinB - ry * sinPhi * cosB
                let d2y = -rx * sinPhi * sinB + ry * cosPhi * cosB
                cubicTo(fromX + handle * d1x, fromY + handle * d1y, toX - handle * d2x, toY - handle * d2y, toX, toY)
                fromX = toX
                fromY = toY
                angle = next
            }
            // 弧不算 C / S，后面的 S 不拿它的控制点做对称。
            lastCubicControl = nil
        }

        // MARK: 词法

        private static func isCommand(_ byte: UInt8) -> Bool {
            switch byte {
            case UInt8(ascii: "M"), UInt8(ascii: "m"), UInt8(ascii: "L"), UInt8(ascii: "l"),
                 UInt8(ascii: "H"), UInt8(ascii: "h"), UInt8(ascii: "V"), UInt8(ascii: "v"),
                 UInt8(ascii: "C"), UInt8(ascii: "c"), UInt8(ascii: "S"), UInt8(ascii: "s"),
                 UInt8(ascii: "Q"), UInt8(ascii: "q"), UInt8(ascii: "T"), UInt8(ascii: "t"),
                 UInt8(ascii: "A"), UInt8(ascii: "a"), UInt8(ascii: "Z"), UInt8(ascii: "z"):
                return true
            default:
                return false
            }
        }

        private static func isDigit(_ byte: UInt8) -> Bool {
            byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "9")
        }

        /// 空白和逗号。
        private mutating func skipSeparators() {
            while index < bytes.count {
                switch bytes[index] {
                case 0x20, 0x09, 0x0A, 0x0C, 0x0D, UInt8(ascii: ","):
                    index += 1
                default:
                    return
                }
            }
        }

        /// 读一个数字：可选正负号、整数部分、小数部分、指数。读不到时返回 nil（位置不动）。
        private mutating func number() -> Double? {
            skipSeparators()
            let begin = index
            var cursor = index
            if cursor < bytes.count, bytes[cursor] == UInt8(ascii: "-") || bytes[cursor] == UInt8(ascii: "+") {
                cursor += 1
            }
            var digits = 0
            while cursor < bytes.count, Self.isDigit(bytes[cursor]) {
                cursor += 1
                digits += 1
            }
            if cursor < bytes.count, bytes[cursor] == UInt8(ascii: ".") {
                cursor += 1
                while cursor < bytes.count, Self.isDigit(bytes[cursor]) {
                    cursor += 1
                    digits += 1
                }
            }
            guard digits > 0 else { return nil }
            // 指数：e / E 后面必须有数字，否则 e 不属于这个数字（留给后面报错）。
            if cursor < bytes.count, bytes[cursor] == UInt8(ascii: "e") || bytes[cursor] == UInt8(ascii: "E") {
                var exponent = cursor + 1
                if exponent < bytes.count, bytes[exponent] == UInt8(ascii: "-") || bytes[exponent] == UInt8(ascii: "+") {
                    exponent += 1
                }
                if exponent < bytes.count, Self.isDigit(bytes[exponent]) {
                    while exponent < bytes.count, Self.isDigit(bytes[exponent]) {
                        exponent += 1
                    }
                    cursor = exponent
                }
            }
            guard let value = Double(String(decoding: bytes[begin..<cursor], as: UTF8.self)), value.isFinite else { return nil }
            index = cursor
            return value
        }

        /// 椭圆弧的标志位：只占一个字符（0 或 1），后面可以直接接下一个数字。
        private mutating func flag() -> Bool? {
            skipSeparators()
            guard index < bytes.count else { return nil }
            switch bytes[index] {
            case UInt8(ascii: "0"):
                index += 1
                return false
            case UInt8(ascii: "1"):
                index += 1
                return true
            default:
                return nil
            }
        }
    }
}
