package com.kakumine.notefable.ui

import com.kakumine.notefable.data.AccountBackend
import com.kakumine.notefable.data.AccountProfileBackend
import com.kakumine.notefable.data.AccountResponse
import com.kakumine.notefable.data.AccountUser
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.ProfileEdit
import com.kakumine.notefable.data.applyProfileEdit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeAccount : AccountBackend {
        var user: AccountUser? = null
        val calls = mutableListOf<String>()
        var failSignIn = false

        /** 接下来这么多次读账号会失败（模拟登录后那一下网络不通）。 */
        var failAccountTimes = 0

        override suspend fun account(): AccountResponse {
            if (failAccountTimes > 0) {
                failAccountTimes--
                throw IOException("offline")
            }
            return AccountResponse(configured = true, user = user, googleClientId = "web-client")
        }

        override suspend fun nativeSignInNonce(): String {
            calls += "nonce"
            return "n1"
        }

        override suspend fun nativeSignIn(idToken: String) {
            calls += "signIn:$idToken"
            if (failSignIn) throw IOException("rejected")
            user = AccountUser(name = "Ann", googleName = "Ann", email = "a@example.test")
        }

        override suspend fun signOut() {
            calls += "signOut"
            user = null
        }

        var emailEnabled = false
        var failEmail: Throwable? = null

        override suspend fun emailSignInStart(email: String, locale: String) {
            calls += "emailStart:$email:$locale"
            failEmail?.let { throw it }
        }

        override suspend fun emailSignInVerify(email: String, code: String) {
            calls += "emailVerify:$email:$code"
            failEmail?.let { throw it }
            user = AccountUser(name = null, googleName = null, email = email)
        }
    }

    @Test
    fun `the server decides which sign-in methods the dialog lists`() = runTest(dispatcher) {
        val vm = model(FakeAccount())
        advanceUntilIdle()
        // FakeAccount.account() 不带 google / email：Google 缺省算开，邮箱缺省算关（网页 SignInDialog 的规则）。
        assertTrue(vm.state.value.googleEnabled)
        assertFalse(vm.state.value.emailEnabled)
    }

    @Test
    fun `email sign-in sends a code, verifies it after saving open work, and reports the new identity`() = runTest(dispatcher) {
        val backend = FakeAccount()
        val vm = model(backend)
        advanceUntilIdle()
        assertNull(vm.sendEmailCode("a@example.test", "ja"))
        val order = mutableListOf<String>()
        assertNull(vm.verifyEmailCode("a@example.test", "123456", { order += "flush:" + backend.calls.last() }, { order += "signedIn" }))
        assertEquals(listOf("emailStart:a@example.test:ja", "emailVerify:a@example.test:123456"), backend.calls)
        // 先存笔记，再核对验证码，最后通知换了身份。
        assertEquals(listOf("flush:emailStart:a@example.test:ja", "signedIn"), order)
        assertEquals("a@example.test", vm.state.value.user?.email)
    }

    @Test
    fun `email sign-in failures keep the server sentence, or fall back like the web`() = runTest(dispatcher) {
        val backend = FakeAccount()
        val vm = model(backend)
        advanceUntilIdle()
        backend.failEmail = ApiException(400, "That code is incorrect.")
        var signedIn = false
        assertEquals(SignInError.Server("That code is incorrect."), vm.verifyEmailCode("a@example.test", "000000", {}, { signedIn = true }))
        assertFalse(signedIn)
        assertNull(vm.state.value.user)
        backend.failEmail = ApiException(500, "HTTP 500")
        assertEquals(SignInError.Generic, vm.sendEmailCode("a@example.test", "en"))
        backend.failEmail = IOException("offline")
        assertEquals(SignInError.Offline, vm.sendEmailCode("a@example.test", "en"))
    }

    @Test
    fun `a note that cannot be saved stops the email sign-in before the code is checked`() = runTest(dispatcher) {
        val backend = FakeAccount()
        val vm = model(backend)
        advanceUntilIdle()
        assertEquals(SignInError.Generic, vm.verifyEmailCode("a@example.test", "123456", { throw IllegalStateException("save failed") }, {}))
        assertTrue(backend.calls.none { it.startsWith("emailVerify") })
    }

    @Test
    fun `when the account cannot be read right after an accepted code, sign-in still succeeds and the account is read again`() = runTest(dispatcher) {
        val backend = FakeAccount()
        val vm = model(backend)
        advanceUntilIdle()
        backend.failAccountTimes = 2
        var signedIn = false
        assertNull(vm.verifyEmailCode("a@example.test", "123456", {}, { signedIn = true }))
        assertTrue(signedIn)
        assertNull(vm.state.value.user)
        // 2 秒后的第一次重读还失败，再过 4 秒读到。
        advanceUntilIdle()
        assertEquals("a@example.test", vm.state.value.user?.email)
    }

    @Test
    fun `the code field keeps only six digits`() {
        assertEquals("123456", cleanLoginCode("12 34-56 78"))
        assertEquals("", cleanLoginCode("abc"))
    }

    /** 假的资料接口：记下每次发出的编辑；[gate] 不为 null 时等它放行才回复（用来看排队）。 */
    private class FakeProfile(private val account: FakeAccount) : AccountProfileBackend {
        val edits = mutableListOf<ProfileEdit>()
        val uploads = mutableListOf<String>()
        var gate: CompletableDeferred<Unit>? = null
        var failEdit: Throwable? = null
        var failUpload: Throwable? = null

        override suspend fun updateProfile(edit: ProfileEdit): AccountUser {
            edits += edit
            gate?.await()
            failEdit?.let { throw it }
            val next = applyProfileEdit(account.user!!, edit)
            account.user = next
            return next
        }

        override suspend fun uploadAvatar(bytes: ByteArray, mimeType: String): AccountUser {
            uploads += "${bytes.size}:$mimeType"
            gate?.await()
            failUpload?.let { throw it }
            val next = account.user!!.copy(avatarUrl = "/api/account/avatar?v=new", icon = null)
            account.user = next
            return next
        }

        var instructions: String? = null
        var failInstructions: Throwable? = null

        override suspend fun customInstructions(): String? {
            failInstructions?.let { throw it }
            return instructions
        }

        override suspend fun saveCustomInstructions(instructions: String): String? {
            failInstructions?.let { throw it }
            this.instructions = instructions.ifEmpty { null }
            return this.instructions
        }
    }

    @Test
    fun `custom instructions load as text, save trimmed, and hand failures back`() = runTest(dispatcher) {
        val backend = FakeAccount()
        val profile = FakeProfile(backend)
        val model = model(backend, profile)
        assertEquals("", model.loadCustomInstructions().getOrThrow())
        assertNull(model.saveCustomInstructions("  Be brief.\n"))
        assertEquals("Be brief.", profile.instructions)
        assertEquals("Be brief.", model.loadCustomInstructions().getOrThrow())
        assertNull(model.saveCustomInstructions("   "))
        assertNull(profile.instructions)

        val failure = ApiException(401, "Sign in to use custom instructions.")
        profile.failInstructions = failure
        assertEquals(failure, model.loadCustomInstructions().exceptionOrNull())
        assertEquals(failure, model.saveCustomInstructions("x"))
    }

    @Test
    fun `settings save only when the trimmed text changed, and clipping never splits an emoji`() {
        assertFalse(customInstructionsChanged("Be brief.", "  Be brief.\n"))
        assertFalse(customInstructionsChanged("", "   "))
        assertTrue(customInstructionsChanged("Be brief.", "Be brief!"))
        assertTrue(customInstructionsChanged("Be brief.", ""))

        assertEquals("abc", clipInstructions("abc", 4))
        assertEquals("abcd", clipInstructions("abcde", 4))
        assertEquals("abc", clipInstructions("abc😀", 4))
        assertEquals("ab😀", clipInstructions("ab😀x", 4))
    }

    private fun model(backend: FakeAccount, profile: FakeProfile = FakeProfile(backend)) = AccountViewModel(backend, profile)

    @Test
    fun `sign in asks for a nonce, then the token, then the server, and reports the new identity`() = runTest(dispatcher) {
        val backend = FakeAccount()
        val vm = model(backend)
        advanceUntilIdle()
        assertTrue(vm.state.value.configured)
        assertNull(vm.state.value.user)

        var identityChanged = false
        var nonceSeen: String? = null
        vm.signIn(fetchIdToken = { clientId, nonce -> nonceSeen = "$clientId/$nonce"; "tok" }, onSignedIn = { identityChanged = true })
        advanceUntilIdle()

        assertEquals(listOf("nonce", "signIn:tok"), backend.calls)
        assertEquals("web-client/n1", nonceSeen)
        assertEquals("Ann", vm.state.value.user?.name)
        assertTrue(identityChanged)
        assertFalse(vm.state.value.signInFailed)
        assertFalse(vm.state.value.signingIn)
    }

    @Test
    fun `closing the account picker is not a failure and sends nothing to the server`() = runTest(dispatcher) {
        val backend = FakeAccount()
        val vm = model(backend)
        advanceUntilIdle()

        var identityChanged = false
        vm.signIn(fetchIdToken = { _, _ -> null }, onSignedIn = { identityChanged = true })
        advanceUntilIdle()

        assertEquals(listOf("nonce"), backend.calls)
        assertFalse(identityChanged)
        assertFalse(vm.state.value.signInFailed)
    }

    @Test
    fun `a rejected token shows the failure state and keeps the user signed out`() = runTest(dispatcher) {
        val backend = FakeAccount().apply { failSignIn = true }
        val vm = model(backend)
        advanceUntilIdle()

        var identityChanged = false
        vm.signIn(fetchIdToken = { _, _ -> "tok" }, onSignedIn = { identityChanged = true })
        advanceUntilIdle()

        assertTrue(vm.state.value.signInFailed)
        assertNull(vm.state.value.user)
        assertFalse(identityChanged)
        assertFalse(vm.state.value.signingIn)
    }

    @Test
    fun `sign out clears the user and tells the chat screen the identity changed`() = runTest(dispatcher) {
        val backend = FakeAccount().apply { user = AccountUser(name = "Ann", googleName = "Ann") }
        val vm = model(backend)
        advanceUntilIdle()
        assertEquals("Ann", vm.state.value.user?.name)

        var cleared = false
        var identityChanged = false
        vm.signOut(clearDeviceChoice = { cleared = true }, onSignedOut = { identityChanged = true })
        advanceUntilIdle()

        assertTrue(cleared)
        assertTrue(identityChanged)
        assertNull(vm.state.value.user)
        assertTrue(backend.calls.contains("signOut"))
    }

    @Test
    fun `saving a name equal to the Google name resets to Google, and an unchanged name saves nothing`() = runTest(dispatcher) {
        val backend = FakeAccount().apply { user = AccountUser(name = "Ann", googleName = "Ann", displayName = null) }
        val profile = FakeProfile(backend)
        val vm = model(backend, profile)
        advanceUntilIdle()

        vm.saveName("  Ann ")
        advanceUntilIdle()
        assertTrue("same as the Google name and nothing stored: no request", profile.edits.isEmpty())

        vm.saveName("  My   Name ")
        advanceUntilIdle()
        assertEquals(listOf(ProfileEdit.name("My Name")), profile.edits)
        assertEquals("My Name", vm.state.value.user?.displayName)
    }

    @Test
    fun `an emoji shows at once, drops the photo, and later edits wait their turn`() = runTest(dispatcher) {
        val backend = FakeAccount().apply { user = AccountUser(name = "Ann", googleName = "Ann", avatarUrl = "/api/account/avatar?v=1") }
        val profile = FakeProfile(backend).apply { gate = CompletableDeferred() }
        val vm = model(backend, profile)
        advanceUntilIdle()

        vm.setIcon("🦊")
        vm.saveName("Bo")
        advanceUntilIdle()
        // 第一次还没回复：界面已经是新表情、新名字，第二次还没发出去。
        assertEquals("🦊", vm.state.value.user?.icon)
        assertNull(vm.state.value.user?.avatarUrl)
        assertEquals("Bo", vm.state.value.user?.name)
        assertEquals(listOf(ProfileEdit.icon("🦊")), profile.edits)

        profile.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf(ProfileEdit.icon("🦊"), ProfileEdit.name("Bo")), profile.edits)
        assertEquals("🦊", vm.state.value.user?.icon)
        assertEquals("Bo", vm.state.value.user?.displayName)
    }

    @Test
    fun `a failed edit rolls back only itself and shows the server sentence or the web fallback`() = runTest(dispatcher) {
        val backend = FakeAccount().apply { user = AccountUser(name = "Ann", googleName = "Ann") }
        val profile = FakeProfile(backend).apply { failEdit = ApiException(400, "Icon must be a single emoji.") }
        val vm = model(backend, profile)
        advanceUntilIdle()

        vm.setIcon("x")
        advanceUntilIdle()
        assertNull(vm.state.value.user?.icon)
        assertEquals(ProfileError.Server("Icon must be a single emoji."), vm.state.value.profileError)

        profile.failEdit = ApiException(500, "HTTP 500")
        vm.setIcon("🦊")
        advanceUntilIdle()
        assertEquals(ProfileError.CouldNotSave, vm.state.value.profileError)

        profile.failEdit = null
        vm.setIcon("🐼")
        advanceUntilIdle()
        assertEquals("🐼", vm.state.value.user?.icon)
        assertNull("a later success clears the error", vm.state.value.profileError)
    }

    @Test
    fun `remove my photo sends icon null, and nothing is sent when already on the Google photo`() = runTest(dispatcher) {
        val backend = FakeAccount().apply { user = AccountUser(name = "Ann", googleName = "Ann", avatarUrl = "/api/account/avatar?v=1") }
        val profile = FakeProfile(backend)
        val vm = model(backend, profile)
        advanceUntilIdle()

        vm.setIcon(null)
        advanceUntilIdle()
        assertEquals(listOf(ProfileEdit.icon(null)), profile.edits)
        assertNull(vm.state.value.user?.avatarUrl)

        vm.setIcon(null)
        advanceUntilIdle()
        assertEquals("already the Google photo: nothing sent", 1, profile.edits.size)
    }

    @Test
    fun `uploading a photo stays busy until the server answers, then shows the new photo`() = runTest(dispatcher) {
        val backend = FakeAccount().apply { user = AccountUser(name = "Ann", googleName = "Ann", icon = "🦊") }
        val profile = FakeProfile(backend).apply { gate = CompletableDeferred() }
        val vm = model(backend, profile)
        advanceUntilIdle()

        var saved = false
        vm.uploadPhoto(ByteArray(10), "image/webp") { saved = true }
        advanceUntilIdle()
        assertTrue(vm.state.value.uploading)
        assertFalse(saved)

        profile.gate!!.complete(Unit)
        advanceUntilIdle()
        assertFalse(vm.state.value.uploading)
        assertTrue(saved)
        assertEquals(listOf("10:image/webp"), profile.uploads)
        assertEquals("/api/account/avatar?v=new", vm.state.value.user?.avatarUrl)
        assertNull(vm.state.value.user?.icon)
    }

    @Test
    fun `upload failures keep the editor open with the web's messages`() = runTest(dispatcher) {
        val backend = FakeAccount().apply { user = AccountUser(name = "Ann", googleName = "Ann") }
        val profile = FakeProfile(backend)
        val vm = model(backend, profile)
        advanceUntilIdle()
        var saved = false

        profile.failUpload = ApiException(413, "That photo is too large.")
        vm.uploadPhoto(ByteArray(1), "image/webp") { saved = true }
        advanceUntilIdle()
        assertEquals(PhotoError.Server("That photo is too large."), vm.state.value.photoError)

        profile.failUpload = ApiException(502, "HTTP 502")
        vm.uploadPhoto(ByteArray(1), "image/webp") { saved = true }
        advanceUntilIdle()
        assertEquals(PhotoError.UploadFailed, vm.state.value.photoError)

        profile.failUpload = IOException("offline")
        vm.uploadPhoto(ByteArray(1), "image/webp") { saved = true }
        advanceUntilIdle()
        assertEquals(PhotoError.Offline, vm.state.value.photoError)
        assertFalse(saved)
        assertFalse(vm.state.value.uploading)
    }

    @Test
    fun `sign out waits for pending saves first`() = runTest(dispatcher) {
        val backend = FakeAccount().apply { user = AccountUser(name = "Ann", googleName = "Ann") }
        val profile = FakeProfile(backend).apply { gate = CompletableDeferred() }
        val vm = model(backend, profile)
        advanceUntilIdle()

        vm.setIcon("🦊")
        vm.signOut(clearDeviceChoice = {}, onSignedOut = {})
        advanceUntilIdle()
        assertFalse("still saving: not signed out yet", backend.calls.contains("signOut"))

        profile.gate!!.complete(Unit)
        advanceUntilIdle()
        assertTrue(backend.calls.contains("signOut"))
        assertNull(vm.state.value.user)
    }

    @Test
    fun `a name saved right before sign out is sent before signing out`() = runTest(dispatcher) {
        val backend = FakeAccount().apply { user = AccountUser(name = "Ann", googleName = "Ann") }
        val profile = FakeProfile(backend)
        val vm = model(backend, profile)
        advanceUntilIdle()

        var editsAtSignOut: List<ProfileEdit>? = null
        // ProfileMenu 的 Sign out：先 saveName(draft)，再 signOut。
        vm.saveName("Bo")
        vm.signOut(clearDeviceChoice = {}, onSignedOut = { editsAtSignOut = profile.edits.toList() })
        advanceUntilIdle()

        assertEquals(listOf(ProfileEdit.name("Bo")), editsAtSignOut)
        assertTrue(backend.calls.contains("signOut"))
        assertNull(vm.state.value.profileError)
    }
}
