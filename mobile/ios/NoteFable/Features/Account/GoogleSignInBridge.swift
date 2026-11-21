import Foundation
import GoogleSignIn
import UIKit

/// 把 GoogleSignIn SDK 接到 `AppEnvironment` 上（Android 的 auth/GoogleIdToken.kt）。Core 不依赖这个 SDK，
/// 所以取令牌、清掉本机记住的账号都由这里填进去。
///
/// 和 Android 一样：令牌的受众（serverClientID）是服务端给的 Web 客户端 ID；iOS 客户端 ID 只用来在 Google Cloud 里登记
/// "这个 bundle id 可以调用登录"。安装包没配 iOS 客户端 ID 时什么都不做，登录窗口只有邮箱验证码。
enum GoogleSignInBridge {
    /// App 启动时调一次。
    @MainActor
    static func install(into app: AppEnvironment) {
        guard let iosClientId = app.config.googleIOSClientId else { return }

        app.requestGoogleIdToken = { clientId, nonce in
            guard let presenter = topViewController() else { throw GoogleSignInBridgeError.noPresenter }
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: iosClientId, serverClientID: clientId)
            return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String?, Error>) in
                GIDSignIn.sharedInstance.signIn(
                    withPresenting: presenter, hint: nil, additionalScopes: nil, nonce: nonce
                ) { result, error in
                    if let error {
                        // 用户关掉了账号选择框：不算失败。
                        if let signInError = error as? GIDSignInError, signInError.code == .canceled {
                            continuation.resume(returning: nil)
                        } else {
                            continuation.resume(throwing: error)
                        }
                        return
                    }
                    guard let token = result?.user.idToken?.tokenString else {
                        continuation.resume(throwing: GoogleSignInBridgeError.noIdToken)
                        return
                    }
                    continuation.resume(returning: token)
                }
            }
        }

        // 退出时也清掉 SDK 记住的账号，下次登录会重新出现账号选择框（Android 的 clearGoogleCredentialState）。
        app.clearGoogleSignIn = {
            GIDSignIn.sharedInstance.signOut()
        }
    }

    /// 系统把登录回调的网址交回来时调用（`onOpenURL`）。不是 Google 登录的回调返回 false。
    static func handle(_ url: URL) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }

    /// 最上面的那个视图控制器：账号选择框从它上面弹出来。
    @MainActor
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

enum GoogleSignInBridgeError: Error {
    /// 找不到能弹出账号选择框的窗口。
    case noPresenter
    /// 登录成功但没有拿到 ID 令牌。
    case noIdToken
}
