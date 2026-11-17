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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.R
import com.kakumine.notefable.data.APP_ICON_IMAGE_SIZE
import com.kakumine.notefable.data.AppIconStore
import com.kakumine.notefable.data.appIconCrop
import com.kakumine.notefable.data.appIconDataUrl
import com.kakumine.notefable.data.appIconImageBytes
import com.kakumine.notefable.data.appIconSampleSize
import com.kakumine.notefable.data.isImageIcon
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

// 设置里可以换的图标（网页 src/components/app-icon.tsx、app-icon-settings.tsx，值和存法见 data/AppIcon.kt）。

@Composable
internal fun appIconStore(): AppIconStore? = (LocalContext.current.applicationContext as? NoteFableApp)?.appIcon

/** 现在的图标：null 是默认的 NoteFable 标志。换了以后用到的地方都跟着变。 */
@Composable
internal fun currentAppIcon(): String? {
    val store = appIconStore() ?: return null
    val icon by store.icon.collectAsState()
    return icon
}

// 最近一次解出来的图片：侧栏和每条回答的标签用的是同一张，不必各解一遍。只在主线程（组合时）读写。
private var cachedIconKey: String? = null
private var cachedIconImage: ImageBitmap? = null

@Composable
private fun rememberAppIconImage(icon: String): ImageBitmap? = remember(icon) {
    if (cachedIconKey != icon) {
        cachedIconImage = appIconImageBytes(icon)?.let { bytes ->
            runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()?.asImageBitmap()
        }
        cachedIconKey = icon
    }
    cachedIconImage
}

/**
 * 图标（网页 AppIcon）：设置里换过就画那个表情 / 图片，没换过画 NoteFable 标志。
 * 表情：size 见方的格子里居中，字号 size × 0.9（.app-icon-emoji）；图片：size 见方、圆角 22%、cover（.app-icon-image）。
 * 图片读不出来时画标志。
 */
@Composable
internal fun AppIcon(size: Dp, tint: Color, icon: String? = currentAppIcon()) {
    val image = if (icon != null && isImageIcon(icon)) rememberAppIconImage(icon) else null
    when {
        // 96 的图缩到 12–26 来画：用 Medium（带 mipmap），不然小尺寸下有锯齿。
        image != null -> Image(
            image, null, Modifier.size(size).clip(RoundedCornerShape(percent = 22)),
            contentScale = ContentScale.Crop, filterQuality = FilterQuality.Medium,
        )
        icon == null || isImageIcon(icon) -> BrandMark(size, tint)
        else -> Box(Modifier.size(size), Alignment.Center) {
            // 网页是固定的 px，不跟系统字号放大：格子多大，表情就多大。装饰用，不念出来（网页 aria-hidden）。
            val font = with(LocalDensity.current) { (size * 0.9f).toSp() }
            Text(icon, Modifier.wrapContentSize(unbounded = true).clearAndSetSemantics { }, color = tint, fontSize = font, lineHeight = font, maxLines = 1, softWrap = false)
        }
    }
}

/** 设置里"图标"一栏的出错提示（网页 app-icon-settings.tsx 的 error）。 */
internal enum class AppIconError { NotSaved, NotImage }

/** "图标"一栏的界面状态：选表情的框开没开、出错提示。放在账号行里（和头像的一样），选图片回来时接得住。 */
@Stable
internal class AppIconEditor(picking: Boolean, error: AppIconError?) {
    var picking by mutableStateOf(picking)
    var error by mutableStateOf(error)

    /** 新打开设置时（网页那一栏重新挂载）。 */
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
 * "上传图片"：系统选择器（和头像同一个，只列 PNG / JPEG / WebP / GIF），选好后居中裁成正方形、缩到 96、存成 PNG 的 data URL
 * （网页 chooseImage + imageFileToIcon）。不是图片、读不出来提示"请选择图片文件。"。返回打开选择器的函数。
 */
@Composable
internal fun rememberAppIconImagePicker(editor: AppIconEditor, onPickerOpen: (Boolean) -> Unit): () -> Unit {
    val context = LocalContext.current
    val store = appIconStore()
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(PickAvatarPhoto()) { uri ->
        onPickerOpen(false)
        if (uri == null || store == null) return@rememberLauncherForActivityResult
        scope.launch {
            val icon = readAppIconImage(context.contentResolver, uri)
            if (icon == null) {
                editor.error = AppIconError.NotImage
            } else {
                editor.error = if (store.save(icon)) null else AppIconError.NotSaved
                editor.picking = false
            }
        }
    }
    return {
        onPickerOpen(true)
        launcher.launch("image/*")
    }
}

/** 选中的文件 → 存下来的值；不是图片或读不出来时为 null。按 EXIF 摆正，GIF 只取第一帧（和网页 createImageBitmap 相同）。 */
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
 * 设置里"图标"一行（网页 AppIconSettings + settings-dialog.css 的 .settings-row / .settings-chip-row / .settings-app-icon-*，手机宽度的值）：
 * - 行（最小高 56、内边距 10×16、垂直居中）：左边标题 16/500 + 说明 13 灰（上 2），右边间距 16 处是 40 的圆形预览
 *   （白底、1px 深描边，里面是 22 的图标）。
 * - 下面一排可换行的小按钮（.settings-chip，左右 16、下 14、间距 8）："选择表情"（Smile）、"上传图片"（ImagePlus），
 *   换过以后多一个"使用 NoteFable 标志"（RotateCcw）。
 * - 出错提示 14 红（左右 16、下 12）。
 * - "选择表情"打开 / 收起下面的表情选择器（左右 16、下 16、1px 描边、圆角 10 的框，高 min(320, 屏高 − 220)），去掉键写"使用 NoteFable 标志"。
 * 选了就存在这台设备上（AppIconStore），不用按"保存"。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AppIconSettings(editor: AppIconEditor, onPickImage: () -> Unit) {
    val store = appIconStore()
    val icon = currentAppIcon()
    val apply = { next: String? -> editor.error = if (store?.save(next) == true) null else AppIconError.NotSaved }

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.app_icon_title), color = Sm.Text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                Text(stringResource(R.string.app_icon_help), color = Sm.Muted, fontSize = 13.sp, lineHeight = 19.5.sp, modifier = Modifier.padding(top = 2.dp))
            }
            Box(Modifier.size(40.dp).clip(CircleShape).background(Color.White).border(1.dp, Sm.BorderStrong, CircleShape), Alignment.Center) {
                AppIcon(22.dp, Sm.Ink, icon)
            }
        }
        FlowRow(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SettingsChip(Lucide.Smile, stringResource(R.string.app_icon_choose_emoji)) { editor.picking = !editor.picking }
            SettingsChip(Lucide.ImagePlus, stringResource(R.string.app_icon_upload_image), onClick = onPickImage)
            if (icon != null) {
                SettingsChip(Lucide.RotateCcw, stringResource(R.string.app_icon_use_logo)) {
                    apply(null)
                    editor.picking = false
                }
            }
        }
        editor.error?.let {
            val text = when (it) {
                AppIconError.NotSaved -> stringResource(R.string.app_icon_could_not_save)
                AppIconError.NotImage -> stringResource(R.string.acct_choose_image)
            }
            Text(text, color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp))
        }
        if (editor.picking) {
            val shape = RoundedCornerShape(10.dp)
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp).fillMaxWidth().clip(shape).border(1.dp, Sm.Border, shape)) {
                EmojiPickerBody(
                    current = icon?.takeUnless(::isImageIcon),
                    onChange = apply,
                    onClose = { editor.picking = false },
                    pickerHeight = minOf(320.dp, maxOf(80.dp, LocalConfiguration.current.screenHeightDp.dp - 220.dp)),
                    removeLabel = stringResource(R.string.app_icon_use_logo),
                )
            }
        }
    }
}
