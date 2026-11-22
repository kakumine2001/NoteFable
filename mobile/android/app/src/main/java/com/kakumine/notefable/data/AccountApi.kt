package com.kakumine.notefable.data

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * 个人资料的一次编辑（网页 user-profile.ts 的 ProfileEdit，与 `PATCH /api/account` 同形）。
 * 只发 set 为 true 的项；值为 null 表示恢复为 Google 的名字 / 照片。
 */
data class ProfileEdit(
    val setDisplayName: Boolean = false,
    val displayName: String? = null,
    val setIcon: Boolean = false,
    val icon: String? = null,
    /** Only setLocale writes locale; a null value explicitly restores Auto. */
    val setLocale: Boolean = false,
    val locale: String? = null,
) {
    companion object {
        fun name(value: String?) = ProfileEdit(setDisplayName = true, displayName = value)
        fun icon(value: String?) = ProfileEdit(setIcon = true, icon = value)
        fun locale(value: String?) = ProfileEdit(setLocale = true, locale = value)
        val ResetToGoogle = ProfileEdit(setDisplayName = true, displayName = null, setIcon = true, icon = null)
    }
}

/** 不等服务端回复就显示的编辑结果（网页 applyProfileEdit）：选表情或恢复时，上传的照片也一起去掉，和服务端规则相同。 */
fun applyProfileEdit(user: AccountUser, edit: ProfileEdit): AccountUser {
    val displayName = if (edit.setDisplayName) edit.displayName else user.displayName
    val icon = if (edit.setIcon) edit.icon else user.icon
    val avatarUrl = if (edit.setIcon) null else user.avatarUrl
    val locale = if (edit.setLocale) edit.locale else user.locale
    return user.copy(displayName = displayName, icon = icon, avatarUrl = avatarUrl, locale = locale, name = displayName ?: user.googleName)
}

/** 已经是这个状态就不发（网页 profileEditChanges，例如回车后又失焦的重复保存）。 */
fun profileEditChanges(user: AccountUser, edit: ProfileEdit): Boolean = applyProfileEdit(user, edit) != user

/** 服务端给了原因时的那句英文原句；只有 "HTTP <状态码>"（没有错误 JSON）时返回 null。 */
fun ApiException.serverMessage(): String? = message?.takeIf { it.isNotBlank() && it != "HTTP $status" }

/** 个人资料的保存与头像上传（网页 account-store.ts 的 sendPatch / sendPhoto）。拆成接口便于单元测试。 */
interface AccountProfileBackend {
    /** `PATCH /api/account`，返回服务端确认后的资料。 */
    suspend fun updateProfile(edit: ProfileEdit): AccountUser

    /** `POST /api/account/avatar`（multipart，唯一的字段 `file`），返回换好照片后的资料。 */
    suspend fun uploadAvatar(bytes: ByteArray, mimeType: String): AccountUser

    /** `GET /api/custom-instructions`：登录用户的自定义指令，没有设置时为 null。 */
    suspend fun customInstructions(): String?

    /** `PUT /api/custom-instructions`：整体替换（空字符串是清空），返回服务端保存后的文字。 */
    suspend fun saveCustomInstructions(instructions: String): String?

    /** `GET /api/billing`：当前方案和本期用量（设置里的“方案”）。 */
    suspend fun plan(): PlanInfo = throw UnsupportedOperationException()

    /** `POST /api/billing/google`：报告 Play 的购买令牌，服务端核对后开通 Pro。 */
    suspend fun claimPlayPurchase(purchaseToken: String): PlayClaim = throw UnsupportedOperationException()
}

class AccountApi internal constructor(private val http: NoteFableHttp) : AccountProfileBackend, AppIconBackend {
    override suspend fun updateProfile(edit: ProfileEdit): AccountUser {
        val body = buildJsonObject {
            if (edit.setDisplayName) put("displayName", edit.displayName?.let(::JsonPrimitive) ?: JsonNull)
            if (edit.setIcon) put("icon", edit.icon?.let(::JsonPrimitive) ?: JsonNull)
            if (edit.setLocale) put("locale", edit.locale?.let(::JsonPrimitive) ?: JsonNull)
        }.toString()
        val response = http.send<ProfileResponse>(
            Request.Builder().url(http.absoluteUrl("/api/account")).patch(body.toRequestBody(NoteFableHttp.JSON)),
        )
        // 网页：没有 user 也算失败（"Could not save."）。
        return response.user ?: throw ApiException(200, "HTTP 200")
    }

    override suspend fun uploadAvatar(bytes: ByteArray, mimeType: String): AccountUser {
        // 和网页 FormData.append("file", blob, "avatar") 一样：文件名 avatar，类型是切出来的图片的类型（服务端按内容判断）。
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", "avatar", bytes.toRequestBody(mimeType.toMediaType()))
            .build()
        val response = http.send<ProfileResponse>(
            Request.Builder().url(http.absoluteUrl("/api/account/avatar")).post(body),
            with = http.uploadClient,
        )
        return response.user ?: throw ApiException(201, "HTTP 201")
    }

    override suspend fun plan(): PlanInfo = http.getJson<PlanInfo>("/api/billing")

    override suspend fun claimPlayPurchase(purchaseToken: String): PlayClaim {
        val body = buildJsonObject { put("purchaseToken", JsonPrimitive(purchaseToken)) }.toString()
        val response = http.send<PlayClaimResponse>(
            Request.Builder().url(http.absoluteUrl("/api/billing/google")).post(body.toRequestBody(NoteFableHttp.JSON)),
        )
        return if (response.pending || response.plan != "pro") PlayClaim.Pending else PlayClaim.Subscribed
    }

    override suspend fun accountAppIcon(): AppIconResponse = http.getJson<AppIconResponse>("/api/app-icon")

    override suspend fun saveAccountAppIcon(icon: String?): AppIconResponse {
        val body = buildJsonObject { put("icon", icon?.let(::JsonPrimitive) ?: JsonNull) }.toString()
        return http.send<AppIconResponse>(
            Request.Builder().url(http.absoluteUrl("/api/app-icon")).put(body.toRequestBody(NoteFableHttp.JSON)),
        )
    }

    override suspend fun customInstructions(): String? =
        http.getJson<CustomInstructionsResponse>("/api/custom-instructions").instructions

    override suspend fun saveCustomInstructions(instructions: String): String? {
        val body = buildJsonObject { put("instructions", JsonPrimitive(instructions)) }.toString()
        return http.send<CustomInstructionsResponse>(
            Request.Builder().url(http.absoluteUrl("/api/custom-instructions")).put(body.toRequestBody(NoteFableHttp.JSON)),
        ).instructions
    }
}
