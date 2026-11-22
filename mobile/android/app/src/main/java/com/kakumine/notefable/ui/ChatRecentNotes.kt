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
                Box {
                    Column(
                        Modifier.width(152.dp).heightIn(min = 101.dp).alpha(if (canToggle) 1f else .55f)
                            .shadow(1.dp, shape).background(Color.White)
                            .background(if (attached) Sm.AccentSoft else Color.Transparent)
                            .border(1.dp, if (attached) Sm.AccentLine else Sm.Border, shape)
                            .toggleable(value = attached, enabled = canToggle, role = Role.Checkbox) {
                                onToggle(ChatProjectNote(page.id, page.title, page.icon))
                            }.padding(horizontal = 13.dp, vertical = 11.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Box(Modifier.size(32.dp).background(Sm.Sidebar, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                            NoteIcon(page.icon, 16.sp, 18.dp, Sm.Muted)
                        }
                        Text(title, color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (attached) LucideIcon(Lucide.Check, 12.dp, Sm.Muted)
                            Text(stringResource(if (attached) R.string.note_attached else R.string.attach_pages_submit),
                                color = Sm.Muted, fontSize = 12.sp, lineHeight = 18.sp)
                        }
                    }
                    val openLabel = stringResource(R.string.open_note_title, title)
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
