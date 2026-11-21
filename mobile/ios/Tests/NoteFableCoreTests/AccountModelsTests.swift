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

    func reportAnswer(messageId: String, reason: String) async throws {
        await gate?.pass()
        if let fail { throw fail }
        sent.append("\(messageId):\(reason)")
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
        model.requestClose()
        XCTAssertEqual(log.list, ["close"])
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
    func testTheAvatarEditorClosesFirstAndAPickedPhotoBlocksTheTopBarClose() async {
        let stub = StubAccount()
        stub.user = AccountUser(name: "Ann", googleName: "Ann")
        let vm = await account(stub)
        let log = Log()
        let model = await settings(stub, vm, log)

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

    // ---- 举报回答 ----

    @MainActor
    func testReportingAnAnswerSendsOnceAndShowsThanksOrTheReason() async {
        let reports = StubReports()
        let log = Log()
        let model = ReportAnswerModel(messageId: "m1", backend: reports, onClose: { log.add("close") })
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
        XCTAssertEqual(reports.sent, ["m1:Wrong date"])
        XCTAssertTrue(model.state.sent)
        XCTAssertNil(model.state.error)
        model.close()
        XCTAssertEqual(log.list, ["close"])
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
