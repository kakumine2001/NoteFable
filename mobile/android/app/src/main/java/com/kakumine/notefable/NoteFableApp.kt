package com.kakumine.notefable

import android.app.Application
import android.net.Uri
import java.io.IOException
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.kakumine.notefable.data.AppIconStore
import com.kakumine.notefable.data.PersistentCookieJar
import com.kakumine.notefable.data.ProposalApi
import com.kakumine.notefable.data.ProposalStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import com.kakumine.notefable.data.NoteFableApi
import com.kakumine.notefable.data.SystemText

class NoteFableApp : Application(), SingletonImageLoader.Factory {
    val cookieJar: PersistentCookieJar by lazy { PersistentCookieJar(this) }
    val api: NoteFableApi by lazy {
        NoteFableApi(BuildConfig.BASE_URL, cookieJar, openFile = { uri ->
            contentResolver.openInputStream(Uri.parse(uri)) ?: throw IOException("cannot open $uri")
        })
    }

    /** AI 笔记提案的应用 / 放弃状态（按提案 ID，跨界面重建保留；网页 page-edit-proposal.tsx 的 states）。 */
    val proposals: ProposalStore by lazy { ProposalStore(ProposalApi(api.httpClient, api::absoluteUrl), scope) }

    /** 设置里选的图标（表情 / 图片，只存在这台设备上；网页 localStorage 的 notefable:app-icon）。 */
    val appIcon: AppIconStore by lazy {
        val prefs = getSharedPreferences("app_icon", MODE_PRIVATE)
        AppIconStore(
            read = { prefs.getString("icon", null) },
            write = { icon -> prefs.edit().apply { if (icon != null) putString("icon", icon) else remove("icon") }.commit() },
        )
    }

    /** App 级的协程作用域（主线程）：不该随界面离开而取消的事（提案的应用 / 放弃、图片下载）。 */
    val scope: CoroutineScope = MainScope()

    /** 服务端英文系统文的中 / 日译文（assets/system-text.json）。读不到时显示英文原句。 */
    val systemText: SystemText by lazy {
        runCatching { assets.open("system-text.json").use { SystemText.parse(it.readBytes().decodeToString()) } }
            .getOrDefault(SystemText.Empty)
    }

    // 附件图片要带登录 Cookie 才能读（服务端校验归属），所以让 Coil 复用同一个 OkHttp 客户端。
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { api.httpClient })) }
            .build()
}
