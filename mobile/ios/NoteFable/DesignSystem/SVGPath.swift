import SwiftUI

/// SVG 路径数据 → SwiftUI `Path`。解析在 `Core/Support/SVGPathData.swift`（只依赖 Foundation，有单元测试），这里只把指令逐条画出来，
/// 并把结果缓存起来：同一个图标在列表里反复出现，路径只解析一次。
///
/// 用法：`SVGPath.path("m5 12 7-7 7 7")`（坐标就是数据里的坐标）；图标（多条路径）用 `SVGPath.icon(Lucide.menu)`。
enum SVGPath {
    private static let lock = NSLock()
    private static var paths: [String: Path] = [:]
    private static var icons: [[String]: Path] = [:]

    /// 一条路径数据。写错的数据和浏览器一样：出错位置之前的部分照常画。
    static func path(_ data: String) -> Path {
        lock.lock()
        let cached = paths[data]
        lock.unlock()
        if let cached { return cached }
        let built = build(SVGPathData.parse(data))
        lock.lock()
        paths[data] = built
        lock.unlock()
        return built
    }

    /// 一个图标的全部路径合成一条（各条是各自的子路径，一起描边）。
    static func icon(_ data: [String]) -> Path {
        lock.lock()
        let cached = icons[data]
        lock.unlock()
        if let cached { return cached }
        var combined = Path()
        for item in data {
            combined.addPath(path(item))
        }
        lock.lock()
        icons[data] = combined
        lock.unlock()
        return combined
    }

    /// 把解析好的指令画成 `Path`。
    static func build(_ commands: [SVGPathCommand]) -> Path {
        var path = Path()
        for command in commands {
            switch command {
            case let .move(x, y):
                path.move(to: CGPoint(x: x, y: y))
            case let .line(x, y):
                path.addLine(to: CGPoint(x: x, y: y))
            case let .cubic(x1, y1, x2, y2, x, y):
                path.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
            case .close:
                path.closeSubpath()
            }
        }
        return path
    }
}
