import StoreKit
import SwiftUI

/// 设置里"方案"卡片的内容（网页 src/components/plan-settings.tsx，样式 settings-dialog.css 的 .settings-plan-*，手机宽度；
/// Android ui/PlanSettings.kt）：
/// 第一行"NoteFable"17/650 墨色，后接徽章（12/600、左右 8 上下 2、全圆角；免费是浅灰底灰字，Pro 是浅蓝底蓝字）；
/// Pro 时一行 13 灰的续费 / 结束 / 扣款失败说明；用量（14 正文标签 + 右侧 13 灰的"用了 / 上限"，下面 6 高的全圆角进度条，
/// 底色 hover 灰、填充蓝，用满时橙），条目间距 14、上距 16。
/// 内容规则在 Core 的 `PlanPresentation.swift`，购买走 App Store 显示的地区价格。
struct PlanSettingsCard: View {
    let model: PlanSettingsModel

    @Environment(AppEnvironment.self) private var app

    @State private var product: Product?
    @State private var buying = false
    @State private var productUnavailable = false
    @State private var productAttempt = 0
    @State private var feedbackKey: String?
    @State private var purchaseError: String?
    @Environment(\.openURL) private var openURL

    init(model: PlanSettingsModel) {
        self.model = model
    }

    var body: some View {
        let state = model.state
        HStack(spacing: 8) {
            Text(verbatim: "NoteFable")
                .font(.nf(17, weight: 650))
                .nfLineHeight(25.5, fontSize: 17)
                .foregroundStyle(Sm.ink)
            if let plan = state.plan {
                Text(L(plan.badgeKey))
                    .font(.nf(12, weight: 600))
                    .foregroundStyle(plan.isPro ? Sm.blue : Sm.muted)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .frame(minHeight: 22)
                    .background(plan.isPro ? Sm.accentSoft : Sm.hover, in: Capsule())
            }
            Spacer(minLength: 0)
        }
        if let loadError = state.loadError {
            SettingsErrorLine(loadError.text("plan_load_failed", app.systemText))
                .padding(.top, 12)
            NotionButton(L("try_again")) { model.retry() }
                .padding(.top, 8)
        } else if let plan = state.plan {
            if let line = plan.statusLine {
                SettingsHelpLine(planStatusText(line))
            }
            VStack(alignment: .leading, spacing: 14) {
                ForEach(plan.meters) { meter in
                    PlanMeterRow(meter: meter)
                }
            }
            .padding(.top, 16)
            if plan.storage != nil {
                SettingsHelpLine(L("plan_storage_help"))
            }
            purchaseActions(plan)
        } else {
            SettingsLoadingLine()
        }
    }

    private func purchaseActions(_ plan: PlanInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !plan.isPro, !plan.appStorePending, let product, product.id == plan.appStoreProduct {
                SettingsHelpLine(L("plan_offer_title", product.displayPrice))
                NotionButton(L("plan_upgrade")) { runPurchase { try await buy(product) } }
                    .disabled(buying)
                HStack(spacing: 12) {
                    Button(L("terms")) { openExternal("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/") }
                    Button(L("privacy")) { openExternal("https://notefable.com/privacy") }
                }
                .font(.nf(13))
            }
            if plan.appStoreProduct != nil {
                NotionButton(L("ios_restore_purchases")) { runPurchase { try await restore(productId: plan.appStoreProduct) } }
                    .disabled(buying)
            }
            if plan.provider == "apple" || plan.appStorePurchase {
                NotionButton(L("plan_manage_app_store")) {
                    openExternal("https://apps.apple.com/account/subscriptions")
                }
            }
            if buying { ProgressView() }
            if !plan.isPro && productUnavailable {
                SettingsHelpLine(app.systemText.localize("Subscriptions are not available yet."))
                NotionButton(L("try_again")) { productAttempt += 1 }
            }
            if let feedbackKey {
                SettingsHelpLine(L(feedbackKey))
            } else if plan.appStorePending {
                SettingsHelpLine(L("plan_pending"))
            }
            if let purchaseError { SettingsErrorLine(purchaseError) }
        }
        .padding(.top, 8)
        .task(id: "\(plan.appStoreProduct ?? ""):\(productAttempt)") {
            product = nil
            productUnavailable = false
            guard let id = plan.appStoreProduct, !ScreenshotHooks.isActive else { return }
            let found = try? await Product.products(for: [id]).first
            guard !Task.isCancelled else { return }
            product = found
            productUnavailable = found == nil
        }
        .onChange(of: app.appleBillingGeneration) { _, _ in
            if feedbackKey == "plan_pending" { feedbackKey = nil }
            model.retry()
        }
    }

    private func openExternal(_ address: String) {
        if let url = URL(string: address) { openURL(url) }
    }

    private func runPurchase(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !buying else { return }
        buying = true
        feedbackKey = nil
        purchaseError = nil
        Task { @MainActor in
            defer { buying = false; model.retry() }
            do {
                try await operation()
            } catch is CancellationError {
                // 系统取消支付或恢复。
            } catch {
                purchaseError = (error as? ApiException)?.serverMessage()
                    .map { app.systemText.localize($0) } ?? L("plan_purchase_failed")
            }
        }
    }

    private func buy(_ product: Product) async throws {
        let identity = app.identityGeneration
        let prepared = try await app.accountApi.prepareApplePurchase()
        guard identity == app.identityGeneration else { throw CancellationError() }
        if prepared.pending == true { feedbackKey = "plan_pending"; return }
        guard let token = prepared.token, let reservation = prepared.reservation else { throw URLError(.cannotParseResponse) }
        switch try await product.purchase(options: [.appAccountToken(token)]) {
        case .success(let transaction):
            guard identity == app.identityGeneration else { throw CancellationError() }
            apply(try await AppleSubscription.confirm(transaction, api: app.accountApi))
        case .pending:
            feedbackKey = "plan_pending"
        case .userCancelled:
            if identity == app.identityGeneration { try await app.accountApi.releaseApplePurchase(reservation) }
        @unknown default:
            break
        }
    }

    private func restore(productId: String?) async throws {
        let identity = app.identityGeneration
        try await AppStore.sync()
        for await item in Transaction.currentEntitlements {
            guard identity == app.identityGeneration else { throw CancellationError() }
            guard item.unsafePayloadValue.productID == productId else { continue }
            apply(try await AppleSubscription.confirm(item, api: app.accountApi))
            return
        }
        feedbackKey = "ios_no_purchases"
    }

    private func apply(_ status: ApplePurchaseStatus) {
        switch status {
        case .subscribed: feedbackKey = "plan_welcome"
        case .inactive: feedbackKey = "ios_no_purchases"
        case .conflict: feedbackKey = "ios_subscription_conflict"
        }
    }
}

/// 一条用量：标签 + "用了 / 上限"，下面是进度条。
private struct PlanMeterRow: View {
    let meter: PlanMeter

    /// .settings-plan-bar.is-full
    private static let fullColor = Color(argb: 0xFFB45309)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(L(meter.labelKey))
                    .font(.nf(14))
                    .nfLineHeight(21, fontSize: 14)
                    .foregroundStyle(Sm.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(meter.countText)
                    .font(.nf(13))
                    .foregroundStyle(Sm.muted)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            GeometryReader { proxy in
                Capsule()
                    .fill(meter.full ? Self.fullColor : Sm.blue)
                    .frame(width: proxy.size.width * CGFloat(meter.ratio))
            }
            .frame(height: 6)
            .background(Sm.hover, in: Capsule())
            .clipShape(Capsule())
            .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
