// swift-tools-version: 5.10
// 只用来单独编译和测试 NoteFable/Core（不依赖 SwiftUI / UIKit 的那一层），macOS 和 Linux 都能跑：
//   swift build && swift test
// App 本身由 project.yml（XcodeGen）生成的 Xcode 工程构建，Core 的源码直接编进 App 模块，不经过这个包。
import PackageDescription

let package = Package(
    name: "NoteFableCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "NoteFableCore", targets: ["NoteFableCore"]),
    ],
    dependencies: [
        .package(url: "https://github.com/swiftlang/swift-markdown.git", .upToNextMinor(from: "0.7.3")),
    ],
    targets: [
        .target(
            name: "NoteFableCore",
            dependencies: [.product(name: "Markdown", package: "swift-markdown")],
            path: "NoteFable/Core"
        ),
        .testTarget(
            name: "NoteFableCoreTests",
            dependencies: ["NoteFableCore"],
            path: "Tests/NoteFableCoreTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
