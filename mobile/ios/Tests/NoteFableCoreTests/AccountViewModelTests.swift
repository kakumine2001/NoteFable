import Foundation
import XCTest
@testable import NoteFableCore

@MainActor
private final class FakeAccount: AccountBackend {
    var user: AccountUser?
    var calls: [String] = []
    var failSignIn = false
    /// 接下来这么多次读账号会失败（模拟登录后那一下网络不通）。
    var failAccountTimes = 0
    var failDelete: Error?
    var emailEnabled: Bool?
    var appleEnabled: Bool?
    var failEmail: Error?
    var failAppleNonce = false
    var appleNonceGate: TestGate?
    var appleNonceSeq = 0
    /// 设了以后退出登录要等它。
    var signOutGate: TestGate?

    func account() async throws -> AccountResponse {
        if failAccountTimes > 0 {
            failAccountTimes -= 1
            throw TestIOError()
        }
        return AccountResponse(configured: true, user: user, googleClientId: "web-client", email: emailEnabled, apple: appleEnabled)
    }

    func nativeSignInNonce() async throws -> String {
        calls.append("nonce")
        return "n1"
    }

    func appleSignInNonce() async throws -> String {
        appleNonceSeq += 1
        let id = "an\(appleNonceSeq)"
        calls.append("appleNonce:\(id)")
        await appleNonceGate?.pass()
        if failAppleNonce { throw TestIOError(message: "nonce failed") }
        return id
    }

    func appleSignIn(code: String, name: String?) async throws {
        calls.append("appleSignIn:\(code):\(name ?? "")")
        if failSignIn { throw TestIOError(message: "rejected") }
        user = AccountUser(name: name ?? "Ann", email: "apple@example.test")
    }

    func nativeSignIn(idToken: String) async throws {
        calls.append("signIn:\(idToken)")
        if failSignIn { throw TestIOError(message: "rejected") }
        user = AccountUser(name: "Ann", googleName: "Ann", email: "a@example.test")
    }

    func signOut() async throws {
        await signOutGate?.pass()
        calls.append("signOut")
        user = nil
    }

    func deleteAccount() async throws {
        calls.append("delete")
        if let failDelete { throw failDelete }
        user = nil
    }

    func emailSignInStart(email: String, locale: String) async throws {
        calls.append("emailStart:\(email):\(locale)")
        if let failEmail { throw failEmail }
    }

    func emailSignInVerify(email: String, code: String) async throws {
        calls.append("emailVerify:\(email):\(code)")
        if let failEmail { throw failEmail }
        user = AccountUser(name: nil, googleName: nil, email: email)
    }
}

/// 假的资料接口：记下每次发出的编辑；[gate] 不为 nil 时等它放行才回复（用来看排队）。
@MainActor
private final class FakeProfile: AccountProfileBackend {
    private let account: FakeAccount
    var edits: [ProfileEdit] = []
    var uploads: [String] = []
    var gate: TestGate?
    var failEdit: Error?
    var failUpload: Error?
    var instructions: String?
    var failInstructions: Error?
    var planResult: Result<PlanInfo, Error> = .success(PlanInfo())

    init(_ account: FakeAccount) {
        self.account = account
    }

    func updateProfile(_ edit: ProfileEdit) async throws -> AccountUser {
        edits.append(edit)
        await gate?.pass()
        if let failEdit { throw failEdit }
        let next = applyProfileEdit(account.user ?? AccountUser(), edit)
        account.user = next
        return next
    }

    func uploadAvatar(bytes: Data, mimeType: String) async throws -> AccountUser {
        uploads.append("\(bytes.count):\(mimeType)")
        await gate?.pass()
        if let failUpload { throw failUpload }
        var next = account.user ?? AccountUser()
        next.avatarUrl = "/api/account/avatar?v=new"
        next.icon = nil
        account.user = next
        return next
    }

    func customInstructions() async throws -> String? {
        if let failInstructions { throw failInstructions }
        return instructions
    }

    func saveCustomInstructions(_ instructions: String) async throws -> String? {
        if let failInstructions { throw failInstructions }
        self.instructions = instructions.isEmpty ? nil : instructions
        return self.instructions
    }

    func plan() async throws -> PlanInfo {
        try planResult.get()
    }
}

/// 记下界面层收到的通知。
@MainActor
private final class Events {
    var list: [String] = []
    func add(_ event: String) { list.append(event) }
    func contains(_ event: String) -> Bool { list.contains(event) }
}

final class AccountViewModelTests: XCTestCase {
    /// 假的 Google 账号选择框：记下收到的参数，返回 [token]（nil = 用户关掉了）。
    @MainActor
    private func model(
        _ backend: FakeAccount,
        _ profile: FakeProfile? = nil,
        token: String? = "tok",
        seen: Events? = nil,
        sleeps: Events? = nil
    ) -> AccountViewModel {
        AccountViewModel(
            backend: backend,
            profile: profile ?? FakeProfile(backend),
            requestGoogleIdToken: { clientId, nonce in
                seen?.add("\(clientId)/\(nonce)")
                return token
            },
            sleep: { ms in sleeps?.add("\(ms)") }
        )
    }

    @MainActor
    func testTheServerDecidesWhichSignInMethodsTheDialogLists() async {
        let backend = FakeAccount()
        let vm = model(backend)
        await vm.idle()
        // account() 不带 google / email：Google 缺省算开，邮箱缺省算关（网页 SignInDialog 的规则）。
        XCTAssertTrue(vm.state.loaded)
        XCTAssertTrue(vm.state.googleEnabled)
        XCTAssertFalse(vm.state.emailEnabled)
        XCTAssertTrue(vm.state.guest)

        // 安装包没配 Google 登录（没有取令牌的方法）：不列 Google，也发不起 Google 登录。
        backend.emailEnabled = true
        let emailOnly = AccountViewModel(backend: backend, profile: FakeProfile(backend))
        await emailOnly.idle()
        XCTAssertFalse(emailOnly.state.googleEnabled)
        XCTAssertTrue(emailOnly.state.emailEnabled)
        emailOnly.signIn(onSignedIn: {})
        await emailOnly.idle()
        XCTAssertEqual(backend.calls, [])
    }

    @MainActor
    func testEmailSignInSendsACodeVerifiesItAfterSavingOpenWorkAndReportsTheNewIdentity() async {
        let backend = FakeAccount()
        let vm = model(backend)
        await vm.idle()
        let sent = await vm.sendEmailCode("a@example.test", locale: "ja")
        XCTAssertNil(sent)
        let order = Events()
        let verified = await vm.verifyEmailCode(
            "a@example.test", "123456",
            beforeIdentityChange: { order.add("flush:" + (backend.calls.last ?? "")) },
            onSignedIn: { order.add("signedIn") }
        )
        XCTAssertNil(verified)
        XCTAssertEqual(backend.calls, ["emailStart:a@example.test:ja", "emailVerify:a@example.test:123456"])
        // 先存笔记，再核对验证码，最后通知换了身份。
        XCTAssertEqual(order.list, ["flush:emailStart:a@example.test:ja", "signedIn"])
        XCTAssertEqual(vm.state.user?.email, "a@example.test")
    }

    @MainActor
    func testEmailSignInFailuresKeepTheServerSentenceOrFallBackLikeTheWeb() async {
        let backend = FakeAccount()
        let vm = model(backend)
        await vm.idle()
        backend.failEmail = ApiException(status: 400, message: "That code is incorrect.")
        let events = Events()
        let rejected = await vm.verifyEmailCode("a@example.test", "000000", beforeIdentityChange: {}, onSignedIn: { events.add("signedIn") })
        XCTAssertEqual(rejected, .server("That code is incorrect."))
        XCTAssertEqual(events.list, [])
        XCTAssertNil(vm.state.user)
        backend.failEmail = ApiException(status: 500, message: "HTTP 500")
        let generic = await vm.sendEmailCode("a@example.test", locale: "en")
        XCTAssertEqual(generic, .generic)
        backend.failEmail = TestIOError()
        let offline = await vm.sendEmailCode("a@example.test", locale: "en")
        XCTAssertEqual(offline, .offline)
    }

    @MainActor
    func testANoteThatCannotBeSavedStopsTheEmailSignInBeforeTheCodeIsChecked() async {
        let backend = FakeAccount()
        let vm = model(backend)
        await vm.idle()
        let result = await vm.verifyEmailCode(
            "a@example.test", "123456", beforeIdentityChange: { throw TestIOError(message: "save failed") }, onSignedIn: {}
        )
        XCTAssertEqual(result, .generic)
        XCTAssertFalse(backend.calls.contains { $0.hasPrefix("emailVerify") })
    }

    @MainActor
    func testWhenTheAccountCannotBeReadRightAfterAnAcceptedCodeSignInStillSucceedsAndTheAccountIsReadAgain() async {
        let backend = FakeAccount()
        let sleeps = Events()
        let vm = model(backend, sleeps: sleeps)
        await vm.idle()
        backend.failAccountTimes = 2
        let events = Events()
        let result = await vm.verifyEmailCode("a@example.test", "123456", beforeIdentityChange: {}, onSignedIn: { events.add("signedIn") })
        XCTAssertNil(result)
        XCTAssertEqual(events.list, ["signedIn"])
        // 2 秒后的第一次重读还失败，再过 4 秒读到。
        await vm.idle()
        XCTAssertEqual(sleeps.list, ["2000", "4000"])
        XCTAssertEqual(vm.state.user?.email, "a@example.test")
    }

    func testTheCodeFieldNormalizesUnicodeDecimalDigitsToAsciiAndKeepsOnlySixDigits() {
        XCTAssertEqual(cleanLoginCode("12 34-56 78"), "123456")
        XCTAssertEqual(cleanLoginCode("٤٨٢٩١٠"), "482910")
        XCTAssertEqual(cleanLoginCode("٤٨٢ ٩١٠"), "482910")
        XCTAssertEqual(cleanLoginCode("۴۸۲۹۱۰"), "482910")
        XCTAssertEqual(cleanLoginCode("४८२९१०"), "482910")
        XCTAssertEqual(cleanLoginCode("๔๘๒๙๑๐"), "482910")
        XCTAssertEqual(cleanLoginCode("４８２９１０"), "482910")
        XCTAssertEqual(cleanLoginCode("𝟒𝟖𝟐𝟗𝟏𝟎"), "482910")
        XCTAssertEqual(cleanLoginCode("abc"), "")
        // 不是十进制数字的"数字"（分数、带圈数字）不算。
        XCTAssertEqual(cleanLoginCode("½①²12"), "12")
    }

    @MainActor
    func testCustomInstructionsLoadAsTextSaveTrimmedAndHandFailuresBack() async throws {
        let backend = FakeAccount()
        let profile = FakeProfile(backend)
        let vm = model(backend, profile)
        let empty = await vm.loadCustomInstructions()
        XCTAssertEqual(try empty.get(), "")
        let saved = await vm.saveCustomInstructions("  Be brief.\n")
        XCTAssertNil(saved)
        XCTAssertEqual(profile.instructions, "Be brief.")
        let loaded = await vm.loadCustomInstructions()
        XCTAssertEqual(try loaded.get(), "Be brief.")
        let cleared = await vm.saveCustomInstructions("   ")
        XCTAssertNil(cleared)
        XCTAssertNil(profile.instructions)

        let failure = ApiException(status: 401, message: "Sign in to use custom instructions.")
        profile.failInstructions = failure
        guard case .failure(let loadError) = await vm.loadCustomInstructions() else { return XCTFail("expected a failure") }
        XCTAssertEqual(loadError as? ApiException, failure)
        let saveError = await vm.saveCustomInstructions("x")
        XCTAssertEqual(saveError as? ApiException, failure)
    }

    func testSettingsSaveOnlyWhenTheTrimmedTextChangedAndClippingNeverSplitsAnEmoji() {
        XCTAssertFalse(customInstructionsChanged("Be brief.", "  Be brief.\n"))
        XCTAssertFalse(customInstructionsChanged("", "   "))
        XCTAssertTrue(customInstructionsChanged("Be brief.", "Be brief!"))
        XCTAssertTrue(customInstructionsChanged("Be brief.", ""))

        XCTAssertEqual(clipInstructions("abc", 4), "abc")
        XCTAssertEqual(clipInstructions("abcde", 4), "abcd")
        XCTAssertEqual(clipInstructions("abc😀", 4), "abc")
        XCTAssertEqual(clipInstructions("ab😀x", 4), "ab😀")
        XCTAssertEqual(clipInstructions("😀", 0), "")
    }

    @MainActor
    func testSignInAsksForANonceThenTheTokenThenTheServerAndReportsTheNewIdentity() async {
        let backend = FakeAccount()
        let seen = Events()
        let vm = model(backend, seen: seen)
        await vm.idle()
        XCTAssertTrue(vm.state.configured)
        XCTAssertNil(vm.state.user)

        let events = Events()
        vm.signIn(onSignedIn: { events.add("identity") })
        XCTAssertTrue(vm.state.signingIn)
        await vm.idle()

        XCTAssertEqual(backend.calls, ["nonce", "signIn:tok"])
        XCTAssertEqual(seen.list, ["web-client/n1"])
        XCTAssertEqual(vm.state.user?.name, "Ann")
        XCTAssertEqual(events.list, ["identity"])
        XCTAssertFalse(vm.state.signInFailed)
        XCTAssertFalse(vm.state.signingIn)
        XCTAssertFalse(vm.state.guest)
    }

    @MainActor
    func testClosingTheAccountPickerIsNotAFailureAndSendsNothingToTheServer() async {
        let backend = FakeAccount()
        let vm = model(backend, token: nil)
        await vm.idle()

        let events = Events()
        vm.signIn(onSignedIn: { events.add("identity") })
        await vm.idle()

        XCTAssertEqual(backend.calls, ["nonce"])
        XCTAssertEqual(events.list, [])
        XCTAssertFalse(vm.state.signInFailed)
        XCTAssertFalse(vm.state.signingIn)
    }

    @MainActor
    func testARejectedTokenShowsTheFailureStateAndKeepsTheUserSignedOut() async {
        let backend = FakeAccount()
        backend.failSignIn = true
        let vm = model(backend)
        await vm.idle()

        let events = Events()
        vm.signIn(onSignedIn: { events.add("identity") })
        await vm.idle()

        XCTAssertTrue(vm.state.signInFailed)
        XCTAssertNil(vm.state.user)
        XCTAssertEqual(events.list, [])
        XCTAssertFalse(vm.state.signingIn)
        vm.clearSignInFailed()
        XCTAssertFalse(vm.state.signInFailed)
    }

    @MainActor
    func testSignOutClearsTheUserAndTellsTheChatScreenTheIdentityChanged() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann")
        let vm = model(backend)
        await vm.idle()
        XCTAssertEqual(vm.state.user?.name, "Ann")

        let events = Events()
        let gate = TestGate()
        backend.signOutGate = gate
        vm.signOut(clearDeviceChoice: { events.add("cleared") }, onSignedOut: { events.add("identity") })
        XCTAssertTrue(vm.state.signingOut)
        // 退出还没完时再点一次不会再发起。
        vm.signOut(clearDeviceChoice: { events.add("cleared") }, onSignedOut: { events.add("identity") })
        await gate.entered()
        gate.open()
        await vm.idle()

        XCTAssertEqual(events.list, ["cleared", "identity"])
        XCTAssertNil(vm.state.user)
        XCTAssertFalse(vm.state.signingOut)
        XCTAssertEqual(backend.calls, ["signOut"])
    }

    @MainActor
    func testDeletingTheAccountSignsOutLocallyOnlyAfterTheServerDeletedIt() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann")
        let vm = model(backend)
        await vm.idle()

        backend.failDelete = TestIOError()
        let events = Events()
        let failure = await vm.deleteAccount(clearDeviceChoice: { events.add("cleared") })
        await vm.idle()
        XCTAssertTrue(failure is TestIOError)
        XCTAssertEqual(events.list, [], "failed: still signed in")
        XCTAssertEqual(vm.state.user?.name, "Ann")

        backend.failDelete = nil
        let deleted = await vm.deleteAccount(clearDeviceChoice: { events.add("cleared") })
        XCTAssertNil(deleted)
        await vm.idle()
        XCTAssertEqual(events.list, ["cleared"])
        XCTAssertNil(vm.state.user)
        XCTAssertEqual(backend.calls.filter { $0 == "delete" }.count, 2)
    }

    @MainActor
    func testSavingANameEqualToTheGoogleNameResetsToGoogleAndAnUnchangedNameSavesNothing() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann", displayName: nil)
        let profile = FakeProfile(backend)
        let vm = model(backend, profile)
        await vm.idle()

        vm.saveName("  Ann ")
        await vm.idle()
        XCTAssertTrue(profile.edits.isEmpty, "same as the Google name and nothing stored: no request")

        vm.saveName("  My \t\n  Name ")
        await vm.idle()
        XCTAssertEqual(profile.edits, [ProfileEdit.name("My Name")])
        XCTAssertEqual(vm.state.user?.displayName, "My Name")

        vm.saveName("Ann")
        await vm.idle()
        XCTAssertEqual(profile.edits, [ProfileEdit.name("My Name"), ProfileEdit.name(nil)])
        XCTAssertEqual(vm.state.user?.name, "Ann")
    }

    @MainActor
    func testAnEmojiShowsAtOnceDropsThePhotoAndLaterEditsWaitTheirTurn() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann", avatarUrl: "/api/account/avatar?v=1")
        let profile = FakeProfile(backend)
        let gate = TestGate()
        profile.gate = gate
        let vm = model(backend, profile)
        await vm.idle()

        vm.setIcon("🦊")
        vm.saveName("Bo")
        await gate.entered()
        await settleMainActor()
        // 第一次还没回复：界面已经是新表情、新名字，第二次还没发出去。
        XCTAssertEqual(vm.state.user?.icon, "🦊")
        XCTAssertNil(vm.state.user?.avatarUrl)
        XCTAssertEqual(vm.state.user?.name, "Bo")
        XCTAssertEqual(profile.edits, [ProfileEdit.icon("🦊")])

        gate.open()
        await vm.idle()
        XCTAssertEqual(profile.edits, [ProfileEdit.icon("🦊"), ProfileEdit.name("Bo")])
        XCTAssertEqual(vm.state.user?.icon, "🦊")
        XCTAssertEqual(vm.state.user?.displayName, "Bo")
    }

    @MainActor
    func testAFailedEditRollsBackOnlyItselfAndShowsTheServerSentenceOrTheWebFallback() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann")
        let profile = FakeProfile(backend)
        profile.failEdit = ApiException(status: 400, message: "Icon must be a single emoji.")
        let vm = model(backend, profile)
        await vm.idle()

        vm.setIcon("x")
        XCTAssertEqual(vm.state.user?.icon, "x")
        await vm.idle()
        XCTAssertNil(vm.state.user?.icon)
        XCTAssertEqual(vm.state.profileError, .server("Icon must be a single emoji."))

        profile.failEdit = ApiException(status: 500, message: "HTTP 500")
        vm.setIcon("🦊")
        await vm.idle()
        XCTAssertEqual(vm.state.profileError, .couldNotSave)

        profile.failEdit = nil
        vm.setIcon("🐼")
        await vm.idle()
        XCTAssertEqual(vm.state.user?.icon, "🐼")
        XCTAssertNil(vm.state.profileError, "a later success clears the error")
    }

    @MainActor
    func testRemoveMyPhotoSendsIconNullAndNothingIsSentWhenAlreadyOnTheGooglePhoto() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann", avatarUrl: "/api/account/avatar?v=1")
        let profile = FakeProfile(backend)
        let vm = model(backend, profile)
        await vm.idle()

        vm.setIcon(nil)
        await vm.idle()
        XCTAssertEqual(profile.edits, [ProfileEdit.icon(nil)])
        XCTAssertNil(vm.state.user?.avatarUrl)

        vm.setIcon(nil)
        await vm.idle()
        XCTAssertEqual(profile.edits.count, 1, "already the Google photo: nothing sent")
    }

    @MainActor
    func testUploadingAPhotoStaysBusyUntilTheServerAnswersThenShowsTheNewPhoto() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann", icon: "🦊")
        let profile = FakeProfile(backend)
        let gate = TestGate()
        profile.gate = gate
        let vm = model(backend, profile)
        await vm.idle()

        let events = Events()
        vm.uploadPhoto(Data(count: 10), mimeType: "image/webp") { events.add("saved") }
        // 上传中再点一次不会再发。
        vm.uploadPhoto(Data(count: 10), mimeType: "image/webp") { events.add("saved") }
        await gate.entered()
        XCTAssertTrue(vm.state.uploading)
        XCTAssertEqual(events.list, [])

        gate.open()
        await vm.idle()
        XCTAssertFalse(vm.state.uploading)
        XCTAssertEqual(events.list, ["saved"])
        XCTAssertEqual(profile.uploads, ["10:image/webp"])
        XCTAssertEqual(vm.state.user?.avatarUrl, "/api/account/avatar?v=new")
        XCTAssertNil(vm.state.user?.icon)
    }

    @MainActor
    func testUploadFailuresKeepTheEditorOpenWithTheWebsMessages() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann")
        let profile = FakeProfile(backend)
        let vm = model(backend, profile)
        await vm.idle()
        let events = Events()

        profile.failUpload = ApiException(status: 413, message: "That photo is too large.")
        vm.uploadPhoto(Data(count: 1), mimeType: "image/webp") { events.add("saved") }
        await vm.idle()
        XCTAssertEqual(vm.state.photoError, .server("That photo is too large."))

        profile.failUpload = ApiException(status: 502, message: "HTTP 502")
        vm.uploadPhoto(Data(count: 1), mimeType: "image/webp") { events.add("saved") }
        XCTAssertNil(vm.state.photoError, "a new upload clears the old message")
        await vm.idle()
        XCTAssertEqual(vm.state.photoError, .uploadFailed)

        profile.failUpload = TestIOError()
        vm.uploadPhoto(Data(count: 1), mimeType: "image/webp") { events.add("saved") }
        await vm.idle()
        XCTAssertEqual(vm.state.photoError, .offline)
        XCTAssertEqual(events.list, [])
        XCTAssertFalse(vm.state.uploading)
        vm.clearProfileError()
        XCTAssertNil(vm.state.photoError)
    }

    @MainActor
    func testSignOutWaitsForPendingSavesFirst() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann")
        let profile = FakeProfile(backend)
        let gate = TestGate()
        profile.gate = gate
        let vm = model(backend, profile)
        await vm.idle()

        vm.setIcon("🦊")
        vm.signOut(clearDeviceChoice: {}, onSignedOut: {})
        await gate.entered()
        await settleMainActor()
        XCTAssertFalse(backend.calls.contains("signOut"), "still saving: not signed out yet")

        gate.open()
        await vm.idle()
        XCTAssertTrue(backend.calls.contains("signOut"))
        XCTAssertNil(vm.state.user)
    }

    @MainActor
    func testANameSavedRightBeforeSignOutIsSentBeforeSigningOut() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann")
        let profile = FakeProfile(backend)
        let vm = model(backend, profile)
        await vm.idle()

        var editsAtSignOut: [ProfileEdit]?
        // 设置里的"退出登录"：先 saveName(draft)，再 signOut。
        vm.saveName("Bo")
        vm.signOut(clearDeviceChoice: {}, onSignedOut: { editsAtSignOut = profile.edits })
        await vm.idle()

        XCTAssertEqual(editsAtSignOut, [ProfileEdit.name("Bo")])
        XCTAssertTrue(backend.calls.contains("signOut"))
        XCTAssertNil(vm.state.profileError)
    }

    @MainActor
    func testChoosingALanguageSavesItOnTheAccountAndAFailureRollsItBack() async {
        let backend = FakeAccount()
        backend.user = AccountUser(name: "Ann", googleName: "Ann", locale: nil)
        let profile = FakeProfile(backend)
        let vm = model(backend, profile)
        await vm.idle()
        XCTAssertEqual(vm.state.localeSyncKey.saved, .auto)

        vm.setLocale("ja")
        XCTAssertEqual(vm.state.localeSyncKey.saved, .code("ja"))
        await vm.idle()
        XCTAssertEqual(profile.edits, [ProfileEdit.locale("ja")])

        profile.failEdit = TestIOError()
        vm.setLocale(nil)
        XCTAssertEqual(vm.state.localeSyncKey.saved, .auto)
        await vm.idle()
        XCTAssertEqual(vm.state.localeSyncKey.saved, .code("ja"), "the account keeps the language the server has")
        XCTAssertEqual(vm.state.profileError, .couldNotSave)
    }

    @MainActor
    func testPrefetchedAppleNonceIsConsumedImmediatelyAndOnlyOnce() async {
        let backend = FakeAccount()
        backend.appleEnabled = true
        var clock = Date(timeIntervalSince1970: 1_000)
        let vm = AccountViewModel(backend: backend, profile: FakeProfile(backend), sleep: { _ in }, now: { clock })
        await vm.idle()

        vm.prepareAppleSignIn()
        await vm.idle()
        XCTAssertEqual(backend.calls, ["appleNonce:an1"])
        // 未过期时再次预取不会重复发请求。
        vm.prepareAppleSignIn()
        await vm.idle()
        XCTAssertEqual(backend.calls, ["appleNonce:an1"])

        var seenNonces: [String] = []
        var providerDuringRequest: SignInProvider?
        // 第一次点：直接用预取好的 an1，不发第二次 nonce 请求；取消不算失败。
        vm.signInWithApple(
            request: { nonce in
                seenNonces.append(nonce)
                providerDuringRequest = vm.state.signingInProvider
                return nil
            },
            beforeIdentityChange: {},
            onSignedIn: {}
        )
        await vm.idle()
        XCTAssertEqual(seenNonces, ["an1"])
        XCTAssertEqual(providerDuringRequest, .apple)
        XCTAssertNil(vm.state.signingInProvider)
        XCTAssertEqual(backend.calls, ["appleNonce:an1"])
        XCTAssertFalse(vm.state.signInFailed)

        // 第二次点：上一次已消费，这次现取 an2 并完成登录。
        let events = Events()
        vm.signInWithApple(
            request: { nonce in
                seenNonces.append(nonce)
                return ("code-1", "Kaku")
            },
            beforeIdentityChange: { events.add("flush") },
            onSignedIn: { events.add("signedIn") }
        )
        await vm.idle()
        XCTAssertEqual(seenNonces, ["an1", "an2"])
        XCTAssertEqual(backend.calls, ["appleNonce:an1", "appleNonce:an2", "appleSignIn:code-1:Kaku"])
        XCTAssertEqual(events.list, ["flush", "signedIn"])
        XCTAssertEqual(vm.state.user?.name, "Kaku")
        XCTAssertNil(vm.state.signingInProvider)

        // 避免编译器报 clock 未变。
        clock = clock.addingTimeInterval(1)
    }

    @MainActor
    func testAppleSignInReusesInFlightPrefetchAndRefetchesWhenExpiredOrFailed() async {
        let backend = FakeAccount()
        backend.appleEnabled = true
        var clock = Date(timeIntervalSince1970: 2_000)
        let vm = AccountViewModel(backend: backend, profile: FakeProfile(backend), sleep: { _ in }, now: { clock })
        await vm.idle()

        // 1. 预取还在路上就点了 Apple 登录：复用这次在途请求，不发第二份。
        let gate = TestGate()
        backend.appleNonceGate = gate
        vm.prepareAppleSignIn()
        await gate.entered()
        var received: [String] = []
        vm.signInWithApple(
            request: { nonce in
                received.append(nonce)
                return nil
            },
            beforeIdentityChange: {},
            onSignedIn: {}
        )
        gate.open()
        await vm.idle()
        XCTAssertEqual(received, ["an1"])
        XCTAssertEqual(backend.calls, ["appleNonce:an1"])

        // 2. 预取超过有效期后丢弃并现取新值。
        backend.appleNonceGate = nil
        vm.prepareAppleSignIn()
        await vm.idle()
        clock = clock.addingTimeInterval(AccountViewModel.appleNonceTtlSeconds + 1)
        vm.signInWithApple(
            request: { nonce in
                received.append(nonce)
                return nil
            },
            beforeIdentityChange: {},
            onSignedIn: {}
        )
        await vm.idle()
        XCTAssertEqual(received, ["an1", "an3"])
        XCTAssertEqual(backend.calls, ["appleNonce:an1", "appleNonce:an2", "appleNonce:an3"])

        // 3. 后台预取失败不报错；真正点按钮时照常重试。
        backend.failAppleNonce = true
        vm.prepareAppleSignIn()
        await vm.idle()
        XCTAssertFalse(vm.state.signInFailed)
        backend.failAppleNonce = false
        vm.signInWithApple(
            request: { nonce in
                received.append(nonce)
                return nil
            },
            beforeIdentityChange: {},
            onSignedIn: {}
        )
        await vm.idle()
        XCTAssertEqual(received.last, "an5")
        XCTAssertFalse(vm.state.signInFailed)
    }
}
