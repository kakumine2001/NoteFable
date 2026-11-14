package com.kakumine.studymate.data

/** 账号相关的服务端能力（Google 登录、读取资料、退出）。改资料和头像在 AccountApi（AccountProfileBackend）。拆成接口便于单元测试。 */
interface AccountBackend {
    suspend fun account(): AccountResponse

    /** 第一步：向服务端要一次性 nonce（服务端同时写入签名 Cookie）。 */
    suspend fun nativeSignInNonce(): String

    /** 第二步：把 Google 的 ID 令牌交给服务端校验，成功后 Cookie 里就有登录会话。 */
    suspend fun nativeSignIn(idToken: String)

    suspend fun signOut()
}
