import Foundation
import Observation

// 设置画面里不画界面的部分（Android ui/SettingsDialog.kt、ui/SettingsParts.kt、ui/AccountUi.kt、ui/DeleteAccountSection.kt）。

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
    var hasGoogleProfile: Bool { googleName != nil || image != nil }
    /// 名字输入框里的名字：自己起的，没有就是 Google 的。
    var savedName: String { displayName ?? googleName ?? "" }
    /// 侧栏账号行上的名字；都没有时界面用 "account" 这句文案。
    var rowName: String? { name ?? email }
}

extension AccountUiState {
    /// 侧栏底部按未登录的样子显示（帮助菜单里有语言项、切换失败的红字）。账号读到之前不算，免得登录用户看到一下（网页 guest）。
    var guest: Bool { loaded && (!configured || user == nil) }
}

struct SettingsDialogState: Equatable, Sendable {
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

/// 设置画面的状态（网页 SettingsDialog）。资料、语言和图标改了就存；只有自定义指令要按"保存"：
/// 改了以后下方浮出"未保存的更改"条，保存或放弃之前不关（返回只让那条晃一下）。
/// 关闭：保存中、删除中、选照片 / 上传照片时不关；头像编辑区开着时先只关编辑区。不管怎么关，输入中的名字都先存掉。
@MainActor
@Observable
final class SettingsDialogModel {
    private(set) var state = SettingsDialogState()

    @ObservationIgnored private let account: AccountViewModel
    @ObservationIgnored private let onSignOut: @MainActor () -> Void
    @ObservationIgnored private let deleteAccount: @MainActor () async -> Error?
    @ObservationIgnored private let onClose: @MainActor () -> Void
    @ObservationIgnored private let work = PendingWork()
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
        load()
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

    // ---- 关闭 ----

    /// 返回手势 / 点外面（网页 close）。
    func requestClose() {
        if state.busy || state.deleting || state.pickerOpen || account.state.uploading { return }
        if state.editor != .closed {
            // 编辑区开着（包括选好照片在裁剪）：先只关编辑区（网页 closeGuard）。
            setEditor(.closed)
        } else if state.appIconPicking {
            state.appIconPicking = false
        } else if dirty {
            state.attention += 1
        } else {
            closeNow()
        }
    }

    /// 顶栏的返回（网页 closeAll）：头像编辑区开着也一起关；选了照片还没存、在上传时不关。
    func closeAll() {
        if state.busy || state.deleting || photoBusy { return }
        if dirty {
            state.attention += 1
        } else {
            closeNow()
        }
    }

    private func closeNow() {
        account.saveName(state.nameDraft)
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
        state.editor = next
        state.picked = false
        account.showPhotoError(nil)
    }

    /// "上传照片"：界面接着打开系统的照片选择器。
    func pickPhoto() {
        state.pickerOpen = true
    }

    /// 选择器关了、什么都没选。
    func pickerCancelled() {
        state.pickerOpen = false
    }

    /// 选好了一个文件：不是图片、超过 10 MB 的直接提示；可以的话返回 true，界面进入裁剪。
    @discardableResult
    func photoPicked(mimeType: String?, size: Int64?) -> Bool {
        state.pickerOpen = false
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
