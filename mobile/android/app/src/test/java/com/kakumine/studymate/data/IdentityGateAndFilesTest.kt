package com.kakumine.studymate.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class IdentityGateAndFilesTest {
    /** 只按名字记 Cookie 的 jar，够看出每个请求带的是哪个身份。 */
    private class MemoryJar : CookieJar {
        val cookies: MutableMap<String, Cookie> = Collections.synchronizedMap(mutableMapOf())
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) = cookies.forEach { this.cookies[it.name] = it }
        override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(cookies) { cookies.values.toList() }
    }

    /**
     * 像服务端一样：没带设备 Cookie 的请求各签发一个新身份。第一个请求故意慢，
     * 没有闸门的话后面的请求会在它回来之前出发，拿到另一个身份。
     */
    private fun identityServer(firstArrived: CountDownLatch, release: CountDownLatch): Pair<MockWebServer, MutableList<String?>> {
        val seen: MutableList<String?> = Collections.synchronizedList(mutableListOf())
        var minted = 0
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val device = request.getHeader("Cookie")?.split("; ")
                    ?.firstOrNull { it.startsWith("studymate_device=") }?.substringAfter('=')
                seen += device
                val response = MockResponse().setBody("""{"sessions":[],"pages":[],"groups":[]}""")
                if (device != null) return response
                val id = synchronized(this) { "d${++minted}" }
                if (id == "d1") {
                    firstArrived.countDown()
                    release.await(5, TimeUnit.SECONDS)
                }
                return response.addHeader("Set-Cookie", "studymate_device=$id; Path=/")
            }
        }
        server.start()
        return server to seen
    }

    @Test
    fun `before the identity is settled, other requests wait for the first one`() = runBlocking {
        val firstArrived = CountDownLatch(1)
        val release = CountDownLatch(1)
        val (server, seen) = identityServer(firstArrived, release)
        server.use {
            val jar = MemoryJar()
            val api = StudyMateApi(server.url("/").toString().trimEnd('/'), jar)
            val sessions = async(Dispatchers.IO) { api.sessions() }
            assertTrue(firstArrived.await(5, TimeUnit.SECONDS))
            val notes = async(Dispatchers.IO) { api.notes() }
            // 给第二个请求一点时间：有闸门时它到不了服务端。
            Thread.sleep(300)
            assertEquals(1, server.requestCount)
            release.countDown()
            sessions.await()
            notes.await()
            assertEquals(listOf(null, "d1"), seen.toList())
            assertEquals("d1", jar.cookies["studymate_device"]?.value)
            assertTrue(api.identityGate.isSettled)
        }
    }

    @Test
    fun `the models list neither waits nor settles the identity`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"models":[],"defaultModel":null}"""))
            val api = StudyMateApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)
            runCatching { api.models() }
            assertEquals(1, server.requestCount)
            assertFalse(api.identityGate.isSettled)
        }
    }

    @Test
    fun `after sign-out the next request runs alone again`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"sessions":[]}"""))
            server.enqueue(MockResponse().setBody("""{"csrfToken":"t"}"""))
            server.enqueue(MockResponse())
            val api = StudyMateApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)
            assertFalse(api.identityGate.isSettled)
            api.sessions()
            assertTrue(api.identityGate.isSettled)
            api.signOut()
            assertFalse(api.identityGate.isSettled)
        }
    }

    @Test
    fun `recognises only same-site note file links`() {
        val base = "https://studymate.example"
        assertTrue(NoteFileLinks.isNoteFile("https://studymate.example/api/pages/files?key=note-files%2Fu%2Fx.pdf&name=a.pdf", base))
        assertFalse(NoteFileLinks.isNoteFile("https://studymate.example/api/pages/files", base))
        assertFalse(NoteFileLinks.isNoteFile("https://other.example/api/pages/files?key=k", base))
        assertFalse(NoteFileLinks.isNoteFile("http://studymate.example/api/pages/files?key=k", base))
        assertFalse(NoteFileLinks.isNoteFile("https://studymate.example/api/pages/files/x?key=k", base))
        assertFalse(NoteFileLinks.isNoteFile("not a url", base))
    }

    @Test
    fun `file names come from the header, then the link, and never contain paths`() {
        val url = "https://s.example/api/pages/files?key=k&name=from%20link.txt".toHttpUrl()
        assertEquals(
            "講義 ノート+1.pdf",
            NoteFileLinks.fileName("attachment; filename*=UTF-8''%E8%AC%9B%E7%BE%A9%20%E3%83%8E%E3%83%BC%E3%83%88+1.pdf", url),
        )
        assertEquals("from link.txt", NoteFileLinks.fileName(null, url))
        assertEquals("_etc_passwd", NoteFileLinks.fileName("attachment; filename*=UTF-8''%2Fetc%2Fpasswd", url))
        assertEquals("file", NoteFileLinks.fileName(null, "https://s.example/api/pages/files?key=k".toHttpUrl()))
        assertEquals("from link.txt", NoteFileLinks.fileName(url.toString()))
    }

    @Test
    fun `downloads a private note file with the app cookies`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody("hello").setHeader("Content-Type", "application/pdf")
                    .setHeader("Content-Disposition", "attachment; filename*=UTF-8''notes.pdf"),
            )
            val jar = MemoryJar()
            val base = server.url("/").toString().trimEnd('/')
            jar.cookies["studymate_device"] = Cookie.Builder().name("studymate_device").value("me").domain(server.hostName).build()
            val api = StudyMateApi(base, jar)
            val out = ByteArrayOutputStream()
            var asked: Pair<String, String>? = null
            val result = api.downloadNoteFile("$base/api/pages/files?key=k&name=x.pdf") { name, type -> asked = name to type; out }
            assertEquals(NoteFileDownload("notes.pdf", "application/pdf"), result)
            assertEquals("notes.pdf" to "application/pdf", asked)
            assertEquals("hello", out.toString("UTF-8"))
            assertEquals("studymate_device=me", server.takeRequest().getHeader("Cookie"))
        }
    }

    @Test
    fun `a missing file reports the server message`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"File not found."}"""))
            val api = StudyMateApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)
            val error = runCatching { api.downloadNoteFile("/api/pages/files?key=k") { _, _ -> ByteArrayOutputStream() } }.exceptionOrNull()
            assertTrue(error is ApiException)
            assertEquals("File not found.", error?.message)
        }
    }
}
