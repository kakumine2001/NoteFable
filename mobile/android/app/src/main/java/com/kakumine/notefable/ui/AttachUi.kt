package com.kakumine.notefable.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import android.view.inputmethod.InputContentInfo
import android.webkit.MimeTypeMap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.content.TransferableContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.kakumine.notefable.R
import com.kakumine.notefable.data.ATTACHMENT_PICKER_TYPES
import com.kakumine.notefable.data.AttachError
import com.kakumine.notefable.data.LocalFile
import com.kakumine.notefable.data.MAX_UPLOAD_FILES
import com.kakumine.notefable.data.MAX_UPLOAD_FILE_BYTES
import com.kakumine.notefable.data.formatUploadSize
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

// 附件与「生成图片」模式的界面。数值来自网页（src/app/[locale]/app/page.tsx 的输入栏、attach-sheet.tsx、globals.css）。

/**
 * 「添加文件或照片」：和手机浏览器里网页的文件选择框一样，一个选择器里既能选文件也能拍照
 * （系统选择器 + 相机，相机拍的照片先存到缓存目录、经 FileProvider 交给相机 App）。
 * 选好后读出文件名、类型和大小交给 [onPicked]。
 */
@Composable
fun rememberFilePicker(onImport: (suspend () -> List<LocalFile>) -> Unit): () -> Unit {
    val context = LocalContext.current
    // 相机照片的去处。要跨过 Activity 重建（拍照时系统可能回收 App），所以存在 rememberSaveable 里。
    var cameraTarget by rememberSaveable { mutableStateOf<String?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val target = cameraTarget?.let(Uri::parse)
        cameraTarget = null
        target?.let { context.revokeUriPermission(it, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
        if (result.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
        val data = result.data
        val picked = buildList {
            data?.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let(::add) }
            if (isEmpty()) data?.data?.let(::add)
        }
        // 读文件名和大小要访问文件提供方，放到后台线程，不卡界面。
        // 读完前不能发送（见 ChatViewModel.importFiles）。
        onImport {
            withContext(Dispatchers.IO) {
                pickedAttachmentSources(picked, target) { cameraFileHasContent(context, it) }
                    .mapNotNull { readLocalFile(context, it) }
            }
        }
    }
    return {
        val documents = Intent(Intent.ACTION_GET_CONTENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, ATTACHMENT_PICKER_TYPES)
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        val target = runCatching { newAttachmentCacheUri(context, "jpg") }.getOrNull()
        val cameras = if (target == null) emptyList() else cameraIntents(context, target)
        cameraTarget = target?.takeIf { cameras.isNotEmpty() }?.toString()
        val chooser = Intent.createChooser(documents, null)
        if (cameras.isNotEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, cameras.toTypedArray())
        runCatching { launcher.launch(chooser) }
    }
}

/**
 * 选择器返回后要读哪些文件：选了文件（clipData 或 data）就用它们；什么都没返回时是相机拍照，
 * 照片已经写进了我们给的 [cameraTarget]，有内容才算（取消拍照会留下空文件）。
 */
internal fun <T> pickedAttachmentSources(picked: List<T>, cameraTarget: T?, cameraHasContent: (T) -> Boolean): List<T> =
    if (picked.isNotEmpty()) picked else listOfNotNull(cameraTarget?.takeIf(cameraHasContent))

/** 本机每个相机 App 一个拍照意图，照片写到 [target]（预先给它写权限）。 */
private fun cameraIntents(context: Context, target: Uri): List<Intent> {
    val capture = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    return context.packageManager.queryIntentActivities(capture, 0).map { info ->
        val pkg = info.activityInfo.packageName
        context.grantUriPermission(pkg, target, flags)
        Intent(capture).setClassName(pkg, info.activityInfo.name).putExtra(MediaStore.EXTRA_OUTPUT, target).addFlags(flags)
    }
}

private fun cameraFileHasContent(context: Context, uri: Uri): Boolean =
    runCatching { context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize > 0 } == true }.getOrDefault(false)

/** 缓存目录里放附件副本（拍照、粘贴）的位置，对外经 FileProvider（res/xml/file_paths.xml）提供。 */
private const val ATTACHMENT_CACHE_DIR = "attachments"
private const val ATTACHMENT_CACHE_MAX_AGE_MS = 24L * 60 * 60 * 1000

private fun attachmentAuthority(context: Context) = context.packageName + ".attachments"

/** 新建一个空的缓存文件并返回它的 content:// 地址；顺手删掉一天以前的旧副本。 */
private fun newAttachmentCacheUri(context: Context, extension: String, baseName: String? = null): Uri {
    val dir = File(context.cacheDir, ATTACHMENT_CACHE_DIR).apply { mkdirs() }
    val now = System.currentTimeMillis()
    dir.listFiles()?.forEach { old ->
        if (now - old.lastModified() > ATTACHMENT_CACHE_MAX_AGE_MS) old.deleteRecursively()
    }
    // 每个文件单独一层目录，文件名就能保留原名（网页粘贴的图片叫 image.png）。
    val slot = File(dir, UUID.randomUUID().toString()).apply { mkdirs() }
    val name = baseName?.takeIf { it.isNotBlank() && !it.contains('/') }
        ?: "IMG_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date(now)) + "." + extension
    val file = File(slot, name)
    file.createNewFile()
    return FileProvider.getUriForFile(context, attachmentAuthority(context), file)
}

/**
 * 粘贴进输入框的图片（网页 onPaste 的 getClipboardImageFiles）：只收网页也收的图片类型，
 * 先把字节拷进缓存（剪贴板换了内容后原地址可能就读不到了），再按普通附件处理。
 */
fun copyPastedImage(context: Context, uri: Uri): LocalFile? = runCatching {
    val resolver = context.contentResolver
    val type = resolver.getType(uri)?.lowercase() ?: return null
    if (type !in PASTE_IMAGE_TYPES) return null
    val extension = when (type) {
        "image/jpeg" -> "jpg"
        "image/webp" -> "webp"
        else -> "png"
    }
    val target = newAttachmentCacheUri(context, extension, "image.$extension")
    resolver.openInputStream(uri)?.use { input ->
        resolver.openOutputStream(target)?.use { output -> input.copyTo(output) }
    } ?: return null
    LocalFile(target.toString(), "image.$extension", type, cachedSize(context, target))
}.getOrNull()

private fun cachedSize(context: Context, uri: Uri): Long =
    context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: 0L

/**
 * 键盘（IME commitContent）插入的内容：Compose 把 InputContentInfo 放在 extras 里，读取权限跟着它走。
 * 拷完后释放；剪贴板粘贴没有这一项，什么都不做。
 */
@OptIn(ExperimentalFoundationApi::class)
fun releaseKeyboardContentPermission(content: TransferableContent) {
    val extras = content.platformTransferableContent?.extras ?: return
    val info = if (Build.VERSION.SDK_INT >= 33) {
        extras.getParcelable(KEYBOARD_CONTENT_INFO_KEY, InputContentInfo::class.java)
    } else {
        @Suppress("DEPRECATION")
        extras.getParcelable(KEYBOARD_CONTENT_INFO_KEY) as? InputContentInfo
    }
    runCatching { info?.releasePermission() }
}

/** Compose foundation 放 InputContentInfo 用的键（StatelessInputConnection 里的 EXTRA_INPUT_CONTENT_INFO）。 */
private const val KEYBOARD_CONTENT_INFO_KEY = "EXTRA_INPUT_CONTENT_INFO"

/** 粘贴时当作附件的图片类型（和网页 isImageMimeType 一样，只有模型能读的 PNG / JPEG / WEBP）。 */
val PASTE_IMAGE_TYPES = setOf("image/png", "image/jpeg", "image/webp")

private fun readLocalFile(context: Context, uri: Uri): LocalFile? = runCatching {
    val resolver = context.contentResolver
    var name = ""
    var size = -1L
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            name = cursor.getString(0).orEmpty()
            if (!cursor.isNull(1)) size = cursor.getLong(1)
        }
    }
    if (name.isEmpty()) name = uri.lastPathSegment?.substringAfterLast('/').orEmpty()
    // 少数文件来源不报大小：读一遍数出来（超过单个文件上限就不用再读，反正会被拒绝）。
    if (size < 0) {
        size = resolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(64 * 1024)
            var total = 0L
            while (total <= MAX_UPLOAD_FILE_BYTES) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
            }
            total
        } ?: 0L
    }
    val type = resolver.getType(uri)
        ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
        ?: "application/octet-stream"
    LocalFile(uri.toString(), name, type, size)
}.getOrNull()

/** 生成的图片刚完成时服务器给的是 data: 地址，转成字节交给图片加载器；其余是普通地址。 */
fun imageModel(dataUrl: String): Any =
    if (!dataUrl.startsWith("data:")) dataUrl
    else runCatching { Base64.decode(dataUrl.substringAfter("base64,", ""), Base64.DEFAULT) }.getOrDefault(dataUrl)

@Composable
fun attachErrorText(error: AttachError): String = when (error) {
    is AttachError.TooMany -> stringResource(R.string.err_too_many, error.max, error.extra)
    is AttachError.Empty -> stringResource(R.string.err_empty, error.name)
    AttachError.NameTooLong -> stringResource(R.string.err_name_long)
    is AttachError.Unsupported -> stringResource(R.string.err_unsupported, error.name)
    AttachError.ModelCannotReadImages -> stringResource(R.string.err_model_images)
    is AttachError.FileTooLarge -> stringResource(R.string.err_file_large, error.name, formatUploadSize(error.limitBytes))
    is AttachError.TotalTooLarge -> stringResource(R.string.err_total_large, formatUploadSize(error.limitBytes))
    is AttachError.SlotsFull -> stringResource(R.string.err_slots_full, error.max)
    is AttachError.RoomForFewer ->
        if (error.remaining == 1) stringResource(R.string.err_one_more, error.max, error.count)
        else stringResource(R.string.err_some_more, error.remaining, error.max, error.count)
    is AttachError.NotAdded -> stringResource(R.string.err_not_added, attachErrorText(error.cause))
}

/** 输入栏上方的提示（.notion-error）：浅红底、圆角 4.8、内边距 8.8×10.4、字 12.8，下距 12。 */
@Composable
fun ComposerError(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier.fillMaxWidth().padding(bottom = 12.dp).clip(RoundedCornerShape(4.8.dp))
            .background(Color(0xA6FFE2DD)).padding(horizontal = 10.4.dp, vertical = 8.8.dp),
        color = Color(0xFF933B34),
        fontSize = 12.8.sp,
        lineHeight = 19.2.sp,
    )
}

/** 选好的附件：图片是 96 的缩略图（圆角 6、右上角 24 的移除键），其他文件是可点掉的标签；间距 8，下距 12。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PendingFiles(files: List<LocalFile>, enabled: Boolean, onRemove: (String) -> Unit, modifier: Modifier = Modifier) {
    FlowRow(
        modifier.fillMaxWidth().padding(bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        files.forEach { file ->
            if (file.isImage) {
                val shape = RoundedCornerShape(6.dp)
                Box(Modifier.size(96.dp).clip(shape).border(1.dp, Sm.Border, shape)) {
                    AsyncImage(file.uri, file.name, Modifier.fillMaxWidth().fillMaxHeight(), contentScale = ContentScale.Crop)
                    val label = stringResource(R.string.remove_image)
                    Box(
                        Modifier.align(Alignment.TopEnd).padding(top = 6.dp, end = 6.dp).size(24.dp).clip(RoundedCornerShape(4.dp))
                            .background(Color(0x8C000000)).clickable(enabled) { onRemove(file.uri) }
                            .semantics { contentDescription = label; role = Role.Button },
                        Alignment.Center,
                    ) {
                        LucideIcon(Lucide.X, 15.dp, Color.White)
                    }
                }
            } else {
                val shape = RoundedCornerShape(4.dp)
                Row(
                    Modifier.clip(shape).background(Sm.Sidebar).border(1.dp, Sm.Border, shape)
                        .clickable(enabled) { onRemove(file.uri) }.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    LucideIcon(Lucide.Paperclip, 13.dp, Sm.Muted)
                    Text(
                        file.name, Modifier.weight(1f, fill = false),
                        color = Sm.Muted, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    LucideIcon(Lucide.X, 13.dp, Sm.Muted)
                }
            }
        }
    }
}

/** 输入栏下方的小字（上距 8、左右 4、12 灰）：已附上的数量和总大小，上传时是进度。 */
@Composable
fun ComposerStatus(files: List<LocalFile>, upload: UploadProgress?, modifier: Modifier = Modifier) {
    val lines = buildList {
        if (files.isNotEmpty()) {
            add(stringResource(R.string.attached_count, files.size, MAX_UPLOAD_FILES) + " · " + formatUploadSize(files.sumOf { it.size }))
        }
        when (upload) {
            UploadProgress.Preparing -> add(stringResource(R.string.upload_preparing))
            is UploadProgress.Uploading -> add(stringResource(R.string.upload_progress, upload.index, upload.total, upload.name, upload.percent))
            null -> Unit
        }
    }
    lines.forEach { line ->
        Text(line, modifier.padding(top = 8.dp, start = 4.dp, end = 4.dp), color = Sm.Muted, fontSize = 12.sp, lineHeight = 16.sp)
    }
}

/** 「生成图片」模式打开时，输入框上方的可点掉的标记（.image-mode-chip）：高 32、浅蓝底、蓝字 14。 */
@Composable
fun ImageModeChip(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val label = stringResource(R.string.image_mode_off)
    Row(
        modifier.padding(start = 4.dp).height(32.dp).clip(CircleShape).background(Color(0x1F2383E2))
            .clickable(onClick = onClick).padding(horizontal = 11.2.dp)
            .semantics(mergeDescendants = true) { contentDescription = label; role = Role.Button },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.4.dp),
    ) {
        LucideIcon(Lucide.ImagePlus, 16.dp, Sm.Blue)
        Text(stringResource(R.string.create_image), color = Sm.Blue, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        LucideIcon(Lucide.X, 14.dp, Sm.Blue)
    }
}

/** 点「＋」后从底部出来的抽屉：添加文件，或切换「生成图片」。外观与模型抽屉相同。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachSheet(imageMode: Boolean, onPickFiles: () -> Unit, onToggleImageMode: () -> Unit, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    fun closeThen(action: () -> Unit) {
        scope.launch { sheetState.hide() }.invokeOnCompletion {
            onDismiss()
            action()
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Color.White,
        shape = RoundedCornerShape(topStart = 17.6.dp, topEnd = 17.6.dp),
        scrimColor = Color(0x590F0F0F),
        tonalElevation = 0.dp,
        dragHandle = {
            Box(Modifier.padding(top = 12.dp, bottom = 8.dp).size(width = 40.dp, height = 4.dp).clip(CircleShape).background(Sm.SheetGrab))
        },
    ) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp).windowInsetsPadding(WindowInsets.navigationBars)) {
            AttachRow(Lucide.Paperclip, stringResource(R.string.attach_files), null, pressed = false, checked = false) {
                closeThen(onPickFiles)
            }
            AttachRow(
                Lucide.ImagePlus,
                stringResource(R.string.create_image),
                stringResource(if (imageMode) R.string.create_image_on else R.string.create_image_desc),
                pressed = imageMode,
                checked = imageMode,
            ) {
                closeThen(onToggleImageMode)
            }
        }
    }
}

// .attach-row：最小高 60、圆角 11.2、内边距 6.4×13.6、图标 22 与文字间距 14.4；标题 17 半粗，说明 14 灰。
@Composable
private fun AttachRow(icon: List<String>, title: String, detail: String?, pressed: Boolean, checked: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 60.dp).clip(RoundedCornerShape(11.2.dp))
            .background(if (pressed) Sm.Hover else Color.Transparent).clickable(onClick = onClick)
            .padding(horizontal = 13.6.dp, vertical = 6.4.dp)
            .semantics(mergeDescendants = true) { role = Role.Button; if (detail != null) stateDescription = detail },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.4.dp),
    ) {
        LucideIcon(icon, 22.dp, Sm.Text)
        Column(Modifier.weight(1f)) {
            Text(title, color = Sm.Text, fontSize = 17.sp, lineHeight = 25.5.sp, fontWeight = FontWeight.SemiBold)
            if (detail != null) Text(detail, color = Sm.Muted, fontSize = 14.sp, lineHeight = 21.sp)
        }
        if (checked) LucideIcon(Lucide.Check, 20.dp, Sm.Text)
    }
}

/**
 * 图片生成中的占位卡片（.generated-image-placeholder）：最宽 448、1px 描边、圆角 5.6；
 * 上面一行是图标 + 两行说明 + 三个跳动的点，下面是 16:9 的浅灰画布，底部有一条来回的蓝色进度线。
 */
@Composable
fun GeneratingImagePreview(modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(5.6.dp)
    val motion = rememberInfiniteTransition(label = "generating-image")
    Column(modifier.widthIn(max = 448.dp).fillMaxWidth().clip(shape).background(Color.White).border(1.dp, Sm.BorderStrong, shape)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp)
                .drawBehind { drawLine(Sm.Border, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
                .padding(horizontal = 12.dp, vertical = 10.4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.4.dp),
        ) {
            Box(Modifier.size(30.4.dp).clip(RoundedCornerShape(4.8.dp)).background(Sm.Sidebar), Alignment.Center) {
                LucideIcon(Lucide.ImagePlus, 18.dp, Sm.Muted, strokeWidth = 1.7f)
            }
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.generating_image), color = Sm.Text, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
                Text(stringResource(R.string.generating_image_wait), Modifier.padding(top = 2.dp), color = Sm.Muted, fontSize = 12.sp, lineHeight = 16.sp)
            }
            Row(Modifier.padding(end = 2.4.dp), horizontalArrangement = Arrangement.spacedBy(3.2.dp)) {
                repeat(3) { index ->
                    // 1.2 秒一轮：30% 处最亮并上移 2，其余时间 0.35；三个点依次错开 150 毫秒。
                    val phase by motion.animateFloat(
                        0f, 0f,
                        infiniteRepeatable(
                            keyframes {
                                durationMillis = 1200
                                0f at 0
                                1f at 360
                                0f at 720
                            },
                            initialStartOffset = StartOffset(index * 150),
                        ),
                        label = "dot$index",
                    )
                    Box(Modifier.offset(y = (-2 * phase).dp).size(3.84.dp).alpha(0.35f + 0.65f * phase).clip(CircleShape).background(Sm.Faint))
                }
            }
        }
        val sweep by motion.animateFloat(
            0f, 1f, infiniteRepeatable(keyframes { durationMillis = 1800; 0f at 0 using LinearEasing; 1f at 990; 1f at 1800 }, RepeatMode.Restart),
            label = "progress",
        )
        Box(
            Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Sm.Sidebar).drawBehind {
                // 进度线：宽 42%、高 2，从左侧外面滑到右侧外面。
                val width = size.width * 0.42f
                val x = -1.05f * width + sweep * (2.40f + 1.05f) * width
                drawRect(Sm.Blue, Offset(x, size.height - 2.dp.toPx()), Size(width, 2.dp.toPx()))
                // 掠过画布的高光。
                val sheen = -size.width + sweep * 2 * size.width
                drawRect(
                    Brush.linearGradient(
                        0.28f to Color.Transparent, 0.48f to Color(0xB3FFFFFF), 0.68f to Color.Transparent,
                        start = Offset(sheen, 0f), end = Offset(sheen + size.width, size.height * 0.18f),
                    ),
                )
            },
            Alignment.Center,
        ) {
            LucideIcon(Lucide.ImagePlus, 28.dp, Sm.Faint, strokeWidth = 1.5f)
        }
    }
}
