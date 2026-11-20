package com.kakumine.notefable.data

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * 指向聊天的链接：`https://<站点>/c/<会话>?message=<消息>`（保存到笔记、下载的 Markdown 里写的，见 src/lib/answer-export.ts），
 * 以前的 `https://<站点>/?chat=<会话>&message=<消息>`，
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

        /** 线上的主机名：工作区 app.notefable.com，以及旧链接的 notefable.com 和 www（都转到工作区），链接互相认。 */
        private val SITE_HOSTS = setOf("app.notefable.com", "notefable.com", "www.notefable.com")

        private fun sameSite(target: okhttp3.HttpUrl, base: okhttp3.HttpUrl) =
            target.scheme == base.scheme && target.port == base.port &&
                (target.host == base.host || (target.host in SITE_HOSTS && base.host in SITE_HOSTS))

        /** 不是本站（[baseUrl] 同协议、同主机、同端口；app.notefable.com、notefable.com 和 www 算同一个站）的聊天链接时返回 null。 */
        fun parse(url: String, baseUrl: String): ChatLink? {
            val target = url.toHttpUrlOrNull() ?: return null
            val base = baseUrl.toHttpUrlOrNull() ?: return null
            if (!sameSite(target, base)) return null
            val path = target.encodedPath
            val segments = target.pathSegments
            // 分享链接 /c/<会话>?message=…（网页 answerConversationUrl 现在生成的形式）。
            val shared = if (segments.size in 2..3 && segments[0] == "c" && segments.getOrNull(2).isNullOrEmpty()) segments[1] else null
            if (shared == null && path != "/" && path != "/app" && path != "/app/" && !LOCALE_APP.matches(path)) return null
            val chatId = (shared ?: target.queryParameter("chat"))?.takeIf { it.isNotEmpty() } ?: return null
            if (!LINK_ID.matches(chatId)) return Invalid
            val messageId = target.queryParameter("message")?.takeIf { LINK_ID.matches(it) }
            return Open(chatId, messageId)
        }
    }
}
