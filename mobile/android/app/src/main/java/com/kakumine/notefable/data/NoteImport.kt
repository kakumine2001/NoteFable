package com.kakumine.notefable.data

import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * Markdown 导入的规则，与网页 src/lib/note-io.ts 相同（服务端 POST /api/pages/import 会再查一遍）：
 * 一次最多 20 个文件、单个 1 MiB、合计 4 MB（留在 Vercel 4.5 MB 请求上限以内），扩展名只收 .md / .markdown / .txt。
 */
object NoteImport {
    const val MAX_FILES = 20
    const val MAX_FILE_BYTES = 1024L * 1024
    const val MAX_TOTAL_BYTES = 4L * 1024 * 1024

    private val EXTENSIONS = listOf(".md", ".markdown", ".txt")

    /**
     * 系统文件选择器里列出的类型（网页 accept=".md,.markdown,.txt,text/markdown,text/plain"）。
     * 选择器按 MIME 类型筛，不看扩展名；不少文件管理器把 .md 报成 application/octet-stream，所以也放进来，选完再按扩展名查。
     */
    val MIME_TYPES = arrayOf("text/markdown", "text/x-markdown", "text/plain", "application/octet-stream")

    /** 导出时服务端没给文件名的后备（网页 exportPage 的 "note.md"）。 */
    const val FALLBACK_EXPORT_NAME = "note.md"

    enum class Problem { TooMany, BadType, FileTooLarge, TooLarge }

    /** 选中的一个文件：文件名和字节数。 */
    data class Entry(val name: String, val bytes: Long)

    fun isImportable(name: String): Boolean {
        val lower = name.trim().lowercase()
        return EXTENSIONS.any { lower.endsWith(it) }
    }

    /** 按网页 importMarkdown 的顺序检查：个数 → 逐个（类型、大小）→ 合计。没问题返回 null。 */
    fun check(files: List<Entry>): Problem? {
        if (files.size > MAX_FILES) return Problem.TooMany
        var total = 0L
        for (file in files) {
            if (!isImportable(file.name)) return Problem.BadType
            if (file.bytes > MAX_FILE_BYTES) return Problem.FileTooLarge
            total += file.bytes
        }
        return if (total > MAX_TOTAL_BYTES) Problem.TooLarge else null
    }

    /**
     * 发给 POST /api/pages/import 的请求体，与网页 use-note-pages.ts 的 importMarkdown() 相同：
     * 选了项目时 { files: [{ name, markdown }], groupId }，没选（"No project"）时只有 { files }。
     */
    fun requestBody(files: List<ImportMarkdownFile>, groupId: String? = null): String = buildJsonObject {
        putJsonArray("files") {
            files.forEach { file ->
                addJsonObject {
                    put("name", file.name)
                    put("markdown", file.markdown)
                }
            }
        }
        if (!groupId.isNullOrEmpty()) put("groupId", groupId)
    }.toString()

    /**
     * 服务端按整个 JSON 请求体的字节数拒绝（换行、引号转义后是 2 个字节），所以和网页一样按要发送的样子（含 groupId）再量一次：
     * 超过合计上限就不发。
     */
    fun requestTooLarge(files: List<ImportMarkdownFile>, groupId: String? = null): Boolean =
        requestBody(files, groupId).toByteArray(Charsets.UTF_8).size > MAX_TOTAL_BYTES
}

/**
 * 用户在文件选择器里选的一个文件：[size] 是选择器报的字节数（报不出来时 null，读完再按实际大小查）；
 * [read] 读出全文（UTF-8）。
 */
class ImportCandidate(val name: String, val size: Long?, val read: suspend () -> String)
