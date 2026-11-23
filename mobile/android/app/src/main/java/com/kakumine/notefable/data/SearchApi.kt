package com.kakumine.notefable.data

import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrl

/** 检索范围（网页 src/types/search.ts 的 SEARCH_SCOPES）。 */
enum class SearchScope(val wire: String) { All("all"), Chats("chats"), Notes("notes") }

@Serializable
data class NoteSearchResult(
    val id: String,
    val title: String = "",
    val icon: String? = null,
    val snippet: String = "",
    /** 命中的块（笔记是块、白板是元素、幻灯片是页）；只命中标题时为 null。打开时作为编辑器地址的 `reveal` 传给网页。 */
    val blockId: String? = null,
    val updatedAt: String = "",
    /** 页面类型（笔记 / 白板 / 幻灯片）。JSON 里的 `kind` 是结果的种类（note / chat），所以叫这个名字；旧服务端不返回，按笔记。 */
    val pageKind: PageKind = PageKind.Note,
)

@Serializable
data class ChatSearchResult(
    val id: String,
    val title: String = "",
    val icon: String? = null,
    /** 命中的消息（或其附件）的摘录；只命中标题时为空。 */
    val snippet: String = "",
    val messageId: String? = null,
    /** USER / ASSISTANT。 */
    val role: String? = null,
    /** 摘录来自附件正文时的文件名。 */
    val attachmentName: String? = null,
    val projectId: String? = null,
    val titleMatch: Boolean = false,
    val updatedAt: String = "",
)

@Serializable
data class SearchResponse(
    val query: String = "",
    val notes: List<NoteSearchResult> = emptyList(),
    val chats: List<ChatSearchResult> = emptyList(),
)

/**
 * 聊天和笔记的横断检索：`GET /api/search?q=&scope=&projectId=&kind=`（和网页 search-dialog.tsx 同一个接口）。
 * [kind] 是 Notes 的类型筛选（"note" / "slides" / "whiteboard"，null 是全部类型）。
 */
fun interface SearchBackend {
    suspend fun search(query: String, scope: SearchScope, projectId: String?, kind: String?): SearchResponse
}

class SearchApi internal constructor(private val http: NoteFableHttp) : SearchBackend {
    override suspend fun search(query: String, scope: SearchScope, projectId: String?, kind: String?): SearchResponse {
        val url = http.absoluteUrl("/api/search").toHttpUrl().newBuilder()
            .addQueryParameter("q", query)
            .addQueryParameter("scope", scope.wire)
            .apply { if (!projectId.isNullOrEmpty()) addQueryParameter("projectId", projectId) }
            .apply { if (!kind.isNullOrEmpty()) addQueryParameter("kind", kind) }
            .build()
        return http.getJson(url.toString())
    }
}
