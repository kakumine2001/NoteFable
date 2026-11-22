package com.kakumine.notefable.ui

import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import com.kakumine.notefable.data.isShared

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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.kakumine.notefable.BuildConfig
import com.kakumine.notefable.R
import com.kakumine.notefable.data.AppLanguage
import com.kakumine.notefable.data.ChatLink
import com.kakumine.notefable.data.EmbedMessage
import com.kakumine.notefable.data.NoteFileLinks
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
 * 网页 → 原生：`window.NoteFableNative.postMessage(json)`；原生 → 网页：`window.notefableEmbed.flush(id)` / `openHistory()` / `pageUpdated(pageJson)`。
 */
class NoteEmbedBridge(
    /** 设置里现在选的图标（null 是默认标志）。会在 WebView 的 JS 线程上调用，所以要能在任何线程读。 */
    private val currentIcon: () -> String? = { null },
    private val onMessage: (EmbedMessage) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val pending = ConcurrentHashMap<String, CompletableDeferred<FlushResult>>()
    private val mounting = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()
    var webView: WebView? = null

    /** 网页打开时读图标（`window.NoteFableNative.appIcon()`）：表情或图片的 data URL，默认标志是空字符串。在 WebView 的 JS 线程上调用。 */
    @JavascriptInterface
    fun appIcon(): String = currentIcon().orEmpty()

    @JavascriptInterface
    fun language(): String = AppLanguage.uiLocale

    /** Swap the dictionary without reloading the note, its draft or AI stream. */
    fun pushLanguage(code: String) {
        webView?.evaluateJavascript("(function(){var e=window.notefableEmbed;if(e&&typeof e.language==='function')e.language(${JSONObject.quote(code)})})()", null)
    }

    /** 编辑器开着时在设置里换了图标：交给网页（`window.notefableEmbed.appIcon`），AI 按钮马上跟着变。 */
    fun pushAppIcon(icon: String?) {
        webView?.evaluateJavascript(appIconScript(icon), null)
    }

    // 在 WebView 的 JS 线程上调用，转到主线程处理。
    @JavascriptInterface
    fun postMessage(json: String) {
        val message = EmbedMessage.parse(json) ?: return
        if (message is EmbedMessage.Flushed) {
            pending.remove(message.requestId)?.complete(FlushResult(message.ok, message.kept))
            return
        }
        main.post {
            if (message is EmbedMessage.Ready) pushLanguage(AppLanguage.uiLocale)
            onMessage(message)
        }
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
            val script = "(function(){var e=window.notefableEmbed;if(e&&typeof e.flush==='function'){e.flush(${JSONObject.quote(id)});return true}return false})()"
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
        webView?.evaluateJavascript("(function(){var e=window.notefableEmbed;if(e&&typeof e.openHistory==='function')e.openHistory()})()", null)
    }

    /**
     * 别处（聊天里的提案）改了这篇笔记：把服务端返回的新版本交给网页，走网页 notefable:page-updated 的同一条路
     * （没有未保存的编辑就换成新版本，有就提示冲突），否则编辑器还拿着旧版本，下次保存会 409。
     */
    fun pageUpdated(pageJson: String) {
        webView?.evaluateJavascript(pageUpdatedScript(pageJson), null)
    }

    /** 原生"…"菜单改了字体、小字号、全宽、锁定或收藏：把服务端返回的一览项交给网页（window.notefableEmbed.pageSettings）。 */
    fun pageSettings(pageJson: String) {
        webView?.evaluateJavascript(pageSettingsScript(pageJson), null)
    }

    companion object {
        /** 页面 JSON 作为字符串字面量传过去，网页里再 JSON.parse。 */
        fun pageUpdatedScript(pageJson: String) =
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.pageUpdated==='function')e.pageUpdated(${JSONObject.quote(pageJson)})})()"

        fun pageSettingsScript(pageJson: String) =
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.pageSettings==='function')e.pageSettings(${JSONObject.quote(pageJson)})})()"

        /** 图标作为字符串字面量传过去；默认标志传 null。 */
        fun appIconScript(icon: String?) =
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.appIcon==='function')e.appIcon(${icon?.let(JSONObject::quote) ?: "null"})})()"

        private const val FLUSH_TIMEOUT_MS = 15_000L
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

/** 网页的语言代码（en / zh / zh-Hant / ja）：和 App 界面实际用的语言（资源里的 ui_locale）一致。 */
@Composable
private fun embedLanguage(): String = stringResource(R.string.ui_locale)

// 笔记编辑页：原生顶栏 + WebView 里的网页编辑器。
// 顶栏与网页手机版笔记页一致（高 56、左右 10.4）：菜单 40（图标 20）、间距 12、"<"返回列表 40（图标 22）、间距 12、
// 笔记图标（表情 15 / 文件图标 15）+ 间距 6 + 标题 14 灰；右侧搜索 40（图标 20）、间距 8、版本历史 40（图标 20）、间距 8、
// 保存状态 14 灰（出错 / 冲突时 #b45309）。
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
    /** 笔记里的私有文件（`/api/pages/files?…`）：由 App 带着 Cookie 下载。 */
    onDownload: (String) -> Unit,
    onMessage: (String, EmbedMessage) -> Unit,
    registerFlush: (NoteEmbedBridge?) -> Unit,
    onSearch: () -> Unit = {},
    /** 笔记里指向本站聊天的链接（?chat=&message=）：在 App 里打开聊天。 */
    onChatLink: (ChatLink) -> Unit = {},
    /** 列表里这一篇（收藏、显示设置、锁定）；不在列表里时没有"…"菜单。 */
    page: com.kakumine.notefable.data.NotePageSummary? = null,
    menu: NotePageMenuActions? = null,
    onShare: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val currentOnMessage by rememberUpdatedState(onMessage)
    val currentEmbedUrl by rememberUpdatedState(embedUrl)
    val currentOnDownload by rememberUpdatedState(onDownload)
    val currentOnChatLink by rememberUpdatedState(onChatLink)
    // 消息按编辑器（[OpenNote.editor]）转发，不按页面 id：冲突后"另存为新笔记"时网页会换到新页面，由 ViewModel 跟过去。
    // 网页里的 AI 按钮用设置里选的图标：网页打开时经桥读现在的值，开着的时候换了再推过去。
    val iconStore = appIconStore()
    val bridge: NoteEmbedBridge = remember(open.editor) {
        NoteEmbedBridge(currentIcon = { iconStore?.icon?.value }) { message -> currentOnMessage(open.editor, message) }
    }
    val appIcon = currentAppIcon()
    LaunchedEffect(bridge, appIcon) { bridge.pushAppIcon(appIcon) }
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
            TopIconButton(Lucide.Search, stringResource(R.string.search_chats_and_notes), onSearch)
            Spacer(Modifier.width(8.dp))
            // 锁定中（网页 .notes-locked-button，手机只有锁的图标）：高 32、左右 8、圆角 6、Lock 14 灰；点一下解锁。
            if (page?.locked == true && menu != null) {
                val unlock = stringResource(R.string.pg_unlock_page)
                Box(
                    Modifier.height(32.dp).clip(RoundedCornerShape(6.dp)).clickable { menu.onSettings(com.kakumine.notefable.data.NotePageSettings(locked = false)) }
                        .padding(horizontal = 8.dp).semantics { contentDescription = unlock; role = Role.Button },
                    Alignment.Center,
                ) { LucideIcon(Lucide.Lock, 14.dp, Sm.Muted) }
                Spacer(Modifier.width(8.dp))
            }
            if (page != null && onShare != null) {
                val shareLabel = stringResource(R.string.share_action)
                val isShared = page.isShared()
                Box(
                    Modifier.height(32.dp).clip(RoundedCornerShape(6.dp)).clickable(onClick = onShare)
                        .padding(horizontal = 8.dp).semantics { contentDescription = shareLabel; role = Role.Button },
                    Alignment.Center,
                ) { LucideIcon(Lucide.Globe, 15.dp, if (isShared) Sm.Blue else Sm.Muted) }
                Spacer(Modifier.width(8.dp))
            }
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
            if (page != null && menu != null) {
                Spacer(Modifier.width(8.dp))
                NotePageMenuButton(page, menu)
            }
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
                    attachBridge(bridge)
                    // 网页按下载处理的响应（Content-Disposition: attachment）：本站的笔记文件由 App 下载，其它交给系统。
                    setDownloadListener { url, _, _, _, _ ->
                        if (NoteFileLinks.isNoteFile(url, baseUrl)) currentOnDownload(url)
                        else try {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        } catch (_: ActivityNotFoundException) { }
                    }
                    webViewClient = object : WebViewClient() {
                        // 只在 WebView 里打开本站的 /note-embed；本站的笔记文件由 App 带着 Cookie 下载
                        // （系统浏览器没有 App 的 Cookie，只会拿到 404）；其它链接（笔记里的网址等）交给系统浏览器。
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val target = request.url
                            if (NoteFileLinks.isNoteFile(target.toString(), baseUrl)) {
                                currentOnDownload(target.toString())
                                return true
                            }
                            val base = Uri.parse(baseUrl)
                            val sameSite = target.scheme == base.scheme && target.host == base.host && target.port == base.port
                            if (sameSite && target.path.orEmpty().contains("/note-embed")) return false
                            // 本站的聊天链接（保存的回答里写的 /?chat=…&message=…）：在 App 里打开，不交给浏览器。
                            ChatLink.parse(target.toString(), baseUrl)?.let { link ->
                                currentOnChatLink(link)
                                return true
                            }
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
        LaunchedEffect(bridge, lang) { bridge.pushLanguage(lang) }
        LaunchedEffect(bridge, generation) {
            syncCookies(baseUrl, cookieJar)
            bridge.webView?.loadUrl(currentEmbedUrl(lang))
        }
    }
}

/** 网页侧的 `window.NoteFableNative`。单独一个有具体类型的函数：lint 在 apply 块里看不出 [bridge] 的类型（只看到泛型 T）。 */
private fun WebView.attachBridge(bridge: NoteEmbedBridge) = addJavascriptInterface(bridge, "NoteFableNative")
