package com.kakumine.notefable.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AnswerExportStore
import com.kakumine.notefable.data.CreatePageJob
import java.time.LocalDate

private val CreatePageError: Color get() = Sm.Danger // text-[#b91c1c]

/**
 * 「整理成笔记」（网页 CreatePageDialog，.notes-dialog）：AI 把整段对话改写成一篇笔记（POST /api/sessions/:id/page）。
 * 标题行 FilePlus 18 + 间距 8、16/600；正文 14 灰、上 12（进行中前面是转圈 16）；错误 14 红、上 8；按钮行上 20、间距 8 靠右。
 * 状态在窗口外（[AnswerExportStore.pageJobs]）：关掉窗口也继续生成，重开时进行中的照样显示，同一聊天不重复建。
 * 关窗口时忘掉已结束的结果。[busy]：当前聊天在发送或回答中，最后的回答还没存下，所以不能开始。
 */
@Composable
fun CreatePageDialog(
    sessionId: String,
    model: String?,
    busy: Boolean,
    store: AnswerExportStore,
    onOpenPage: (id: String, title: String) -> Unit,
    onClose: () -> Unit,
) {
    val jobs by store.pageJobs.collectAsStateWithLifecycle()
    val job = jobs[sessionId]
    val system = rememberSystemText()
    val close = {
        store.forgetFinishedPage(sessionId)
        onClose()
    }

    NotesDialog(close) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LucideIcon(Lucide.FilePlus, 18.dp, Sm.Text)
            Text(stringResource(R.string.create_page_title), color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)
        }
        when (job) {
            CreatePageJob.Working -> Row(
                Modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // mt-0.5：和第一行文字对齐。
                SpinningLoader(16.dp, Modifier.padding(top = 2.dp))
                Text(stringResource(R.string.create_page_working), color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp)
            }
            is CreatePageJob.Done -> {
                val text = stringResource(R.string.create_page_done, job.title) +
                    if (job.partial) " " + stringResource(R.string.create_page_partial) else ""
                Text(
                    text, color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp,
                    modifier = Modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            else -> Text(stringResource(R.string.create_page_body), color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 12.dp))
        }
        if (job is CreatePageJob.Failed) {
            Text(
                system.localize(job.message), color = CreatePageError, fontSize = 14.sp, lineHeight = 20.sp,
                modifier = Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }
        Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            val finishedOrWorking = job is CreatePageJob.Working || job is CreatePageJob.Done
            NotionButton(stringResource(if (finishedOrWorking) R.string.close else R.string.cancel), onClick = close)
            if (job is CreatePageJob.Done) {
                // 网页：先打开笔记，再关窗口。
                NotionButton(stringResource(R.string.open_page), onClick = { onOpenPage(job.pageId, job.title); close() }, primary = true, trailingIcon = Lucide.ArrowUpRight)
            } else {
                NotionButton(
                    stringResource(if (job is CreatePageJob.Failed) R.string.try_again else R.string.create_page),
                    onClick = { store.createPage(sessionId, model, LocalDate.now().toString()) },
                    enabled = job !is CreatePageJob.Working && !busy,
                    primary = true,
                )
            }
        }
    }
}
