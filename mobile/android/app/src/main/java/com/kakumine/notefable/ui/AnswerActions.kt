package com.kakumine.notefable.ui

import android.content.ActivityNotFoundException
import android.net.Uri
import android.provider.DocumentsContract
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import com.kakumine.notefable.R
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.data.AnswerExportStore
import com.kakumine.notefable.data.AnswerSave
import com.kakumine.notefable.data.AnswerSaveError
import com.kakumine.notefable.data.AnswerSaveResult
import com.kakumine.notefable.data.ExportApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

// 回答操作行的"…"（网页 answer-actions.tsx 的 More options + AnswerMenu，手机 412 宽实测）：
// 按钮 36x36、圆角 4.8、Ellipsis 18（线宽 1.9）、Muted 色，紧跟在复制键后（间距 2，在 AssistantTurn 的行里）。
// 菜单与侧栏菜单同一外观（.chat-actions-menu：宽 228、内边距 5.6、圆角 12、1px 细线、白底、阴影 0 8 32 #0002），
// 左边与按钮左边对齐、按钮下方 4；下面放不下就放到按钮上方 4；离窗口边至少 8。点外面或返回键关闭。
// 项（.chat-menu-item 手机）：最小高 44、内边距 9.6×12、圆角 6.4、图标 16 + 间距 12、14/21、#37352f；
// 保存中 / 已保存、下载中的项是 aria-disabled：文字和图标变 Muted，不能再点。

/** 回答所在的对话（`activeSessionId`）。由 NoteFableRoot 提供；没有对话时不显示"…"（网页要求有 sessionId）。 */
val LocalAnswerSessionId = staticCompositionLocalOf<String?> { null }

private val MenuShadow = Color(0x22000000)
private val ErrorRed: Color get() = Sm.ErrorText // --nf-error-text（浅色 #933b34） // .answer-menu-error / .answer-actions-error
private val ErrorText get() = TextStyle(fontSize = 13.sp, lineHeight = 18.2.sp, color = ErrorRed, letterSpacing = 0.sp)

// 存到笔记的状态放在 App 级（网页模块级的 Map）：只在主线程读写。
private var exportStore: AnswerExportStore? = null

internal fun NoteFableApp.answerExports(): AnswerExportStore =
    exportStore ?: AnswerExportStore(ExportApi(api.httpClient, api::absoluteUrl), scope).also { exportStore = it }

/** 菜单里或操作行下方的错误（网页 error：{ action, message }，复制、保存、下载共用这一处）。 */
internal sealed interface MenuError {
    data object Copy : MenuError
    data class Save(val error: AnswerSaveError) : MenuError
    data object Download : MenuError
}

/** 一条回答的"…"的界面状态。AssistantTurn 在行里放 [AnswerMoreButton]，行下放 [AnswerMoreRowError]。 */
@Stable
internal class AnswerMoreState(val sessionId: String, messageId: String, content: String) {
    var menuOpen by mutableStateOf(false)
    var downloading by mutableStateOf(false)
    /** "报告回答"的对话框开着。 */
    var reporting by mutableStateOf(false)
    var error by mutableStateOf<MenuError?>(null)
    /** 对账后换成服务端 ID；正文也以最新的为准。 */
    var messageId by mutableStateOf(messageId)
    var content by mutableStateOf(content)
}

/**
 * 按列表项的 [key] 记住（对账把 `local-N` 换成服务端 ID 时 key 不变）。App 级的保存状态由 ChatViewModel 在对账时
 * 搬到新 ID 下（不管这条回答在不在屏幕上），这里只跟着换成新 ID。
 */
@Composable
internal fun rememberAnswerMoreState(key: String, messageId: String, content: String): AnswerMoreState? {
    val sessionId = LocalAnswerSessionId.current ?: return null
    val state = remember(sessionId, key) { AnswerMoreState(sessionId, messageId, content) }
    if (state.messageId != messageId) state.messageId = messageId
    if (state.content != content) state.content = content
    return state
}

/** 让用户选保存位置并写入整段对话的 Markdown（[rememberConversationDownloader]，注册在 NoteFableRoot）。 */
internal fun interface ConversationDownloader {
    /** 打开选择器；[onFailed] 只在发起的这条回答还在时有用（进程被杀后改用 Toast 提示）。 */
    fun launch(sessionId: String, fileName: String, onFailed: () -> Unit)
}

internal val LocalConversationDownloader = staticCompositionLocalOf<ConversationDownloader?> { null }

/**
 * 保存位置选择器（SAF CreateDocument）注册在 App 根上，不放在回答行里：选择器开着时进程可能被杀，
 * 回来后那条回答不一定再组合，结果就没人接、新建的文件一直是空的。要写哪个会话、文件名存在 rememberSaveable 里，
 * 进程重建后也在；等写入的 Markdown 放在 App 级（[AnswerExportStore.holdExport]），没了就重新读一次。
 * 写不成就删掉选择器已经建好的空文件并提示。写入在 App 级的作用域里跑，Activity 重建也不中断。
 */
@Composable
internal fun rememberConversationDownloader(): ConversationDownloader {
    val context = LocalContext.current
    val app = context.applicationContext as NoteFableApp
    val store = remember(app) { app.answerExports() }
    var pendingSession by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingFileName by rememberSaveable { mutableStateOf<String?>(null) }
    // 发起下载的回答行的错误回调（按会话）：进程被杀后就没了，改用 Toast。
    val failureCallbacks = remember { mutableMapOf<String, () -> Unit>() }
    val downloaded = stringResource(R.string.answer_conversation_downloaded)
    val failed = stringResource(R.string.answer_download_failed)

    val createDocument = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri: Uri? ->
        val sessionId = pendingSession
        pendingSession = null
        pendingFileName = null
        if (sessionId == null) return@rememberLauncherForActivityResult
        val held = store.takeExport(sessionId)
        val onFailed = failureCallbacks.remove(sessionId)
        if (uri == null) return@rememberLauncherForActivityResult
        app.scope.launch {
            val ok = try {
                val markdown = held ?: store.exportConversation(sessionId, LocalDate.now().toString()).markdown
                withContext(Dispatchers.IO) {
                    (app.contentResolver.openOutputStream(uri, "wt") ?: error("no stream")).use { it.write(markdown.toByteArray(Charsets.UTF_8)) }
                }
                true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                false
            }
            if (ok) {
                Toast.makeText(app, downloaded, Toast.LENGTH_SHORT).show()
            } else {
                withContext(Dispatchers.IO) { runCatching { DocumentsContract.deleteDocument(app.contentResolver, uri) } }
                if (onFailed != null) onFailed() else Toast.makeText(app, failed, Toast.LENGTH_SHORT).show()
            }
        }
    }

    return remember(store) {
        ConversationDownloader { sessionId, fileName, onFailed ->
            pendingSession = sessionId
            pendingFileName = fileName
            failureCallbacks[sessionId] = onFailed
            try {
                createDocument.launch(fileName)
            } catch (_: ActivityNotFoundException) {
                pendingSession = null
                pendingFileName = null
                failureCallbacks.remove(sessionId)
                store.takeExport(sessionId)
                onFailed()
            }
        }
    }
}

@Composable
internal fun AnswerMoreButton(state: AnswerMoreState) {
    val context = LocalContext.current
    val app = context.applicationContext as? NoteFableApp ?: return
    val store = remember(app) { app.answerExports() }
    // 协程放在按钮上（随这条回答存在），不放在菜单里：下载时菜单先关。保存位置选择器在 App 根上（LocalConversationDownloader）。
    val scope = rememberCoroutineScope()
    val saves by store.saves.collectAsState()
    val save = saves[AnswerExportStore.key(state.sessionId, state.messageId)]
    val downloader = LocalConversationDownloader.current

    fun saveToNotes() {
        // 保存中、已保存再点什么也不做（不重复建笔记）。
        if (save != null) return
        state.error = null
        val result = store.save(state.sessionId, state.messageId, state.content, LocalDate.now().toString())
        scope.launch {
            val outcome = result.await()
            if (outcome is AnswerSaveResult.Failed) state.error = MenuError.Save(outcome.error)
        }
    }

    fun download() {
        if (state.downloading) return
        state.downloading = true
        state.error = null
        scope.launch {
            try {
                // 不管点的是哪条回答，都读这个对话保存在服务端的全部记录。
                val export = store.exportConversation(state.sessionId, LocalDate.now().toString())
                store.holdExport(state.sessionId, export.markdown)
                state.menuOpen = false
                downloader?.launch(state.sessionId, export.fileName) { state.error = MenuError.Download }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                state.error = MenuError.Download
            } finally {
                state.downloading = false
            }
        }
    }

    val label = stringResource(R.string.answer_more_options)
    Box(
        Modifier.size(36.dp).clip(RoundedCornerShape(4.8.dp))
            .clickable { state.menuOpen = true }
            .semantics { contentDescription = label; role = Role.Button },
        Alignment.Center,
    ) {
        LucideIcon(Lucide.Ellipsis, 18.dp, Sm.Muted, strokeWidth = 1.9f)
        if (state.menuOpen) AnswerMenu(state, save, onSave = ::saveToNotes, onDownload = ::download)
    }
    if (state.reporting) ReportDialog(com.kakumine.notefable.data.ReportTarget.Answer(state.messageId), onClose = { state.reporting = false })
}

/** 菜单关着时的错误（例如保存文件失败），在操作行下方：左 8、上 2.4、13/1.4、#933b34。 */
@Composable
internal fun AnswerMoreRowError(state: AnswerMoreState) {
    val error = state.error
    if (!state.menuOpen && error != null) {
        Text(menuErrorText(error), style = ErrorText, modifier = Modifier.padding(start = 8.dp, top = 2.4.dp))
    }
}

@Composable
private fun menuErrorText(error: MenuError): String = when (error) {
    MenuError.Copy -> stringResource(R.string.answer_copy_failed)
    MenuError.Download -> stringResource(R.string.answer_download_failed)
    is MenuError.Save -> when {
        error.error.tooLarge -> stringResource(R.string.answer_save_too_large)
        error.error.serverMessage != null -> rememberSystemText().localize(error.error.serverMessage)
        else -> stringResource(R.string.answer_save_failed)
    }
}

@Composable
private fun AnswerMenu(state: AnswerMoreState, save: AnswerSave?, onSave: () -> Unit, onDownload: () -> Unit) {
    val density = LocalDensity.current
    val openNote = LocalOpenNote.current
    val close = { state.menuOpen = false }
    val provider = remember(density) { BelowOrAbove(density) }
    val menuLabel = stringResource(R.string.answer_options)
    Popup(popupPositionProvider = provider, onDismissRequest = close, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier.width(228.dp)
                .shadow(16.dp, RoundedCornerShape(12.dp), ambientColor = MenuShadow, spotColor = MenuShadow)
                .border(1.dp, Sm.Border, RoundedCornerShape(12.dp))
                .clip(RoundedCornerShape(12.dp)).background(Sm.Surface)
                .verticalScroll(rememberScrollState())
                .padding(5.6.dp)
                .semantics { contentDescription = menuLabel },
        ) {
            // 重新生成、在新聊天中分支：已经保存到服务端的回答才有；这个聊天在发送或生成时不能点。
            val turn = LocalTurnActions.current
            if (turn != null && !state.messageId.startsWith("local-")) {
                MenuEntry(stringResource(R.string.regenerate), Lucide.RefreshCw, disabled = turn.busy) {
                    close()
                    turn.regenerate(state.messageId)
                }
                MenuEntry(stringResource(R.string.branch_in_new_chat), Lucide.GitBranch, disabled = turn.busy) {
                    close()
                    turn.branch(state.messageId)
                }
            }
            // 保存中也保持菜单打开，在同一项里显示进度和结果。
            MenuEntry(
                text = when {
                    save is AnswerSave.Saving -> stringResource(R.string.save_saving)
                    save is AnswerSave.Saved -> stringResource(R.string.answer_saved_to_page)
                    state.error is MenuError.Save -> stringResource(R.string.answer_retry_save)
                    else -> stringResource(R.string.answer_save_to_page)
                },
                icon = if (save is AnswerSave.Saved) Lucide.Check else Lucide.FilePlus2,
                spinning = save is AnswerSave.Saving,
                disabled = save != null,
                onClick = onSave,
            )
            if (save is AnswerSave.Saved) {
                MenuEntry(stringResource(R.string.answer_open_saved_page), Lucide.ArrowUpRight) {
                    close()
                    openNote(save.pageId)
                }
            }
            MenuEntry(
                text = stringResource(if (state.downloading) R.string.downloading else R.string.answer_download_conversation),
                icon = Lucide.Download,
                spinning = state.downloading,
                disabled = state.downloading,
                onClick = onDownload,
            )
            // 还没换成服务端 ID 的回答（local-N）不能报告（网页 isSavedMessageId）。
            if (!state.messageId.startsWith("local-")) {
                MenuEntry(stringResource(R.string.report_answer), FlagIcon) {
                    close()
                    state.reporting = true
                }
            }
            // .answer-menu-error：上下 5.6、左右 12、13/1.4、#933b34。
            state.error?.let { Text(menuErrorText(it), style = ErrorText, modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.6.dp)) }
        }
    }
}

@Composable
private fun MenuEntry(text: String, icon: List<String>, spinning: Boolean = false, disabled: Boolean = false, onClick: () -> Unit) {
    val color = if (disabled) Sm.Muted else Sm.Text
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.4.dp))
            .clickable(enabled = !disabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 9.6.dp).semantics { role = Role.Button },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (spinning) Spinner(16.dp, color, strokeWidth = 2f) else LucideIcon(icon, 16.dp, color)
        Spacer(Modifier.width(12.dp))
        Text(text, color = color, fontSize = 14.sp, lineHeight = 21.sp)
    }
}

/** 网页 AnswerMenu 的定位：左边对齐按钮（夹在 8 和 窗口宽 - 菜单宽 - 8 之间）；下方放得下就在按钮下 4，否则在按钮上 4；顶边至少 8。 */
internal class BelowOrAbove(private val density: Density) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset =
        with(density) { answerMenuPosition(anchorBounds, windowSize, popupContentSize, 8.dp.roundToPx(), 4.dp.roundToPx(), layoutDirection) }
}

internal fun answerMenuPosition(
    anchor: IntRect,
    window: IntSize,
    menu: IntSize,
    edge: Int,
    gap: Int,
    layoutDirection: LayoutDirection = LayoutDirection.Ltr,
): IntOffset {
    val start = if (layoutDirection == LayoutDirection.Rtl) anchor.right - menu.width else anchor.left
    val left = maxOf(edge, minOf(start, window.width - menu.width - edge))
    val below = anchor.bottom + gap
    val top = maxOf(edge, if (below + menu.height <= window.height - edge) below else anchor.top - menu.height - gap)
    return IntOffset(left, top)
}
