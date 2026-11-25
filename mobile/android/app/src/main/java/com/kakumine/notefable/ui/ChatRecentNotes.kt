package com.kakumine.notefable.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ChatProjectNote
import com.kakumine.notefable.data.MAX_MESSAGE_NOTES
import com.kakumine.notefable.data.NotePageSummary

@Composable
internal fun ChatRecentNotes(
    pages: List<NotePageSummary>,
    selected: List<ChatProjectNote>,
    enabled: Boolean,
    onToggle: (ChatProjectNote) -> Unit,
    onOpen: (String) -> Unit,
    onViewAll: () -> Unit,
) {
    val recent = remember(pages) { pages.sortedByDescending { it.updatedAt }.take(4) }
    Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.recently_edited), color = Sm.Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Row(Modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onViewAll).padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.all_notes), color = Sm.Muted, fontSize = 13.sp)
                LucideIcon(Lucide.ChevronRight, 14.dp, Sm.Muted)
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 3.2.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (page in recent) {
                val title = page.title.ifEmpty { stringResource(R.string.sb_untitled) }
                val attached = selected.any { it.id == page.id }
                val canToggle = enabled && (attached || selected.size < MAX_MESSAGE_NOTES)
                val shape = RoundedCornerShape(14.4.dp)
                val hasCover = com.kakumine.notefable.data.NoteCovers.preset(page.cover) != null || com.kakumine.notefable.data.NoteCovers.imagePath(page.cover) != null
                Box {
                    Column(
                        Modifier.width(152.dp).heightIn(min = 101.dp).alpha(if (canToggle) 1f else .55f)
                            .shadow(1.dp, shape).clip(shape).background(Sm.Surface)
                            .background(if (attached) Sm.AccentSoft else Color.Transparent)
                            .border(1.dp, if (attached) Sm.AccentLine else Sm.Border, shape)
                            .toggleable(value = attached, enabled = canToggle, role = Role.Checkbox) {
                                onToggle(ChatProjectNote(page.id, page.title, page.icon, page.kind))
                            },
                    ) {
                        if (hasCover) {
                            Box(Modifier.fillMaxWidth().height(32.dp)) {
                                NoteCoverBanner(page.cover, page.coverPosition, page.kind, Modifier.fillMaxSize())
                                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(1.dp).background(Sm.Border))
                            }
                        }
                        Column(
                            Modifier.fillMaxWidth().padding(start = 13.dp, end = 13.dp, top = if (hasCover) 0.dp else 11.dp, bottom = 11.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            val iconBg = if (hasCover) Sm.Surface else if (page.icon != null) Sm.Hover else pageKindSoft(page.kind)
                            val iconMod = if (hasCover) Modifier.offset(y = (-16).dp).size(32.dp).clip(RoundedCornerShape(8.dp)).background(iconBg).border(1.dp, Sm.Border, RoundedCornerShape(8.dp))
                            else Modifier.size(32.dp).background(iconBg, RoundedCornerShape(8.dp))
                            Box(iconMod, contentAlignment = Alignment.Center) {
                                NoteIcon(page.icon, 16.sp, 17.dp, pageKindColor(page.kind), page.kind)
                            }
                            Text(title, color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold,
                                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = if (hasCover) Modifier.offset(y = (-12).dp) else Modifier)
                            Row(
                                modifier = if (hasCover) Modifier.offset(y = (-12).dp) else Modifier,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                if (attached) LucideIcon(Lucide.Check, 12.dp, Sm.Muted)
                                Text(stringResource(if (attached) R.string.note_attached else R.string.attach_pages_submit),
                                    color = Sm.Muted, fontSize = 12.sp, lineHeight = 18.sp)
                            }
                        }
                    }
                    val openLabel = stringResource(R.string.open_note_title, title)
                    if (hasCover) {
                        Box(Modifier.align(Alignment.TopEnd).padding(5.dp).size(26.dp).clip(androidx.compose.foundation.shape.CircleShape)
                            .background(Sm.Surface.copy(alpha = 0.86f)).border(1.dp, Sm.Border, androidx.compose.foundation.shape.CircleShape)
                            .clickable(role = Role.Button) { onOpen(page.id) }.semantics { contentDescription = openLabel },
                            contentAlignment = Alignment.Center) {
                            LucideIcon(Lucide.ArrowUpRight, 14.dp, Sm.Muted)
                        }
                    } else {
                        Box(Modifier.align(Alignment.TopEnd).padding(1.dp).size(48.dp).clip(RoundedCornerShape(12.dp))
                            .clickable(role = Role.Button) { onOpen(page.id) }.semantics { contentDescription = openLabel },
                            contentAlignment = Alignment.Center) {
                            LucideIcon(Lucide.ArrowUpRight, 16.dp, Sm.Muted)
                        }
                    }
                }
            }
        }
    }
}
