import SwiftUI
import UIKit

/// iPhone 平时用竖屏，iPad 一般跟随窗口。幻灯片放映会请求横屏。实际允许的方向由这里决定
/// （`AppDelegate.application(_:supportedInterfaceOrientationsFor:)`）。
@MainActor
enum OrientationLock {
    private(set) static var presenting = false

    static func mask(for window: UIWindow?) -> UIInterfaceOrientationMask {
        if presenting { return .landscape }
        return window?.traitCollection.userInterfaceIdiom == .pad ? .all : .portrait
    }

    /// 放映开始 / 结束时调用：换允许的方向，并请系统马上转过去（iOS 16+ 的 requestGeometryUpdate）。
    static func set(landscape: Bool) {
        presenting = landscape
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            let window = scene.windows.first { $0.isKeyWindow } ?? scene.windows.first
            window?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask(for: window))) { _ in }
        }
    }
}

/// 只用来告诉系统现在允许的方向（App 本身是 SwiftUI 的 App）。
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        OrientationLock.mask(for: window)
    }
}
