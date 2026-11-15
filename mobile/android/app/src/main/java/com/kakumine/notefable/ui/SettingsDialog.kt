package com.kakumine.notefable.ui

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
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.draw.drawBehind
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
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AccountUser
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.MAX_CUSTOM_INSTRUCTIONS
import com.kakumine.notefable.data.serverMessage
import kotlinx.coroutines.launch

private val SettingsShadow = Color(0x1F0F0F0F) // --notion-shadow
private val SettingsRing = Color(0x0D0F0F0F)

/** 要不要发保存：和读到的一样（去掉首尾空白后）就不发（网页 SettingsDialog.save）。 */
fun customInstructionsChanged(initial: String, draft: String): Boolean = draft.trim() != initial

/**
 * 设置（网页 SettingsDialog，从侧栏的账号行打开；登录后才有）：个人资料、界面语言、图标、自定义指令、退出登录都在这一处。
 * 资料、语言和图标改了就存，只有自定义指令要按"保存"。
 * 外观和项目设置用同一套 dialog.chat-project-settings 的手机尺寸（见 ProjectSettings.kt）：宽 374（412 屏宽时）、圆角 8；
 * 头部 16/16/8（标题 16/600）；正文左右 16、下 16，各栏间距 20；最后一栏上方 1px 线、上内边距 8，是"退出登录"；
 * 底部 1px 线 + 取消 / 保存靠右。
 * 关闭（返回键、点遮罩）：保存中、选照片 / 裁剪 / 上传照片时不关；头像编辑区开着时先只关编辑区。"取消"直接关（编辑区一起），
 * 保存中和照片忙时不可点。不管怎么关，输入中的名字都先存掉。
 */
@Composable
internal fun SettingsDialog(
    user: AccountUser,
    account: AccountUiState,
    profile: AccountViewModel,
    editor: AvatarEditor,
    picked: String?,
    pickerOpen: Boolean,
    appIcon: AppIconEditor,
    onPickAppIconImage: () -> Unit,
    onEditor: (AvatarEditor) -> Unit,
    onPickPhoto: () -> Unit,
    onCancelCrop: () -> Unit,
    onPhotoSaved: () -> Unit,
    onSignOut: () -> Unit,
    deleteAccount: suspend () -> Throwable?,
    onClose: () -> Unit,
) {
    var attempt by remember { mutableIntStateOf(0) }
    // 读到的指令；null 是还没读到。
    var initial by remember { mutableStateOf<String?>(null) }
    var loadError by remember { mutableStateOf<Throwable?>(null) }
    var instructions by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    // 正在删除账号：和保存中一样不关对话框、不让按其他按钮。
    var deleting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val system = rememberSystemText()

    // 名字的输入框：没在编辑时跟着保存后的名字走（保存失败回滚时不盖掉用户接着输入、还没发出的文字）。
    val savedName = user.displayName ?: user.googleName ?: ""
    var nameDraft by remember { mutableStateOf(savedName) }
    var editingName by remember { mutableStateOf(false) }
    LaunchedEffect(savedName) { if (!editingName) nameDraft = savedName }

    // 选了照片还没存、或正在上传：网页 photoBusy。
    val photoBusy = picked != null || account.uploading
    val closeNow = {
        profile.saveName(nameDraft)
        onClose()
    }

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
        if (busy || photoBusy) return@save
        if (!customInstructionsChanged(loaded, instructions)) {
            closeNow()
            return@save
        }
        busy = true
        error = null
        scope.launch {
            val failure = profile.saveCustomInstructions(instructions)
            busy = false
            if (failure == null) closeNow() else error = failure
        }
    }

    Dialog(
        onDismissRequest = {
            when {
                busy || deleting || pickerOpen || account.uploading -> Unit
                // 编辑区开着（包括选好照片在裁剪）：先只关编辑区（网页 closeGuard）。
                editor != AvatarEditor.Closed -> onEditor(AvatarEditor.Closed)
                else -> closeNow()
            }
        },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
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
                ProfileSettings(
                    user = user,
                    account = account,
                    profile = profile,
                    draft = nameDraft,
                    onDraft = { nameDraft = it },
                    editing = editingName,
                    onEditing = { editingName = it },
                    editor = editor,
                    picked = picked,
                    onEditor = onEditor,
                    onPickPhoto = onPickPhoto,
                    onCancelCrop = onCancelCrop,
                    onPhotoSaved = onPhotoSaved,
                )
                account.profileError?.let {
                    val text = when (it) {
                        is ProfileError.Server -> system.localize(it.message)
                        ProfileError.CouldNotSave -> stringResource(R.string.acct_could_not_save)
                    }
                    Text(text, color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp))
                }

                Spacer(Modifier.size(20.dp))
                LanguageSettings(user, onChoose = profile::setLocale)

                Spacer(Modifier.size(20.dp))
                AppIconSettings(appIcon, onPickImage = onPickAppIconImage)

                Spacer(Modifier.size(20.dp))
                CustomInstructionsSection(
                    initial = initial,
                    loadError = loadError?.let { (it as? ApiException)?.serverMessage()?.let(system::localize) ?: stringResource(R.string.acct_err_load_custom_instructions) },
                    instructions = instructions,
                    onInstructions = { instructions = clipInstructions(it, MAX_CUSTOM_INSTRUCTIONS) },
                    busy = busy,
                    onRetry = { loadError = null; attempt++ },
                )
                error?.let {
                    Text(
                        (it as? ApiException)?.serverMessage()?.let(system::localize) ?: stringResource(R.string.acct_err_save_custom_instructions),
                        color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp),
                    )
                }

                // .settings-account：上方 1px 线、上内边距 8。
                Column(
                    Modifier.padding(top = 20.dp).fillMaxWidth()
                        .drawBehind { drawRect(Sm.Border, size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }
                        .padding(top = 8.dp),
                ) {
                    SettingsInlineAction(Lucide.LogOut, stringResource(R.string.sign_out), enabled = !busy && !deleting && !photoBusy && !account.signingOut) {
                        // 输入中的名字先排进保存队列，signOut 会等它发完。
                        profile.saveName(nameDraft)
                        onSignOut()
                    }
                    DeleteAccountSection(
                        enabled = !busy && !photoBusy && !account.signingOut,
                        onBusyChange = { deleting = it },
                        deleteAccount = deleteAccount,
                        onDeleted = closeNow,
                    )
                }
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 1.dp).background(Sm.Border))
            Row(
                Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            ) {
                NotionButton(stringResource(R.string.cancel), onClick = closeNow, enabled = !busy && !deleting && !photoBusy)
                NotionButton(
                    stringResource(if (busy) R.string.sb_saving else R.string.save), onClick = save,
                    enabled = !busy && !deleting && !photoBusy && initial != null, primary = true,
                )
            }
        }
    }
}

// 自定义指令一栏：标题 + 计数（读到后才有）、说明、读取中 / 失败 + 重试、输入框。
@Composable
private fun CustomInstructionsSection(
    initial: String?,
    loadError: String?,
    instructions: String,
    onInstructions: (String) -> Unit,
    busy: Boolean,
    onRetry: () -> Unit,
) {
    SettingsSectionLabel(stringResource(R.string.acct_custom_instructions), if (initial != null) "${instructions.length}/$MAX_CUSTOM_INSTRUCTIONS" else "", full = false)
    SettingsHelpText(stringResource(R.string.acct_custom_instructions_help))
    when {
        loadError != null -> {
            Text(loadError, color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp))
            NotionButton(stringResource(R.string.try_again), onClick = onRetry, modifier = Modifier.padding(top = 8.dp))
        }
        initial == null -> Row(Modifier.padding(top = 9.6.dp), verticalAlignment = Alignment.CenterVertically) {
            SpinningLoader(14.dp)
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.sb_loading), color = Sm.Muted, fontSize = 13.sp)
        }
        else -> InstructionsField(instructions, onInstructions, enabled = !busy,
            label = stringResource(R.string.acct_custom_instructions), placeholder = stringResource(R.string.acct_custom_instructions_placeholder))
    }
}
