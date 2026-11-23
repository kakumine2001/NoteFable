package com.kakumine.notefable.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.MAX_REPORT_REASON
import com.kakumine.notefable.data.ReportApi
import com.kakumine.notefable.data.ReportBackend
import com.kakumine.notefable.data.ReportTarget
import com.kakumine.notefable.data.serverMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private val ReportError: Color get() = Sm.Danger // text-[#b91c1c]

/** 回答菜单"报告回答"、提案卡片和页面菜单"报告 AI 内容"的图标（lucide flag）。 */
internal val FlagIcon = listOf(
    "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528",
)

/**
 * 报告 AI 的内容（网页 answer-actions.tsx 的 ReportDialog，Google Play 的 AI 生成内容政策）：回答（"报告这条回答"）、
 * 提案卡片和 AI 写过的页面（"报告 AI 内容"，说明换成和内容一起发送）。.notes-dialog 外观；
 * 标题 16/600，说明 14 灰、上距 8；理由框是多行的 .notes-dialog-input（上距 12、最小高 96、1px 深描边、圆角 6、16 字），
 * 选填、最多 1000 字；按钮行上距 20：取消 + 黑底"发送报告"。发送成功后在同一个框里显示"已发送，谢谢"和"完成"。
 */
@Composable
fun ReportDialog(target: ReportTarget, onClose: () -> Unit, backend: ReportBackend? = null) {
    val context = LocalContext.current
    val api = backend ?: remember(context) {
        val app = context.applicationContext as NoteFableApp
        ReportApi(app.api.httpClient, app.api::absoluteUrl)
    }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    val scope = rememberCoroutineScope()
    val system = rememberSystemText()
    val answer = target is ReportTarget.Answer

    NotesDialog(onDismiss = { if (!busy) onClose() }) {
        Text(
            stringResource(if (answer) R.string.report_title else R.string.report_ai_content),
            color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold,
        )
        if (sent) {
            Text(stringResource(R.string.report_sent), color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 8.dp))
            Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.End) {
                NotionButton(stringResource(R.string.done), onClick = onClose, primary = true)
            }
            return@NotesDialog
        }
        Text(
            stringResource(if (answer) R.string.report_help else R.string.report_ai_help),
            color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 8.dp),
        )
        ReasonField(reason, { reason = it.take(MAX_REPORT_REASON) }, enabled = !busy, placeholder = stringResource(R.string.report_reason_placeholder))
        error?.let {
            Text(
                (it as? ApiException)?.serverMessage()?.let(system::localize) ?: stringResource(R.string.report_failed),
                color = ReportError, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 8.dp),
            )
        }
        Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NotionButton(stringResource(R.string.cancel), onClick = onClose, enabled = !busy)
            NotionButton(
                stringResource(if (busy) R.string.report_sending else R.string.report_send),
                enabled = !busy, primary = true,
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            api.report(target, reason)
                            sent = true
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Throwable) {
                            error = e
                        } finally {
                            busy = false
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun ReasonField(value: String, onChange: (String) -> Unit, enabled: Boolean, placeholder: String) {
    var focused by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    BasicTextField(
        value = value,
        onValueChange = onChange,
        enabled = enabled,
        textStyle = TextStyle(color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp),
        cursorBrush = SolidColor(Sm.Text),
        modifier = Modifier.padding(top = 12.dp).fillMaxWidth().focusRequester(focus).onFocusChanged { focused = it.isFocused }
            .semantics { contentDescription = placeholder },
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxWidth().heightIn(min = 96.dp)
                    .border(if (focused) 2.dp else 1.dp, if (focused) Sm.Blue else Sm.BorderStrong, RoundedCornerShape(6.dp))
                    .padding(horizontal = 11.2.dp, vertical = 8.8.dp),
            ) {
                if (value.isEmpty()) Text(placeholder, color = Sm.Faint, fontSize = 16.sp, lineHeight = 24.sp)
                inner()
            }
        },
    )
}
