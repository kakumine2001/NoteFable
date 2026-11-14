package com.kakumine.studymate.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.studymate.R
import com.kakumine.studymate.data.Proposal
import com.kakumine.studymate.data.ProposalError
import com.kakumine.studymate.data.ProposalState

// AI 的笔记提案卡片（网页 page-edit-proposal.tsx + globals.css 的 .page-edit*）：
//  - 外框：上距 13.6、1px --notion-border-strong、圆角 8；字 13.6 / 行高 1.55；已处理（应用 / 放弃）的卡片透明度 .72；
//  - 标题行：内边距 8×12、--notion-sidebar 底、600、正文色；箭头 14（描边 2，--notion-faint），展开转 90°，图标 14（描边 1.9），间距 7.2；
//    最小化时：上距 8、边框换成 --notion-border、内边距 4×9.6、透明底、12.8 / 500 / 灰色；
//  - 徽标：圆角 4、--notion-hover 底、左右 6.4、灰色 12 / 500；
//  - 正文：最高 352 可滚动、改动之间 9.6、内边距 10.4×12；操作名灰色 12、下距 3.2；
//    改前：红 .1 底、删除线（红 .45）；改后：绿 .14 底；都圆角 4、内边距 4.8×8、下距 3.2；警告 #cb912f 12、上距 2.4；
//  - 错误：#e03e3e，左右 12、下 8；
//  - 按钮行：上边线 --notion-border、内边距 8×12、间距 8；按钮圆角 6、内边距 4×11.2、13.12 / 500、图标 13、间距 4.8；
//    应用键 --sm-ink 底白字；放弃键 1px --notion-border-strong 边框；忙时 .6 透明；链接 --notion-blue 带下划线。

private val CardText = TextStyle(fontSize = 13.6.sp, lineHeight = 21.08.sp, color = Sm.Text, letterSpacing = 0.sp)
private val OpText = TextStyle(fontSize = 12.sp, lineHeight = 18.6.sp, color = Sm.Muted, letterSpacing = 0.sp)
private val BeforeBg = Color(0x1AE03E3E)
private val AfterBg = Color(0x24448361)
private val Warning = Color(0xFFCB912F)
private val ErrorRed = Color(0xFFE03E3E)

/** 提案卡片需要的操作：[onOpen] 打开改动 / 新建的笔记。 */
@Composable
internal fun ProposalCard(
    proposal: Proposal,
    state: ProposalState,
    onApply: () -> Unit,
    onDiscard: () -> Unit,
    onOpen: (String) -> Unit,
) {
    when (proposal) {
        is Proposal.Edit -> Card(
            proposalId = proposal.id,
            state = state,
            icon = Lucide.FilePenLine,
            title = stringResource(R.string.proposal_edit_title, proposal.pageTitle),
            label = stringResource(R.string.proposal_edit_label),
            applyLabel = stringResource(R.string.proposal_apply),
            doneBadge = stringResource(R.string.proposal_applied),
            onApply = onApply,
            onDiscard = onDiscard,
            onOpen = onOpen,
        ) {
            if (proposal.titleBefore != null || proposal.titleAfter != null) {
                Change {
                    Op(stringResource(R.string.proposal_rename))
                    Before(proposal.titleBefore.orEmpty())
                    After(proposal.titleAfter.orEmpty())
                }
            }
            proposal.changes.forEach { change ->
                Change {
                    val op = stringResource(
                        when (change.op) {
                            "insert_after" -> R.string.proposal_op_insert
                            "delete" -> R.string.proposal_op_delete
                            else -> R.string.proposal_op_replace
                        },
                    )
                    Op(
                        if (change.block != 0) stringResource(R.string.proposal_op_block, op, change.block.toString())
                        else stringResource(R.string.proposal_op_start, op),
                    )
                    change.before?.let { Before(it) }
                    change.after?.let { After(it) }
                    if (change.dropsMedia) Note(stringResource(R.string.proposal_drops_media))
                    if (change.dropsFormatting) Note(stringResource(R.string.proposal_drops_formatting))
                }
            }
        }
        is Proposal.Create -> Card(
            proposalId = proposal.id,
            state = state,
            icon = Lucide.FilePlus2,
            title = stringResource(R.string.proposal_new_title, proposal.icon?.let { " $it" }.orEmpty(), proposal.title),
            label = stringResource(R.string.proposal_new_label),
            applyLabel = stringResource(R.string.proposal_create),
            doneBadge = stringResource(R.string.proposal_created),
            onApply = onApply,
            onDiscard = onDiscard,
            onOpen = onOpen,
        ) {
            Change {
                if (proposal.content.isNotEmpty()) After(proposal.content) else Op(stringResource(R.string.proposal_empty_note))
            }
        }
    }
}

@Composable
private fun Card(
    proposalId: String,
    state: ProposalState,
    icon: List<String>,
    title: String,
    label: String,
    applyLabel: String,
    doneBadge: String,
    onApply: () -> Unit,
    onDiscard: () -> Unit,
    onOpen: (String) -> Unit,
    body: @Composable () -> Unit,
) {
    val systemText = rememberSystemText()
    val settled = state.settled
    val busy = state.busy
    // null 表示用户没点过：已处理的卡片默认最小化，待确认的展开。按提案 ID 记住，重建列表也不丢。
    var manual by rememberSaveable(proposalId) { mutableStateOf<Boolean?>(null) }
    // 应用中、有错误时一定展开，结果看得见。
    val open = busy || state.error != null || (manual ?: !settled)
    val badge = when (state.status) {
        ProposalState.Status.Applied -> doneBadge
        ProposalState.Status.Discarded -> stringResource(R.string.proposal_discarded)
        else -> null
    }
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
                Box(Modifier.size(14.dp).rotate(if (open) 90f else 0f)) { LucideIcon(Lucide.ChevronRight, 14.dp, Sm.Faint, strokeWidth = 2f) }
                LucideIcon(icon, 14.dp, headerStyle.color, strokeWidth = 1.9f)
                Text(title, style = headerStyle, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (badge != null) {
                    Text(
                        badge,
                        style = TextStyle(fontSize = 12.sp, lineHeight = 18.6.sp, fontWeight = FontWeight.Medium, color = Sm.Muted, letterSpacing = 0.sp),
                        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Sm.Hover).padding(horizontal = 6.4.dp),
                    )
                }
            }
            if (!open && state.status == ProposalState.Status.Applied && state.pageId != null) {
                Link(stringResource(R.string.proposal_open), 12.48.sp) { onOpen(state.pageId) }
            }
        }
        if (open) {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 352.dp).verticalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 10.4.dp),
                verticalArrangement = Arrangement.spacedBy(9.6.dp),
            ) { body() }
            state.error?.let { error ->
                val text = error.serverMessage?.let(systemText::localize) ?: stringResource(
                    if (error.action == ProposalError.Action.Apply) R.string.proposal_apply_failed else R.string.proposal_discard_failed,
                )
                Text(text, style = CardText.copy(color = ErrorRed), modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp))
            }
            if (!settled) {
                Footer {
                    ActionButton(
                        text = applyLabel,
                        primary = true,
                        busy = busy,
                        spinning = state.status == ProposalState.Status.Applying,
                        icon = Lucide.Check,
                        onClick = onApply,
                    )
                    ActionButton(
                        text = stringResource(R.string.proposal_discard),
                        primary = false,
                        busy = busy,
                        spinning = false,
                        icon = Lucide.X,
                        onClick = onDiscard,
                    )
                }
            }
            if (state.status == ProposalState.Status.Applied && state.pageId != null) {
                Footer { Link(stringResource(R.string.proposal_open_note), 13.6.sp) { onOpen(state.pageId) } }
            }
        }
    }
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
    val color = if (primary) Color.White else Sm.Text
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
