import Foundation
import Observation

// 登录窗口里不画界面的部分（Android ui/SignInDialog.kt；网页 SignInDialog）。

/// 网页 `<input maxLength={254}>`。
let MAX_EMAIL_LENGTH = 254

/// 验证码输入：把任意 Unicode 十进制数字（如阿拉伯-印度数字 ٤٨٢٩١٠）归一为 ASCII 0-9，只留数字，最多 6 位。
func cleanLoginCode(_ input: String) -> String {
    var out = ""
    for scalar in input.unicodeScalars {
        if out.count >= 6 { break }
        guard scalar.properties.numericType == .decimal, let value = scalar.properties.numericValue,
              value >= 0, value <= 9, value.rounded() == value else { continue }
        out.append(Character(Unicode.Scalar(UInt8(48 + Int(value)))))
    }
    return out
}

enum SignInStep: Equatable, Sendable {
    /// 第一屏：Google 和 / 或邮箱。
    case choose
    /// 第二屏：输入发到邮箱的 6 位验证码。
    case code
}

struct SignInDialogState: Equatable, Sendable {
    var step: SignInStep = .choose
    var email = ""
    /// 验证码发到的邮箱：发送期间改了输入框，第二屏和核对仍用这个地址（网页 sentTo）。
    var sentTo = ""
    var code = ""
    /// 正在发验证码 / 核对：期间窗口不能关（网页 close() 的 busy 判断）。
    var busy = false
    var error: SignInError? = nil
    /// 刚重新发了一次验证码：显示 signin_new_code_sent。
    var resent = false
}

/// 登录失败要显示的句子：服务端原句经系统文词典翻译，否则是网页的两句兜底文。
func signInErrorText(_ error: SignInError, _ system: SystemTextTranslator) -> String {
    switch error {
    case .server(let message): return system.localize(message)
    case .generic: return L("signin_error_generic")
    case .offline: return L("signin_error_offline")
    }
}

/// 登录窗口的状态机：邮箱两步（发验证码 → 核对）。Google 登录由 [google] 发起；登录成功后账号有了用户，由调用方关掉窗口。
@MainActor
@Observable
final class SignInDialogModel {
    private(set) var state = SignInDialogState()

    @ObservationIgnored private let account: AccountViewModel
    @ObservationIgnored private let beforeIdentityChange: @MainActor () async throws -> Void
    @ObservationIgnored private let onSignedIn: @MainActor () -> Void
    @ObservationIgnored private let onClose: @MainActor () -> Void
    @ObservationIgnored private let uiLocale: () -> String
    @ObservationIgnored private let work = PendingWork()

    /// - Parameters:
    ///   - beforeIdentityChange: 验证码通过、身份换掉之前要做完的事（把打开的笔记存掉）；抛错就不登录。
    ///   - onSignedIn: 换了身份（通知聊天、侧栏、笔记重新加载）。
    ///   - uiLocale: 界面语言（验证码邮件用它写）。
    init(
        account: AccountViewModel,
        beforeIdentityChange: @escaping @MainActor () async throws -> Void,
        onSignedIn: @escaping @MainActor () -> Void,
        onClose: @escaping @MainActor () -> Void,
        uiLocale: @escaping () -> String = { AppLanguage.uiLocale }
    ) {
        self.account = account
        self.beforeIdentityChange = beforeIdentityChange
        self.onSignedIn = onSignedIn
        self.onClose = onClose
        self.uiLocale = uiLocale
        account.clearSignInFailed()
    }

    // ---- 界面要显示的 ----

    /// Google 登录进行中（等 nonce、换令牌）也不让发邮箱验证码或核对：两种登录同时进行会互相覆盖会话。
    var locked: Bool { state.busy || account.state.signingIn }
    var showGoogle: Bool { account.state.googleEnabled }
    var showApple: Bool { account.state.appleEnabled }
    var showEmail: Bool { account.state.emailEnabled }
    /// 两种方式都有时中间是"或"分隔线。
    var showDivider: Bool { (showGoogle || showApple) && showEmail }
    /// Google 按钮上的字（文案键）和转圈。
    var googleLabelKey: String { account.state.signInFailed && !showApple ? "sign_in_failed" : "continue_google" }
    var googleBusy: Bool { state.busy || account.state.signingIn }
    /// 只有邮箱时打开就聚焦邮箱输入框。
    var autoFocusEmail: Bool { !showGoogle && !showApple }
    var canSendCode: Bool { !locked && !ApiText.isBlank(state.email) }
    var sendLabelKey: String { state.busy ? "signin_sending" : "continue_email" }
    var canVerify: Bool { !locked && state.code.count == 6 }
    var verifyLabelKey: String { state.busy ? "signin_signing_in" : "sign_in" }
    var canResend: Bool { !locked }
    var canGoBack: Bool { !state.busy }
    var canClose: Bool { !state.busy }

    // ---- 操作 ----

    func setEmail(_ text: String) {
        state.email = clipUtf16(text, MAX_EMAIL_LENGTH)
    }

    func setCode(_ text: String) {
        state.code = cleanLoginCode(text)
    }

    func google() {
        account.signIn(onSignedIn: onSignedIn)
    }

    func apple(request: @escaping @MainActor (String) async throws -> (code: String, name: String?)?) {
        guard !locked else { return }
        account.clearSignInFailed()
        account.signInWithApple(request: request, beforeIdentityChange: beforeIdentityChange, onSignedIn: onSignedIn)
    }

    var appleSignInFailed: Bool { account.state.signInFailed }

    /// 发验证码；[again] 是第二屏的"重新发送"（发到上次的地址）。
    func sendCode(again: Bool = false) {
        let address = again ? state.sentTo : state.email
        if locked || ApiText.isBlank(address) { return }
        state.busy = true
        state.error = nil
        state.resent = false
        work.launch { [weak self] in
            guard let self else { return }
            let failed = await self.account.sendEmailCode(address, locale: self.uiLocale())
            self.state.busy = false
            if let failed {
                self.state.error = failed
                return
            }
            self.state.sentTo = address
            self.state.step = .code
            self.state.code = ""
            self.state.resent = again
        }
    }

    func verify() {
        if locked || state.code.count != 6 { return }
        state.busy = true
        state.error = nil
        state.resent = false
        let sentTo = state.sentTo
        let code = state.code
        work.launch { [weak self] in
            guard let self else { return }
            let failed = await self.account.verifyEmailCode(
                sentTo, code, beforeIdentityChange: self.beforeIdentityChange, onSignedIn: self.onSignedIn
            )
            self.state.busy = false
            if let failed { self.state.error = failed } else { self.onClose() }
        }
    }

    /// 第二屏的"返回"。
    func back() {
        if state.busy { return }
        state.step = .choose
        state.error = nil
        state.resent = false
    }

    /// 关闭键 / 点遮罩：发送、核对期间不关。
    func close() {
        if !locked { onClose() }
    }

    func idle() async {
        await work.idle()
    }
}
