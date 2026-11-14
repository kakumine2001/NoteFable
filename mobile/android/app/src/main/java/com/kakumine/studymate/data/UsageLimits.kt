package com.kakumine.studymate.data

import kotlinx.serialization.Serializable

/**
 * 每日上限（`src/lib/usage-plans.ts` 的 USAGE_LIMITS）。安装包里的 `assets/usage-limits.json` 由
 * `scripts/gen-native-usage-limits.ts` 生成，不手改。登录提示（GuestLimitPrompt）和网页一样显示 member 的数值。
 */
@Serializable
data class UsageLimit(val chat: Int, val image: Int)

@Serializable
data class UsageLimits(val guest: UsageLimit, val member: UsageLimit, val pro: UsageLimit) {
    companion object {
        fun parse(json: String): UsageLimits = StudyMateJson.decodeFromString(json)
    }
}
