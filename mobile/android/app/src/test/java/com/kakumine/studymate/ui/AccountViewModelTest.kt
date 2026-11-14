package com.kakumine.studymate.ui

import com.kakumine.studymate.data.AccountBackend
import com.kakumine.studymate.data.AccountProfileBackend
import com.kakumine.studymate.data.AccountResponse
import com.kakumine.studymate.data.AccountUser
import com.kakumine.studymate.data.ApiException
import com.kakumine.studymate.data.ProfileEdit
import com.kakumine.studymate.data.applyProfileEdit
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

        override suspend fun account() = AccountResponse(configured = true, user = user, googleClientId = "web-client")

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
