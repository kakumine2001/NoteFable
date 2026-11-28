package com.kakumine.notefable.ui

import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.kakumine.notefable.R
import okhttp3.CookieJar

// 工作区统一「用 AI 生成」（笔记 / 白板 / 幻灯片）。面板本身运行在常驻 /note-embed WebView 里的 AiGenerateHost。

private const val AI_GEN_FAILED = "Could not generate the note. Try again."

@Composable
internal fun LaunchAiGenerate(
    host: NoteEmbedHost,
    aiGenerate: AiGenerateUi,
    model: String?,
    reasoning: String?,
    onShown: (Int) -> Unit,
    onFailed: (Int) -> Unit,
) {
    val context = LocalContext.current
    val systemText = rememberSystemText()
    LaunchedEffect(host, aiGenerate.request, host.generation) {
        if (aiGenerate.shown && host.aiGenerateVisible) return@LaunchedEffect
        val script = NoteEmbedBridge.aiGenerateOpenScript(aiGenerate.target, model, reasoning)
        if (script != null && host.openAiGenerate(script)) {
            onShown(aiGenerate.request)
        } else {
            Toast.makeText(context, systemText.localize(AI_GEN_FAILED), Toast.LENGTH_LONG).show()
            onFailed(aiGenerate.request)
        }
    }
}

@Composable
internal fun AiGenerateScreen(
    host: NoteEmbedHost,
    aiGenerate: AiGenerateUi,
    embedUrl: (lang: String, theme: String) -> String,
    model: String?,
    reasoning: String?,
    baseUrl: String,
    cookieJar: CookieJar,
    onShown: (Int) -> Unit,
    onDismiss: (Int) -> Unit,
    prompt: (@Composable () -> Unit)? = null,
) {
    val context = LocalContext.current
    val bridge = host.bridge
    val theme = NoteEmbedBridge.themeValue(Sm.isDark)
    val webBackground = Sm.Background.toArgb()
    val lang = stringResource(R.string.ui_locale)
    val appIcon = currentAppIcon()
    LaunchedEffect(bridge, theme) {
        bridge.webView?.setBackgroundColor(webBackground)
        bridge.pushTheme(theme)
    }
    LaunchedEffect(bridge, lang) { bridge.pushLanguage(lang) }
    LaunchedEffect(bridge, appIcon) { bridge.pushAppIcon(appIcon) }
    val focus = LocalFocusManager.current
    LaunchedEffect(Unit) { focus.clearFocus() }
    RememberWebFileChooser(host)

    val mount = remember { intArrayOf(host.mountCount) }
    DisposableEffect(host) { onDispose { host.parkAiGenerate(mount[0]) } }
    val close = {
        if (!aiGenerate.shown) host.discardAiGenerateIfUnready()
        onDismiss(aiGenerate.request)
    }
    BackHandler {
        if (aiGenerate.shown) bridge.aiGenerateBack { handled -> if (!handled) close() } else close()
    }

    Column(
        Modifier.fillMaxSize()
            .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } }
            .background(Sm.Background)
            .statusBarsPadding()
            .windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime)),
    ) {
        if (prompt != null) Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp)) { prompt() }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            key(host.generation) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        FrameLayout(ctx).apply {
                            addView(host.attachWebView(ctx, baseUrl, webBackground))
                            mount[0] = host.mountCount
                        }
                    },
                    onRelease = { frame -> frame.removeAllViews() },
                )
            }
            if (!aiGenerate.shown) {
                Box(Modifier.fillMaxSize().background(Sm.Background)) {
                    Box(Modifier.align(Alignment.TopEnd).padding(8.dp)) {
                        TopIconButton(Lucide.X, stringResource(R.string.close), close)
                    }
                    Row(
                        Modifier.align(Alignment.Center).semantics { liveRegion = LiveRegionMode.Polite },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Spinner(16.dp, Sm.Muted)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.sb_loading), color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp)
                    }
                }
            }
        }
    }

    LaunchedEffect(host, host.generation) {
        host.showAiGenerate(
            context = context,
            theme = theme,
            lang = lang,
            webBackground = webBackground,
            appIcon = appIcon,
            embedUrl = embedUrl(lang, theme),
            baseUrl = baseUrl,
            cookieJar = cookieJar,
        )
    }
    LaunchAiGenerate(
        host, aiGenerate, model, reasoning, onShown,
        onFailed = { request ->
            host.discardAiGenerate()
            onDismiss(request)
        },
    )
}
