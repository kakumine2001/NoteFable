package com.kakumine.notefable.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.kakumine.notefable.BuildConfig
import com.kakumine.notefable.R
import com.kakumine.notefable.data.NoteIcons
import com.kakumine.notefable.data.PageKind
import com.kakumine.notefable.data.Proposal
import com.kakumine.notefable.data.ProposalChange
import com.kakumine.notefable.data.ProposalError
import com.kakumine.notefable.data.ProposalState
import com.kakumine.notefable.data.ProposalTarget
import com.kakumine.notefable.data.ReportTarget

// AI 的页面提案卡片（网页 page-proposal.tsx + globals.css 的 .page-edit*）。笔记、白板、幻灯片共用这一张卡片，
// 改前 / 改后（文字和缩略图）直接显示服务端适配器给的 changes，按页面类型只换图标、标题和按钮的文字：
//  - 外框：上距 13.6、1px --notion-border-strong、圆角 8；字 13.6 / 行高 1.55；已处理（应用 / 放弃 / 撤销）的卡片透明度 .72；
//  - 标题行：内边距 8×12、--notion-sidebar 底、600、正文色；箭头 14（描边 2，--notion-faint），展开转 90°，图标 14（描边 1.9），间距 7.2；
//    右端是 24 的旗子按钮（.page-edit-report：Flag 13、描边 1.9、--notion-faint、圆角 4），打开"报告 AI 内容"；
//    最小化时：上距 8、边框换成 --notion-border、内边距 4×9.6、透明底、12.8 / 500 / 灰色，能打开时旗子前有 12.48 的"打开"；
//  - 徽标：圆角 4、--notion-hover 底、左右 6.4、灰色 12 / 500；
//  - 正文：最高 352 可滚动、改动之间 9.6、内边距 10.4×12；操作名灰色 12、下距 3.2；
//    改前：红 .1 底、删除线（红 .45）；改后：绿 .14 底；都圆角 4、内边距 4.8×8、下距 3.2；警告 #cb912f 12、上距 2.4；
//    缩略图（.page-edit-images，白板 / 幻灯片）：改前 / 改后并排（auto-fit 的 minmax(128, 1fr)：放不下两张时上下排）、间距 6.4、下距 3.2；
//    每张宽占满、最高 176、等比缩放（contain）、1px 边框（改前红 .45、改后绿 .55）、圆角 4、--notion-sidebar 底；
//  - 错误：#e03e3e，左右 12、下 8；
//  - 按钮行：上边线 --notion-border、内边距 8×12、间距 8；按钮圆角 6、内边距 4×11.2、13.12 / 500、图标 13、间距 4.8；
//    应用键 --nf-ink 底白字；放弃 / 撤销键 1px --notion-border-strong 边框；忙时 .6 透明；链接 --notion-blue 带下划线；
//  - 撤销了新建的页面：按钮行换成一行说明（.page-edit-note.page-edit-footnote：#cb912f 12、左右 12、下 8）。

private val CardText get() = TextStyle(fontSize = 13.6.sp, lineHeight = 21.08.sp, color = Sm.Text, letterSpacing = 0.sp)
private val OpText get() = TextStyle(fontSize = 12.sp, lineHeight = 18.6.sp, color = Sm.Muted, letterSpacing = 0.sp)
private val BeforeBg: Color get() = Sm.pick(Color(0x1AE03E3E), Color(0x29F87171)) // 深色 rgba(248,113,113,.16)
private val AfterBg: Color get() = Sm.pick(Color(0x24448361), Color(0x2934D399)) // 深色 rgba(52,211,153,.16)
private val BeforeImageBorder = Color(0x73E03E3E) // rgba(224,62,62,.45)，深色相同
private val AfterImageBorder = Color(0x8C448361) // rgba(68,131,97,.55)，深色相同
private val Warning = Color(0xFFCB912F)
private val ErrorRed: Color get() = Sm.pick(Color(0xFFE03E3E), Sm.Danger)

/** 两张缩略图并排要的最小宽度：网页 minmax(8rem, 1fr) 两列加间距。 */
private val TwoThumbnailsWidth = (128 * 2 + 6.4).dp

/** 提案卡片需要的操作：[onOpen] 打开改动 / 新建的页面，[onUndo] 撤销已应用的提案。 */
@Composable
internal fun ProposalCard(
    proposal: Proposal,
    state: ProposalState,
    onApply: () -> Unit,
    onDiscard: () -> Unit,
    onUndo: () -> Unit,
    onOpen: (String) -> Unit,
) {
    val kind = proposal.pageKind
    val note = kind == PageKind.Note
    val openLabel = stringResource(if (note) R.string.proposal_open_note else R.string.proposal_open_page)
    val actions = CardActions(onApply, onDiscard, onUndo, onOpen)
    when (proposal) {
        is Proposal.Edit -> Card(
            proposal = proposal,
            state = state,
            icon = if (note) Lucide.FilePenLine else pageKindIcon(kind),
            title = stringResource(R.string.proposal_edit_title, proposal.pageTitle),
            label = stringResource(if (note) R.string.proposal_edit_label else R.string.proposal_edit_page_label),
            applyLabel = stringResource(R.string.proposal_apply),
            doneBadge = stringResource(if (proposal.autoApplied) R.string.proposal_applied_auto else R.string.proposal_applied),
            openLabel = openLabel,
            actions = actions,
        ) {
            if (proposal.titleBefore != null || proposal.titleAfter != null) {
                Change {
                    Op(stringResource(R.string.proposal_rename))
                    Before(proposal.titleBefore.orEmpty())
                    After(proposal.titleAfter.orEmpty())
                }
            }
            proposal.changes.forEach { ChangeItem(it, kind) }
        }
        is Proposal.Create -> Card(
            proposal = proposal,
            state = state,
            icon = if (note) Lucide.FilePlus2 else pageKindIcon(kind),
            title = when (kind) {
                PageKind.Whiteboard -> stringResource(R.string.proposal_new_whiteboard_title, proposal.title)
                PageKind.Slides -> stringResource(R.string.proposal_new_slides_title, proposal.title)
                // 上传的图片图标放不进标题，只放表情（网页 noteIconText）。
                PageKind.Note -> stringResource(
                    R.string.proposal_new_title,
                    NoteIcons.text(proposal.icon)?.takeIf { it.isNotEmpty() }?.let { " $it" }.orEmpty(),
                    proposal.title,
                )
            },
            label = stringResource(if (note) R.string.proposal_new_label else R.string.proposal_new_page_label),
            applyLabel = stringResource(
                when (kind) {
                    PageKind.Whiteboard -> R.string.proposal_create_whiteboard
                    PageKind.Slides -> R.string.proposal_create_slides
                    PageKind.Note -> R.string.proposal_create
                },
            ),
            doneBadge = stringResource(if (proposal.autoApplied) R.string.proposal_created_auto else R.string.proposal_created),
            openLabel = openLabel,
            actions = actions,
        ) {
            // 建成子页面时，先说建在哪一页里（标题是空的显示 Untitled）。
            proposal.parentTitle?.let { parent -> Op(stringResource(R.string.proposal_inside, parent.ifEmpty { stringResource(R.string.sb_untitled) })) }
            Change {
                if (proposal.content.isNotEmpty()) After(proposal.content)
                else Op(stringResource(if (note) R.string.proposal_empty_note else R.string.proposal_empty_page))
            }
            proposal.changes.forEach { ChangeItem(it, kind) }
        }
    }
}

private class CardActions(
    val onApply: () -> Unit,
    val onDiscard: () -> Unit,
    val onUndo: () -> Unit,
    val onOpen: (String) -> Unit,
)

@Composable
private fun Card(
    proposal: Proposal,
    state: ProposalState,
    icon: List<String>,
    title: String,
    label: String,
    applyLabel: String,
    doneBadge: String,
    openLabel: String,
    actions: CardActions,
    body: @Composable () -> Unit,
) {
    val systemText = rememberSystemText()
    val settled = state.settled
    val busy = state.busy
    // null 表示用户没点过：已处理的卡片默认最小化，待确认的展开。按提案 ID 记住，重建列表也不丢。
    var manual by rememberSaveable(proposal.id) { mutableStateOf<Boolean?>(null) }
    var reporting by remember { mutableStateOf(false) }
    // 处理中、有错误时一定展开，结果看得见。
    val open = busy || state.error != null || (manual ?: !settled)
    val badge = when (state.status) {
        ProposalState.Status.Applied -> doneBadge
        ProposalState.Status.Discarded -> stringResource(R.string.proposal_discarded)
        ProposalState.Status.Undone -> stringResource(R.string.proposal_undone)
        else -> null
    }
    // "打开"的目标：已应用的页面，或撤销了的编辑（页面还在，内容回到应用前）。撤销了的新建页面在回收站里，不能打开。
    val openPage = state.pageId?.takeIf {
        state.status == ProposalState.Status.Applied || (state.status == ProposalState.Status.Undone && proposal is Proposal.Edit)
    }
    // 撤销键：服务端说能撤销、或刚在这里应用过；撤销中转圈。
    val showUndo = state.status == ProposalState.Status.Undoing || (state.status == ProposalState.Status.Applied && state.undoable)
    val shape = RoundedCornerShape(8.dp)
    val toggleLabel = stringResource(if (open) R.string.proposal_minimize else R.string.proposal_expand)

    Column(
        Modifier.padding(top = if (open) 13.6.dp else 8.dp).fillMaxWidth()
            .alpha(if (settled) 0.72f else 1f)
            .clip(shape)
            .border(1.dp, if (open) Sm.BorderStrong else Sm.Border, shape)
            .semantics { contentDescription = label },
    ) {
        Row(
            Modifier.fillMaxWidth()
                .then(if (open) Modifier.background(Sm.Sidebar) else Modifier)
                .padding(horizontal = if (open) 12.dp else 9.6.dp, vertical = if (open) 8.dp else 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.2.dp),
        ) {
            val headerStyle = if (open) CardText.copy(fontWeight = FontWeight.SemiBold)
            else CardText.copy(fontSize = 12.8.sp, lineHeight = 19.84.sp, fontWeight = FontWeight.Medium, color = Sm.Muted)
            Row(
                Modifier.weight(1f).clickable(role = Role.Button, onClickLabel = toggleLabel) { manual = !open },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.2.dp),
            ) {
                val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
                Box(Modifier.size(14.dp).rotate(if (open) (if (rtl) -90f else 90f) else 0f)) { LucideIcon(Lucide.ChevronRight, 14.dp, Sm.Faint, strokeWidth = 2f) }
                // 笔记的 FilePenLine / FilePlus2 描边 1.9；白板、幻灯片用页面类型图标（网页 PageKindIcon，lucide 默认 2）。
                LucideIcon(icon, 14.dp, headerStyle.color, strokeWidth = if (proposal.pageKind == PageKind.Note) 1.9f else 2f)
                Text(title, style = headerStyle, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (badge != null) {
                    Text(
                        badge,
                        style = TextStyle(fontSize = 12.sp, lineHeight = 18.6.sp, fontWeight = FontWeight.Medium, color = Sm.Muted, letterSpacing = 0.sp),
                        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Sm.Hover).padding(horizontal = 6.4.dp),
                    )
                }
            }
            if (!open && openPage != null) {
                Link(stringResource(R.string.proposal_open), 12.48.sp) { actions.onOpen(openPage) }
            }
            // AI 生成的内容，卡片上也能报告（Google Play 的 AI 生成内容政策）。
            ReportButton { reporting = true }
        }
        if (open) {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 352.dp).verticalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 10.4.dp),
                verticalArrangement = Arrangement.spacedBy(9.6.dp),
            ) { body() }
            state.error?.let { error ->
                val text = error.serverMessage?.let(systemText::localize) ?: stringResource(
                    when (error.action) {
                        ProposalError.Action.Apply -> R.string.proposal_apply_failed
                        ProposalError.Action.Discard -> R.string.proposal_discard_failed
                        ProposalError.Action.Undo -> R.string.proposal_undo_failed
                    },
                )
                Text(text, style = CardText.copy(color = ErrorRed), modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp))
            }
            if (state.pending) {
                Footer {
                    ActionButton(
                        text = applyLabel,
                        primary = true,
                        busy = busy,
                        spinning = state.status == ProposalState.Status.Applying,
                        icon = Lucide.Check,
                        onClick = actions.onApply,
                    )
                    ActionButton(
                        text = stringResource(R.string.proposal_discard),
                        primary = false,
                        busy = busy,
                        spinning = false,
                        icon = Lucide.X,
                        onClick = actions.onDiscard,
                    )
                }
            }
            if (openPage != null || showUndo) {
                Footer {
                    if (openPage != null) Link(openLabel, 13.6.sp) { actions.onOpen(openPage) }
                    if (showUndo) {
                        ActionButton(
                            text = stringResource(R.string.proposal_undo),
                            primary = false,
                            busy = busy,
                            spinning = state.status == ProposalState.Status.Undoing,
                            icon = Lucide.Undo2,
                            onClick = actions.onUndo,
                        )
                    }
                }
            }
            if (state.status == ProposalState.Status.Undone && proposal is Proposal.Create) {
                Text(
                    stringResource(R.string.proposal_moved_to_trash),
                    style = OpText.copy(color = Warning),
                    modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
                )
            }
        }
    }
    if (reporting) ReportDialog(ReportTarget.Proposal(proposal.id), onClose = { reporting = false })
}

@Composable
private fun ReportButton(onClick: () -> Unit) {
    val label = stringResource(R.string.proposal_report)
    Box(
        Modifier.size(24.dp).clip(RoundedCornerShape(4.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        Alignment.Center,
    ) { LucideIcon(FlagIcon, 13.dp, Sm.Faint, strokeWidth = 1.9f) }
}

@Composable
private fun Footer(content: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .drawBehind { drawLine(Sm.Border, Offset(0f, 0.5.dp.toPx()), Offset(size.width, 0.5.dp.toPx()), 1.dp.toPx()) }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) { content() }
}

@Composable
private fun ActionButton(text: String, primary: Boolean, busy: Boolean, spinning: Boolean, icon: List<String>, onClick: () -> Unit) {
    val shape = RoundedCornerShape(6.dp)
    val color = if (primary) Sm.OnInk else Sm.Text
    Row(
        Modifier.alpha(if (busy) 0.6f else 1f).clip(shape)
            .then(if (primary) Modifier.background(Sm.Ink) else Modifier.border(1.dp, Sm.BorderStrong, shape))
            .clickable(enabled = !busy, role = Role.Button, onClick = onClick)
            .padding(horizontal = 11.2.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.8.dp),
    ) {
        if (spinning) Spinner(13.dp, color, strokeWidth = 2f) else LucideIcon(icon, 13.dp, color, strokeWidth = 2f)
        Text(text, style = TextStyle(fontSize = 13.12.sp, lineHeight = 20.34.sp, fontWeight = FontWeight.Medium, color = color, letterSpacing = 0.sp))
    }
}

@Composable
private fun Link(text: String, size: androidx.compose.ui.unit.TextUnit, onClick: () -> Unit) {
    Text(
        text,
        style = CardText.copy(fontSize = size, color = Sm.Blue, textDecoration = TextDecoration.Underline),
        modifier = Modifier.clickable(role = Role.Button, onClick = onClick),
    )
}

/** 一处改动：操作名（对象）、缩略图、改前、改后、警告（网页 page-proposal.tsx 的 Change）。 */
@Composable
private fun ChangeItem(change: ProposalChange, kind: PageKind) {
    Change {
        Op(changeLabel(change, kind))
        Thumbnails(change.beforeImage, change.afterImage)
        change.before?.let { Before(it) }
        change.after?.let { After(it) }
        if (change.dropsMedia) Note(stringResource(R.string.proposal_drops_media))
        if (change.dropsFormatting) Note(stringResource(R.string.proposal_drops_formatting))
    }
}

// 变动的标题（操作和对象，网页 changeLabel）：幻灯片是第几张，白板是元素（一个时是它的文字），笔记是块编号；
// 其它类型没有对象时只有操作名。
@Composable
private fun changeLabel(change: ProposalChange, kind: PageKind): String {
    val op = stringResource(opLabel(change.op))
    return when (val target = change.target) {
        is ProposalTarget.Slide -> stringResource(R.string.proposal_op_slide, op, target.number.toString())
        is ProposalTarget.Elements -> target.name?.takeIf { it.isNotEmpty() }?.let { stringResource(R.string.proposal_op_named, op, it) }
            ?: stringResource(R.string.proposal_op_elements, op, target.count.toString())
        null -> when {
            kind != PageKind.Note -> op
            change.block != 0 -> stringResource(R.string.proposal_op_block, op, change.block.toString())
            else -> stringResource(R.string.proposal_op_start, op)
        }
    }
}

@StringRes
private fun opLabel(op: String): Int = when (op) {
    "replace" -> R.string.proposal_op_replace
    "insert_after" -> R.string.proposal_op_insert
    "delete" -> R.string.proposal_op_delete
    "add" -> R.string.proposal_op_add
    "move" -> R.string.proposal_op_move
    "reorder" -> R.string.proposal_op_reorder
    else -> R.string.proposal_op_update
}

// 改前 / 改后的缩略图：同源的 /api/proposals/:id/image，带登录 Cookie 读（Coil 共用 App 的 OkHttp，服务端核对归属）。
@Composable
private fun Thumbnails(before: String?, after: String?) {
    if (before == null && after == null) return
    val beforeLabel = stringResource(R.string.proposal_before)
    val afterLabel = stringResource(R.string.proposal_after)
    BoxWithConstraints(Modifier.fillMaxWidth().padding(bottom = 3.2.dp)) {
        if (before != null && after != null && maxWidth >= TwoThumbnailsWidth) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.4.dp)) {
                Thumbnail(before, beforeLabel, BeforeImageBorder, Modifier.weight(1f))
                Thumbnail(after, afterLabel, AfterImageBorder, Modifier.weight(1f))
            }
        } else {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.4.dp)) {
                before?.let { Thumbnail(it, beforeLabel, BeforeImageBorder, Modifier.fillMaxWidth()) }
                after?.let { Thumbnail(it, afterLabel, AfterImageBorder, Modifier.fillMaxWidth()) }
            }
        }
    }
}

@Composable
private fun Thumbnail(path: String, description: String, border: Color, modifier: Modifier) {
    val shape = RoundedCornerShape(4.dp)
    AsyncImage(
        model = BuildConfig.BASE_URL.trimEnd('/') + path,
        contentDescription = description,
        contentScale = ContentScale.Fit,
        modifier = modifier.heightIn(max = 176.dp).clip(shape).background(Sm.Sidebar).border(1.dp, border, shape),
    )
}

@Composable
private fun Change(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth()) { content() }
}

@Composable
private fun Op(text: String) {
    Text(text, style = OpText, modifier = Modifier.padding(bottom = 3.2.dp))
}

@Composable
private fun Before(text: String) {
    Text(
        text,
        style = CardText.copy(textDecoration = TextDecoration.LineThrough),
        modifier = Modifier.padding(bottom = 3.2.dp).fillMaxWidth().clip(RoundedCornerShape(4.dp)).background(BeforeBg)
            .padding(horizontal = 8.dp, vertical = 4.8.dp),
    )
}

@Composable
private fun After(text: String) {
    Text(
        text,
        style = CardText,
        modifier = Modifier.padding(bottom = 3.2.dp).fillMaxWidth().clip(RoundedCornerShape(4.dp)).background(AfterBg)
            .padding(horizontal = 8.dp, vertical = 4.8.dp),
    )
}

@Composable
private fun Note(text: String) {
    Text(text, style = OpText.copy(color = Warning), modifier = Modifier.padding(top = 2.4.dp))
}
