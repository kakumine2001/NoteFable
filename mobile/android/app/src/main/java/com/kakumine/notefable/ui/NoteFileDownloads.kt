package com.kakumine.notefable.ui

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.kakumine.notefable.R
import com.kakumine.notefable.data.NoteFileLinks
import com.kakumine.notefable.data.NoteFableApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * 下载笔记里的私有文件（`/api/pages/files?key=…`）。文件只给它的主人，要带 App 的 Cookie，所以由 App 自己用 OkHttp 下载，
 * 不交给系统浏览器或 DownloadManager（它们没有这个 Cookie，只会拿到 404）。
 * Android 10 及以上直接存进"下载"（MediaStore.Downloads，不需要权限）；更老的系统先让用户选保存位置（SAF）。
 * 存好后用系统的"打开方式"打开。提示文案用网页已有的 "Downloading…" 和 App 已有的 "Request failed: …"。
 */
@Composable
fun rememberNoteFileDownloader(api: NoteFableApi): (String) -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val currentApi by rememberUpdatedState(api)
    // Android 9 及以下：选保存位置期间记着要下载哪个文件。
    var pendingUrl by rememberSaveable { mutableStateOf<String?>(null) }

    val saveAs = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { target ->
        val url = pendingUrl
        pendingUrl = null
        if (target == null || url == null) return@rememberLauncherForActivityResult
        scope.launch {
            download(context) {
                val file = currentApi.downloadNoteFile(url) { _, _ ->
                    context.contentResolver.openOutputStream(target) ?: throw IOException("Cannot write the file.")
                }
                target to file.mimeType
            }
        }
    }

    return remember(context) {
        { url: String ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                scope.launch { download(context) { saveToDownloads(context, currentApi, url) } }
            } else {
                pendingUrl = url
                try {
                    saveAs.launch(NoteFileLinks.fileName(url))
                } catch (_: ActivityNotFoundException) {
                    pendingUrl = null
                }
            }
        }
    }
}

/** 下载并在成功后打开；失败时提示原因（服务端的原句，例如 "File not found."）。 */
private suspend fun download(context: Context, work: suspend () -> Pair<Uri, String>) {
    Toast.makeText(context, R.string.downloading, Toast.LENGTH_SHORT).show()
    val (uri, mimeType) = try {
        work()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        val reason = e.message ?: e.javaClass.simpleName
        Toast.makeText(context, context.getString(R.string.request_failed, reason), Toast.LENGTH_LONG).show()
        return
    }
    val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    try {
        context.startActivity(Intent.createChooser(view, null))
    } catch (_: ActivityNotFoundException) {
        // 没有能打开它的 App：文件已经在"下载"里了。
    }
}

@RequiresApi(Build.VERSION_CODES.Q)
private suspend fun saveToDownloads(context: Context, api: NoteFableApi, url: String): Pair<Uri, String> {
    val resolver = context.contentResolver
    var item: Uri? = null
    try {
        val file = api.downloadNoteFile(url) { name, mimeType ->
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mimeType)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val created = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IOException("Cannot save the file.")
            item = created
            resolver.openOutputStream(created) ?: throw IOException("Cannot save the file.")
        }
        val saved = item ?: throw IOException("Cannot save the file.")
        withContext(Dispatchers.IO) {
            resolver.update(saved, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        }
        return saved to file.mimeType
    } catch (e: Throwable) {
        // 没写完的文件不留在"下载"里。
        item?.let { withContext(Dispatchers.IO + kotlinx.coroutines.NonCancellable) { runCatching { resolver.delete(it, null, null) } } }
        throw e
    }
}
