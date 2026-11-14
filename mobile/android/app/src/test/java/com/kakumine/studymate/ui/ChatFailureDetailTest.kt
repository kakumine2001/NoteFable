package com.kakumine.studymate.ui

import com.kakumine.studymate.data.ApiException
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class ChatFailureDetailTest {
    @Test
    fun connectionFailuresUseTheDictionarySentence() {
        assertEquals(CONNECTION_FAILED, chatFailureDetail(ConnectException("Failed to connect to localhost/127.0.0.1:3400")))
        assertEquals(CONNECTION_FAILED, chatFailureDetail(UnknownHostException("Unable to resolve host \"example.com\"")))
        assertEquals(CONNECTION_FAILED, chatFailureDetail(SocketTimeoutException("timeout")))
        assertEquals(CONNECTION_FAILED, chatFailureDetail(java.net.SocketException("Software caused connection abort")))
    }

    @Test
    fun serverAndOtherErrorsKeepTheirOwnText() {
        assertEquals("Note not found.", chatFailureDetail(ApiException(404, "Note not found.")))
        assertEquals("Failed to generate image.", chatFailureDetail(IOException("Failed to generate image.")))
        assertEquals("IllegalStateException", chatFailureDetail(IllegalStateException()))
    }
}
