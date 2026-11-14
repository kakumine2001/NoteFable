package com.kakumine.studymate.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.kakumine.studymate.R
import com.kakumine.studymate.data.ChatProjectDetail
import com.kakumine.studymate.data.ChatProjectNote
import com.kakumine.studymate.data.ChatProjectSummary
import com.kakumine.studymate.data.MAX_PROJECT_INSTRUCTIONS
import com.kakumine.studymate.data.MAX_PROJECT_NOTES
import kotlinx.coroutines.launch

/** 一次最多列出的笔记数（网页 MAX_LISTED）；多了用筛选找。 */
internal const val MAX_LISTED_NOTES = 100

/** 筛选：标题（空标题按 "Untitled" 算）包含关键词，不分大小写（网页 listed）。 */
fun filterProjectNotes(pages: List<ChatProjectNote>, filter: String, untitled: String): List<ChatProjectNote> {
    val query = filter.trim().lowercase()
    if (query.isEmpty()) return pages
    return pages.filter { (it.title.ifEmpty { untitled }).lowercase().contains(query) }
}

/** 勾选 / 取消：已选的去掉；没满就加到最后；满了不变（网页 toggle）。 */
fun toggleProjectNote(selected: List<ChatProjectNote>, note: ChatProjectNote): List<ChatProjectNote> = when {
    selected.any { it.id == note.id } -> selected.filterNot { it.id == note.id }
    selected.size >= MAX_PROJECT_NOTES -> selected
    else -> selected + note
}

private val SettingsDanger = Color(0xFFB91C1C) // .project-settings-error
private val CountFull = Color(0xFFB45309)      // .project-settings-count.is-full
private val SettingsShadow = Color(0x1F0F0F0F) // --notion-shadow
private val SettingsRing = Color(0x0D0F0F0F)

/**
 * 项目设置（网页 ChatProjectSettings，dialog.chat-project-settings 的手机尺寸）：
 * 宽 374（412 屏宽时，左右各 19）、无内边距、圆角 8；头部 16/16/8（标题 16/600 + 项目名 13 灰）；正文左右 16、下 16、可滚动；
 * 底部上边 1px 线、内边距 12/16/16 + 安全区，取消 / 保存靠右。返回键和点遮罩关闭。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProjectSettingsDialog(project: ChatProjectSummary, sidebar: SidebarViewModel, onClose: () -> Unit) {
    var attempt by remember { mutableIntStateOf(0) }
    var loaded by remember { mutableStateOf<Pair<ChatProjectDetail, List<ChatProjectNote>>?>(null) }
    var loadError by remember { mutableStateOf<SidebarError?>(null) }
    var instructions by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(emptyList<ChatProjectNote>()) }
    var filter by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<SidebarError?>(null) }
    val scope = rememberCoroutineScope()
    val untitled = stringResource(R.string.sb_untitled)

    LaunchedEffect(project.id, attempt) {
        sidebar.loadProjectSettings(project.id)
            .onSuccess { result ->
                loaded = result
                instructions = result.first.instructions ?: ""
                selected = result.first.notes
            }
            .onFailure { loadError = sidebar.projectSettingsLoadError(it) }
    }

    val save: () -> Unit = save@{
        val current = loaded ?: return@save
        if (busy) return@save
        val changes = projectSettingsChanges(current.first, instructions, selected)
        if (changes == null) {
            onClose()
            return@save
        }
        busy = true
        error = null
        scope.launch {
            val result = sidebar.saveProjectSettings(project.id, changes)
            busy = false
            if (result == null) onClose() else error = result
        }
    }

    // 保存中不让关（网页保存时整个对话框锁住），否则请求结果到了也没人更新侧栏。
    Dialog(onDismissRequest = { if (!busy) onClose() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        LaunchedEffect(window) { window?.setDimAmount(0.2f) }
        Column(
            // 宽：CSS 是 100% − 16，但浏览器 <dialog> 默认 max-width = 100% − 2em − 6px 更窄，412 宽时实际 374（左右各 19）；
            // 高同理不超过视口 − 38。
            Modifier.padding(horizontal = 19.dp).widthIn(max = 544.dp).fillMaxWidth()
                .heightIn(max = (LocalConfiguration.current.screenHeightDp - 38).coerceAtLeast(200).dp)
                .shadow(14.dp, RoundedCornerShape(8.dp), ambientColor = SettingsShadow, spotColor = SettingsShadow)
                .border(1.dp, SettingsRing, RoundedCornerShape(8.dp))
                .clip(RoundedCornerShape(8.dp)).background(Color.White),
        ) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)) {
                Text(stringResource(R.string.sb_project_settings), color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)
                Text(project.name, color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.4.dp))
            }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp)) {
                val data = loaded
                when {
                    loadError != null -> {
                        Text(sidebarErrorText(loadError!!), color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp,
                            modifier = Modifier.padding(top = 12.dp))
                        NotionButton(stringResource(R.string.try_again), onClick = { loadError = null; attempt++ }, modifier = Modifier.padding(top = 8.dp))
                    }
                    data == null -> Row(Modifier.padding(top = 9.6.dp), verticalAlignment = Alignment.CenterVertically) {
                        // animate-spin：每秒转一圈。
                        val spin by rememberInfiniteTransition(label = "settings-loading").animateFloat(
                            0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing), RepeatMode.Restart), label = "spin",
                        )
                        Box(Modifier.rotate(spin)) { LucideIcon(Lucide.LoaderCircle, 14.dp, Sm.Muted) }
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.sb_loading), color = Sm.Muted, fontSize = 13.sp)
                    }
                    else -> {
                        // 共通指示
                        SettingsSectionLabel(stringResource(R.string.sb_instructions), "${instructions.length}/$MAX_PROJECT_INSTRUCTIONS", full = false)
                        SettingsHelpText(stringResource(R.string.sb_instructions_help))
                        InstructionsField(instructions, { instructions = it.take(MAX_PROJECT_INSTRUCTIONS) }, enabled = !busy,
                            label = stringResource(R.string.sb_instructions), placeholder = stringResource(R.string.sb_instructions_placeholder))

                        // 参考笔记
                        val full = selected.size >= MAX_PROJECT_NOTES
                        Spacer(Modifier.size(20.dp))
                        SettingsSectionLabel(stringResource(R.string.sb_reference_notes), "${selected.size}/$MAX_PROJECT_NOTES", full)
                        SettingsHelpText(stringResource(R.string.sb_reference_notes_help))
                        if (selected.isNotEmpty()) {
                            val selectedLabel = stringResource(R.string.sb_selected_notes)
                            FlowRow(
                                Modifier.padding(top = 9.6.dp).semantics { contentDescription = selectedLabel },
                                horizontalArrangement = Arrangement.spacedBy(5.6.dp),
                                verticalArrangement = Arrangement.spacedBy(5.6.dp),
                            ) {
                                selected.forEach { note -> NoteChip(note.title.ifEmpty { untitled }, enabled = !busy) { selected = toggleProjectNote(selected, note) } }
                            }
                        }
                        FilterField(filter, { filter = it }, stringResource(R.string.sb_filter_notes))
                        val listed = filterProjectNotes(data.second, filter, untitled)
                        val ids = selected.mapTo(HashSet()) { it.id }
                        if (listed.isNotEmpty()) {
                            Column(Modifier.padding(top = 6.4.dp).heightIn(max = 176.dp).verticalScroll(rememberScrollState())) {
                                listed.take(MAX_LISTED_NOTES).forEach { page ->
                                    val checked = page.id in ids
                                    NoteOption(page, untitled, checked = checked, blocked = !checked && full, busy = busy) {
                                        selected = toggleProjectNote(selected, page)
                                    }
                                }
                            }
                        } else {
                            EmptyText(stringResource(if (data.second.isNotEmpty()) R.string.sb_no_notes_match else R.string.sb_no_notes_yet))
                        }
                        if (listed.size > MAX_LISTED_NOTES) EmptyText(stringResource(R.string.sb_showing_first_notes, MAX_LISTED_NOTES))
                        if (full) EmptyText(stringResource(R.string.sb_notes_limit, MAX_PROJECT_NOTES))
                    }
                }
                error?.let {
                    Text(sidebarErrorText(it), color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp))
                }
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 1.dp).background(Sm.Border))
            Row(
                Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            ) {
                NotionButton(stringResource(R.string.cancel), onClick = onClose, enabled = !busy)
                NotionButton(
                    stringResource(if (busy) R.string.sb_saving else R.string.save), onClick = save,
                    enabled = !busy && loaded != null, primary = true,
                )
            }
        }
    }
}

// .project-settings-label：14/600，右侧计数 12 灰（满了 #b45309）。
@Composable
internal fun SettingsSectionLabel(text: String, count: String, full: Boolean) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Text(text, Modifier.weight(1f), color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.width(8.dp))
        Text(count, color = if (full) CountFull else Sm.Muted, fontSize = 12.sp, lineHeight = 18.sp)
    }
}

// .project-settings-help：13 / 行高 1.5 灰，上距 4。
@Composable
internal fun SettingsHelpText(text: String) =
    Text(text, color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.5.sp, modifier = Modifier.padding(top = 4.dp))

// .project-settings-empty：13 灰，上距 9.6。
@Composable
private fun EmptyText(text: String) =
    Text(text, color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.5.sp, modifier = Modifier.padding(top = 9.6.dp))

// .project-settings-textarea（手机）：最小高 144、上距 8、1px 深描边、圆角 6、内边距 8.8×11.2、16 / 行高 1.55；聚焦 2px 蓝框。
@Composable
internal fun InstructionsField(value: String, onChange: (String) -> Unit, enabled: Boolean, label: String, placeholder: String) {
    var focused by remember { mutableStateOf(false) }
    BasicTextField(
        value = value,
        onValueChange = onChange,
        enabled = enabled,
        textStyle = TextStyle(color = Sm.Text, fontSize = 16.sp, lineHeight = 24.8.sp),
        cursorBrush = SolidColor(Sm.Text),
        modifier = Modifier.padding(top = 8.dp).fillMaxWidth().onFocusChanged { focused = it.isFocused }.semantics { contentDescription = label },
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxWidth().heightIn(min = 144.dp)
                    .border(if (focused) 2.dp else 1.dp, if (focused) Sm.Blue else Sm.BorderStrong, RoundedCornerShape(6.dp))
                    .padding(horizontal = 11.2.dp, vertical = 8.8.dp),
            ) {
                if (value.isEmpty()) Text(placeholder, color = Sm.Faint, fontSize = 16.sp, lineHeight = 24.8.sp)
                inner()
            }
        },
    )
}

// .project-settings-search：上距 9.6、1px 深描边、圆角 6、左右 9.6、放大镜 14 + 7.2；输入 16、上下 8；聚焦 2px 蓝框。
@Composable
private fun FilterField(value: String, onChange: (String) -> Unit, placeholder: String) {
    var focused by remember { mutableStateOf(false) }
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = TextStyle(color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp),
        cursorBrush = SolidColor(Sm.Text),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        modifier = Modifier.padding(top = 9.6.dp).fillMaxWidth().onFocusChanged { focused = it.isFocused }
            .semantics { contentDescription = placeholder },
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth()
                    .border(if (focused) 2.dp else 1.dp, if (focused) Sm.Blue else Sm.BorderStrong, RoundedCornerShape(6.dp))
                    .padding(horizontal = 9.6.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LucideIcon(Lucide.Search, 14.dp, Sm.Muted)
                Spacer(Modifier.width(7.2.dp))
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(placeholder, color = Sm.Faint, fontSize = 16.sp, lineHeight = 24.sp, maxLines = 1)
                    inner()
                }
            }
        },
    )
}

// .project-settings-chip：全圆角、1px 深描边、#F7F7F5 底、13 字、内边距 2.4/3.2/2.4/8.8；文件图标 13 + 4.8；移除键 28 圆（✕ 12 灰）。
@Composable
private fun NoteChip(title: String, enabled: Boolean, onRemove: () -> Unit) {
    val remove = stringResource(R.string.sb_remove_title, title)
    Row(
        Modifier.border(1.dp, Sm.BorderStrong, CircleShape).clip(CircleShape).background(Sm.Sidebar)
            .padding(start = 8.8.dp, end = 3.2.dp, top = 2.4.dp, bottom = 2.4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LucideIcon(Lucide.FileText, 13.dp, Sm.Text)
        Spacer(Modifier.width(4.8.dp))
        Text(title, Modifier.widthIn(max = 220.dp), color = Sm.Text, fontSize = 13.sp, lineHeight = 19.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.width(4.8.dp))
        Box(
            Modifier.size(28.dp).clip(CircleShape).clickable(enabled = enabled, onClick = onRemove)
                .semantics { contentDescription = remove; role = Role.Button },
            Alignment.Center,
        ) { LucideIcon(Lucide.X, 12.dp, Sm.Muted) }
    }
}

// .project-settings-option（手机）：最小高 44、圆角 6、左右 8、间距 8.8、15 字；勾选框 16（蓝）；图标区 20（表情或文件图标 14 灰）；
// 选中灰底；满了以后没选的变浅灰且不能点。
@Composable
private fun NoteOption(page: ChatProjectNote, untitled: String, checked: Boolean, blocked: Boolean, busy: Boolean, onToggle: () -> Unit) {
    val title = page.title.ifEmpty { untitled }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.dp))
            .background(if (checked) Sm.Hover else Color.Transparent)
            .toggleable(value = checked, enabled = !busy && !blocked, role = Role.Checkbox, onValueChange = { onToggle() })
            .padding(horizontal = 8.dp)
            .semantics { contentDescription = title },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox16(checked, enabled = !busy && !blocked)
        Spacer(Modifier.width(8.8.dp))
        Box(Modifier.width(20.dp), Alignment.Center) {
            if (page.icon != null) Text(page.icon, fontSize = 14.sp) else LucideIcon(Lucide.FileText, 14.dp, Sm.Muted)
        }
        Spacer(Modifier.width(8.8.dp))
        Text(title, Modifier.weight(1f), color = if (blocked) Sm.Faint else Sm.Text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// 浏览器默认勾选框 16×16（accent-color 蓝）：选中蓝底白勾，没选 1px 灰框白底，禁用变淡。
@Composable
private fun Checkbox16(checked: Boolean, enabled: Boolean) {
    val alpha = if (enabled) 1f else 0.5f
    Box(
        Modifier.size(16.dp).clip(RoundedCornerShape(2.dp))
            .background(if (checked) Sm.Blue.copy(alpha = alpha) else Color.White)
            .then(if (checked) Modifier else Modifier.border(1.dp, Color(0xFF767676).copy(alpha = alpha), RoundedCornerShape(2.dp))),
        Alignment.Center,
    ) { if (checked) LucideIcon(Lucide.Check, 12.dp, Color.White) }
}
