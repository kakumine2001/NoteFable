package com.kakumine.studymate.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
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
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import com.kakumine.studymate.R
import com.kakumine.studymate.data.ATTACHMENT_PICKER_TYPES
import com.kakumine.studymate.data.AttachError
import com.kakumine.studymate.data.LocalFile
import com.kakumine.studymate.data.MAX_UPLOAD_FILES
import com.kakumine.studymate.data.MAX_UPLOAD_FILE_BYTES
import com.kakumine.studymate.data.formatUploadSize
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// 附件与「生成图片」模式的界面。数值来自网页（src/app/[locale]/app/page.tsx 的输入栏、attach-sheet.tsx、globals.css）。

/** 打开系统文件选择器；选好后读出文件名、类型和大小交给 [onPicked]。 */
@Composable
fun rememberFilePicker(onPicked: (List<LocalFile>) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        // 读文件名和大小要访问文件提供方，放到后台线程，不卡界面。
        scope.launch {
            val files = withContext(Dispatchers.IO) { uris.mapNotNull { readLocalFile(context, it) } }
            onPicked(files)
        }
    }
    return { launcher.launch(ATTACHMENT_PICKER_TYPES) }
}

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
