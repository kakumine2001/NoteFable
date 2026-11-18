package com.kakumine.notefable.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AccountUser
import com.kakumine.notefable.data.ApiException
import com.kakumine.notefable.data.MAX_CUSTOM_INSTRUCTIONS
import com.kakumine.notefable.data.serverMessage
import kotlinx.coroutines.launch

private val SavedGreen = Color(0xFF15803D) // .settings-saved

/** 有没有没保存的改动：和读到的一样（去掉首尾空白后）就没有（网页 SettingsDialog 的 dirty）。 */
fun customInstructionsChanged(initial: String, draft: String): Boolean = draft.trim() != initial

/**
 * 设置（网页 SettingsDialog 的手机宽度，从侧栏的账号行打开；登录后才有）。全屏：灰底（--notion-sidebar），
 * 顶栏高 56、左右 10.4：返回键 40（ArrowLeft 20）+ 间距 4 +"设置"17/650 墨色；下面左右 16、上 8、下 32 的滚动区，
 * 各栏是白色卡片（圆角 12、1px 细线），栏间距 24，栏标题 13/550 灰：
 * 个人资料（没有栏标题）、方案、通用（语言、图标）、个性化（自定义指令）、账号（退出登录、删除账号）。
 * 资料、语言和图标改了就存。只有自定义指令要按"保存"：改了以后下方浮出"未保存的更改"条（放弃 / 保存），
 * 保存或放弃之前不关（返回键、顶栏的返回都只让那条晃一下），不会不声不响地丢掉。保存后留在设置里，标题右边显示"已保存"。
 * 关闭：保存中、删除中、选照片 / 上传照片时不关；头像编辑区开着时先只关编辑区。不管怎么关，输入中的名字都先存掉。
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
    // 刚保存完：标题右边显示"已保存"，再改就消失。
    var justSaved by remember { mutableStateOf(false) }
    // 没保存就想关的次数：每变一次，"未保存的更改"条晃一下。
    var attention by remember { mutableIntStateOf(0) }
    // 正在删除账号：和保存中一样不关、不让按其他按钮。
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
    val dirty = initial?.let { customInstructionsChanged(it, instructions) } == true
    val closeNow = {
        profile.saveName(nameDraft)
        onClose()
    }
    // 返回键（网页 close）。
    val requestClose: () -> Unit = {
        when {
            busy || deleting || pickerOpen || account.uploading -> Unit
            // 编辑区开着（包括选好照片在裁剪）：先只关编辑区（网页 closeGuard）。
            editor != AvatarEditor.Closed -> onEditor(AvatarEditor.Closed)
            appIcon.picking -> appIcon.picking = false
            dirty -> attention++
            else -> closeNow()
        }
    }
    // 顶栏的返回（网页 closeAll）：头像编辑区开着也一起关；选了照片还没存、在上传时不关。
    val closeAll: () -> Unit = {
        when {
            busy || deleting || photoBusy -> Unit
            dirty -> attention++
            else -> closeNow()
        }
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
        if (busy || !dirty) return@save
        val text = instructions.trim()
        busy = true
        error = null
        scope.launch {
            val failure = profile.saveCustomInstructions(text)
            busy = false
            if (failure == null) {
                initial = text
                justSaved = true
                attention = 0
            } else {
                error = failure
            }
        }
    }

    Dialog(
        onDismissRequest = requestClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        val view = LocalView.current
        val window = (view.parent as? DialogWindowProvider)?.window
        LaunchedEffect(window) {
            window ?: return@LaunchedEffect
            window.setDimAmount(0.2f)
            // 全屏的浅色画面：状态栏和导航栏的图标用深色。
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = true
                isAppearanceLightNavigationBars = true
            }
        }
        // 进场（网页 settings-slide）：从下方 16 滑入并淡入，220ms。
        val enter = remember { Animatable(0f) }
        LaunchedEffect(Unit) { enter.animateTo(1f, tween(220, easing = SettingsEase)) }
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer {
                    alpha = enter.value
                    translationY = (1f - enter.value) * 16.dp.toPx()
                }
                .background(Sm.Sidebar).systemBarsPadding().imePadding(),
        ) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 10.4.dp), verticalAlignment = Alignment.CenterVertically) {
                    val back = stringResource(R.string.back)
                    Box(
                        Modifier.size(40.dp).clip(RoundedCornerShape(4.8.dp)).clickable(role = Role.Button, onClick = closeAll)
                            .semantics { contentDescription = back },
                        Alignment.Center,
                    ) {
                        LucideIcon(Lucide.ArrowLeft, 20.dp, Sm.Text)
                    }
                    Spacer(Modifier.width(4.dp))
                    Text(
                        stringResource(R.string.acct_settings), color = Sm.Ink, fontSize = 17.sp, fontWeight = FontWeight(650), maxLines = 1,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                Column(
                    Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                        // 条出来时多留出条的高度，最后一栏不被挡住（.settings-body.has-unsaved）。
                        .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = if (dirty) 96.dp else 32.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    Column {
                        // 名字、头像、语言保存失败的提示：放在最上面（网页 .settings-save-error，下距 12）。
                        account.profileError?.let {
                            val text = when (it) {
                                is ProfileError.Server -> system.localize(it.message)
                                ProfileError.CouldNotSave -> stringResource(R.string.acct_could_not_save)
                            }
                            Text(text, color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(bottom = 12.dp))
                        }
                        SettingsCard(padded = true) {
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
                        }
                    }

                    Column {
                        SettingsGroupLabel(stringResource(R.string.plan_title))
                        SettingsCard(padded = true) { PlanSettings(load = profile::loadPlan) }
                    }

                    Column {
                        SettingsGroupLabel(stringResource(R.string.settings_general))
                        SettingsCard {
                            LanguageSettings(user, onChoose = profile::setLocale)
                            SettingsRowDivider()
                            AppIconSettings(appIcon, onPickImage = onPickAppIconImage)
                        }
                    }

                    Column {
                        SettingsGroupLabel(stringResource(R.string.settings_personalization))
                        SettingsCard(padded = true) {
                            CustomInstructionsSection(
                                initial = initial,
                                loadError = loadError?.let { (it as? ApiException)?.serverMessage()?.let(system::localize) ?: stringResource(R.string.acct_err_load_custom_instructions) },
                                instructions = instructions,
                                onInstructions = {
                                    instructions = clipInstructions(it, MAX_CUSTOM_INSTRUCTIONS)
                                    justSaved = false
                                },
                                busy = busy,
                                saved = justSaved && !dirty,
                                onRetry = { loadError = null; attempt++ },
                            )
                            error?.let {
                                Text(
                                    (it as? ApiException)?.serverMessage()?.let(system::localize) ?: stringResource(R.string.acct_err_save_custom_instructions),
                                    color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 12.dp),
                                )
                            }
                        }
                    }

                    Column {
                        SettingsGroupLabel(stringResource(R.string.account))
                        SettingsCard {
                            SettingsRowButton(Lucide.LogOut, stringResource(R.string.sign_out), enabled = !busy && !deleting && !photoBusy && !account.signingOut) {
                                // 输入中的名字先排进保存队列，signOut 会等它发完。
                                profile.saveName(nameDraft)
                                onSignOut()
                            }
                            SettingsRowDivider()
                            DeleteAccountSection(
                                enabled = !busy && !photoBusy && !account.signingOut,
                                onBusyChange = { deleting = it },
                                deleteAccount = deleteAccount,
                                onDeleted = closeNow,
                            )
                        }
                    }
                }
            }
            if (dirty) {
                UnsavedBar(
                    attention = attention, busy = busy,
                    onDiscard = {
                        instructions = initial.orEmpty()
                        error = null
                        attention = 0
                    },
                    onSave = save,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                )
            }
        }
    }
}

// 自定义指令：标题 15/500 + 右边的计数 12 灰（读到后才有；刚保存完换成绿色的"✓ 已保存"12/500）、说明 13 灰、读取中 / 失败 + 重试、输入框。
@Composable
private fun CustomInstructionsSection(
    initial: String?,
    loadError: String?,
    instructions: String,
    onInstructions: (String) -> Unit,
    busy: Boolean,
    saved: Boolean,
    onRetry: () -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Text(stringResource(R.string.acct_custom_instructions), Modifier.weight(1f), color = Sm.Text, fontSize = 15.sp, lineHeight = 22.5.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.width(8.dp))
        if (saved) {
            Row(
                Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                LucideIcon(Lucide.Check, 13.dp, SavedGreen)
                Text(stringResource(R.string.save_saved), color = SavedGreen, fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium)
            }
        } else if (initial != null) {
            Text("${instructions.length}/$MAX_CUSTOM_INSTRUCTIONS", color = Sm.Muted, fontSize = 12.sp, lineHeight = 18.sp)
        }
    }
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
        else -> SettingsInstructionsField(instructions, onInstructions, enabled = !busy,
            label = stringResource(R.string.acct_custom_instructions), placeholder = stringResource(R.string.acct_custom_instructions_placeholder))
    }
}

// textarea.settings-textarea（手机）：上距 12、最小高 176、1px 深描边、圆角 10、内边距 10×12、16 / 行高 1.55；
// 聚焦时蓝边 + 外侧 3px 的 rgba(35,131,226,.16) 光圈。
@Composable
private fun SettingsInstructionsField(value: String, onChange: (String) -> Unit, enabled: Boolean, label: String, placeholder: String) {
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(10.dp)
    BasicTextField(
        value = value,
        onValueChange = onChange,
        enabled = enabled,
        textStyle = TextStyle(color = Sm.Text, fontSize = 16.sp, lineHeight = 24.8.sp),
        cursorBrush = SolidColor(Sm.Text),
        modifier = Modifier.padding(top = 12.dp).fillMaxWidth().onFocusChanged { focused = it.isFocused }.semantics { contentDescription = label },
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxWidth().heightIn(min = 176.dp)
                    .drawBehind {
                        if (focused) {
                            val ring = 3.dp.toPx()
                            drawRoundRect(
                                SettingsFocusRing, topLeft = Offset(-ring, -ring), size = Size(size.width + ring * 2, size.height + ring * 2),
                                cornerRadius = CornerRadius(10.dp.toPx() + ring),
                            )
                        }
                    }
                    .background(Color.White, shape).border(1.dp, if (focused) Sm.Blue else Sm.BorderStrong, shape)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                if (value.isEmpty()) Text(placeholder, color = Sm.Faint, fontSize = 16.sp, lineHeight = 24.8.sp)
                inner()
            }
        },
    )
}
