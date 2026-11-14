package com.kakumine.studymate.data

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
import org.junit.Test
import java.util.concurrent.TimeUnit

class StudyMateApiTest {
    @Test
    fun `restoring Google profile clears both name and avatar using the server contract`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"user":{"name":"Ann","icon":null,"avatarUrl":null}}"""))
            val api = StudyMateApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)

            assertEquals("Ann", api.updateProfile(null, resetToGoogle = true)?.name)

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
    fun `changing only the name preserves the existing avatar`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"user":{"name":"Local","icon":"🙂"}}"""))
            val api = StudyMateApi(server.url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES)

            assertEquals("🙂", api.updateProfile("Local", resetToGoogle = false)?.icon)

            val request = server.takeRequest(1, TimeUnit.SECONDS)
            assertNotNull(request)
            val body = Json.parseToJsonElement(request!!.body.readUtf8()).jsonObject
            assertEquals(JsonPrimitive("Local"), body["displayName"])
            assertFalse(body.containsKey("icon"))
        }
    }
}
