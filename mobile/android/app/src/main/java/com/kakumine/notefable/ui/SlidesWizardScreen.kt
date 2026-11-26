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

// AI 生成幻灯片（#150）。向导本身是网页（src/components/slides-wizard.tsx），开在笔记编辑器那个常驻的 /note-embed WebView 里：
// 画面上有编辑器时盖在它上面（NoteEditorScreen），聊天、笔记列表上则是下面的全屏画面。约定见
// docs/architecture/android-native.md 的“AI 生成幻灯片”和 notes-flow.md。

/** 网页 msg("Could not generate slides. Try again.")：英文原句，经系统文词典翻译。 */
private const val SLIDES_FAILED = "Could not generate slides. Try again."

/**
 * 让常驻 WebView 里的网页打开向导。换了一次打开、或 WebView 换掉（渲染进程崩溃）后重新叫一次；网页已经显示着
 * （笔记 AI 面板里打开的）时不用叫。打不开（旧服务端、页面加载不了）时提示一句并 [onFailed]。
 */
@Composable
internal fun LaunchSlidesWizard(
    host: NoteEmbedHost,
    wizard: SlidesWizardUi,
    model: String?,
    reasoning: String?,
    onShown: (Int) -> Unit,
    onFailed: (Int) -> Unit,
) {
    val context = LocalContext.current
    val systemText = rememberSystemText()
    LaunchedEffect(host, wizard.request, host.generation) {
        if (wizard.shown && host.slidesWizardVisible) return@LaunchedEffect
        val script = NoteEmbedBridge.slidesWizardOpenScript(wizard.source, model, reasoning)
        if (script != null && host.openSlidesWizard(script)) {
            onShown(wizard.request)
        } else {
            Toast.makeText(context, systemText.localize(SLIDES_FAILED), Toast.LENGTH_LONG).show()
            onFailed(wizard.request)
        }
    }
}

/**
 * 没有开着页面时（聊天的“＋”、笔记列表和侧栏的“用 AI 生成”）的全屏向导：挂上常驻 WebView，没加载过就加载空白的编辑器，
 * 网页里出来之前显示“读取中”。关掉（网页的 closed、返回键）后回到原来的画面，WebView 停靠。
 */
@Composable
internal fun SlidesWizardScreen(
    host: NoteEmbedHost,
    wizard: SlidesWizardUi,
    /** 空白编辑器的地址（NoteFableApi.slidesWizardUrl）。 */
    embedUrl: (lang: String, theme: String) -> String,
    model: String?,
    reasoning: String?,
    baseUrl: String,
    cookieJar: CookieJar,
    onShown: (Int) -> Unit,
    onDismiss: (Int) -> Unit,
    /** 向导上方的提示（使用次数上限：登录 / 升级）。 */
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
    // 下面画面的输入框收起键盘。
    val focus = LocalFocusManager.current
    LaunchedEffect(Unit) { focus.clearFocus() }

    // 这个画面最后一次挂上 WebView 的序号：离开时只停靠自己挂着的。
    val mount = remember { intArrayOf(host.mountCount) }
    DisposableEffect(host) { onDispose { host.parkWizard(mount[0]) } }
    val close = { onDismiss(wizard.request) }
    BackHandler {
        // 网页里出来之后，返回键关它最上面一层（草稿保留）；还在读取时直接关掉。
        if (wizard.shown) bridge.slidesWizardBack { handled -> if (!handled) close() } else close()
    }

    Column(
        // 盖在抽屉、聊天和笔记列表之上：触摸不能穿到下面去。
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
                    // 外面包一层：之后编辑器接走这个 WebView 时，这里释放只摘掉还挂在自己身上的。
                    factory = { ctx ->
                        FrameLayout(ctx).apply {
                            addView(host.attachWebView(ctx, baseUrl, webBackground))
                            mount[0] = host.mountCount
                        }
                    },
                    onRelease = { frame -> frame.removeAllViews() },
                )
            }
            if (!wizard.shown) {
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
        host.showWizard(
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
    LaunchSlidesWizard(
        host, wizard, model, reasoning, onShown,
        onFailed = { request ->
            // 页面没加载成时不留着这个 WebView，下次重新加载。
            host.discardWizard()
            onDismiss(request)
        },
    )
}
