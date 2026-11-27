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

// PowerPoint（.pptx）导入（#154 PR 12）。导入弹窗本身是网页（src/components/pptx-import-dialog.tsx），
// 开在笔记编辑器那个常驻的 /note-embed WebView 里：画面上有编辑器时盖在它上面（NoteEditorScreen），
// 没有打开页面时则是下面的全屏画面，并挂上 RememberWebFileChooser 支持系统 .pptx 文件选择。

/** 网页 msg("Could not import this PowerPoint file. Try again.")：英文原句，经系统文词典翻译。 */
private const val PPTX_IMPORT_FAILED = "Could not import this PowerPoint file. Try again."

/**
 * 让常驻 WebView 里的网页打开 PowerPoint 导入窗口。换了一次打开、或 WebView 换掉（渲染进程崩溃）后重新叫一次；
 * 网页已经显示着（幻灯片工具栏里打开的）时不用叫。打不开时提示一句并 [onFailed]。
 */
@Composable
internal fun LaunchPptxImport(
    host: NoteEmbedHost,
    pptxImport: PptxImportUi,
    onShown: (Int) -> Unit,
    onFailed: (Int) -> Unit,
) {
    val context = LocalContext.current
    val systemText = rememberSystemText()
    LaunchedEffect(host, pptxImport.request, host.generation) {
        if (pptxImport.shown && host.pptxImportVisible) return@LaunchedEffect
        val script = NoteEmbedBridge.pptxImportOpenScript(pptxImport.target)
        if (script != null && host.openPptxImport(script)) {
            onShown(pptxImport.request)
        } else {
            Toast.makeText(context, systemText.localize(PPTX_IMPORT_FAILED), Toast.LENGTH_LONG).show()
            onFailed(pptxImport.request)
        }
    }
}

/**
 * 没有开着页面时（笔记列表、空状态和侧栏的「导入 PowerPoint」）的全屏导入画面：挂上常驻 WebView 与系统文件选择器，
 * 没加载过就加载空白的编辑器，网页出来之前显示“读取中”。关掉后回到原来的画面，WebView 停靠。
 */
@Composable
internal fun PptxImportScreen(
    host: NoteEmbedHost,
    pptxImport: PptxImportUi,
    /** 空白编辑器的地址（NoteFableApi.slidesWizardUrl）。 */
    embedUrl: (lang: String, theme: String) -> String,
    baseUrl: String,
    cookieJar: CookieJar,
    onShown: (Int) -> Unit,
    onDismiss: (Int) -> Unit,
    /** 导入窗口上方的提示（存储空间上限：登录 / 升级）。 */
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
    RememberWebFileChooser(host, resetKey = pptxImport.request)

    val mount = remember { intArrayOf(host.mountCount) }
    DisposableEffect(host) { onDispose { host.parkPptxImport(mount[0]) } }
    val close = {
        if (!pptxImport.shown) host.discardPptxImportIfUnready()
        onDismiss(pptxImport.request)
    }
    BackHandler {
        if (pptxImport.shown) bridge.pptxImportBack { handled -> if (!handled) close() } else close()
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
            if (!pptxImport.shown) {
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
        host.showPptxImport(
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
    LaunchPptxImport(
        host, pptxImport, onShown,
        onFailed = { request ->
            host.discardPptxImport()
            onDismiss(request)
        },
    )
}
