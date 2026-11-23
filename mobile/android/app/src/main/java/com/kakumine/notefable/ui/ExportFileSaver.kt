package com.kakumine.notefable.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ExportFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

/**
 * 系统的"保存到…"（SAF CreateDocument），类型按每个文件定：[ActivityResultContracts.CreateDocument] 的类型在注册时就固定了，
 * 这里沿用它的意图（建议文件名）和结果，只把类型换成这个文件的 MIME。
 */
private object CreateExportDocument : ActivityResultContract<ExportFile, Uri?>() {
    private val create = ActivityResultContracts.CreateDocument("*/*")

    override fun createIntent(context: Context, input: ExportFile): Intent = create.createIntent(context, input.name).setType(input.mime)

    override fun parseResult(resultCode: Int, intent: Intent?): Uri? = create.parseResult(resultCode, intent)
}

/**
 * 网页编辑器导出的文件（白板的 PNG / SVG / PDF，以后幻灯片的 PPTX）：JS 桥把块拼成临时文件后
 * （[com.kakumine.notefable.data.ExportFileAssembler]）交到这里，用系统的"保存到…"让用户选位置（建议文件名和类型按这个文件），
 * 拷进去后提示 "File saved." / "Could not save the file."。临时文件不管存没存成、用户取消了，都删掉。网页是浏览器直接下载。
 * 和"下载对话"（[rememberConversationDownloader]）一样注册在 App 根上：临时文件的路径存在 rememberSaveable 里，
 * 选择器开着时进程被回收，回来后照样拷；拷贝在 App 级的作用域里跑，Activity 重建也不中断。同一时间只等一个保存位置。
 * 拼好时 App 在后台（切到别的 App 时导出完成）：系统不让后台打开选择器，所以等回到前台（ON_START）再打开。
 */
@Composable
internal fun rememberExportFileSaver(): (ExportFile?) -> Unit {
    val app = LocalContext.current.applicationContext as NoteFableApp
    var pendingPath by rememberSaveable { mutableStateOf<String?>(null) }
    // 文案在组合里按 Activity 的语言读好（App 级的 Context 不一定跟着 App 里选的语言）。
    val saved by rememberUpdatedState(stringResource(R.string.export_file_saved))
    val failed by rememberUpdatedState(stringResource(R.string.export_file_failed))
    fun toast(text: String) = Toast.makeText(app, text, Toast.LENGTH_SHORT).show()
    fun discard(file: File) {
        app.scope.launch(Dispatchers.IO) { file.delete() }
    }

    val createDocument = rememberLauncherForActivityResult(CreateExportDocument) { uri: Uri? ->
        val path = pendingPath
        pendingPath = null
        if (path == null) return@rememberLauncherForActivityResult
        val file = File(path)
        // 取消选择：不提示，只删临时文件。
        if (uri == null) {
            discard(file)
            return@rememberLauncherForActivityResult
        }
        app.scope.launch {
            val ok = try {
                withContext(Dispatchers.IO) {
                    file.inputStream().use { input ->
                        (app.contentResolver.openOutputStream(uri, "wt") ?: throw IOException("no stream")).use { input.copyTo(it) }
                    }
                }
                true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                false
            }
            withContext(Dispatchers.IO) {
                file.delete()
                // 写不进去时不留下选择器已经建好的空文件。
                if (!ok) runCatching { DocumentsContract.deleteDocument(app.contentResolver, uri) }
            }
            toast(if (ok) saved else failed)
        }
    }

    fun choose(exported: ExportFile) {
        pendingPath = exported.file.absolutePath
        try {
            createDocument.launch(exported)
        } catch (_: RuntimeException) {
            // 没有能选位置的 App（ActivityNotFoundException），或 Activity 已经没了、选择器已注销（IllegalStateException）。
            pendingPath = null
            discard(exported.file)
            toast(failed)
        }
    }

    // 在后台拼好的文件，等回到前台再让用户选位置（只留最后一个）。
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var waiting by remember { mutableStateOf<ExportFile?>(null) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) waiting?.let { exported ->
                waiting = null
                if (pendingPath == null) choose(exported) else discard(exported.file)
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    return remember(createDocument, lifecycle) {
        { exported ->
            when {
                exported == null -> toast(failed)
                // 上一个文件的保存位置还没选完（选择器盖住整个画面，正常碰不到）：这个不存。
                pendingPath != null -> {
                    discard(exported.file)
                    toast(failed)
                }
                !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) -> {
                    waiting?.let { discard(it.file) }
                    waiting = exported
                }
                else -> choose(exported)
            }
        }
    }
}
