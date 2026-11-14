package com.kakumine.studymate.auth

import android.app.Activity
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * 弹出系统的 Google 账号选择框，拿到带 nonce 的 ID 令牌。
 * 和 Capacitor 外壳一样：受众（serverClientId）是网站的 Web 客户端 ID，不是 Android 客户端 ID；
 * Android 客户端只用来在 Google Cloud 里登记"这个包名 + 签名可以调用登录"。
 *
 * 返回 null 表示用户关掉了选择框；其它失败抛异常。
 */
suspend fun requestGoogleIdToken(activity: Activity, webClientId: String, nonce: String): String? {
    // "使用 Google 登录"按钮对应的选项：没有已授权账号时也能选账号或添加账号。
    val option = GetSignInWithGoogleOption.Builder(webClientId).setNonce(nonce).build()
    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
    val result = try {
        CredentialManager.create(activity).getCredential(activity, request)
    } catch (_: GetCredentialCancellationException) {
        return null
    }
    val credential = result.credential
    if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
        return GoogleIdTokenCredential.createFrom(credential.data).idToken
    }
    error("Unexpected credential type: ${credential.type}")
}

/** 退出时也清掉系统里记住的选择，下次登录会重新出现账号选择框（对应网页的 signOutOfNativeGoogle）。 */
suspend fun clearGoogleCredentialState(activity: Activity) {
    runCatching { CredentialManager.create(activity).clearCredentialState(ClearCredentialStateRequest()) }
}
