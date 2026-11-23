package com.kakumine.notefable.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.NotePageSettings
import com.kakumine.notefable.data.NotePageSummary
import kotlin.math.roundToInt

/** 笔记顶栏"…"菜单的操作（网页 note-page-menu.tsx）。 */
class NotePageMenuActions(
    val error: NotesError?,
    val busy: Boolean,
    val onSettings: (NotePageSettings) -> Unit,
    val onFavorite: (Boolean) -> Unit,
    val onDuplicate: () -> Unit,
    val onAddInside: () -> Unit,
    val onMove: () -> Unit,
    /** "Export Markdown"：把这一篇存成 .md 文件。 */
    val onExport: () -> Unit,
    val onTrash: () -> Unit,
)

private val MenuDivider: Color get() = Sm.Border

// 网页上部栏的"…"（.notes-page-menu = .chat-actions-menu 宽 248）：
// "Style" 小标题（12/500 灰，内边距 5.6/12/2.4）；三个字体按钮（三等分、间距 4、外边距 4/8/5.6；每个上下 6.4、圆角 6.4；
// "Ag" 22、标签 12 灰，选中的蓝色）；分隔线（上下 4.8、左右 8）；Small text / Full width / Lock page 三个开关（右侧 26×14 的开关）；
// 分隔线；收藏、复制、添加子页面、移动到、导出 Markdown（Download 16）；分隔线；移到回收站（红字）。
// 项目按页面类型出（[PageKindFeatures]，网页 PAGE_KIND_FEATURES）：白板、幻灯片没有 Style 到 Full width 这一段和导出 Markdown，
// 从 Lock page 开始（服务端也拒绝这些操作）。
@Composable
fun NotePageMenuButton(page: NotePageSummary, actions: NotePageMenuActions) {
    var anchor by remember { mutableStateOf<IntRect?>(null) }
    var open by remember { mutableStateOf(false) }
    val label = stringResource(R.string.pg_page_options)
    val features = page.kind.features
    Box(
        Modifier.onGloballyPositioned { coords ->
            val b = coords.boundsInWindow()
            anchor = IntRect(b.left.roundToInt(), b.top.roundToInt(), b.right.roundToInt(), b.bottom.roundToInt())
        },
    ) {
        TopIconButton(Lucide.Ellipsis, label, { if (!actions.busy) open = true })
    }
    val at = anchor
    if (open && at != null) {
        val close = { open = false }
        // 选了操作先关菜单再执行（和网页 run() 一样，不和对话框、换页叠在一起）；开关留在菜单里。
        fun run(action: () -> Unit): () -> Unit = { close(); action() }
        ActionsMenu(at, label, close, width = 248.dp) {
            if (features.typography) {
                Text(stringResource(R.string.pg_style), color = Sm.Muted, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 5.6.dp, bottom = 2.4.dp))
                Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 5.6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf(
                        Triple("default", R.string.pg_font_default, FontFamily.Default),
                        Triple("serif", R.string.pg_font_serif, FontFamily.Serif),
                        Triple("mono", R.string.pg_font_mono, FontFamily.Monospace),
                    ).forEach { (key, name, family) ->
                        val checked = page.font == key
                        val color = if (checked) Sm.Blue else Sm.Muted
                        Column(
                            Modifier.weight(1f).clip(RoundedCornerShape(6.4.dp)).clickable { actions.onSettings(NotePageSettings(font = key)) }
                                .padding(vertical = 6.4.dp, horizontal = 4.dp).semantics { role = Role.RadioButton; selected = checked },
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text("Ag", color = if (checked) Sm.Blue else Sm.Text, fontSize = 22.sp, lineHeight = 26.4.sp, fontFamily = family)
                            Text(stringResource(name), color = color, fontSize = 12.sp, lineHeight = 16.sp)
                        }
                    }
                }
                Divider()
                ToggleItem(stringResource(R.string.pg_small_text), null, page.smallText) { actions.onSettings(NotePageSettings(smallText = !page.smallText)) }
                ToggleItem(stringResource(R.string.pg_full_width), null, page.fullWidth) { actions.onSettings(NotePageSettings(fullWidth = !page.fullWidth)) }
            }
            ToggleItem(stringResource(R.string.pg_lock_page), Lucide.Lock, page.locked) { actions.onSettings(NotePageSettings(locked = !page.locked)) }
            Divider()
            val favorite = page.favoritedAt != null
            MenuItem(stringResource(if (favorite) R.string.pg_remove_from_favorites else R.string.pg_add_to_favorites), if (favorite) Lucide.StarOff else Lucide.Star,
                onClick = run { actions.onFavorite(!favorite) })
            MenuItem(stringResource(R.string.pg_duplicate), Lucide.Copy, onClick = run(actions.onDuplicate))
            MenuItem(stringResource(R.string.pg_add_page_inside), Lucide.FilePlus2, onClick = run(actions.onAddInside))
            MenuItem(stringResource(R.string.pg_move_to), Lucide.FolderInput, onClick = run(actions.onMove))
            if (features.markdownExport) MenuItem(stringResource(R.string.export_markdown), Lucide.Download, onClick = run(actions.onExport))
            Divider()
            MenuItem(stringResource(R.string.move_to_trash), Lucide.Trash2, danger = true, onClick = run(actions.onTrash))
            actions.error?.let {
                // .answer-menu-error：上下 5.6、左右 12、13/18.2、#933b34。
                Text(notesErrorText(it), color = Sm.ErrorText, fontSize = 13.sp, lineHeight = 18.2.sp,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.6.dp))
            }
        }
    }
}

@Composable
private fun Divider() {
    Box(Modifier.padding(horizontal = 8.dp, vertical = 4.8.dp).fillMaxWidth().height(1.dp).background(MenuDivider))
}

// 开关项（.chat-menu-item + .notes-menu-switch）：和 MenuItem 同样的行；右边 26×14 的圆角开关，
// 关是 rgba(55,53,47,.2)、开是蓝色，里面 10 的白点（开时右移 12）。
@Composable
private fun ToggleItem(text: String, icon: List<String>?, checked: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.4.dp)).clickable(onClick = onToggle)
            .padding(horizontal = 12.dp, vertical = 9.6.dp)
            .semantics { role = Role.Switch; toggleableState = if (checked) ToggleableState.On else ToggleableState.Off },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            LucideIcon(icon, 16.dp, Sm.Text)
            Spacer(Modifier.width(12.dp))
        }
        Text(text, color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.weight(1f))
        Box(
            Modifier.size(26.dp, 14.dp).clip(CircleShape).background(if (checked) Sm.Blue else Sm.pick(Color(0x3337352F), Color(0x3DFFFFFF))),
        ) {
            Box(Modifier.offset(x = if (checked) 14.dp else 2.dp, y = 2.dp).size(10.dp).clip(CircleShape).background(Color.White))
        }
    }
}
