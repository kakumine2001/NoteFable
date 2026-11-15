package com.kakumine.notefable.data

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.Base64

/**
 * 把生成的图片存进相册的"图片"（Pictures）目录，对应网页生成图片右下角的下载键（chat-message.tsx 的 `download="notefable-<id>.png"`）。
 * 图片来源有两种：刚生成的是 data URL（直接解码），历史里的是 `/api/attachments/<id>/image`（要带 App 的 Cookie，用同一个 OkHttp 客户端下载）。
 * Android 10 及以上用 MediaStore 写入，不需要权限；Android 8–9 需要 WRITE_EXTERNAL_STORAGE（清单里 maxSdkVersion=28），由界面先申请。
 */
object ImageSaver {
    /** 网页的下载文件名 `notefable-<id>.png`；类型不是 PNG 时换成对应的扩展名，id 里不安全的字符换成 `_`。 */
    fun fileName(id: String, mimeType: String): String {
        val safeId = id.replace(Regex("""[^A-Za-z0-9._-]"""), "_").trim('.').ifEmpty { "image" }
        return "notefable-$safeId.${extensionOf(mimeType)}"
    }

    fun extensionOf(mimeType: String): String = when (mimeType.lowercase().substringBefore(';').trim()) {
        "image/jpeg", "image/jpg" -> "jpg"
        "image/webp" -> "webp"
        "image/gif" -> "gif"
        else -> "png"
    }

    /** 解开 `data:<type>;base64,<data>`。不是 base64 data URL 时返回 null。 */
    fun decodeDataUrl(dataUrl: String): Pair<ByteArray, String>? {
        if (!dataUrl.startsWith("data:")) return null
        val comma = dataUrl.indexOf(',').takeIf { it > 0 } ?: return null
        val header = dataUrl.substring(5, comma)
        if (!header.endsWith(";base64")) return null
        val mimeType = header.removeSuffix(";base64").ifEmpty { "image/png" }
        val bytes = runCatching { Base64.getMimeDecoder().decode(dataUrl.substring(comma + 1)) }.getOrNull() ?: return null
        return bytes to mimeType
    }

    /** 读出图片字节和类型。[absoluteUrl] 把历史里的相对地址补成完整地址。服务端出错时抛 [ApiException]。 */
    suspend fun load(client: OkHttpClient, image: GeneratedImageDto, absoluteUrl: (String) -> String): Pair<ByteArray, String> {
        decodeDataUrl(image.dataUrl)?.let { return it }
        val response = client.newCall(Request.Builder().url(absoluteUrl(image.dataUrl)).get().build()).await()
        return response.use {
            if (!it.isSuccessful) throw it.toApiException()
            val type = it.body.contentType()?.let { t -> "${t.type}/${t.subtype}" } ?: image.mimeType
            withContext(Dispatchers.IO) { it.body.bytes() } to type
        }
    }

    /** 存进 Pictures，返回能打开它的 Uri 和类型。Uri 为 null：已存好，但媒体库没给出可交给别的 App 的地址。 */
    suspend fun save(context: Context, client: OkHttpClient, image: GeneratedImageDto, absoluteUrl: (String) -> String): Pair<Uri?, String> {
        val (bytes, mimeType) = load(client, image, absoluteUrl)
        val name = fileName(image.id, mimeType)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) saveToMediaStore(context, bytes, name, mimeType)
        else saveToPublicPictures(context, bytes, name, mimeType)
    }

    private suspend fun saveToMediaStore(context: Context, bytes: ByteArray, name: String, mimeType: String): Pair<Uri, String> {
        val resolver = context.contentResolver
        var item: Uri? = null
        try {
            return withContext(Dispatchers.IO) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, name)
                    put(MediaStore.Images.Media.MIME_TYPE, mimeType)
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES)
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                val created = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    ?: throw IOException("Cannot save the file.")
                item = created
                (resolver.openOutputStream(created) ?: throw IOException("Cannot save the file.")).use { it.write(bytes) }
                resolver.update(created, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
                created to mimeType
            }
        } catch (e: Throwable) {
            // 没写完的文件不留在相册里。
            item?.let { withContext(Dispatchers.IO + NonCancellable) { runCatching { resolver.delete(it, null, null) } } }
            throw e
        }
    }

    // Android 8–9：写进公共 Pictures 目录，再让媒体库扫描（相册里才看得到）。
    @Suppress("DEPRECATION")
    private suspend fun saveToPublicPictures(context: Context, bytes: ByteArray, name: String, mimeType: String): Pair<Uri?, String> =
        withContext(Dispatchers.IO) {
            val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
            if (!dir.exists() && !dir.mkdirs()) throw IOException("Cannot save the file.")
            val file = uniqueFile(dir, name)
            file.writeBytes(bytes)
            // 扫描失败时 scanned 为 null：不退回 file:// 地址（交给别的 App 会抛 FileUriExposedException）。
            val uri = kotlinx.coroutines.suspendCancellableCoroutine<Uri?> { continuation ->
                MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mimeType)) { _, scanned ->
                    if (continuation.isActive) continuation.resumeWith(Result.success(scanned))
                }
            }
            uri to mimeType
        }

    private fun uniqueFile(dir: File, name: String): File {
        var file = File(dir, name)
        var n = 1
        while (file.exists()) {
            file = File(dir, name.substringBeforeLast('.') + " ($n)." + name.substringAfterLast('.'))
            n++
        }
        return file
    }
}
