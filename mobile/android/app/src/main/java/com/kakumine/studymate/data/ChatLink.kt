package com.kakumine.studymate.data

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * 指向聊天的链接：`https://<站点>/?chat=<会话>&message=<消息>`（保存到笔记、下载的 Markdown 里写的，见 src/lib/answer-export.ts），
 * 以及服务端转发后的 `/app?chat=…`、`/<语言>/app?chat=…`。规则同网页 `src/app/[locale]/app/page.tsx` 打开链接的部分。
 */
sealed interface ChatLink {
    /** [messageId] 形式不对时当作没有（网页也是只打开会话）。 */
    data class Open(val chatId: String, val messageId: String?) : ChatLink

    /** chat= 的 ID 形式不对：网页显示 "Failed to load conversation."。 */
    data object Invalid : ChatLink

    companion object {
        /** 网页的 LINK_ID：数据库的 ID 只有字母数字（加上 _ 和 -），最长 64。 */
        private val LINK_ID = Regex("^[A-Za-z0-9_-]{1,64}$")
        private val LOCALE_APP = Regex("^/[A-Za-z-]{2,8}/app/?$")

        /** 不是本站（[baseUrl] 同协议、同主机、同端口）的聊天链接时返回 null。 */
        fun parse(url: String, baseUrl: String): ChatLink? {
            val target = url.toHttpUrlOrNull() ?: return null
            val base = baseUrl.toHttpUrlOrNull() ?: return null
            if (target.scheme != base.scheme || target.host != base.host || target.port != base.port) return null
            val path = target.encodedPath
            if (path != "/" && path != "/app" && path != "/app/" && !LOCALE_APP.matches(path)) return null
            val chatId = target.queryParameter("chat")?.takeIf { it.isNotEmpty() } ?: return null
            if (!LINK_ID.matches(chatId)) return Invalid
            val messageId = target.queryParameter("message")?.takeIf { LINK_ID.matches(it) }
            return Open(chatId, messageId)
        }
    }
}
