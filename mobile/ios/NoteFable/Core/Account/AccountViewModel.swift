import Foundation
import Observation

struct AccountUiState: Equatable, Sendable {
    /// 账号读到过（网页 account !== null）。读失败时保持原样：语言同步在读到之前什么都不做。
    var loaded = false
    /// 服务端开了登录才显示登录入口（和网页 AccountButton 一样，未配置时什么都不显示）。
    var configured = false
    /// 显示用的资料：服务端确认过的 + 还没确认的编辑（网页 account-store 的 view()）。
    var user: AccountUser? = nil
    var googleClientId: String? = nil
    /// 登录窗口里列哪些方式（服务端 `GET /api/account` 的 google / email）。
    /// 这个安装包没有配 Google 登录（没有注入取令牌的方法）时 googleEnabled 一直是 false。
    var googleEnabled = true
    var emailEnabled = false
    var appleEnabled = false
    var appStoreBilling = false
    var signingIn = false
    /// 正在退出登录（网页 account-button.tsx 的 signingOut）：期间不再发起退出，界面语言也不跟着账号同步。
    var signingOut = false
    /// 上一次登录失败：按钮文字换成"登录失败，请重试"。
    var signInFailed = false
    /// 资料保存失败时的提示：服务端的英文原句（经系统文词典翻译），没有时是网页兜底的 "Could not save."。
    var profileError: ProfileError? = nil
    /// 头像照片正在上传（网页 ProfileMenu 的 uploading：期间菜单不关、保存键变"正在保存…"）。
    var uploading = false
    /// 照片这一栏的提示（网页 uploadError）。
    var photoError: PhotoError? = nil
}

/// 资料（名字 / 图标）保存失败的原因。
enum ProfileError: Equatable, Sendable {
    case server(String)
    /// 网页 account-store 的兜底文 "Could not save."（acct_could_not_save）。
    case couldNotSave
}

/// 邮箱登录失败的原因：服务端原句，或网页的两句兜底文。
enum SignInError: Equatable, Sendable {
    case server(String)
    case generic
    case offline
}

/// 照片栏的提示：选的文件不对，或上传失败（服务端原句 / 网页的两句兜底文）。
enum PhotoError: Equatable, Sendable {
    case notImage
    case tooLarge
    case server(String)
    case uploadFailed
    case offline
}

/// 选的原图上限（网页 MAX_PICKED_BYTES）；真正上传的是裁好的 512 图。
let MAX_PICKED_PHOTO_BYTES: Int64 = 10 * 1024 * 1024

/// 选好的文件能不能进裁剪（网页 choosePhoto）：不是图片、超过 10 MB 的直接提示。读不到大小时交给解码去判断。
func checkPickedPhoto(mimeType: String?, size: Int64?) -> PhotoError? {
    guard let mimeType, mimeType.hasPrefix("image/") else { return .notImage }
    if let size, size > MAX_PICKED_PHOTO_BYTES { return .tooLarge }
    return nil
}

/// 侧栏底部的账号。登录 / 退出都会换身份，成功后由界面通知聊天页重新加载（onIdentityChanged）。
/// Google 的账号选择框要界面层来弹，所以"拿 ID 令牌"由外面注入（[requestGoogleIdToken]）。
@MainActor
@Observable
final class AccountViewModel {
    /// 让用户选 Google 账号并拿到 ID 令牌。[clientId] 是服务端给的 Web 客户端 ID（令牌的 audience），
    /// [nonce] 是服务端发的一次性值。返回 nil 表示用户关掉了选择框；出错就抛。
    typealias GoogleIdTokenRequest = @MainActor (_ clientId: String, _ nonce: String) async throws -> String?

    private(set) var state = AccountUiState()

    @ObservationIgnored private let backend: AccountBackend
    @ObservationIgnored private let profile: AccountProfileBackend
    @ObservationIgnored private let requestGoogleIdToken: GoogleIdTokenRequest?
    @ObservationIgnored private let sleep: (Int) async throws -> Void
    @ObservationIgnored private let work = PendingWork()

    // 和网页 account-store 一样：服务端确认过的资料 + 还没确认的编辑，界面看到的是两者叠起来的结果（先显示，后保存）。
    @ObservationIgnored private var confirmed: AccountUser?
    @ObservationIgnored private var pending: [(id: Int, edit: ProfileEdit)] = []
    @ObservationIgnored private var nextEditId = 0

    // 资料和照片按发出的顺序一个一个送，旧的回复不会盖掉新的编辑；退出前也等它们送完。
    @ObservationIgnored private let saves = SerialWorkQueue()

    /// - Parameters:
    ///   - requestGoogleIdToken: 没配 Google 登录的安装包传 nil：登录窗口只有邮箱验证码。
    ///   - sleep: 等这么多毫秒（被取消时抛错）；测试里换成假的。
    init(
        backend: AccountBackend,
        profile: AccountProfileBackend,
        requestGoogleIdToken: GoogleIdTokenRequest? = nil,
        sleep: @escaping (Int) async throws -> Void = { try await Task.sleep(nanoseconds: UInt64(max($0, 0)) * 1_000_000) }
    ) {
        self.backend = backend
        self.profile = profile
        self.requestGoogleIdToken = requestGoogleIdToken
        self.sleep = sleep
        state.googleEnabled = requestGoogleIdToken != nil
        refresh()
    }

    /// 等自己发起的请求都结束（单元测试用）。
    func idle() async {
        await work.idle()
    }

    private func publish() {
        let user = confirmed.map { base in pending.reduce(base) { applyProfileEdit($0, $1.edit) } }
        if state.user != user { state.user = user }
    }

    private func setConfirmed(_ user: AccountUser?) {
        confirmed = user
        if user == nil { pending.removeAll() }
        publish()
    }

    private func applyAccount(_ response: AccountResponse) {
        state.loaded = true
        state.configured = response.configured
        state.googleClientId = response.googleClientId
        // 网页 SignInDialog：showGoogle = account.google !== false，showEmail = Boolean(account.email)。
        state.googleEnabled = response.google != false && requestGoogleIdToken != nil
        state.emailEnabled = response.email == true
        state.appleEnabled = response.apple == true
        state.appStoreBilling = response.appStoreBilling == true
        setConfirmed(response.user)
    }

    func refresh() {
        work.launch { [weak self] in
            guard let self, let response = try? await self.backend.account() else { return }
            self.applyAccount(response)
        }
    }

    /// 先要 nonce，再让用户选账号，最后把令牌交给服务端。用户关掉选择框不算失败，也不通知。
    func signIn(onSignedIn: @escaping @MainActor () -> Void) {
        guard let requestGoogleIdToken, let clientId = state.googleClientId, !state.signingIn else { return }
        state.signingIn = true
        state.signInFailed = false
        work.launch { [weak self] in
            guard let self else { return }
            do {
                let nonce = try await self.backend.nativeSignInNonce()
                if let idToken = try await requestGoogleIdToken(clientId, nonce) {
                    try await self.backend.nativeSignIn(idToken: idToken)
                    let account = try await self.backend.account()
                    self.applyAccount(account)
                    onSignedIn()
                }
            } catch is CancellationError {
                // 取消不算失败。
            } catch {
                self.state.signInFailed = true
            }
            self.state.signingIn = false
        }
    }

    func signInWithApple(
        request: @escaping @MainActor (String) async throws -> (code: String, name: String?)?,
        beforeIdentityChange: @escaping @MainActor () async throws -> Void,
        onSignedIn: @escaping @MainActor () -> Void
    ) {
        guard state.appleEnabled, !state.signingIn else { return }
        state.signingIn = true
        work.launch { [weak self] in
            guard let self else { return }
            defer { self.state.signingIn = false }
            do {
                let nonce = try await self.backend.appleSignInNonce()
                guard let value = try await request(nonce) else { return }
                try await beforeIdentityChange()
                try await self.backend.appleSignIn(code: value.code, name: value.name)
                do {
                    self.applyAccount(try await self.backend.account())
                } catch {
                    self.retryAccountLater()
                }
                onSignedIn()
            } catch is CancellationError {
                // 取消不算失败。
            } catch {
                self.state.signInFailed = true
            }
        }
    }

    /// 邮箱登录第一步：发验证码（网页 SignInDialog.sendCode）。成功返回 nil，失败返回原因。
    func sendEmailCode(_ email: String, locale: String) async -> SignInError? {
        await emailStep { try await self.backend.emailSignInStart(email: email, locale: locale) }
    }

    /// 邮箱登录第二步：核对验证码（网页 SignInDialog.verify）。成功后和 Google 登录一样重新读账号、通知换了身份，返回 nil。
    /// [beforeIdentityChange] 在验证码通过、身份真正换掉之前做完（把打开的笔记存掉）。
    func verifyEmailCode(
        _ email: String,
        _ code: String,
        beforeIdentityChange: @MainActor () async throws -> Void,
        onSignedIn: @escaping @MainActor () -> Void
    ) async -> SignInError? {
        // 存笔记失败不是网络问题，也还没核对验证码：按"出了点问题"报，不继续换身份。
        do {
            try await beforeIdentityChange()
        } catch {
            return .generic
        }
        // 放在自己的任务里跑完：验证码一通过会话就换了，登录窗口这时关掉（它的任务被取消）也要把"换了身份"通知出去。
        let task = Task { @MainActor [self] () -> SignInError? in
            await self.emailStep {
                try await self.backend.emailSignInVerify(email: email, code: code)
                // 读不到账号也算登录成功，不把它报成验证码错误；过一会儿再读，免得侧栏一直停在"登录"。
                do {
                    self.applyAccount(try await self.backend.account())
                } catch {
                    self.retryAccountLater()
                }
                onSignedIn()
            }
        }
        return await task.value
    }

    // 登录成功但账号没读到：隔 2、4、8 秒再读，读到就停。
    private func retryAccountLater() {
        work.launch { [weak self] in
            for seconds in [2, 4, 8] {
                guard let self else { return }
                do {
                    try await self.sleep(seconds * 1000)
                } catch {
                    return
                }
                if Task.isCancelled { return }
                guard let response = try? await self.backend.account() else { continue }
                self.applyAccount(response)
                return
            }
        }
    }

    /// 打开登录窗口时清掉上一次 Google 登录失败的提示（网页的 failed 是窗口自己的状态，每次打开都是新的）。
    func clearSignInFailed() {
        if state.signInFailed { state.signInFailed = false }
    }

    // 网页 post()：服务端给了原因就用原因，没有就是 "Something went wrong. Try again."；连不上是 "Check your connection and try again."。
    private func emailStep(_ block: @MainActor () async throws -> Void) async -> SignInError? {
        do {
            try await block()
            return nil
        } catch let error as ApiException {
            return error.serverMessage().map(SignInError.server) ?? .generic
        } catch {
            return .offline
        }
    }

    /// 永久删除账号（网页设置的 DeleteAccount）。成功返回 nil，之后和退出一样回到未登录；失败返回原因，账号不变。
    /// 删除排在保存队列（[saves]）里：资料的保存不会和删除同时进行，也不会在删除后发出。
    func deleteAccount(clearDeviceChoice: @escaping @MainActor () async -> Void) async -> Error? {
        // 等保存的队列空出来，删除结束之前一直占着（删除之后才到的 PATCH 会造出一个空账号）。
        let backend = self.backend
        let failure: Error? = await saves.run {
            do {
                try await backend.deleteAccount()
                return nil
            } catch {
                return error
            }
        }
        if let failure { return failure }
        await clearDeviceChoice()
        state.profileError = nil
        state.photoError = nil
        state.uploading = false
        setConfirmed(nil)
        refresh()
        return nil
    }

    func signOut(clearDeviceChoice: @escaping @MainActor () async -> Void, onSignedOut: @escaping @MainActor () -> Void) {
        if state.signingOut { return }
        state.signingOut = true
        // 网页 settled()：刚改的名字 / 图标 / 照片先送完再退出（退出后再送会 401）。排队在这一刻就定下来。
        let settled = saves.enqueue {}
        work.launch { [weak self] in
            await settled.value
            guard let self else { return }
            await clearDeviceChoice()
            // 退出不会失败：服务端没应答也照样清掉本机的登录状态。
            try? await self.backend.signOut()
            self.state.profileError = nil
            self.state.photoError = nil
            self.state.uploading = false
            self.setConfirmed(nil)
            onSignedOut()
            self.refresh()
            self.state.signingOut = false
        }
    }

    /// 改名字；空字符串或与 Google 名字相同时恢复为 Google 的名字（和网页 ProfileMenu.commitName 一样）。
    func saveName(_ draft: String) {
        guard let user = state.user else { return }
        let next = normalizeDisplayName(draft)
        let value: String? = next.isEmpty || next == (user.googleName ?? "") ? nil : next
        if value == user.displayName { return }
        save(.name(value))
    }

    /// 选表情头像；nil 是"使用 Google 头像"，照片栏的"移除我的照片"也走这里（网页 onSave({ icon: null })）。
    func setIcon(_ icon: String?) {
        save(.icon(icon))
    }

    func resetToGoogle() {
        save(.resetToGoogle)
    }

    /// 设置里选界面语言（en / zh / zh-Hant / ja…）：和名字一样先显示、排队保存。真正的切换由语言同步
    /// （`LanguageController.syncWithAccount`）跟着账号上的语言做；保存失败时账号的语言退回原值，同步再把界面切回去。
    func setLocale(_ code: String?) {
        save(.locale(code))
    }

    /// 网页 saveProfile：马上显示，排队发送；已经是这个状态就什么也不做。
    private func save(_ edit: ProfileEdit) {
        guard let current = state.user, profileEditChanges(current, edit) else { return }
        let id = nextEditId
        nextEditId += 1
        pending.append((id, edit))
        state.profileError = nil
        publish()
        let task = saves.enqueue { [weak self] in
            guard let self else { return }
            do {
                let user = try await self.profile.updateProfile(edit)
                if self.confirmed != nil { self.confirmed = user }
                self.state.profileError = nil
            } catch is CancellationError {
                // 不报错，只撤掉这一次编辑。
            } catch {
                // 只撤掉失败的这一次编辑，后面排着的照常（网页 sendPatch）。
                self.state.profileError = (error as? ApiException)?.serverMessage().map(ProfileError.server) ?? .couldNotSave
            }
            // 按编号比对：同样内容的编辑连发两次时只去掉这一次的那一个。
            self.pending.removeAll { $0.id == id }
            self.publish()
        }
        work.launch { await task.value }
    }

    /// 上传裁好的照片（网页 uploadPhoto，和资料保存排在同一个队列里）。成功后调用 [onSaved]（菜单收起照片栏），
    /// 失败把原因放进 [AccountUiState.photoError]。
    func uploadPhoto(_ bytes: Data, mimeType: String, onSaved: @escaping @MainActor () -> Void) {
        if state.uploading { return }
        state.uploading = true
        state.photoError = nil
        let task = saves.enqueue { [weak self] in
            guard let self else { return }
            do {
                let user = try await self.profile.uploadAvatar(bytes: bytes, mimeType: mimeType)
                if self.confirmed != nil { self.confirmed = user }
                self.state.profileError = nil
                self.state.uploading = false
                self.publish()
                onSaved()
            } catch is CancellationError {
                self.state.uploading = false
            } catch let error as ApiException {
                self.state.uploading = false
                self.state.photoError = error.serverMessage().map(PhotoError.server) ?? .uploadFailed
            } catch {
                self.state.uploading = false
                self.state.photoError = .offline
            }
        }
        work.launch { await task.value }
    }

    /// 设置窗口打开时读方案和本期用量（网页 PlanSettings 的 loadPlan）。
    func loadPlan() async -> Result<PlanInfo, Error> {
        do {
            return .success(try await profile.plan())
        } catch {
            return .failure(error)
        }
    }

    /// 设置窗口打开时读自定义指令（没有设置时是空字符串）。失败时把原因交给界面显示。
    func loadCustomInstructions() async -> Result<String, Error> {
        do {
            return .success(try await profile.customInstructions() ?? "")
        } catch {
            return .failure(error)
        }
    }

    /// 保存自定义指令（网页 SettingsDialog.save：发去掉首尾空白后的文字）。成功返回 nil，失败返回原因。
    func saveCustomInstructions(_ text: String) async -> Error? {
        do {
            _ = try await profile.saveCustomInstructions(ApiText.trim(text))
            return nil
        } catch {
            return error
        }
    }

    func showPhotoError(_ error: PhotoError?) {
        if state.photoError != error { state.photoError = error }
    }

    /// 打开个人资料时清掉上一次的错误（网页 clearSaveError；照片栏的提示随菜单一起消失）。
    func clearProfileError() {
        state.profileError = nil
        state.photoError = nil
    }
}

/// 名字里连续的空白（空格、制表、换行）并成一个空格，再去掉首尾空白（网页 commitName 的 `replace(/\s+/g, " ").trim()`）。
func normalizeDisplayName(_ draft: String) -> String {
    var scalars = String.UnicodeScalarView()
    var inSpace = false
    for scalar in draft.unicodeScalars {
        if scalar.properties.isWhitespace {
            if !inSpace { scalars.append(" ") }
            inSpace = true
        } else {
            scalars.append(scalar)
            inSpace = false
        }
    }
    return ApiText.trim(String(scalars))
}
