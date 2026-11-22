package com.kakumine.notefable.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.data.ImportCandidate
import com.kakumine.notefable.data.NoteImport
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException

// 笔记的 Markdown 导出 / 导入（网页 use-note-pages.ts 的 exportPage / importMarkdown）里要用系统文件选择器的部分。
// 规则（先保存再导出、个数和大小的限制、打开第一篇）在 NotesViewModel；这里只管选位置、读写文件。

/**
 * 页面菜单的 "Export Markdown"：先让 [NotesViewModel.exportNote] 读好内容，再用系统的"保存到…"（SAF CreateDocument，
 * `text/markdown`，建议文件名是服务端给的 `<标题>.md`）让用户选位置，按 UTF-8 写入。网页是浏览器直接下载。
 * 取消选择就什么也不做；写不进去时删掉选择器已经建好的空文件，并在笔记顶栏下面显示 "Could not export the page."。
 * 和"下载对话"（rememberConversationDownloader）一样注册在 App 根上：要写哪一篇存在 rememberSaveable 里，
 * 选择器开着时进程被回收、回来后内容没了就重新读一次；写入在 App 级的作用域里跑，Activity 重建也不中断。
 */
@Composable
internal fun rememberNoteExporter(notes: NotesViewModel): (pageId: String) -> Unit {
    val app = LocalContext.current.applicationContext as NoteFableApp
    val scope = rememberCoroutineScope()
    var pendingId by rememberSaveable { mutableStateOf<String?>(null) }

    val createDocument = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri: Uri? ->
        val id = pendingId
        pendingId = null
        if (id == null) return@rememberLauncherForActivityResult
        val held = notes.takeExport(id)
        if (uri == null) return@rememberLauncherForActivityResult
        app.scope.launch {
            val ok = try {
                val markdown = notes.exportedMarkdown(id, held)
                withContext(Dispatchers.IO) {
                    (app.contentResolver.openOutputStream(uri, "wt") ?: error("no stream")).use { it.write(markdown.toByteArray(Charsets.UTF_8)) }
                }
                true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                false
            }
            if (!ok) {
                withContext(Dispatchers.IO) { runCatching { DocumentsContract.deleteDocument(app.contentResolver, uri) } }
                notes.exportFailed()
            }
        }
    }

    return remember(notes) {
        { pageId ->
            scope.launch {
                val exported = notes.exportNote(pageId) ?: return@launch
                pendingId = pageId
                try {
                    createDocument.launch(exported.fileName)
                } catch (_: ActivityNotFoundException) {
                    pendingId = null
                    notes.takeExport(pageId)
                    notes.exportFailed()
                }
            }
        }
    }
}

/**
 * "Import Markdown"：系统的多选文件选择器（SAF OpenMultipleDocuments，类型见 [NoteImport.MIME_TYPES]），
 * 对应网页的 `<input type="file" multiple accept=".md,.markdown,.txt,…">`。选好的文件（文件名、大小、读全文的方法）交给 [onPicked]，
 * 什么都没选就不调用。返回的函数打开选择器。导入到哪个项目在选完文件之后问（[NotesViewModel.pickedForImport]、[ImportTargetDialog]）。
 * 文件名和大小要访问文件提供方（云盘可能很慢），放到后台线程问；选多了的不问，直接交出去报"太多"。
 */
@Composable
internal fun rememberMarkdownImportPicker(identityGeneration: () -> Int, onPicked: (List<ImportCandidate>) -> Unit): () -> Unit {
    val context = LocalContext.current.applicationContext
    val currentOnPicked by rememberUpdatedState(onPicked)
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            // 问文件名和大小的这段时间里换了账号，就不把旧账号下选的文件交出去。
            val generation = identityGeneration()
            val candidates =
                if (uris.size > NoteImport.MAX_FILES) uris.map { ImportCandidate(it.lastPathSegment.orEmpty(), null) { readImportText(context, it) } }
                else withContext(Dispatchers.IO) { uris.map { importCandidate(context, it) } }
            if (identityGeneration() == generation) currentOnPicked(candidates)
        }
    }
    return remember(picker) {
        {
            try {
                picker.launch(NoteImport.MIME_TYPES)
            } catch (_: ActivityNotFoundException) {
                // 没有能选文件的 App：和网页点了没反应一样，什么也不做。
            }
        }
    }
}

/** 文件名和大小向选择器的提供方要（OpenableColumns）；要不到名字时用地址的最后一段。 */
private fun importCandidate(context: Context, uri: Uri): ImportCandidate {
    var name: String? = null
    var size: Long? = null
    runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameAt = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeAt = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameAt >= 0 && !cursor.isNull(nameAt)) name = cursor.getString(nameAt)
                if (sizeAt >= 0 && !cursor.isNull(sizeAt)) size = cursor.getLong(sizeAt)
            }
        }
    }
    return ImportCandidate(name?.takeIf { it.isNotBlank() } ?: uri.lastPathSegment.orEmpty(), size) { readImportText(context, uri) }
}

/**
 * 读出全文（UTF-8，和网页 File.text() 一样坏字节换成替换字符）。最多读到单个文件的上限多一个字节：
 * 大小报错了的大文件不会整个进内存，多出的那一个字节让之后的检查照常报"超过 1 MiB"。
 */
private suspend fun readImportText(context: Context, uri: Uri): String = withContext(Dispatchers.IO) {
    val limit = NoteImport.MAX_FILE_BYTES.toInt() + 1
    val out = ByteArrayOutputStream()
    (context.contentResolver.openInputStream(uri) ?: throw IOException("no stream")).use { input ->
        val buffer = ByteArray(16 * 1024)
        while (out.size() < limit) {
            val read = input.read(buffer, 0, minOf(buffer.size, limit - out.size()))
            if (read < 0) break
            out.write(buffer, 0, read)
        }
    }
    out.toString(Charsets.UTF_8.name())
}
