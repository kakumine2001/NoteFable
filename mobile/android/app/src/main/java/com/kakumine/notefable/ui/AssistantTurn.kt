package com.kakumine.notefable.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import coil3.compose.AsyncImage
import com.kakumine.notefable.R
import com.kakumine.notefable.NoteFableApp
import com.kakumine.notefable.data.ActivityStep
import com.kakumine.notefable.data.GeneratedImageDto
import com.kakumine.notefable.data.ImageSaver
import com.kakumine.notefable.data.ProposalStore
import com.kakumine.notefable.data.mergeProposals
import com.kakumine.notefable.data.progressSteps
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

// 回答一回合（网页 chat-message.tsx 的助手部分），从上到下：
// 标签 → 过程面板（等待中或有步骤时）→ 生成的图片 / 生成中占位 → 正文 → 提案卡片 → 失败文 → 操作行。
// 数值来自网页 412x915 的实测（见 docs/architecture/android-native.md 的对照表）。

/** 回答里"打开笔记"（项目参考笔记、提案的 Open the note）的去处。由 NoteFableRoot 接到笔记页。 */
val LocalOpenNote = staticCompositionLocalOf<(String) -> Unit> { {} }

private val ActionErrorText = TextStyle(fontSize = 13.sp, lineHeight = 18.2.sp, color = Color(0xFF933B34), letterSpacing = 0.sp)

@Composable
internal fun AssistantTurn(message: UiMessage, modelLabel: String?) {
    val systemText = rememberSystemText()
    val openNote = LocalOpenNote.current
    val app = LocalContext.current.applicationContext as? NoteFableApp
    val saveImage = rememberImageSaver()
    // 网页 shouldShowThinking：还在等、没有正文也没有图片。
    val thinking = message.streaming && message.content.isEmpty() && message.images.isEmpty()
    val progress = remember(message.activity) { message.activity.progressSteps() }
    val failureStep = message.activity.firstOrNull { it is ActivityStep.Failure } as? ActivityStep.Failure
    val proposals = remember(message.proposals, message.activity) { mergeProposals(message.proposals, message.activity) }

    Column(Modifier.fillMaxWidth()) {
        // "NoteFable · 模型名"：图标 12（设置里换过就是那个表情 / 图片，否则品牌标志），间距 5.6；模型名不转大写，字距 .02em。
        Row(Modifier.padding(bottom = 7.2.dp), verticalAlignment = Alignment.CenterVertically) {
            AppIcon(12.dp, Sm.Ink)
            Spacer(Modifier.width(5.6.dp))
            Text("NOTEFABLE", style = RoleLabelBase)
            if (modelLabel != null) {
                Spacer(Modifier.width(5.6.dp))
                Text("· $modelLabel", style = RoleLabelBase.copy(letterSpacing = 0.24.sp))
            }
        }
        if (thinking || progress.isNotEmpty()) {
            // 等待中是已等的秒数，完成后是正文出现前用的秒数（最少 1 秒）。
            val seconds = if (thinking) rememberWaitingSeconds(message.startedAt)
            else message.thinkingMs?.let { maxOf(1, (it / 1000.0).roundToInt()) }
            ChatActivity(progress, thinking, seconds, onOpenNote = openNote)
        }
        if (message.images.isNotEmpty()) {
            // .generated-image-grid：最宽 576、间距 12、下距 13.6；每张圆角 4.8、1px #e2e8f0、#f8fafc 底，右下角是下载键。
            Column(Modifier.widthIn(max = 576.dp).padding(bottom = 13.6.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                message.images.forEach { image -> GeneratedImage(image) { saveImage(image) } }
            }
        }
        if (message.generatingImage && message.images.isEmpty()) GeneratingImagePreview()
        if (message.content.isNotEmpty()) {
            SelectionContainer {
                // 使用上限的句子只翻译（网页 t(message.content)），其它回答只替换末尾的"Request failed: …"。
                AnswerMarkdown(
                    if (message.usageLimit) systemText.t(message.content)
                    else systemText.localizeFailure(message.content, message.failure ?: failureStep?.info),
                )
            }
        }
        val store = app?.proposals
        if (proposals.isNotEmpty() && store != null) ProposalCards(proposals, store, openNote)
        message.errorDetail?.let { detail ->
            Text(
                stringResource(
                    R.string.request_failed,
                    if (detail == CONNECTION_FAILED) stringResource(R.string.check_connection) else systemText.localize(detail),
                ),
                color = Sm.Danger,
                fontSize = 15.sp,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        // 只给本文完整、没有失败的回答显示操作行（网页 shouldShowAnswerActions：生成中、只有图片、失败时都不显示）。
        val failed = message.errorDetail != null || message.usageLimit
        val turnActions = LocalTurnActions.current
        if (!message.streaming && !failed && !message.generatingImage && message.content.isNotBlank()) {
            AnswerActions(message.key, message.id, message.content, message.versions)
        } else if (!message.streaming && message.versions != null && turnActions != null && message.images.isEmpty()) {
            // 没有操作行的回答（没有正文）也要能切换版本（网页 chat-message.tsx 的同一分支）。
            Box(Modifier.padding(top = 6.4.dp).offset(x = (-10.4).dp)) {
                VersionNav(message.versions, turnActions.busy, turnActions.showVersion)
            }
        } else if (!message.streaming && !failed && !message.generatingImage && message.images.isNotEmpty()) {
            // 只有图片的回答没有复制 / "…"，但要能报告（网页 ReportAnswerButton，Google Play 的 AI 生成内容政策）。
            ReportOnlyAction(message.id)
        }
    }
}

@Composable
private fun ProposalCards(proposals: List<com.kakumine.notefable.data.Proposal>, store: ProposalStore, openNote: (String) -> Unit) {
    val local by store.states.collectAsState()
    proposals.forEach { proposal ->
        androidx.compose.runtime.key(proposal.id) {
            ProposalCard(
                proposal = proposal,
                state = store.stateOf(proposal, local),
                onApply = { store.apply(proposal) },
                onDiscard = { store.discard(proposal) },
                onOpen = openNote,
            )
        }
    }
}

// 操作行（网页 answer-actions.tsx，手机）：36x36 的按钮，整体左移 10.4 让图标和正文左边缘对齐，距正文 6.4。
// 复制后图标换成 ✓ 停 2 秒；复制失败在下面一行显示红字。"…"菜单（存到笔记、下载对话）见 AnswerActions.kt。
// 错误和网页一样只有一处（error）：有"…"时复制失败也放进它的 error，任何一个操作开始时都清掉上一条。
// key 是列表项的 key（对账换 ID 时不变），菜单状态跟着它，不跟着 ID。
@Composable
private fun AnswerActions(key: String, messageId: String, content: String, versions: com.kakumine.notefable.data.MessageVersions?) {
    val more = rememberAnswerMoreState(key, messageId, content)
    val turnActions = LocalTurnActions.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copiedTick by remember { mutableIntStateOf(0) }
    var failed by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(copiedTick) {
        if (copiedTick > 0) {
            delay(2000)
            copiedTick = 0
        }
    }
    val copyLabel = stringResource(R.string.copy)
    // 网页复制后有一段读屏才读的"Copied"：复制成功的 2 秒内把按钮的说明换成它。
    val copiedLabel = stringResource(R.string.answer_copied)
    Column(Modifier.padding(top = 6.4.dp).offset(x = (-10.4).dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
            // 重新生成过的回答：最前面是「‹ 2/3 ›」。
            if (versions != null && turnActions != null) VersionNav(versions, turnActions.busy, turnActions.showVersion)
            Box(
                Modifier.size(36.dp).clip(RoundedCornerShape(4.8.dp)).clickable {
                    failed = false
                    more?.error = null
                    scope.launch {
                        val ok = try {
                            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("NoteFable", content)))
                            true
                        } catch (e: CancellationException) {
                            throw e
                        } catch (_: Throwable) {
                            false
                        }
                        when {
                            ok -> copiedTick++
                            more != null -> more.error = MenuError.Copy
                            else -> failed = true
                        }
                    }
                }.semantics { contentDescription = if (copiedTick > 0) copiedLabel else copyLabel; role = Role.Button },
                Alignment.Center,
            ) {
                if (copiedTick > 0) LucideIcon(Lucide.Check, 16.dp, Sm.Muted, strokeWidth = 2f)
                else LucideIcon(Lucide.Copy, 16.dp, Sm.Muted, strokeWidth = 1.9f)
            }
            if (more != null) AnswerMoreButton(more)
        }
        if (more != null) AnswerMoreRowError(more)
        else if (failed) {
            Text(
                stringResource(R.string.answer_copy_failed),
                style = ActionErrorText,
                modifier = Modifier.padding(start = 8.dp, top = 2.4.dp),
            )
        }
    }
}

// .generated-image-shell + .generated-image-download：下载键 44 圆形、#0f172a .72 底、白色 Download 20，
// 离右下角各 14.4，阴影 0 12 30 .28。
@Composable
private fun GeneratedImage(image: GeneratedImageDto, onSave: () -> Unit) {
    val description = stringResource(R.string.image_download)
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(4.8.dp))) {
        AsyncImage(
            model = remember(image.dataUrl) { imageModel(image.dataUrl) },
            contentDescription = stringResource(R.string.generated_image),
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(4.8.dp))
                .background(Color(0xFFF8FAFC)).border(1.dp, Color(0xFFE2E8F0), RoundedCornerShape(4.8.dp)),
        )
        Box(
            Modifier.align(Alignment.BottomEnd).padding(end = 14.4.dp, bottom = 14.4.dp).size(44.dp)
                .shadow(12.dp, CircleShape, ambientColor = Color(0x470F172A), spotColor = Color(0x470F172A))
                .clip(CircleShape).background(Color(0xB80F172A))
                .clickable(role = Role.Button, onClick = onSave)
                .semantics { contentDescription = description },
            Alignment.Center,
        ) {
            LucideIcon(Lucide.Download, 20.dp, Color.White)
        }
    }
}

/**
 * 生成图片的"下载"：存进相册的 Pictures，成功后用系统的"打开方式"打开（与笔记文件下载一致，提示用网页已有的 "Downloading…"）。
 * Android 8–9 先申请存储写入权限（清单里 maxSdkVersion=28）。
 */
@Composable
private fun rememberImageSaver(): (GeneratedImageDto) -> Unit {
    val context = LocalContext.current
    var pending by remember { mutableStateOf<GeneratedImageDto?>(null) }
    // 在 App 级的作用域里存：这一回合滚出屏幕、或对账换了消息 ID 时，下载不被取消。
    val save: (GeneratedImageDto) -> Unit = { image ->
        (context.applicationContext as? NoteFableApp)?.let { app -> app.scope.launch { saveImage(app, image) } }
    }
    val currentSave by rememberUpdatedState(save)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val image = pending
        pending = null
        if (granted && image != null) currentSave(image)
    }
    return remember(context) {
        { image: GeneratedImageDto ->
            val needsPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
            if (needsPermission) {
                pending = image
                permission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            } else {
                currentSave(image)
            }
        }
    }
}

private suspend fun saveImage(context: Context, image: GeneratedImageDto) {
    val app = context.applicationContext as? NoteFableApp ?: return
    Toast.makeText(context, R.string.downloading, Toast.LENGTH_SHORT).show()
    val (uri, mimeType) = try {
        ImageSaver.save(context, app.api.httpClient, image, app.api::absoluteUrl)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        val reason = e.message ?: e.javaClass.simpleName
        Toast.makeText(context, context.getString(R.string.request_failed, reason), Toast.LENGTH_LONG).show()
        return
    }
    // 媒体库没扫到（Android 8–9 偶尔会）就不打开：file:// 地址交给别的 App 会抛 FileUriExposedException。图片已经存好了。
    if (uri == null) return
    val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    try {
        context.startActivity(Intent.createChooser(view, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        // 没有能打开图片的 App：图片已经在相册里了。
    } catch (_: RuntimeException) {
        // 其它打不开的情况（如 FileUriExposedException）同样不影响已存好的图片。
    }
}

// 只有"报告"一个按钮的操作行（网页 ReportAnswerButton）：和操作行同样 36x36、左移 10.4、上距 6.4，旗子 16。
// 还没换成服务端 ID（local-N）的回答不显示。
@Composable
private fun ReportOnlyAction(messageId: String) {
    if (messageId.startsWith("local-")) return
    var open by remember { mutableStateOf(false) }
    val label = stringResource(R.string.report_answer)
    Box(
        Modifier.padding(top = 6.4.dp).offset(x = (-10.4).dp).size(36.dp).clip(RoundedCornerShape(4.8.dp))
            .clickable { open = true }.semantics { contentDescription = label; role = Role.Button },
        Alignment.Center,
    ) {
        LucideIcon(FlagIcon, 16.dp, Sm.Muted, strokeWidth = 1.9f)
    }
    if (open) ReportAnswerDialog(messageId, onClose = { open = false })
}
