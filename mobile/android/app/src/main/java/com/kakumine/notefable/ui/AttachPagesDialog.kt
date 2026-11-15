package com.kakumine.notefable.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ChatProjectNote
import com.kakumine.notefable.data.MAX_MESSAGE_NOTES
import kotlinx.coroutines.CancellationException

/**
 * 打开窗口时读到的笔记列表之后，之前选的笔记换成现在的标题；已经进了回收站的去掉（发出去也会被服务端剔除）。
 * 和网页 AttachPageDialog 的 setSelected(current.flatMap(byId.get)) 一样。
 */
fun refreshAttachedPages(selected: List<ChatProjectNote>, live: List<ChatProjectNote>): List<ChatProjectNote> {
    val byId = live.associateBy { it.id }
    return selected.mapNotNull { byId[it.id] }
}

/**
 * 「添加页面」（网页 AttachPageDialog）：选自己的笔记，作为这段对话的参考。外观和项目设置的参考笔记一栏用同一套部件
 * （dialog.chat-project-settings 的手机尺寸，见 ProjectSettings.kt）：头部只有标题；"你的笔记"一栏带 n/5 计数和说明，
 * 已选的标签、筛选框、列表（最多列 100 篇）；底部取消 / 添加。返回键和点遮罩关闭（不保存）。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AttachPagesDialog(
    initial: List<ChatProjectNote>,
    loadNotes: suspend () -> List<ChatProjectNote>,
    onClose: () -> Unit,
    onAttach: (List<ChatProjectNote>) -> Unit,
) {
    var attempt by remember { mutableIntStateOf(0) }
    var pages by remember { mutableStateOf<List<ChatProjectNote>?>(null) }
    var loadError by remember { mutableStateOf<SidebarError?>(null) }
    var selected by remember { mutableStateOf(initial) }
    var filter by remember { mutableStateOf("") }
    val untitled = stringResource(R.string.sb_untitled)

    LaunchedEffect(attempt) {
        try {
            val live = loadNotes()
            pages = live
            selected = refreshAttachedPages(selected, live)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Throwable) {
            loadError = SidebarError.of(error, R.string.sb_err_load_your_notes)
        }
    }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        LaunchedEffect(window) { window?.setDimAmount(0.2f) }
        Column(
            Modifier.padding(horizontal = 19.dp).widthIn(max = 544.dp).fillMaxWidth()
                .heightIn(max = (LocalConfiguration.current.screenHeightDp - 38).coerceAtLeast(200).dp)
                .shadow(14.dp, RoundedCornerShape(8.dp), ambientColor = Color(0x1F0F0F0F), spotColor = Color(0x1F0F0F0F))
                .border(1.dp, Color(0x0D0F0F0F), RoundedCornerShape(8.dp))
                .clip(RoundedCornerShape(8.dp)).background(Color.White),
        ) {
            Text(
                stringResource(R.string.attach_pages), color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
            )
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp)) {
                val full = selected.size >= MAX_MESSAGE_NOTES
                SettingsSectionLabel(stringResource(R.string.sb_your_notes), "${selected.size}/$MAX_MESSAGE_NOTES", full)
                SettingsHelpText(stringResource(R.string.attach_pages_help))
                if (selected.isNotEmpty()) {
                    val selectedLabel = stringResource(R.string.sb_selected_notes)
                    FlowRow(
                        Modifier.padding(top = 9.6.dp).semantics { contentDescription = selectedLabel },
                        horizontalArrangement = Arrangement.spacedBy(5.6.dp),
                        verticalArrangement = Arrangement.spacedBy(5.6.dp),
                    ) {
                        selected.forEach { note ->
                            NoteChip(note.title.ifEmpty { untitled }, enabled = true) { selected = toggleProjectNote(selected, note, MAX_MESSAGE_NOTES) }
                        }
                    }
                }
                val list = pages
                val failed = loadError
                when {
                    failed != null -> {
                        Text(sidebarErrorText(failed), color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp))
                        NotionButton(stringResource(R.string.try_again), onClick = { loadError = null; attempt++ }, modifier = Modifier.padding(top = 8.dp))
                    }
                    list == null -> Row(Modifier.padding(top = 9.6.dp), verticalAlignment = Alignment.CenterVertically) {
                        SpinningLoader(14.dp)
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.sb_loading), color = Sm.Muted, fontSize = 13.sp)
                    }
                    else -> {
                        FilterField(filter, { filter = it }, stringResource(R.string.sb_filter_notes))
                        val listed = filterProjectNotes(list, filter, untitled)
                        val ids = selected.mapTo(HashSet()) { it.id }
                        if (listed.isNotEmpty()) {
                            Column(Modifier.padding(top = 6.4.dp).heightIn(max = 176.dp).verticalScroll(rememberScrollState())) {
                                listed.take(MAX_LISTED_NOTES).forEach { page ->
                                    val checked = page.id in ids
                                    NoteOption(page, untitled, checked = checked, blocked = !checked && full, busy = false) {
                                        selected = toggleProjectNote(selected, page, MAX_MESSAGE_NOTES)
                                    }
                                }
                            }
                        } else {
                            EmptyText(stringResource(if (list.isNotEmpty()) R.string.sb_no_notes_match else R.string.sb_no_notes_yet))
                        }
                        if (listed.size > MAX_LISTED_NOTES) EmptyText(stringResource(R.string.sb_showing_first_notes, MAX_LISTED_NOTES))
                        if (full) EmptyText(stringResource(R.string.sb_notes_limit, MAX_MESSAGE_NOTES))
                    }
                }
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 1.dp).background(Sm.Border))
            Row(
                Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            ) {
                NotionButton(stringResource(R.string.cancel), onClick = onClose)
                NotionButton(stringResource(R.string.attach_pages_submit), onClick = { onAttach(selected); onClose() }, primary = true)
            }
        }
    }
}
