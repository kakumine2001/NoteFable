package com.kakumine.notefable.ui

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.kakumine.notefable.R
import com.kakumine.notefable.data.NoteSharePatch
import com.kakumine.notefable.data.NoteShareState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// 网页 note-share-dialog.tsx（.notes-share-dialog）的原生复刻。
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NoteShareDialog(
    pageId: String,
    vm: NotesViewModel,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val uriHandler = LocalUriHandler.current
    val systemText = rememberSystemText()
    val loadFailed = stringResource(R.string.share_load_failed)
    val updateFailed = stringResource(R.string.share_update_failed)

    var share by remember(pageId) { mutableStateOf<NoteShareState?>(null) }
    var draftIncludeSubpages by remember(pageId) { mutableStateOf(true) }
    var loading by remember(pageId) { mutableStateOf(true) }
    var busy by remember(pageId) { mutableStateOf(false) }
    var error by remember(pageId) { mutableStateOf<String?>(null) }
    var copiedKey by remember(pageId) { mutableStateOf<String?>(null) }

    LaunchedEffect(pageId) {
        loading = true
        error = null
        try {
            val loaded = vm.loadShare(pageId)
            share = loaded
            draftIncludeSubpages = loaded.includeSubpages
        } catch (e: Exception) {
            error = e.message?.takeIf { it.isNotBlank() }?.let { systemText.localize(it) } ?: loadFailed
        } finally {
            loading = false
        }
    }

    fun save(patch: NoteSharePatch) {
        if (busy) return
        scope.launch {
            busy = true
            error = null
            try {
                val updated = vm.updateShare(pageId, patch)
                share = updated
                draftIncludeSubpages = updated.includeSubpages
            } catch (e: Exception) {
                error = e.message?.takeIf { it.isNotBlank() }?.let { systemText.localize(it) } ?: updateFailed
            } finally {
                busy = false
            }
        }
    }

    fun copyUrl(url: String, key: String) {
        clipboard.setText(AnnotatedString(url))
        copiedKey = key
        scope.launch {
            delay(1800)
            if (copiedKey == key) copiedKey = null
        }
    }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Color.White)
                .padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                LucideIcon(Lucide.Globe, 17.dp, Sm.Text)
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.share_publish_to_web),
                    color = Sm.Text,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                TopIconButton(Lucide.X, stringResource(R.string.close), onClose, iconSize = 18.dp)
            }

            if (loading) {
                Text(stringResource(R.string.sb_loading), color = Sm.Muted, fontSize = 14.sp)
            } else {
                val s = share
                if (s != null) {
                    val inherited = s.inheritedFrom
                    if (inherited != null) {
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(Sm.Sidebar)
                                .border(1.dp, Sm.Border, RoundedCornerShape(8.dp))
                                .padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            val title = inherited.title.ifBlank { stringResource(R.string.sb_untitled) }
                            Text(
                                stringResource(
                                    if (s.excludeFromParent) R.string.share_excluded_parent else R.string.share_via_parent,
                                    title,
                                ),
                                color = Sm.Text,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                            )
                            val inheritedUrl = s.inheritedUrl
                            if (!inheritedUrl.isNullOrBlank()) {
                                ShareUrlRow(
                                    url = inheritedUrl,
                                    copied = copiedKey == "inherited",
                                    onCopy = { copyUrl(inheritedUrl, "inherited") },
                                    onOpen = { runCatching { uriHandler.openUri(inheritedUrl) } },
                                )
                            }
                            ShareSwitchRow(
                                label = stringResource(R.string.share_exclude_from_parent),
                                checked = s.excludeFromParent,
                                enabled = !busy,
                                onToggle = { save(NoteSharePatch(excludeFromParent = !s.excludeFromParent)) },
                            )
                        }
                    } else if (s.hasParent) {
                        ShareSwitchRow(
                            label = stringResource(R.string.share_exclude_from_parent),
                            checked = s.excludeFromParent,
                            enabled = !busy,
                            onToggle = { save(NoteSharePatch(excludeFromParent = !s.excludeFromParent)) },
                        )
                    }

                    if (!s.active) {
                        if (s.expired) {
                            Text(
                                stringResource(R.string.share_expired),
                                color = Color(0xFF9A5209),
                                fontSize = 13.sp,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Color(0x1AD9730D))
                                    .padding(horizontal = 12.dp, vertical = 9.dp),
                            )
                        } else {
                            Text(stringResource(R.string.share_desc), color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp)
                        }
                        ShareSwitchRow(
                            label = stringResource(R.string.share_include_subpages),
                            checked = draftIncludeSubpages,
                            enabled = !busy,
                            onToggle = { draftIncludeSubpages = !draftIncludeSubpages },
                        )
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(38.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (busy) Sm.Text.copy(alpha = 0.5f) else Sm.Text)
                                .clickable(enabled = !busy) { save(NoteSharePatch(enabled = true, includeSubpages = draftIncludeSubpages)) }
                                .semantics { role = Role.Button },
                            Alignment.Center,
                        ) {
                            Text(
                                stringResource(if (s.expired) R.string.share_republish else R.string.share_publish),
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    } else {
                        val url = s.url
                        if (!url.isNullOrBlank()) {
                            ShareUrlRow(
                                url = url,
                                copied = copiedKey == "own",
                                onCopy = { copyUrl(url, "own") },
                                onOpen = { runCatching { uriHandler.openUri(url) } },
                            )
                        }
                        ShareSwitchRow(
                            label = stringResource(R.string.share_include_subpages),
                            checked = s.includeSubpages,
                            enabled = !busy,
                            onToggle = { save(NoteSharePatch(includeSubpages = !s.includeSubpages)) },
                        )
                        Box(Modifier.fillMaxWidth().height(1.dp).background(Sm.Border))
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(stringResource(R.string.share_link_expires), color = Sm.Text, fontSize = 14.sp)
                            val presets = listOf(
                                Pair(R.string.share_never, null),
                                Pair(R.string.share_1h, 3_600_000L),
                                Pair(R.string.share_1d, 86_400_000L),
                                Pair(R.string.share_7d, 7 * 86_400_000L),
                                Pair(R.string.share_30d, 30 * 86_400_000L),
                            )
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                presets.forEach { (labelRes, millis) ->
                                    val selected = millis == null && s.expiresAt == null
                                    Box(
                                        Modifier
                                            .height(30.dp)
                                            .clip(RoundedCornerShape(6.dp))
                                            .background(if (selected) Sm.Hover else Color.White)
                                            .border(1.dp, if (selected) Sm.Text else Sm.BorderStrong, RoundedCornerShape(6.dp))
                                            .clickable(enabled = !busy) {
                                                val nextIso = millis?.let { Instant.ofEpochMilli(System.currentTimeMillis() + it).toString() }
                                                save(NoteSharePatch(setExpiresAt = true, expiresAt = nextIso))
                                            }
                                            .padding(horizontal = 10.dp),
                                        Alignment.Center,
                                    ) {
                                        Text(
                                            stringResource(labelRes),
                                            color = Sm.Text,
                                            fontSize = 12.sp,
                                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                        )
                                    }
                                }
                                Box(
                                    Modifier
                                        .height(30.dp)
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(Color.White)
                                        .border(1.dp, Sm.BorderStrong, RoundedCornerShape(6.dp))
                                        .clickable(enabled = !busy) {
                                            pickCustomExpiry(context, s.expiresAt) { iso ->
                                                save(NoteSharePatch(setExpiresAt = true, expiresAt = iso))
                                            }
                                        }
                                        .padding(horizontal = 10.dp),
                                    Alignment.Center,
                                ) {
                                    Text(stringResource(R.string.share_custom_date), color = Sm.Text, fontSize = 12.sp)
                                }
                            }
                            s.expiresAt?.let { iso ->
                                val formatted = remember(iso) { formatShareExpiry(iso) }
                                Text(stringResource(R.string.share_expires_time, formatted), color = Sm.Muted, fontSize = 12.sp)
                            }
                        }
                        Box(Modifier.fillMaxWidth().height(1.dp).background(Sm.Border))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            Box(
                                Modifier
                                    .heightIn(min = 34.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .border(1.dp, Sm.BorderStrong, RoundedCornerShape(6.dp))
                                    .clickable(enabled = !busy) { save(NoteSharePatch(enabled = false)) }
                                    .padding(horizontal = 12.dp, vertical = 6.dp),
                                Alignment.Center,
                            ) {
                                Text(stringResource(R.string.share_unpublish), color = Color(0xFFB91C1C), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                }
            }

            error?.let { msg ->
                Text(msg, color = Color(0xFFB91C1C), fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun ShareUrlRow(url: String, copied: Boolean, onCopy: () -> Unit, onOpen: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier
                .weight(1f)
                .height(34.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Color.White)
                .border(1.dp, Sm.BorderStrong, RoundedCornerShape(6.dp))
                .padding(horizontal = 10.dp),
            Alignment.CenterStart,
        ) {
            Text(url, color = Sm.Text, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(
            Modifier
                .height(34.dp)
                .clip(RoundedCornerShape(6.dp))
                .border(1.dp, Sm.BorderStrong, RoundedCornerShape(6.dp))
                .background(Color.White)
                .clickable(onClick = onCopy)
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            LucideIcon(if (copied) Lucide.Check else Lucide.Copy, 14.dp, Sm.Text)
            Text(stringResource(if (copied) R.string.answer_copied else R.string.share_copy_link), color = Sm.Text, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        }
        val openDesc = stringResource(R.string.share_open_link)
        Box(
            Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(6.dp))
                .border(1.dp, Sm.BorderStrong, RoundedCornerShape(6.dp))
                .background(Color.White)
                .clickable(onClick = onOpen)
                .semantics { contentDescription = openDesc; role = Role.Button },
            Alignment.Center,
        ) {
            LucideIcon(Lucide.ExternalLink, 15.dp, Sm.Muted)
        }
    }
}

@Composable
private fun ShareSwitchRow(label: String, checked: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 36.dp)
            .clip(RoundedCornerShape(6.dp))
            .clickable(enabled = enabled, onClick = onToggle)
            .padding(horizontal = 4.dp, vertical = 4.dp)
            .semantics { role = Role.Switch; toggleableState = ToggleableState(checked) },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = Sm.Text, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Box(
            Modifier
                .size(26.dp, 14.dp)
                .clip(CircleShape)
                .background(if (checked) Sm.Blue else Color(0x3337352F)),
        ) {
            Box(
                Modifier
                    .offset(x = if (checked) 14.dp else 2.dp, y = 2.dp)
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(Color.White),
            )
        }
    }
}

private fun pickCustomExpiry(context: android.content.Context, currentIso: String?, onPicked: (String) -> Unit) {
    val initial = runCatching { currentIso?.let { Instant.parse(it) } }.getOrNull()
        ?.takeIf { it.isAfter(Instant.now()) }
        ?: Instant.now().plusSeconds(86_400)
    val zoned = initial.atZone(ZoneId.systemDefault())
    val picker = android.app.DatePickerDialog(
        context,
        { _, year, month, dayOfMonth ->
            android.app.TimePickerDialog(
                context,
                { _, hourOfDay, minute ->
                    val chosen = java.time.ZonedDateTime.of(year, month + 1, dayOfMonth, hourOfDay, minute, 0, 0, ZoneId.systemDefault()).toInstant()
                    onPicked(chosen.toString())
                },
                zoned.hour,
                zoned.minute,
                true,
            ).show()
        },
        zoned.year,
        zoned.monthValue - 1,
        zoned.dayOfMonth,
    )
    picker.datePicker.minDate = System.currentTimeMillis()
    picker.show()
}

private fun formatShareExpiry(iso: String): String = runCatching {
    val instant = Instant.parse(iso)
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withZone(ZoneId.systemDefault())
        .format(instant)
}.getOrDefault(iso)
