package com.kakumine.notefable.data

import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.Base64
import java.util.Locale

/** 拼好的导出文件。[file] 是 `cacheDir/exports/` 里的临时文件，存到用户选的位置后（取消、失败时也一样）删掉。 */
data class ExportFile(val file: File, val name: String, val mime: String)

/**
 * 把网页编辑器分块送来的导出文件（白板的 PNG / SVG / PDF，幻灯片的 PDF / PNG / PPTX / ZIP；src/lib/export-file.ts）拼成 [dir] 里的临时文件。
 * 消息是 fileStart → fileChunk ×n → fileEnd，中途放弃是 fileAbort（[EmbedMessage.FileStart] 等）。
 * - 只收 [MIME_TYPES] 里的类型；整个文件最多 [maxBytes]（64 MiB），写进去的字节不能超过声明的大小，结束时要正好等于它。
 * - 块只在 index 是下一个时写入。顺序乱了、base64 坏了、写不进去，这次就作废（删掉临时文件），之后的块不再收，[finish] 返回 null。
 * - 同一时间只拼一个：新的 fileStart 丢掉还没拼完的那个。
 * - 文件名见 [fileName]。
 * 在 WebView 的 JS 线程上调用（[discard] 在主线程），所以方法都加了锁。
 */
class ExportFileAssembler(
    private val dir: File,
    private val maxBytes: Long = MAX_BYTES,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private class Transfer(val id: String, val name: String, val mime: String, val size: Long, val file: File, val out: OutputStream) {
        var nextIndex = 0
        var written = 0L
    }

    private var current: Transfer? = null

    /** 开始收一个文件。不收（类型不对、太大、建不了临时文件）时返回 false，这个 id 之后的块落空，[finish] 返回 null。 */
    @Synchronized
    fun start(id: String, name: String, mime: String, size: Long): Boolean {
        drop()
        val type = mimeType(mime) ?: return false
        if (id.isBlank() || size < 0 || size > maxBytes) return false
        val file = try {
            dir.mkdirs()
            sweep()
            File.createTempFile("export-", ".part", dir)
        } catch (_: IOException) {
            return false
        } catch (_: SecurityException) {
            return false
        }
        val out = try {
            BufferedOutputStream(FileOutputStream(file))
        } catch (_: IOException) {
            file.delete()
            return false
        }
        current = Transfer(id, fileName(name, type), type, size, file, out)
        return true
    }

    /** 写入一块（[data] 是 base64）。不是正在收的文件时什么也不做；块不对时这次作废。返回这块写进去了没有。 */
    @Synchronized
    fun chunk(id: String, index: Int, data: String): Boolean {
        val transfer = current?.takeIf { it.id == id } ?: return false
        val bytes = if (index == transfer.nextIndex) decode(data) else null
        if (bytes == null || transfer.written + bytes.size > transfer.size) {
            drop()
            return false
        }
        try {
            transfer.out.write(bytes)
        } catch (_: IOException) {
            drop()
            return false
        }
        transfer.written += bytes.size
        transfer.nextIndex++
        return true
    }

    /** 收完了：字节数和声明的一样时交出临时文件（之后由调用方删），否则删掉、返回 null（也包括这个 id 早已作废或从没收过）。 */
    @Synchronized
    fun finish(id: String): ExportFile? {
        val transfer = current?.takeIf { it.id == id } ?: return null
        current = null
        val closed = try {
            transfer.out.close()
            true
        } catch (_: IOException) {
            false
        }
        if (!closed || transfer.written != transfer.size) {
            transfer.file.delete()
            return null
        }
        return ExportFile(transfer.file, transfer.name, transfer.mime)
    }

    /** 网页放弃了这次（fileAbort）。 */
    @Synchronized
    fun abort(id: String) {
        if (current?.id == id) drop()
    }

    /** 编辑器关掉、网页没了（WebView 销毁）：没拼完的不会再来，删掉。 */
    @Synchronized
    fun discard() = drop()

    private fun drop() {
        val transfer = current ?: return
        current = null
        try {
            transfer.out.close()
        } catch (_: IOException) {
        }
        transfer.file.delete()
    }

    /** 上次没拼完（进程被杀）或一直没人接走的临时文件，超过一天就在下一次开始时清掉。 */
    private fun sweep() {
        val cutoff = now() - STALE_MILLIS
        dir.listFiles()?.forEach { if (it.isFile && it.lastModified() < cutoff) it.delete() }
    }

    private fun decode(data: String): ByteArray? = try {
        Base64.getDecoder().decode(data)
    } catch (_: IllegalArgumentException) {
        null
    }

    companion object {
        /** 临时文件放在 `cacheDir` 下的这个目录。 */
        const val DIR_NAME = "exports"

        /** 一个文件最多 64 MiB。 */
        const val MAX_BYTES = 64L * 1024 * 1024

        /** 建议的文件名最多这么多个字符（含扩展名）。 */
        const val MAX_NAME_LENGTH = 120

        /** 建议的文件名最多这么多 UTF-8 字节（含扩展名；文件名的上限 NAME_MAX）。 */
        const val MAX_NAME_BYTES = 255

        private const val STALE_MILLIS = 24L * 60 * 60 * 1000

        /** 收的类型 → 补扩展名时用的扩展名（白板 src/lib/whiteboard/export.ts 的 PNG / SVG / PDF；幻灯片 src/lib/slides/export-files.ts 的 PDF / PNG / PPTX，多页的 PNG 是 ZIP）。 */
        val MIME_TYPES: Map<String, String> = mapOf(
            "image/png" to "png",
            "image/svg+xml" to "svg",
            "application/pdf" to "pdf",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation" to "pptx",
            "application/zip" to "zip",
        )

        /** 去掉参数（`;charset=…`）、不分大小写后是收的类型就返回它，否则 null。 */
        fun mimeType(value: String): String? =
            value.substringBefore(';').trim().lowercase(Locale.ROOT).takeIf { it in MIME_TYPES }

        // 路径分隔符，和 Windows / FAT 不允许的字符（网页 exportFileName 也去掉这些）。控制字符另外判断。
        private const val FORBIDDEN = "/\\:*?\"<>|"
        // 改变文字方向的字符（能把 "report‮gnp.apk" 显示成别的样子），和 iOS 的 sanitizedName 一样去掉。
        private const val BIDI_CONTROLS = "؜‎‏‪‫‬‭‮⁦⁧⁨⁩"
        private val SPACES = Regex("\\s+")

        /**
         * 保存时建议的文件名：去掉控制字符、改变文字方向的字符和路径分隔符（以及 `:*?"<>|`），连续空白合成一个，
         * 名字部分前后的点和空白去掉（不变成隐藏文件或 `..`）；扩展名总是类型的（已经以它结尾就不重复，别的扩展名当成名字的一部分）；
         * 名字部分截短到整个不超过 [MAX_NAME_LENGTH] 个字符、[MAX_NAME_BYTES] 个 UTF-8 字节（不切开代理对）。名字部分是空的时候叫 `export`。
         */
        fun fileName(raw: String, mime: String): String {
            val extension = mimeType(mime)?.let { ".${MIME_TYPES.getValue(it)}" }.orEmpty()
            val cleaned = raw.filterNot { it.isISOControl() || it in BIDI_CONTROLS || it in FORBIDDEN }.replace(SPACES, " ").trim()
            val stem = if (extension.isNotEmpty() && cleaned.endsWith(extension, ignoreCase = true)) cleaned.dropLast(extension.length) else cleaned
            val base = stem.trim(::isEdge).ifEmpty { "export" }
            val clipped = base.clip(MAX_NAME_LENGTH - extension.length, MAX_NAME_BYTES - extension.toByteArray(Charsets.UTF_8).size)
            return clipped.trimEnd(::isEdge).ifEmpty { "export" } + extension
        }

        private fun isEdge(char: Char) = char == '.' || char.isWhitespace()

        /** 截到最多 [count] 个字符、[bytes] 个 UTF-8 字节，不切开代理对。 */
        private fun String.clip(count: Int, bytes: Int): String {
            var end = minOf(length, count)
            if (end in 1 until length && this[end - 1].isHighSurrogate()) end--
            while (end > 0 && substring(0, end).toByteArray(Charsets.UTF_8).size > bytes) {
                end--
                if (end > 0 && this[end - 1].isHighSurrogate()) end--
            }
            return substring(0, end)
        }
    }
}
