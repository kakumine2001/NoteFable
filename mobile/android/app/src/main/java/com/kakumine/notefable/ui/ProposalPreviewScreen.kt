package com.kakumine.notefable.ui

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.kakumine.notefable.R
import com.kakumine.notefable.data.Proposal
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import kotlin.coroutines.resume

/**
 * 画布提案（白板 / 幻灯片）的改前・改后可视化预览页（`/note-embed?proposal=<id>&lang=…&theme=…`）。
 * 使用独立的轻量 WebView（不干扰常驻笔记编辑器），同步 App Cookie 并限定同源导航。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun ProposalPreviewScreen(
    proposal: Proposal,
    previewUrl: (lang: String, theme: String) -> String,
    baseUrl: String,
    cookieJar: CookieJar,
    onClose: () -> Unit,
) {
    val theme = NoteEmbedBridge.themeValue(Sm.isDark)
    val webBackground = Sm.Background.toArgb()
    val lang = stringResource(R.string.ui_locale)
    val url = remember(proposal.id, lang, theme) { previewUrl(lang, theme) }
    val allowedHost = remember(baseUrl) { runCatching { baseUrl.toHttpUrl().host }.getOrNull() }
    var cookiesReady by remember(proposal.id, baseUrl) { mutableStateOf(false) }
    var loaded by remember(url) { mutableStateOf(false) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    val focus = LocalFocusManager.current
    LaunchedEffect(Unit) { focus.clearFocus() }

    LaunchedEffect(proposal.id, baseUrl, cookieJar) {
        syncPreviewCookies(baseUrl, cookieJar)
        cookiesReady = true
    }

    LaunchedEffect(webViewRef, webBackground) {
        webViewRef?.setBackgroundColor(webBackground)
    }

    DisposableEffect(Unit) {
        onDispose {
            webViewRef?.apply {
                stopLoading()
                destroy()
            }
            webViewRef = null
        }
    }

    BackHandler(onBack = onClose)

    val title = when (proposal) {
        is Proposal.Edit -> stringResource(R.string.proposal_edit_title, proposal.pageTitle)
        is Proposal.Create -> proposal.title
    }

    Column(
        Modifier.fillMaxSize()
            .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } }
            .background(Sm.Background)
            .statusBarsPadding()
            .windowInsetsPadding(WindowInsets.navigationBars),
    ) {
        Row(
            Modifier.fillMaxWidth().height(56.dp)
                .drawBehind {
                    drawLine(Sm.Border, Offset(0f, size.height - 0.5.dp.toPx()), Offset(size.width, size.height - 0.5.dp.toPx()), 1.dp.toPx())
                }
                .padding(horizontal = 10.4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            LucideIcon(pageKindIcon(proposal.pageKind), 16.dp, Sm.Text, strokeWidth = 2f)
            Text(
                title,
                color = Sm.Text,
                fontSize = 15.sp,
                lineHeight = 20.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            TopIconButton(Lucide.X, stringResource(R.string.close), onClose)
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (cookiesReady) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        WebView(ctx).apply {
                            setBackgroundColor(webBackground)
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.allowFileAccess = false
                            settings.allowContentAccess = false
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                    val target = request.url ?: return true
                                    val scheme = target.scheme?.lowercase()
                                    if (scheme != "http" && scheme != "https") return true
                                    if (allowedHost != null && target.host != allowedHost) return true
                                    val path = target.path ?: ""
                                    return !(path == "/note-embed" || path.endsWith("/note-embed"))
                                }

                                override fun onPageFinished(view: WebView, finishedUrl: String) {
                                    loaded = true
                                }

                                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                                    if (request.isForMainFrame) loaded = true
                                }

                                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                                    if (request.isForMainFrame) loaded = true
                                }
                            }
                            webViewRef = this
                            loadUrl(url)
                        }
                    },
                    update = { view ->
                        view.setBackgroundColor(webBackground)
                        if (view.url != url) {
                            loaded = false
                            view.loadUrl(url)
                        }
                    },
                )
            }

            if (!loaded) {
                Box(Modifier.fillMaxSize().background(Sm.Background), contentAlignment = Alignment.Center) {
                    Row(
                        Modifier.semantics { liveRegion = LiveRegionMode.Polite },
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
}

private suspend fun syncPreviewCookies(baseUrl: String, jar: CookieJar) {
    val manager = CookieManager.getInstance()
    manager.setAcceptCookie(true)
    suspendCancellableCoroutine { cont -> manager.removeAllCookies { if (cont.isActive) cont.resume(Unit) } }
    val url = baseUrl.toHttpUrl()
    jar.loadForRequest(url).forEach { manager.setCookie(baseUrl, it.toString()) }
    manager.flush()
}
