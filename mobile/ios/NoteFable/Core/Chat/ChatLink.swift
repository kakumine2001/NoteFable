import Foundation

/// 指向聊天的链接：`https://<站点>/c/<会话>?message=<消息>`（保存到笔记、下载的 Markdown 里写的，见 src/lib/answer-export.ts），
/// 以前的 `https://<站点>/?chat=<会话>&message=<消息>`，
/// 以及服务端转发后的 `/app?chat=…`、`/<语言>/app?chat=…`。规则同网页 `src/app/[locale]/app/page.tsx` 打开链接的部分，
/// 对应 Android `data/ChatLink.kt`。
enum ChatLink: Equatable, Sendable {
    /// `messageId` 形式不对时当作没有（网页也是只打开会话）。
    case open(chatId: String, messageId: String?)

    /// chat= 的 ID 形式不对：网页显示 "Failed to load conversation."。
    case invalid

    /// 线上的主机名：工作区 app.notefable.com，以及旧链接的 notefable.com 和 www（都转到工作区），链接互相认。
    private static let siteHosts: Set<String> = ["app.notefable.com", "notefable.com", "www.notefable.com"]

    /// 网页的 LINK_ID（`^[A-Za-z0-9_-]{1,64}$`）：数据库的 ID 只有字母数字（加上 _ 和 -），最长 64。
    static func isLinkId(_ value: String) -> Bool {
        let scalars = value.unicodeScalars
        guard (1...64).contains(scalars.count) else { return false }
        return scalars.allSatisfy { ChatText.isASCIIAlphanumeric($0) || $0 == "_" || $0 == "-" }
    }

    /// `^/[A-Za-z-]{2,8}/app/?$`：带语言前缀的工作区地址。
    private static func isLocaleApp(_ path: String) -> Bool {
        var parts = path.unicodeScalars.split(separator: "/", omittingEmptySubsequences: false).map { String($0) }
        // "/ja/app" → ["", "ja", "app"]；末尾可以多一个 "/"。
        if parts.count == 4, parts[3].isEmpty { parts.removeLast() }
        guard parts.count == 3, parts[0].isEmpty, parts[2] == "app" else { return false }
        let locale = parts[1].unicodeScalars
        return (2...8).contains(locale.count) && locale.allSatisfy { ChatText.isASCIILetter($0) || $0 == "-" }
    }

    private static func sameSite(_ target: HttpUrl, _ base: HttpUrl) -> Bool {
        target.scheme == base.scheme && target.port == base.port &&
            (target.host == base.host || (siteHosts.contains(target.host) && siteHosts.contains(base.host)))
    }

    /// 不是本站（`baseUrl` 同协议、同主机、同端口；app.notefable.com、notefable.com 和 www 算同一个站）的聊天链接时返回 nil。
    static func parse(_ url: String, baseUrl: String) -> ChatLink? {
        guard let target = HttpUrl.parse(url), let base = HttpUrl.parse(baseUrl), sameSite(target, base) else { return nil }
        let path = target.encodedPath
        let segments = target.pathSegments
        // 分享链接 /c/<会话>?message=…（网页 answerConversationUrl 现在生成的形式）。
        var shared: String?
        if (2...3).contains(segments.count), segments[0] == "c", segments.count < 3 || segments[2].isEmpty {
            shared = segments[1]
        }
        if shared == nil, path != "/", path != "/app", path != "/app/", !isLocaleApp(path) { return nil }
        guard let chatId = shared ?? target.queryParameter("chat"), !chatId.isEmpty else { return nil }
        if !isLinkId(chatId) { return .invalid }
        let messageId = target.queryParameter("message").flatMap { isLinkId($0) ? $0 : nil }
        return .open(chatId: chatId, messageId: messageId)
    }
}
