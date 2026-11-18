package com.kakumine.notefable.data

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/*
 * 表情选择器的数据（assets/emoji.json，由 scripts/gen-native-emoji.ts 从网页用的 emoji-picker-react 生成）。
 * 规则照着网页的选择器：
 * - 分类和顺序与网页 full-emoji-picker.tsx 的 EMOJI_CATEGORIES 相同，第一类 suggested 是"最近使用"；
 * - 搜索：去掉首尾空白、转小写，表情的任一关键词包含它就算命中（emoji-picker-react 的 normalizeQuery + includes）；
 *   关键词用当前界面语言那一份（网页按 locale 换 emojiData）；
 * - 最近使用：选中的表情（含肤色）放到最前，最多 14 个（emoji-picker-react 的 setSuggested，SuggestionMode.RECENT）；
 * - 本机字体画不出来的表情不显示（网页同样隐藏浏览器不支持的表情）。
 */

@Serializable
data class EmojiShape(
    val d: String,
    val fill: Boolean,
    val stroke: Boolean,
    val strokeWidth: Float = 1f,
    val round: Boolean = false,
    val evenOdd: Boolean = false,
)

@Serializable
data class EmojiIcon(val viewBox: List<Float>, val shapes: List<EmojiShape>)

@Serializable
internal data class RawEmoji(val u: String, val c: Int, val v: List<String> = emptyList(), val n: Map<String, List<String>>)

@Serializable
internal data class RawEmojiData(val categories: List<String>, val icons: Map<String, EmojiIcon>, val emojis: List<RawEmoji>)

/** 一个表情。[unified] 是码点（小写十六进制，用 - 连接），[variations] 是带肤色的版本。 */
data class EmojiItem(
    val unified: String,
    val category: String,
    val variations: List<String>,
    /** 当前界面语言的关键词，已转小写。最后一个是名称（网页拿它当 aria-label）。 */
    val names: List<String>,
) {
    val emoji: String get() = unifiedToEmoji(unified)
    val label: String get() = names.lastOrNull().orEmpty()

    /** 选了肤色时显示带该肤色的版本（emoji-picker-react 的 emojiVariationUnified）；没有就用原样。 */
    fun unifiedFor(tone: SkinTone): String =
        tone.code?.let { code -> variations.firstOrNull { it.contains(code) } } ?: unified
}

/** 肤色（网页选择器搜索框右边的色块）。[code] 是变体里的肤色码点；默认色是 null。 */
enum class SkinTone(val code: String?, val color: Long) {
    Neutral(null, 0xFFFFD225),
    Light("1f3fb", 0xFFFFDFBD),
    MediumLight("1f3fc", 0xFFE9C197),
    Medium("1f3fd", 0xFFC88E62),
    MediumDark("1f3fe", 0xFFA86637),
    Dark("1f3ff", 0xFF60463A),
}

fun unifiedToEmoji(unified: String): String = buildString {
    unified.split('-').forEach { part -> part.toIntOrNull(16)?.let { appendCodePoint(it) } }
}

class EmojiCatalog(
    val categories: List<String>,
    val icons: Map<String, EmojiIcon>,
    val emojis: List<EmojiItem>,
) {
    private val byUnified: Map<String, EmojiItem> = buildMap {
        emojis.forEach { item ->
            put(item.unified, item)
            item.variations.forEach { putIfAbsent(it, item) }
        }
    }

    /** 码点（含带肤色的）对应的表情。 */
    fun find(unified: String): EmojiItem? = byUnified[unified.lowercase()]

    fun inCategory(category: String): List<EmojiItem> = emojis.filter { it.category == category }

    /** 搜索（emoji-picker-react：trim + toLowerCase，任一关键词包含就命中）。空查询返回 null（不在搜索）。 */
    fun matcher(query: String): ((EmojiItem) -> Boolean)? {
        val normalized = query.trim().lowercase()
        if (normalized.isEmpty()) return null
        return { item -> item.names.any { it.contains(normalized) } }
    }

    companion object {
        private val EmojiLocales = setOf("en", "zh", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt-BR", "it", "vi", "th", "hi", "ru")

        /** 网页 EMOJI_DATA 的键（来自 res 里的 ui_locale）。emoji-picker-react 没有数据文件的语言（id / ar / tr）用英文关键词。 */
        fun parse(json: String, locale: String, supported: (String) -> Boolean = { true }): EmojiCatalog {
            val raw = Json { ignoreUnknownKeys = true }.decodeFromString(RawEmojiData.serializer(), json)
            val key = locale.takeIf { it in EmojiLocales } ?: "en"
            val emojis = raw.emojis.mapNotNull { emoji ->
                val char = unifiedToEmoji(emoji.u)
                if (!supported(char)) return@mapNotNull null
                EmojiItem(
                    unified = emoji.u.lowercase(),
                    category = raw.categories.getOrElse(emoji.c) { "" },
                    variations = emoji.v.map { it.lowercase() }.filter { supported(unifiedToEmoji(it)) },
                    names = (emoji.n[key] ?: emoji.n["en"].orEmpty()).map { it.lowercase() },
                )
            }
            return EmojiCatalog(raw.categories, raw.icons, emojis)
        }

        @Volatile private var cached: Pair<String, EmojiCatalog>? = null

        /** 读安装包里的 emoji.json（每种语言只解析一次）。在后台线程调用。 */
        fun load(context: Context, locale: String): EmojiCatalog {
            cached?.takeIf { it.first == locale }?.let { return it.second }
            val json = context.assets.open("emoji.json").use { it.readBytes().decodeToString() }
            val paint = android.graphics.Paint()
            val catalog = parse(json, locale) { paint.hasGlyph(it) }
            cached = locale to catalog
            return catalog
        }
    }
}

/** 最近使用的表情（码点，含肤色），新的在前。网页存在 localStorage 的 epr_suggested，原生存在本机。 */
interface RecentEmojiStore {
    fun load(): List<String>
    fun save(list: List<String>)
}

class PrefsRecentEmojiStore(context: Context) : RecentEmojiStore {
    private val prefs = context.getSharedPreferences("emoji", Context.MODE_PRIVATE)
    override fun load(): List<String> = prefs.getString("recent", null)?.split(',')?.filter { it.isNotBlank() }.orEmpty()
    override fun save(list: List<String>) = prefs.edit().putString("recent", list.joinToString(",")).apply()
}

/** 选中一个表情后的最近使用列表：放到最前、去重、最多 14 个（emoji-picker-react setSuggested）。 */
fun pushRecentEmoji(recent: List<String>, unified: String): List<String> =
    (listOf(unified) + recent.filterNot { it == unified }).take(RECENT_EMOJI_LIMIT)

const val RECENT_EMOJI_LIMIT = 14
