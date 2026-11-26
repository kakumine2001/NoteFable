import SwiftUI

// 登录窗口（网页 SignInDialog，globals.css 的 .signin-*；Android ui/SignInDialog.kt。数值是在 412×915 下对网页量的计算样式）：
// - 外框：dialog.signin-dialog 宽 min(100% − 32, 400)，再受浏览器 <dialog> 默认 max-width（100% − 38）限制，412 宽时是 374（左右各 19）；
//   内边距 32 / 28 / 24，白底、圆角 8、--notion-shadow。右上 12 处 32 的关闭键（✕ 18 灰，圆角 6）。遮罩 rgba(15,15,15,.2)。
// - 第一屏：标题 22/700 居中、字距 −0.01em；副标题 14 / 行高 1.5 灰，上 6.4 下 24；"使用 Google 继续"（高 44、圆角 8、15 字）；
//   两种方式都有时中间是"或"分隔线（上下 16、间距 12、13 浅灰、两侧 1px 线）；邮箱输入框（高 44、圆角 8、16 字）+ "使用邮箱继续"
//   （整行、高 ≥44、上 12、圆角 8、15/600、--nf-ink 底，禁用 .45）+ 说明（上 12、13 浅灰居中）。服务端没开的方式不出现。
// - 第二屏：返回（上 −12、左 −4、下 12，内边距 4，箭头 16 + 4.8 + 14 灰）、标题、副标题（发到哪个邮箱）、6 位验证码输入框
//   （居中、24 字、字距 0.45em，固定从左到右）、"登录"、说明里的"重新发送验证码"（蓝色，禁用时浅灰）。
// - 错误 14 红、提示 14 灰，都在输入框下 8。发送 / 核对期间不能关（网页 close() 的 busy 判断）。
// 状态机在 Core 的 `SignInDialogModel`；这里只画界面。登录成功后账号有了用户，窗口由 `accountOverlays()` 关掉。

/// 登录窗口所在的那一层：遮罩 + 居中的卡片。窗口的宽度和内边距和通用对话框（`.nfDialog`）不同，所以借"全屏面板"那一层自己画。
struct SignInDialogHost: View {
    /// 透明底的面板：整层 120ms 淡入（和 `.nfDialog` 的遮罩相同），卡片自己再上移一点。
    static let layerStyle = NFPanelStyle(background: .clear, rise: 0, animation: NFMotion.cssEaseOut(0.12))

    @Environment(AppEnvironment.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: SignInDialogModel?
    @State private var shown = false

    init() {}

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                // 遮罩：点了关闭（发送 / 核对期间不关）。
                Sm.dialogScrim
                    .contentShape(Rectangle())
                    .onTapGesture { model?.close() }
                    .ignoresSafeArea()
                    .accessibilityHidden(true)
                if let model {
                    SignInDialogCard(
                        model: model,
                        width: max(0, min(proxy.size.width - 38, 400)),
                        maxHeight: max(200, proxy.size.height - 38),
                        onGoogle: { google(model) }
                    )
                    // 照 `.nfDialog` 的卡片进场：上移 4、缩放 .98 → 1，160ms ease-out。
                    .scaleEffect(shown || reduceMotion ? 1 : 0.98)
                    .offset(y: shown || reduceMotion ? 0 : 4)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .onAppear {
            if model == nil { model = makeModel() }
            withAnimation(reduceMotion ? nil : NFMotion.cssEaseOut(0.16)) { shown = true }
        }
    }

    private func makeModel() -> SignInDialogModel {
        let app = self.app
        let router = self.router
        return SignInDialogModel(
            account: app.account,
            // 换身份前先把打开的笔记存掉（和 Google 登录、退出时一样）。
            beforeIdentityChange: { await app.beforeIdentityChange() },
            onSignedIn: {
                app.onIdentityChanged()
                router.onIdentityChanged()
            },
            onClose: { router.signInOpen = false }
        )
    }

    /// "使用 Google 继续"：先把打开的笔记存掉，再发起登录（Android NoteFableRoot 的 signIn）。
    private func google(_ model: SignInDialogModel) {
        let app = self.app
        Task { @MainActor in
            await app.beforeIdentityChange()
            model.google()
        }
    }
}

private enum SignInFocus: Hashable {
    case email
    case code
}

private struct SignInDialogCard: View {
    let model: SignInDialogModel
    let width: CGFloat
    let maxHeight: CGFloat
    let onGoogle: () -> Void

    @Environment(AppEnvironment.self) private var app
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.layoutDirection) private var layoutDirection
    @FocusState private var focus: SignInFocus?

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        let state = model.state
        ZStack(alignment: .topTrailing) {
            FittingScrollView(maxHeight: maxHeight) {
                VStack(alignment: .leading, spacing: 0) {
                    if state.step == .choose {
                        chooseStep(state)
                    } else {
                        codeStep(state)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 32)
                .padding(.horizontal, 28)
                .padding(.bottom, 24)
            }
            NFIconButton(Lucide.x, label: L("close"), size: 32, iconSize: 18, cornerRadius: 6) { model.close() }
                .padding(.top, 12)
                .padding(.trailing, 12)
        }
        .frame(width: width)
        // 吸收卡片内部空白处的点击，防止透传到遮罩关掉弹窗；放在内容背后，避免与 Apple 系统按钮抢手势。
        .background {
            Color.clear
                .contentShape(shape)
                .onTapGesture {}
                .accessibilityHidden(true)
        }
        // 先裁内容再上玻璃（玻璃自己的边缘和高光不被裁掉）；自定义阴影只在非原生玻璃时画。
        .clipShape(shape)
        .nfGlassBackground(.regular, in: shape, solidFill: Sm.surface, stroke: Sm.panelRing)
        .nfChromeShadow(Sm.panelShadow, radius: 10, y: 4)
        .accessibilityAddTraits(.isModal)
        .task(id: model.showApple) {
            if model.showApple { model.prepareAppleSignIn() }
        }
        .task {
            // 只有邮箱时打开就聚焦邮箱输入框。等窗口进场后再设，太早会被忽略。
            guard model.autoFocusEmail, model.showEmail else { return }
            try? await Task.sleep(nanoseconds: 120_000_000)
            if model.state.step == .choose { focus = .email }
        }
        .onChange(of: state.step) { _, step in
            if step == .code {
                focus = .code
            } else {
                focus = nil
            }
        }
    }

    // MARK: 第一屏：选登录方式

    @ViewBuilder
    private func chooseStep(_ state: SignInDialogState) -> some View {
        SignInTitle(text: L("signin_title"))
        SignInSubtitle(text: L("signin_subtitle"))
        if model.showGoogle {
            GoogleSignInButton(label: L(model.googleLabelKey), busy: model.googleBusy, loading: model.googleSigningIn, cornerRadius: 8, action: onGoogle)
        }
        if model.showApple {
            ZStack(alignment: .trailing) {
                AppleSignInControl(enabled: !model.locked) { request in
                    model.apple(request: request)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .opacity(model.locked ? 0.55 : 1)
                if model.appleBusy {
                    ProgressView()
                        .tint(colorScheme == .dark ? .black : .white)
                        .padding(.trailing, 14)
                        .allowsHitTesting(false)
                }
            }
            .padding(.top, model.showGoogle ? 8 : 0)
            if model.appleSignInFailed {
                Text(L("sign_in_failed"))
                    .font(.nf(14))
                    .foregroundStyle(Sm.errorText)
                    .padding(.top, 8)
            }
        }
        if model.showDivider {
            HStack(spacing: 12) {
                NFDivider()
                Text(L("signin_or"))
                    .font(.nf(13))
                    .foregroundStyle(Sm.faint)
                    .fixedSize()
                NFDivider()
            }
            .padding(.vertical, 16)
        }
        if model.showEmail {
            SignInField(
                text: Binding(get: { model.state.email }, set: { model.setEmail($0) }),
                label: L("signin_email"),
                placeholder: L("signin_email"),
                isCode: false,
                enabled: !state.busy,
                focus: $focus,
                field: .email,
                onSubmit: { model.sendCode() }
            )
            feedback(state)
            SignInSubmit(text: L(model.sendLabelKey), enabled: model.canSendCode) { model.sendCode() }
            Text(L("signin_email_hint"))
                .font(.nf(13))
                .nfLineHeight(19.5, fontSize: 13)
                .foregroundStyle(Sm.faint)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.top, 12)
        }
    }

    // MARK: 第二屏：输入验证码

    @ViewBuilder
    private func codeStep(_ state: SignInDialogState) -> some View {
        Button {
            model.back()
        } label: {
            HStack(spacing: 4.8) {
                LucideIcon(Lucide.arrowLeft, size: 16, color: Sm.muted)
                Text(L("back"))
                    .font(.nf(14))
                    .foregroundStyle(Sm.muted)
            }
            .padding(4)
        }
        .buttonStyle(.pressable(cornerRadius: 6))
        .disabled(!model.canGoBack)
        // 网页 margin: −12 0 12 −4。
        .padding(.top, -12)
        .padding(.leading, -4)
        .padding(.bottom, 12)

        SignInTitle(text: L("signin_check_email"))
        SignInSubtitle(text: L("signin_code_sent", state.sentTo))
        SignInField(
            text: Binding(get: { model.state.code }, set: { model.setCode($0) }),
            label: L("signin_code"),
            placeholder: "000000",
            isCode: true,
            enabled: !state.busy,
            focus: $focus,
            field: .code,
            onSubmit: { model.verify() }
        )
        feedback(state)
        SignInSubmit(text: L(model.verifyLabelKey), enabled: model.canVerify) { model.verify() }
        // 说明：没收到？ + "重新发送验证码"。
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(L("signin_no_code") + " ")
                .font(.nf(13))
                .foregroundStyle(Sm.faint)
            Button {
                model.sendCode(again: true)
            } label: {
                Text(L("signin_resend"))
                    .font(.nf(13))
                    .foregroundStyle(model.canResend ? Sm.blue : Sm.faint)
            }
            .buttonStyle(.plain)
            .disabled(!model.canResend)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, 12)
    }

    /// 错误（红）和"已重新发送"（灰），都在输入框下 8。
    @ViewBuilder
    private func feedback(_ state: SignInDialogState) -> some View {
        if let error = state.error {
            Text(signInErrorText(error, app.systemText))
                .font(.nf(14))
                .nfLineHeight(21, fontSize: 14)
                .foregroundStyle(Sm.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
        }
        if state.resent {
            Text(L("signin_new_code_sent"))
                .font(.nf(14))
                .nfLineHeight(21, fontSize: 14)
                .foregroundStyle(Sm.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
        }
    }
}

// MARK: - 部件

/// .signin-title：22/700、字距 −0.01em、居中（阿拉伯文不加字距，保护连写）。
private struct SignInTitle: View {
    let text: String
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        Text(text)
            .font(.nf(22, weight: 700))
            .kerning(layoutDirection == .rightToLeft ? 0 : -0.22)
            .nfLineHeight(33, fontSize: 22)
            .foregroundStyle(Sm.text)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .accessibilityAddTraits(.isHeader)
    }
}

/// .signin-subtitle：上 6.4、下 24，14 / 行高 1.5 灰、居中。
private struct SignInSubtitle: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.nf(14))
            .nfLineHeight(21, fontSize: 14)
            .foregroundStyle(Sm.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 6.4)
            .padding(.bottom, 24)
    }
}

/// .notes-dialog-input.signin-input：高 44、圆角 8、1px 深描边、左右 11.2、16 字；聚焦 2px 蓝框。
/// 验证码（.signin-code）：居中、24 字、字距 0.45em，数字键盘，固定从左到右。
private struct SignInField: View {
    @Binding var text: String
    let label: String
    let placeholder: String
    let isCode: Bool
    let enabled: Bool
    var focus: FocusState<SignInFocus?>.Binding
    let field: SignInFocus
    let onSubmit: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8)
        let focused = focus.wrappedValue == field
        input
            .textFieldStyle(.plain)
            .foregroundStyle(Sm.text)
            .tint(Sm.text)
            .lineLimit(1)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .focused(focus, equals: field)
            .onSubmit(onSubmit)
            .disabled(!enabled)
            .padding(.horizontal, 11.2)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            // 卡片是玻璃的：输入框自己铺白底（和 `NFDialogTextField` 一样），不然看着像个透明的洞。
            .background(Sm.surface, in: shape)
            .overlay { shape.strokeBorder(focused ? Sm.blue : Sm.borderStrong, lineWidth: focused ? 2 : 1) }
            .contentShape(shape)
            .onTapGesture { if enabled { focus.wrappedValue = field } }
            .accessibilityLabel(label)
            // 6 位验证码不随界面方向翻转。
            .environment(\.layoutDirection, isCode ? .leftToRight : currentDirection)
    }

    @Environment(\.layoutDirection) private var currentDirection

    @ViewBuilder
    private var input: some View {
        if isCode {
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Sm.faint))
                .font(.nf(24))
                .kerning(10.8)
                .multilineTextAlignment(.center)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
        } else {
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Sm.faint))
                .font(.nf(16))
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .submitLabel(.go)
        }
    }
}

/// .notion-button.notion-button-primary.signin-submit：整行、高 ≥44、上 12、圆角 8、15/600、--nf-ink 底白字；禁用 .45。
private struct SignInSubmit: View {
    let text: String
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(.nf(15, weight: 600))
                .foregroundStyle(Sm.onInk)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
        }
        .buttonStyle(.pressable(background: Sm.ink, pressedBackground: Sm.inkHover, cornerRadius: 8, scale: 0.97, disabledOpacity: 0.45))
        .disabled(!enabled)
        .padding(.top, 12)
    }
}

/// Google 官方样式的按钮（网页 .google-signin-button，手机尺寸）：高 44、1px #747775、白底、15/500、字距 0.25；
/// 圆角默认 4，登录窗口里（.signin-option）是 8。进行中不能点。
struct GoogleSignInButton: View {
    let label: String
    let busy: Bool
    var loading: Bool = false
    var cornerRadius: CGFloat = 4
    let action: () -> Void

    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius)
        Button(action: action) {
            ZStack(alignment: .trailing) {
                HStack(spacing: 10) {
                    GoogleLogo(size: 18)
                    Text(label)
                        .font(.nf(15, weight: 500))
                        .kerning(layoutDirection == .rightToLeft ? 0 : 0.25)
                        .foregroundStyle(Color(argb: 0xFF1F1F1F))
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                if loading {
                    ProgressView()
                        .tint(Color(argb: 0xFF1F1F1F))
                        .padding(.trailing, 14)
                }
            }
            .overlay { shape.strokeBorder(Color(argb: 0xFF747775), lineWidth: 1) }
        }
        .buttonStyle(.pressable(background: .white, cornerRadius: cornerRadius))
        .disabled(busy)
    }
}

/// Google 的四色"G"（src/components/google-logo.tsx，viewBox 48），按品牌规范原样使用。
struct GoogleLogo: View {
    let size: CGFloat

    private static let parts: [(color: UInt32, d: String)] = [
        (0xFFEA4335, "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"),
        (0xFF4285F4, "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"),
        (0xFFFBBC05, "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"),
        (0xFF34A853, "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"),
    ]

    var body: some View {
        Canvas { context, canvasSize in
            var scaled = context
            let scale = canvasSize.width / 48
            scaled.scaleBy(x: scale, y: scale)
            for part in Self.parts {
                scaled.fill(SVGPath.path(part.d), with: .color(Color(argb: part.color)))
            }
        }
        .frame(width: size, height: size)
        // 商标不随界面方向翻转。
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityHidden(true)
    }
}
