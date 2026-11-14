package com.kakumine.studymate.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import com.kakumine.studymate.R
import com.kakumine.studymate.data.ChatProjectSummary
import com.kakumine.studymate.data.SessionSummary
import kotlinx.coroutines.launch

/** 侧栏里打开的菜单 / 对话框（网页 chat-actions.tsx 的 ChatAction）。[anchor] 是按下的按钮在窗口里的位置。 */
sealed interface ChatAction {
    data class Menu(val session: SessionSummary, val anchor: IntRect) : ChatAction
    data class Rename(val session: SessionSummary) : ChatAction
    data class Move(val session: SessionSummary) : ChatAction
    data class Delete(val session: SessionSummary) : ChatAction
    data object CreateProject : ChatAction
    data class ProjectMenu(val project: ChatProjectSummary, val anchor: IntRect) : ChatAction
    data class ProjectSettings(val project: ChatProjectSummary) : ChatAction
    data class RenameProject(val project: ChatProjectSummary) : ChatAction
    data class DeleteProject(val project: ChatProjectSummary) : ChatAction
}

private val DangerRed = Color(0xFFB91C1C) // .chat-menu-item.is-danger / .notes-delete
private val MenuShadow = Color(0x22000000) // .chat-actions-menu box-shadow 0 8px 32px #0002

/** 显示错误：服务端原句经系统文词典翻译，没有就用网页同一处的 msg() 句子。 */
@Composable
internal fun sidebarErrorText(error: SidebarError): String =
    error.detail?.let { rememberSystemText().localize(it) } ?: stringResource(error.fallback)

@Composable
fun ChatActions(
    action: ChatAction,
    sidebar: SidebarViewModel,
    projects: List<ChatProjectSummary>,
    onAction: (ChatAction) -> Unit,
    onClose: () -> Unit,
) {
    when (action) {
        is ChatAction.Menu -> ActionsMenu(action.anchor, stringResource(R.string.sb_actions_for_title, action.session.title), onClose) {
            MenuItem(stringResource(R.string.sb_rename), Lucide.Pencil) { onAction(ChatAction.Rename(action.session)) }
            MenuItem(stringResource(R.string.move_to_project), Lucide.FolderInput) { onAction(ChatAction.Move(action.session)) }
            // .chat-menu-divider：上下 4.8、左右 8、1px 线。
            Box(Modifier.padding(horizontal = 8.dp, vertical = 4.8.dp).fillMaxWidth().height(1.dp).background(Sm.Border))
            MenuItem(stringResource(R.string.sb_delete_), Lucide.Trash2, danger = true) { onAction(ChatAction.Delete(action.session)) }
        }
        is ChatAction.ProjectMenu -> ActionsMenu(action.anchor, stringResource(R.string.sb_actions_for_name, action.project.name), onClose) {
            MenuItem(stringResource(R.string.sb_project_settings), Lucide.Settings2) { onAction(ChatAction.ProjectSettings(action.project)) }
            MenuItem(stringResource(R.string.rename_project), Lucide.Pencil) { onAction(ChatAction.RenameProject(action.project)) }
            MenuItem(stringResource(R.string.delete_project), Lucide.Trash2, danger = true) { onAction(ChatAction.DeleteProject(action.project)) }
        }
        is ChatAction.Rename -> NameDialog(
            title = stringResource(R.string.sb_rename_chat), initial = action.session.title, maxLength = 120,
            label = stringResource(R.string.sb_chat_name), submit = stringResource(R.string.save), onClose = onClose,
        ) { sidebar.rename(action.session.id, it) }
        is ChatAction.RenameProject -> NameDialog(
            title = stringResource(R.string.rename_project), initial = action.project.name, maxLength = 60,
            label = stringResource(R.string.project_name), submit = stringResource(R.string.save), onClose = onClose,
        ) { sidebar.renameProject(action.project.id, it) }
        ChatAction.CreateProject -> NameDialog(
            title = stringResource(R.string.new_project), initial = "", maxLength = 60,
            label = stringResource(R.string.project_name), submit = stringResource(R.string.create), onClose = onClose,
        ) { sidebar.createProject(it).second }
        is ChatAction.Delete -> DeleteDialog(
            title = stringResource(R.string.sb_delete_chat),
            name = action.session.title,
            body = stringResource(R.string.sb_chat_delete_body),
            onClose = onClose,
        ) { sidebar.delete(action.session.id) }
        is ChatAction.DeleteProject -> DeleteDialog(
            title = stringResource(R.string.delete_project),
            name = action.project.name,
            body = stringResource(R.string.sb_project_delete_body),
            onClose = onClose,
        ) { sidebar.deleteProject(action.project.id) }
        is ChatAction.Move -> MoveDialog(action.session, projects, sidebar, onClose)
        is ChatAction.ProjectSettings -> ProjectSettingsDialog(action.project, sidebar, onClose)
    }
}

// ---------------------------------------------------------------------------------------------
// 行的"更多"菜单（.chat-actions-menu）：宽 228、内边距 5.6、圆角 12、1px 细线、白底、阴影 0 8 32 #0002；
// 位置：按钮下方 4，右边与按钮对齐，离窗口边至少 8（网页 Dialog 的 anchor 定位）。点外面或返回键关闭。

@Composable
private fun ActionsMenu(anchor: IntRect, label: String, onClose: () -> Unit, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val provider = remember(anchor, density) {
        object : PopupPositionProvider {
            override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
                with(density) {
                    val edge = 8.dp.roundToPx()
                    val top = minOf(anchor.bottom + 4.dp.roundToPx(), windowSize.height - 250.dp.roundToPx()).coerceAtLeast(edge)
                    val left = minOf(anchor.right - 228.dp.roundToPx(), windowSize.width - 236.dp.roundToPx()).coerceAtLeast(edge)
                    return IntOffset(left, top)
                }
            }
        }
    }
    Popup(popupPositionProvider = provider, onDismissRequest = onClose, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier.width(228.dp)
                .shadow(16.dp, RoundedCornerShape(12.dp), ambientColor = MenuShadow, spotColor = MenuShadow)
                .border(1.dp, Sm.Border, RoundedCornerShape(12.dp))
                .clip(RoundedCornerShape(12.dp)).background(Color.White)
                .verticalScroll(rememberScrollState())
                .padding(5.6.dp)
                .semantics { contentDescription = label },
        ) { content() }
    }
}

// .chat-menu-item（手机）：最小高 44、内边距 9.6×12、圆角 6.4、图标 16 + 间距 12、14/21；危险项红字。
@Composable
private fun MenuItem(text: String, icon: List<String>, danger: Boolean = false, onClick: () -> Unit) {
    val color = if (danger) DangerRed else Sm.Text
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.4.dp)).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 9.6.dp).semantics { role = Role.Button },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LucideIcon(icon, 16.dp, color)
        Spacer(Modifier.width(12.dp))
        Text(text, color = color, fontSize = 14.sp, lineHeight = 21.sp)
    }
}

// ---------------------------------------------------------------------------------------------
// 对话框（.notes-dialog，与笔记的对话框同一外框 NotesDialog）。和网页 ChatActions 的 run() 一样：
// 一次只跑一个操作，成功关闭；失败留在窗口里显示原因（14 红字、上距 8）。

@Composable
private fun DialogHeading(text: String) =
    Text(text, color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)

@Composable
private fun Feedback(error: SidebarError?) {
    if (error != null) Text(sidebarErrorText(error), color = DangerRed, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 8.dp))
}

/**
 * 一次只跑一个操作的小状态机（网页 run() 的 locked / busy / error）。请求进行中对话框不能关（返回键 / 点遮罩都忽略），
 * 否则协程随对话框取消，服务端已经改了而本地列表没跟着更新。
 */
private class Runner {
    var busy by mutableStateOf(false)
    var error by mutableStateOf<SidebarError?>(null)
}

@Composable
private fun rememberRunner(onClose: () -> Unit): Pair<Runner, (suspend () -> SidebarError?) -> Unit> {
    val runner = remember { Runner() }
    val scope = rememberCoroutineScope()
    val run: (suspend () -> SidebarError?) -> Unit = { work ->
        if (!runner.busy) {
            runner.busy = true
            runner.error = null
            scope.launch {
                val error = work()
                runner.busy = false
                if (error == null) onClose() else runner.error = error
            }
        }
    }
    return runner to run
}

// .notes-dialog-input：上距 12、1px 深描边、圆角 6、内边距 8.8×11.2、16 字；聚焦时 2px 蓝框。超出 maxLength 的输入截掉（网页 maxLength）。
@Composable
internal fun SidebarInput(value: String, onChange: (String) -> Unit, maxLength: Int, label: String, placeholder: String?, onDone: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    BasicTextField(
        value = value,
        onValueChange = { onChange(it.take(maxLength)) },
        singleLine = true,
        textStyle = TextStyle(color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp),
        cursorBrush = SolidColor(Sm.Text),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier = Modifier.padding(top = 12.dp).fillMaxWidth().focusRequester(focus).onFocusChanged { focused = it.isFocused }
            .semantics { contentDescription = label },
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxWidth().border(if (focused) 2.dp else 1.dp, if (focused) Sm.Blue else Sm.BorderStrong, RoundedCornerShape(6.dp))
                    .padding(horizontal = 11.2.dp, vertical = 8.8.dp),
            ) {
                if (value.isEmpty() && placeholder != null) Text(placeholder, color = Sm.Faint, fontSize = 16.sp, lineHeight = 24.sp)
                inner()
            }
        },
    )
}

@Composable
private fun DialogButtons(content: @Composable () -> Unit) {
    // 按钮行（mt-5 flex justify-end gap-2）。
    Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) { content() }
}

/** 改名 / 新建项目：标题 + 输入框 + 取消 / 保存（或创建）。聊天名最多 120 字，项目名 60 字。 */
@Composable
private fun NameDialog(
    title: String,
    initial: String,
    maxLength: Int,
    label: String,
    submit: String,
    onClose: () -> Unit,
    work: suspend (String) -> SidebarError?,
) {
    var value by remember { mutableStateOf(initial) }
    val (runner, run) = rememberRunner(onClose)
    val save = { if (value.isNotBlank()) run { work(value) } }
    NotesDialog({ if (!runner.busy) onClose() }) {
        DialogHeading(title)
        SidebarInput(value, { value = it }, maxLength, label, null, save)
        Feedback(runner.error)
        DialogButtons {
            NotionButton(stringResource(R.string.cancel), onClick = onClose, enabled = !runner.busy)
            NotionButton(submit, onClick = save, enabled = !runner.busy && value.isNotBlank(), primary = true)
        }
    }
}

/** 删除聊天 / 项目：标题"删除“名称”？" + 说明 + 取消 / 删除（红字）。 */
@Composable
private fun DeleteDialog(title: String, name: String, body: String, onClose: () -> Unit, work: suspend () -> SidebarError?) {
    val (runner, run) = rememberRunner(onClose)
    NotesDialog({ if (!runner.busy) onClose() }) {
        Box(Modifier.semantics { contentDescription = title })
        DialogHeading(stringResource(R.string.sb_delete_name_q, name))
        Text(body, color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 8.dp))
        Feedback(runner.error)
        DialogButtons {
            NotionButton(stringResource(R.string.cancel), onClick = onClose, enabled = !runner.busy)
            NotionButton(stringResource(R.string.sb_delete_), onClick = { run(work) }, enabled = !runner.busy, danger = true)
        }
    }
}

/**
 * 移到项目（网页 ChatActions 的 move）：标题"将“…”移到"，选项"无项目" + 各项目（当前所在的打 ✓），
 * 下面"＋ 新项目"展开成输入框 + "创建并移动"；建好项目但移动失败时项目留着，可以从列表里再选。
 */
@Composable
private fun MoveDialog(session: SessionSummary, projects: List<ChatProjectSummary>, sidebar: SidebarViewModel, onClose: () -> Unit) {
    val (runner, run) = rememberRunner(onClose)
    var creating by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    val createAndMove = {
        if (name.isNotBlank()) run {
            val (project, error) = sidebar.createProject(name)
            if (project == null) error
            else {
                creating = false
                sidebar.moveToProject(session.id, project.id)
            }
        }
    }
    NotesDialog({ if (!runner.busy) onClose() }) {
        DialogHeading(stringResource(R.string.move_note_to, session.title))
        // .chat-project-options：上距 12。
        Column(Modifier.padding(top = 12.dp)) {
            val options = listOf<Pair<String?, String>>(null to stringResource(R.string.no_project)) + projects.map { it.id to it.name }
            options.forEach { (id, label) ->
                OptionRow(label, enabled = !runner.busy, checked = session.projectId == id) {
                    run { sidebar.moveToProject(session.id, id) }
                }
            }
        }
        if (creating) {
            SidebarInput(name, { name = it }, 60, stringResource(R.string.new_project_name), stringResource(R.string.project_name), createAndMove)
            NotionButton(
                stringResource(R.string.create_and_move), onClick = createAndMove, enabled = !runner.busy && name.isNotBlank(),
                primary = true, modifier = Modifier.padding(top = 8.dp),
            )
        } else {
            OptionRow(stringResource(R.string.sb_new_project_plus), enabled = !runner.busy, checked = false) {
                name = ""
                creating = true
            }
        }
        Feedback(runner.error)
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.End) {
            NotionButton(stringResource(R.string.cancel), onClick = onClose, enabled = !runner.busy)
        }
    }
}

// .notes-dialog-option：最小高 40、圆角 6、左右 9.6、15 字；当前所在的项目右边 ✓ 16（聊天的移动窗口不加灰底）。
@Composable
private fun OptionRow(label: String, enabled: Boolean, checked: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(6.dp)).clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 9.6.dp).semantics { role = Role.Button },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.weight(1f), color = Sm.Text.copy(alpha = if (enabled) 1f else 0.6f), fontSize = 15.sp,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (checked) LucideIcon(Lucide.Check, 16.dp, Sm.Text)
    }
}
