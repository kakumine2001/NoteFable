package com.kakumine.notefable.ui

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.APP_ICON_IMAGE_SIZE
import com.kakumine.notefable.data.AppIconStore
import com.kakumine.notefable.data.AppIconSync
import com.kakumine.notefable.data.CharacterId
import com.kakumine.notefable.data.CharacterState
import com.kakumine.notefable.data.ResolvedAppIcon
import com.kakumine.notefable.data.appIconCrop
import com.kakumine.notefable.data.appIconDataUrl
import com.kakumine.notefable.data.appIconImageBytes
import com.kakumine.notefable.data.appIconSampleSize
import com.kakumine.notefable.data.resolveAppIcon
import com.kakumine.notefable.data.toCharacterIcon
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

// 设置里可选的 AI 角色 / 自定义图标（网页 src/components/app-icon.tsx、app-icon-settings.tsx，存储规则见 data/AppIcon.kt）。

@Composable
internal fun appIconStore(): AppIconStore? = (LocalContext.current.applicationContext as? NoteFableApp)?.appIcon

@Composable
private fun noteFableApp(): NoteFableApp? = LocalContext.current.applicationContext as? NoteFableApp

/**
 * 图标跟着账号走（网页 account-button.tsx 的 AccountAppIconSync，App 里只放一个）：登录后（含启动时已登录）读账号上的图标。
 * 未登录或正在退出时不同步，图标只存在这台设备上。
 */
@Composable
internal fun AccountAppIconSync(account: AccountUiState) {
    val sync: AppIconSync = noteFableApp()?.appIconSync ?: return
    val signedIn = account.user != null && !account.signingOut
    LaunchedEffect(signedIn) {
        sync.signedIn = signedIn
        if (signedIn) sync.pull()
    }
}

/** 先存到这台设备、再在登录时送到账号（网页 app-icon-settings.tsx 的 apply）。送不上只提示，本机的选择保留。 */
private fun applyAppIcon(app: NoteFableApp?, editor: AppIconEditor, next: String?) {
    if (app == null || !app.appIcon.save(next)) {
        editor.error = AppIconError.NotSaved
        return
    }
    editor.error = null
    // 用 App 级作用域送：关掉设置也会送完。
    app.scope.launch { if (!app.appIconSync.push(next)) editor.error = AppIconError.NotSynced }
}

/** 现在的图标存储值：null 表示默认角色 Quill。 */
@Composable
internal fun currentAppIcon(): String? {
    val store = appIconStore() ?: return null
    val icon by store.icon.collectAsState()
    return icon
}

// 最近一次解码的自定义上传图片缓存：多处复用同一张图，不必重复解码。只在主线程（组合时）读写。
private var cachedIconKey: String? = null
private var cachedIconImage: ImageBitmap? = null

@Composable
internal fun rememberAppIconImage(icon: String): ImageBitmap? = remember(icon) {
    if (cachedIconKey != icon) {
        cachedIconImage = appIconImageBytes(icon)?.let { bytes ->
            runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()?.asImageBitmap()
        }
        cachedIconKey = icon
    }
    cachedIconImage
}

/**
 * 统一产品角色 / 图标组件（网页 AppIcon）：
 * 未自定义时展示默认角色 Quill；选了其他官方角色展示对应角色（可带状态微动效）；上传了自定义图片则展示圆角缩略图。
 */
@Composable
internal fun AppIcon(
    size: Dp,
    @Suppress("UNUSED_PARAMETER") tint: Color = Sm.Ink,
    icon: String? = currentAppIcon(),
    state: CharacterState = CharacterState.Idle,
    animated: Boolean = false,
) {
    when (val resolved = resolveAppIcon(icon)) {
        is ResolvedAppIcon.Image -> {
            val image = rememberAppIconImage(resolved.dataUrl)
            if (image != null) {
                Image(
                    image,
                    null,
                    Modifier.size(size).clip(RoundedCornerShape(percent = 22)),
                    contentScale = ContentScale.Crop,
                    filterQuality = FilterQuality.Medium,
                )
            } else {
                CharacterGraphic(CharacterId.Default, size, state = state, animated = animated)
            }
        }
        is ResolvedAppIcon.Character -> {
            CharacterGraphic(resolved.characterId, size, state = state, animated = animated)
        }
    }
}

/** 设置里"图标"一栏的出错提示（网页 app-icon-settings.tsx 的 error）。 */
internal enum class AppIconError { NotSaved, NotImage, NotSynced }

/** "图标"一栏的界面状态：角色选择网格是否展开、出错提示。 */
@Stable
internal class AppIconEditor(picking: Boolean, error: AppIconError?) {
    var picking by mutableStateOf(picking)
    var error by mutableStateOf(error)

    fun reset() {
        picking = false
        error = null
    }

    companion object {
        val Saver = listSaver<AppIconEditor, Any?>(
            save = { listOf(it.picking, it.error?.name) },
            restore = { saved -> AppIconEditor(saved[0] as Boolean, (saved[1] as String?)?.let(AppIconError::valueOf)) },
        )
    }
}

@Composable
internal fun rememberAppIconEditor(): AppIconEditor = rememberSaveable(saver = AppIconEditor.Saver) { AppIconEditor(false, null) }

/**
 * "上传图片"：系统选择器（只列 PNG / JPEG / WebP / GIF），选好后居中裁成正方形、缩到 96、存成 PNG 的 data URL。
 */
@Composable
internal fun rememberAppIconImagePicker(editor: AppIconEditor, onPickerOpen: (Boolean) -> Unit): () -> Unit {
    val context = LocalContext.current
    val app = noteFableApp()
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(PickAvatarPhoto()) { uri ->
        onPickerOpen(false)
        if (uri == null || app == null) return@rememberLauncherForActivityResult
        scope.launch {
            val icon = readAppIconImage(context.contentResolver, uri)
            if (icon == null) {
                editor.error = AppIconError.NotImage
            } else {
                applyAppIcon(app, editor, icon)
                editor.picking = false
            }
        }
    }
    return {
        onPickerOpen(true)
        launcher.launch("image/*")
    }
}

private suspend fun readAppIconImage(resolver: ContentResolver, uri: Uri): String? {
    val type = withContext(Dispatchers.IO) { runCatching { resolver.getType(uri) }.getOrNull() }
    if (type?.startsWith("image/") != true) return null
    val source = decodeAvatarSource(resolver, uri, minSide = 1, sampleSize = ::appIconSampleSize) as? AvatarSource.Ready ?: return null
    return withContext(Dispatchers.Default) { runCatching { renderAppIcon(source.bitmap) }.getOrNull() }
}

private fun renderAppIcon(bitmap: Bitmap): String {
    val crop = appIconCrop(bitmap.width, bitmap.height)
    val out = Bitmap.createBitmap(APP_ICON_IMAGE_SIZE, APP_ICON_IMAGE_SIZE, Bitmap.Config.ARGB_8888)
    try {
        android.graphics.Canvas(out).drawBitmap(
            bitmap,
            Rect(crop.left, crop.top, crop.left + crop.side, crop.top + crop.side),
            Rect(0, 0, APP_ICON_IMAGE_SIZE, APP_ICON_IMAGE_SIZE),
            Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG),
        )
        val png = ByteArrayOutputStream().use { stream ->
            check(out.compress(Bitmap.CompressFormat.PNG, 100, stream)) { "cannot encode the icon" }
            stream.toByteArray()
        }
        return appIconDataUrl(png)
    } finally {
        out.recycle()
        bitmap.recycle()
    }
}

/*
 * 设置 → 通用 → 图标（网页 AppIconSettings + settings-dialog.css 手机宽度）：
 * - 右侧 40dp 圆形预览（展示当前角色或自定义图片）；
 * - 两个按钮：「选择角色」（展开 7 款官方预设角色网格）与「上传图片」（保留自定义图片上传）；
 * - 已移除旧版「选择表情」与「使用 NoteFable 标志」按钮（选回默认角色 Quill 即可恢复默认）。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AppIconSettings(editor: AppIconEditor, onPickImage: () -> Unit) {
    val app = noteFableApp()
    val icon = currentAppIcon()
    val resolved = resolveAppIcon(icon)
    val selectedCharacterId = (resolved as? ResolvedAppIcon.Character)?.characterId
    val apply = { next: String? -> applyAppIcon(app, editor, next) }
    // 打开设置时重新读账号上的图标（别的设备换过的话这里也跟着变）。
    LaunchedEffect(app) { app?.appIconSync?.pull() }

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.app_icon_title), color = Sm.Text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            }
            Box(Modifier.size(40.dp).clip(CircleShape).background(Sm.Surface).border(1.dp, Sm.BorderStrong, CircleShape), Alignment.Center) {
                AppIcon(24.dp, Sm.Ink, icon, animated = true)
            }
        }
        FlowRow(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SettingsChip(Lucide.Sparkles, stringResource(R.string.app_icon_choose_character)) { editor.picking = !editor.picking }
            SettingsChip(Lucide.ImagePlus, stringResource(R.string.app_icon_upload_image), onClick = onPickImage)
        }
        editor.error?.let {
            val text = when (it) {
                AppIconError.NotSaved -> stringResource(R.string.app_icon_could_not_save)
                AppIconError.NotImage -> stringResource(R.string.acct_choose_image)
                AppIconError.NotSynced -> stringResource(R.string.app_icon_could_not_sync)
            }
            Text(text, color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp))
        }
        if (editor.picking) {
            CharacterPickerCard(
                selectedId = selectedCharacterId,
                onSelect = { id -> apply(toCharacterIcon(id)) },
                onClose = { editor.picking = false },
            )
        }
    }
}

@Composable
private fun CharacterPickerCard(
    selectedId: CharacterId?,
    onSelect: (CharacterId) -> Unit,
    onClose: () -> Unit,
) {
    val shape = RoundedCornerShape(10.dp)
    val closeLabel = stringResource(R.string.close)
    val defaultBadge = stringResource(R.string.pg_font_default)

    Column(
        Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)
            .fillMaxWidth()
            .clip(shape)
            .background(Sm.Sidebar)
            .border(1.dp, Sm.BorderStrong, shape),
    ) {
        Row(
            Modifier.fillMaxWidth().background(Sm.Surface).padding(start = 14.dp, end = 10.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.app_icon_choose_character),
                modifier = Modifier.weight(1f),
                color = Sm.Muted,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Box(
                Modifier.size(36.dp).clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button, onClick = onClose)
                    .semantics { contentDescription = closeLabel },
                Alignment.Center,
            ) {
                LucideIcon(Lucide.X, 15.dp, Sm.Muted)
            }
        }
        SettingsRowDivider()
        Column(
            Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CharacterId.entries.chunked(3).forEach { rowItems ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    rowItems.forEach { character ->
                        val isSelected = character == selectedId
                        val cardShape = RoundedCornerShape(10.dp)
                        val label = if (character.isDefault) "${character.displayName} ($defaultBadge)" else character.displayName
                        Box(
                            Modifier.weight(1f)
                                .heightIn(min = 88.dp)
                                .clip(cardShape)
                                .background(Sm.Surface)
                                .border(
                                    width = if (isSelected) 1.5.dp else 1.dp,
                                    color = if (isSelected) Sm.Blue else Sm.BorderStrong,
                                    shape = cardShape,
                                )
                                .clickable { onSelect(character) }
                                .semantics(mergeDescendants = true) {
                                    role = Role.RadioButton
                                    selected = isSelected
                                    contentDescription = label
                                }
                                .padding(horizontal = 6.dp, vertical = 10.dp),
                        ) {
                            if (isSelected) {
                                Box(
                                    Modifier.align(Alignment.TopEnd).size(18.dp).clip(CircleShape).background(Sm.Blue),
                                    Alignment.Center,
                                ) {
                                    LucideIcon(Lucide.Check, 11.dp, Color.White, strokeWidth = 2.6f)
                                }
                            }
                            Column(
                                Modifier.fillMaxWidth().align(Alignment.Center),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                CharacterGraphic(
                                    characterId = character,
                                    size = 40.dp,
                                    state = CharacterState.Idle,
                                    animated = isSelected,
                                )
                                Text(
                                    character.displayName,
                                    color = Sm.Ink,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    textAlign = TextAlign.Center,
                                    maxLines = 1,
                                )
                                if (character.isDefault) {
                                    Box(
                                        Modifier.clip(CircleShape).background(Sm.Hover).padding(horizontal = 6.dp, vertical = 1.dp),
                                        Alignment.Center,
                                    ) {
                                        Text(defaultBadge, color = Sm.Muted, fontSize = 11.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                                    }
                                }
                            }
                        }
                    }
                    repeat(3 - rowItems.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}
