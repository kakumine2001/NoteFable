package com.kakumine.notefable.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// 笔记列表、项目（分组）、回收站的服务端 JSON，字段与 src/types/notes.ts 和 src/app/api/pages 一致。
// 笔记正文不在这里：编辑器是网页的 /note-embed，App 只管列表和导航。

@Serializable
data class NotePageSummary(
    val id: String,
    val title: String = "",
    val icon: String? = null,
    val version: Int = 0,
    /** 所属项目；null 是"未分组"。 */
    val groupId: String? = null,
    val position: Int = 0,
    val createdAt: String = "",
    val updatedAt: String = "",
)

@Serializable
data class NoteGroupSummary(val id: String, val name: String, val position: Int = 0)

@Serializable
data class NotesList(val pages: List<NotePageSummary> = emptyList(), val groups: List<NoteGroupSummary> = emptyList())

/** deletedAt 是移进回收站的时刻，purgeAt 是不能再恢复、会被永久删除的时刻（ISO 字符串）。 */
@Serializable
data class NoteTrashItem(val id: String, val title: String = "", val icon: String? = null, val deletedAt: String, val purgeAt: String)

/**
 * `POST /api/pages/reorder` 返回的新顺序（`{items:[{id, position, groupId?}]}`）。只有被移动的那一篇带 groupId
 * （跨项目拖动时服务端顺便改它的项目），null 也是有效值（移出项目），所以用 [movedGroup] 记字段在不在。
 */
data class NoteOrderUpdate(val id: String, val position: Int, val groupId: String? = null, val movedGroup: Boolean = false) {
    companion object {
        fun parse(response: JsonObject): List<NoteOrderUpdate> {
            val items = response["items"] as? kotlinx.serialization.json.JsonArray ?: return emptyList()
            return items.mapNotNull { element ->
                val item = element as? JsonObject ?: return@mapNotNull null
                val id = (item["id"] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
                val position = (item["position"] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { !it.isString }
                    ?.content?.toIntOrNull() ?: return@mapNotNull null
                val moved = "groupId" in item
                val groupId = if (moved) (item["groupId"] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull else null
                NoteOrderUpdate(id, position, groupId, moved)
            }
        }
    }
}

@Serializable
internal data class PageResponse(val page: NotePageSummary)

@Serializable
internal data class GroupResponse(val group: NoteGroupSummary)

@Serializable
internal data class TrashResponse(val pages: List<NoteTrashItem> = emptyList())

/** 笔记相关的服务端能力。拆成接口是为了单元测试时换成假实现。 */
interface NotesBackend {
    suspend fun notes(): NotesList

    /** 和网页的"New note"一样，建一篇空白的 Untitled 笔记。 */
    suspend fun createNote(): NotePageSummary

    /** 移到回收站（服务端只记 deletedAt，30 天内可恢复）。 */
    suspend fun trashNote(id: String)

    suspend fun moveNote(id: String, groupId: String?)

    /** 拖动排序：把 [id] 放到 [targetId] 的前 / 后（网页 ReorderRequest）。目标在别的项目里时也一起移过去。 */
    suspend fun reorderNote(id: String, targetId: String, after: Boolean): List<NoteOrderUpdate>
    suspend fun createGroup(name: String): NoteGroupSummary
    suspend fun renameGroup(id: String, name: String): NoteGroupSummary
    suspend fun deleteGroup(id: String)

    suspend fun trash(): List<NoteTrashItem>
    suspend fun restoreNote(id: String): NotePageSummary
    suspend fun deleteForever(id: String)

    /** 清空回收站；[before] 是确认时看到的最新一条的 deletedAt，确认后别处新扔的不会被删。 */
    suspend fun emptyTrash(before: String)

    /**
     * 网页"仅编辑器"页面的地址（`/note-embed?page=…&lang=…&model=…&reasoning=…`）。
     * [model] / [reasoning] 是 App 里选的模型和推理强度，编辑器里的 AI 助手用它们（网页按服务端的模型列表核对）。
     */
    fun noteEmbedUrl(pageId: String, lang: String?, model: String? = null, reasoning: String? = null): String
}

/** 回收站里保留的天数，与 src/types/notes.ts 的 TRASH_RETENTION_DAYS 相同。 */
const val TRASH_RETENTION_DAYS = 30

/**
 * 网页编辑器（/note-embed）经 `window.NoteFableNative.postMessage(json)` 发来的消息。
 * 约定见 src/lib/native-bridge.ts 和 docs/architecture/android-native.md；两边要一起改。
 */
sealed interface EmbedMessage {
    data class Ready(val id: String, val title: String, val icon: String?) : EmbedMessage
    data class Meta(val title: String, val icon: String?) : EmbedMessage
    data class SaveState(val state: String) : EmbedMessage
    data object Missing : EmbedMessage
    data object Trashed : EmbedMessage
    /** [kept]：没保存成功，但草稿已存在 WebView 里、之后会重试（不是冲突）。这时可以先离开。 */
    data class Flushed(val requestId: String, val ok: Boolean, val kept: Boolean = false) : EmbedMessage

    companion object {
        /** 不认识或格式不对的消息返回 null（网页先加了新消息类型也不会让 App 出错）。 */
        fun parse(json: String): EmbedMessage? = runCatching {
            val obj = NoteFableJson.parseToJsonElement(json).jsonObject
            fun JsonObject.str(key: String) = this[key]?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.jsonPrimitive?.contentOrNull
            when (obj.str("type")) {
                "ready" -> {
                    val page = obj["page"]?.jsonObject ?: return@runCatching null
                    Ready(page.str("id") ?: return@runCatching null, page.str("title").orEmpty(), page.str("icon"))
                }
                "meta" -> Meta(obj.str("title").orEmpty(), obj.str("icon"))
                "saveState" -> SaveState(obj.str("state") ?: return@runCatching null)
                "missing" -> Missing
                "trashed" -> Trashed
                "flushed" -> Flushed(
                    obj.str("requestId").orEmpty(),
                    obj["ok"]?.jsonPrimitive?.booleanOrNull == true,
                    obj["kept"]?.jsonPrimitive?.booleanOrNull == true,
                )
                else -> null
            }
        }.getOrNull()
    }
}

/** 只需要知道成功与否的接口（`{ ok: true }` 之类），内容不用。 */
@Serializable
internal class JsonObjectResponse
