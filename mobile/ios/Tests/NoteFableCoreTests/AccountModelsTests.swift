import Foundation
import XCTest
@testable import NoteFableCore

// 登录窗口、设置、方案、举报这几个小状态机，和语言同步的衔接（Android 里这些状态写在各个 Composable 里，没有单独的测试）。

@MainActor
private final class StubAccount: AccountBackend, AccountProfileBackend {
    var user: AccountUser?
    var calls: [String] = []
    var failEmail: Error?
    var failDelete: Error?
    var instructions: String?
    var failInstructions: Error?
    var planResult: Result<PlanInfo, Error> = .success(PlanInfo())
    var gate: TestGate?

    func account() async throws -> AccountResponse {
        AccountResponse(configured: true, user: user, googleClientId: "web-client", email: true)
    }

    func nativeSignInNonce() async throws -> String { "n1" }

    func nativeSignIn(idToken: String) async throws {
        await gate?.pass()
        user = AccountUser(name: "Ann", googleName: "Ann")
    }

    func emailSignInStart(email: String, locale: String) async throws {
        calls.append("start:\(email):\(locale)")
        await gate?.pass()
        if let failEmail { throw failEmail }
    }

    func emailSignInVerify(email: String, code: String) async throws {
        calls.append("verify:\(email):\(code)")
        if let failEmail { throw failEmail }
        user = AccountUser(email: email)
    }

    func signOut() async throws {
        calls.append("signOut")
        user = nil
    }

    func deleteAccount() async throws {
        calls.append("delete")
        if let failDelete { throw failDelete }
        user = nil
    }

    func updateProfile(_ edit: ProfileEdit) async throws -> AccountUser {
        calls.append("patch")
        let next = applyProfileEdit(user ?? AccountUser(), edit)
        user = next
        return next
    }

    func uploadAvatar(bytes: Data, mimeType: String) async throws -> AccountUser {
        calls.append("upload:\(mimeType)")
        await gate?.pass()
        var next = user ?? AccountUser()
        next.avatarUrl = "/api/account/avatar?v=2"
        user = next
        return next
    }

    func customInstructions() async throws -> String? {
        if let failInstructions { throw failInstructions }
        return instructions
    }

    func saveCustomInstructions(_ instructions: String) async throws -> String? {
        calls.append("instructions:\(instructions)")
        await gate?.pass()
        if let failInstructions { throw failInstructions }
        self.instructions = instructions.isEmpty ? nil : instructions
        return self.instructions
    }

    func plan() async throws -> PlanInfo {
        try planResult.get()
    }
}

@MainActor
private final class Log {
    var list: [String] = []
    func add(_ event: String) { list.append(event) }
}

@MainActor
private final class StubReports: ReportBackend {
    var sent: [String] = []
    var fail: Error?
    var gate: TestGate?

    func report(_ target: ReportTarget, reason: String) async throws {
        await gate?.pass()
        if let fail { throw fail }
        let field = target.field
        sent.append("\(field.name)=\(field.id):\(reason)")
    }
}

private final class MemoryStore: LanguagePreferenceStore {
    var code: String?
    func load() -> String? { code }
    func save(_ code: String?) { self.code = code }
}

final class AccountModelsTests: XCTestCase {
    @MainActor
    private func account(_ stub: StubAccount) async -> AccountViewModel {
        let vm = AccountViewModel(backend: stub, profile: stub, requestGoogleIdToken: { _, _ in "tok" }, sleep: { _ in })
        await vm.idle()
        return vm
    }

    private let system = SystemText.empty.translator("en")

    // ---- 登录窗口 ----

    @MainActor
    func testTheEmailFlowSendsACodeMovesToTheCodeStepAndClosesAfterVerifying() async {
        let stub = StubAccount()
        let vm = await account(stub)
        let log = Log()
        let model = SignInDialogModel(
            account: vm, beforeIdentityChange: { log.add("flush") }, onSignedIn: { log.add("signedIn") },
            onClose: { log.add("close") }, uiLocale: { "ja" }
        )
        XCTAssertTrue(model.showGoogle)
        XCTAssertTrue(model.showEmail)
        XCTAssertTrue(model.showDivider)
        XCTAssertFalse(model.canSendCode)
        model.setEmail("a@example.test")
        XCTAssertTrue(model.canSendCode)

        let gate = TestGate()
        stub.gate = gate
        model.sendCode()
        XCTAssertTrue(model.state.busy)
        XCTAssertEqual(model.sendLabelKey, "signin_sending")
        // 发送期间不能关，也不会再发一次；改了输入框，第二屏仍是发出去的那个地址。
        model.close()
        model.sendCode()
        model.setEmail("other@example.test")
        await gate.entered()
        gate.open()
        await model.idle()
        XCTAssertEqual(stub.calls, ["start:a@example.test:ja"])
        XCTAssertEqual(log.list, [])
        XCTAssertEqual(model.state.step, .code)
        XCTAssertEqual(model.state.sentTo, "a@example.test")
        XCTAssertFalse(model.state.resent)

        model.setCode("12 34")
        XCTAssertFalse(model.canVerify)
        model.verify()
        XCTAssertFalse(model.state.busy)
        model.sendCode(again: true)
        await model.idle()
        XCTAssertTrue(model.state.resent)
        XCTAssertEqual(model.state.code, "")
        XCTAssertEqual(stub.calls.last, "start:a@example.test:ja")

        model.setCode("١٢٣٤٥٦7")
        XCTAssertEqual(model.state.code, "123456")
        XCTAssertTrue(model.canVerify)
        model.verify()
        XCTAssertEqual(model.verifyLabelKey, "signin_signing_in")
        await model.idle()
        XCTAssertEqual(stub.calls.last, "verify:a@example.test:123456")
        XCTAssertEqual(log.list, ["flush", "signedIn", "close"])
        XCTAssertEqual(vm.state.user?.email, "a@example.test")
    }

    @MainActor
    func testEmailFailuresStayInTheDialogAndBackClearsThem() async {
        let stub = StubAccount()
        let vm = await account(stub)
        let log = Log()
        let model = SignInDialogModel(account: vm, beforeIdentityChange: {}, onSignedIn: {}, onClose: { log.add("close") })
        model.setEmail(String(repeating: "a", count: 300))
        XCTAssertEqual(model.state.email.count, MAX_EMAIL_LENGTH)
        stub.failEmail = ApiException(status: 429, message: "Too many attempts. Try again later.")
        model.sendCode()
        await model.idle()
        XCTAssertEqual(model.state.step, .choose)
        XCTAssertEqual(model.state.error, .server("Too many attempts. Try again later."))
        XCTAssertEqual(signInErrorText(.server("Too many attempts. Try again later."), system), "Too many attempts. Try again later.")
        XCTAssertEqual(signInErrorText(.generic, system), "signin_error_generic")
        XCTAssertEqual(signInErrorText(.offline, system), "signin_error_offline")

        stub.failEmail = nil
        model.sendCode()
        await model.idle()
        XCTAssertNil(model.state.error)
        stub.failEmail = TestIOError()
        model.setCode("000000")
        model.verify()
        await model.idle()
        XCTAssertEqual(model.state.error, .offline)
        XCTAssertEqual(log.list, [])
        model.back()
        XCTAssertEqual(model.state.step, .choose)
        XCTAssertNil(model.state.error)
        model.close()
        XCTAssertEqual(log.list, ["close"])
    }

    @MainActor
    func testAGoogleSignInInProgressLocksTheEmailSteps() async {
        let stub = StubAccount()
        let vm = await account(stub)
        let log = Log()
        let model = SignInDialogModel(account: vm, beforeIdentityChange: {}, onSignedIn: { log.add("signedIn") }, onClose: {})
        model.setEmail("a@example.test")
        let gate = TestGate()
        stub.gate = gate
        model.google()
        XCTAssertTrue(model.locked)
        XCTAssertTrue(model.googleBusy)
        XCTAssertFalse(model.canSendCode)
        model.sendCode()
        XCTAssertFalse(model.state.busy)
        await gate.entered()
        gate.open()
        await vm.idle()
        XCTAssertEqual(log.list, ["signedIn"])
        XCTAssertEqual(stub.calls, [])
        XCTAssertEqual(model.googleLabelKey, "continue_google")
    }

    // ---- 设置 ----

    @MainActor
    private func settings(_ stub: StubAccount, _ vm: AccountViewModel, _ log: Log) async -> SettingsDialogModel {
        let model = SettingsDialogModel(
            account: vm,
            onSignOut: { log.add("signOut") },
            deleteAccount: {
                let failure = await vm.deleteAccount(clearDeviceChoice: { log.add("cleared") })
                if failure == nil { log.add("deleted") }
                return failure
            },
            onClose: { log.add("close") }
        )
        await model.idle()
        return model
    }

    @MainActor
    func testUnsavedCustomInstructionsKeepSettingsOpenUntilSavedOrDiscarded() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        stub.instructions = "Be brief."
        let vm = await account(stub)
        let log = Log()
        let model = await settings(stub, vm, log)
        XCTAssertEqual(model.state.initial, "Be brief.")
        XCTAssertEqual(model.instructionsCount, "9/4000")
        XCTAssertFalse(model.dirty)

        model.setInstructions("Be brief.  ")
        XCTAssertFalse(model.dirty, "only whitespace changed")
        model.setInstructions("Be kind. ")
        XCTAssertTrue(model.dirty)
        model.requestClose()
        model.closeAll()
        XCTAssertEqual(model.state.attention, 2)
        XCTAssertEqual(log.list, [])
        XCTAssertEqual(model.state.page, .personalization, "the page with the unsaved text is shown")

        model.discard()
        XCTAssertEqual(model.state.instructions, "Be brief.")
        XCTAssertEqual(model.state.attention, 0)

        model.setInstructions(" Be kind. ")
        let gate = TestGate()
        stub.gate = gate
        model.save()
        XCTAssertTrue(model.state.busy)
        model.requestClose()
        model.closeAll()
        XCTAssertEqual(log.list, [], "saving: stays open")
        await gate.entered()
        gate.open()
        await model.idle()
        XCTAssertEqual(stub.calls.last, "instructions:Be kind.")
        XCTAssertEqual(model.state.initial, "Be kind.")
        XCTAssertTrue(model.saved)
        XCTAssertFalse(model.dirty)
        // 再改，"已保存"就消失。
        model.setInstructions(" Be kind. ")
        XCTAssertFalse(model.saved)
        XCTAssertFalse(model.dirty)
        // 一次退一步：先回入口列表，再关。
        model.requestClose()
        XCTAssertNil(model.state.page)
        XCTAssertEqual(log.list, [])
        model.requestClose()
        XCTAssertEqual(log.list, ["close"])
    }

    // ---- 设置：入口列表和各栏 ----

    @MainActor
    func testSettingsOpenOnTheHomeListAndBackReturnsToItBeforeClosing() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        let vm = await account(stub)
        let log = Log()
        let model = await settings(stub, vm, log)
        XCTAssertEqual(SettingsPage.allCases, [.general, .personalization, .plan, .account])
        XCTAssertEqual(SettingsPage.allCases.map(\.titleKey), ["settings_general", "settings_personalization", "plan_title", "account"])
        XCTAssertNil(model.state.page)
        XCTAssertFalse(model.state.navigated, "the home list first appears without the page transition")

        model.show(.plan)
        XCTAssertEqual(model.state.page, .plan)
        XCTAssertTrue(model.state.navigated)
        model.backHome()
        XCTAssertNil(model.state.page)
        XCTAssertTrue(model.state.navigated)
        XCTAssertEqual(log.list, [], "Back on a page only returns to the home list")

        model.show(.general)
        model.requestClose()
        XCTAssertNil(model.state.page)
        XCTAssertEqual(log.list, [])
        model.closeAll()
        XCTAssertEqual(log.list, ["close"])
    }

    /// 和网页 src/lib/settings-navigation.test.ts 是同一批例子。
    func testTheCloseAndBackRulesMatchTheWeb() {
        // Esc / 返回一次退一步：一栏 → 入口列表 → 关。
        XCTAssertEqual(settingsDismissStep(locked: false, editorIn: nil, onPage: true, dirty: false), .home)
        XCTAssertEqual(settingsDismissStep(locked: false, editorIn: nil, onPage: false, dirty: false), .close)
        // 先收起开着的编辑区，并显示它所在的那一栏。
        XCTAssertEqual(settingsDismissStep(locked: false, editorIn: .account, onPage: false, dirty: false), .show(.account, attention: false))
        XCTAssertEqual(settingsDismissStep(locked: false, editorIn: .general, onPage: true, dirty: false), .show(.general, attention: false))
        // 有没保存的自定义指令：留在"个性化"，在一栏里和在列表上都一样。
        let shake = SettingsStep.show(.personalization, attention: true)
        XCTAssertEqual(settingsDismissStep(locked: false, editorIn: nil, onPage: true, dirty: true), shake)
        XCTAssertEqual(settingsDismissStep(locked: false, editorIn: nil, onPage: false, dirty: true), shake)
        XCTAssertEqual(settingsButtonStep(locked: false, photoBusy: false, onPage: true, dirty: true), shake)
        XCTAssertEqual(settingsButtonStep(locked: false, photoBusy: false, onPage: false, dirty: true), shake)
        // 保存中、删除中什么都不做。
        XCTAssertEqual(settingsDismissStep(locked: true, editorIn: .account, onPage: true, dirty: true), .stay)
        XCTAssertEqual(settingsButtonStep(locked: true, photoBusy: true, onPage: true, dirty: true), .stay)
        // 顶栏的按钮：一栏里回列表，列表上关。
        XCTAssertEqual(settingsButtonStep(locked: false, photoBusy: false, onPage: true, dirty: false), .home)
        XCTAssertEqual(settingsButtonStep(locked: false, photoBusy: false, onPage: false, dirty: false), .close)
        // 照片在裁剪或上传：显示"账号"那一栏，排在"没保存"的检查前面。
        XCTAssertEqual(settingsButtonStep(locked: false, photoBusy: true, onPage: true, dirty: false), .show(.account, attention: false))
        XCTAssertEqual(settingsButtonStep(locked: false, photoBusy: true, onPage: false, dirty: true), .show(.account, attention: false))
    }

    func testTheIdentityRowShowsTheEmailOnlyUnderADifferentName() {
        XCTAssertEqual(AccountUser(name: "Ann", email: "ann@example.test").identityEmail, "ann@example.test")
        XCTAssertNil(AccountUser(name: "Ann").identityEmail)
        XCTAssertNil(AccountUser(name: "Ann", email: "").identityEmail)
        // 没有名字时名字那一行写的就是邮箱：不再写第二遍。
        XCTAssertEqual(AccountUser(email: "ann@example.test").rowName, "ann@example.test")
        XCTAssertNil(AccountUser(email: "ann@example.test").identityEmail)
        XCTAssertNil(AccountUser(name: "ann@example.test", email: "ann@example.test").identityEmail)
    }

    @MainActor
    func testUnsavedCustomInstructionsBlockLeavingThePageAndAFailedSaveShowsIt() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        stub.instructions = "Be brief."
        let vm = await account(stub)
        let log = Log()
        let model = await settings(stub, vm, log)

        model.show(.personalization)
        model.setInstructions("Be kind.")
        model.backHome()
        XCTAssertEqual(model.state.page, .personalization)
        XCTAssertEqual(model.state.attention, 1)
        model.requestClose()
        XCTAssertEqual(model.state.page, .personalization)
        XCTAssertEqual(model.state.attention, 2)

        // 在别的栏按返回：被带回"个性化"，开着的编辑区不动。
        model.show(.account)
        model.setEditor(.emoji)
        model.backHome()
        XCTAssertEqual(model.state.page, .personalization)
        XCTAssertEqual(model.state.attention, 3)
        XCTAssertEqual(model.state.editor, .emoji)
        XCTAssertEqual(log.list, [])

        // 在别的栏按"保存"失败：原因显示在"个性化"，所以切过去。
        model.show(.general)
        stub.failInstructions = TestIOError()
        model.save()
        await model.idle()
        XCTAssertEqual(model.state.page, .personalization)
        XCTAssertNotNil(model.state.error)
        XCTAssertEqual(model.state.attention, 3)

        // 保存中：返回什么都不做。
        stub.failInstructions = nil
        let gate = TestGate()
        stub.gate = gate
        model.save()
        model.backHome()
        XCTAssertEqual(model.state.page, .personalization)
        XCTAssertEqual(model.state.attention, 3)
        await gate.entered()
        gate.open()
        await model.idle()
        XCTAssertFalse(model.dirty)

        // 存好了：返回一步回到列表，开着的头像编辑区一起关掉。
        model.backHome()
        XCTAssertNil(model.state.page)
        XCTAssertEqual(model.state.editor, .closed)
        model.closeAll()
        XCTAssertEqual(log.list, ["close"])
    }

    @MainActor
    func testAPickedPhotoKeepsTheAccountPageAndBackClosesOpenEditorsInOneStep() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        let vm = await account(stub)
        let log = Log()
        let model = await settings(stub, vm, log)

        model.show(.account)
        model.toggleEditor()
        model.pickPhoto()
        XCTAssertTrue(model.photoPicked(mimeType: "image/png", size: 2048))
        model.backHome()
        XCTAssertEqual(model.state.page, .account, "a picked photo is not saved yet")
        XCTAssertTrue(model.state.picked)
        XCTAssertEqual(model.state.editor, .photo)

        let gate = TestGate()
        stub.gate = gate
        model.uploadPhoto(Data(count: 3))
        model.backHome()
        XCTAssertEqual(model.state.page, .account, "uploading")
        model.requestClose()
        XCTAssertEqual(model.state.page, .account)
        XCTAssertEqual(model.state.editor, .photo, "uploading: the editor stays open")
        await gate.entered()
        gate.open()
        await vm.idle()
        XCTAssertFalse(model.photoBusy)

        // 表情页开着：返回连它一起关掉，一步回到列表。
        model.setEditor(.emoji)
        model.backHome()
        XCTAssertNil(model.state.page)
        XCTAssertEqual(model.state.editor, .closed)

        model.show(.general)
        model.setAppIconPicking(true)
        model.backHome()
        XCTAssertNil(model.state.page)
        XCTAssertFalse(model.state.appIconPicking)

        // 读屏的"返回"一次只退一步：先关编辑区（在别的栏时切到它所在的栏），再回列表。
        model.show(.account)
        model.setEditor(.emoji)
        model.requestClose()
        XCTAssertEqual(model.state.editor, .closed)
        XCTAssertEqual(model.state.page, .account)
        model.requestClose()
        XCTAssertNil(model.state.page)
        XCTAssertEqual(log.list, [])
    }

    @MainActor
    func testLeavingTheAccountPageSavesTheNameAndDropsAPhotoWaitingToBeCropped() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        stub.instructions = "Be brief."
        let vm = await account(stub)
        let log = Log()
        let model = await settings(stub, vm, log)

        // 输入中的名字：离开"账号"那一栏时存掉（那一栏的输入框等不到失焦）。
        model.show(.account)
        model.nameFocusChanged(true)
        model.setNameDraft("Bo")
        model.backHome()
        XCTAssertNil(model.state.page)
        XCTAssertFalse(model.state.editingName)
        await vm.idle()
        XCTAssertEqual(vm.state.user?.displayName, "Bo")

        // 正在裁剪时在"未保存的更改"条上按保存、保存失败：被带去"个性化"，裁剪界面连同照片不在了，所以不再算"选了照片"。
        model.show(.account)
        model.setInstructions("Be kind.")
        model.toggleEditor()
        model.pickPhoto()
        XCTAssertTrue(model.photoPicked(mimeType: "image/png", size: 2048))
        stub.failInstructions = TestIOError()
        model.save()
        await model.idle()
        XCTAssertEqual(model.state.page, .personalization)
        XCTAssertFalse(model.state.picked)
        XCTAssertFalse(model.photoBusy)
        XCTAssertFalse(model.state.pickerOpen)

        // 照片读完时已经不在"账号"那一栏：不进入裁剪。
        model.pickPhoto()
        XCTAssertFalse(model.photoPicked(mimeType: "image/png", size: 2048))
        XCTAssertFalse(model.state.picked)
        XCTAssertFalse(model.state.pickerOpen)
        XCTAssertNil(vm.state.photoError)

        model.discard()
        model.backHome()
        XCTAssertNil(model.state.page)
        XCTAssertEqual(log.list, [])
    }

    @MainActor
    func testCustomInstructionsFailuresShowTheServerSentenceAndRetryLoadsAgain() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        stub.failInstructions = ApiException(status: 401, message: "Sign in to use custom instructions.")
        let vm = await account(stub)
        let model = await settings(stub, vm, Log())
        XCTAssertNil(model.state.initial)
        XCTAssertNil(model.instructionsCount)
        XCTAssertEqual(model.state.loadError?.text("acct_err_load_custom_instructions", system), "Sign in to use custom instructions.")
        stub.failInstructions = nil
        model.retryLoad()
        XCTAssertNil(model.state.loadError)
        await model.idle()
        XCTAssertEqual(model.state.initial, "")

        stub.failInstructions = TestIOError()
        model.setInstructions("x")
        model.save()
        await model.idle()
        XCTAssertEqual(model.state.error?.text("acct_err_save_custom_instructions", system), "acct_err_save_custom_instructions")
        XCTAssertTrue(model.dirty)
    }

    @MainActor
    func testTheNameIsSavedOnBlurOnCloseAndBeforeSigningOut() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        let vm = await account(stub)
        let log = Log()
        let model = await settings(stub, vm, log)
        XCTAssertEqual(model.state.nameDraft, "Ann")

        model.nameFocusChanged(true)
        model.setNameDraft(String(repeating: "b", count: 50))
        XCTAssertEqual(model.state.nameDraft.count, MAX_DISPLAY_NAME)
        model.setNameDraft("Bo")
        model.nameFocusChanged(false)
        await vm.idle()
        XCTAssertEqual(vm.state.user?.displayName, "Bo")
        XCTAssertTrue(model.showResetToGoogle)

        model.resetToGoogle()
        XCTAssertEqual(model.state.nameDraft, "Ann")
        await vm.idle()
        XCTAssertNil(vm.state.user?.displayName)
        XCTAssertFalse(model.showResetToGoogle)

        // 没在编辑时输入框跟着保存后的名字走；正在编辑时不盖掉输入中的文字。
        vm.saveName("Cy")
        model.userChanged()
        XCTAssertEqual(model.state.nameDraft, "Cy")
        model.nameFocusChanged(true)
        model.setNameDraft("Di")
        vm.saveName("Ed")
        model.userChanged()
        XCTAssertEqual(model.state.nameDraft, "Di")

        model.signOut()
        XCTAssertEqual(log.list, ["close", "signOut"])
        await vm.idle()
        XCTAssertEqual(vm.state.user?.displayName, "Di")
    }

    @MainActor
    /// 照片还在读的时候离开"账号"那一栏再回来：读完的那张是上一次的，不进入裁剪（不然 picked 为真却没有照片可裁，回不了列表）。
    func testAPhotoThatFinishesLoadingAfterLeavingAndComingBackIsIgnored() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        let vm = await account(stub)
        let model = await settings(stub, vm, Log())
        model.show(.account)
        model.toggleEditor()
        model.pickPhoto()
        let stale = model.photoPickToken
        model.backHome()
        XCTAssertNil(model.state.page)
        model.show(.account)
        model.toggleEditor()
        XCTAssertFalse(model.photoPicked(mimeType: "image/png", size: 2048, token: stale))
        XCTAssertFalse(model.state.picked)
        XCTAssertFalse(model.photoBusy)
        // 这一次自己选的照常进入裁剪。
        model.pickPhoto()
        XCTAssertTrue(model.photoPicked(mimeType: "image/png", size: 2048, token: model.photoPickToken))
        XCTAssertTrue(model.state.picked)
        // 换了编辑页（表情）之后读完的也不要。
        model.cancelCrop()
        model.pickPhoto()
        let beforeSwitch = model.photoPickToken
        model.setEditor(.emoji)
        XCTAssertFalse(model.photoPicked(mimeType: "image/png", size: 2048, token: beforeSwitch))
        XCTAssertFalse(model.state.picked)
    }

    @MainActor
    func testTheAvatarEditorClosesFirstAndAPickedPhotoBlocksTheTopBarClose() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        let vm = await account(stub)
        let log = Log()
        let model = await settings(stub, vm, log)

        model.show(.account)
        model.toggleEditor()
        XCTAssertEqual(model.state.editor, .photo)
        model.pickPhoto()
        model.requestClose()
        XCTAssertEqual(model.state.editor, .photo, "the system picker is open: nothing closes")
        XCTAssertFalse(model.photoPicked(mimeType: "application/pdf", size: 10))
        XCTAssertEqual(vm.state.photoError, .notImage)
        XCTAssertEqual(photoErrorText(.notImage, system), "acct_choose_image")
        XCTAssertFalse(model.state.pickerOpen)

        model.pickPhoto()
        XCTAssertTrue(model.photoPicked(mimeType: "image/jpeg", size: 2048))
        XCTAssertNil(vm.state.photoError)
        XCTAssertTrue(model.photoBusy)
        XCTAssertFalse(model.signOutEnabled)
        model.closeAll()
        XCTAssertEqual(log.list, [], "a picked photo is not saved yet")
        XCTAssertEqual(model.state.page, .account)

        let gate = TestGate()
        stub.gate = gate
        model.uploadPhoto(Data(count: 3))
        XCTAssertTrue(vm.state.uploading)
        model.requestClose()
        XCTAssertEqual(model.state.editor, .photo, "uploading: nothing closes")
        await gate.entered()
        gate.open()
        await vm.idle()
        XCTAssertEqual(stub.calls.last, "upload:image/jpeg")
        XCTAssertEqual(model.state.editor, .closed)
        XCTAssertFalse(model.photoBusy)

        model.setEditor(.emoji)
        model.requestClose()
        XCTAssertEqual(model.state.editor, .closed)
        XCTAssertEqual(log.list, [])
        model.setAppIconPicking(true)
        model.requestClose()
        XCTAssertFalse(model.state.appIconPicking)
        XCTAssertEqual(model.state.page, .general, "the page of what was just closed is shown")
        XCTAssertEqual(log.list, [])
        model.requestClose()
        XCTAssertNil(model.state.page)
        XCTAssertEqual(log.list, [])
        model.requestClose()
        XCTAssertEqual(log.list, ["close"])
    }

    @MainActor
    func testDeletingTheAccountConfirmsFirstAndKeepsTheReasonOnFailure() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        let vm = await account(stub)
        let log = Log()
        let model = await settings(stub, vm, log)

        model.startDelete()
        XCTAssertTrue(model.state.confirmingDelete)
        stub.failDelete = ApiException(status: 500, message: "HTTP 500")
        model.confirmDelete()
        XCTAssertTrue(model.state.deleting)
        model.requestClose()
        model.cancelDelete()
        XCTAssertTrue(model.state.confirmingDelete, "deleting: cannot cancel or close")
        await model.idle()
        XCTAssertFalse(model.state.deleting)
        XCTAssertEqual(model.state.deleteError?.text("acct_err_delete_account", system), "acct_err_delete_account")
        XCTAssertEqual(log.list, [])

        model.cancelDelete()
        XCTAssertFalse(model.state.confirmingDelete)
        XCTAssertNil(model.state.deleteError)

        stub.failDelete = nil
        model.startDelete()
        model.confirmDelete()
        await model.idle()
        XCTAssertEqual(log.list, ["cleared", "deleted", "close"])
        XCTAssertNil(vm.state.user)
    }

    // ---- 方案 ----

    func testThePlanCardListsUsageAndTheSubscriptionLine() throws {
        let free = PlanInfo(usage: [
            "chat": PlanUsage(used: 12, limit: 30, period: "day"),
            "image": PlanUsage(used: 5, limit: 5, period: "month", daily: PlanDailyUsage(used: 1, limit: 2)),
        ])
        XCTAssertEqual(free.badgeKey, "plan_free")
        XCTAssertNil(free.statusLine)
        XCTAssertEqual(free.meters.map(\.labelKey), ["plan_messages_today", "plan_images_month", "plan_images_today"])
        XCTAssertEqual(free.meters.map(\.countText), ["12 / 30", "5 / 5", "1 / 2"])
        XCTAssertEqual(free.meters.map(\.full), [false, true, false])
        XCTAssertEqual(free.meters[0].ratio, 0.4, accuracy: 0.0001)
        // 免费方案没到月上限时不列“本月图片生成”，只列今天的。
        let belowCap = PlanInfo(usage: [
            "chat": PlanUsage(used: 12, limit: 30, period: "day"),
            "image": PlanUsage(used: 4, limit: 5, period: "month", daily: PlanDailyUsage(used: 1, limit: 2)),
        ])
        XCTAssertEqual(belowCap.meters.map(\.labelKey), ["plan_messages_today", "plan_images_today"])
        XCTAssertEqual(belowCap.meters.map(\.id), [0, 1])
        // 没有每日上限的方案照旧列出月用量。
        let noDaily = PlanInfo(usage: ["image": PlanUsage(used: 0, limit: 5, period: "month")])
        XCTAssertEqual(noDaily.meters.map(\.labelKey), ["plan_images_month"])
        // 没有上限数据时算满。
        XCTAssertTrue(PlanMeter(id: 0, labelKey: "x", used: 0, limit: 0).full)

        var pro = PlanInfo(
            plan: "pro", subscription: PlanSubscription(status: "active", periodEnd: "2026-12-01T00:00:00Z"),
            usage: ["chat": PlanUsage(used: 1, limit: 3000, period: "month"), "image": PlanUsage(used: 0, limit: 100, period: "month")],
            priceJpy: 980
        )
        XCTAssertEqual(pro.badgeKey, "plan_pro")
        XCTAssertEqual(pro.meters.map(\.labelKey), ["plan_messages_period", "plan_images_period"])
        XCTAssertEqual(pro.statusLine, .renews("2026-12-01T00:00:00Z"))
        pro.subscription?.status = "trialing"
        XCTAssertEqual(pro.statusLine, .trialEnds("2026-12-01T00:00:00Z", priceJpy: 980))
        pro.subscription?.cancelAt = "2026-12-05T00:00:00Z"
        XCTAssertEqual(pro.statusLine, .ends("2026-12-05T00:00:00Z"))
        pro.subscription?.status = "past_due"
        XCTAssertEqual(pro.statusLine, .pastDue)

        let utc = try XCTUnwrap(TimeZone(identifier: "UTC"))
        XCTAssertEqual(planDate("2026-12-05T00:00:00Z", uiLocale: "en", timeZone: utc), "Dec 5, 2026")
        XCTAssertEqual(planDate("2026-12-05T00:00:00.000Z", uiLocale: "ja", timeZone: utc), "2026年12月5日")
        XCTAssertEqual(planDate("soon", uiLocale: "en", timeZone: utc), "")
    }

    @MainActor
    func testThePlanLoadsOnceAndRetriesAfterAFailure() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        stub.planResult = .failure(ApiException(status: 503, message: "Billing is unavailable."))
        let vm = await account(stub)
        let model = PlanSettingsModel(load: { await vm.loadPlan() })
        XCTAssertNil(model.state.plan)
        await model.idle()
        XCTAssertEqual(model.state.loadError?.text("plan_load_failed", system), "Billing is unavailable.")
        stub.planResult = .success(PlanInfo(plan: "pro"))
        model.retry()
        XCTAssertNil(model.state.loadError)
        await model.idle()
        XCTAssertEqual(model.state.plan?.isPro, true)
    }

    // ---- 举报回答 / AI 内容 ----

    @MainActor
    func testReportingAnAnswerSendsOnceAndShowsThanksOrTheReason() async {
        let reports = StubReports()
        let log = Log()
        let model = ReportModel(target: .answer(messageId: "m1"), backend: reports, onClose: { log.add("close") })
        XCTAssertEqual(model.titleKey, "report_title")
        XCTAssertEqual(model.helpKey, "report_help")
        model.setReason(String(repeating: "x", count: 1200))
        XCTAssertEqual(model.state.reason.count, MAX_REPORT_REASON)
        model.setReason("Wrong date")

        reports.fail = ApiException(status: 429, message: "Too many reports.")
        model.send()
        await model.idle()
        XCTAssertEqual(model.state.error?.text("report_failed", system), "Too many reports.")
        XCTAssertFalse(model.state.sent)

        reports.fail = nil
        let gate = TestGate()
        reports.gate = gate
        model.send()
        XCTAssertEqual(model.sendLabelKey, "report_sending")
        model.send()
        model.close()
        XCTAssertEqual(log.list, [], "sending: stays open")
        await gate.entered()
        gate.open()
        await model.idle()
        XCTAssertEqual(reports.sent, ["messageId=m1:Wrong date"])
        XCTAssertTrue(model.state.sent)
        XCTAssertNil(model.state.error)
        model.close()
        XCTAssertEqual(log.list, ["close"])
    }

    @MainActor
    func testProposalsAndPagesAreReportedAsAIContent() async {
        let reports = StubReports()
        let card = ReportModel(target: .proposal(proposalId: "pr1"), backend: reports, onClose: {})
        XCTAssertEqual(card.titleKey, "report_ai_content")
        XCTAssertEqual(card.helpKey, "report_ai_help")
        card.send()
        await card.idle()
        XCTAssertTrue(card.state.sent)
        // 已发送：再按不会再发。
        card.send()
        await card.idle()

        let page = ReportModel(target: .page(pageId: "pg1"), backend: reports, onClose: {})
        XCTAssertEqual(page.titleKey, "report_ai_content")
        reports.fail = ApiException(status: 404, message: "This content is no longer available.")
        page.setReason("Invented quotes")
        page.send()
        await page.idle()
        XCTAssertEqual(page.state.error?.text("report_failed", system), "This content is no longer available.")
        reports.fail = nil
        page.send()
        await page.idle()
        XCTAssertEqual(reports.sent, ["proposalId=pr1:", "pageId=pg1:Invented quotes"])
    }

    // ---- 语言 ----

    func testTheLanguageRowMarksTheSavedPreferenceAndNothingWhenUnknown() {
        let auto = LanguageSettingsRow(user: AccountUser(locale: nil), showing: .japanese)
        XCTAssertEqual(auto.saved, .auto)
        XCTAssertEqual(auto.checked, .auto)
        XCTAssertEqual(auto.shown, .auto)
        let japanese = LanguageSettingsRow(user: AccountUser(locale: "ja"), showing: .english)
        XCTAssertEqual(japanese.checked, .japanese)
        XCTAssertEqual(japanese.shown, .japanese)
        // 服务端没返回这个字段：哪一项都不标，按钮上写正在显示的语言。
        let unknown = LanguageSettingsRow(user: AccountUser(), showing: .korean)
        XCTAssertNil(unknown.saved)
        XCTAssertNil(unknown.checked)
        XCTAssertEqual(unknown.shown, .korean)
        XCTAssertEqual(languageLabel(.japanese, showing: .english), "日本語")
        XCTAssertEqual(languageLabel(.auto, showing: .english), "language_auto_current")
    }

    @MainActor
    func testTheInterfaceLanguageFollowsTheAccountAndStaysPutWhileSigningOut() async throws {
        let resources = try TextTestSupport.generatedResources()
        let store = MemoryStore()
        let controller = LanguageController(
            store: store, resources: try XCTUnwrap(Bundle(path: resources.path)), systemLanguages: { ["en-US"] }, l10n: L10n()
        )
        XCTAssertEqual(controller.active, .english)

        var state = AccountUiState()
        controller.syncWithAccount(state)
        XCTAssertEqual(controller.preference, .auto, "nothing happens before the account is read")

        state.loaded = true
        state.configured = true
        state.user = AccountUser(name: "Ann", locale: "ja")
        XCTAssertEqual(state.localeSyncKey.saved, .code("ja"))
        controller.syncWithAccount(state)
        XCTAssertEqual(controller.preference, .japanese)
        XCTAssertEqual(store.code, "ja")

        // 账号上是 null：明确的"自动"。
        state.user?.locale = nil
        controller.syncWithAccount(state)
        XCTAssertEqual(controller.preference, .auto)

        // 字段缺失：不知道，不动。
        state.user?.locale = "ja"
        controller.syncWithAccount(state)
        state.user?.locale = LOCALE_UNKNOWN
        XCTAssertEqual(state.localeSyncKey.saved, .unknown)
        controller.syncWithAccount(state)
        XCTAssertEqual(controller.preference, .japanese)

        // 退出登录期间不同步；未登录时保留本机的选择。
        state.user?.locale = "ko"
        state.signingOut = true
        controller.syncWithAccount(state)
        XCTAssertEqual(controller.preference, .japanese)
        state.signingOut = false
        state.user = nil
        XCTAssertNotEqual(state.localeSyncKey, AccountUiState().localeSyncKey)
        controller.syncWithAccount(state)
        XCTAssertEqual(controller.preference, .japanese)
    }
}
