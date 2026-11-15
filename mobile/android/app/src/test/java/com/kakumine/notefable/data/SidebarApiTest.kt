package com.kakumine.notefable.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import okhttp3.CookieJar
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class SidebarApiTest {
    private fun MockWebServer.http() = NoteFableApi(url("/").toString().trimEnd('/'), CookieJar.NO_COOKIES).http
    private fun MockWebServer.next() = takeRequest(1, TimeUnit.SECONDS)!!
    private fun body(request: okhttp3.mockwebserver.RecordedRequest) = Json.parseToJsonElement(request.body.readUtf8()).jsonObject

    @Test
    fun `session patch sends only the given fields and null moves out of a project`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{}"))
            server.enqueue(MockResponse().setBody("{}"))
            val api = SessionsApi(server.http())
            api.updateSession("s 1", pinned = true)
            api.updateSession("s1", title = "T", project = ProjectChange(null))
            val first = server.next()
            assertEquals("PATCH", first.method)
            assertEquals("/api/sessions/s+1", first.path)
            assertEquals(setOf("pinned"), body(first).keys)
            val second = body(server.next())
            assertEquals(JsonPrimitive("T"), second["title"])
            assertEquals(JsonNull, second["projectId"])
            assertFalse("pinned" in second)
        }
    }

    @Test
    fun `creates a chat inside a project and parses reorder updates`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"session":{"id":"n","title":"New chat","projectId":"p"}}"""))
            server.enqueue(MockResponse().setBody("""{"items":[{"id":"a","position":0,"pinned":false,"projectId":null},{"id":"b","position":1}]}"""))
            val api = SessionsApi(server.http())
            assertEquals("p", api.createSession("p").projectId)
            assertEquals(JsonPrimitive("p"), body(server.next())["projectId"])
            val updates = api.reorderSession("a", "b", after = true)
            val request = server.next()
            assertEquals("/api/sessions/reorder", request.path)
            assertEquals(JsonPrimitive(true), body(request)["after"])
            assertTrue(updates[0].movedGroup)
            assertNull(updates[0].projectId)
            assertFalse(updates[1].movedGroup)
        }
    }

    @Test
    fun `project settings send only changed fields and errors keep the server sentence`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"project":{"id":"p","name":"P","noteCount":2,"hasInstructions":false}}"""))
            server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"Project name is required."}"""))
            val api = ProjectsApi(server.http())
            assertEquals(2, api.updateProjectSettings("p", null, listOf("a", "b")).noteCount)
            val sent = body(server.next())
            assertEquals(setOf("noteIds"), sent.keys)
            assertEquals(2, sent["noteIds"]!!.jsonArray.size)
            val error = runCatching { api.createProject("") }.exceptionOrNull() as ApiException
            assertEquals("Project name is required.", error.message)
        }
    }
}
