package com.kakumine.studymate.ui

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.kakumine.studymate.R
import com.kakumine.studymate.data.AppLanguage
import kotlinx.coroutines.launch

/** 网页 `<input maxLength={254}>`。 */
private const val MAX_EMAIL_LENGTH = 254

/** 验证码输入：只留数字，最多 6 位（网页 `replace(/\D/g, "").slice(0, 6)`）。 */
fun cleanLoginCode(input: String): String = input.filter { it in '0'..'9' }.take(6)

private val SignInShadow = Color(0x1F0F0F0F) // --notion-shadow
private val SignInRing = Color(0x0D0F0F0F)

/**
 * "登录"按钮（网页 SignInButton / .signin-open-button 的手机尺寸）：整行、高 44、圆角 6、--sm-ink 底、白字 15/600。
 * 侧栏底部和上限提示都只放这一个按钮，点了打开 [SignInDialog]。
 */
@Composable
fun SignInButton(onClick: () -> Unit, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(6.dp)) {
    Box(
        modifier.fillMaxWidth().height(44.dp).clip(shape).background(Sm.Ink)
            .clickable(onClick = onClick).semantics { role = Role.Button }.padding(horizontal = 12.dp),
        Alignment.Center,
    ) {
        Text(stringResource(R.string.sign_in), color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

private enum class SignInStep { Choose, Code }

/**
 * 登录窗口（网页 SignInDialog，globals.css 的 .signin-*；数值是在 412×915 下对网页量的计算样式）：
 * - 外框：dialog.signin-dialog 宽 min(100% − 32, 400)，再受浏览器 `<dialog>` 默认 max-width（100% − 38）限制，412 宽时是 374（左右各 19）；
 *   内边距 32 / 28 / 24，白底、圆角 8、--notion-shadow。右上 12 处 32 的关闭键（✕ 18 灰，圆角 6）。
 * - 第一屏：标题 22/700 居中、字距 −0.01em；副标题 14 / 行高 1.5 灰，上 6.4 下 24；"使用 Google 继续"（高 44、圆角 8、15 字）；
 *   两种方式都有时中间是"或"分隔线（上下 16、间距 12、13 浅灰、两侧 1px 线）；邮箱输入框（高 44、圆角 8、16 字）+ "使用邮箱继续"
 *   （整行、高 ≥44、上 12、圆角 8、15/600、--sm-ink 底，禁用 .45）+ 说明（上 12、13 浅灰居中）。服务端没开的方式不出现。
 * - 第二屏：返回（上 −12、左 −4、下 12，内边距 4，箭头 16 + 4.8 + 14 灰）、标题、副标题（发到哪个邮箱）、6 位验证码输入框
 *   （居中、24 字、字距 0.45em）、"登录"、说明里的"重新发送验证码"（蓝色，禁用时浅灰）。
 * - 错误 14 红、提示 14 灰，都在输入框下 8。发送 / 核对期间不能关（网页 close() 的 busy 判断）。
 *
 * Google 登录由 [onGoogle] 发起（系统的账号选择框）；登录成功后账号有了用户，由调用方关掉窗口。
 */
@Composable
fun SignInDialog(
    account: AccountUiState,
    profile: AccountViewModel,
    onGoogle: () -> Unit,
    beforeIdentityChange: suspend () -> Unit,
    onSignedIn: () -> Unit,
    onClose: () -> Unit,
) {
    var step by rememberSaveable { mutableStateOf(SignInStep.Choose) }
    var email by rememberSaveable { mutableStateOf("") }
    // 验证码发到的邮箱：发送期间改了输入框，第二屏和核对仍用这个地址（网页 sentTo）。
    var sentTo by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<SignInError?>(null) }
    var resent by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val system = rememberSystemText()
    val close = { if (!busy) onClose() }
    LaunchedEffect(Unit) { profile.clearSignInFailed() }

    val sendCode: (Boolean) -> Unit = send@{ again ->
        val address = if (again) sentTo else email
        if (busy || address.isBlank()) return@send
        busy = true
        error = null
        resent = false
        scope.launch {
            val failed = profile.sendEmailCode(address, AppLanguage.uiLocale)
            busy = false
            if (failed != null) {
                error = failed
                return@launch
            }
            sentTo = address
            step = SignInStep.Code
            code = ""
            resent = again
        }
    }
    val verify: () -> Unit = verify@{
        if (busy || code.length != 6) return@verify
        busy = true
        error = null
        resent = false
        scope.launch {
            val failed = profile.verifyEmailCode(sentTo, code, beforeIdentityChange, onSignedIn)
            busy = false
            if (failed != null) error = failed else onClose()
        }
    }

    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        LaunchedEffect(window) { window?.setDimAmount(0.2f) }
        val shape = RoundedCornerShape(8.dp)
        Box(
            Modifier.padding(horizontal = 19.dp).widthIn(max = 400.dp).fillMaxWidth()
                .heightIn(max = (LocalConfiguration.current.screenHeightDp - 38).coerceAtLeast(200).dp)
                .shadow(14.dp, shape, ambientColor = SignInShadow, spotColor = SignInShadow)
                .border(1.dp, SignInRing, shape).clip(shape).background(Color.White),
        ) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(start = 28.dp, end = 28.dp, top = 32.dp, bottom = 24.dp)) {
                val feedback: @Composable () -> Unit = {
                    error?.let {
                        val text = when (it) {
                            is SignInError.Server -> system.localize(it.message)
                            SignInError.Generic -> stringResource(R.string.signin_error_generic)
                            SignInError.Offline -> stringResource(R.string.signin_error_offline)
                        }
                        Text(text, Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Assertive }, color = Sm.Danger, fontSize = 14.sp, lineHeight = 21.sp)
                    }
                    if (resent) {
                        Text(stringResource(R.string.signin_new_code_sent), Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite }, color = Sm.Muted, fontSize = 14.sp, lineHeight = 21.sp)
                    }
                }
                if (step == SignInStep.Choose) {
                    SignInTitle(stringResource(R.string.signin_title))
                    SignInSubtitle(stringResource(R.string.signin_subtitle))
                    if (account.googleEnabled) {
                        GoogleSignInButton(
                            label = stringResource(if (account.signInFailed) R.string.sign_in_failed else R.string.continue_google),
                            busy = busy || account.signingIn, onClick = onGoogle, shape = RoundedCornerShape(8.dp),
                        )
                    }
                    if (account.googleEnabled && account.emailEnabled) {
                        Row(Modifier.padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(Modifier.weight(1f).height(1.dp).background(Sm.Border))
                            Text(stringResource(R.string.signin_or), color = Sm.Faint, fontSize = 13.sp)
                            Box(Modifier.weight(1f).height(1.dp).background(Sm.Border))
                        }
                    }
                    if (account.emailEnabled) {
                        SignInField(
                            value = email, onChange = { email = it.take(MAX_EMAIL_LENGTH) }, enabled = !busy,
                            label = stringResource(R.string.signin_email), placeholder = stringResource(R.string.signin_email),
                            keyboard = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Go),
                            onGo = { sendCode(false) }, autoFocus = !account.googleEnabled,
                        )
                        feedback()
                        SignInSubmit(stringResource(if (busy) R.string.signin_sending else R.string.continue_email), enabled = !busy && email.isNotBlank()) { sendCode(false) }
                        SignInHint { Text(stringResource(R.string.signin_email_hint), color = Sm.Faint, fontSize = 13.sp, lineHeight = 19.5.sp, textAlign = TextAlign.Center) }
                    }
                } else {
                    Row(
                        Modifier.offset(x = (-4).dp, y = (-12).dp).clip(RoundedCornerShape(6.dp))
                            .clickable(enabled = !busy) { step = SignInStep.Choose; error = null; resent = false }
                            .semantics { role = Role.Button }.padding(4.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.8.dp),
                    ) {
                        LucideIcon(Lucide.ArrowLeft, 16.dp, Sm.Muted)
                        Text(stringResource(R.string.back), color = Sm.Muted, fontSize = 14.sp)
                    }
                    SignInTitle(stringResource(R.string.signin_check_email))
                    SignInSubtitle(stringResource(R.string.signin_code_sent, sentTo))
                    SignInField(
                        value = code, onChange = { code = cleanLoginCode(it) }, enabled = !busy,
                        label = stringResource(R.string.signin_code), placeholder = "000000",
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Go),
                        onGo = verify, autoFocus = true, code = true,
                    )
                    feedback()
                    SignInSubmit(stringResource(if (busy) R.string.signin_signing_in else R.string.sign_in), enabled = !busy && code.length == 6, onClick = verify)
                    SignInHint {
                        Text(stringResource(R.string.signin_no_code) + " ", color = Sm.Faint, fontSize = 13.sp, lineHeight = 19.5.sp)
                        Text(
                            stringResource(R.string.signin_resend), color = if (busy) Sm.Faint else Sm.Blue, fontSize = 13.sp, lineHeight = 19.5.sp,
                            modifier = Modifier.clickable(enabled = !busy) { sendCode(true) }.semantics { role = Role.Button },
                        )
                    }
                }
            }
            val closeLabel = stringResource(R.string.close)
            Box(
                Modifier.align(Alignment.TopEnd).padding(top = 12.dp, end = 12.dp).size(32.dp).clip(RoundedCornerShape(6.dp))
                    .clickable(onClick = close).semantics { contentDescription = closeLabel; role = Role.Button },
                Alignment.Center,
            ) { LucideIcon(Lucide.X, 18.dp, Sm.Muted) }
        }
    }
}

// .signin-title：22/700、字距 −0.01em、居中。
@Composable
private fun SignInTitle(text: String) =
    Text(text, Modifier.fillMaxWidth(), color = Sm.Text, fontSize = 22.sp, lineHeight = 33.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.01).em, textAlign = TextAlign.Center)

// .signin-subtitle：上 6.4、下 24，14 / 行高 1.5 灰、居中。
@Composable
private fun SignInSubtitle(text: String) =
    Text(text, Modifier.fillMaxWidth().padding(top = 6.4.dp, bottom = 24.dp), color = Sm.Muted, fontSize = 14.sp, lineHeight = 21.sp, textAlign = TextAlign.Center)

// .signin-hint：上 12、居中、13 浅灰。
@Composable
private fun SignInHint(content: @Composable () -> Unit) =
    Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.Center) { content() }

// .notes-dialog-input.signin-input：高 44、圆角 8、1px 深描边、左右 11.2、16 字；聚焦 2px 蓝框。
// 验证码（.signin-code）：居中、24 字、字距 0.45em。
@Composable
private fun SignInField(
    value: String, onChange: (String) -> Unit, enabled: Boolean, label: String, placeholder: String,
    keyboard: KeyboardOptions, onGo: () -> Unit, autoFocus: Boolean, code: Boolean = false,
) {
    var focused by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (autoFocus) runCatching { focus.requestFocus() } }
    val shape = RoundedCornerShape(8.dp)
    val style = if (code) {
        TextStyle(color = Sm.Text, fontSize = 24.sp, letterSpacing = 0.45.em, textAlign = TextAlign.Center)
    } else {
        TextStyle(color = Sm.Text, fontSize = 16.sp)
    }
    BasicTextField(
        value = value, onValueChange = onChange, readOnly = !enabled, singleLine = true, textStyle = style,
        cursorBrush = SolidColor(Sm.Text), keyboardOptions = keyboard, keyboardActions = KeyboardActions(onGo = { onGo() }),
        modifier = Modifier.fillMaxWidth().height(44.dp).focusRequester(focus).onFocusChanged { focused = it.isFocused }
            .semantics { contentDescription = label },
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxWidth().border(if (focused) 2.dp else 1.dp, if (focused) Sm.Blue else Sm.BorderStrong, shape).padding(horizontal = 11.2.dp),
                if (code) Alignment.Center else Alignment.CenterStart,
            ) {
                if (value.isEmpty()) Text(placeholder, Modifier.fillMaxWidth(), style = style.copy(color = Sm.Faint), maxLines = 1)
                inner()
            }
        },
    )
}

// .notion-button.notion-button-primary.signin-submit：整行、高 ≥44、上 12、圆角 8、15/600、--sm-ink 底白字；禁用 .45。
@Composable
private fun SignInSubmit(text: String, enabled: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    Box(
        Modifier.padding(top = 12.dp).fillMaxWidth().heightIn(min = 44.dp).alpha(if (enabled) 1f else 0.45f).clip(shape).background(Sm.Ink)
            .clickable(enabled = enabled, onClick = onClick).semantics { role = Role.Button }.padding(horizontal = 12.dp),
        Alignment.Center,
    ) { Text(text, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
}
