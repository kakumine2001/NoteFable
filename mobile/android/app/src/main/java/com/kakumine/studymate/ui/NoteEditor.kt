package com.kakumine.studymate.ui

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.kakumine.studymate.BuildConfig
import com.kakumine.studymate.R
import com.kakumine.studymate.data.EmbedMessage
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

/**
 * 原生和网页编辑器（/note-embed）之间的 JS 桥。约定见 src/lib/native-bridge.ts：
 * 网页 → 原生：`window.StudyMateNative.postMessage(json)`；原生 → 网页：`window.studymateEmbed.flush(id)` / `openHistory()`。
 */
class NoteEmbedBridge(private val onMessage: (EmbedMessage) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val pending = ConcurrentHashMap<String, CompletableDeferred<FlushResult>>()
    private val mounting = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()
    var webView: WebView? = null

    // 在 WebView 的 JS 线程上调用，转到主线程处理。
    @JavascriptInterface
    fun postMessage(json: String) {
        val message = EmbedMessage.parse(json) ?: return
        if (message is EmbedMessage.Flushed) {
            pending.remove(message.requestId)?.complete(FlushResult(message.ok, message.kept))
            return
        }
        main.post { onMessage(message) }
    }

    /**
     * 让网页立刻保存。ok 表示没有未保存的内容。
     * 编辑器还没挂上（页面没加载完、加载失败）时没有可保存的编辑，直接算成功；
     * 整个过程（包括 evaluateJavascript 本身）15 秒没结果、或者 WebView 中途被销毁，都算失败。
     */
    suspend fun flush(): FlushResult = withTimeoutOrNull(FLUSH_TIMEOUT_MS) { flushNow() } ?: FlushResult(false)

    private suspend fun flushNow(): FlushResult {
        val view = webView ?: return FlushResult(true)
        val id = UUID.randomUUID().toString()
        val mounted = CompletableDeferred<Boolean>()
        val answer = CompletableDeferred<FlushResult>()
        mounting[id] = mounted
        pending[id] = answer
        try {
            val script = "(function(){var e=window.studymateEmbed;if(e&&typeof e.flush==='function'){e.flush(${JSONObject.quote(id)});return true}return false})()"
            view.evaluateJavascript(script) { result -> mounted.complete(result == "true") }
            if (!mounted.await()) return FlushResult(webView === view)
            return answer.await()
        } finally {
            mounting.remove(id)
            pending.remove(id)
        }
    }

    /** WebView 被销毁（离开编辑页、渲染进程崩溃）：等着它回答的保存都算失败，不再等。 */
    fun release(view: WebView) {
        if (webView !== view) return
        webView = null
        mounting.values.forEach { it.complete(false) }
        pending.values.forEach { it.complete(FlushResult(false)) }
    }

    fun openHistory() {
        webView?.evaluateJavascript("(function(){var e=window.studymateEmbed;if(e&&typeof e.openHistory==='function')e.openHistory()})()", null)
    }

    private companion object {
        const val FLUSH_TIMEOUT_MS = 15_000L
    }
}

private const val CLOSE_TOP_DIALOG =
    "(function(){var d=document.querySelectorAll('dialog[open]');if(!d.length)return false;" +
        "d[d.length-1].dispatchEvent(new Event('cancel',{cancelable:true}));return true})()"

/** WebView 的 Cookie 换成 App 的（匿名设备 Cookie、登录会话），先清掉旧的，避免退出登录后网页还用旧身份。 */
private suspend fun syncCookies(baseUrl: String, jar: CookieJar) {
    val manager = CookieManager.getInstance()
    manager.setAcceptCookie(true)
    suspendCancellableCoroutine { cont -> manager.removeAllCookies { if (cont.isActive) cont.resume(Unit) } }
    val url = baseUrl.toHttpUrl()
    jar.loadForRequest(url).forEach { manager.setCookie(baseUrl, it.toString()) }
    manager.flush()
}

/** 网页的语言代码：App 的界面语言是中文 / 日文时带上，其他用英文。 */
@Composable
private fun embedLanguage(): String = when (LocalConfiguration.current.locales[0]?.language) {
    "zh" -> "zh"
    "ja" -> "ja"
    else -> "en"
}

// 笔记编辑页：原生顶栏 + WebView 里的网页编辑器。
// 顶栏与网页手机版笔记页一致（高 56、左右 10.4）：菜单 40（图标 20）、间距 12、"<"返回列表 40（图标 22）、间距 12、
// 笔记图标（表情 15 / 文件图标 15）+ 间距 6 + 标题 14 灰；右侧版本历史 40（图标 20）、间距 8、保存状态 14 灰
// （出错 / 冲突时 #b45309）。网页顶栏的搜索按钮原生版还没有对应功能，不放。
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun NoteEditorScreen(
    open: OpenNote,
    saveState: String?,
    notice: String?,
    embedUrl: (lang: String) -> String,
    baseUrl: String,
    cookieJar: CookieJar,
    drawerOpen: Boolean,
    onMenu: () -> Unit,
    onBack: () -> Unit,
    onDismissNotice: () -> Unit,
    onMessage: (String, EmbedMessage) -> Unit,
    registerFlush: (NoteEmbedBridge?) -> Unit,
) {
    val context = LocalContext.current
    val currentOnMessage by rememberUpdatedState(onMessage)
    val currentEmbedUrl by rememberUpdatedState(embedUrl)
    // 消息按编辑器（[OpenNote.editor]）转发，不按页面 id：冲突后"另存为新笔记"时网页会换到新页面，由 ViewModel 跟过去。
    val bridge = remember(open.editor) { NoteEmbedBridge { message -> currentOnMessage(open.editor, message) } }
    // 渲染进程崩溃后换一个新的 WebView 重新加载（没保存的编辑网页已经存进 localStorage，重新打开时会恢复）。
    var generation by remember(open.editor) { mutableIntStateOf(0) }
    val fileCallback = remember(open.editor) { arrayOfNulls<ValueCallback<Array<Uri>>>(1) }
    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback[0]?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback[0] = null
    }

    DisposableEffect(bridge) {
        registerFlush(bridge)
        onDispose {
            registerFlush(null)
            fileCallback[0]?.onReceiveValue(null)
            fileCallback[0] = null
        }
    }

    // 网页里打开的面板（版本历史、图标选择器）会往历史里推一条记录，返回键先交给网页关面板；没有了才离开笔记。
    // 从原生调用打开的面板没有用户手势，浏览器不一定给它留历史记录，所以再看一眼有没有打开的 <dialog>：
    // 有就发 cancel 事件（等同网页里按 Esc，只关最上面一层），没有才保存并离开。
    BackHandler(enabled = !drawerOpen) {
        val view = bridge.webView
        when {
            view == null -> onBack()
            view.canGoBack() -> view.goBack()
            else -> view.evaluateJavascript(CLOSE_TOP_DIALOG) { closed -> if (closed != "true") onBack() }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(horizontal = 10.4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TopIconButton(Lucide.Menu, stringResource(R.string.open_menu), onMenu)
            Spacer(Modifier.width(12.dp))
            TopIconButton(Lucide.ChevronLeft, stringResource(R.string.all_notes), onBack, iconSize = 22.dp)
            Spacer(Modifier.width(12.dp))
            Box(Modifier.size(20.dp), Alignment.Center) { NoteIcon(open.icon, 15.sp, 15.dp, Sm.Muted) }
            Spacer(Modifier.width(6.dp))
            Text(
                open.title.ifEmpty { stringResource(R.string.notes) },
                modifier = Modifier.weight(1f),
                color = Sm.Muted, fontSize = 14.sp, lineHeight = 20.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.width(8.dp))
            TopIconButton(Lucide.History, stringResource(R.string.version_history), bridge::openHistory)
            Spacer(Modifier.width(8.dp))
            val status = when (saveState) {
                "saved" -> stringResource(R.string.save_saved)
                "saving", "unsaved" -> stringResource(R.string.save_saving)
                "error" -> stringResource(R.string.save_not_saved)
                "conflict" -> stringResource(R.string.save_conflict)
                else -> ""
            }
            Text(status, color = if (saveState == "error" || saveState == "conflict") Color(0xFFB45309) else Sm.Muted, fontSize = 14.sp, maxLines = 1)
        }
        if (notice != null) {
            ErrorBar(notice, null, Modifier.padding(horizontal = 24.dp, vertical = 8.dp).clickable(onClick = onDismissNotice))
        }

        val lang = embedLanguage()
        androidx.compose.runtime.key(generation) { AndroidView(
            modifier = Modifier.weight(1f).fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime)),
            factory = { ctx ->
                WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    setBackgroundColor(android.graphics.Color.WHITE)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.setSupportMultipleWindows(false)
                    addJavascriptInterface(bridge, "StudyMateNative")
                    webViewClient = object : WebViewClient() {
                        // 只在 WebView 里打开本站的 /note-embed；其它链接（笔记里的网址等）交给系统浏览器。
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val target = request.url
                            val base = Uri.parse(baseUrl)
                            val sameSite = target.scheme == base.scheme && target.host == base.host && target.port == base.port
                            if (sameSite && target.path.orEmpty().contains("/note-embed")) return false
                            try {
                                context.startActivity(Intent(Intent.ACTION_VIEW, target))
                            } catch (_: ActivityNotFoundException) { }
                            return true
                        }

                        // 渲染进程被系统杀掉或崩溃：不处理的话整个 App 会跟着退出。丢掉这个 WebView，换新的重新加载。
                        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                            bridge.release(view)
                            generation++
                            return true
                        }
                    }
                    webChromeClient = object : WebChromeClient() {
                        // 图片 / 文件块的"上传"：用系统文件选择器。
                        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                            fileCallback[0]?.onReceiveValue(null)
                            fileCallback[0] = callback
                            return try {
                                chooser.launch(params.createIntent())
                                true
                            } catch (_: ActivityNotFoundException) {
                                fileCallback[0] = null
                                false
                            }
                        }
                    }
                    bridge.webView = this
                }
            },
            onRelease = { view ->
                bridge.release(view)
                view.stopLoading()
                view.destroy()
            },
        ) }
        LaunchedEffect(bridge, lang, generation) {
            syncCookies(baseUrl, cookieJar)
            bridge.webView?.loadUrl(currentEmbedUrl(lang))
        }
    }
}
