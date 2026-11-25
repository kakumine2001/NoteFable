package com.kakumine.notefable.ui

import android.content.ClipData
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.DiagramApi
import com.kakumine.notefable.data.DiagramJob
import com.kakumine.notefable.data.DiagramStore
import com.kakumine.notefable.data.NotePageSummary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 「画成图」的任务放在 App 级（网页模块级的 jobs）：只在主线程读写。
private var diagramStore: DiagramStore? = null

internal fun NoteFableApp.diagrams(): DiagramStore =
    diagramStore ?: DiagramStore(DiagramApi(api.httpClient, api::absoluteUrl), scope).also { diagramStore = it }

/** 回答"…"里的「画成图」：开始（或重开）这条回答的任务并打开窗口。由 NoteFableRoot 在主聊天里提供（笔记 AI 面板的聊天在网页里，没有）。 */
internal interface AnswerDiagramLauncher {
    /** 进行中的任务（菜单项显示"正在画图…"）。 */
    val jobs: kotlinx.coroutines.flow.StateFlow<Map<String, com.kakumine.notefable.data.DiagramJob>>
    fun draw(sessionId: String, messageId: String)
}

internal val LocalAnswerDiagram = staticCompositionLocalOf<AnswerDiagramLauncher?> { null }

private val DiagramError: Color get() = Sm.Danger // text-[#b91c1c]

/**
 * 「画成图」的窗口（和「整理成笔记」同一个 .notes-dialog）：选了菜单项就开始，不用再确认。
 * 标题行 Workflow 18 + 间距 8、16/600；说明 14 灰、上 12；进行中是转圈 16 +"正在画图…"（上 12）；画好了换成"图画好了。"
 * （素材太长时多一句）；失败时说明下面是红字原因（14、上 8）。按钮行上 20、间距 8 靠右（放不下时换行）：
 * 关闭；画好了是"打开白板"；失败是"重试"（同一个 clientRequestId），转换不了（422）时还有"复制图的源码"（复制后显示"已复制"）。
 * 任务在窗口外（[DiagramStore]）：关掉窗口也继续画，重开时还是同一个任务；关窗口时忘掉已结束的任务。
 * 任务没了（换身份后那个任务结束、进程重建）就关掉窗口。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DrawDiagramDialog(
    jobKey: String,
    model: String?,
    store: DiagramStore,
    account: AccountUiState,
    onSignIn: () -> Unit,
    onOpenPage: (NotePageSummary) -> Unit,
    onClose: () -> Unit,
) {
    val jobs by store.jobs.collectAsStateWithLifecycle()
    val job = jobs[jobKey]
    val system = rememberSystemText()
    val close = {
        store.dismiss(jobKey)
        onClose()
    }
    LaunchedEffect(job == null) { if (job == null) onClose() }
    if (job == null) return

    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    // 复制了源码后 2 秒内按钮显示"已复制"（和回答的复制键一样）。
    var copiedTick by remember { mutableIntStateOf(0) }
    var copyFailed by remember { mutableStateOf(false) }
    var limitClosed by remember { mutableStateOf(false) }
    LaunchedEffect(copiedTick) {
        if (copiedTick > 0) {
            delay(2000)
            copiedTick = 0
        }
    }

    NotesDialog(close) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LucideIcon(Lucide.Workflow, 18.dp, Sm.Text)
            Text(stringResource(R.string.diagram_draw), color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)
        }
        if (job is DiagramJob.Done) {
            val text = stringResource(R.string.diagram_done) + if (job.partial) " " + stringResource(R.string.diagram_partial) else ""
            Text(
                text, color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp,
                modifier = Modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        } else {
            Text(stringResource(R.string.diagram_description), color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 12.dp))
        }
        if (job is DiagramJob.Working) {
            Row(
                Modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // mt-0.5：和第一行文字对齐。
                SpinningLoader(16.dp, Modifier.padding(top = 2.dp))
                Text(stringResource(R.string.diagram_working), color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp)
            }
        }
        if (job is DiagramJob.Failed) {
            Text(
                system.localize(job.message), color = DiagramError, fontSize = 14.sp, lineHeight = 20.sp,
                modifier = Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Assertive },
            )
            if (!limitClosed) {
                when {
                    job.usageLimitTier == "guest" && account.configured && account.user == null -> {
                        GuestLimitPrompt(
                            kind = "chat",
                            attachmentsLost = false,
                            onSignIn = onSignIn,
                            onClose = { limitClosed = true },
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    }
                    job.usageLimitTier == "member" && account.user != null -> {
                        Box(Modifier.padding(top = 12.dp)) {
                            UpgradeLimitPrompt(kind = "chat", onClose = { limitClosed = true })
                        }
                    }
                }
            }
            val mermaid = job.mermaid
            if (mermaid != null && copyFailed) {
                Text(
                    stringResource(R.string.answer_copy_failed), color = DiagramError, fontSize = 14.sp, lineHeight = 20.sp,
                    modifier = Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Assertive },
                )
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                    SelectionContainer {
                        Box(
                            Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(max = 128.dp)
                                .border(1.dp, Sm.Border, RoundedCornerShape(6.dp))
                                .verticalScroll(rememberScrollState())
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                        ) {
                            Text(mermaid, color = Sm.Text, fontSize = 13.sp, lineHeight = 18.sp, fontFamily = FontFamily.Monospace)
                        }
                    }
                }
            }
        }
        FlowRow(
            Modifier.fillMaxWidth().padding(top = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            NotionButton(stringResource(R.string.close), onClick = close)
            when (job) {
                // 网页：先打开白板，再关窗口。
                is DiagramJob.Done -> NotionButton(
                    stringResource(R.string.diagram_open),
                    onClick = { onOpenPage(job.page); close() },
                    primary = true,
                    trailingIcon = Lucide.ArrowUpRight,
                )
                is DiagramJob.Failed -> {
                    val mermaid = job.mermaid
                    if (mermaid != null) {
                        NotionButton(
                            stringResource(if (copiedTick > 0) R.string.answer_copied else R.string.diagram_copy_source),
                            leadingIcon = if (copiedTick > 0) Lucide.Check else Lucide.Copy,
                            onClick = {
                                scope.launch {
                                    val ok = try {
                                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Mermaid", mermaid)))
                                        true
                                    } catch (e: CancellationException) {
                                        throw e
                                    } catch (_: Throwable) {
                                        false
                                    }
                                    copyFailed = !ok
                                    if (ok) copiedTick++
                                }
                            },
                        )
                    }
                    NotionButton(
                        stringResource(R.string.try_again),
                        onClick = {
                            copiedTick = 0
                            copyFailed = false
                            limitClosed = false
                            store.retry(jobKey, model)
                        },
                        primary = true,
                    )
                }
                is DiagramJob.Working -> Unit
            }
        }
    }
}
