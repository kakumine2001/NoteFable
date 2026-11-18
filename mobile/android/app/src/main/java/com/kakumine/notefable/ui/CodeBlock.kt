package com.kakumine.notefable.ui

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 回答里的代码块（网页 assistant-markdown.tsx 的 MarkdownCodeBlock + globals.css 的 .markdown-code-* / .hljs-*）：
//  - 外框：1px #e5e7eb、圆角 5.6、#F7F7F5 底，上下外边距 16（与段落的 11.2 折叠后取 16）；
//  - 头部：最低 48、下边线 #e5e7eb、白 .72 底、左 16 右 12.8；语言名 14.72 / 600 / #0f172a，前面 Code2 15（描边 2.2），间距 8；
//    复制键 32x32、圆角 8.8、#111827，Copy 20 / 复制后 Check 18 停 1.2 秒；
//  - 代码：内边距 15.2 / 24 / 21.6，等宽 15.2、行高 1.65、#111827，不折行，横向滚动；
//  - 高亮颜色与网页 highlight.js 主题一致（下面的 [CodeHighlighter]）。

private val CodeBorder = Color(0xFFE5E7EB)
private val CodeInk = Color(0xFF111827)
private val CodeText = TextStyle(
    fontFamily = FontFamily.Monospace,
    fontSize = 15.2.sp,
    lineHeight = 25.08.sp,
    color = CodeInk,
    letterSpacing = 0.sp,
)

// 网页 languageLabels；plaintext 用本地化的 "Code"。
private val LanguageLabels = mapOf(
    "bash" to "Bash", "c" to "C", "cpp" to "C++", "csharp" to "C#", "css" to "CSS", "java" to "Java",
    "javascript" to "JavaScript", "json" to "JSON", "markdown" to "Markdown", "php" to "PHP", "python" to "Python",
    "ruby" to "Ruby", "rust" to "Rust", "sql" to "SQL", "typescript" to "TypeScript", "xml" to "HTML", "yaml" to "YAML",
)

/** 代码块外框里上下多留的 4.8：Markdown 库已在每块上下各加 5.6，相邻段落之间合计才是网页的 16。 */
private val ShellExtraMargin = 4.8.dp

@Composable
internal fun CodeBlock(code: String, language: String?) {
    val text = code.removeSuffix("\n")
    val result = remember(text, language) { CodeHighlighter.highlight(text, language) }
    val label = if (result.language == CodeHighlighter.PLAIN) stringResource(R.string.code_label_plain)
    else LanguageLabels[result.language] ?: result.language
    val annotated = remember(result) { result.annotated(text) }

    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        Column(
            Modifier.padding(vertical = ShellExtraMargin).fillMaxWidth()
                .clip(RoundedCornerShape(5.6.dp))
                .background(Sm.Sidebar)
                .border(1.dp, CodeBorder, RoundedCornerShape(5.6.dp)),
        ) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .background(Color.White.copy(alpha = 0.72f))
                    .drawBehind {
                        val y = size.height - 0.5.dp.toPx()
                        drawLine(CodeBorder, Offset(0f, y), Offset(size.width, y), 1.dp.toPx())
                    }
                    .padding(start = 16.dp, end = 12.8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LucideIcon(Lucide.Code2, 15.dp, Color(0xFF0F172A), strokeWidth = 2.2f)
                    Text(
                        label,
                        style = TextStyle(fontSize = 14.72.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF0F172A), letterSpacing = 0.sp),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                CopyCodeButton(text)
            }
            Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                Text(
                    annotated,
                    style = CodeText,
                    softWrap = false,
                    modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 15.2.dp, bottom = 21.6.dp),
                )
            }
        }
    }
}

@Composable
private fun CopyCodeButton(code: String) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    // 每次复制成功加一，1.2 秒后归零；连续点击时重新计时（网页 setTimeout 1200）。
    var copiedTick by remember { mutableIntStateOf(0) }
    LaunchedEffect(copiedTick) {
        if (copiedTick > 0) {
            delay(1200)
            copiedTick = 0
        }
    }
    val copied = copiedTick > 0
    val description = stringResource(if (copied) R.string.code_copied_code else R.string.code_copy_code)
    Box(
        Modifier.size(32.dp).clip(RoundedCornerShape(8.8.dp))
            .clickable {
                if (code.isEmpty()) return@clickable
                scope.launch {
                    val ok = runCatching { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("code", code))) }.isSuccess
                    if (ok) copiedTick++
                }
            }
            .semantics { contentDescription = description; role = Role.Button },
        Alignment.Center,
    ) {
        if (copied) LucideIcon(Lucide.Check, 18.dp, CodeInk) else LucideIcon(Lucide.Copy, 20.dp, CodeInk)
    }
}

/** highlight.js 的高亮类别里网页主题上了颜色的那些。 */
enum class CodeTokenKind { Keyword, BuiltIn, Title, String, Number, Variable, Comment, Meta, Tag }

data class CodeToken(val start: Int, val end: Int, val kind: CodeTokenKind)

data class HighlightResult(val language: String, val tokens: List<CodeToken>) {
    fun annotated(code: String): AnnotatedString = buildAnnotatedString {
        append(code)
        tokens.forEach { addStyle(styleOf(it.kind), it.start, it.end) }
    }
}

// globals.css 的 .hljs-* 颜色。
private fun styleOf(kind: CodeTokenKind): SpanStyle = when (kind) {
    CodeTokenKind.Keyword, CodeTokenKind.BuiltIn -> SpanStyle(color = Color(0xFF7C3AED))
    CodeTokenKind.Title -> SpanStyle(color = Color(0xFF0369A1), fontWeight = FontWeight(650))
    CodeTokenKind.String -> SpanStyle(color = Color(0xFF047857))
    CodeTokenKind.Number -> SpanStyle(color = Color(0xFFB45309))
    CodeTokenKind.Variable -> SpanStyle(color = Color(0xFFBE123C))
    CodeTokenKind.Comment -> SpanStyle(color = Color(0xFF64748B), fontStyle = FontStyle.Italic)
    CodeTokenKind.Meta -> SpanStyle(color = Color(0xFF475569))
    CodeTokenKind.Tag -> SpanStyle(color = Color(0xFF1D4ED8))
}

/**
 * 网页用 highlight.js（17 种语言）。原生没有现成的同款库，这里用一个小的词法高亮器覆盖同样的 17 种语言，
 * 颜色类别与网页主题一致：关键字、内置、声明名、字符串、数字 / 字面量 / 类型、变量 / 属性、注释、元信息、标签。
 * 语言选择与网页相同：先用围栏上写的语言（含别名），再用 guessLanguage 的 Python 规则，最后自动识别（分数不到 2 当纯文本）。
 * 自动识别和逐词规则是近似，不保证与 highlight.js 每个记号都一样。
 */
object CodeHighlighter {
    const val PLAIN = "plaintext"

    val languages = listOf(
        "bash", "c", "cpp", "csharp", "css", "java", "javascript", "json", "markdown",
        "php", "python", "ruby", "rust", "sql", "typescript", "xml", "yaml",
    )

    private val aliases = mapOf(
        "c++" to "cpp", "c#" to "csharp", "html" to "xml", "js" to "javascript", "jsx" to "javascript",
        "md" to "markdown", "py" to "python", "sh" to "bash", "shell" to "bash", "ts" to "typescript",
        "tsx" to "typescript", "yml" to "yaml",
    )

    /** 网页 normalizeLanguage：小写、去掉 language- 前缀、换别名。 */
    fun normalize(language: String?): String? {
        if (language.isNullOrBlank()) return null
        val normalized = language.trim().lowercase().removePrefix("language-")
        return aliases[normalized] ?: normalized
    }

    /** 网页 guessLanguage：只认 Python。 */
    fun guess(code: String): String? {
        val python = Regex("""^\s*(def|class)\s+\w+""", RegexOption.MULTILINE).containsMatchIn(code) ||
            Regex("""^\s*(from|import)\s+\w+""", RegexOption.MULTILINE).containsMatchIn(code) ||
            Regex("""\b(input|print)\s*\(""").containsMatchIn(code)
        return if (python) "python" else null
    }

    fun highlight(code: String, language: String?): HighlightResult {
        val chosen = normalize(language) ?: guess(code)
        if (chosen != null && chosen in languages) return HighlightResult(chosen, tokenize(code, chosen))
        // 写了不认识的语言或没写：在 17 种里自动识别，分数不够就当纯文本（网页 relevance >= 2）。
        val detected = detect(code)
        return if (detected == null) HighlightResult(PLAIN, emptyList()) else HighlightResult(detected, tokenize(code, detected))
    }

    /** 自动识别：按各语言的特征计分，取最高且不低于 2 的。 */
    fun detect(code: String): String? {
        var best: String? = null
        var bestScore = 1
        for (language in languages) {
            val score = relevance(code, language)
            if (score > bestScore) {
                best = language
                bestScore = score
            }
        }
        return best
    }

    private fun relevance(code: String, language: String): Int {
        val spec = specs[language] ?: return 0
        var score = 0
        spec.signatures.forEach { if (it.containsMatchIn(code)) score += 2 }
        val words = Regex("""[A-Za-z_][A-Za-z0-9_]*""").findAll(code).map { it.value }.toSet()
        score += words.count { word -> (if (spec.caseInsensitive) word.lowercase() else word).let { it in spec.keywords && it !in commonWords } }
        return score
    }

    // highlight.js 里这些常见英文词的分数是 0，不算识别依据。
    private val commonWords = setOf("if", "else", "for", "in", "of", "and", "or", "not", "is", "do", "then", "return", "as", "with", "to", "new", "case")

    fun tokenize(code: String, language: String): List<CodeToken> = when (language) {
        "xml" -> tokenizeMarkup(code)
        "markdown" -> tokenizeMarkdown(code)
        "json" -> tokenizeGeneric(code, specs.getValue("json"), keyBeforeColon = true)
        "yaml" -> tokenizeYaml(code)
        "css" -> tokenizeCss(code)
        else -> tokenizeGeneric(code, specs[language] ?: return emptyList())
    }

    // ---- 各语言的词表 ----

    private class Spec(
        val keywords: Set<String> = emptySet(),
        val builtIns: Set<String> = emptySet(),
        val literals: Set<String> = emptySet(),
        val types: Set<String> = emptySet(),
        val lineComments: List<String> = emptyList(),
        val blockComment: Pair<String, String>? = null,
        val quotes: String = "\"'",
        /** 这些关键字后面的名字是声明名（hljs title）。 */
        val titleAfter: Set<String> = emptySet(),
        /** `$name` 是变量（bash、php）。 */
        val dollarVariables: Boolean = false,
        /** `@name` 是元信息（Python 装饰器、Java 注解）。 */
        val atMeta: Boolean = false,
        /** 以 `#` 开头的行是预处理指令（C、C++、C#）。 */
        val hashDirective: Boolean = false,
        val caseInsensitive: Boolean = false,
        val signatures: List<Regex> = emptyList(),
    )

    private fun words(text: String) = text.trim().split(Regex("\\s+")).toSet()

    private val cTypes = words("int char void short long float double signed unsigned bool size_t const static struct union enum auto")

    private val specs: Map<String, Spec> = mapOf(
        "bash" to Spec(
            keywords = words("if then else elif fi for while until do done case esac in function select time"),
            builtIns = words("echo cd export source alias unset read printf exit local declare set shift test eval exec pwd ls grep sed awk cat mkdir rm cp mv chmod chown sudo npm npx git curl"),
            literals = words("true false"),
            lineComments = listOf("#"),
            dollarVariables = true,
            titleAfter = words("function"),
            signatures = listOf(Regex("""^#!.*\b(ba|z)?sh\b"""), Regex("""^\s*(sudo|npm|npx|git|cd|echo|export)\s""", RegexOption.MULTILINE), Regex("""\$\{?\w+""")),
        ),
        "c" to Spec(
            keywords = words("if else for while do switch case break continue return goto default typedef sizeof extern register volatile inline"),
            builtIns = words("printf scanf malloc free memcpy strlen NULL"),
            literals = words("true false NULL"),
            types = cTypes,
            lineComments = listOf("//"),
            blockComment = "/*" to "*/",
            hashDirective = true,
            signatures = listOf(Regex("""#include\s*<\w+\.h>"""), Regex("""\bint\s+main\s*\(""")),
        ),
        "cpp" to Spec(
            keywords = words("if else for while do switch case break continue return default typedef sizeof namespace using class public private protected virtual override template typename new delete try catch throw this operator friend inline const_cast static_cast dynamic_cast reinterpret_cast nullptr constexpr noexcept"),
            builtIns = words("std cout cin endl vector string map set unique_ptr shared_ptr make_unique printf"),
            literals = words("true false nullptr NULL"),
            types = cTypes,
            lineComments = listOf("//"),
            blockComment = "/*" to "*/",
            hashDirective = true,
            titleAfter = words("class struct namespace"),
            signatures = listOf(Regex("""#include\s*<\w+>"""), Regex("""std::"""), Regex("""\bcout\s*<<""")),
        ),
        "csharp" to Spec(
            keywords = words("using namespace class public private protected internal static readonly void return if else for foreach while do switch case break continue new this base override virtual abstract async await var get set try catch finally throw interface struct enum record in out ref params"),
            builtIns = words("Console Math List Dictionary Task String"),
            literals = words("true false null"),
            types = words("int string bool double float decimal long short byte char object void"),
            lineComments = listOf("//"),
            blockComment = "/*" to "*/",
            hashDirective = true,
            titleAfter = words("class interface struct enum record namespace"),
            signatures = listOf(Regex("""\busing\s+System"""), Regex("""Console\.Write"""), Regex("""\bnamespace\s+[\w.]+""")),
        ),
        "css" to Spec(
            keywords = words("important media import keyframes font-face supports"),
            lineComments = emptyList(),
            blockComment = "/*" to "*/",
            signatures = listOf(Regex("""^\s*[.#]?[\w-]+\s*\{""", RegexOption.MULTILINE), Regex("""^\s*[\w-]+\s*:\s*[^;]+;""", RegexOption.MULTILINE)),
        ),
        "java" to Spec(
            keywords = words("public private protected static final abstract class interface extends implements return if else for while do switch case break continue new this super try catch finally throw throws import package void synchronized enum instanceof var record"),
            builtIns = words("System String Math List ArrayList Map HashMap Integer Object"),
            literals = words("true false null"),
            types = words("int long short byte char boolean float double void"),
            lineComments = listOf("//"),
            blockComment = "/*" to "*/",
            atMeta = true,
            titleAfter = words("class interface enum record"),
            signatures = listOf(Regex("""public\s+static\s+void\s+main"""), Regex("""System\.out\.print"""), Regex("""^\s*package\s+[\w.]+;""", RegexOption.MULTILINE)),
        ),
        "javascript" to Spec(
            keywords = words("const let var function return if else for while do switch case break continue new this class extends import export from default async await try catch finally throw typeof instanceof of in yield delete static get set"),
            builtIns = words("console window document Math JSON Promise Array Object String Number Boolean Map Set Date Error require module process"),
            literals = words("true false null undefined NaN Infinity"),
            lineComments = listOf("//"),
            blockComment = "/*" to "*/",
            quotes = "\"'`",
            titleAfter = words("function class"),
            signatures = listOf(Regex("""\b(const|let)\s+\w+\s*="""), Regex("""=>"""), Regex("""console\.log""")),
        ),
        "json" to Spec(
            literals = words("true false null"),
            quotes = "\"",
            signatures = listOf(Regex("""^\s*[\[{]"""), Regex(""""\w+"\s*:""")),
        ),
        "markdown" to Spec(
            signatures = listOf(Regex("""^#{1,6}\s+\S""", RegexOption.MULTILINE), Regex("""^\s*[-*]\s+\S""", RegexOption.MULTILINE), Regex("""\[[^\]]+]\([^)]+\)""")),
        ),
        "php" to Spec(
            keywords = words("function return if else elseif for foreach while do switch case break continue new class extends implements public private protected static echo print use namespace require include try catch throw as array isset unset empty"),
            builtIns = words("strlen count array_map json_encode var_dump"),
            literals = words("true false null TRUE FALSE NULL"),
            lineComments = listOf("//", "#"),
            blockComment = "/*" to "*/",
            dollarVariables = true,
            titleAfter = words("function class"),
            signatures = listOf(Regex("""<\?php"""), Regex("""\$\w+\s*=""")),
        ),
        "python" to Spec(
            keywords = words("def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield global nonlocal assert del async await match case"),
            builtIns = words("print input len range int str float list dict set tuple open enumerate zip map filter sorted sum min max abs type isinstance super self"),
            literals = words("True False None"),
            lineComments = listOf("#"),
            atMeta = true,
            titleAfter = words("def class"),
            signatures = listOf(Regex("""^\s*def\s+\w+\(.*\)\s*:""", RegexOption.MULTILINE), Regex("""^\s*(from\s+\w+\s+)?import\s+\w+""", RegexOption.MULTILINE)),
        ),
        "ruby" to Spec(
            keywords = words("def end class module if elsif else unless while until for in do return yield begin rescue ensure raise require attr_accessor then case when self nil"),
            builtIns = words("puts print p require_relative each map"),
            literals = words("true false nil"),
            lineComments = listOf("#"),
            titleAfter = words("def class module"),
            signatures = listOf(Regex("""^\s*def\s+\w+[^:(]*$""", RegexOption.MULTILINE), Regex("""^\s*end\s*$""", RegexOption.MULTILINE), Regex("""\bputs\s""")),
        ),
        "rust" to Spec(
            keywords = words("fn let mut pub use mod struct enum impl trait for in while loop if else match return self Self crate super where as move ref async await dyn const static unsafe extern type"),
            builtIns = words("println print format vec Vec String Option Some None Result Ok Err Box"),
            literals = words("true false"),
            types = words("i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 bool char str usize isize"),
            lineComments = listOf("//"),
            blockComment = "/*" to "*/",
            titleAfter = words("fn struct enum trait impl mod"),
            signatures = listOf(Regex("""\bfn\s+\w+\s*\("""), Regex("""\blet\s+mut\b"""), Regex("""println!""")),
        ),
        "sql" to Spec(
            keywords = words("select from where insert into values update set delete create table drop alter add join left right inner outer on group by order having limit offset as and or not null is in like between distinct union all primary key foreign references index view default exists case when then else end"),
            builtIns = words("count sum avg min max now coalesce"),
            literals = words("true false null"),
            types = words("int integer varchar text boolean date timestamp serial bigint numeric"),
            lineComments = listOf("--"),
            blockComment = "/*" to "*/",
            quotes = "'\"",
            caseInsensitive = true,
            signatures = listOf(Regex("""(?i)\bselect\b[\s\S]*\bfrom\b"""), Regex("""(?i)\b(create\s+table|insert\s+into)\b""")),
        ),
        "typescript" to Spec(
            keywords = words("const let var function return if else for while do switch case break continue new this class extends implements interface type enum import export from default async await try catch finally throw typeof instanceof keyof of in readonly public private protected as declare namespace abstract"),
            builtIns = words("console window document Math JSON Promise Array Object Record Partial Map Set Date Error"),
            literals = words("true false null undefined"),
            types = words("string number boolean any unknown never void"),
            lineComments = listOf("//"),
            blockComment = "/*" to "*/",
            quotes = "\"'`",
            titleAfter = words("function class interface type enum"),
            signatures = listOf(Regex("""\binterface\s+\w+\s*\{"""), Regex(""":\s*(string|number|boolean)\b"""), Regex("""\btype\s+\w+\s*=""")),
        ),
        "xml" to Spec(
            signatures = listOf(Regex("""<(\w+)[^>]*>[\s\S]*</\1>"""), Regex("""<!DOCTYPE""", RegexOption.IGNORE_CASE)),
        ),
        "yaml" to Spec(
            literals = words("true false null yes no"),
            lineComments = listOf("#"),
            signatures = listOf(Regex("""^[\w-]+:\s*$""", RegexOption.MULTILINE), Regex("""^\s+-\s+\w+:""", RegexOption.MULTILINE)),
        ),
    )

    // ---- 记号切分 ----

    private fun isIdentStart(c: Char) = c.isLetter() || c == '_'
    private fun isIdent(c: Char) = c.isLetterOrDigit() || c == '_'

    private fun readString(code: String, start: Int, quote: Char): Int {
        var i = start + 1
        while (i < code.length) {
            val c = code[i]
            if (c == '\\') { i += 2; continue }
            if (c == quote) return i + 1
            // 普通引号的字符串不跨行（模板字符串可以）。
            if (c == '\n' && quote != '`') return i
            i++
        }
        return code.length
    }

    private fun readNumber(code: String, start: Int): Int {
        var i = start
        if (code.startsWith("0x", i) || code.startsWith("0X", i)) {
            i += 2
            while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
            return i
        }
        while (i < code.length && (code[i].isDigit() || code[i] == '_' || code[i] == '.')) i++
        if (i < code.length && (code[i] == 'e' || code[i] == 'E')) {
            var j = i + 1
            if (j < code.length && (code[j] == '+' || code[j] == '-')) j++
            if (j < code.length && code[j].isDigit()) {
                i = j
                while (i < code.length && code[i].isDigit()) i++
            }
        }
        while (i < code.length && code[i].isLetter()) i++ // 1L、2f、3u32 之类的后缀
        return i
    }

    private fun tokenizeGeneric(code: String, spec: Spec, keyBeforeColon: Boolean = false): List<CodeToken> {
        val tokens = mutableListOf<CodeToken>()
        var i = 0
        var expectTitle = false
        var lineStart = true
        while (i < code.length) {
            val c = code[i]
            if (c == '\n') { lineStart = true; i++; continue }
            if (c.isWhitespace()) { i++; continue }
            val atLineStart = lineStart
            lineStart = false
            if (spec.hashDirective && atLineStart && c == '#') {
                val end = code.indexOf('\n', i).let { if (it == -1) code.length else it }
                tokens += CodeToken(i, end, CodeTokenKind.Meta)
                // #include <stdio.h> / "x.h" 里的文件名是字符串。
                Regex("""<[^>\n]+>|"[^"\n]*"""").find(code.substring(i, end))?.let { m ->
                    tokens += CodeToken(i + m.range.first, i + m.range.last + 1, CodeTokenKind.String)
                }
                i = end
                continue
            }
            val lineComment = spec.lineComments.firstOrNull { code.startsWith(it, i) }
            if (lineComment != null && !(lineComment == "#" && spec.dollarVariables && i > 0 && code[i - 1] == '$')) {
                val end = code.indexOf('\n', i).let { if (it == -1) code.length else it }
                tokens += CodeToken(i, end, CodeTokenKind.Comment)
                i = end
                continue
            }
            val block = spec.blockComment
            if (block != null && code.startsWith(block.first, i)) {
                val close = code.indexOf(block.second, i + block.first.length)
                val end = if (close == -1) code.length else close + block.second.length
                tokens += CodeToken(i, end, CodeTokenKind.Comment)
                i = end
                continue
            }
            if (c in spec.quotes) {
                val end = readString(code, i, c)
                // 按下标往后跳过空格看冒号，不复制剩余文本（每个字符串都 substring 一次，大 JSON 会变成平方级）。
                val isKey = keyBeforeColon && run {
                    var next = end
                    while (next < code.length && (code[next] == ' ' || code[next] == '\t')) next++
                    next < code.length && code[next] == ':'
                }
                tokens += CodeToken(i, end, if (isKey) CodeTokenKind.Variable else CodeTokenKind.String)
                i = end
                continue
            }
            if (spec.dollarVariables && c == '$' && i + 1 < code.length && (isIdentStart(code[i + 1]) || code[i + 1] == '{')) {
                var end = i + 1
                if (code[end] == '{') {
                    end = code.indexOf('}', end).let { if (it == -1) code.length else it + 1 }
                } else {
                    while (end < code.length && isIdent(code[end])) end++
                }
                tokens += CodeToken(i, end, CodeTokenKind.Variable)
                i = end
                continue
            }
            if (spec.atMeta && c == '@' && i + 1 < code.length && isIdentStart(code[i + 1])) {
                var end = i + 1
                while (end < code.length && (isIdent(code[end]) || code[end] == '.')) end++
                tokens += CodeToken(i, end, CodeTokenKind.Meta)
                i = end
                continue
            }
            if (c.isDigit() || (c == '-' && keyBeforeColon && i + 1 < code.length && code[i + 1].isDigit())) {
                val start = i
                val end = readNumber(code, if (c == '-') i + 1 else i)
                tokens += CodeToken(start, end, CodeTokenKind.Number)
                i = end
                continue
            }
            if (isIdentStart(c)) {
                var end = i + 1
                while (end < code.length && isIdent(code[end])) end++
                // Rust 的宏 println! 算内置。
                val word = code.substring(i, end)
                val key = if (spec.caseInsensitive) word.lowercase() else word
                val kind = when {
                    expectTitle -> CodeTokenKind.Title
                    key in spec.literals -> CodeTokenKind.Number
                    key in spec.types -> CodeTokenKind.Number
                    key in spec.keywords -> CodeTokenKind.Keyword
                    key in spec.builtIns -> CodeTokenKind.BuiltIn
                    else -> null
                }
                expectTitle = kind != CodeTokenKind.Title && key in spec.titleAfter
                if (kind != null) tokens += CodeToken(i, end, kind)
                i = end
                continue
            }
            expectTitle = false
            i++
        }
        return tokens
    }

    // YAML：行首的键是属性色，# 注释，字符串、数字、字面量。
    private fun tokenizeYaml(code: String): List<CodeToken> {
        val tokens = mutableListOf<CodeToken>()
        val key = Regex("""^(\s*-?\s*)([^\s#:'"][^:#\n]*?|"[^"\n]*"|'[^'\n]*')\s*:(?=\s|$)""", RegexOption.MULTILINE)
        val keyRanges = key.findAll(code).map { it.groups[2]!!.range }.toList()
        keyRanges.forEach { tokens += CodeToken(it.first, it.last + 1, CodeTokenKind.Variable) }
        val rest = tokenizeGeneric(code, specs.getValue("yaml"))
        // 两边都按起点排好序：双指针去掉和键重叠的记号，避免 记号数 × 键数 的开销。
        var k = 0
        for (t in rest.sortedBy { it.start }) {
            while (k < keyRanges.size && keyRanges[k].last < t.start) k++
            if (k < keyRanges.size && keyRanges[k].first < t.end) continue
            tokens += t
        }
        return tokens.sortedBy { it.start }
    }

    // CSS：选择器里的元素名是 selector-tag，属性名是 attribute，@规则是关键字，数值是数字。
    private fun tokenizeCss(code: String): List<CodeToken> {
        val tokens = mutableListOf<CodeToken>()
        var i = 0
        var depth = 0
        while (i < code.length) {
            val c = code[i]
            when {
                code.startsWith("/*", i) -> {
                    val close = code.indexOf("*/", i + 2)
                    val end = if (close == -1) code.length else close + 2
                    tokens += CodeToken(i, end, CodeTokenKind.Comment)
                    i = end
                }
                c == '"' || c == '\'' -> {
                    val end = readString(code, i, c)
                    tokens += CodeToken(i, end, CodeTokenKind.String)
                    i = end
                }
                c == '@' -> {
                    var end = i + 1
                    while (end < code.length && (isIdent(code[end]) || code[end] == '-')) end++
                    tokens += CodeToken(i, end, CodeTokenKind.Keyword)
                    i = end
                }
                c == '{' -> { depth++; i++ }
                c == '}' -> { depth = maxOf(0, depth - 1); i++ }
                depth > 0 && (isIdentStart(c) || c == '-') && startsDeclaration(code, i) &&
                    cssProperty.containsMatchIn(code.substring(i, minOf(code.length, i + 120))) -> {
                    var end = i
                    while (end < code.length && (isIdent(code[end]) || code[end] == '-')) end++
                    tokens += CodeToken(i, end, CodeTokenKind.Variable)
                    i = end
                }
                c.isDigit() || (c == '.' && i + 1 < code.length && code[i + 1].isDigit()) -> {
                    var end = i
                    while (end < code.length && (code[end].isDigit() || code[end] == '.')) end++
                    while (end < code.length && (code[end].isLetter() || code[end] == '%')) end++
                    tokens += CodeToken(i, end, CodeTokenKind.Number)
                    i = end
                }
                c == '#' && depth > 0 -> {
                    var end = i + 1
                    while (end < code.length && code[end].isLetterOrDigit()) end++
                    tokens += CodeToken(i, end, CodeTokenKind.Number)
                    i = end
                }
                depth == 0 && isIdentStart(c) && (i == 0 || code[i - 1] !in ".#-:_" && !isIdent(code[i - 1])) -> {
                    var end = i
                    while (end < code.length && (isIdent(code[end]) || code[end] == '-')) end++
                    tokens += CodeToken(i, end, CodeTokenKind.Keyword)
                    i = end
                }
                else -> i++
            }
        }
        return tokens
    }

    private val cssProperty = Regex("""^-?-?[\w-]+\s*:""")

    // 属性名只在声明开头：往前跳过空白后是 {、; 或开头。
    private fun startsDeclaration(code: String, index: Int): Boolean {
        var j = index - 1
        while (j >= 0 && code[j].isWhitespace()) j--
        return j < 0 || code[j] == '{' || code[j] == ';'
    }

    // HTML / XML：整个标签是 tag 色，标签名是 name，属性名是 attr，属性值是字符串，<!-- --> 是注释。
    private fun tokenizeMarkup(code: String): List<CodeToken> {
        val tokens = mutableListOf<CodeToken>()
        var i = 0
        while (i < code.length) {
            when {
                code.startsWith("<!--", i) -> {
                    val close = code.indexOf("-->", i + 4)
                    val end = if (close == -1) code.length else close + 3
                    tokens += CodeToken(i, end, CodeTokenKind.Comment)
                    i = end
                }
                code.startsWith("<!", i) || code.startsWith("<?", i) -> {
                    val end = code.indexOf('>', i).let { if (it == -1) code.length else it + 1 }
                    tokens += CodeToken(i, end, CodeTokenKind.Meta)
                    i = end
                }
                code[i] == '<' && i + 1 < code.length && (code[i + 1].isLetter() || code[i + 1] == '/') -> {
                    val end = code.indexOf('>', i).let { if (it == -1) code.length else it + 1 }
                    tokens += CodeToken(i, end, CodeTokenKind.Tag)
                    var j = i + 1
                    if (j < end && code[j] == '/') j++
                    val nameStart = j
                    while (j < end && (code[j].isLetterOrDigit() || code[j] == '-' || code[j] == ':')) j++
                    if (j > nameStart) tokens += CodeToken(nameStart, j, CodeTokenKind.Title)
                    while (j < end) {
                        val c = code[j]
                        when {
                            c == '"' || c == '\'' -> {
                                val close = readString(code, j, c).coerceAtMost(end)
                                tokens += CodeToken(j, close, CodeTokenKind.String)
                                j = close
                            }
                            c.isLetter() -> {
                                val start = j
                                while (j < end && (code[j].isLetterOrDigit() || code[j] == '-' || code[j] == ':' || code[j] == '_')) j++
                                tokens += CodeToken(start, j, CodeTokenKind.Variable)
                            }
                            else -> j++
                        }
                    }
                    i = end
                }
                else -> i++
            }
        }
        return tokens
    }

    // Markdown：网页主题只给链接文字（string）和行内代码以外的少数记号上色，这里只标链接和引用。
    private fun tokenizeMarkdown(code: String): List<CodeToken> {
        val tokens = mutableListOf<CodeToken>()
        Regex("""\[([^\]\n]+)]\(([^)\n]+)\)""").findAll(code).forEach { m ->
            tokens += CodeToken(m.groups[1]!!.range.first, m.groups[1]!!.range.last + 1, CodeTokenKind.String)
        }
        Regex("""^>.*$""", RegexOption.MULTILINE).findAll(code).forEach { m ->
            tokens += CodeToken(m.range.first, m.range.last + 1, CodeTokenKind.Comment)
        }
        return tokens.sortedBy { it.start }
    }
}
