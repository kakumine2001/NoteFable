import SwiftUI
import UIKit

// 用法（输入栏上方，Android ChatScreen.kt 的 prompt 槽）：只有服务端开了登录且还没登录时才放（和网页一样由调用方判断）：
//
//     if let kind = app.chat.state.guestLimit, <登录可用>, <未登录> {
//         GuestLimitPrompt(
//             kind: kind,
//             attachmentsLost: !state.files.isEmpty || !state.attachedPages.isEmpty
//         )
//     }
//
// “登录”打开登录窗口（`router.openSignIn()`）；“以后再说”和 ✕ 默认调 `app.chat.dismissGuestLimit()`，要换就传 `onClose`。
// 免费用户的升级提示（Android UpgradeLimitPrompt / PlanSettings 里借用这个外框的购买提示）iOS 还没有购买流程，不做。

/// 未登录用户撞到当日上限时，输入栏上方的登录提示（网页 src/components/guest-limit-prompt.tsx，样式在 globals.css 的
/// .guest-limit-*，412 宽手机下实测；Android GuestLimitPrompt.kt）：外框内边距 14/40/14/14、1px 蓝描边、圆角 12、
/// 浅蓝到浅黄的 135° 渐变 + 输入栏阴影，下距 12；左边 34 的圆角 10 图标框（默认角色徽章 AppIconView 22，存储空间提示用蓝色框 + HardDrive 18）、间距 12；
/// 标题 15/600 行高 21 墨色；说明 13.5 / 20.925 灰，上距 2；按钮区上距 12、竖排、间距 8："登录"按钮高 44 全圆角、左右 16，
/// "以后再说"13.5 灰居中；右上 8 处 28 的关闭键（✕ 16，浅灰，圆角 6）。数值用 member 的上限。
struct GuestLimitPrompt: View {
    private let kind: String
    private let attachmentsLost: Bool
    private let onClose: (() -> Void)?
    /// 存储空间不够的提示（网页 StorageLimitPrompt）：标题和说明换成存储空间的，图标是 HardDrive。
    private let storage: StorageLimitInfo?
    /// 笔记编辑器 WebView 发来的使用次数上限（网页 usageLimit）：未登录给登录按钮，已登录免费会员只读说明（iOS 暂无内购）。
    private let usage: UsageLimitInfo?

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 进场（guest-limit-enter）、图标弹出（guest-limit-pop）、按钮高光（sheen）、按钮光晕（halo）的进度。
    @State private var enter: Double = 0
    @State private var pop: Double = 0
    @State private var sheen: Double = -1.2
    @State private var halo: Double = 0
    @State private var started = false

    /// - Parameters:
    ///   - kind: 撞到的上限（`ChatUiState.guestLimit`："chat" 或 "image"）。
    ///   - attachmentsLost: 输入栏里有附件或笔记（登录后不保留，多显示一句提醒）。
    ///   - onClose: “以后再说”和 ✕；不给就是 `app.chat.dismissGuestLimit()`。
    init(kind: String, attachmentsLost: Bool, onClose: (() -> Void)? = nil) {
        self.kind = kind
        self.attachmentsLost = attachmentsLost
        self.onClose = onClose
        self.storage = nil
        self.usage = nil
    }

    /// 上传（或生成图片）因为文件存储空间不够被拒绝时（网页 StorageLimitPrompt）：总是说明原因和用量；
    /// 未登录且服务端开了登录时才有"登录"按钮。iOS 还没有购买流程，免费用户和 Pro 只说明原因（不提升级）。
    /// - Parameter onClose: ✕ 和"以后再说"；不给就是 `app.chat.dismissStorageLimit()`。
    init(storage: StorageLimitInfo, attachmentsLost: Bool, onClose: (() -> Void)? = nil) {
        self.kind = "chat"
        self.attachmentsLost = attachmentsLost
        self.onClose = onClose
        self.storage = storage
        self.usage = nil
    }

    /// 笔记编辑器里的 AI 面板或幻灯片生图撞到使用次数上限（网页经桥发来的 usageLimit）：
    /// 未登录且服务端开了登录时显示"登录"；已登录免费会员只读提示（iOS 暂无内购升级入口）。
    init(usage: UsageLimitInfo, attachmentsLost: Bool, onClose: (() -> Void)? = nil) {
        self.kind = usage.kind
        self.attachmentsLost = attachmentsLost
        self.onClose = onClose
        self.storage = nil
        self.usage = usage
    }

    /// 有"登录"按钮（聊天未登录次数上限总是有；存储空间或编辑器 usageLimit 只在未登录、服务端开了登录时）。
    private var offersSignIn: Bool {
        let account = app.account.state
        if let storage {
            return storage.tier == "guest" && account.configured && account.user == nil
        }
        if let usage {
            return usage.tier == "guest" && account.configured && account.user == nil
        }
        return true
    }

    private var titleText: String {
        storage != nil ? L("storage_limit_title") : L(kind == "image" ? "guest_limit_title_image" : "guest_limit_title_chat")
    }

    private var bodyText: String? {
        let limits = app.usageLimits?.member ?? UsageLimit(chat: 0, image: 0)
        if let storage {
            let locale = Locale(identifier: AppLanguage.acceptLanguage(AppLanguage.uiLocale))
            var lines = [L("storage_limit_used", formatStorageSize(storage.used, locale: locale), formatStorageSize(storage.limit, locale: locale))]
            if offersSignIn, let member = limits.storage, member > 0 {
                lines.append(L("storage_limit_sign_in", formatStorageSize(member, locale: locale)))
            }
            return lines.joined(separator: "\n")
        }
        if let usage {
            if offersSignIn {
                return L("guest_limit_body", limits.chat, limits.image)
            }
            if usage.tier == "member", usage.kind == "chat" {
                return app.systemText.localize("You've used today's free messages. Try again tomorrow.")
            }
            return nil
        }
        return L("guest_limit_body", limits.chat, limits.image)
    }

    /// 说明下面的补充：存储空间的提示先说"删掉不要的文件"，登录会丢附件时再加一句。
    private var noteLines: [String] {
        var lines: [String] = []
        if storage != nil { lines.append(L("storage_limit_delete")) }
        if attachmentsLost && offersSignIn { lines.append(L("guest_limit_attachments_lost")) }
        return lines
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 12)
        let reduced = reduceMotion
        let enterValue = reduced ? 1 : enter

        HStack(alignment: .top, spacing: 12) {
            Group {
                if storage != nil {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Sm.blue)
                        .frame(width: 34, height: 34)
                        .overlay { LucideIcon(Lucide.hardDrive, size: 18, strokeWidth: 2.1, color: .white) }
                } else {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Sm.surface)
                        .frame(width: 34, height: 34)
                        .overlay { AppIconView(icon: app.appIcon.icon, size: 22) }
                        .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(Sm.borderStrong, lineWidth: 1) }
                }
            }
            .modifier(GuestLimitPopEffect(progress: reduced ? 1 : pop))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 0) {
                Text(titleText)
                    .font(.nf(15, weight: 600))
                    .nfLineHeight(21, fontSize: 15)
                    .foregroundStyle(Sm.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let bodyText, !bodyText.isEmpty {
                    Text(bodyText)
                        .font(.nf(13.5))
                        .nfLineHeight(20.925, fontSize: 13.5)
                        .foregroundStyle(Sm.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                }
                ForEach(noteLines, id: \.self) { line in
                    Text(line)
                        .font(.nf(13.5))
                        .nfLineHeight(20.925, fontSize: 13.5)
                        .foregroundStyle(Sm.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                }
                if offersSignIn {
                VStack(spacing: 8) {
                    GuestLimitSignInButton(label: L("sign_in"), sheen: reduced ? 1.2 : sheen, halo: reduced ? 0 : halo) {
                        router.openSignIn()
                    }
                    Button(action: close) {
                        Text(L("not_now"))
                            .font(.nf(13.5))
                            .nfLineHeight(20.25, fontSize: 13.5)
                            .foregroundStyle(Sm.muted)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.pressable(pressedBackground: nil))
                }
                .padding(.top, 12)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 14)
        .padding(.top, 14)
        .padding(.bottom, 14)
        .padding(.trailing, 40)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            // linear-gradient(135deg, --nf-accent-soft, rgba(255,226,122,.16))，叠在白底上。
            GeometryReader { proxy in
                let points = CSSGradientAngle.points(degrees: 135, size: proxy.size)
                ZStack {
                    Sm.surface
                    LinearGradient(
                        colors: [Sm.accentSoft, Color(argb: 0x29FFE27A)],
                        startPoint: points.start,
                        endPoint: points.end
                    )
                }
            }
        }
        .clipShape(shape)
        .overlay { shape.strokeBorder(Sm.accentLine, lineWidth: 1) }
        .overlay(alignment: .topTrailing) {
            Button(action: close) {
                LucideIcon(Lucide.x, size: 16, color: Sm.faint)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.pressable(cornerRadius: 6))
            .accessibilityLabel(L("close"))
            .padding(.top, 8)
            .padding(.trailing, 8)
        }
        // Android 的 shadow(8.dp, ComposerShadow)。
        .background {
            shape.fill(Sm.surface).shadow(color: Sm.composerShadow, radius: 8, x: 0, y: 4)
        }
        // 进场：从下方 14 处、缩放 .97 淡入（420ms）。
        .scaleEffect(0.97 + 0.03 * enterValue)
        .offset(y: (1 - enterValue) * 14)
        .opacity(min(1, max(0, enterValue)))
        .padding(.bottom, 12)
        .accessibilityElement(children: .contain)
        .onAppear(perform: startMotion)
        .task(id: started) {
            guard started, !reduced else { return }
            await runHalo()
        }
    }

    private func close() {
        if let onClose {
            onClose()
        } else if storage != nil {
            app.chat.dismissStorageLimit()
        } else if usage != nil {
            app.notes.dismissUsageLimit()
        } else {
            app.chat.dismissGuestLimit()
        }
    }

    /// 网页 @keyframes guest-limit-enter / pop / sheen 的时间线（“减弱动态效果”时直接停在终点）。
    private func startMotion() {
        guard !started else { return }
        started = true
        // 读屏：和网页 aria-live="polite" 一样念出标题。
        UIAccessibility.post(notification: .announcement, argument: titleText)
        guard !reduceMotion else { return }
        withAnimation(.timingCurve(0.2, 0.9, 0.3, 1.15, duration: 0.42)) { enter = 1 }
        withAnimation(.timingCurve(0.3, 1.6, 0.5, 1, duration: 0.62).delay(0.18)) { pop = 1 }
        // FastOutSlowInEasing = cubic-bezier(.4, 0, .2, 1)。
        withAnimation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.9).delay(0.52)) { sheen = 1.2 }
    }

    /// box-shadow 光晕：700ms 后向外扩两圈，每圈 1.6 秒（CSS ease-out）。
    private func runHalo() async {
        try? await Task.sleep(nanoseconds: 700_000_000)
        for _ in 0..<2 {
            if Task.isCancelled { return }
            setHaloWithoutAnimation(0)
            // 让“归零”先画一帧，再开始这一圈，不然两次改动会合成一次。
            try? await Task.sleep(nanoseconds: 16_000_000)
            withAnimation(NFMotion.cssEaseOut(1.6)) { halo = 1 }
            try? await Task.sleep(nanoseconds: 1_600_000_000)
        }
        setHaloWithoutAnimation(0)
    }

    private func setHaloWithoutAnimation(_ value: Double) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { halo = value }
    }
}

// MARK: - 登录按钮

/// .signin-open-button.guest-limit-signin（手机）：高 44、全圆角、--nf-ink 底、左右 16、白字 15/600；
/// 出现后一道浅蓝高光扫过一次，再向外扩两圈光晕。
private struct GuestLimitSignInButton: View {
    let label: String
    let sheen: Double
    let halo: Double
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.nf(15, weight: 600))
                .foregroundStyle(Sm.onInk)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Sm.ink, in: Capsule())
                .modifier(GuestLimitSheenEffect(progress: sheen))
                .clipShape(Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.pressable(pressedBackground: nil, cornerRadius: 22, scale: 0.97))
        .modifier(GuestLimitHaloEffect(progress: halo))
    }
}

// MARK: - 动画效果（按进度逐帧计算，所以做成 Animatable）

/// guest-limit-pop：0% 透明、缩放 .4、转 −20°；60% 不透明、1.12、6°；100% 原样。
private struct GuestLimitPopEffect: ViewModifier, Animatable {
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    private func segment(_ from: Double, _ mid: Double, _ to: Double) -> Double {
        let p = progress
        return p < 0.6 ? from + (mid - from) * (p / 0.6) : mid + (to - mid) * ((p - 0.6) / 0.4)
    }

    func body(content: Content) -> some View {
        content
            .scaleEffect(segment(0.4, 1.12, 1))
            .rotationEffect(.degrees(segment(-20, 6, 0)))
            .opacity(min(1, max(0, segment(0, 1, 1))))
    }
}

/// ::after 的高光：linear-gradient(105deg, transparent 35%, rgba(35,131,226,.22) 50%, transparent 65%)，从 -120% 移到 120%。
private struct GuestLimitSheenEffect: ViewModifier, Animatable {
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func body(content: Content) -> some View {
        content.overlay {
            GeometryReader { proxy in
                let points = CSSGradientAngle.points(degrees: 105, size: proxy.size)
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0.35),
                        .init(color: Color(argb: 0x382383E2), location: 0.5),
                        .init(color: .clear, location: 0.65),
                    ],
                    startPoint: points.start,
                    endPoint: points.end
                )
                .offset(x: progress * proxy.size.width)
            }
            .allowsHitTesting(false)
            .environment(\.layoutDirection, .leftToRight)
        }
    }
}

/// box-shadow: 0 0 0 <0→10px> rgba(35,131,226,.35→0)。
private struct GuestLimitHaloEffect: ViewModifier, Animatable {
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func body(content: Content) -> some View {
        content.background {
            if progress > 0 && progress < 1 {
                Capsule()
                    .fill(Sm.blue.opacity(0.35 * (1 - progress)))
                    .padding(-10 * progress)
                    .allowsHitTesting(false)
            }
        }
    }
}

// MARK: - CSS 角度渐变

/// CSS `linear-gradient(<角度>deg, …)` 的起止点（换算成 SwiftUI 的 UnitPoint）：渐变线过中心，长度让两个角刚好落在 0% / 100%。
enum CSSGradientAngle {
    static func points(degrees: Double, size: CGSize) -> (start: UnitPoint, end: UnitPoint) {
        guard size.width > 0, size.height > 0 else { return (.leading, .trailing) }
        let radians = degrees * .pi / 180
        let dx = sin(radians)
        let dy = -cos(radians)
        let length = abs(size.width * dx) + abs(size.height * dy)
        let halfX = dx * length / 2 / size.width
        let halfY = dy * length / 2 / size.height
        return (
            UnitPoint(x: 0.5 - halfX, y: 0.5 - halfY),
            UnitPoint(x: 0.5 + halfX, y: 0.5 + halfY)
        )
    }
}
