package com.kakumine.studymate

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.kakumine.studymate.data.PersistentCookieJar
import com.kakumine.studymate.data.StudyMateApi

class StudyMateApp : Application(), SingletonImageLoader.Factory {
    val cookieJar: PersistentCookieJar by lazy { PersistentCookieJar(this) }
    val api: StudyMateApi by lazy { StudyMateApi(BuildConfig.BASE_URL, cookieJar) }

    // 附件图片要带登录 Cookie 才能读（服务端校验归属），所以让 Coil 复用同一个 OkHttp 客户端。
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { api.httpClient })) }
            .build()
}
