package com.kakumine.notefable.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class AppIconSyncTest {
    private val updated = "2026-11-22T00:00:00.000Z"

    /** 服务端的替身：GET 返回 [remote]，PUT 存下来并返回 [account]。 */
    private inner class FakeBackend : AppIconBackend {
        var account = "acct-a"
        var remote = AppIconResponse()
        var failReads = false
        var failSaves: (() -> Nothing)? = null
        var gate: CompletableDeferred<Unit>? = null
        val saved = ArrayList<String?>()

        override suspend fun accountAppIcon(): AppIconResponse {
            gate?.await()
            if (failReads) throw IOException("offline")
            return remote.copy(account = account)
        }

        override suspend fun saveAccountAppIcon(icon: String?): AppIconResponse {
            saved += icon
            failSaves?.invoke()
            remote = AppIconResponse(icon, updated)
            return remote.copy(account = account)
        }
    }

    private var stored: String? = null
    private val store = AppIconStore(read = { stored }, write = { stored = it; true })
    private val backend = FakeBackend()
    private val memory = InMemoryAppIconSyncMemory()
    private val sync = AppIconSync(store, backend, memory).apply { signedIn = true }
    private val offline: () -> Nothing = { throw IOException("offline") }

    @Test
    fun `account value wins over this device and records its owner`() = runBlocking {
        store.save("character:loop")
        backend.remote = AppIconResponse("character:sora", updated)
        sync.pull()
        assertEquals("character:sora", store.icon.value)
        assertEquals("character:sora", stored)
        assertEquals("acct-a", memory.owner)
        assertFalse(memory.pending)
    }

    @Test
    fun `account default character resets a custom image`() = runBlocking {
        store.save("data:image/png;base64,AAEC")
        backend.remote = AppIconResponse(null, updated)
        sync.pull()
        assertNull(store.icon.value)
    }

    @Test
    fun `uploads a guest choice once when the account has none yet`() = runBlocking {
        store.save("character:piko")
        sync.pull()
        assertEquals(listOf<String?>("character:piko"), backend.saved)
        assertEquals("character:piko", store.icon.value)
        assertEquals("acct-a", memory.owner)
    }

    @Test
    fun `uploads nothing when neither side chose an icon`() = runBlocking {
        sync.pull()
        assertTrue(backend.saved.isEmpty())
    }

    @Test
    fun `keeps this device's icon when offline`() = runBlocking {
        store.save("character:loop")
        backend.failReads = true
        sync.pull()
        assertEquals("character:loop", store.icon.value)
        assertTrue(backend.saved.isEmpty())
    }

    @Test
    fun `guests stay local only and their choice belongs to nobody`() = runBlocking {
        memory.owner = "acct-a"
        sync.signedIn = false
        backend.failReads = true
        sync.pull()
        assertTrue(sync.push("character:sora"))
        assertTrue(backend.saved.isEmpty())
        assertNull(memory.owner)
    }

    @Test
    fun `push reports failures but not a sign-out`() = runBlocking {
        assertTrue(sync.push("character:sora"))
        backend.failSaves = offline
        assertFalse(sync.push("character:loop"))
        backend.failSaves = { throw ApiException(401, "Sign in to sync your icon.") }
        assertTrue(sync.push("character:velo"))
        assertEquals(listOf<String?>("character:sora", "character:loop", "character:velo"), backend.saved)
    }

    @Test
    fun `a choice made while reading is not overwritten by the account value`() = runBlocking {
        backend.gate = CompletableDeferred()
        backend.remote = AppIconResponse("character:sora", updated)
        val pulling = async { sync.pull() }
        yield()
        store.save("character:velo")
        backend.remote = AppIconResponse("character:sora", updated)
        assertTrue(sync.push("character:velo"))
        backend.remote = AppIconResponse("character:sora", updated)
        backend.gate!!.complete(Unit)
        pulling.await()
        assertEquals("character:velo", store.icon.value)
    }

    @Test
    fun `a failed choice is resent instead of being reverted by the account's older value`() = runBlocking {
        memory.owner = "acct-a"
        backend.remote = AppIconResponse("character:sora", updated)
        backend.failSaves = offline
        store.save("character:loop")
        assertFalse(sync.push("character:loop"))
        assertTrue(memory.pending)

        backend.failSaves = null
        backend.remote = AppIconResponse("character:sora", updated)
        sync.pull()
        assertEquals("character:loop", store.icon.value)
        assertEquals("character:loop", backend.saved.last())
        assertFalse(memory.pending)
        assertEquals("acct-a", memory.owner)
    }

    @Test
    fun `a pending choice stays pending when the resend fails too`() = runBlocking {
        memory.owner = "acct-a"
        memory.pending = true
        store.save("character:loop")
        backend.remote = AppIconResponse("character:sora", updated)
        backend.failSaves = offline
        sync.pull()
        assertEquals("character:loop", store.icon.value)
        assertTrue(memory.pending)
    }

    @Test
    fun `another account's photo is not seeded into a never-synced account`() = runBlocking {
        memory.owner = "acct-a"
        store.save("data:image/png;base64,PHOTO")
        backend.account = "acct-b"
        sync.pull()
        assertTrue(backend.saved.isEmpty())
        assertNull(store.icon.value)
        assertNull(memory.owner)
    }

    @Test
    fun `another account's pending choice is dropped, not sent`() = runBlocking {
        memory.owner = "acct-a"
        memory.pending = true
        store.save("data:image/png;base64,PHOTO")
        backend.account = "acct-b"
        backend.remote = AppIconResponse("character:piko", updated)
        sync.pull()
        assertTrue(backend.saved.isEmpty())
        assertEquals("character:piko", store.icon.value)
        assertEquals("acct-b", memory.owner)
        assertFalse(memory.pending)
    }

    @Test
    fun `explicit sign-out resets an account's icon but keeps a guest choice`() {
        memory.owner = "acct-a"
        store.save("data:image/png;base64,PHOTO")
        sync.forgetAccount()
        assertNull(store.icon.value)
        assertNull(memory.owner)
        assertFalse(sync.signedIn)

        store.save("character:piko")
        sync.forgetAccount()
        assertEquals("character:piko", store.icon.value)

        memory.pending = true
        store.save("character:loop")
        sync.forgetAccount()
        assertNull(store.icon.value)
        assertFalse(memory.pending)
    }
}
