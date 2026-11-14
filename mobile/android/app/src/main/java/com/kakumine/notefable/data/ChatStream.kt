package com.kakumine.notefable.data

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/** `/api/chat` 的 SSE 事件。协议见 `src/lib/chat-stream.ts`。 */
sealed interface ChatStreamEvent {
    /** 响应头已到。新聊天的会话 ID 在 `X-Session-Id` 里。 */
    data class Started(val sessionId: String?) : ChatStreamEvent

    /** 本文增量。 */
    data class Delta(val text: String) : ChatStreamEvent

    /** 推理摘要、联网搜索、笔记工具的过程事件（原样保留，原生进度条以后再解析）。 */
    data class Activity(val payload: JsonObject) : ChatStreamEvent
}

object ChatStreamParser {
    /**
     * 解析一行 SSE。`data: "文本"` 是正文增量，`data: {"activity":{...}}` 是过程事件，
     * `[DONE]`、注释行、空行和读不懂的内容都返回 null（与网页端一致，宁可忽略也不中断回答）。
     */
    fun parseLine(line: String): ChatStreamEvent? {
        val trimmed = line.trim()
        if (!trimmed.startsWith("data:")) return null
        val payload = trimmed.removePrefix("data:").trim()
        if (payload.isEmpty() || payload == "[DONE]") return null

        val element: JsonElement = runCatching { NoteFableJson.parseToJsonElement(payload) }.getOrNull()
            ?: return null
        return when {
            element is JsonPrimitive && element.isString -> ChatStreamEvent.Delta(element.content)
            element is JsonObject -> element["activity"]?.let {
                runCatching { ChatStreamEvent.Activity(it.jsonObject) }.getOrNull()
            }
            else -> null
        }
    }
}
