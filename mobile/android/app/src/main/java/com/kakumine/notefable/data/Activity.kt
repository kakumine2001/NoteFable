package com.kakumine.notefable.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

// 回答前的过程（推理摘要、联网搜索、笔记工具、项目上下文）与 AI 的笔记提案。
// 移植自网页 src/lib/chat-activity.ts：applyActivityEvent 的合并规则、parseStoredActivity 的校验、splitThought、hostOf，
// 单元测试（ActivityTest）与 src/lib/chat-activity.test.ts 逐条对应。两边一起改。

/** 联网搜索的一步做了什么。 */
sealed interface WebAction {
    data class Search(val queries: List<String>, val sources: List<String>) : WebAction
    data class OpenPage(val url: String) : WebAction
    data class FindInPage(val url: String, val pattern: String) : WebAction
}

/** 回答用到的项目参考笔记（只有出处，没有正文）。 */
data class ContextNote(val id: String, val title: String, val truncated: Boolean = false)

data class ContextInfo(val projectName: String, val hasInstructions: Boolean, val notes: List<ContextNote>)

/** 改动的对象（网页 src/lib/page-ai/types.ts 的 ProposalTarget）：笔记用块编号 [ProposalChange.block]，没有这个。 */
sealed interface ProposalTarget {
    /** 幻灯片的第几张（从 1 起）。 */
    data class Slide(val number: Int) : ProposalTarget

    /** 白板的元素：只有一个时 [name] 是它的文字，多个时看 [count]。 */
    data class Elements(val count: Int, val name: String? = null) : ProposalTarget
}

/** 提案里的一处改动（网页 src/lib/page-ai/types.ts 的 ProposalChange，由服务端按页面类型的适配器生成）。 */
data class ProposalChange(
    /** [PROPOSAL_OPS] 之一；读到不认识的操作时按 `update`。 */
    val op: String,
    /** 笔记：read_note 里看到的块编号，0 表示插在开头。其它类型总是 0。 */
    val block: Int,
    val before: String? = null,
    val after: String? = null,
    val dropsFormatting: Boolean = false,
    val dropsMedia: Boolean = false,
    /** 幻灯片的第几张 / 白板的哪些元素；笔记没有。 */
    val target: ProposalTarget? = null,
    /** 改前 / 改后的缩略图（白板、幻灯片）：同源的相对地址 `/api/proposals/:id/image?…`，要带 App 的 Cookie 读。 */
    val beforeImage: String? = null,
    val afterImage: String? = null,
)

/** 改动的操作（网页 PROPOSAL_OPS）。笔记用前三个，白板、幻灯片还会用后四个。 */
val PROPOSAL_OPS = listOf("replace", "insert_after", "delete", "add", "update", "move", "reorder")

/**
 * AI 的页面提案：编辑已有页面或新建页面（笔记、白板、幻灯片共用一种卡片，网页 page-proposal.tsx）。
 * [status]（pending / applied / discarded / undone）只有服务端保存过的提案才有；[pageKind] 旧服务端不返回，按笔记。
 * [autoApplied]：AI 面板的"自动应用"没经确认就应用了；[undoable]：已应用、服务端记着应用的版本，可以撤销。
 */
sealed interface Proposal {
    val id: String
    val status: String?
    val appliedPageId: String?
    val pageKind: PageKind
    val autoApplied: Boolean
    val undoable: Boolean

    data class Edit(
        override val id: String,
        val pageId: String,
        val pageTitle: String,
        val baseVersion: Long,
        val titleBefore: String? = null,
        val titleAfter: String? = null,
        val changes: List<ProposalChange> = emptyList(),
        override val status: String? = null,
        override val appliedPageId: String? = null,
        override val pageKind: PageKind = PageKind.Note,
        override val autoApplied: Boolean = false,
        override val undoable: Boolean = false,
    ) : Proposal

    data class Create(
        override val id: String,
        val title: String,
        val icon: String? = null,
        /** 要显示的正文（笔记是 Markdown，其它类型是读得懂的文字）。 */
        val content: String,
        override val status: String? = null,
        override val appliedPageId: String? = null,
        override val pageKind: PageKind = PageKind.Note,
        override val autoApplied: Boolean = false,
        override val undoable: Boolean = false,
        /** 作为子页面建在哪一页里；[parentTitle] 是那一页的标题（空字符串显示"Untitled"），没有就不显示"位于…中"。 */
        val parentId: String? = null,
        val parentTitle: String? = null,
        /** 正文以外要看的改动（白板、幻灯片的缩略图等）。 */
        val changes: List<ProposalChange> = emptyList(),
    ) : Proposal
}

/** 进度面板里的一步（网页的 ActivityStep）。提案和失败位置不进步骤列表，回答下方另外显示。 */
sealed interface ActivityStep {
    val id: String

    data class Thought(override val id: String, val text: String) : ActivityStep
    data class Context(override val id: String, val info: ContextInfo) : ActivityStep
    data class Web(override val id: String, val done: Boolean, val action: WebAction? = null) : ActivityStep
    data class Tool(override val id: String, val done: Boolean, val name: String, val label: String? = null) : ActivityStep
    data class Failure(override val id: String, val info: FailureInfo) : ActivityStep
    data class ProposalStep(val proposal: Proposal) : ActivityStep {
        override val id: String get() = proposal.id
    }
}

/** `/api/chat` 流里 `{activity: …}` 的事件（网页的 ActivityEvent，服务端已整理成统一形状）。 */
sealed interface ActivityEvent {
    val id: String

    data class Thought(override val id: String, val delta: String) : ActivityEvent
    data class Context(override val id: String, val info: ContextInfo) : ActivityEvent
    data class Web(override val id: String, val done: Boolean, val action: WebAction? = null) : ActivityEvent
    data class Tool(override val id: String, val done: Boolean, val name: String, val label: String? = null) : ActivityEvent
    data class Failure(override val id: String, val info: FailureInfo) : ActivityEvent
    data class ProposalEvent(val proposal: Proposal) : ActivityEvent {
        override val id: String get() = proposal.id
    }
}

object Activity {
    private const val MAX_TEXT = 300
    private const val MAX_CONTEXT_NOTES = 10
    private const val MAX_CONTEXT_ID = 100

    /** 一次回答只有一个项目上下文步骤，重发时替换同一步。 */
    const val CONTEXT_STEP_ID = "project-context"

    /** 按 id 把一个事件合并进已有步骤（网页的 applyActivityEvent）。 */
    fun apply(steps: List<ActivityStep>, event: ActivityEvent): List<ActivityStep> {
        val index = steps.indexOfFirst { it.id == event.id }
        fun put(step: ActivityStep) = if (index == -1) steps + step else steps.mapIndexed { i, existing -> if (i == index) step else existing }
        return when (event) {
            is ActivityEvent.Thought -> {
                if (index == -1) return steps + ActivityStep.Thought(event.id, event.delta)
                val current = steps[index] as? ActivityStep.Thought ?: return steps
                put(current.copy(text = current.text + event.delta))
            }
            is ActivityEvent.Context -> put(ActivityStep.Context(event.id, event.info))
            is ActivityEvent.ProposalEvent -> put(ActivityStep.ProposalStep(event.proposal))
            is ActivityEvent.Failure -> put(ActivityStep.Failure(event.id, event.info))
            is ActivityEvent.Tool -> put(ActivityStep.Tool(event.id, event.done, event.name, event.label))
            is ActivityEvent.Web -> put(ActivityStep.Web(event.id, event.done, event.action))
        }
    }

    fun apply(steps: List<ActivityStep>, events: List<ActivityEvent>): List<ActivityStep> = events.fold(steps, ::apply)

    /** 读一个流事件。形状不对的返回 null（宁可忽略也不让回答中断）。 */
    fun parseEvent(json: JsonObject): ActivityEvent? {
        val id = json.string("id")
        return when (json.string("type")) {
            "thought" -> {
                val delta = json.string("delta")
                if (id == null || delta.isNullOrEmpty()) null else ActivityEvent.Thought(id, delta)
            }
            "context" -> id?.let { parseContextInfo(json)?.let { info -> ActivityEvent.Context(id, info) } }
            "web" -> id?.let { ActivityEvent.Web(id, json.string("status") == "done", parseWebAction(json["action"])) }
            "tool" -> {
                val name = json.string("name")
                if (id == null || name == null) null
                else ActivityEvent.Tool(id, json.string("status") == "done", text(json["name"]), text(json["label"]).ifEmpty { null })
            }
            "failure" -> id?.let { FailureInfo.from(json)?.let { info -> ActivityEvent.Failure(id, info) } }
            "proposal" -> parseEditProposal(json)?.let(ActivityEvent::ProposalEvent)
            "create_proposal" -> parseCreateProposal(json)?.let(ActivityEvent::ProposalEvent)
            else -> null
        }
    }

    /** 历史里保存的过程（网页的 parseStoredActivity）。服务端已解析成数组；这里再校验一遍，坏的丢掉。 */
    fun parseStored(element: JsonElement?): List<ActivityStep> {
        val array = element as? JsonArray ?: return emptyList()
        val steps = mutableListOf<ActivityStep>()
        for (item in array) {
            val step = item as? JsonObject ?: continue
            val id = step.string("id") ?: continue
            when (step.string("kind")) {
                "thought" -> step.string("text")?.let { steps += ActivityStep.Thought(id, it) }
                // 保存的回答里不留"正在搜索"：还原不出 action 的搜索丢掉。
                "web" -> parseStoredWebAction(step["action"])?.let { steps += ActivityStep.Web(id, true, it) }
                "context" -> parseContextInfo(step)?.let { steps += ActivityStep.Context(id, it) }
                "tool" -> step.string("name")?.let { name -> steps += ActivityStep.Tool(id, true, name, text(step["label"]).ifEmpty { null }) }
                "failure" -> FailureInfo.from(step)?.let { steps += ActivityStep.Failure(id, it) }
            }
        }
        return steps
    }

    /** 同上，读 JSON 字符串（与网页 parseStoredActivity 的入参一致，便于对照测试）。 */
    fun parseStored(raw: String?): List<ActivityStep> {
        if (raw.isNullOrEmpty()) return emptyList()
        return parseStored(runCatching { NoteFableJson.parseToJsonElement(raw) }.getOrNull())
    }

    /** 历史里保存的提案（`proposals` 字段，`kind` 是 `proposal` / `create_proposal`）。 */
    fun parseStoredProposals(element: JsonElement?): List<Proposal> =
        (element as? JsonArray).orEmpty().mapNotNull { item ->
            val json = item as? JsonObject ?: return@mapNotNull null
            when (json.string("kind")) {
                "proposal" -> parseEditProposal(json)
                "create_proposal" -> parseCreateProposal(json)
                else -> null
            }
        }

    /** OpenAI 的推理摘要是"**标题**\n\n正文"，拆成标题和正文（网页的 splitThought）。 */
    fun splitThought(text: String): Pair<String, String> {
        val match = Regex("""^\s*\*\*(.+?)\*\*\s*""").find(text) ?: return "" to text.trim()
        return match.groupValues[1].trim() to text.substring(match.range.last + 1).trim()
    }

    /** 地址的主机名，去掉开头的 www.（网页的 hostOf）。 */
    fun hostOf(url: String): String = url.toHttpUrlOrNull()?.host?.removePrefix("www.") ?: url

    // ---- 内部 ----

    private fun text(value: JsonElement?): String =
        (value as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.take(MAX_TEXT).orEmpty()

    // 界面要把它做成链接，只收 http(s)。
    private fun safeUrl(value: JsonElement?): String {
        val raw = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return ""
        val url = raw.toHttpUrlOrNull() ?: return ""
        return url.toString()
    }

    private fun parseContextInfo(data: JsonObject): ContextInfo? {
        val projectName = text(data["projectName"])
        if (projectName.isEmpty()) return null
        val notes = mutableListOf<ContextNote>()
        for (item in (data["notes"] as? JsonArray).orEmpty()) {
            val note = item as? JsonObject ?: continue
            val id = note.string("id")?.trim().orEmpty()
            val title = note["title"] as? JsonPrimitive
            if (id.isEmpty() || id.length > MAX_CONTEXT_ID || title == null || !title.isString || notes.any { it.id == id }) continue
            notes += ContextNote(id, text(title).ifEmpty { "Untitled" }, note.bool("truncated") == true)
            if (notes.size >= MAX_CONTEXT_NOTES) break
        }
        val hasInstructions = data.bool("hasInstructions") == true
        return if (hasInstructions || notes.isNotEmpty()) ContextInfo(projectName, hasInstructions, notes) else null
    }

    // 流里的 action 是服务端整理过的形状，与保存的一样。
    private fun parseWebAction(value: JsonElement?): WebAction? = parseStoredWebAction(value)

    private fun parseStoredWebAction(value: JsonElement?): WebAction? {
        val action = value as? JsonObject ?: return null
        return when (action.string("kind")) {
            "search" -> WebAction.Search(
                queries = (action["queries"] as? JsonArray).orEmpty()
                    .mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content },
                sources = (action["sources"] as? JsonArray).orEmpty().map(::safeUrl).filter { it.isNotEmpty() },
            )
            "open_page" -> safeUrl(action["url"]).takeIf { it.isNotEmpty() }?.let(WebAction::OpenPage)
            "find_in_page" -> safeUrl(action["url"]).takeIf { it.isNotEmpty() }?.let { WebAction.FindInPage(it, text(action["pattern"])) }
            else -> null
        }
    }

    // proposed.blocks 现在总是空数组（应用只用服务端保存的内容），但旧版 App 也靠它校验，仍然要求是数组。
    private fun proposed(json: JsonObject): JsonObject? {
        val proposed = json["proposed"] as? JsonObject ?: return null
        return proposed.takeIf { it.string("title") != null && it["blocks"] is JsonArray }
    }

    // 与网页 parseActivityEvent 的校验一致：承认卡片需要的字段都在才收。
    internal fun parseEditProposal(json: JsonObject): Proposal.Edit? {
        val id = json.string("id") ?: return null
        val pageId = json.string("pageId") ?: return null
        val pageTitle = json.string("pageTitle") ?: return null
        val baseVersion = (json["baseVersion"] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull ?: return null
        val changes = json["changes"] as? JsonArray ?: return null
        proposed(json) ?: return null
        val title = json["title"] as? JsonObject
        return Proposal.Edit(
            id = id,
            pageId = pageId,
            pageTitle = pageTitle,
            baseVersion = baseVersion,
            titleBefore = title?.string("before"),
            titleAfter = title?.string("after"),
            changes = parseChanges(changes),
            status = json.string("status"),
            appliedPageId = json.string("appliedPageId"),
            pageKind = PageKind.of(json.string("pageKind")),
            autoApplied = json.bool("autoApplied") == true,
            undoable = json.bool("undoable") == true,
        )
    }

    internal fun parseCreateProposal(json: JsonObject): Proposal.Create? {
        val id = json.string("id") ?: return null
        val title = json.string("title") ?: return null
        val content = json.string("content") ?: return null
        proposed(json) ?: return null
        return Proposal.Create(
            id = id,
            title = title,
            icon = json.string("icon"),
            content = content,
            status = json.string("status"),
            appliedPageId = json.string("appliedPageId"),
            pageKind = PageKind.of(json.string("pageKind")),
            autoApplied = json.bool("autoApplied") == true,
            undoable = json.bool("undoable") == true,
            parentId = json.string("parentId"),
            parentTitle = json.string("parentTitle"),
            changes = parseChanges(json["changes"] as? JsonArray),
        )
    }

    // 和网页卡片一样不因为一处改动的形状不对就丢掉整个提案：不是对象的跳过，操作不认识（或没有）的按 update 显示。
    private fun parseChanges(array: JsonArray?): List<ProposalChange> = array.orEmpty().mapNotNull { item ->
        val change = item as? JsonObject ?: return@mapNotNull null
        ProposalChange(
            op = change.string("op")?.takeIf { it in PROPOSAL_OPS } ?: "update",
            block = (change["block"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: 0,
            before = change.string("before"),
            after = change.string("after"),
            dropsFormatting = change.bool("dropsFormatting") == true,
            dropsMedia = change.bool("dropsMedia") == true,
            target = parseTarget(change["target"]),
            beforeImage = imagePath(change["beforeImage"]),
            afterImage = imagePath(change["afterImage"]),
        )
    }

    private fun parseTarget(value: JsonElement?): ProposalTarget? {
        val target = value as? JsonObject ?: return null
        fun number(key: String) = (target[key] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
        return when (target.string("type")) {
            "slide" -> number("number")?.let(ProposalTarget::Slide)
            "elements" -> number("count")?.let { ProposalTarget.Elements(it, target.string("name")) }
            else -> null
        }
    }

    // 缩略图要带登录 Cookie 读：只收服务端给的同源提案图片地址，不读别的地方。
    private fun imagePath(value: JsonElement?): String? =
        (value as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.startsWith(PROPOSAL_IMAGE_PREFIX) }

    private const val PROPOSAL_IMAGE_PREFIX = "/api/proposals/"

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString && it !is JsonNull }?.content

    private fun JsonObject.bool(key: String): Boolean? =
        (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
}

/** 完成后标题行的统计（网页 chat-activity.tsx 的 summarize）。界面再把数字套进各自的文案。 */
data class ActivitySummary(
    val searches: Int,
    val sources: Int,
    val noteLookups: Int,
    val projectNotes: Int,
    val projectInstructions: Boolean,
) {
    companion object {
        fun of(steps: List<ActivityStep>): ActivitySummary {
            var searches = 0
            var notes = 0
            var projectNotes = 0
            var projectInstructions = false
            val pages = linkedSetOf<String>()
            for (step in steps) {
                when (step) {
                    is ActivityStep.Tool -> notes++
                    is ActivityStep.Context -> {
                        projectNotes = step.info.notes.size
                        projectInstructions = step.info.hasInstructions
                    }
                    is ActivityStep.Web -> when (val action = step.action) {
                        is WebAction.Search -> {
                            searches += maxOf(1, action.queries.size)
                            pages += action.sources
                        }
                        is WebAction.OpenPage -> pages += action.url
                        is WebAction.FindInPage -> pages += action.url
                        null -> Unit
                    }
                    else -> Unit
                }
            }
            return ActivitySummary(searches, pages.size, notes, projectNotes, projectInstructions)
        }
    }
}

/** 进度列表里显示的步骤：去掉提案和失败位置（网页的 ProgressStep）。 */
fun List<ActivityStep>.progressSteps(): List<ActivityStep> =
    filter { it !is ActivityStep.ProposalStep && it !is ActivityStep.Failure }

/** 回答下方的提案卡片：保存过的优先，流里还没出现在保存列表里的补在后面（网页 chat-message.tsx）。 */
fun mergeProposals(stored: List<Proposal>, steps: List<ActivityStep>): List<Proposal> =
    stored + steps.filterIsInstance<ActivityStep.ProposalStep>().map { it.proposal }.filter { live -> stored.none { it.id == live.id } }
