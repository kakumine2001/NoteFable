package com.kakumine.studymate.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.kakumine.studymate.R
import com.kakumine.studymate.data.ApiException
import com.kakumine.studymate.data.MAX_CUSTOM_INSTRUCTIONS
import com.kakumine.studymate.data.serverMessage
import kotlinx.coroutines.launch

private val SettingsDanger = Color(0xFFB91C1C) // .project-settings-error
private val SettingsShadow = Color(0x1F0F0F0F) // --notion-shadow
private val SettingsRing = Color(0x0D0F0F0F)

/** 要不要发保存：和读到的一样（去掉首尾空白后）就不发（网页 SettingsDialog.save）。 */
fun customInstructionsChanged(initial: String, draft: String): Boolean = draft.trim() != initial

/**
 * 设置（网页 SettingsDialog，从个人资料弹层的"设置"打开；登录后才有）。现在只有自定义指令：适用于所有聊天的自己的指示。
 * 外观和项目设置用同一套 dialog.chat-project-settings 的手机尺寸（见 ProjectSettings.kt）：宽 374（412 屏宽时）、圆角 8；
 * 头部 16/16/8（标题 16/600，没有副标题）；正文左右 16、下 16；底部 1px 线 + 取消 / 保存靠右。返回键和点遮罩关闭，保存中不关。
 */
@Composable
fun SettingsDialog(profile: AccountViewModel, onClose: () -> Unit) {
    var attempt by remember { mutableIntStateOf(0) }
    // 读到的指令；null 是还没读到。
    var initial by remember { mutableStateOf<String?>(null) }
    var loadError by remember { mutableStateOf<Throwable?>(null) }
    var instructions by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    val scope = rememberCoroutineScope()
    val system = rememberSystemText()

    LaunchedEffect(attempt) {
        profile.loadCustomInstructions()
            .onSuccess {
                initial = it
                instructions = it
            }
            .onFailure { loadError = it }
    }

    val save: () -> Unit = save@{
        val loaded = initial ?: return@save
        if (busy) return@save
        if (!customInstructionsChanged(loaded, instructions)) {
            onClose()
            return@save
        }
        busy = true
        error = null
        scope.launch {
            val failure = profile.saveCustomInstructions(instructions)
            busy = false
            if (failure == null) onClose() else error = failure
        }
    }

    Dialog(onDismissRequest = { if (!busy) onClose() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        LaunchedEffect(window) { window?.setDimAmount(0.2f) }
        Column(
            Modifier.padding(horizontal = 19.dp).widthIn(max = 544.dp).fillMaxWidth()
                .heightIn(max = (LocalConfiguration.current.screenHeightDp - 38).coerceAtLeast(200).dp)
                .shadow(14.dp, RoundedCornerShape(8.dp), ambientColor = SettingsShadow, spotColor = SettingsShadow)
                .border(1.dp, SettingsRing, RoundedCornerShape(8.dp))
                .clip(RoundedCornerShape(8.dp)).background(Color.White),
        ) {
            Text(
                stringResource(R.string.acct_settings), color = Sm.Text, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
            )
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp)) {
                val failedLoad = loadError
                when {
                    failedLoad != null -> {
                        Text(
                            (failedLoad as? ApiException)?.serverMessage()?.let(system::localize) ?: stringResource(R.string.acct_err_load_custom_instructions),
                            color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp),
                        )
                        NotionButton(stringResource(R.string.try_again), onClick = { loadError = null; attempt++ }, modifier = Modifier.padding(top = 8.dp))
                    }
                    initial == null -> Row(Modifier.padding(top = 9.6.dp), verticalAlignment = Alignment.CenterVertically) {
                        val spin by rememberInfiniteTransition(label = "settings-loading").animateFloat(
                            0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing), RepeatMode.Restart), label = "spin",
                        )
                        Box(Modifier.rotate(spin)) { LucideIcon(Lucide.LoaderCircle, 14.dp, Sm.Muted) }
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.sb_loading), color = Sm.Muted, fontSize = 13.sp)
                    }
                    else -> {
                        SettingsSectionLabel(stringResource(R.string.acct_custom_instructions), "${instructions.length}/$MAX_CUSTOM_INSTRUCTIONS", full = false)
                        SettingsHelpText(stringResource(R.string.acct_custom_instructions_help))
                        InstructionsField(instructions, { instructions = it.take(MAX_CUSTOM_INSTRUCTIONS) }, enabled = !busy,
                            label = stringResource(R.string.acct_custom_instructions), placeholder = stringResource(R.string.acct_custom_instructions_placeholder))
                    }
                }
                error?.let {
                    Text(
                        (it as? ApiException)?.serverMessage()?.let(system::localize) ?: stringResource(R.string.acct_err_save_custom_instructions),
                        color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp),
                    )
                }
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 1.dp).background(Sm.Border))
            Row(
                Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            ) {
                NotionButton(stringResource(R.string.cancel), onClick = onClose, enabled = !busy)
                NotionButton(
                    stringResource(if (busy) R.string.sb_saving else R.string.save), onClick = save,
                    enabled = !busy && initial != null, primary = true,
                )
            }
        }
    }
}
