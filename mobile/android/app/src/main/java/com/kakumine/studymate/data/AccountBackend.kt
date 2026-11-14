package com.kakumine.studymate.data

/** 账号相关的服务端能力（Google 登录、读取资料、退出）。改资料和头像在 AccountApi（AccountProfileBackend）。拆成接口便于单元测试。 */
interface AccountBackend {
    suspend fun account(): AccountResponse

    /** 第一步：向服务端要一次性 nonce（服务端同时写入签名 Cookie）。 */
    suspend fun nativeSignInNonce(): String

    /** 第二步：把 Google 的 ID 令牌交给服务端校验，成功后 Cookie 里就有登录会话。 */
    suspend fun nativeSignIn(idToken: String)

    /** 邮箱登录第一步：`POST /api/auth/email/start`，往邮箱发 6 位验证码。[locale] 是界面语言（邮件用它写）。 */
    suspend fun emailSignInStart(email: String, locale: String)

    /** 邮箱登录第二步：`POST /api/auth/email/verify`，验证码对了 Cookie 里就有登录会话（和 Google 登录同一种）。 */
    suspend fun emailSignInVerify(email: String, code: String)

    suspend fun signOut()
}
