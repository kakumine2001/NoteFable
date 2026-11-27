import Foundation
import Observation

// 设置画面里不画界面的部分（Android ui/SettingsDialog.kt、ui/SettingsNav.kt、ui/SettingsParts.kt、ui/AccountUi.kt、ui/DeleteAccountSection.kt）。

/// 有没有没保存的改动：和读到的一样（去掉首尾空白后）就没有（网页 SettingsDialog 的 dirty）。
func customInstructionsChanged(_ initial: String, _ draft: String) -> Bool {
    ApiText.trim(draft) != initial
}

/// 网页 MAX_DISPLAY_NAME（按 UTF-16 计）。
let MAX_DISPLAY_NAME = 40

/// 头像编辑区（网页 ProfileMenu 的 Editor）。
enum AvatarEditor: Equatable, Sendable {
    case closed, photo, emoji
}

/// 系统选择器里只列这四种图片（网页 `<input type=file accept=…>`）。
let AVATAR_PICK_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]

/// 一次请求失败的原因，留给界面显示：服务端给了原句就用原句（经系统文词典翻译），否则用各处自己的兜底文。
struct RequestFailure: Equatable, Sendable {
    /// 服务端的英文原句；没有（断网、只有 "HTTP 500"）时是 nil。
    var serverMessage: String?

    init(_ error: Error) {
        serverMessage = (error as? ApiException)?.serverMessage()
    }

    init(serverMessage: String?) {
        self.serverMessage = serverMessage
    }

    func text(_ fallbackKey: String, _ system: SystemTextTranslator) -> String {
        serverMessage.map { system.localize($0) } ?? L(fallbackKey)
    }
}

func profileErrorText(_ error: ProfileError, _ system: SystemTextTranslator) -> String {
    switch error {
    case .server(let message): return system.localize(message)
    case .couldNotSave: return L("acct_could_not_save")
    }
}

func photoErrorText(_ error: PhotoError, _ system: SystemTextTranslator) -> String {
    switch error {
    case .notImage: return L("acct_choose_image")
    case .tooLarge: return L("acct_photo_too_big")
    case .uploadFailed: return L("acct_upload_failed")
    case .offline: return L("acct_upload_offline")
    case .server(let message): return system.localize(message)
    }
}

extension AccountUser {
    /// 改过名字或头像（"使用我的 Google 名称和头像"只在这时、且有 Google 资料时出现）。
    var customized: Bool { displayName != nil || icon != nil || avatarUrl != nil }
    /// 邮箱登录的人没有 Google 的名字和照片：只有有 Google 资料时才出现"恢复成 Google 的"这类文字。
    var hasGoogleProfile: Bool { appleProfile != true && (googleName != nil || image != nil) }
    /// 名字输入框里的名字：自己起的，没有就是 Google 的。
    var savedName: String { displayName ?? googleName ?? "" }
    /// 侧栏账号行上的名字；都没有时界面用 "account" 这句文案。
    var rowName: String? { name ?? email }
    /// 设置入口列表最上面那一行（网页 .settings-identity）名字下面的邮箱：没有邮箱、或名字那一行写的就是邮箱时不显示
    /// （网页 `user.email && user.email !== name`）。
    var identityEmail: String? {
        guard let email, !email.isEmpty, email != rowName else { return nil }
        return email
    }
}

extension AccountUiState {
    /// 侧栏底部按未登录的样子显示（帮助菜单里有语言项、切换失败的红字）。账号读到之前不算，免得登录用户看到一下（网页 guest）。
    var guest: Bool { loaded && (!configured || user == nil) }
}

/// 设置的五栏（网页 settings-dialog.tsx 的 Tab）。
enum SettingsPage: String, CaseIterable, Equatable, Sendable {
    case general, personalization, plan, account, help

    /// 入口列表的行和那一栏顶栏的标题（网页 TABS 的 label）。
    var titleKey: String {
        switch self {
        case .general: return "settings_general"
        case .personalization: return "settings_personalization"
        case .plan: return "plan_title"
        case .account: return "account"
        case .help: return "help"
        }
    }

    /// 入口列表卡片里显示的各栏（"账号"由顶部的账号卡进入，不重复列在下方卡片里；访客只显示通用与帮助）。
    static func homePages(signedIn: Bool) -> [SettingsPage] {
        signedIn ? [.general, .personalization, .plan, .help] : [.general, .help]
    }
}

// 按"关闭 / 返回"以后做什么：和网页 src/lib/settings-navigation.ts（Android ui/SettingsNav.kt）是同一套规则，
// 网页那边改了这里跟着改。这里只有规则；照着结果去做的是 `SettingsDialogModel`。

/// 按了以后做什么（网页 SettingsStep）。
enum SettingsStep: Equatable, Sendable {
    /// 什么都不做（保存中、删除中）。
    case stay
    /// 显示那一栏，不关设置。`attention`：让"未保存的更改"条晃一下。
    case show(SettingsPage, attention: Bool)
    /// 从某一栏回到入口列表。
    case home
    /// 关掉设置。
    case close
}

/// 网页的 Esc / 返回键 / 点外面（settingsDismissStep）；iOS 上是读屏的"返回"手势。一次只退一步：
/// 先收起开着的头像编辑区 / 角色选择（`editorIn` 是它所在的那一栏，收起由调用的一方做），再从一栏回到列表，最后关掉设置。
/// 有没保存的自定义指令时既不回列表也不关（不会不声不响地丢掉）。
func settingsDismissStep(locked: Bool, editorIn: SettingsPage?, onPage: Bool, dirty: Bool) -> SettingsStep {
    if locked { return .stay }
    if let editorIn { return .show(editorIn, attention: false) }
    if dirty { return .show(.personalization, attention: true) }
    return onPage ? .home : .close
}

/// 顶栏的按钮（settingsButtonStep）：入口列表上的"关闭"（`onPage` = false）和一栏里的"返回"（`onPage` = true）。
/// 开着的编辑区一次全关，不像上面那样一步一步退。照片在裁剪或上传时（`photoBusy`）不走，显示"账号"那一栏。
func settingsButtonStep(locked: Bool, photoBusy: Bool, onPage: Bool, dirty: Bool) -> SettingsStep {
    if locked { return .stay }
    if photoBusy { return .show(.account, attention: false) }
    if dirty { return .show(.personalization, attention: true) }
    return onPage ? .home : .close
}

struct SettingsDialogState: Equatable, Sendable {
    // ---- 画面 ----
    /// 现在显示的那一栏；nil 是入口列表（网页 home）。
    var page: SettingsPage? = nil
    /// 换过画面没有（网页 navigated）：刚打开时的入口列表不带切换的动画。
    var navigated = false

    // ---- 自定义指令 ----
    /// 读到的指令；nil 是还没读到。
    var initial: String? = nil
    var loadError: RequestFailure? = nil
    var instructions = ""
    /// 正在保存自定义指令。
    var busy = false
    var error: RequestFailure? = nil
    /// 刚保存完：标题右边显示"已保存"，再改就消失。
    var justSaved = false
    /// 没保存就想关的次数：每变一次，"未保存的更改"条晃一下。
    var attention = 0

    // ---- 个人资料 ----
    var nameDraft = ""
    /// 名字输入框有焦点。
    var editingName = false
    var editor: AvatarEditor = .closed
    /// 选好了照片、正在裁剪（照片本身由界面层拿着）。
    var picked = false
    /// 系统选择器开着：返回键 / 点外面不关设置（网页 filePickerOpen）。
    var pickerOpen = false
    /// 设置里"图标"的表情选择框开着：返回键先只关它。
    var appIconPicking = false

    // ---- 删除账号 ----
    /// "删除账号"换成了确认区。
    var confirmingDelete = false
    /// 正在删除账号：和保存中一样不关、不让按其他按钮。
    var deleting = false
    var deleteError: RequestFailure? = nil
}

/// 设置画面的状态（网页 SettingsDialog 的手机宽度）。两级：先是入口列表（`state.page == nil`），点一行进那一栏（`show`），
/// 那一栏顶栏的返回回到列表（`backHome`），列表顶栏的关闭关掉设置（`closeAll`）。
/// 资料、语言和图标改了就存；只有自定义指令要按"保存"：改了以后下方浮出"未保存的更改"条，保存或放弃之前
/// 不关、也不回列表（留在"个性化"，只让那条晃一下）。
/// 保存中、删除中什么都不动；选了照片还没存、在上传时不关也不回列表，改为显示"账号"那一栏。
/// 以前"把某一栏滚到眼前"的地方（自定义指令保存失败、上面这些拦下来的情况）现在都是切到那一栏。
/// 不管怎么关、怎么离开"账号"那一栏，输入中的名字都先存掉。
@MainActor
@Observable
final class SettingsDialogModel {
    private(set) var state = SettingsDialogState()

    @ObservationIgnored private let account: AccountViewModel
    @ObservationIgnored private let onSignOut: @MainActor () -> Void
    @ObservationIgnored private let deleteAccount: @MainActor () async -> Error?
    @ObservationIgnored private let onClose: @MainActor () -> Void
    @ObservationIgnored private let work = PendingWork()
    /// 选照片的"代"：每次开始选、换编辑页、换画面都加一。界面开始读照片时记下它，读完交回来对一下（见 `photoPicked`）。
    @ObservationIgnored private(set) var photoPickToken = 0
    @ObservationIgnored private var attempt = 0

    /// - Parameters:
    ///   - onSignOut: 退出登录（调用方做 `AccountViewModel.signOut`，连同忘掉本机语言、通知换身份）。
    ///   - deleteAccount: 永久删除账号（调用方做 `AccountViewModel.deleteAccount` 和之后的换身份）；成功返回 nil。
    ///   - onClose: 关掉设置画面。
    init(
        account: AccountViewModel,
        onSignOut: @escaping @MainActor () -> Void,
        deleteAccount: @escaping @MainActor () async -> Error?,
        onClose: @escaping @MainActor () -> Void
    ) {
        self.account = account
        self.onSignOut = onSignOut
        self.deleteAccount = deleteAccount
        self.onClose = onClose
        // 网页 clearSaveError：上一次的失败提示不带进新打开的设置。
        account.clearProfileError()
        state.nameDraft = account.state.user?.savedName ?? ""
        if account.state.user != nil {
            load()
        }
    }

    // ---- 界面要显示的 ----

    var dirty: Bool { state.initial.map { customInstructionsChanged($0, state.instructions) } ?? false }
    /// 标题右边显示"已保存"（save_saved）；否则读到后显示计数。
    var saved: Bool { state.justSaved && !dirty }
    /// 自定义指令的计数（读到后才有；按 UTF-16 计）。
    var instructionsCount: String? {
        state.initial == nil ? nil : "\(state.instructions.utf16.count)/\(MAX_CUSTOM_INSTRUCTIONS)"
    }
    /// 选了照片还没存、或正在上传：网页 photoBusy。
    var photoBusy: Bool { state.picked || account.state.uploading }
    var signOutEnabled: Bool { !state.busy && !state.deleting && !photoBusy && !account.state.signingOut }
    var deleteEnabled: Bool { !state.busy && !photoBusy && !account.state.signingOut }
    /// "使用我的 Google 名称和头像"。
    var showResetToGoogle: Bool { account.state.user.map { $0.customized && $0.hasGoogleProfile } ?? false }
    /// 表情页的"移除"项写 acct_use_google_photo；没有 Google 资料的人没有这一项。
    var emojiRemoveLabelKey: String? { account.state.user?.hasGoogleProfile == true ? "acct_use_google_photo" : nil }

    // ---- 自定义指令 ----

    func setInstructions(_ text: String) {
        state.instructions = clipInstructions(text, MAX_CUSTOM_INSTRUCTIONS)
        state.justSaved = false
    }

    func retryLoad() {
        state.loadError = nil
        load()
    }

    func save() {
        if state.busy || !dirty { return }
        let text = ApiText.trim(state.instructions)
        state.busy = true
        state.error = nil
        work.launch { [weak self] in
            guard let self else { return }
            let failure = await self.account.saveCustomInstructions(text)
            self.state.busy = false
            if let failure {
                self.state.error = RequestFailure(failure)
                // 失败的原因显示在"个性化"那一栏：在别的栏按的"保存"也看得到（网页 save 的 catch）。
                self.show(.personalization)
            } else {
                self.state.initial = text
                self.state.justSaved = true
                self.state.attention = 0
            }
        }
    }

    /// "未保存的更改"条的"放弃"。
    func discard() {
        state.instructions = state.initial ?? ""
        state.error = nil
        state.attention = 0
    }

    // ---- 画面的切换 ----

    /// 打开一栏（入口列表的行；网页 show）。
    func show(_ page: SettingsPage) {
        navigate(to: page)
    }

    /// 一栏的顶栏的返回（网页 backHome）：开着的头像编辑区、图标的角色选择一起关掉，一步回到入口列表。
    /// 有没保存的指令时留在"个性化"；选了照片还没存、在上传时显示"账号"那一栏。
    func backHome() {
        let step = settingsButtonStep(locked: locked, photoBusy: photoBusy, onPage: true, dirty: dirty)
        if step == .home {
            if state.editor != .closed { setEditor(.closed) }
            state.appIconPicking = false
        }
        apply(step)
    }

    /// 保存中、删除中：关闭和返回什么都不做（网页 locked）。
    private var locked: Bool { state.busy || state.deleting }

    /// 照规则（`settingsDismissStep` / `settingsButtonStep`）的结果去做（网页 apply）。
    private func apply(_ step: SettingsStep) {
        switch step {
        case .stay:
            break
        case .show(let page, let attention):
            show(page)
            if attention { state.attention += 1 }
        case .home:
            navigate(to: nil)
        case .close:
            closeNow()
        }
    }

    private func navigate(to next: SettingsPage?) {
        let signedIn = account.state.user != nil
        let resolvedNext = next.map { (signedIn || $0 == .general || $0 == .help) ? $0 : .general }
        state.navigated = true
        guard state.page != resolvedNext else { return }
        if state.page == .account, signedIn {
            // 网页点别处时输入框失焦就存了名字；这里那一栏的视图直接没了，等不到失焦。
            account.saveName(state.nameDraft)
            state.editingName = false
            // iOS 特有：网页的各栏只是藏起来（display: none），这里离开的那一栏的视图会被拆掉，界面层手上的照片也跟着没了。
            // 所以选好、等着裁剪的照片不留（正在上传的不受影响，传完照常收起编辑区）；不清的话 photoBusy 一直为真，回不了列表。
            // 正常的返回走不到这里（photoBusy 时不让离开），只有自定义指令保存失败、被带去"个性化"时才会。
            if state.picked { cancelCrop() }
        }
        // 系统选择器属于离开的那一栏，跟着视图一起关了；还在读的照片也不要了。
        state.pickerOpen = false
        photoPickToken += 1
        state.page = resolvedNext
    }

    // ---- 关闭 ----

    /// 读屏的"返回"手势（网页 close：Esc / 返回键）：一次退一步。
    func requestClose() {
        // 系统选择器开着时不动（网页 filePickerOpen；它盖着整个画面，本来也按不到）。
        if locked || state.pickerOpen { return }
        let signedIn = account.state.user != nil
        // 网页先问 profileGuard、再问 iconGuard：开着的编辑区先只关它自己；在别的栏时切到它所在的那一栏，看得到发生了什么。
        var editorIn: SettingsPage? = nil
        if signedIn, account.state.uploading {
            // 上传中：只显示"账号"，不收编辑区。
            editorIn = .account
        } else if signedIn, state.editor != .closed {
            // 包括选好照片在裁剪。
            setEditor(.closed)
            editorIn = .account
        } else if state.appIconPicking {
            state.appIconPicking = false
            editorIn = .general
        }
        apply(settingsDismissStep(locked: false, editorIn: editorIn, onPage: state.page != nil, dirty: dirty))
    }

    /// 入口列表顶栏的关闭（网页 closeAll）：有没保存的指令时不关，显示"个性化"；选了照片还没存、在上传时不关，显示"账号"那一栏。
    func closeAll() {
        apply(settingsButtonStep(locked: locked, photoBusy: photoBusy, onPage: false, dirty: dirty))
    }

    private func closeNow() {
        if account.state.user != nil {
            account.saveName(state.nameDraft)
        }
        resetTransient()
        account.showPhotoError(nil)
        onClose()
    }

    private func resetTransient() {
        state.editor = .closed
        state.picked = false
    }

    // ---- 名字 ----

    func setNameDraft(_ text: String) {
        state.nameDraft = clipUtf16(text, MAX_DISPLAY_NAME)
    }

    /// 输入框得到 / 失去焦点：失焦时保存。
    func nameFocusChanged(_ focused: Bool) {
        if state.editingName, !focused { account.saveName(state.nameDraft) }
        state.editingName = focused
    }

    /// 键盘的"完成"。
    func submitName() {
        account.saveName(state.nameDraft)
    }

    /// 账号的资料变了（保存成功、失败回滚）时由界面调用：没在编辑时输入框跟着保存后的名字走
    /// （保存失败回滚时不盖掉用户接着输入、还没发出的文字）。
    func userChanged() {
        guard !state.editingName, let user = account.state.user else { return }
        if state.nameDraft != user.savedName { state.nameDraft = user.savedName }
    }

    func resetToGoogle() {
        state.nameDraft = account.state.user?.googleName ?? ""
        account.resetToGoogle()
    }

    // ---- 头像 ----

    /// 点头像：打开编辑区（照片页），再点关上。
    func toggleEditor() {
        setEditor(state.editor == .closed ? .photo : .closed)
    }

    func setEditor(_ next: AvatarEditor) {
        photoPickToken += 1
        state.editor = next
        state.picked = false
        account.showPhotoError(nil)
    }

    /// "上传照片"：界面接着打开系统的照片选择器。
    func pickPhoto() {
        photoPickToken += 1
        state.pickerOpen = true
    }

    /// 选择器关了、什么都没选。
    func pickerCancelled() {
        state.pickerOpen = false
    }

    /// 选好了一个文件：不是图片、超过 10 MB 的直接提示；可以的话返回 true，界面进入裁剪。
    /// `token` 是开始读这张照片时的 `photoPickToken`：读的途中换了编辑页、离开过"账号"那一栏、又选了一次的，
    /// 这张照片已经不是现在这个界面要的（读它的那个视图也已经不在了），不进入裁剪。不传就不查（只有单元测试这样用）。
    @discardableResult
    func photoPicked(mimeType: String?, size: Int64?, token: Int? = nil) -> Bool {
        if let token, token != photoPickToken { return false }
        state.pickerOpen = false
        // 照片读完时已经不在"账号"那一栏（裁剪界面不在了）：不进入裁剪，见 `navigate`。
        guard state.page == .account else { return false }
        let problem = checkPickedPhoto(mimeType: mimeType, size: size)
        account.showPhotoError(problem)
        if problem == nil { state.picked = true }
        return problem == nil
    }

    func cancelCrop() {
        state.picked = false
        account.showPhotoError(nil)
    }

    /// 裁好了：上传；成功后收起编辑区。
    func uploadPhoto(_ bytes: Data, mimeType: String = AVATAR_MIME_TYPE) {
        account.uploadPhoto(bytes, mimeType: mimeType) { [weak self] in
            self?.resetTransient()
        }
    }

    /// 照片页的"移除我的照片"、表情页的"使用 Google 头像"。
    func removePhoto() {
        account.setIcon(nil)
    }

    func setAppIconPicking(_ picking: Bool) {
        state.appIconPicking = picking
    }

    // ---- 账号 ----

    /// "退出登录"：输入中的名字先排进保存队列（signOut 会等它发完），先关设置再退出。
    /// 退出不会失败，所以退出期间不会再有编辑或第二次点击。
    func signOut() {
        guard signOutEnabled else { return }
        account.saveName(state.nameDraft)
        resetTransient()
        onClose()
        onSignOut()
    }

    /// "删除账号"：在原地换成确认区。
    func startDelete() {
        if deleteEnabled { state.confirmingDelete = true }
    }

    func cancelDelete() {
        if state.deleting { return }
        state.confirmingDelete = false
        state.deleteError = nil
    }

    /// "永久删除"。成功后关掉设置；失败留在确认区显示原因（兜底文 acct_err_delete_account）。
    func confirmDelete() {
        if state.deleting { return }
        state.deleting = true
        state.deleteError = nil
        work.launch { [weak self] in
            guard let self else { return }
            let failure = await self.deleteAccount()
            self.state.deleting = false
            if let failure {
                self.state.deleteError = RequestFailure(failure)
            } else {
                self.closeNow()
            }
        }
    }

    func idle() async {
        await work.idle()
    }

    private func load() {
        attempt += 1
        let current = attempt
        work.launch { [weak self] in
            guard let self else { return }
            let result = await self.account.loadCustomInstructions()
            guard current == self.attempt else { return }
            switch result {
            case .success(let text):
                self.state.initial = text
                self.state.instructions = text
            case .failure(let error):
                if !(error is CancellationError) { self.state.loadError = RequestFailure(error) }
            }
        }
    }
}
