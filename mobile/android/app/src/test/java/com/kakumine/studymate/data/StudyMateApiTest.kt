package com.kakumine.studymate.data

import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.CookieJar
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class StudyMateApiTest {
    @Test
    fun `restoring Google profile clears both name and avatar using the server contract`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"user":{"name":"Ann","icon":null,"avatarUrl":null}}"""))
            val api = StudyMateApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)

            assertEquals("Ann", AccountApi(api.http).updateProfile(ProfileEdit.ResetToGoogle).name)

            val request = server.takeRequest(1, TimeUnit.SECONDS)
            assertNotNull(request)
            assertEquals("PATCH", request!!.method)
            assertEquals("/api/account", request.path)
            val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
            assertEquals(setOf("displayName", "icon"), body.keys)
            assertEquals(JsonNull, body["displayName"])
            assertEquals(JsonNull, body["icon"])
        }
    }

    @Test
    fun `parses the usage-limit fields from a 429 body`() {
        val error = ApiException.from(
            429,
            """{"error":"You've used today's free messages. Sign in with Google for more, or try again tomorrow.","code":"usage_limit","tier":"guest","kind":"chat"}""",
        )
        assertEquals(429, error.status)
        assertEquals("You've used today's free messages. Sign in with Google for more, or try again tomorrow.", error.message)
        assertEquals("usage_limit", error.code)
        assertEquals("guest", error.tier)
        assertEquals("chat", error.kind)
        assertTrue(error.isUsageLimit)
    }

    @Test
    fun `plain and unreadable error bodies keep the old message`() {
        val plain = ApiException.from(404, """{"error":"Note not found."}""")
        assertEquals("Note not found.", plain.message)
        assertNull(plain.code)
        assertFalse(plain.isUsageLimit)
        assertEquals("HTTP 502", ApiException.from(502, "<html>Bad gateway</html>").message)
        assertEquals("HTTP 400", ApiException.from(400, """{"error":"  "}""").message)
        // 429 但不是使用上限（没有 code）时不算上限。
        assertFalse(ApiException.from(429, """{"error":"Slow down."}""").isUsageLimit)
    }

    @Test
    fun `the stream request ends with the parsed ApiException`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setResponseCode(429)
                    .setBody("""{"error":"You've reached today's message limit. Try again tomorrow.","code":"usage_limit","tier":"member","kind":"chat"}"""),
            )
            val api = StudyMateApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)
            val error = runCatching { api.streamChat(ChatRequest("hi", null, null, null)).toList() }.exceptionOrNull()
            assertTrue(error is ApiException)
            error as ApiException
            assertEquals("member", error.tier)
            assertTrue(error.isUsageLimit)
        }
    }

    @Test
    fun `JSON requests turn error responses into ApiException with the server text`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"Database is unavailable."}"""))
            val api = StudyMateApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)
            val error = runCatching { api.notes() }.exceptionOrNull() as ApiException
            assertEquals(503, error.status)
            assertEquals("Database is unavailable.", error.message)
            assertEquals(StudyMateApi.USER_AGENT, server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("User-Agent"))
        }
    }

    @Test
    fun `changing only the name preserves the existing avatar`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"user":{"name":"Local","icon":"🙂"}}"""))
            val api = StudyMateApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)

            assertEquals("🙂", AccountApi(api.http).updateProfile(ProfileEdit.name("Local")).icon)

            val request = server.takeRequest(1, TimeUnit.SECONDS)
            assertNotNull(request)
            val body = Json.parseToJsonElement(request!!.body.readUtf8()).jsonObject
            assertEquals(JsonPrimitive("Local"), body["displayName"])
            assertFalse(body.containsKey("icon"))
        }
    }
}
