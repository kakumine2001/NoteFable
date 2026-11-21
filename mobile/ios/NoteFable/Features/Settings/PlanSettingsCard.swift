import SwiftUI

/// 设置里"方案"卡片的内容（网页 src/components/plan-settings.tsx，样式 settings-dialog.css 的 .settings-plan-*，手机宽度；
/// Android ui/PlanSettings.kt）：
/// 第一行"NoteFable"17/650 墨色，后接徽章（12/600、左右 8 上下 2、全圆角；免费是浅灰底灰字，Pro 是浅蓝底蓝字）；
/// Pro 时一行 13 灰的续费 / 结束 / 扣款失败说明；用量（14 正文标签 + 右侧 13 灰的"用了 / 上限"，下面 6 高的全圆角进度条，
/// 底色 hover 灰、填充蓝，用满时橙），条目间距 14、上距 16。
/// 只读：iOS 还没有购买流程，Android 的升级框和"管理订阅"不在这里。内容规则在 Core 的 `PlanPresentation.swift`。
struct PlanSettingsCard: View {
    let model: PlanSettingsModel

    @Environment(AppEnvironment.self) private var app

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
        } else {
            SettingsLoadingLine()
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
