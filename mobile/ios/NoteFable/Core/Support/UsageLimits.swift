import Foundation

/// 每日上限（`src/lib/usage-plans.ts` 的 USAGE_LIMITS）。安装包里的 `usage-limits.json` 由
/// `scripts/gen-native-usage-limits.ts` 生成（和 Android 共用同一个文件），不手改。
/// 登录提示（GuestLimitPrompt）和网页一样显示 member 的数值。
struct UsageLimit: Decodable, Equatable, Sendable {
    let chat: Int
    let image: Int
}

struct UsageLimits: Decodable, Equatable, Sendable {
    let guest: UsageLimit
    let member: UsageLimit
    let pro: UsageLimit

    /// 解析 `usage-limits.json`；缺字段或不是 JSON 时抛出。
    static func parse(_ data: Data) throws -> UsageLimits {
        try JSONDecoder().decode(UsageLimits.self, from: data)
    }

    static func parse(_ json: String) throws -> UsageLimits {
        try parse(Data(json.utf8))
    }
}
