package com.kakumine.notefable.ui

import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import com.kakumine.notefable.data.isShared

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.ActivityInfo
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
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
import androidx.compose.foundation.background
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
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
import com.kakumine.notefable.data.ExportFile
import com.kakumine.notefable.data.ExportFileAssembler
import com.kakumine.notefable.data.NoteFileLinks
import com.kakumine.notefable.data.NotePageSummary
import com.kakumine.notefable.data.PageKind
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume

/**
 * 原生和网页编辑器（/note-embed）之间的 JS 桥。约定见 src/lib/native-bridge.ts：
 * 网页 → 原生：`window.NoteFableNative.postMessage(json)`；原生 → 网页：`window.notefableEmbed.flush(id)` / `openHistory()` / `pageUpdated(pageJson)`。
 * 外观：网页打开时读 `window.NoteFableNative.theme()`，之后变了由 App 调 `window.notefableEmbed.theme(value)`。
 * 传的是 App 现在实际的外观（`light` / `dark`），不传 `system`：WebView 自己的 prefers-color-scheme 跟的是 Activity 的主题
 * （固定浅色）和系统设置，和 App 里选的"外观"不一定一致，交给它解析的话编辑器会和原生顶栏、侧栏不同色。
 */
class NoteEmbedBridge(
    /** 设置里现在选的图标（null 是默认标志）。会在 WebView 的 JS 线程上调用，所以要能在任何线程读。 */
    private val currentIcon: () -> String? = { null },
    /** 网页导出的文件（fileStart / fileChunk / fileEnd / fileAbort）就在 JS 线程上写进这里的临时文件，不占主线程。 */
    private val exports: ExportFileAssembler,
    /** 导出的文件拼好了（fileEnd）：在主线程上调用。null 是没拼成（类型、大小、顺序不对或写不进去），要提示保存失败。 */
    private val onExportFile: (ExportFile?) -> Unit,
    private val onMessage: (EmbedMessage) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val pending = ConcurrentHashMap<String, CompletableDeferred<FlushResult>>()
    private val mounting = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()
    private val exportEpoch = AtomicInteger(0)

    /** 接着的 WebView（主线程写）。[attached] 给 JS 线程读：拆掉（[release]）或暂停（[activeEditor] 为空）之后来的导出文件的块不再收。 */
    var webView: WebView? = null
        set(value) {
            field = value
            attached = value != null
            if (value != null) exports.reopen()
        }

    /** 当前打开着的编辑器（[OpenNote.editor]）；停在列表或聊天里、WebView 只保留热缓存时为 null。主线程写，JS 线程经 [hasActiveEditor] 读。 */
    var activeEditor: String? = null
        set(value) {
            field = value
            hasActiveEditor = value != null
        }

    @Volatile
    private var attached = false

    @Volatile
    private var hasActiveEditor = false

    /** App 现在实际的外观（`light` / `dark`）。界面在主线程写，[theme] 在 WebView 的 JS 线程读。 */
    @Volatile
    var currentTheme: String = THEME_LIGHT

    /** 网页打开时读外观（`window.NoteFableNative.theme()`，src/lib/native-bridge.ts 的 readNativeTheme）。在 WebView 的 JS 线程上调用。 */
    @JavascriptInterface
    fun theme(): String = currentTheme

    /** 编辑器开着时外观变了（设置里换了，或跟随系统时系统切了深色）：交给网页（`window.notefableEmbed.theme`），不重新加载。 */
    fun pushTheme(value: String) {
        currentTheme = value
        webView?.evaluateJavascript(themeScript(value), null)
    }

    /** 网页打开时读图标（`window.NoteFableNative.appIcon()`）：表情或图片的 data URL，默认标志是空字符串。在 WebView 的 JS 线程上调用。 */
    @JavascriptInterface
    fun appIcon(): String = currentIcon().orEmpty()

    @JavascriptInterface
    fun language(): String = AppLanguage.uiLocale

    /** 网页据此知道这个 App 会处理 `openPage`（笔记里的页面提及 / 页面链接）；旧版 App 没有这个方法，网页就照旧用新窗口打开链接。 */
    @JavascriptInterface
    fun canOpenPage(): Boolean = true

    /** 网页据此把"存储空间不够"交给 App 显示（`storageLimit` 消息）；旧版 App 没有这个方法，网页就在编辑器里只说明原因。 */
    @JavascriptInterface
    fun canShowStorageLimit(): Boolean = true

    /** 网页据此把幻灯片的放映交给 App（横屏、全屏、屏幕常亮；`presentation` 消息）。旧版 App 没有这个方法，网页只在 WebView 里放映。 */
    @JavascriptInterface
    fun canPresent(): Boolean = true

    /** 网页据此把导出的文件（白板的 PNG / SVG / PDF，幻灯片的 PDF / PNG / PPTX）分块交给 App 保存；旧版 App 没有这个方法，网页就提示要更新 App。 */
    @JavascriptInterface
    fun canSaveFile(): Boolean = true

    /** 幻灯片的操作（"…"菜单的放映 / 导出、放映中的返回键）：交给网页（`window.notefableEmbed.slides`）。 */
    fun slides(command: String, onResult: ((Boolean) -> Unit)? = null) {
        val view = webView ?: return run { onResult?.invoke(false) }
        view.evaluateJavascript("(function(){var e=window.notefableEmbed;if(e&&typeof e.slides==='function')return e.slides(${JSONObject.quote(command)})===true;return false})()") { result ->
            onResult?.invoke(result == "true")
        }
    }

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
        when (message) {
            is EmbedMessage.Flushed -> {
                pending.remove(message.requestId)?.complete(FlushResult(message.ok, message.kept))
                return
            }
            // 导出文件的块（每块最多 512 KiB）直接在 JS 线程上写进临时文件，拼好了才到主线程上让用户选保存位置。
            // 编辑器已经拆掉（[release]）时不再开始新的文件（不留下没人关的临时文件）。
            is EmbedMessage.FileStart -> {
                if (attached && hasActiveEditor) exports.start(message.id, message.name, message.mime, message.size)
                return
            }
            is EmbedMessage.FileChunk -> {
                if (attached && hasActiveEditor) exports.chunk(message.id, message.index, message.data)
                return
            }
            is EmbedMessage.FileAbort -> {
                exports.abort(message.id)
                return
            }
            is EmbedMessage.FileEnd -> {
                val epoch = exportEpoch.get()
                val file = exports.finish(message.id)
                main.post {
                    // 拼好之前编辑器关掉了、换了另一篇笔记或渲染进程崩溃：不在别的画面上弹出保存位置，也不提示失败，只删临时文件。
                    if (webView == null || activeEditor == null || exportEpoch.get() != epoch) {
                        file?.let { stale -> Thread { stale.file.delete() }.start() }
                        return@post
                    }
                    onExportFile(file)
                }
                return
            }
            else -> Unit
        }
        main.post {
            if (message is EmbedMessage.Ready) {
                pushLanguage(AppLanguage.uiLocale)
                // 页面加载期间外观变了的话，地址里带的那个值已经旧了。
                pushTheme(currentTheme)
                // 首次 HTML 还没加载完用户就已经离开了笔记：立刻让网页卸载编辑器 DOM，不留孤立的编辑实例。
                if (activeEditor == null) {
                    close()
                    return@post
                }
            }
            if (activeEditor == null) return@post
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

    /** 换页或离开笔记时丢弃未拼完的导出文件（保留常驻 WebView 不销毁）。 */
    fun discardExports() {
        exportEpoch.incrementAndGet()
        exports.discard()
    }

    /** WebView 被销毁（换身份、系统内存紧张、退到后台、空闲超时、渲染进程崩溃）：等着它回答的保存都算失败，不再等；没拼完的导出文件也不会再来了。 */
    fun release(view: WebView) {
        // 已经换上新的 WebView 时，不动它正在进行的导出。
        if (webView !== view) return
        webView = null
        activeEditor = null
        mounting.values.forEach { it.complete(false) }
        pending.values.forEach { it.complete(FlushResult(false)) }
        exportEpoch.incrementAndGet()
        exports.close()
    }

    /** 在常驻 WebView 里就地切到另一篇笔记（返回 false 表示旧版服务端或网页尚未挂好，由宿主回退到 loadUrl）。 */
    fun openPage(
        id: String,
        reveal: String? = null,
        model: String? = null,
        reasoning: String? = null,
        onResult: (Boolean) -> Unit,
    ) {
        val view = webView ?: return onResult(false)
        val script = openPageScript(id, reveal, model, reasoning) ?: return onResult(false)
        view.evaluateJavascript(script) { result -> onResult(result == "true") }
    }

    /** 离开笔记回到列表 / 聊天时，让常驻 WebView 卸载当前编辑器 DOM，只保留轻量缓存。 */
    fun close() {
        webView?.evaluateJavascript(CLOSE_SCRIPT, null)
    }

    /** 回收站删掉的页面从常驻 WebView 缓存里清掉（停在列表或聊天里时同样生效）。 */
    fun pageTrashed(ids: Collection<String>) {
        val script = pageTrashedScript(ids) ?: return
        webView?.evaluateJavascript(script, null)
    }

    fun openHistory() {
        webView?.evaluateJavascript("(function(){var e=window.notefableEmbed;if(e&&typeof e.openHistory==='function')e.openHistory()})()", null)
    }

    /**
     * 检索结果就在开着的这一页（不重新加载）：让网页滚到那一块（笔记）或选中并缩放到那个元素（白板），
     * 和第一次加载时地址里的 `reveal` 一样（`window.notefableEmbed.reveal`）。网页不认的 id 不发（[revealScript]）。
     */
    fun reveal(target: String) {
        val script = revealScript(target) ?: return
        webView?.evaluateJavascript(script, null)
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

        const val THEME_LIGHT = "light"
        const val THEME_DARK = "dark"

        /** App 实际的外观在桥上用的值（网页 ThemePreference 的 "light" / "dark"）。 */
        fun themeValue(dark: Boolean) = if (dark) THEME_DARK else THEME_LIGHT

        fun themeScript(value: String) =
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.theme==='function')e.theme(${JSONObject.quote(value)})})()"

        /** 网页只认这种块 / 元素 id（src/lib/native-bridge.ts 的 REVEAL_TARGET，地址里的 reveal 也一样）。 */
        private val REVEAL_TARGET = Regex("^[A-Za-z0-9_-]{1,120}$")

        /**
         * 让开着的编辑器跳到 [target] 的脚本；网页不认的 id 返回 null（不发）。id 写成 JSON 字符串
         * （用 kotlinx 的 JsonPrimitive，不用 org.json：单元测试里 android.jar 的 org.json 是空壳）。
         */
        fun revealScript(target: String): String? {
            if (!REVEAL_TARGET.matches(target)) return null
            return "(function(){var e=window.notefableEmbed;if(e&&typeof e.reveal==='function')e.reveal(${JsonPrimitive(target)})})()"
        }

        const val CLOSE_SCRIPT =
            "(function(){var e=window.notefableEmbed;if(e&&typeof e.close==='function')return e.close()===true;return false})()"

        /** 在常驻 WebView 里就地切页的脚本（window.notefableEmbed.openPage）；id 不合法时返回 null。 */
        fun openPageScript(
            id: String,
            reveal: String? = null,
            model: String? = null,
            reasoning: String? = null,
        ): String? {
            if (!REVEAL_TARGET.matches(id)) return null
            val fields = linkedMapOf<String, kotlinx.serialization.json.JsonElement>("id" to JsonPrimitive(id))
            reveal?.takeIf { REVEAL_TARGET.matches(it) }?.let { fields["reveal"] = JsonPrimitive(it) }
            model?.trim()?.takeIf { it.isNotEmpty() }?.let { fields["model"] = JsonPrimitive(it) }
            reasoning?.trim()?.takeIf { it.isNotEmpty() }?.let { fields["reasoning"] = JsonPrimitive(it) }
            return "(function(){var e=window.notefableEmbed;if(e&&typeof e.openPage==='function')return e.openPage(${JsonObject(fields)})===true;return false})()"
        }

        /** 把移进回收站的页面 id 通知常驻 WebView 清理缓存（window.notefableEmbed.pageTrashed）。 */
        fun pageTrashedScript(ids: Collection<String>): String? {
            val valid = ids.filter { REVEAL_TARGET.matches(it) }
            if (valid.isEmpty()) return null
            return "(function(){var e=window.notefableEmbed;if(e&&typeof e.pageTrashed==='function')return e.pageTrashed(${JsonArray(valid.map(::JsonPrimitive))})===true;return false})()"
        }

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

/**
 * 这次加载的地址要带的检索命中块（[OpenNote.reveal]）：只在编辑器第一次加载（[generation] 是 0）时带，
 * 渲染进程崩溃后重新加载时不再跳过去。已经开着的那一页不重新加载，改走 [NoteEmbedBridge.reveal]。
 */
internal fun loadReveal(open: OpenNote, generation: Int): String? = open.reveal.takeIf { generation == 0 }

/**
 * 整个笔记工作区共用的常驻 /note-embed WebView 宿主：首次打开笔记时按需创建，切页或短暂回到列表 / 聊天时保留
 * 网页壳和缓存（最多 8 篇），离开笔记时调 `window.notefableEmbed.close()` 卸载编辑器 DOM。
 * 换身份、系统内存紧张、App 退到后台、空闲超过 120 秒、渲染进程崩溃或宿主销毁时彻底释放 WebView。
 */
@SuppressLint("SetJavaScriptEnabled")
class NoteEmbedHost(
    cacheDir: File,
    private val hostScope: CoroutineScope,
    currentIcon: () -> String?,
) {
    var onMessage: (String, EmbedMessage) -> Unit = { _, _ -> }
    var onDownload: (String) -> Unit = {}
    var onChatLink: (ChatLink) -> Unit = {}
    var onExportFile: (ExportFile?) -> Unit = {}
    var onShowFileChooser: ((ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams) -> Boolean)? = null
    var excludeEdges: Boolean = false

    /** 幻灯片放映中（网页发 presentation start / end）：横屏、全屏、屏幕常亮，原生顶栏收起。 */
    var presenting by mutableStateOf(false)
        private set

    /** 渲染进程崩溃后递增，促使正在显示的编辑页重新挂上新的 WebView 并重新加载。 */
    var generation by mutableIntStateOf(0)
        private set

    var webView: WebView? = null
        private set

    private var loadedForIdentity = false
    private var crashedEditor: String? = null
    /** 当前活跃笔记的页面 id（用于过滤已切走旧页面的晚到 missing 消息）。 */
    private var currentPageId: String? = null
    /** 正在切往的目标页面 id：在该页的 Ready 到达前，丢弃旧页残留的晚到消息，避免串到新页上。 */
    private var awaitingPageId: String? = null
    private var idleJob: Job? = null
    private var loadJob: Job? = null
    private var showEpoch = 0

    val bridge: NoteEmbedBridge = NoteEmbedBridge(
        currentIcon = currentIcon,
        exports = ExportFileAssembler(File(cacheDir, ExportFileAssembler.DIR_NAME)),
        onExportFile = { file -> onExportFile(file) },
    ) { message ->
        val editor = bridge.activeEditor ?: return@NoteEmbedBridge
        val expected = awaitingPageId
        if (expected != null) {
            when (message) {
                is EmbedMessage.Ready -> {
                    if (message.id != expected) return@NoteEmbedBridge
                    awaitingPageId = null
                    currentPageId = message.id
                }
                is EmbedMessage.Missing -> {
                    if (message.id != null && message.id != expected) return@NoteEmbedBridge
                    awaitingPageId = null
                }
                else -> return@NoteEmbedBridge
            }
        } else {
            when (message) {
                is EmbedMessage.Ready -> currentPageId = message.id
                is EmbedMessage.Missing -> {
                    val current = currentPageId
                    if (message.id != null && current != null && message.id != current) return@NoteEmbedBridge
                }
                else -> Unit
            }
        }
        if (message is EmbedMessage.Presentation) presenting = message.state != "end"
        // 网页（重新）载入后不在放映：渲染进程崩溃后重载时收不到 end，这里清掉（否则一直横屏、没有顶栏，返回键也离不开）。
        if (message is EmbedMessage.Ready) presenting = false
        onMessage(editor, message)
    }

    /** 当前没有笔记显示（停在列表或聊天，WebView 只保留热缓存）。 */
    val isParked: Boolean get() = bridge.activeEditor == null

    fun endPresentationLocally() {
        presenting = false
    }

    /** 确保单实例 WebView 存在（不从现有父视图摘除，供同屏切页使用）。 */
    fun ensureWebView(context: Context, baseUrl: String, webBackground: Int): WebView {
        webView?.let { existing ->
            existing.setBackgroundColor(webBackground)
            return existing
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        return WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(webBackground)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            attachBridge(bridge)
            // 网页按下载处理的响应（Content-Disposition: attachment）：本站的笔记文件由 App 下载，其它交给系统。
            setDownloadListener { url, _, _, _, _ ->
                if (NoteFileLinks.isNoteFile(url, baseUrl)) onDownload(url)
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
                        onDownload(target.toString())
                        return true
                    }
                    val base = Uri.parse(baseUrl)
                    val sameSite = target.scheme == base.scheme && target.host == base.host && target.port == base.port
                    if (sameSite && target.path.orEmpty().contains("/note-embed")) return false
                    // 本站的聊天链接（保存的回答里写的 /?chat=…&message=…）：在 App 里打开，不交给浏览器。
                    ChatLink.parse(target.toString(), baseUrl)?.let { link ->
                        onChatLink(link)
                        return true
                    }
                    try {
                        context.startActivity(Intent(Intent.ACTION_VIEW, target))
                    } catch (_: ActivityNotFoundException) { }
                    return true
                }

                // 渲染进程被系统杀掉或崩溃：不处理的话整个 App 会跟着退出。正在看笔记就换新的重载；停在后台就只销毁。
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    val wasEditor = bridge.activeEditor
                    destroy()
                    if (wasEditor != null) {
                        crashedEditor = wasEditor
                        onMessage(wasEditor, EmbedMessage.Drawing(false))
                        generation++
                    }
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                // 图片 / 文件块的"上传"：用系统文件选择器。
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    val handler = onShowFileChooser ?: return false
                    return handler(callback, params)
                }
            }
            addOnLayoutChangeListener(drawingEdgeListener { excludeEdges })
            bridge.webView = this
            this@NoteEmbedHost.webView = this
        }
    }

    /** 给新挂上的 AndroidView 返回单实例 WebView（若还挂在旧容器上先摘除）。 */
    fun attachWebView(context: Context, baseUrl: String, webBackground: Int): WebView {
        val view = ensureWebView(context, baseUrl, webBackground)
        (view.parent as? ViewGroup)?.removeView(view)
        return view
    }

    /** 打开或切到 [open]：已加载过同一身份的 /note-embed 时优先走 `openPage` 就地切页，失败则重建干净 WebView 回退整页加载。 */
    fun show(
        context: Context,
        open: OpenNote,
        lang: String,
        theme: String,
        webBackground: Int,
        appIcon: String?,
        model: String?,
        reasoning: String?,
        embedUrl: (lang: String, theme: String, reveal: String?) -> String,
        baseUrl: String,
        cookieJar: CookieJar,
    ) {
        idleJob?.cancel()
        idleJob = null
        loadJob?.cancel()
        loadJob = null
        val epoch = ++showEpoch
        if (crashedEditor != open.editor) crashedEditor = null
        val useReveal = if (crashedEditor == open.editor) null else open.reveal
        presenting = false
        bridge.discardExports()
        currentPageId = open.id
        awaitingPageId = open.id
        bridge.activeEditor = open.editor
        bridge.currentTheme = theme
        val view = ensureWebView(context, baseUrl, webBackground)
        view.setBackgroundColor(webBackground)
        if (loadedForIdentity) {
            bridge.pushTheme(theme)
            bridge.pushLanguage(lang)
            bridge.pushAppIcon(appIcon)
            bridge.openPage(open.id, reveal = useReveal, model = model, reasoning = reasoning) { handled ->
                if (epoch != showEpoch || bridge.activeEditor != open.editor) return@openPage
                if (!handled) {
                    // 旧版服务端不支持 openPage 或首次加载尚未挂好：销毁旧 WebView 并递增 generation，
                    // 用全新 WebView 整页加载，避免上一篇笔记留在 WebView 的后退栈里（canGoBack）。
                    destroy()
                    bridge.activeEditor = open.editor
                    currentPageId = open.id
                    awaitingPageId = open.id
                    generation++
                }
            }
        } else {
            loadFresh(epoch, open, lang, theme, useReveal, embedUrl, baseUrl, cookieJar)
        }
    }

    private fun loadFresh(
        epoch: Int,
        open: OpenNote,
        lang: String,
        theme: String,
        reveal: String?,
        embedUrl: (lang: String, theme: String, reveal: String?) -> String,
        baseUrl: String,
        cookieJar: CookieJar,
    ) {
        loadJob?.cancel()
        loadJob = hostScope.launch {
            syncCookies(baseUrl, cookieJar)
            if (epoch != showEpoch || bridge.activeEditor != open.editor) return@launch
            val view = webView ?: return@launch
            loadedForIdentity = true
            view.loadUrl(embedUrl(lang, theme, reveal))
        }
    }

    /** 离开编辑页但保留热缓存：卸载网页编辑器 DOM，开始 120 秒空闲倒计时，到期未重开则销毁。 */
    fun park() {
        loadJob?.cancel()
        loadJob = null
        idleJob?.cancel()
        idleJob = null
        showEpoch++
        presenting = false
        currentPageId = null
        awaitingPageId = null
        bridge.activeEditor = null
        bridge.discardExports()
        excludeEdges = false
        webView?.excludeDrawingEdges(false)
        if (loadedForIdentity && webView != null) {
            bridge.close()
            idleJob = hostScope.launch {
                delay(IDLE_TIMEOUT_MS)
                if (isParked) destroy()
            }
        } else if (webView != null) {
            destroy()
        }
    }

    /** 彻底销毁 WebView 与其缓存（换身份、内存紧张、退到后台、空闲超时、进程崩溃、页面销毁）。 */
    fun destroy() {
        loadJob?.cancel()
        loadJob = null
        idleJob?.cancel()
        idleJob = null
        showEpoch++
        presenting = false
        loadedForIdentity = false
        currentPageId = null
        awaitingPageId = null
        excludeEdges = false
        bridge.activeEditor = null
        val view = webView
        webView = null
        if (view != null) {
            view.excludeDrawingEdges(false)
            bridge.release(view)
            (view.parent as? ViewGroup)?.removeView(view)
            view.stopLoading()
            view.destroy()
        }
    }

    /** 别处（聊天提案）改了笔记：即使 WebView 停在热缓存里也同步更新，下次点开直接显示新版。 */
    fun pageUpdated(pageJson: String) {
        if (loadedForIdentity && webView != null) bridge.pageUpdated(pageJson)
    }

    /** 页面移进回收站：从热缓存里清掉。 */
    fun pageTrashed(ids: Collection<String>) {
        if (loadedForIdentity && webView != null) bridge.pageTrashed(ids)
    }

    companion object {
        private const val IDLE_TIMEOUT_MS = 120_000L
    }
}

// 笔记编辑页：原生顶栏 + 复用的 WebView 里的网页编辑器。
// 顶栏与网页手机版笔记页一致（高 56、左右 10.4）：菜单 40（图标 20）、间距 12、"<"返回列表 40（图标 22）、间距 12、
// 笔记图标（表情 15 / 页面类型图标 15）+ 间距 6 + 标题 14 灰；右侧搜索 40（图标 20）、间距 8、版本历史 40（图标 20）、间距 8、
// 保存状态 14 灰（出错 / 冲突时 #b45309）。白板、幻灯片都能公开（[PageKindFeatures.publicShare]），顶栏都有分享按钮。
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun NoteEditorScreen(
    host: NoteEmbedHost,
    open: OpenNote,
    saveState: String?,
    notice: String?,
    /**
     * [theme] 是 App 现在实际的外观（`light` / `dark`），放进地址让网页第一帧就按它画。
     * [reveal] 是检索命中的块（[OpenNote.reveal]），只在这个编辑器第一次加载时给，渲染进程崩溃后重新加载时是 null。
     */
    embedUrl: (lang: String, theme: String, reveal: String?) -> String,
    model: String?,
    reasoning: String?,
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
    /** 网页导出的文件拼好了（null 是没拼成）：交给保存位置选择器（[rememberExportFileSaver]）。在主线程上调用。 */
    onExportFile: (ExportFile?) -> Unit,
    /** 这个编辑器发来的最后一条 drawing 是 true（白板正在用画图工具）：白板时让开屏幕两侧的系统返回手势。 */
    drawing: Boolean = false,
    onSearch: () -> Unit = {},
    /** 笔记里指向本站聊天的链接（?chat=&message=）：在 App 里打开聊天。 */
    onChatLink: (ChatLink) -> Unit = {},
    /** 列表里这一篇（收藏、显示设置、锁定）；不在列表里时没有"…"菜单。 */
    page: NotePageSummary? = null,
    menu: NotePageMenuActions? = null,
    onShare: (() -> Unit)? = null,
    /** 编辑器上方的提示（上传因存储空间不够被拒绝时的 [StorageLimitPrompt]）。 */
    prompt: (@Composable () -> Unit)? = null,
    /** 幻灯片放映的开始 / 结束（放映中侧栏的滑动打开要关掉）。 */
    onPresentingChange: (Boolean) -> Unit = {},
) {
    val context = LocalContext.current
    val bridge = host.bridge
    val presenting = host.presenting
    val currentEmbedUrl by rememberUpdatedState(embedUrl)
    val currentModel by rememberUpdatedState(model)
    val currentReasoning by rememberUpdatedState(reasoning)

    host.onMessage = onMessage
    host.onDownload = onDownload
    host.onChatLink = onChatLink
    host.onExportFile = onExportFile

    PresentationMode(presenting)
    val currentOnPresentingChange by rememberUpdatedState(onPresentingChange)
    LaunchedEffect(presenting) { currentOnPresentingChange(presenting) }
    DisposableEffect(Unit) { onDispose { currentOnPresentingChange(false) } }

    val appIcon = currentAppIcon()
    LaunchedEffect(bridge, appIcon) { bridge.pushAppIcon(appIcon) }
    // 外观：编辑器和原生界面用同一个结果（设置里选的，跟随系统时看系统）。先写进桥（网页加载时读），变了再推过去；
    // WebView 自己的底色也跟着换，网页画出来之前不闪白（深色是网页的 --notion-bg #191919）。
    val dark = Sm.isDark
    val theme = NoteEmbedBridge.themeValue(dark)
    val webBackground = Sm.Background.toArgb()
    remember(bridge) { bridge.currentTheme = theme }
    LaunchedEffect(bridge, theme) {
        bridge.webView?.setBackgroundColor(webBackground)
        bridge.pushTheme(theme)
    }

    val fileCallback = remember { arrayOfNulls<ValueCallback<Array<Uri>>>(1) }
    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback[0]?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback[0] = null
    }
    host.onShowFileChooser = { callback, params ->
        fileCallback[0]?.onReceiveValue(null)
        fileCallback[0] = callback
        try {
            chooser.launch(params.createIntent())
            true
        } catch (_: ActivityNotFoundException) {
            fileCallback[0] = null
            false
        }
    }
    DisposableEffect(open.editor) {
        onDispose {
            fileCallback[0]?.onReceiveValue(null)
            fileCallback[0] = null
        }
    }

    DisposableEffect(host) {
        registerFlush(bridge)
        onDispose {
            host.onShowFileChooser = null
            registerFlush(null)
            fileCallback[0]?.onReceiveValue(null)
            fileCallback[0] = null
            host.park()
        }
    }

    // 网页里打开的面板（版本历史、图标选择器）会往历史里推一条记录，返回键先交给网页关面板；没有了才离开笔记。
    // 从原生调用打开的面板没有用户手势，浏览器不一定给它留历史记录，所以再看一眼有没有打开的 <dialog>：
    // 有就发 cancel 事件（等同网页里按 Esc，只关最上面一层），没有才保存并离开。
    BackHandler(enabled = !drawerOpen) {
        val view = bridge.webView
        when {
            // 放映中：先结束放映（网页收到后发 presentation end，App 恢复竖屏和顶栏），不离开幻灯片。
            // 网页没有回应（加载失败等）时由这里结束放映，不把人困在横屏全屏里。
            presenting -> bridge.slides("""{"action":"end"}""") { handled -> if (!handled) host.endPresentationLocally() }
            view == null -> onBack()
            view.canGoBack() -> view.goBack()
            else -> view.evaluateJavascript(CLOSE_TOP_DIALOG) { closed -> if (closed != "true") onBack() }
        }
    }

    // 页面类型：列表里有这一篇就用列表的，否则用打开时知道的（检索结果、网页的 ready 消息）。
    val kind = page?.kind ?: open.kind
    // 白板正在用画图工具时（网页的 drawing 消息）让开屏幕两侧的系统返回手势，从边上起笔不会变成"返回"；
    // 用手掌平移时、不是白板时都照常能返回。WebView 尺寸变了（键盘、旋转）就重算，关掉编辑器时清掉。
    val excludeEdges = drawing && kind == PageKind.Whiteboard
    host.excludeEdges = excludeEdges
    Column(Modifier.fillMaxSize().background(if (presenting) Color.Black else Sm.Background)) {
        if (!presenting) Row(
            Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(horizontal = 10.4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TopIconButton(Lucide.Menu, stringResource(R.string.open_menu), onMenu)
            Spacer(Modifier.width(12.dp))
            TopIconButton(Lucide.ChevronLeft, stringResource(R.string.all_notes), onBack, iconSize = 22.dp)
            Spacer(Modifier.width(12.dp))
            Box(Modifier.size(20.dp), Alignment.Center) { NoteIcon(open.icon, 15.sp, 15.dp, Sm.Muted, kind) }
            Spacer(Modifier.width(6.dp))
            Text(
                open.title.ifEmpty { stringResource(R.string.workspace) },
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
            // 只有有公开视图的类型能公开（按服务端的 kinds 表；现在笔记、白板、幻灯片都能公开），网页同样按这张表显示分享按钮。
            if (page != null && onShare != null && kind.features.publicShare) {
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
            if (status.isNotEmpty()) {
                val isError = saveState == "error" || saveState == "conflict"
                val dotColor = when {
                    isError -> Color(0xFFD97706)
                    saveState == "saving" || saveState == "unsaved" -> Sm.Blue
                    else -> Color(0xFF10B981)
                }
                val pillBg = if (isError) Sm.pick(Color(0x1FD97706), Color(0x29F59E0B)) else Sm.Hover
                val pillText = if (isError) Sm.KindSlidesText else Sm.Muted
                Row(
                    Modifier.height(24.dp).clip(CircleShape).background(pillBg).padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(dotColor))
                    Spacer(Modifier.width(5.5.dp))
                    Text(status, color = pillText, fontSize = 12.sp, fontWeight = androidx.compose.ui.text.font.FontWeight(520), maxLines = 1)
                }
            }
            if (page != null && menu != null) {
                Spacer(Modifier.width(8.dp))
                // 幻灯片的"…"菜单多出放映和导出（交给网页做，文件再交回 App 保存）。
                NotePageMenuButton(page, if (kind == PageKind.Slides) menu.withSlides(bridge::slides) else menu)
            }
        }
        if (notice != null && !presenting) {
            ErrorBar(notice, null, Modifier.padding(horizontal = 24.dp, vertical = 8.dp).clickable(onClick = onDismissNotice))
        }
        if (prompt != null && !presenting) Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp)) { prompt() }

        val lang = embedLanguage()
        androidx.compose.runtime.key(host.generation) { AndroidView(
            modifier = Modifier.weight(1f).fillMaxWidth().then(if (presenting) Modifier else Modifier.windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime))),
            factory = { ctx -> host.attachWebView(ctx, baseUrl, webBackground) },
            // 读的是 State：drawing 或页面类型变了就再跑一次。
            update = { view -> view.excludeDrawingEdges(excludeEdges) },
            onRelease = { view ->
                // 不在这里销毁 WebView：由 NoteEmbedHost 保留热缓存，按身份变化 / 内存压力 / 后台 / 空闲超时统一释放。
                view.excludeDrawingEdges(false)
                (view.parent as? ViewGroup)?.removeView(view)
            },
        ) }
        LaunchedEffect(bridge, lang) { bridge.pushLanguage(lang) }
        LaunchedEffect(host, open.editor, host.generation) {
            host.show(
                context = context,
                open = open,
                lang = lang,
                theme = theme,
                webBackground = webBackground,
                appIcon = appIcon,
                model = currentModel,
                reasoning = currentReasoning,
                embedUrl = currentEmbedUrl,
                baseUrl = baseUrl,
                cookieJar = cookieJar,
            )
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/**
 * 幻灯片放映中：横屏（随传感器左右转）、隐藏状态栏和导航栏（从边缘滑动可暂时调出）、屏幕常亮。结束（或离开编辑器）时恢复原样。
 */
@Composable
private fun PresentationMode(active: Boolean) {
    val activity = LocalContext.current.findActivity() ?: return
    DisposableEffect(activity, active) {
        if (!active) return@DisposableEffect onDispose {}
        val window = activity.window
        val previousOrientation = activity.requestedOrientation
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            controller.show(WindowInsetsCompat.Type.systemBars())
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            activity.requestedOrientation = previousOrientation
        }
    }
}

/** 网页侧的 `window.NoteFableNative`。单独一个有具体类型的函数：lint 在 apply 块里看不出 [bridge] 的类型（只看到泛型 T）。 */
private fun WebView.attachBridge(bridge: NoteEmbedBridge) = addJavascriptInterface(bridge, "NoteFableNative")
