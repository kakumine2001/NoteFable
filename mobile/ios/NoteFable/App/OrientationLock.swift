import SwiftUI
import UIKit

/// 界面方向：平时只竖屏，幻灯片放映中只横屏（左右都可）。Info.plist 声明了横屏，实际允许哪些由这里决定
/// （`AppDelegate.application(_:supportedInterfaceOrientationsFor:)`）。
@MainActor
enum OrientationLock {
    private(set) static var mask: UIInterfaceOrientationMask = .portrait

    /// 放映开始 / 结束时调用：换允许的方向，并请系统马上转过去（iOS 16+ 的 requestGeometryUpdate）。
    static func set(landscape: Bool) {
        mask = landscape ? .landscape : .portrait
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
        }
    }
}

/// 只用来告诉系统现在允许的方向（App 本身是 SwiftUI 的 App）。
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        OrientationLock.mask
    }
}
