package com.kakumine.notefable

import android.app.Application
import android.net.Uri
import java.io.IOException
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.kakumine.notefable.data.PersistentCookieJar
import com.kakumine.notefable.data.ProposalApi
import com.kakumine.notefable.data.ProposalStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import com.kakumine.notefable.data.NoteFableApi
import com.kakumine.notefable.data.SystemText

class NoteFableApp : Application(), SingletonImageLoader.Factory {
    val cookieJar: PersistentCookieJar by lazy {
        PersistentCookieJar(this).also { jar ->
            // 旧版连的是 studymate-lab-ai.vercel.app，Cookie 存在那个主机名下：搬到现在的服务器地址，身份不变。
            val host = Uri.parse(BuildConfig.BASE_URL).host
            if (host != null) LEGACY_HOSTS.forEach { jar.moveHost(it, host) }
        }
    }
    val api: NoteFableApi by lazy {
        NoteFableApi(BuildConfig.BASE_URL, cookieJar, openFile = { uri ->
            contentResolver.openInputStream(Uri.parse(uri)) ?: throw IOException("cannot open $uri")
        })
    }

    /** AI 笔记提案的应用 / 放弃状态（按提案 ID，跨界面重建保留；网页 page-edit-proposal.tsx 的 states）。 */
    val proposals: ProposalStore by lazy { ProposalStore(ProposalApi(api.httpClient, api::absoluteUrl), scope) }

    /** App 级的协程作用域（主线程）：不该随界面离开而取消的事（提案的应用 / 放弃、图片下载）。 */
    val scope: CoroutineScope = MainScope()

    /** 服务端英文系统文的中 / 日译文（assets/system-text.json）。读不到时显示英文原句。 */
    val systemText: SystemText by lazy {
        runCatching { assets.open("system-text.json").use { SystemText.parse(it.readBytes().decodeToString()) } }
            .getOrDefault(SystemText.Empty)
    }

    companion object {
        /** 以前的服务器地址。只在正式域名下搬（本机联调的 localhost 不动）。 */
        private val LEGACY_HOSTS = listOf("studymate-lab-ai.vercel.app")
    }

    // 附件图片要带登录 Cookie 才能读（服务端校验归属），所以让 Coil 复用同一个 OkHttp 客户端。
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { api.httpClient })) }
            .build()
}
