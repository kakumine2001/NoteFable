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
    private class FakeBackend : AppIconBackend {
        var remote: () -> AppIconResponse = { AppIconResponse() }
        var save: (String?) -> AppIconResponse = { AppIconResponse(it, "2026-11-22T00:00:00.000Z") }
        var gate: CompletableDeferred<Unit>? = null
        val saved = ArrayList<String?>()

        override suspend fun accountAppIcon(): AppIconResponse {
            gate?.await()
            return remote()
        }

        override suspend fun saveAccountAppIcon(icon: String?): AppIconResponse {
            saved += icon
            return save(icon)
        }
    }

    private var stored: String? = null
    private val store = AppIconStore(read = { stored }, write = { stored = it; true })
    private val backend = FakeBackend()
    private val sync = AppIconSync(store, backend).apply { signedIn = true }

    @Test
    fun `account value wins over this device`() = runBlocking {
        store.save("character:loop")
        backend.remote = { AppIconResponse("character:sora", "2026-11-22T00:00:00.000Z") }
        sync.pull()
        assertEquals("character:sora", store.icon.value)
        assertEquals("character:sora", stored)
    }

    @Test
    fun `account default character resets a custom image`() = runBlocking {
        store.save("data:image/png;base64,AAEC")
        backend.remote = { AppIconResponse(null, "2026-11-22T00:00:00.000Z") }
        sync.pull()
        assertNull(store.icon.value)
    }

    @Test
    fun `uploads this device's icon once when the account has none yet`() = runBlocking {
        store.save("character:piko")
        sync.pull()
        assertEquals(listOf<String?>("character:piko"), backend.saved)
        assertEquals("character:piko", store.icon.value)
    }

    @Test
    fun `uploads nothing when neither side chose an icon`() = runBlocking {
        sync.pull()
        assertTrue(backend.saved.isEmpty())
    }

    @Test
    fun `keeps this device's icon when offline`() = runBlocking {
        store.save("character:loop")
        backend.remote = { throw IOException("offline") }
        sync.pull()
        assertEquals("character:loop", store.icon.value)
        assertTrue(backend.saved.isEmpty())
    }

    @Test
    fun `guests stay local only`() = runBlocking {
        sync.signedIn = false
        backend.remote = { error("must not read") }
        sync.pull()
        assertTrue(sync.push("character:sora"))
        assertTrue(backend.saved.isEmpty())
    }

    @Test
    fun `push reports failures but not a sign-out`() = runBlocking {
        assertTrue(sync.push("character:sora"))
        backend.save = { throw IOException("offline") }
        assertFalse(sync.push("character:loop"))
        backend.save = { throw ApiException(401, "Sign in to sync your icon.") }
        assertTrue(sync.push("character:velo"))
        assertEquals(listOf<String?>("character:sora", "character:loop", "character:velo"), backend.saved)
    }

    @Test
    fun `a choice made while reading is not overwritten by the account value`() = runBlocking {
        backend.gate = CompletableDeferred()
        backend.remote = { AppIconResponse("character:sora", "2026-11-22T00:00:00.000Z") }
        val pulling = async { sync.pull() }
        yield()
        store.save("character:velo")
        assertTrue(sync.push("character:velo"))
        backend.gate!!.complete(Unit)
        pulling.await()
        assertEquals("character:velo", store.icon.value)
    }
}
