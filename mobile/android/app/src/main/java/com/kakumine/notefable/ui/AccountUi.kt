package com.kakumine.notefable.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import coil3.compose.AsyncImage
import com.kakumine.notefable.BuildConfig
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AccountUser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// 侧栏最下面（网页 SidebarFooter）：表示语言、账号、隐私政策 / 服务条款。上方 1px 分隔线。
@Composable
fun SidebarFooter(
    account: AccountUiState,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    profile: AccountViewModel,
) {
    Column(Modifier.fillMaxWidth().drawBehind { drawRect(Sm.Border, size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }) {
        LanguageSelect()
        if (account.configured) {
            Box(Modifier.padding(start = 8.dp, end = 8.dp, top = 8.dp)) {
                val user = account.user
                if (user == null) {
                    // 网页 SignInButton：只放"登录"，点了打开登录窗口（SignInDialog）。
                    SignInButton(onClick = onSignIn)
                } else {
                    ProfileRow(user, account, profile, onSignOut)
                }
            }
        }
        LegalLinks()
    }
}

// Google 官方样式的按钮（网页 .google-signin-button，手机尺寸）：高 44、1px #747775、白底、15/500、字距 0.25；
// 圆角默认 4，登录窗口里（.signin-option）是 8。
@Composable
internal fun GoogleSignInButton(label: String, busy: Boolean, onClick: () -> Unit, shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(4.dp)) {
    Row(
        Modifier.fillMaxWidth().height(44.dp).clip(shape).background(Color.White).border(1.dp, Color(0xFF747775), shape)
            .clickable(enabled = !busy, onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
    ) {
        GoogleLogo(18.dp)
        Text(
            label,
            color = Color(0xFF1F1F1F),
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 0.25.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 头像编辑区（网页 ProfileMenu 的 Editor）。 */
private enum class AvatarEditor { Closed, Photo, Emoji }

/**
 * 网页 `<input type=file accept="image/png,image/jpeg,image/webp,image/gif">`：系统的文件 / 照片选择器，只列这四种图片。
 */
private class PickAvatarPhoto : ActivityResultContracts.GetContent() {
    override fun createIntent(context: Context, input: String): Intent =
        super.createIntent(context, "image/*").putExtra(Intent.EXTRA_MIME_TYPES, AVATAR_PICK_TYPES)
}

private val AVATAR_PICK_TYPES = arrayOf("image/png", "image/jpeg", "image/webp", "image/gif")

/** 选好的文件的类型和大小（读不到大小时为 null）。 */
private fun pickedTypeAndSize(context: Context, uri: Uri): Pair<String?, Long?> {
    val resolver = context.contentResolver
    val size = runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            val column = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (column >= 0 && cursor.moveToFirst() && !cursor.isNull(column)) cursor.getLong(column) else null
        }
    }.getOrNull()
    return resolver.getType(uri) to size
}

// 登录后的账号行（.notion-sidebar-action.profile-row）：头像 22、名字、右侧上下箭头；点开是个人资料弹层。
@Composable
private fun ProfileRow(user: AccountUser, account: AccountUiState, profile: AccountViewModel, onSignOut: () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    // 编辑区和选好的照片放在这里而不是弹层里：选择器回来时（哪怕 Activity 重建）弹层还没组合好，结果也接得住。
    var editor by rememberSaveable { mutableStateOf(AvatarEditor.Closed) }
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    // 系统选择器开着时点外面 / 返回键不关弹层（网页 filePickerOpen）。
    var pickerOpen by rememberSaveable { mutableStateOf(false) }
    var settingsOpen by rememberSaveable { mutableStateOf(false) }
    var anchorTop by remember { mutableFloatStateOf(0f) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(PickAvatarPhoto()) { uri ->
        pickerOpen = false
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val (type, size) = withContext(Dispatchers.IO) { runCatching { pickedTypeAndSize(context, uri) }.getOrDefault(null to null) }
            val problem = checkPickedPhoto(type, size)
            profile.showPhotoError(problem)
            if (problem == null) picked = uri.toString()
        }
    }
    val close = {
        open = false
        editor = AvatarEditor.Closed
        picked = null
    }
    val accountLabel = stringResource(R.string.account)
    Box {
        Row(
            Modifier.fillMaxWidth().height(44.dp).onGloballyPositioned { anchorTop = it.boundsInWindow().top }
                .clip(RoundedCornerShape(4.8.dp))
                .clickable {
                    if (open) {
                        close()
                    } else {
                        profile.clearProfileError()
                        open = true
                    }
                }
                .semantics { role = Role.Button }.padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.8.dp),
        ) {
            UserAvatar(user, 22.dp)
            Text(
                user.name ?: user.email ?: accountLabel,
                modifier = Modifier.weight(1f),
                color = Sm.Text,
                fontSize = 16.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            LucideIcon(Lucide.ChevronsUpDown, 14.dp, Sm.Faint)
        }
        if (open) {
            ProfileMenu(
                user = user,
                account = account,
                profile = profile,
                anchorTop = anchorTop,
                editor = editor,
                picked = picked,
                onEditor = { next ->
                    editor = next
                    picked = null
                    profile.showPhotoError(null)
                },
                onPickPhoto = {
                    pickerOpen = true
                    launcher.launch("image/*")
                },
                onCancelCrop = {
                    picked = null
                    profile.showPhotoError(null)
                },
                onPhotoSaved = {
                    picked = null
                    editor = AvatarEditor.Closed
                },
                canClose = { !pickerOpen && !account.uploading },
                onDismiss = close,
                onOpenSettings = { close(); settingsOpen = true },
                onSignOut = { close(); onSignOut() },
            )
        }
        if (settingsOpen) SettingsDialog(profile, onClose = { settingsOpen = false })
    }
}

// 弹在账号行正上方 6 处、左边至少留 12（网页 menuPositionFor）。
private class AboveAnchor(private val gap: Int, private val margin: Int) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
        val x = anchorBounds.left.coerceIn(margin, (windowSize.width - popupContentSize.width - margin).coerceAtLeast(margin))
        val y = (anchorBounds.top - gap - popupContentSize.height).coerceAtLeast(margin)
        return IntOffset(x, y)
    }
}

/*
 * 个人资料弹层（网页 ProfileMenu + globals.css 的 .profile-*，手机宽度 ≤639 的值）：
 * - 外框：宽 min(300, 屏宽 − 24)，最高 max(160, 账号行顶 − 18)，超出时内部纵向滚动；内边距 14，白底、圆角 8、--notion-shadow；
 *   打开时 motion-menu-enter 120ms。
 * - 头部：头像 52（按钮，右下 −2 处 20 的深色圆形角标，2px 白边，铅笔 11 白色）、间距 12、"名字"12 灰 + 输入框（高 40、16 字、
 *   左右 10、1px 深描边、圆角 6；聚焦时蓝边 + 2px rgba(35,131,226,.2) 外圈；最多 40 字）。
 * - 点头像打开编辑区（再点关上）：上 10、左右贴边（−14）、上边 1px 线；"照片 / 表情"两个标签（.notes-picker-tabs：左右 8、间距 4、
 *   下边 1px .09 线；标签 10/6/8 内边距、14 字 .65 灰，选中墨色 500 + 2px 下划线）。
 *   照片页（.profile-photo-pane）：内边距 12/14/14、间距 8；"上传照片"整行高 44、1px 深描边、圆角 6、15 字、ImagePlus 16 + 8；
 *   说明 12/18 灰；有照片时"移除我的照片"（Trash2 14 + 6、13 红字、内边距 4×6、圆角 4）；错误 12 红、上 10。
 *   选好照片后换成裁剪（AvatarCropper.kt）。表情页：EmojiPickerBody，高 min(320, 屏高 − 220)，去掉键写"使用 Google 头像"。
 * - 邮箱 12 灰（上 10）、保存错误 12 红（上 10）；操作区上 12、左右 −6、上边 1px 线、上内边距 6、间距 2：行高 ≥44、15 字、图标 14 + 8。
 *   操作依次是"使用我的 Google 名称和头像"（改过才有）、"设置"（打开 SettingsDialog）、"退出登录"。
 */
@Composable
private fun ProfileMenu(
    user: AccountUser,
    account: AccountUiState,
    profile: AccountViewModel,
    anchorTop: Float,
    editor: AvatarEditor,
    picked: String?,
    onEditor: (AvatarEditor) -> Unit,
    onPickPhoto: () -> Unit,
    onCancelCrop: () -> Unit,
    onPhotoSaved: () -> Unit,
    canClose: () -> Boolean,
    onDismiss: () -> Unit,
    onOpenSettings: () -> Unit,
    onSignOut: () -> Unit,
) {
    val density = LocalDensity.current
    val configuration = LocalConfiguration.current
    val provider = remember(density) { with(density) { AboveAnchor(6.dp.roundToPx(), 12.dp.roundToPx()) } }
    val savedName = user.displayName ?: user.googleName ?: ""
    var draft by remember { mutableStateOf(savedName) }
    var editing by remember { mutableStateOf(false) }
    // 输入框没在编辑时才跟着保存后的名字走：保存失败回滚时不会盖掉用户接着输入、还没发出的文字。
    LaunchedEffect(savedName) { if (!editing) draft = savedName }
    val customized = user.displayName != null || user.icon != null || user.avatarUrl != null
    val shape = RoundedCornerShape(8.dp)
    val width = minOf(300.dp, configuration.screenWidthDp.dp - 24.dp)
    val maxHeight = maxOf(160.dp, with(density) { anchorTop.toDp() } - 18.dp)
    val system = rememberSystemText()

    // 网页：位置是打开时算的，屏幕宽度变了就关掉（只是键盘弹出、高度变化不关）。
    val openedWidth = remember { configuration.screenWidthDp }
    LaunchedEffect(configuration.screenWidthDp) {
        if (configuration.screenWidthDp != openedWidth) {
            onSaveNameAndClose(draft, profile, onDismiss)
        }
    }
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(120, easing = CssEaseOut)) }

    Popup(
        popupPositionProvider = provider,
        onDismissRequest = {
            // 系统选择器开着、照片在上传时不关（网页 closeIfAllowed：失败的提示不能跟着消失）。
            if (canClose()) onSaveNameAndClose(draft, profile, onDismiss)
        },
        properties = PopupProperties(focusable = true),
    ) {
        Column(
            Modifier.graphicsLayer {
                val t = enter.value
                alpha = t
                translationY = (1f - t) * 4.dp.toPx()
                val scale = 0.98f + 0.02f * t
                scaleX = scale
                scaleY = scale
            }.width(width).heightIn(max = maxHeight)
                .shadow(14.dp, shape, ambientColor = Color(0x1F0F0F0F), spotColor = Color(0x1F0F0F0F))
                .background(Color.White, shape).border(1.dp, Color(0x0D0F0F0F), shape).clip(shape)
                .verticalScroll(rememberScrollState())
                // 操作区的下外边距是 −6（.profile-actions margin），所以底部只留 14 − 6。
                .padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AvatarButton(user, expanded = editor != AvatarEditor.Closed) {
                    onEditor(if (editor == AvatarEditor.Closed) AvatarEditor.Photo else AvatarEditor.Closed)
                }
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.profile_name), color = Sm.Muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 2.dp))
                    val fieldShape = RoundedCornerShape(6.dp)
                    BasicTextField(
                        value = draft,
                        // 网页 maxLength = MAX_DISPLAY_NAME（40，按 UTF-16 计，和 String.take 相同）。
                        onValueChange = { draft = it.take(MAX_DISPLAY_NAME) },
                        singleLine = true,
                        textStyle = TextStyle(fontSize = 16.sp, color = Sm.Text),
                        cursorBrush = SolidColor(Sm.Ink),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { profile.saveName(draft) }),
                        modifier = Modifier.fillMaxWidth().height(40.dp)
                            .onFocusChanged { if (editing && !it.isFocused) profile.saveName(draft); editing = it.isFocused }
                            .drawBehind {
                                // :focus 的 outline 2px rgba(35,131,226,.2)，画在描边外侧。
                                if (editing) {
                                    val ring = 2.dp.toPx()
                                    drawRoundRect(
                                        FocusRing,
                                        topLeft = Offset(-ring, -ring),
                                        size = androidx.compose.ui.geometry.Size(size.width + ring * 2, size.height + ring * 2),
                                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(6.dp.toPx() + ring),
                                    )
                                }
                            }
                            .border(1.dp, if (editing) Sm.Blue else Sm.BorderStrong, fieldShape)
                            .background(Color.White, fieldShape),
                        decorationBox = { inner ->
                            Box(Modifier.padding(horizontal = 10.dp), Alignment.CenterStart) {
                                if (draft.isEmpty()) Text(user.googleName ?: stringResource(R.string.your_name), color = Sm.Faint, fontSize = 16.sp)
                                inner()
                            }
                        },
                    )
                }
            }
            user.email?.let {
                Text(it, color = Sm.Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 10.dp))
            }

            if (editor != AvatarEditor.Closed) {
                // .profile-editor：上 10、左右贴到弹层边（−14）、上边 1px 线。
                Column(
                    Modifier.padding(top = 10.dp).requiredWidth(width)
                        .drawBehind { drawRect(Sm.Border, size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) },
                ) {
                    EditorTabs(editor, onEditor)
                    val photoErrorText = account.photoError?.let { photoErrorText(it, system) }
                    if (editor == AvatarEditor.Photo) {
                        if (picked != null) {
                            AvatarCropper(
                                uri = picked,
                                saving = account.uploading,
                                error = photoErrorText,
                                onCancel = onCancelCrop,
                                onSave = { bytes -> profile.uploadPhoto(bytes, AVATAR_MIME_TYPE, onPhotoSaved) },
                            )
                        } else {
                            PhotoPane(hasPhoto = user.avatarUrl != null, error = photoErrorText, onUpload = onPickPhoto, onRemove = { profile.setIcon(null) })
                        }
                    } else {
                        val pickerHeight = minOf(320.dp, maxOf(80.dp, configuration.screenHeightDp.dp - 220.dp))
                        EmojiPickerBody(
                            current = user.icon,
                            onChange = { profile.setIcon(it) },
                            onClose = { onEditor(AvatarEditor.Closed) },
                            pickerHeight = pickerHeight,
                            removeLabel = stringResource(R.string.acct_use_google_photo),
                        )
                    }
                }
            }

            account.profileError?.let {
                val text = when (it) {
                    is ProfileError.Server -> system.localize(it.message)
                    ProfileError.CouldNotSave -> stringResource(R.string.acct_could_not_save)
                }
                Text(text, color = Sm.Danger, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
            }
            // 操作区：上方 1px 分隔线，按钮行高 44、15sp，图标 14。
            Column(
                Modifier.padding(top = 12.dp).requiredWidth(width - 16.dp)
                    .drawBehind { drawRect(Sm.Border, size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }
                    .padding(top = 6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (customized) {
                    ProfileAction(Lucide.RotateCcw, stringResource(R.string.use_google_profile)) {
                        draft = user.googleName ?: ""
                        profile.resetToGoogle()
                    }
                }
                // 设置（网页 onOpenSettings）：关掉弹层再开设置窗口；输入中的名字和关弹层时一样先存掉。
                // 照片上传中不开（弹层一关，失败的提示就没地方显示，和 canClose 同一条规则）。
                ProfileAction(Lucide.Settings, stringResource(R.string.acct_settings)) {
                    if (canClose()) {
                        profile.saveName(draft)
                        onOpenSettings()
                    }
                }
                // 网页靠 blur 先把输入中的名字存掉；这里点按钮不会抢焦点，所以先排进保存队列，signOut 会等它发完。
                ProfileAction(Lucide.LogOut, stringResource(R.string.sign_out)) {
                    profile.saveName(draft)
                    onSignOut()
                }
            }
        }
    }
}

/** 网页 MAX_DISPLAY_NAME。 */
private const val MAX_DISPLAY_NAME = 40

private val FocusRing = Color(0x332383E2)

/** 关弹层前把输入中的名字存掉（网页卸载时的 flushRef）。 */
private fun onSaveNameAndClose(draft: String, profile: AccountViewModel, onDismiss: () -> Unit) {
    profile.saveName(draft)
    onDismiss()
}

@Composable
private fun photoErrorText(error: PhotoError, system: com.kakumine.notefable.data.SystemTextTranslator): String = when (error) {
    PhotoError.NotImage -> stringResource(R.string.acct_choose_image)
    PhotoError.TooLarge -> stringResource(R.string.acct_photo_too_big)
    PhotoError.UploadFailed -> stringResource(R.string.acct_upload_failed)
    PhotoError.Offline -> stringResource(R.string.acct_upload_offline)
    is PhotoError.Server -> system.localize(error.message)
}

// 头像按钮（.profile-avatar-button）：头像 52，右下角 −2 处 20 的铅笔角标（2px 白边、--notion-text 底）。
@Composable
private fun AvatarButton(user: AccountUser, expanded: Boolean, onClick: () -> Unit) {
    val label = stringResource(R.string.acct_change_avatar)
    Box(Modifier.size(52.dp)) {
        Box(
            Modifier.size(52.dp).clip(CircleShape).clickable(onClick = onClick)
                .semantics {
                    role = Role.Button
                    contentDescription = label
                    selected = expanded
                },
        ) {
            UserAvatar(user, 52.dp)
        }
        Box(
            Modifier.align(Alignment.BottomEnd).offset(2.dp, 2.dp).size(20.dp).clip(CircleShape)
                .background(Color.White).padding(2.dp).clip(CircleShape).background(Sm.Text),
            contentAlignment = Alignment.Center,
        ) {
            LucideIcon(Lucide.Pencil, 11.dp, Color.White)
        }
    }
}

// .notes-picker-tabs：照片 / 表情。
@Composable
private fun EditorTabs(editor: AvatarEditor, onEditor: (AvatarEditor) -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .drawBehind { drawRect(PickerTabLine, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }
            .padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        listOf(AvatarEditor.Photo to R.string.acct_photo, AvatarEditor.Emoji to R.string.em_emoji).forEach { (tab, label) ->
            val active = editor == tab
            Text(
                stringResource(label),
                color = if (active) Sm.Text else PickerTabMuted,
                fontSize = 14.sp,
                fontWeight = if (active) FontWeight.Medium else FontWeight.Normal,
                modifier = Modifier
                    .drawBehind {
                        if (active) {
                            // ::after：下边 −1 处 2px 墨色线（盖住分隔线）。
                            drawRect(Sm.Text, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = androidx.compose.ui.geometry.Size(size.width, 2.dp.toPx()))
                        }
                    }
                    .clickable { onEditor(tab) }
                    .semantics {
                        role = Role.Tab
                        selected = active
                    }
                    .padding(start = 6.dp, end = 6.dp, top = 10.dp, bottom = 8.dp),
            )
        }
    }
}

private val PickerTabLine = Color(0x1737352F)
private val PickerTabMuted = Color(0xA637352F)

// .profile-photo-pane：上传按钮、说明、移除照片、错误。
@Composable
private fun PhotoPane(hasPhoto: Boolean, error: String?, onUpload: () -> Unit, onRemove: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val shape = RoundedCornerShape(6.dp)
        Row(
            Modifier.fillMaxWidth().height(44.dp).clip(shape).border(1.dp, Sm.BorderStrong, shape).clickable(onClick = onUpload),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            LucideIcon(Lucide.ImagePlus, 16.dp, Sm.Text)
            Text(stringResource(R.string.acct_upload_photo), color = Sm.Text, fontSize = 15.sp)
        }
        Text(stringResource(R.string.acct_photo_hint), color = Sm.Muted, fontSize = 12.sp, lineHeight = 18.sp)
        if (hasPhoto) {
            Row(
                Modifier.clip(RoundedCornerShape(4.dp)).clickable(onClick = onRemove).padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                LucideIcon(Lucide.Trash2, 14.dp, Sm.Danger)
                Text(stringResource(R.string.acct_remove_photo), color = Sm.Danger, fontSize = 13.sp)
            }
        }
        error?.let {
            Text(it, color = Sm.Danger, fontSize = 12.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 10.dp))
        }
    }
}

@Composable
private fun ProfileAction(icon: List<String>, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.dp)).clickable(onClick = onClick).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        LucideIcon(icon, 14.dp, Sm.Text)
        Text(label, color = Sm.Text, fontSize = 15.sp)
    }
}

// 头像（网页 UserAvatar）：自己上传的照片 > 表情 > Google 照片 > 名字首字母；底色 --notion-active。
// 照片读不出来时和网页 onError 一样退到下一个候选。
@Composable
fun UserAvatar(user: AccountUser, size: Dp) {
    val modifier = Modifier.size(size).clip(CircleShape)
    val photo = user.avatarUrl?.let { if (it.startsWith("http")) it else BuildConfig.BASE_URL + it }
    var broken by remember { mutableStateOf(emptySet<String>()) }
    when {
        photo != null && photo !in broken ->
            AsyncImage(photo, null, modifier.background(Sm.Active), contentScale = ContentScale.Crop, onError = { broken = broken + photo })
        user.icon != null -> Box(modifier.background(Color(0x0F37352F)), Alignment.Center) {
            Text(user.icon, fontSize = (size.value * 0.62f).sp)
        }
        user.image != null && user.image !in broken ->
            AsyncImage(user.image, null, modifier.background(Sm.Active), contentScale = ContentScale.Crop, onError = { broken = broken + user.image })
        else -> Box(modifier.background(Sm.Active), Alignment.Center) {
            val initial = user.name?.trim()?.firstOrNull()?.uppercase() ?: "?"
            Text(initial, color = Sm.Muted, fontSize = (size.value * 0.55f).sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

// 隐私政策 / 服务条款（网页 LegalLinks）：左右 16、上下 10、间距 16、12sp 灰字，打开网站上的页面。
@Composable
private fun LegalLinks() {
    val uri = LocalUriHandler.current
    Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.privacy), color = Sm.Muted, fontSize = 12.sp, modifier = Modifier.clickable { uri.openUri(BuildConfig.BASE_URL + "/privacy") })
        Text(stringResource(R.string.terms), color = Sm.Muted, fontSize = 12.sp, modifier = Modifier.clickable { uri.openUri(BuildConfig.BASE_URL + "/terms") })
    }
}

// Google 的四色"G"（src/components/google-logo.tsx，viewBox 48），按品牌规范原样使用。
private val GoogleLogoPaths = listOf(
    0xFFEA4335 to "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z",
    0xFF4285F4 to "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z",
    0xFFFBBC05 to "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z",
    0xFF34A853 to "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z",
)

@Composable
internal fun GoogleLogo(size: Dp) {
    val parsed = remember { GoogleLogoPaths.map { (color, d) -> Color(color) to PathParser().parsePathString(d).toPath() } }
    Canvas(Modifier.size(size)) {
        scale(this.size.width / 48f, pivot = Offset.Zero) {
            parsed.forEach { (color, path) -> drawPath(path, color) }
        }
    }
}
