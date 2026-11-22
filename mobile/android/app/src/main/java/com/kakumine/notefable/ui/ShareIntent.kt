package com.kakumine.notefable.ui

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import com.kakumine.notefable.data.IncomingShareRequest
import com.kakumine.notefable.data.LocalFile
import com.kakumine.notefable.data.MAX_UPLOAD_FILE_BYTES
import com.kakumine.notefable.data.composeSharedText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import java.io.ByteArrayOutputStream

// 系统「分享」（ACTION_SEND / ACTION_SEND_MULTIPLE）交来的内容：文字、链接、图片、文件。
// 外部 App 给的 content:// 地址只在这次分享里临时可读，所以一收到 Intent 就在后台把文件拷进缓存（和拍照、粘贴的图片同一个目录），
// 界面稍后再取结果；之后的处理（校验、上传）和普通附件完全相同。

/** 从分享 Intent 取出文字和文件；两者都没有（或不是分享）时返回 null。 */
fun extractShareIntent(context: Context, intent: Intent?, scope: CoroutineScope): IncomingShareRequest? {
    if (intent == null) return null
    if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) return null
    val text = composeSharedText(
        intent.getStringExtra(Intent.EXTRA_SUBJECT),
        intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
    )
    val uris = shareUris(intent)
    if (text.isEmpty() && uris.isEmpty()) return null
    if (uris.isEmpty()) return IncomingShareRequest(text)
    val app = context.applicationContext
    val files = scope.async(Dispatchers.IO) { uris.mapNotNull { readSharedFile(app, it) } }
    return IncomingShareRequest(text) { files.await() }
}

@Suppress("DEPRECATION")
private fun shareUris(intent: Intent): List<Uri> {
    val streams = buildList<Uri> {
        if (Build.VERSION.SDK_INT >= 33) {
            if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)?.let(::addAll)
            } else {
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)?.let(::add)
            }
        } else if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let(::addAll)
        } else {
            (intent.getParcelableExtra<android.os.Parcelable>(Intent.EXTRA_STREAM) as? Uri)?.let(::add)
        }
    }
    val clip = buildList {
        intent.clipData?.let { data -> for (i in 0 until data.itemCount) data.getItemAt(i).uri?.let(::add) }
    }
    return (streams + clip).distinct()
}

private val DIRECT_IMAGE_TYPES = setOf("image/png", "image/jpeg", "image/webp")

/** 把一个分享来的文件读进缓存。过大的文件不写入，只带上真实的大小，由附件校验报“超过上限”。读不出来返回 null。 */
internal fun readSharedFile(context: Context, uri: Uri): LocalFile? = runCatching {
    val resolver = context.contentResolver
    var name = ""
    var size = -1L
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            name = cursor.getString(0).orEmpty()
            if (!cursor.isNull(1)) size = cursor.getLong(1)
        }
    }
    if (name.isEmpty()) name = uri.lastPathSegment?.substringAfterLast('/').orEmpty()
    val type = (resolver.getType(uri)
        ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
        ?: "application/octet-stream").lowercase()
    // 大小不明的来源：读一遍数出来，超过单个文件上限就不再往下读。
    if (size < 0) size = resolver.openInputStream(uri)?.use { countUpTo(it, MAX_UPLOAD_FILE_BYTES + 1) } ?: 0L
    if (size > MAX_UPLOAD_FILE_BYTES) return@runCatching LocalFile(uri.toString(), name, type, size)

    if (type.startsWith("image/") && type !in DIRECT_IMAGE_TYPES) {
        // HEIC、GIF 等模型读不了的图片：和 iOS 一样转成 JPEG。转不了就按原样交给附件校验（会提示不支持）。
        val jpeg = decodeAsJpeg(context, uri)
        if (jpeg != null) {
            val jpegName = (name.substringBeforeLast('.', name).ifEmpty { "image" }) + ".jpg"
            val target = newAttachmentCacheUri(context, "jpg", jpegName)
            resolver.openOutputStream(target)?.use { it.write(jpeg) } ?: return@runCatching null
            return@runCatching LocalFile(target.toString(), jpegName, "image/jpeg", jpeg.size.toLong())
        }
    }
    val extension = name.substringAfterLast('.', "").ifEmpty { "bin" }
    val target = newAttachmentCacheUri(context, extension, name.takeIf { it.isNotBlank() })
    // 报的大小不一定可信：最多拷到上限多一个字节，超过就删掉副本，只带着真实的（超限的）大小交给附件校验。
    var copied = 0L
    resolver.openInputStream(uri)?.use { input ->
        resolver.openOutputStream(target)?.use { output ->
            val buffer = ByteArray(64 * 1024)
            while (copied <= MAX_UPLOAD_FILE_BYTES) {
                val read = input.read(buffer)
                if (read < 0) break
                output.write(buffer, 0, read)
                copied += read
            }
        }
    } ?: return@runCatching null
    if (copied > MAX_UPLOAD_FILE_BYTES) {
        runCatching { resolver.delete(target, null, null) }
        return@runCatching LocalFile(uri.toString(), name, type, copied)
    }
    LocalFile(target.toString(), name.ifEmpty { target.lastPathSegment.orEmpty() }, type, cachedSize(context, target))
}.getOrNull()

private fun countUpTo(input: java.io.InputStream, limit: Long): Long {
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    while (total < limit) {
        val read = input.read(buffer)
        if (read < 0) break
        total += read
    }
    return total
}

private fun decodeAsJpeg(context: Context, uri: Uri): ByteArray? = runCatching {
    val bitmap: Bitmap = if (Build.VERSION.SDK_INT >= 28) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, _, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        context.contentResolver.openInputStream(uri)?.use(BitmapFactory::decodeStream) ?: return null
    }
    ByteArrayOutputStream().use { out ->
        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
        out.toByteArray()
    }
}.getOrNull()
