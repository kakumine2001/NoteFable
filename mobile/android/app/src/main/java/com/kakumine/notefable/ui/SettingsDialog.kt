package com.kakumine.notefable.ui

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
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

// 设置现在在哪一页：旋转屏幕等重建以后留在那一页（navigated 不存，重建后的第一个画面不带切换动画）。
private val SettingsNavSaver = Saver<SettingsNav, String>(
    save = { it.page?.name.orEmpty() },
    restore = { saved -> SettingsNav(SettingsPage.entries.firstOrNull { it.name == saved }) },
)

// 网页 TABS：各栏的名字和图标（入口一览的行、页面顶栏的标题）。
private fun settingsPageLabel(page: SettingsPage): Int = when (page) {
    SettingsPage.General -> R.string.settings_general
    SettingsPage.Personalization -> R.string.settings_personalization
    SettingsPage.Plan -> R.string.plan_title
    SettingsPage.Account -> R.string.account
}

private fun settingsPageIcon(page: SettingsPage): List<String> = when (page) {
    SettingsPage.General -> Lucide.SlidersHorizontal
    SettingsPage.Personalization -> Lucide.PenLine
    SettingsPage.Plan -> Lucide.CreditCard
    SettingsPage.Account -> Lucide.CircleUser
}

/**
 * 设置（网页 SettingsDialog 的手机宽度，从侧栏的账号行打开；登录后才有）。全屏、灰底（--notion-sidebar），分两级
 * （和 ChatGPT、Claude 的手机 App 一样）：先是入口的一览，点一行进到那一栏自己的页面。
 * - 顶栏：最小高 64、左右 16，三列 40 | 剩下 | 40、间距 8。左边是圆形按钮（[SettingsBarButton]）：一览上是"关闭"（X 18），
 *   页面上是"返回"（ArrowLeft 20）；标题居中 17/650 墨色，一览上是"设置"，页面上是那一栏的名字；右边一列空着。
 * - 下面是左右 16、上 8、下 32 的滚动区。一览：账号行（[SettingsIdentityRow]，点了进"账号"页），隔 24 是四行的卡片
 *   （通用、个性化、方案、账号，[SettingsHomeRow]）。页面只有那一栏的内容，没有栏标题（名字在顶栏上）：
 *   通用（语言、图标）、个性化（自定义指令）、方案、账号（个人资料，隔 24 是退出登录 / 删除账号）。卡片白底、1px 细线、圆角 20。
 * - 换画面（网页 settings-page-forward / settings-page-back）：滚动区 200ms 淡入并横移 16，页面从结束边进来、一览从起始边进来
 *   （从右往左的语言里反过来）；系统关掉动画时不动，刚打开时的一览也不动。换了以后从最上面看起。
 * - 名字、头像、语言没存上的提示在滚动区的最上面，一览和各页面上都有。
 * 资料、语言和图标改了就存。只有自定义指令要按"保存"：改了以后下方浮出"未保存的更改"条（放弃 / 保存），
 * 保存或放弃之前既不关也不回一览（返回键、顶栏的按钮都是显示"个性化"页、让那条晃一下），不会不声不响地丢掉。
 * 保存后留在设置里，标题右边显示"已保存"；保存失败也显示"个性化"页（原因写在那里）。
 * 返回键、顶栏按钮的规则在 SettingsNav.kt（和网页 src/lib/settings-navigation.ts 相同）：返回键一次退一步
 * （收起头像编辑区 / 角色网格 → 回一览 → 关设置）；顶栏的"返回"连开着的编辑区一起收起、一步回到一览；
 * 保存中、删除中都不动；照片在裁剪或上传时顶栏按钮不走，显示"账号"页。不管怎么关，输入中的名字都先存掉。
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
    // 现在显示的画面：入口的一览，或某一栏的页面（网页 home / tab）。
    var nav by rememberSaveable(stateSaver = SettingsNavSaver) { mutableStateOf(SettingsNav()) }
    var attempt by remember { mutableIntStateOf(0) }
    // 读到的指令；null 是还没读到。
    var initial by remember { mutableStateOf<String?>(null) }
    var loadError by remember { mutableStateOf<Throwable?>(null) }
    var instructions by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    // 刚保存完：标题右边显示"已保存"，再改就消失。
    var justSaved by remember { mutableStateOf(false) }
    // 没保存就想关（或想回一览）的次数：每变一次，"未保存的更改"条晃一下。
    var attention by remember { mutableIntStateOf(0) }
    // 方案、删除账号的状态放在这里而不是各自的页面里：网页各栏一直挂着（只是不显示），进出页面状态都还在。
    val plan = rememberPlanSettingsState(profile::loadPlan)
    val deletion = remember { DeleteAccountState() }
    // 正在删除账号：和保存中一样不关、不让按其他按钮。
    val deleting = deletion.deleting
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
    // 网页 locked：保存中、删除中什么都不动。
    val locked = busy || deleting
    val closeNow = {
        profile.saveName(nameDraft)
        onClose()
    }
    // 换画面（网页 show / goHome）。离开"账号"页时名字的输入框就不在了：和失焦一样，先把输入中的名字存掉。
    val go: (SettingsNav) -> Unit = { next ->
        if (nav.page == SettingsPage.Account && next.page != SettingsPage.Account) {
            profile.saveName(nameDraft)
            editingName = false
        }
        nav = next
    }
    // 照 SettingsNav.kt 决定的那一步去做（网页 apply）。
    val perform: (SettingsStep) -> Unit = { step ->
        if (step is SettingsStep.Show && step.attention) attention++
        val next = nav.after(step)
        if (next == null) closeNow() else go(next)
    }
    // 返回键（网页 close）：一次退一步。头像编辑区（包括选好照片在裁剪）、角色网格开着时先只收起它，并显示它所在的页面。
    // 系统的图片选择器开着时（头像、图标共用一个标记）按键到不了这里，万一到了也不动。
    val requestClose: () -> Unit = {
        val still = locked || pickerOpen
        val guard = if (still) null else settingsEditorGuard(account.uploading, editor != AvatarEditor.Closed, appIcon.picking)
        if (guard?.closeAvatarEditor == true) onEditor(AvatarEditor.Closed)
        if (guard?.closeIconPicker == true) appIcon.picking = false
        perform(settingsDismissStep(still, guard?.page, onPage = !nav.isHome, dirty = dirty))
    }
    // 一览顶栏的"关闭"（网页 closeAll）：开着的编辑区跟着一起关；选了照片还没存、在上传时不关，显示"账号"页。
    val closeAll: () -> Unit = { perform(settingsButtonStep(locked, photoBusy, onPage = false, dirty = dirty)) }
    // 页面顶栏的"返回"（网页 backHome）：把开着的头像编辑区、角色网格收起来，一步回到一览。
    val backHome: () -> Unit = {
        val step = settingsButtonStep(locked, photoBusy, onPage = true, dirty = dirty)
        if (step == SettingsStep.Home) {
            if (editor != AvatarEditor.Closed) onEditor(AvatarEditor.Closed)
            appIcon.picking = false
        }
        perform(step)
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
        if (locked || !dirty) return@save
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
                // 失败的原因写在"个性化"页里：在别的画面按了条上的"保存"也要看得到（网页 save 的 catch）。
                go(nav.show(SettingsPage.Personalization))
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

        // 换画面（网页 .settings-body 的 settings-page-forward / settings-page-back）：只在一览和页面之间换的时候做，
        // 页面换到另一页面（拦下来以后显示"个性化"页等）不重做；刚打开时的一览、系统关掉动画时不做。
        val context = LocalContext.current
        val motionOff = remember(context) {
            runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
        }
        val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
        val pageEnter = remember(nav.isHome) { Animatable(if (nav.navigated && !motionOff) 0f else 1f) }
        LaunchedEffect(pageEnter) { pageEnter.animateTo(1f, tween(200, easing = SettingsEase)) }
        // 换了画面就从最上面看起（网页 bodyRef.scrollTop = 0）：每个画面用自己的滚动位置。
        val scroll = key(nav.page) { rememberScrollState() }

        // 换了画面以后键盘的焦点跟着走（网页 backRef.focus() / opener.focus()）：页面上是"返回"，回到一览是刚才点的那一行。
        // 触摸操作时这些按钮不接焦点，所以不会凭空出现焦点框。读屏靠下面的 paneTitle：标题变了会念出来，并从顶栏重新读起。
        val backFocus = remember { FocusRequester() }
        val identityFocus = remember { FocusRequester() }
        val rowFocus = remember { SettingsPage.entries.map { FocusRequester() } }
        var opener by remember { mutableStateOf<FocusRequester?>(null) }
        LaunchedEffect(nav) {
            if (!nav.navigated) return@LaunchedEffect
            runCatching { if (nav.isHome) opener?.requestFocus() else backFocus.requestFocus() }
        }

        val title = stringResource(nav.page?.let(::settingsPageLabel) ?: R.string.acct_settings)
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer {
                    alpha = enter.value
                    translationY = (1f - enter.value) * 16.dp.toPx()
                }
                .background(Sm.Sidebar).systemBarsPadding().imePadding()
                .semantics { paneTitle = title },
        ) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (nav.isHome) {
                        SettingsBarButton(Lucide.X, 18.dp, stringResource(R.string.close), onClick = closeAll)
                    } else {
                        SettingsBarButton(Lucide.ArrowLeft, 20.dp, stringResource(R.string.back), Modifier.focusRequester(backFocus), onClick = backHome)
                    }
                    Text(
                        title, color = Sm.Ink, fontSize = 17.sp, fontWeight = FontWeight(650), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center, modifier = Modifier.weight(1f).semantics { heading() },
                    )
                    // 右边空着的一列，和左边的按钮一样宽，让标题保持在正中。
                    Spacer(Modifier.width(40.dp))
                }
                Column(
                    Modifier.weight(1f).fillMaxWidth()
                        .graphicsLayer {
                            val shown = pageEnter.value
                            // 页面从结束边进来，一览从起始边进来；从右往左的语言里反过来（--settings-page-dir）。
                            val from = (if (nav.isHome) -1f else 1f) * (if (rtl) -1f else 1f)
                            alpha = shown
                            translationX = (1f - shown) * 16.dp.toPx() * from
                        }
                        .verticalScroll(scroll)
                        // 条出来时多留出条的高度，最后一栏不被挡住（.settings-body.has-unsaved）。
                        .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = if (dirty) 96.dp else 32.dp),
                ) {
                    // 名字、头像、语言保存失败的提示：放在最上面，一览和各页面上都有（网页 .settings-save-error，下距 12）。
                    account.profileError?.let {
                        val text = when (it) {
                            is ProfileError.Server -> system.localize(it.message)
                            ProfileError.CouldNotSave -> stringResource(R.string.acct_could_not_save)
                        }
                        Text(text, color = SettingsDanger, fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(bottom = 12.dp))
                    }
                    when (nav.page) {
                        // 入口的一览（网页 .settings-home）：账号行，隔 24 是各栏的行。
                        null -> {
                            SettingsIdentityRow(user, user.name ?: user.email ?: stringResource(R.string.account), Modifier.focusRequester(identityFocus)) {
                                opener = identityFocus
                                go(nav.show(SettingsPage.Account))
                            }
                            Spacer(Modifier.height(24.dp))
                            SettingsCard {
                                SettingsPage.entries.forEachIndexed { index, page ->
                                    SettingsHomeRow(
                                        settingsPageIcon(page), stringResource(settingsPageLabel(page)), divider = index > 0,
                                        modifier = Modifier.focusRequester(rowFocus[index]),
                                    ) {
                                        opener = rowFocus[index]
                                        go(nav.show(page))
                                    }
                                }
                            }
                        }

                        SettingsPage.General -> SettingsCard {
                            LanguageSettings(user, onChoose = profile::setLocale)
                            SettingsRowDivider()
                            AppIconSettings(appIcon, onPickImage = onPickAppIconImage)
                        }

                        SettingsPage.Personalization -> SettingsCard(padded = true) {
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

                        SettingsPage.Plan -> SettingsCard(padded = true) { PlanSettings(plan) }

                        // 账号：个人资料，隔 24 是退出登录 / 删除账号（网页 .settings-group.is-active ~ .settings-group.is-active）。
                        SettingsPage.Account -> {
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
                            Spacer(Modifier.height(24.dp))
                            SettingsCard {
                                SettingsRowButton(Lucide.LogOut, stringResource(R.string.sign_out), enabled = !locked && !photoBusy && !account.signingOut) {
                                    // 输入中的名字先排进保存队列，signOut 会等它发完。
                                    profile.saveName(nameDraft)
                                    onSignOut()
                                }
                                SettingsRowDivider()
                                DeleteAccountSection(
                                    state = deletion,
                                    scope = scope,
                                    enabled = !busy && !photoBusy && !account.signingOut,
                                    deleteAccount = deleteAccount,
                                    onDeleted = closeNow,
                                )
                            }
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
