import Foundation
import XCTest

/// 文案 / 语言 / 检索 / 表情这几组测试共用的文件查找。
enum TextTestSupport {
    private static func existing(_ candidates: [URL?]) -> URL? {
        candidates.compactMap { $0 }.first { FileManager.default.fileExists(atPath: $0.path) }
    }

    /// `mobile/ios`（在容器里跑 core-check.sh 时源码是另拷的一份，这个目录就不是仓库里的那个）。
    private static let packageRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    /// `Tests/NoteFableCoreTests/Fixtures` 里的文件。
    static func fixture(_ name: String) throws -> Data {
        let url = existing([
            Bundle.module.resourceURL?.appendingPathComponent("Fixtures").appendingPathComponent(name),
            URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures").appendingPathComponent(name),
        ])
        return try Data(contentsOf: XCTUnwrap(url, "missing fixture \(name)"))
    }

    /// 和 Android 共用的打包资源（`mobile/android/app/src/main/assets`；App 直接从那里打包，不另存一份）。
    /// 只挂载了 `mobile/ios` 的容器里读不到，这时跳过；要在容器里跑，加上
    /// `-v <仓库>/mobile/android/app/src/main/assets:/android-assets:ro`。
    static func androidAsset(_ name: String) throws -> Data {
        let url = existing([
            ProcessInfo.processInfo.environment["NOTEFABLE_ANDROID_ASSETS"].map { URL(fileURLWithPath: $0).appendingPathComponent(name) },
            packageRoot.deletingLastPathComponent().appendingPathComponent("android/app/src/main/assets").appendingPathComponent(name),
            URL(fileURLWithPath: "/android-assets").appendingPathComponent(name),
        ])
        guard let url else { throw XCTSkip("\(name) is not reachable from here (shared with Android)") }
        return try Data(contentsOf: url)
    }

    /// 生成的 `NoteFable/Resources`（各语言的 lproj）。core-check.sh 把 `mobile/ios` 挂在 /src。
    static func generatedResources() throws -> URL {
        let url = existing([
            packageRoot.appendingPathComponent("NoteFable/Resources"),
            URL(fileURLWithPath: "/src/NoteFable/Resources"),
        ])
        guard let url, FileManager.default.fileExists(atPath: url.appendingPathComponent("en.lproj/Localizable.strings").path) else {
            throw XCTSkip("NoteFable/Resources/*.lproj is not reachable from here")
        }
        return url
    }

    /// 按 UTF-16 码元比较：Swift 的 String 相等是 Unicode 等价（"が" == "か" + 浊点），对照网页的结果时不能用它。
    static func assertSameUnits(_ actual: String, _ expected: String, _ message: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(Array(actual.utf16), Array(expected.utf16), "\(message()): \(actual.debugDescription) vs \(expected.debugDescription)", file: file, line: line)
    }
}
