import Foundation

/// 账号相关的服务端能力（Google 登录、读取资料、退出）。改资料和头像在 AccountApi（AccountProfileBackend）。拆成协议便于单元测试。
protocol AccountBackend {
    func account() async throws -> AccountResponse
    func appleSignInNonce() async throws -> String
    func appleSignIn(code: String, name: String?) async throws

    /// 第一步：向服务端要一次性 nonce（服务端同时写入签名 Cookie）。
    func nativeSignInNonce() async throws -> String

    /// 第二步：把 Google 的 ID 令牌交给服务端校验，成功后 Cookie 里就有登录会话。
    func nativeSignIn(idToken: String) async throws

    /// 邮箱登录第一步：`POST /api/auth/email/start`，往邮箱发 6 位验证码。[locale] 是界面语言（邮件用它写）。
    func emailSignInStart(email: String, locale: String) async throws

    /// 邮箱登录第二步：`POST /api/auth/email/verify`，验证码对了 Cookie 里就有登录会话（和 Google 登录同一种）。
    func emailSignInVerify(email: String, code: String) async throws

    func signOut() async throws

    /// `DELETE /api/account`：永久删除登录中的账号和其中全部数据（网页设置的"删除账号"）。成功后本地的登录 Cookie 也删掉。
    func deleteAccount() async throws
}

extension AccountBackend {
    func appleSignInNonce() async throws -> String { throw UnsupportedOperationError() }
    func appleSignIn(code: String, name: String?) async throws { throw UnsupportedOperationError() }
}
