package com.kakumine.studymate.data

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.URLDecoder

/** 下载好的笔记文件：保存时用的文件名和类型。 */
data class NoteFileDownload(val name: String, val mimeType: String)

/**
 * 笔记里的图片 / 文件块指向本站的 `/api/pages/files?key=…&name=…`（src/lib/note-file-keys.ts）。
 * 服务端只把文件给它的主人（按 Cookie 认人），所以 WebView 里点到这种链接时由 App 自己带 Cookie 下载，不交给系统浏览器。
 */
object NoteFileLinks {
    private const val PATH = "/api/pages/files"

    /** [target] 是不是本站的笔记文件地址。 */
    fun isNoteFile(target: String, baseUrl: String): Boolean {
        val url = target.toHttpUrlOrNull() ?: return false
        val base = baseUrl.toHttpUrlOrNull() ?: return false
        return url.scheme == base.scheme && url.host == base.host && url.port == base.port &&
            url.encodedPath == PATH && !url.queryParameter("key").isNullOrEmpty()
    }

    /** 保存用的文件名：先用响应头 Content-Disposition 的 filename*，再用地址里的 name，都没有时叫 file。 */
    fun fileName(contentDisposition: String?, url: HttpUrl): String {
        val fromHeader = contentDisposition?.let { header ->
            Regex("""filename\*\s*=\s*UTF-8''([^;]+)""", RegexOption.IGNORE_CASE).find(header)?.groupValues?.get(1)
                ?.let { runCatching { URLDecoder.decode(it.trim().replace("+", "%2B"), "UTF-8") }.getOrNull() }
        }
        return sanitize(fromHeader) ?: sanitize(url.queryParameter("name")) ?: "file"
    }

    /** 地址里的 name（还没下载、要先让用户选保存位置时用）。 */
    fun fileName(url: String): String = url.toHttpUrlOrNull()?.let { sanitize(it.queryParameter("name")) } ?: "file"

    // 去掉路径分隔符和控制字符，避免写到 Downloads 以外的地方。
    private fun sanitize(name: String?): String? =
        name?.replace(Regex("""[\\/\u0000-\u001f]"""), "_")?.trim()?.trimStart('.')?.takeIf { it.isNotEmpty() }
}
