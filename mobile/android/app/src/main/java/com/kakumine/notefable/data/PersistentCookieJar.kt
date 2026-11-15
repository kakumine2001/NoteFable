package com.kakumine.notefable.data

import android.content.Context
import android.content.SharedPreferences
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * 把服务端下发的 Cookie 存在 SharedPreferences。
 *
 * 匿名身份就是 `notefable_device` Cookie，清除应用数据等于换一个新用户，
 * 与网页端的语义一致。Google / 邮箱登录后的会话 Cookie 也走这里。
 */
class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("cookies", Context.MODE_PRIVATE)
    private val lock = Any()

    // key = 域名|路径|名称，后到的覆盖先到的。
    private val cookies: MutableMap<String, Cookie> = synchronized(lock) {
        buildMap {
            for ((key, value) in prefs.all) {
                val raw = value as? String ?: continue
                decode(raw)?.let { put(key, it) }
            }
        }.toMutableMap()
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        synchronized(lock) {
            val editor = prefs.edit()
            for (cookie in cookies) {
                val key = keyOf(cookie)
                if (cookie.expiresAt <= System.currentTimeMillis()) {
                    this.cookies.remove(key)
                    editor.remove(key)
                } else {
                    this.cookies[key] = cookie
                    editor.putString(key, encode(cookie))
                }
            }
            editor.apply()
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(lock) {
        val now = System.currentTimeMillis()
        val expired = cookies.filterValues { it.expiresAt <= now }.keys
        if (expired.isNotEmpty()) {
            expired.forEach { cookies.remove(it) }
            prefs.edit().apply { expired.forEach { remove(it) } }.apply()
        }
        cookies.values.filter { it.matches(url) }
    }

    /** 删除符合条件的 Cookie（退出登录时去掉 Auth.js 的会话 Cookie）。 */
    fun removeWhere(predicate: (Cookie) -> Boolean) = synchronized(lock) {
        val keys = cookies.filterValues(predicate).keys.toList()
        if (keys.isEmpty()) return@synchronized
        keys.forEach { cookies.remove(it) }
        prefs.edit().apply { keys.forEach { remove(it) } }.apply()
    }

    fun clear() = synchronized(lock) {
        cookies.clear()
        prefs.edit().clear().apply()
    }

    private fun keyOf(cookie: Cookie) = "${cookie.domain}|${cookie.path}|${cookie.name}"

    // 一行一个字段，值里不会出现换行（Cookie 值不允许）。
    private fun encode(c: Cookie): String = listOf(
        c.name, c.value, c.expiresAt.toString(), c.domain, c.path,
        c.secure.toString(), c.httpOnly.toString(), c.hostOnly.toString(), c.sameSite ?: "",
    ).joinToString("\n")

    private fun decode(raw: String): Cookie? {
        val f = raw.split("\n")
        if (f.size < 8) return null
        return runCatching {
            Cookie.Builder().name(f[0]).value(f[1]).expiresAt(f[2].toLong()).apply {
                if (f[7].toBoolean()) hostOnlyDomain(f[3]) else domain(f[3])
                path(f[4])
                if (f[5].toBoolean()) secure()
                if (f[6].toBoolean()) httpOnly()
                f.getOrNull(8)?.takeIf { it.isNotEmpty() }?.let { sameSite(it) }
            }.build()
        }.getOrNull()
    }
}
