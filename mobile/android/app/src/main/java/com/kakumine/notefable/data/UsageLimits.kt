package com.kakumine.notefable.data

import kotlinx.serialization.Serializable

/**
 * 每日上限（`src/lib/usage-plans.ts` 的 USAGE_LIMITS）和文件存储上限（STORAGE_LIMITS，字节）。安装包里的
 * `assets/usage-limits.json` 由 `scripts/gen-native-usage-limits.ts` 生成，不手改。登录提示（GuestLimitPrompt）和网页一样显示 member 的数值。
 */
@Serializable
data class UsageLimit(val chat: Int, val image: Int, val storage: Long = 0)

@Serializable
data class UsageLimits(val guest: UsageLimit, val member: UsageLimit, val pro: UsageLimit) {
    companion object {
        fun parse(json: String): UsageLimits = NoteFableJson.decodeFromString(json)
    }
}
