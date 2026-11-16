package com.kakumine.notefable.ui

import android.content.ClipData
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.MessageVersions
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 一条消息上的操作（网页 turn-actions.tsx，手机 412 宽）：
// 操作行和回答的操作行一样（上距 6.4、整体左移 10.4、按钮 36×36、圆角 4.8、间距 2、图标 16 线宽 1.9、Muted 色）。
// 版本切换「‹ 2/3 ›」：两个箭头按钮夹着 13 号的数字（最小宽 28、居中、Muted）；到头的箭头和忙的时候是 Faint 色、不能点。
// 提问下面依次是版本切换、复制、编辑（触屏上一直显示；网页在有鼠标的设备上移上去才显示复制和编辑）。

/** 编辑、重新生成、切换版本、分支。由 NoteFableRoot 接到 ChatViewModel；[busy] 时这个聊天在发送或生成，不能操作。 */
class TurnActions(
    val regenerate: (messageId: String) -> Unit,
    val edit: (messageId: String, text: String) -> Unit,
    val showVersion: (messageId: String) -> Unit,
    val branch: (messageId: String) -> Unit,
    /** 关掉因为被拒绝而重新打开的编辑框（取消）。 */
    val dismissEditDraft: () -> Unit,
    val busy: Boolean,
)

/** 没有提供时（没有对话）不显示这些操作。 */
val LocalTurnActions = compositionLocalOf<TurnActions?> { null }

@Composable
private fun TurnIconButton(icon: List<String>, label: String, enabled: Boolean = true, strokeWidth: Float = 1.9f, onClick: () -> Unit) {
    Box(
        Modifier.size(36.dp).clip(RoundedCornerShape(4.8.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        Alignment.Center,
    ) {
        LucideIcon(icon, 16.dp, if (enabled) Sm.Muted else Sm.Faint, strokeWidth = strokeWidth)
    }
}

@Composable
internal fun VersionNav(versions: MessageVersions, busy: Boolean, onShow: (String) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        TurnIconButton(Lucide.ChevronLeft, stringResource(R.string.previous_version), enabled = !busy && versions.prevId != null) {
            versions.prevId?.let(onShow)
        }
        Text(
            "${versions.index}/${versions.total}",
            color = Sm.Muted, fontSize = 13.sp, lineHeight = 13.sp, textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(min = 28.dp),
        )
        TurnIconButton(Lucide.ChevronRight, stringResource(R.string.next_version), enabled = !busy && versions.nextId != null) {
            versions.nextId?.let(onShow)
        }
    }
}

/** 提问下面的操作行。只给已经保存到服务端的提问显示（本机 ID 的还不能编辑）。 */
@Composable
internal fun UserTurnActions(message: UiMessage, actions: TurnActions, canEdit: Boolean, onEdit: () -> Unit) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copiedTick by remember { mutableIntStateOf(0) }
    LaunchedEffect(copiedTick) {
        if (copiedTick > 0) {
            delay(2000)
            copiedTick = 0
        }
    }
    val copyLabel = stringResource(R.string.copy_message)
    val copiedLabel = stringResource(R.string.answer_copied)
    Row(
        Modifier.padding(top = 6.4.dp).offset(x = (-10.4).dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        message.versions?.let { VersionNav(it, actions.busy, actions.showVersion) }
        if (message.content.isNotEmpty()) {
            TurnIconButton(
                if (copiedTick > 0) Lucide.Check else Lucide.Copy,
                if (copiedTick > 0) copiedLabel else copyLabel,
                strokeWidth = if (copiedTick > 0) 2f else 1.9f,
            ) {
                scope.launch {
                    try {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("NoteFable", message.content)))
                        copiedTick++
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Throwable) {
                        // 复制不了时什么也不显示（网页同样）。
                    }
                }
            }
        }
        if (canEdit) TurnIconButton(Lucide.Pencil, stringResource(R.string.edit_message), enabled = !actions.busy, onClick = onEdit)
    }
}

/**
 * 在提问块里直接改写（网页 UserMessageEditor）：文字 15 / 行高 28、透明底，最高 40% 屏高、超过就在里面滚动；
 * 下面一行靠右两个按钮（.notion-button：取消；.notion-button-primary：发送），上距 8、间距 8。空白或聊天在生成时不能发送。返回键取消。
 */
@Composable
internal fun UserMessageEditor(initial: String, busy: Boolean, onCancel: () -> Unit, onSubmit: (String) -> Unit) {
    var value by rememberSaveable(stateSaver = TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(initial, TextRange(initial.length)))
    }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    BackHandler(onBack = onCancel)
    val label = stringResource(R.string.edit_message)
    val maxHeight = (LocalConfiguration.current.screenHeightDp * 0.4f).dp
    Column(Modifier.fillMaxWidth()) {
        BasicTextField(
            value = value,
            onValueChange = { value = it },
            textStyle = TextStyle(color = Sm.Text, fontSize = 15.sp, lineHeight = 28.sp),
            cursorBrush = SolidColor(Sm.Text),
            modifier = Modifier.fillMaxWidth().heightIn(max = maxHeight).focusRequester(focus).semantics { contentDescription = label },
        )
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NotionButton(stringResource(R.string.cancel), onClick = onCancel)
            // 这个聊天在生成时不能发送（文字留在编辑框里）。
            NotionButton(stringResource(R.string.turn_send), onClick = { onSubmit(value.text.trim()) }, enabled = value.text.isNotBlank() && !busy, primary = true)
        }
    }
}
