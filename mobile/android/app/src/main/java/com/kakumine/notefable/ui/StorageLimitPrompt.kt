package com.kakumine.notefable.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.UsageLimit
import com.kakumine.notefable.data.UsageLimits
import com.kakumine.notefable.data.formatStorageSize

/** 文件存储空间不够、新的上传被拒绝（413 storage_limit）时的档位和用量（字节）。 */
data class StorageLimitInfo(val tier: String, val used: Long, val limit: Long)

/** 笔记编辑器里的 AI 面板或幻灯片生图撞到使用次数上限（429 usage_limit）时的档位和类别（chat / image）。 */
data class UsageLimitInfo(val tier: String, val kind: String)

/** 413 storage_limit 时的提示信息；别的错误是 null。 */
fun Throwable.storageLimitInfo(): StorageLimitInfo? =
    (this as? ApiException)?.takeIf { it.isStorageLimit }?.let { StorageLimitInfo(it.tier ?: "guest", it.used ?: 0, it.limit ?: 0) }

/**
 * 网页 StorageLimitPrompt：上传附件、生成图片或在笔记里放图片 / 文件时，因为文件存储空间不够被拒绝的提示。
 * 外框和动画沿用 [GuestLimitPrompt]。总是说明原因和用量；未登录且服务端开了登录时给登录按钮，
 * 免费用户在 App 里买得了 Pro 时给购买按钮（[UpgradeLimitPrompt]），其他情况（Pro、买不了）只说明原因、不放按钮。
 */
@Composable
fun StorageLimitPrompt(
    limit: StorageLimitInfo,
    account: AccountUiState,
    attachmentsLost: Boolean,
    onSignIn: () -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val locale = uiLocale()
    val memberLimit = remember {
        runCatching { context.assets.open("usage-limits.json").use { UsageLimits.parse(it.readBytes().decodeToString()) }.member }
            .getOrDefault(UsageLimit(0, 0))
    }.storage
    val used = stringResource(R.string.storage_limit_used, formatStorageSize(limit.used, locale), formatStorageSize(limit.limit, locale))
    val delete = stringResource(R.string.storage_limit_delete)
    val reasonOnly: @Composable () -> Unit = {
        GuestLimitPrompt(
            kind = "chat", attachmentsLost = false, onSignIn = {}, onClose = onClose,
            title = stringResource(R.string.storage_limit_title), body = used, note = delete,
            icon = Lucide.HardDrive, showActions = false,
        )
    }
    when {
        limit.tier == "guest" && account.configured && account.user == null -> GuestLimitPrompt(
            kind = "chat",
            attachmentsLost = attachmentsLost,
            onSignIn = onSignIn,
            onClose = onClose,
            title = stringResource(R.string.storage_limit_title),
            body = listOfNotNull(used, memberLimit.takeIf { it > 0 }?.let { stringResource(R.string.storage_limit_sign_in, formatStorageSize(it, locale)) })
                .joinToString("\n"),
            note = listOfNotNull(delete, if (attachmentsLost) stringResource(R.string.guest_limit_attachments_lost) else null).joinToString("\n"),
            icon = Lucide.HardDrive,
        )
        limit.tier == "member" && account.user != null -> UpgradeLimitPrompt(kind = "chat", onClose = onClose, storage = limit, unavailable = reasonOnly)
        else -> reasonOnly()
    }
}
