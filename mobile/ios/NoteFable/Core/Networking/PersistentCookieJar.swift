import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// 一条 Cookie。字段和匹配规则照 OkHttp 的 `Cookie`（Android 端用的就是它），所以两端对同一个响应存下的东西相同。
struct StoredCookie: Codable, Equatable, Sendable {
    var name: String
    var value: String
    /// 过期时刻（毫秒）。没有 Expires / Max-Age 的会话 Cookie 是 [MAX_DATE]。
    var expiresAt: Int64
    var domain: String
    var path: String
    var secure: Bool
    var httpOnly: Bool
    /// 响应里没写 Domain：只发回签发它的那个主机。
    var hostOnly: Bool
    var sameSite: String?

    /// 9999-12-31：会话 Cookie 的"过期时刻"。它们也照样存盘（见 [PersistentCookieJar]）。
    static let MAX_DATE: Int64 = 253_402_300_799_999

    init(
        name: String,
        value: String,
        expiresAt: Int64 = StoredCookie.MAX_DATE,
        domain: String,
        path: String = "/",
        secure: Bool = false,
        httpOnly: Bool = false,
        hostOnly: Bool = true,
        sameSite: String? = nil
    ) {
        self.name = name
        self.value = value
        self.expiresAt = expiresAt
        self.domain = domain
        self.path = path
        self.secure = secure
        self.httpOnly = httpOnly
        self.hostOnly = hostOnly
        self.sameSite = sameSite
    }

    /// 存储里的键：域名|路径|名称，后到的覆盖先到的。
    var key: String { "\(domain)|\(path)|\(name)" }

    /// 这条 Cookie 该不该随 [url] 的请求发出去。
    func matches(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        let domainMatches = hostOnly ? host == domain : Self.domainMatch(host: host, domain: domain)
        guard domainMatches, Self.pathMatch(urlPath: Self.encodedPath(of: url), path: path) else { return false }
        return !secure || url.scheme?.lowercased() == "https"
    }

    /// 交给 WKWebView 的 Cookie 存储用。会话 Cookie 不带过期时间。
    var httpCookie: HTTPCookie? {
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: name,
            .value: value,
            // 开头有点的域名对子域也有效；没有点的只对这个主机有效。
            .domain: hostOnly ? domain : "." + domain,
            .path: path,
        ]
        if expiresAt < Self.MAX_DATE { properties[.expires] = Date(timeIntervalSince1970: Double(expiresAt) / 1000) }
        // 这个键只要有值就算 Secure，所以不是 Secure 时不能写。
        if secure { properties[.secure] = "TRUE" }
        if httpOnly { properties[HTTPCookiePropertyKey(rawValue: "HttpOnly")] = "TRUE" }
        if let sameSite = sameSite?.lowercased(), sameSite == "lax" || sameSite == "strict" {
            properties[HTTPCookiePropertyKey(rawValue: "SameSite")] = sameSite
        }
        return HTTPCookie(properties: properties)
    }

    // MARK: - 解析 Set-Cookie

    /// 解析一条 Set-Cookie（照 OkHttp `Cookie.parse`，不查公共后缀表）。格式不对或域名不属于这个地址时返回 nil。
    /// [now] 是当前时刻（毫秒）。
    static func parse(_ setCookie: String, url: URL, now: Int64) -> StoredCookie? {
        guard let urlHost = url.host?.lowercased(), !urlHost.isEmpty else { return nil }
        var segments = setCookie.components(separatedBy: ";")
        let pair = segments.removeFirst()
        guard let equals = pair.firstIndex(of: "=") else { return nil }
        let name = trim(String(pair[..<equals]))
        let value = trim(String(pair[pair.index(after: equals)...]))
        guard !name.isEmpty, !hasControlOrNonASCII(name), !hasControlOrNonASCII(value) else { return nil }

        var expiresAt = MAX_DATE
        var maxAge: Int64? = nil
        var domain: String? = nil
        var path: String? = nil
        var secure = false
        var httpOnly = false
        var sameSite: String? = nil

        for segment in segments {
            let attributeName: String
            let attributeValue: String
            if let equals = segment.firstIndex(of: "=") {
                attributeName = trim(String(segment[..<equals])).lowercased()
                attributeValue = trim(String(segment[segment.index(after: equals)...]))
            } else {
                attributeName = trim(segment).lowercased()
                attributeValue = ""
            }
            switch attributeName {
            case "expires":
                if let date = parseExpires(attributeValue) { expiresAt = date }
            case "max-age":
                if let seconds = parseMaxAge(attributeValue) { maxAge = seconds }
            case "domain":
                if !attributeValue.isEmpty, !attributeValue.hasSuffix(".") {
                    let stripped = attributeValue.hasPrefix(".") ? String(attributeValue.dropFirst()) : attributeValue
                    if !stripped.isEmpty { domain = stripped.lowercased() }
                }
            case "path": path = attributeValue
            case "secure": secure = true
            case "httponly": httpOnly = true
            case "samesite": sameSite = attributeValue
            default: break
            }
        }

        // Max-Age 优先于 Expires，不论两者谁写在前面。0 或负数表示马上过期（删除）。
        if let maxAge {
            if maxAge <= 0 {
                expiresAt = Int64.min
            } else {
                let (delta, overflow) = maxAge.multipliedReportingOverflow(by: 1000)
                let (sum, sumOverflow) = now.addingReportingOverflow(overflow ? Int64.max : delta)
                expiresAt = (overflow || sumOverflow || sum > MAX_DATE) ? MAX_DATE : sum
            }
        }

        let hostOnly = domain == nil
        if let domain, !domainMatch(host: urlHost, domain: domain) { return nil }

        // 没写 Path 或不是以 / 开头：用请求地址的目录（/foo/bar/baz → /foo/bar）。
        var resolvedPath = path ?? ""
        if !resolvedPath.hasPrefix("/") {
            let urlPath = encodedPath(of: url)
            if let lastSlash = urlPath.lastIndex(of: "/"), lastSlash != urlPath.startIndex {
                resolvedPath = String(urlPath[..<lastSlash])
            } else {
                resolvedPath = "/"
            }
        }

        return StoredCookie(
            name: name, value: value, expiresAt: expiresAt, domain: domain ?? urlHost, path: resolvedPath,
            secure: secure, httpOnly: httpOnly, hostOnly: hostOnly, sameSite: sameSite
        )
    }

    /// Foundation 把同名的响应头并成一个、用逗号隔开，而 Expires 的日期里本来就有逗号。
    /// 只有后面紧跟着 `名字=`（在下一个分号之前）的逗号才是两条 Cookie 的分界。
    static func splitSetCookieHeader(_ header: String) -> [String] {
        var result: [String] = []
        var current: String? = nil
        for part in header.components(separatedBy: ",") {
            guard let pending = current else {
                current = part
                continue
            }
            if startsCookie(part) {
                result.append(pending)
                current = part
            } else {
                current = pending + "," + part
            }
        }
        if let current { result.append(current) }
        return result.map(trim).filter { !$0.isEmpty }
    }

    private static func startsCookie(_ part: String) -> Bool {
        let head = part.prefix { $0 != ";" }
        guard let equals = head.firstIndex(of: "=") else { return false }
        let name = trim(String(head[..<equals]))
        return !name.isEmpty && !name.unicodeScalars.contains { $0 == " " || $0 == "\t" }
    }

    private static func parseMaxAge(_ text: String) -> Int64? {
        if let value = Int64(text) { return value }
        // 超出 Int64 的整数：负的当作马上过期，正的当作最远。
        let digits = text.hasPrefix("-") ? text.dropFirst() : Substring(text)
        guard !digits.isEmpty, digits.unicodeScalars.allSatisfy({ ("0"..."9").contains($0) }) else { return nil }
        return text.hasPrefix("-") ? Int64.min : Int64.max
    }

    private static let expiresFormats = [
        "EEE, dd MMM yyyy HH:mm:ss zzz",
        "EEE, dd-MMM-yyyy HH:mm:ss zzz",
        "EEEE, dd-MMM-yy HH:mm:ss zzz",
        "EEE MMM d HH:mm:ss yyyy",
    ]

    private static func parseExpires(_ text: String) -> Int64? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        for format in expiresFormats {
            formatter.dateFormat = format
            if let date = formatter.date(from: text) {
                let millis = date.timeIntervalSince1970 * 1000
                return millis >= Double(MAX_DATE) ? MAX_DATE : Int64(millis)
            }
        }
        return nil
    }

    private static func domainMatch(host: String, domain: String) -> Bool {
        if host == domain { return true }
        guard host.hasSuffix("." + domain) else { return false }
        return !looksLikeIPAddress(host)
    }

    private static func pathMatch(urlPath: String, path: String) -> Bool {
        if urlPath == path { return true }
        guard urlPath.hasPrefix(path) else { return false }
        if path.hasSuffix("/") { return true }
        return urlPath.dropFirst(path.count).first == "/"
    }

    private static func encodedPath(of url: URL) -> String {
        let path = URLComponents(url: url, resolvingAgainstBaseURL: true)?.percentEncodedPath ?? url.path
        return path.isEmpty ? "/" : path
    }

    private static func looksLikeIPAddress(_ host: String) -> Bool {
        host.contains(":") || host.unicodeScalars.allSatisfy { $0 == "." || ("0"..."9").contains($0) }
    }

    private static func hasControlOrNonASCII(_ text: String) -> Bool {
        text.unicodeScalars.contains { $0.value <= 0x1f || $0.value >= 0x7f }
    }

    private static func trim(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespaces)
    }
}

/// App 的 Cookie 存储（对应 OkHttp 的 CookieJar）。身份就在这里：`notefable_device` 和 Auth.js 的会话 Cookie。
/// 正式实现是 [PersistentCookieJar]，测试用 [MemoryCookieStore]。
protocol CookieStore: AnyObject, Sendable {
    /// 存下一个响应下发的 Cookie；已经过期的等于删除。
    func saveFromResponse(_ url: URL, _ cookies: [StoredCookie])

    /// 该随这个地址的请求发出去的 Cookie（顺带清掉过期的）。
    func loadForRequest(_ url: URL) -> [StoredCookie]

    /// 删除符合条件的 Cookie（退出登录时去掉 Auth.js 的会话 Cookie）。
    func removeWhere(_ predicate: (StoredCookie) -> Bool)

    func clear()
}

extension CookieStore {
    /// 这个地址的 Cookie，Foundation 的形式：打开笔记编辑器前拷进 WKWebView 的 Cookie 存储，网页和 API 就是同一个身份。
    func cookies(for url: URL) -> [HTTPCookie] {
        loadForRequest(url).compactMap(\.httpCookie)
    }

    /// 请求头 `Cookie` 的值；没有 Cookie 时返回 nil。
    func cookieHeader(for url: URL) -> String? {
        let cookies = loadForRequest(url)
        return cookies.isEmpty ? nil : cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    /// 存下响应里的 Set-Cookie。[url] 是这次请求的地址。
    func saveFromResponse(_ response: HTTPURLResponse, for url: URL) {
        guard let header = response.header("Set-Cookie") else { return }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let cookies = StoredCookie.splitSetCookieHeader(header).compactMap { StoredCookie.parse($0, url: url, now: now) }
        if !cookies.isEmpty { saveFromResponse(url, cookies) }
    }
}

/// 两种存储共用的那张表：按 域名|路径|名称 存，保持先来后到的顺序。
private struct CookieTable {
    private(set) var cookies: [StoredCookie] = []

    init(_ cookies: [StoredCookie] = []) {
        for cookie in cookies { _ = put(cookie, now: Int64.min) }
    }

    /// 返回表有没有变。
    mutating func put(_ cookie: StoredCookie, now: Int64) -> Bool {
        let index = cookies.firstIndex { $0.key == cookie.key }
        if cookie.expiresAt <= now {
            guard let index else { return false }
            cookies.remove(at: index)
            return true
        }
        if let index {
            guard cookies[index] != cookie else { return false }
            cookies[index] = cookie
        } else {
            cookies.append(cookie)
        }
        return true
    }

    mutating func removeExpired(now: Int64) -> Bool {
        remove { $0.expiresAt <= now }
    }

    mutating func remove(where predicate: (StoredCookie) -> Bool) -> Bool {
        let before = cookies.count
        cookies.removeAll(where: predicate)
        return cookies.count != before
    }

    mutating func removeAll() {
        cookies.removeAll()
    }
}

private func currentMillis() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
}

/// 把服务端下发的 Cookie 存在一个文件里（对应 Android 的 PersistentCookieJar，那边存在 SharedPreferences）。
///
/// 匿名身份就是 `notefable_device` Cookie，删除 App（或这个文件）等于换一个新用户，与网页端的语义一致。
/// Google / 邮箱登录后的会话 Cookie 也走这里。和 Android 一样，没有过期时间的会话 Cookie 也存盘，重开 App 还在。
/// 文件地址由 App 给（Application Support 下）；每次有变化就整个重写，内容只有几条。
final class PersistentCookieJar: CookieStore, @unchecked Sendable {
    private let fileURL: URL
    private let lock = NSLock()
    private var table: CookieTable

    init(fileURL: URL) {
        self.fileURL = fileURL
        let stored = (try? Data(contentsOf: fileURL)).flatMap { try? JSONDecoder().decode([StoredCookie].self, from: $0) }
        table = CookieTable(stored ?? [])
    }

    func saveFromResponse(_ url: URL, _ cookies: [StoredCookie]) {
        lock.withLock {
            let now = currentMillis()
            var changed = false
            for cookie in cookies where table.put(cookie, now: now) { changed = true }
            if changed { persist() }
        }
    }

    func loadForRequest(_ url: URL) -> [StoredCookie] {
        lock.withLock {
            if table.removeExpired(now: currentMillis()) { persist() }
            return table.cookies.filter { $0.matches(url) }
        }
    }

    func removeWhere(_ predicate: (StoredCookie) -> Bool) {
        lock.withLock {
            if table.remove(where: predicate) { persist() }
        }
    }

    func clear() {
        lock.withLock {
            table.removeAll()
            persist()
        }
    }

    // 写不进去就算了（下次有变化再写）：内存里的那份照常用，和 SharedPreferences.apply() 一样不报错。
    private func persist() {
        guard let data = try? JSONEncoder().encode(table.cookies) else { return }
        try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: fileURL, options: .atomic)
        #if canImport(Darwin)
        // 身份 Cookie 不进 iCloud / 电脑上的备份（Android 是 allowBackup="false"）：备份被别人拿到、或恢复到另一台手机时不带着登录会话。
        // 原子写入会换成一个新文件，这个标记要每次写完重新加。
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var url = fileURL
        try? url.setResourceValues(values)
        #endif
    }
}

/// 只存在内存里的 Cookie 存储：单元测试用。
final class MemoryCookieStore: CookieStore, @unchecked Sendable {
    private let lock = NSLock()
    private var table = CookieTable()

    init() {}

    func saveFromResponse(_ url: URL, _ cookies: [StoredCookie]) {
        lock.withLock {
            let now = currentMillis()
            for cookie in cookies { _ = table.put(cookie, now: now) }
        }
    }

    func loadForRequest(_ url: URL) -> [StoredCookie] {
        lock.withLock {
            _ = table.removeExpired(now: currentMillis())
            return table.cookies.filter { $0.matches(url) }
        }
    }

    func removeWhere(_ predicate: (StoredCookie) -> Bool) {
        lock.withLock { _ = table.remove(where: predicate) }
    }

    func clear() {
        lock.withLock { table.removeAll() }
    }
}
