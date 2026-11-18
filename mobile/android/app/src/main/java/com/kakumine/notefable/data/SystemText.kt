package com.kakumine.notefable.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/**
 * 服务端发来的英文系统文（API 错误、工具完成标签、429 上限说明、"Request failed: …"）的中 / 日译文。
 *
 * 网页用 `t()` / `localizeSystemText`（`src/lib/i18n/translate.ts`）翻译这些句子；原生端没有网页字典，
 * 用安装包里的 `assets/system-text.json`（`scripts/gen-native-system-text.ts` 从网页字典生成）。规则与网页逐条对应：
 * 只翻译整句命中的系统文和 [templates] 里的句型，句型里的值（标题、文件名、搜索词）原样保留，`{detail}` 再递归翻译一次。
 */
class SystemText(
    templates: List<String>,
    private val messages: Map<String, Map<String, String>>,
) {
    private val patterns = templates.mapNotNull(::patternOf)

    /** 按界面语言（`zh`、`zh-Hant`、`ja`；其他语言返回英文原句）取翻译器。 */
    fun translator(language: String?): SystemTextTranslator =
        SystemTextTranslator(messages[normalizeLanguage(language)].orEmpty(), patterns)

    @Serializable
    private data class Asset(val templates: List<String> = emptyList(), val messages: Map<String, Map<String, String>> = emptyMap())

    companion object {
        /** 没有词典（读不到资源）时：一律显示英文原句，和网页英文界面一样。 */
        val Empty = SystemText(emptyList(), emptyMap())

        fun parse(json: String): SystemText {
            val asset = NoteFableJson.decodeFromString<Asset>(json)
            return SystemText(asset.templates, asset.messages)
        }

        /** `ui_locale` 或语言标签 → 词典的键。zh 和网页 localeFromTag 一样：有 Hant 或台港澳地区是繁体，其余简体。 */
        internal fun normalizeLanguage(language: String?): String? {
            val parts = language?.trim()?.lowercase()?.split('-', '_') ?: return null
            return when (parts.first()) {
                "zh", "chi", "zho", "cmn" -> when {
                    "hant" in parts -> "zh-Hant"
                    "hans" in parts -> "zh"
                    parts.any { it in setOf("tw", "hk", "mo") } -> "zh-Hant"
                    else -> "zh"
                }
                "ja", "jpn" -> "ja"
                "ko", "kor" -> "ko"
                "es", "spa" -> "es"
                "fr", "fra", "fre" -> "fr"
                "de", "deu", "ger" -> "de"
                "pt", "por" -> "pt-BR"
                "it", "ita" -> "it"
                "id", "in", "ind" -> "id"
                "vi", "vie" -> "vi"
                "th", "tha" -> "th"
                "hi", "hin" -> "hi"
                "ar", "ara" -> "ar"
                "tr", "tur" -> "tr"
                "ru", "rus" -> "ru"
                else -> null
            }
        }

        private fun patternOf(template: String): Pattern? {
            val match = Regex("""\{(\w+)\}""").find(template) ?: return null
            val prefix = template.substring(0, match.range.first)
            val suffix = template.substring(match.range.last + 1)
            // 用 matchEntire 对整句匹配（Java 的 `$` 会放过末尾换行，与网页的正则不同）。
            val regex = Regex(Regex.escape(prefix) + "([\\s\\S]*)" + (if (suffix.isEmpty()) "" else Regex.escape(suffix)))
            return Pattern(template, match.groupValues[1], regex)
        }
    }

    internal class Pattern(val key: String, val name: String, val regex: Regex)
}

class SystemTextTranslator internal constructor(
    private val messages: Map<String, String>,
    private val patterns: List<SystemText.Pattern>,
) {
    /** 网页的 `t(text, vars)`：按英文原句查译文，没有就用原句，再把 `{name}` 换成值（值里的花括号不再展开）。 */
    fun t(text: String, vars: Map<String, String> = emptyMap()): String {
        val template = messages[text] ?: text
        return if (vars.isEmpty()) template else fill(template, vars)
    }

    /** 网页的 `localizeSystemText`：只用于明确的系统错误和工具标签，不要传正文、标题或文件名。 */
    fun localize(text: String): String {
        for (pattern in patterns) {
            val match = pattern.regex.matchEntire(text) ?: continue
            val captured = match.groupValues[1]
            val value = if (pattern.name == "detail") localize(captured) else captured
            return t(pattern.key, mapOf(pattern.name to value))
        }
        return t(text)
    }

    /**
     * 网页的 `localizeFailureText`：回答末尾由服务端追加的"Request failed: …"换成译文。
     * 只在 [failure] 指向的位置正好是那句话时替换，不从正文的措辞猜测。
     */
    fun localizeFailure(content: String, failure: FailureInfo?): String {
        if (failure == null || failure.offset < 0 || failure.offset > content.length) return content
        if (content.substring(failure.offset) != fill(REQUEST_FAILED, mapOf("detail" to failure.detail))) return content
        return content.substring(0, failure.offset) + t(REQUEST_FAILED, mapOf("detail" to localize(failure.detail)))
    }

    companion object {
        const val REQUEST_FAILED = "Request failed: {detail}"
    }
}

/** 服务端追加的失败文的位置与原因（`src/lib/failure-text.ts` 的 FailureInfo，存在 activity 里）。 */
data class FailureInfo(val offset: Int, val detail: String) {
    companion object {
        /** 从一个 activity 事件 / 步骤（`{type|kind: "failure", offset, detail}`）读出失败信息。 */
        fun from(element: JsonElement?): FailureInfo? {
            val obj = element as? JsonObject ?: return null
            val kind = (obj["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: (obj["kind"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (kind != "failure") return null
            val offset = (obj["offset"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: return null
            val detail = (obj["detail"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            return if (offset >= 0) FailureInfo(offset, detail) else null
        }

        /** 保存的回答：activity 是步骤数组，取其中的失败步骤。 */
        fun fromActivity(activity: JsonElement?): FailureInfo? =
            (activity as? JsonArray)?.firstNotNullOfOrNull(::from)
    }
}

private val Slot = Regex("""\{(\w+)\}""")

private fun fill(template: String, vars: Map<String, String>): String =
    Slot.replace(template) { match -> vars[match.groupValues[1]] ?: match.value }
