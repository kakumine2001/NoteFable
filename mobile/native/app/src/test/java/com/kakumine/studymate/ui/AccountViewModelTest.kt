package com.kakumine.studymate.ui

import com.kakumine.studymate.data.AccountBackend
import com.kakumine.studymate.data.AccountResponse
import com.kakumine.studymate.data.AccountUser
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
        var lastProfile: Pair<String?, Boolean>? = null

        override suspend fun account() = AccountResponse(configured = true, user = user, googleClientId = "web-client")
        override suspend fun updateProfile(displayName: String?, resetToGoogle: Boolean): AccountUser? {
            lastProfile = displayName to resetToGoogle
            return user?.copy(displayName = displayName, name = displayName ?: user?.googleName)
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
    }

    @Test
    fun `sign in asks for a nonce, then the token, then the server, and reports the new identity`() = runTest(dispatcher) {
        val backend = FakeAccount()
        val vm = AccountViewModel(backend)
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
        val vm = AccountViewModel(backend)
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
        val vm = AccountViewModel(backend)
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
        val vm = AccountViewModel(backend)
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
        val vm = AccountViewModel(backend)
        advanceUntilIdle()

        vm.saveName("  Ann ")
        advanceUntilIdle()
        assertNull("same as the Google name and nothing stored: no request", backend.lastProfile)

        vm.saveName("  My   Name ")
        advanceUntilIdle()
        assertEquals("My Name" to false, backend.lastProfile)
        assertEquals("My Name", vm.state.value.user?.displayName)
    }
}
