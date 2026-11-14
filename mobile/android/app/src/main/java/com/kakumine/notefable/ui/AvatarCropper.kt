package com.kakumine.notefable.ui

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kakumine.notefable.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/*
 * 头像裁剪（网页 src/components/avatar-cropper.tsx + globals.css 的 .avatar-*，手机宽度 ≤639 的值）：
 * - 整体（.avatar-cropper）：内容居中、间距 10、内边距 14。
 * - 预览圆（.avatar-crop-view）：直径 200，--notion-active 底，外侧 1px --notion-border-strong 细环；拖动换位置。
 * - 缩放（.avatar-zoom）：整行，"Zoom" 12 灰字 + 间距 10 + 滑块（1–3，蓝色 accent）。
 * - 提示（.avatar-crop-hint）12 灰字；错误（.profile-error）12 #b91c1c、上距 10。
 * - 按钮行（.avatar-crop-actions）：靠右、间距 8；按钮高 42、左右 14、圆角 6、15 字；"保存"是 --sm-ink 底白字；禁用时 .55。
 * 保存时把圆里看到的部分画成 512×512 的正方形，WebP（质量 .9）上传。
 */

private const val VIEW = 200f // 预览圆的直径（dp = CSS px）

/** 保存的正方形边长（网页 AVATAR_OUTPUT）。 */
const val AVATAR_OUTPUT = 512

/** 短边比这小的照片不收（网页 AVATAR_MIN_SIDE）。 */
const val AVATAR_MIN_SIDE = 200

private const val MAX_ZOOM = 3f

/** 照片在预览圆里的位置和大小（单位与 view 相同），以及夹过之后的偏移。 */
data class CropLayout(val dx: Float, val dy: Float, val w: Float, val h: Float, val offsetX: Float, val offsetY: Float)

/**
 * 网页 layoutFor：照片按短边铺满圆（× zoom），偏移夹在不露出空白的范围里。
 */
fun cropLayout(imageWidth: Float, imageHeight: Float, zoom: Float, offsetX: Float, offsetY: Float, view: Float = VIEW): CropLayout {
    val scale = max(view / imageWidth, view / imageHeight) * zoom
    val w = imageWidth * scale
    val h = imageHeight * scale
    // 浮点误差会让刚好铺满的一边算出 -0.00001：夹到 0，否则 coerceIn 的范围倒过来会抛异常。
    val limitX = max(0f, (w - view) / 2)
    val limitY = max(0f, (h - view) / 2)
    val x = offsetX.coerceIn(-limitX, limitX)
    val y = offsetY.coerceIn(-limitY, limitY)
    return CropLayout((view - w) / 2 + x, (view - h) / 2 + y, w, h, x, y)
}

/** 解码后最多这么多像素（ARGB 约 80 MB）：硬件加速的画布画不了超过 100 MiB 的位图，会直接崩溃。 */
const val AVATAR_MAX_DECODED_PIXELS = 20_000_000L

/**
 * 解码时的缩小倍数（2 的幂）：放大到最大（3 倍）时圆里看到的部分仍有 512 像素，所以短边保留到 512 × 3 以上就够了，
 * 不必把 10 MB 的原图整个读进内存。很长的截图 / 全景图短边不大但像素很多，再按总像素数继续缩小。
 */
fun avatarSampleSize(width: Int, height: Int): Int {
    val needed = AVATAR_OUTPUT * MAX_ZOOM.toInt()
    var sample = 1
    while (min(width, height) / (sample * 2) >= needed) sample *= 2
    while ((width.toLong() / sample) * (height.toLong() / sample) > AVATAR_MAX_DECODED_PIXELS) sample *= 2
    return sample
}

/** 读照片的结果（网页 createImageBitmap 的成功 / 太小 / 读不了）。 */
sealed interface AvatarSource {
    data class Ready(val bitmap: Bitmap) : AvatarSource
    data object TooSmall : AvatarSource
    data object Unreadable : AvatarSource
}

/** 读照片并按 EXIF 摆正（网页 imageOrientation: "from-image"）。GIF 只取第一帧，和网页相同。 */
suspend fun decodeAvatarSource(resolver: ContentResolver, uri: Uri): AvatarSource = withContext(Dispatchers.IO) {
    try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) decodeWithImageDecoder(resolver, uri) else decodeWithBitmapFactory(resolver, uri)
    } catch (_: OutOfMemoryError) {
        AvatarSource.Unreadable
    } catch (_: Exception) {
        AvatarSource.Unreadable
    }
}

@androidx.annotation.RequiresApi(Build.VERSION_CODES.P)
private fun decodeWithImageDecoder(resolver: ContentResolver, uri: Uri): AvatarSource {
    var tooSmall = false
    val bitmap = try {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
            val (w, h) = info.size.width to info.size.height
            if (min(w, h) < AVATAR_MIN_SIDE) {
                tooSmall = true
                throw IllegalStateException("too small")
            }
            decoder.setTargetSampleSize(avatarSampleSize(w, h))
            // 要在普通 Canvas 上重画成 512 图，不能是硬件位图。
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } catch (error: Exception) {
        if (tooSmall) return AvatarSource.TooSmall
        throw error
    }
    return AvatarSource.Ready(bitmap)
}

private fun decodeWithBitmapFactory(resolver: ContentResolver, uri: Uri): AvatarSource {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    // 只读尺寸时 decodeStream 本来就返回 null（Android 8.x 走这里）：只看流能不能打开，尺寸看 bounds。
    val stream = resolver.openInputStream(uri) ?: return AvatarSource.Unreadable
    stream.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return AvatarSource.Unreadable
    if (min(bounds.outWidth, bounds.outHeight) < AVATAR_MIN_SIDE) return AvatarSource.TooSmall
    val options = BitmapFactory.Options().apply { inSampleSize = avatarSampleSize(bounds.outWidth, bounds.outHeight) }
    val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return AvatarSource.Unreadable
    val orientation = runCatching {
        resolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
    }.getOrNull() ?: ExifInterface.ORIENTATION_NORMAL
    val matrix = Matrix()
    when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
        else -> return AvatarSource.Ready(decoded)
    }
    val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    if (upright !== decoded) decoded.recycle()
    return AvatarSource.Ready(upright)
}

/** 网页 save()：把圆里看到的部分画到 512×512 上，WebP 质量 .9。 */
fun renderAvatar(bitmap: Bitmap, layout: CropLayout, view: Float = VIEW): ByteArray {
    val out = Bitmap.createBitmap(AVATAR_OUTPUT, AVATAR_OUTPUT, Bitmap.Config.ARGB_8888)
    val ratio = AVATAR_OUTPUT / view
    val target = RectF(layout.dx * ratio, layout.dy * ratio, (layout.dx + layout.w) * ratio, (layout.dy + layout.h) * ratio)
    android.graphics.Canvas(out).drawBitmap(bitmap, null, target, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
    val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
    val bytes = ByteArrayOutputStream().use { stream ->
        out.compress(format, 90, stream)
        stream.toByteArray()
    }
    out.recycle()
    return bytes
}

const val AVATAR_MIME_TYPE = "image/webp"

/**
 * 网页 AvatarCropper：拖动换位置、滑块缩放、保存成正方形。[error] 是上传失败的提示（已翻译），读照片的问题在这里自己显示。
 */
@Composable
fun AvatarCropper(uri: String, saving: Boolean, error: String?, onCancel: () -> Unit, onSave: (ByteArray) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val source by produceState<AvatarSource?>(null, uri) {
        value = decodeAvatarSource(context.contentResolver, Uri.parse(uri))
    }
    val bitmap = (source as? AvatarSource.Ready)?.bitmap
    val image = remember(bitmap) { bitmap?.asImageBitmap() }

    var zoom by rememberSaveable(uri) { mutableFloatStateOf(1f) }
    var offsetX by rememberSaveable(uri) { mutableFloatStateOf(0f) }
    var offsetY by rememberSaveable(uri) { mutableFloatStateOf(0f) }
    var exporting by remember { mutableStateOf(false) }
    val layout = bitmap?.let { cropLayout(it.width.toFloat(), it.height.toFloat(), zoom, offsetX, offsetY) }
    val currentLayout by rememberUpdatedState(layout)
    val currentZoom by rememberUpdatedState(zoom)

    Column(
        Modifier.fillMaxWidth().padding(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val previewLabel = stringResource(R.string.acct_crop_preview)
        // box-shadow 0 0 0 1px：圆外侧 1px 的细环，所以外框是 202、里面 200。
        Box(Modifier.size((VIEW + 2).dp).border(1.dp, Sm.BorderStrong, CircleShape).padding(1.dp)) {
            Canvas(
                Modifier.size(VIEW.dp).clip(CircleShape).background(Sm.Active)
                    .semantics { contentDescription = previewLabel }
                    .pointerInput(bitmap) {
                        val image0 = bitmap ?: return@pointerInput
                        // 网页：按下时记住起点和原偏移，之后每次用"原偏移 + 总位移"重新夹（拖出边界再拖回来时与网页一致）。
                        var originX = 0f
                        var originY = 0f
                        var totalX = 0f
                        var totalY = 0f
                        detectDragGestures(
                            onDragStart = {
                                originX = currentLayout?.offsetX ?: 0f
                                originY = currentLayout?.offsetY ?: 0f
                                totalX = 0f
                                totalY = 0f
                            },
                        ) { change, amount ->
                            change.consume()
                            totalX += amount.x / density
                            totalY += amount.y / density
                            val next = cropLayout(image0.width.toFloat(), image0.height.toFloat(), currentZoom, originX + totalX, originY + totalY)
                            offsetX = next.offsetX
                            offsetY = next.offsetY
                        }
                    },
            ) {
                val current = layout ?: return@Canvas
                val img = image ?: return@Canvas
                val px = size.width / VIEW
                drawImage(
                    img,
                    dstOffset = IntOffset((current.dx * px).roundToInt(), (current.dy * px).roundToInt()),
                    dstSize = IntSize((current.w * px).roundToInt(), (current.h * px).roundToInt()),
                    filterQuality = FilterQuality.High,
                )
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.acct_zoom), color = Sm.Muted, fontSize = 12.sp)
            Slider(
                value = zoom,
                onValueChange = { value ->
                    zoom = value
                    bitmap?.let {
                        val next = cropLayout(it.width.toFloat(), it.height.toFloat(), value, offsetX, offsetY)
                        offsetX = next.offsetX
                        offsetY = next.offsetY
                    }
                },
                valueRange = 1f..MAX_ZOOM,
                enabled = bitmap != null,
                colors = SliderDefaults.colors(thumbColor = Sm.Blue, activeTrackColor = Sm.Blue, inactiveTrackColor = Sm.Active),
                modifier = Modifier.weight(1f),
            )
        }
        Text(stringResource(R.string.acct_crop_hint), color = Sm.Muted, fontSize = 12.sp)
        val loadError = when (source) {
            AvatarSource.TooSmall -> stringResource(R.string.acct_photo_too_small, AVATAR_MIN_SIDE)
            AvatarSource.Unreadable -> stringResource(R.string.acct_photo_unreadable)
            else -> null
        }
        (loadError ?: error)?.let {
            Text(it, color = Sm.Danger, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            CropButton(stringResource(R.string.cancel), primary = false, enabled = !saving, onClick = onCancel)
            val busy = saving || exporting
            CropButton(
                stringResource(if (saving) R.string.save_saving else R.string.save),
                primary = true,
                enabled = bitmap != null && !busy,
            ) {
                val current = layout ?: return@CropButton
                val src = bitmap ?: return@CropButton
                exporting = true
                scope.launch {
                    val bytes = runCatching { withContext(Dispatchers.Default) { renderAvatar(src, current) } }.getOrNull()
                    exporting = false
                    if (bytes != null) onSave(bytes)
                }
            }
        }
    }
}

@Composable
private fun CropButton(label: String, primary: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(6.dp)
    Box(
        Modifier.height(42.dp).alpha(if (enabled) 1f else 0.55f).clip(shape)
            .background(if (primary) Sm.Ink else Color.Transparent, shape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (primary) Color.White else Sm.Text, fontSize = 15.sp)
    }
}
