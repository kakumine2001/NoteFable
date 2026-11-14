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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.TimeUnit

class AccountApiTest {
    private fun MockWebServer.api() = AccountApi(StudyMateApi(url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES).http)
    private fun MockWebServer.next() = takeRequest(1, TimeUnit.SECONDS)!!

    private val userJson = """{"user":{"name":"Ann","googleName":"Ann","icon":"🦊","avatarUrl":null}}"""

    @Test
    fun `profile patch sends only the edited fields, with null for reset`() = runBlocking {
        MockWebServer().use { server ->
            repeat(3) { server.enqueue(MockResponse().setBody(userJson)) }
            val api = server.api()
            assertEquals("🦊", api.updateProfile(ProfileEdit.icon("🦊")).icon)
            api.updateProfile(ProfileEdit.name("My Name"))
            api.updateProfile(ProfileEdit.ResetToGoogle)

            val icon = server.next()
            assertEquals("PATCH", icon.method)
            assertEquals("/api/account", icon.path)
            val iconBody = Json.parseToJsonElement(icon.body.readUtf8()).jsonObject
            assertEquals(setOf("icon"), iconBody.keys)
            assertEquals(JsonPrimitive("🦊"), iconBody["icon"])

            val name = Json.parseToJsonElement(server.next().body.readUtf8()).jsonObject
            assertEquals(setOf("displayName"), name.keys)

            val reset = Json.parseToJsonElement(server.next().body.readUtf8()).jsonObject
            assertEquals(JsonNull, reset["displayName"])
            assertEquals(JsonNull, reset["icon"])
        }
    }

    @Test
    fun `avatar upload is one multipart file field named avatar, and server errors keep their sentence`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"user":{"name":"Ann","avatarUrl":"/api/account/avatar?v=x"}}"""))
            server.enqueue(MockResponse().setResponseCode(413).setBody("""{"error":"That photo is too large."}"""))
            server.enqueue(MockResponse().setResponseCode(500).setBody("oops"))
            val api = server.api()
            val user = api.uploadAvatar(byteArrayOf(1, 2, 3), "image/webp")
            assertEquals("/api/account/avatar?v=x", user.avatarUrl)

            val request = server.next()
            assertEquals("POST", request.method)
            assertEquals("/api/account/avatar", request.path)
            assertTrue(request.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
            val body = request.body.readUtf8()
            assertTrue(body.contains("""name="file"; filename="avatar""""))
            assertTrue(body.contains("Content-Type: image/webp"))

            try {
                api.uploadAvatar(byteArrayOf(1), "image/webp")
                fail("expected 413")
            } catch (error: ApiException) {
                assertEquals("That photo is too large.", error.serverMessage())
            }
            try {
                api.uploadAvatar(byteArrayOf(1), "image/webp")
                fail("expected 500")
            } catch (error: ApiException) {
                assertNull("no error JSON: no server sentence", error.serverMessage())
            }
        }
    }

    @Test
    fun `custom instructions are read with GET and replaced with PUT, and a refusal keeps its sentence`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"instructions":null}"""))
            server.enqueue(MockResponse().setBody("""{"instructions":"Be brief."}"""))
            server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"Sign in to use custom instructions."}"""))
            val api = server.api()
            assertNull(api.customInstructions())
            assertEquals("Be brief.", api.saveCustomInstructions("Be brief."))

            val read = server.next()
            assertEquals("GET", read.method)
            assertEquals("/api/custom-instructions", read.path)
            val write = server.next()
            assertEquals("PUT", write.method)
            assertEquals("/api/custom-instructions", write.path)
            val body = Json.parseToJsonElement(write.body.readUtf8()).jsonObject
            assertEquals(setOf("instructions"), body.keys)
            assertEquals(JsonPrimitive("Be brief."), body["instructions"])

            try {
                api.customInstructions()
                fail("expected 401")
            } catch (error: ApiException) {
                assertEquals("Sign in to use custom instructions.", error.serverMessage())
            }
        }
    }

    @Test
    fun `edits apply locally like the web, and choosing an icon drops the uploaded photo`() {
        val user = AccountUser(name = "Ann", googleName = "Ann", avatarUrl = "/api/account/avatar?v=1")
        val withIcon = applyProfileEdit(user, ProfileEdit.icon("🦊"))
        assertEquals("🦊", withIcon.icon)
        assertNull(withIcon.avatarUrl)

        val renamed = applyProfileEdit(user, ProfileEdit.name("Bo"))
        assertEquals("Bo", renamed.name)
        assertEquals("/api/account/avatar?v=1", renamed.avatarUrl)

        val reset = applyProfileEdit(renamed.copy(icon = "🦊"), ProfileEdit.ResetToGoogle)
        assertEquals("Ann", reset.name)
        assertNull(reset.icon)
        assertNull(reset.avatarUrl)

        assertFalse(profileEditChanges(AccountUser(name = "Ann", googleName = "Ann"), ProfileEdit.icon(null)))
        assertTrue(profileEditChanges(user, ProfileEdit.icon(null)))
    }
}
