import Foundation
import Observation

// 设置里"方案"卡片的内容规则（Android ui/PlanSettings.kt；网页 plan-settings.tsx）。
// App Store 的价格按店面由 StoreKit 提供，不能用网页的日元价格。

/// Pro 时徽章下面的那一行说明。日期是服务端的 ISO 时间。
enum PlanStatusLine: Equatable, Sendable {
    /// 扣款失败（plan_past_due）。
    case pastDue
    /// 已取消，到这天结束（plan_ends）。
    case ends(String)
    /// 免费试用到这天，之后每月多少日元（plan_trial_ends）。
    case trialEnds(String, priceJpy: Int)
    /// 这天续费（plan_renews）。
    case renews(String)
}

/// 一条用量：标签（文案键）、用了多少 / 上限。
struct PlanMeter: Equatable, Sendable, Identifiable {
    /// 在列表里的位置。
    var id: Int
    var labelKey: String
    var used: Int
    var limit: Int
    /// 右边显示的"用了 / 上限"（文件存储是"12 MB / 500 MB"）；nil 是数字原样。
    var text: String? = nil

    /// 进度条的比例（0…1）；没有上限数据时算满。
    var ratio: Double { limit > 0 ? min(max(Double(used) / Double(limit), 0), 1) : 1 }
    /// 用满了：进度条变橙色。
    var full: Bool { ratio >= 1 }
    var countText: String { text ?? "\(used) / \(limit)" }
}

extension PlanInfo {
    var isPro: Bool { plan == "pro" }
    /// 徽章上的字（plan_pro / plan_free）。
    var badgeKey: String { isPro ? "plan_pro" : "plan_free" }

    var statusLine: PlanStatusLine? {
        guard isPro, let subscription else { return nil }
        if subscription.status == "past_due" { return .pastDue }
        if let cancelAt = subscription.cancelAt { return .ends(cancelAt) }
        if provider != "apple", subscription.status == "trialing", let periodEnd = subscription.periodEnd {
            return .trialEnds(periodEnd, priceJpy: priceJpy)
        }
        if let periodEnd = subscription.periodEnd { return .renews(periodEnd) }
        return nil
    }

    /// 用量：消息、图片；图片除了月上限还有每日上限，今天的用量也列出来。
    /// 免费方案平时不显示“本月图片生成”，只显示今天的；撞到月上限时才显示满额条。Pro 两条都显示（Android PlanSettings.kt）。
    var meters: [PlanMeter] {
        var out: [PlanMeter] = []
        func add(_ key: String, _ used: Int, _ limit: Int) {
            out.append(PlanMeter(id: out.count, labelKey: key, used: used, limit: limit))
        }
        if let chat = usage["chat"] {
            add(chat.period == "day" ? "plan_messages_today" : isPro ? "plan_messages_period" : "plan_messages_month", chat.used, chat.limit)
        }
        if let image = usage["image"] {
            if isPro || image.daily == nil || image.used >= image.limit {
                add(image.period == "day" ? "plan_images_today" : isPro ? "plan_images_period" : "plan_images_month", image.used, image.limit)
            }
            if let daily = image.daily { add("plan_images_today", daily.used, daily.limit) }
        }
        // 文件存储（聊天的图片、生成的图片、笔记的文件和封面等）的用量。
        if let storage {
            let locale = Locale(identifier: AppLanguage.acceptLanguage(AppLanguage.uiLocale))
            out.append(PlanMeter(
                id: out.count, labelKey: "plan_storage", used: storage.used, limit: storage.limit,
                text: "\(formatStorageSize(storage.used, locale: locale)) / \(formatStorageSize(storage.limit, locale: locale))"
            ))
        }
        return out
    }
}

/// 网页 `toLocaleDateString(tag, { year: "numeric", month: "short", day: "numeric" })`，按界面语言。读不懂的日期是空字符串。
func planDate(_ iso: String, uiLocale: String = AppLanguage.uiLocale, timeZone: TimeZone = .current) -> String {
    guard let date = parseIsoInstant(iso) else { return "" }
    return formatDateTemplate(date, "yMMMd", locale: Locale(identifier: AppLanguage.acceptLanguage(uiLocale)), timeZone: timeZone)
}

/// 说明那一行的文字。
func planStatusText(_ line: PlanStatusLine, uiLocale: String = AppLanguage.uiLocale, timeZone: TimeZone = .current) -> String {
    switch line {
    case .pastDue: return L("plan_past_due")
    case .ends(let iso): return L("plan_ends", planDate(iso, uiLocale: uiLocale, timeZone: timeZone))
    case .trialEnds(let iso, let priceJpy):
        return L("plan_trial_ends", planDate(iso, uiLocale: uiLocale, timeZone: timeZone), priceJpy)
    case .renews(let iso): return L("plan_renews", planDate(iso, uiLocale: uiLocale, timeZone: timeZone))
    }
}

struct PlanSettingsState: Equatable, Sendable {
    /// 读到的方案；nil 是还没读到（显示"正在加载"）。
    var plan: PlanInfo? = nil
    /// 读不到：服务端原句，否则 plan_load_failed；下面是"重试"。
    var loadError: RequestFailure? = nil
}

/// "方案"卡片的状态：设置打开时读一次 `GET /api/billing`，失败可以重试。
@MainActor
@Observable
final class PlanSettingsModel {
    private(set) var state = PlanSettingsState()

    @ObservationIgnored private let load: @MainActor () async -> Result<PlanInfo, Error>
    @ObservationIgnored private let work = PendingWork()
    @ObservationIgnored private var attempt = 0

    /// - Parameter load: `AccountViewModel.loadPlan`。
    init(load: @escaping @MainActor () async -> Result<PlanInfo, Error>) {
        self.load = load
        reload()
    }

    func retry() {
        state.loadError = nil
        reload()
    }

    func idle() async {
        await work.idle()
    }

    private func reload() {
        attempt += 1
        let current = attempt
        work.launch { [weak self] in
            guard let self else { return }
            let result = await self.load()
            guard current == self.attempt else { return }
            switch result {
            case .success(let plan): self.state.plan = plan
            case .failure(let error):
                if !(error is CancellationError) { self.state.loadError = RequestFailure(error) }
            }
        }
    }
}
