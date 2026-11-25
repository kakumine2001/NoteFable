package com.kakumine.notefable.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
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
    // 108dp at the default font size: 69dp of strip, icon and padding plus the title (21sp) and status (18sp) lines.
    // The text part follows the system font size, so every card stays the same height without clipping.
    val cardHeight = with(LocalDensity.current) { 69.dp + 21.sp.toDp() + 18.sp.toDp() }
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
                val iconShape = RoundedCornerShape(8.dp)
                // Every card keeps the same strip (the cover, or a kind-tinted one) and a fixed size,
                // so cards with and without a cover line up (web .chat-recent .notes-recent-card).
                Box {
                    Box(
                        Modifier.width(152.dp).height(cardHeight).alpha(if (canToggle) 1f else .55f)
                            .shadow(1.dp, shape).clip(shape).background(Sm.Surface)
                            .background(if (attached) Sm.AccentSoft else Color.Transparent)
                            .border(1.dp, if (attached) Sm.AccentLine else Sm.Border, shape)
                            .toggleable(value = attached, enabled = canToggle, role = Role.Checkbox) {
                                onToggle(ChatProjectNote(page.id, page.title, page.icon, page.kind))
                            },
                    ) {
                        Column(Modifier.fillMaxSize()) {
                            Box(Modifier.fillMaxWidth().height(32.dp)) {
                                NoteCoverBanner(page.cover, page.coverPosition, page.kind, Modifier.fillMaxSize())
                                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(1.dp).background(Sm.Border))
                            }
                            // The icon overlaps the strip by 16dp, so the title starts 4dp below it.
                            Column(Modifier.fillMaxSize().padding(start = 12.dp, end = 12.dp, top = 20.dp, bottom = 10.dp)) {
                                Text(title, color = Sm.Text, fontSize = 14.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Spacer(Modifier.weight(1f))
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    if (attached) LucideIcon(Lucide.Check, 12.dp, Sm.Muted)
                                    Text(stringResource(if (attached) R.string.note_attached else R.string.attach_pages_submit),
                                        color = Sm.Muted, fontSize = 12.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                        Box(
                            Modifier.padding(start = 12.dp, top = 16.dp).size(32.dp)
                                .shadow(2.dp, iconShape, ambientColor = Color(0x120F172A), spotColor = Color(0x120F172A))
                                .clip(iconShape).background(Sm.Surface).border(1.dp, Sm.Border, iconShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            NoteIcon(page.icon, 16.sp, 17.dp, pageKindColor(page.kind), page.kind)
                        }
                    }
                    val openLabel = stringResource(R.string.open_note_title, title)
                    // 48dp touch target in the corner; the visible chip sits on the strip and shows the press (web: chip hover).
                    val openSource = remember { MutableInteractionSource() }
                    val openPressed by openSource.collectIsPressedAsState()
                    Box(Modifier.align(Alignment.TopEnd).padding(1.dp).size(48.dp)
                        .clickable(interactionSource = openSource, indication = null, role = Role.Button) { onOpen(page.id) }
                        .semantics { contentDescription = openLabel }
                        .padding(4.dp),
                        contentAlignment = Alignment.TopEnd) {
                        Box(Modifier.size(26.dp).clip(CircleShape).background(if (openPressed) Sm.Hover else Sm.Surface.copy(alpha = 0.86f))
                            .border(1.dp, Sm.Border, CircleShape),
                            contentAlignment = Alignment.Center) {
                            LucideIcon(Lucide.ArrowUpRight, 14.dp, Sm.Muted)
                        }
                    }
                }
            }
        }
    }
}
