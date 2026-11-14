package com.kakumine.studymate.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
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
import com.kakumine.studymate.BuildConfig
import com.kakumine.studymate.R
import com.kakumine.studymate.data.AccountUser

// 侧栏最下面（网页 SidebarFooter）：表示语言、账号、隐私政策 / 服务条款。上方 1px 分隔线。
@Composable
fun SidebarFooter(
    account: AccountUiState,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    onSaveName: (String) -> Unit,
    onResetToGoogle: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().drawBehind { drawRect(Sm.Border, size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }) {
        LanguageSelect()
        if (account.configured) {
            Box(Modifier.padding(start = 8.dp, end = 8.dp, top = 8.dp)) {
                val user = account.user
                if (user == null) {
                    GoogleSignInButton(failed = account.signInFailed, busy = account.signingIn, onClick = onSignIn)
                } else {
                    ProfileRow(user, account.profileError, onSignOut, onSaveName, onResetToGoogle)
                }
            }
        }
        LegalLinks()
    }
}

// Google 官方样式的登录按钮（网页 .google-signin-button，手机尺寸）：高 44、1px #747775、圆角 4、白底、15/500、字距 0.25。
@Composable
private fun GoogleSignInButton(failed: Boolean, busy: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(4.dp)
    Row(
        Modifier.fillMaxWidth().height(44.dp).clip(shape).background(Color.White).border(1.dp, Color(0xFF747775), shape)
            .clickable(enabled = !busy, onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
    ) {
        GoogleLogo(18.dp)
        Text(
            stringResource(if (failed) R.string.sign_in_failed else R.string.sign_in_google),
            color = Color(0xFF1F1F1F),
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 0.25.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// 登录后的账号行（.notion-sidebar-action.profile-row）：头像 22、名字、右侧上下箭头；点开是个人资料弹层。
@Composable
private fun ProfileRow(
    user: AccountUser,
    error: String?,
    onSignOut: () -> Unit,
    onSaveName: (String) -> Unit,
    onResetToGoogle: () -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val accountLabel = stringResource(R.string.account)
    Box {
        Row(
            Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(4.8.dp)).clickable { open = !open }
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
            ProfileMenu(user, error, onDismiss = { open = false }, onSignOut = { open = false; onSignOut() }, onSaveName, onResetToGoogle)
        }
    }
}

// 弹在账号行正上方 6 处、左边至少留 12，宽度最多 300（网页 menuPositionFor）。
private class AboveAnchor(private val gap: Int, private val margin: Int) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
        val x = anchorBounds.left.coerceIn(margin, (windowSize.width - popupContentSize.width - margin).coerceAtLeast(margin))
        val y = (anchorBounds.top - gap - popupContentSize.height).coerceAtLeast(margin)
        return IntOffset(x, y)
    }
}

// 个人资料弹层（网页 ProfileMenu）：头像 52 + 名字输入框、邮箱、底部操作（恢复 Google 名字和照片、退出登录）。
// 网页里还能上传照片 / 选表情头像；原生版还没有这两个编辑器，所以头像上不放编辑角标。
@Composable
private fun ProfileMenu(
    user: AccountUser,
    error: String?,
    onDismiss: () -> Unit,
    onSignOut: () -> Unit,
    onSaveName: (String) -> Unit,
    onResetToGoogle: () -> Unit,
) {
    val density = LocalDensity.current
    val provider = remember(density) { with(density) { AboveAnchor(6.dp.roundToPx(), 12.dp.roundToPx()) } }
    var draft by remember(user.displayName, user.googleName) { mutableStateOf(user.displayName ?: user.googleName ?: "") }
    var editing by remember { mutableStateOf(false) }
    val customized = user.displayName != null || user.icon != null || user.avatarUrl != null
    val shape = RoundedCornerShape(8.dp)

    Popup(
        popupPositionProvider = provider,
        onDismissRequest = {
            onSaveName(draft)
            onDismiss()
        },
        properties = PopupProperties(focusable = true),
    ) {
        Column(
            Modifier.widthIn(max = 300.dp).fillMaxWidth()
                .shadow(14.dp, shape, ambientColor = Color(0x330F0F0F), spotColor = Color(0x330F0F0F))
                .background(Color.White, shape).border(1.dp, Color(0x0D0F0F0F), shape).padding(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                UserAvatar(user, 52.dp)
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.profile_name), color = Sm.Muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 2.dp))
                    val fieldShape = RoundedCornerShape(6.dp)
                    BasicTextField(
                        value = draft,
                        onValueChange = { draft = it.take(60) },
                        singleLine = true,
                        textStyle = TextStyle(fontSize = 16.sp, color = Sm.Text),
                        cursorBrush = SolidColor(Sm.Ink),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { onSaveName(draft) }),
                        modifier = Modifier.fillMaxWidth().height(40.dp)
                            .onFocusChanged { if (editing && !it.isFocused) onSaveName(draft); editing = it.isFocused }
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
            error?.let {
                Text(rememberSystemText().localize(it), color = Sm.Danger, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
            }
            // 操作区：上方 1px 分隔线，按钮行高 44、15sp，图标 14。
            Column(
                Modifier.padding(top = 12.dp).offset(x = (-6).dp).fillMaxWidth()
                    .drawBehind { drawRect(Sm.Border, size = androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }
                    .padding(top = 6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (customized) {
                    ProfileAction(Lucide.RotateCcw, stringResource(R.string.use_google_profile)) {
                        draft = user.googleName ?: ""
                        onResetToGoogle()
                    }
                }
                ProfileAction(Lucide.LogOut, stringResource(R.string.sign_out), onSignOut)
            }
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
@Composable
fun UserAvatar(user: AccountUser, size: androidx.compose.ui.unit.Dp) {
    val modifier = Modifier.size(size).clip(CircleShape)
    val photo = user.avatarUrl?.let { if (it.startsWith("http")) it else BuildConfig.BASE_URL + it }
    when {
        photo != null -> AsyncImage(photo, null, modifier.background(Sm.Active), contentScale = ContentScale.Crop)
        user.icon != null -> Box(modifier.background(Color(0x0F37352F)), Alignment.Center) {
            Text(user.icon, fontSize = (size.value * 0.62f).sp)
        }
        user.image != null -> AsyncImage(user.image, null, modifier.background(Sm.Active), contentScale = ContentScale.Crop)
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
private fun GoogleLogo(size: androidx.compose.ui.unit.Dp) {
    val parsed = remember { GoogleLogoPaths.map { (color, d) -> Color(color) to PathParser().parsePathString(d).toPath() } }
    Canvas(Modifier.size(size)) {
        scale(this.size.width / 48f, pivot = Offset.Zero) {
            parsed.forEach { (color, path) -> drawPath(path, color) }
        }
    }
}
