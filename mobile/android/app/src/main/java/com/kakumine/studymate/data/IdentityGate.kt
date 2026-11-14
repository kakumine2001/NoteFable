package com.kakumine.studymate.data

import okhttp3.Interceptor
import okhttp3.Response
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * 身份确定之前只放一个请求过去。
 *
 * 匿名身份（`studymate_device` Cookie）由第一个到达服务端的请求签发。App 刚启动、或刚登录 / 退出时，
 * 聊天、笔记、账号几个请求同时发出的话，服务端会各签发一个身份，后到的 Cookie 盖掉先到的，前面那个身份下建的东西就读不回来了。
 * 所以在身份"未确定"时，第一个请求单独走，其它请求等它拿到响应头（Set-Cookie 已经存进 Cookie jar）再走；
 * 之后身份确定，请求并行。登录、退出时 [reset]，下一个请求又单独走。
 *
 * 装在 [StudyMateApi] 的 OkHttp 客户端上，聊天、笔记、账号、附件图片、笔记文件下载都经过它。只拦本站的请求。
 */
class IdentityGate(private val host: String) : Interceptor {
    // 排队用的锁会被"单独走"的请求一直拿着；改状态用另一把短锁，reset 不会被慢请求卡住（它在主线程上调用）。
    private val lock = ReentrantLock()
    private val stateLock = Any()

    @Volatile
    private var settled = false

    /** 每次 [reset] 加一。重置前就发出去的那个"单独走"的请求回来时，不能把新身份标成已确定。 */
    private var epoch = 0

    /** 身份变了（登录、退出）：下一个请求重新单独走。 */
    fun reset() = synchronized(stateLock) {
        epoch++
        settled = false
    }

    val isSettled: Boolean get() = settled

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (settled || request.url.host != host) return chain.proceed(request)
        return lock.withLock {
            // 等锁期间前一个请求可能已经把身份定下来了。
            if (settled) return@withLock chain.proceed(request)
            val started = synchronized(stateLock) { epoch }
            val response = chain.proceed(request)
            // 拿到响应（不论状态码）时 Set-Cookie 已经处理完；网络错误时没有 Cookie，身份仍未确定，下一个请求再单独走。
            synchronized(stateLock) { if (epoch == started) settled = true }
            response
        }
    }
}
