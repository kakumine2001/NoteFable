import Foundation

/// http(s) 地址的小解析器，代替 Android 用的 OkHttp `toHttpUrlOrNull`（网页是 `new URL()`）：
/// 只收 http / https，主机名小写，路径以 `/` 开头并去掉 `.`、`..`，按段解码路径、读查询参数。
/// 不用 Foundation 的 URL / URLComponents：它们在 Apple 平台和 Linux 上对写得不规范的地址处理不同，
/// 而这里的结果决定"这是不是本站的聊天链接""这个来源能不能做成链接"，两边必须一样（测试只能在 Linux 上跑）。
struct HttpUrl: Equatable, Sendable {
    /// `http` 或 `https`。
    let scheme: String
    /// 小写的主机名；IPv6 地址不带方括号。
    let host: String
    /// 没写端口时是协议的默认端口。
    let port: Int
    /// 以 `/` 开头、仍是百分号编码的路径。
    let encodedPath: String
    let encodedQuery: String?
    let encodedFragment: String?
    private let encodedUserInfo: String?

    static func defaultPort(_ scheme: String) -> Int { scheme == "https" ? 443 : 80 }

    static func parse(_ raw: String) -> HttpUrl? {
        var s = Array(raw.unicodeScalars)
        // 首尾的空白和控制字符不算（OkHttp、WHATWG 都这样）。
        while let last = s.last, last.value <= 0x20 { s.removeLast() }
        var start = 0
        while start < s.count, s[start].value <= 0x20 { start += 1 }
        var i = start

        // 协议
        guard let colon = s[i...].firstIndex(of: ":"), colon > i else { return nil }
        var scheme = ""
        for scalar in s[i..<colon] {
            guard scalar.isASCII, ChatText.isASCIIAlphanumeric(scalar) || scalar == "+" || scalar == "-" || scalar == "." else { return nil }
            scheme.unicodeScalars.append(scalar)
        }
        scheme = scheme.lowercased()
        guard scheme == "http" || scheme == "https" else { return nil }
        i = colon + 1
        while i < s.count, s[i] == "/" || s[i] == "\\" { i += 1 }

        // 主机部分：到第一个 / \ ? # 为止
        var authorityEnd = i
        while authorityEnd < s.count, !"/\\?#".unicodeScalars.contains(s[authorityEnd]) { authorityEnd += 1 }
        var hostStart = i
        var userInfo: String?
        if let at = s[i..<authorityEnd].lastIndex(of: "@") {
            userInfo = encode(s[i..<at], keep: { $0 != "/" && $0 != "?" && $0 != "#" && $0 != "@" })
            hostStart = at + 1
        }
        var hostEnd = authorityEnd
        var port = defaultPort(scheme)
        if hostStart < authorityEnd, s[hostStart] == "[" {
            // IPv6：[::1]:8080
            guard let close = s[hostStart..<authorityEnd].firstIndex(of: "]") else { return nil }
            hostEnd = close + 1
            if hostEnd < authorityEnd {
                guard s[hostEnd] == ":", let parsed = parsePort(s[(hostEnd + 1)..<authorityEnd], scheme) else { return nil }
                port = parsed
            }
        } else if let portColon = s[hostStart..<authorityEnd].firstIndex(of: ":") {
            guard let parsed = parsePort(s[(portColon + 1)..<authorityEnd], scheme) else { return nil }
            port = parsed
            hostEnd = portColon
        }
        guard let host = canonicalHost(s[hostStart..<hostEnd]) else { return nil }

        // 路径、查询、片段
        var pathEnd = authorityEnd
        while pathEnd < s.count, s[pathEnd] != "?", s[pathEnd] != "#" { pathEnd += 1 }
        let path = canonicalPath(s[authorityEnd..<pathEnd])
        var query: String?
        var fragment: String?
        var rest = pathEnd
        if rest < s.count, s[rest] == "?" {
            var queryEnd = rest + 1
            while queryEnd < s.count, s[queryEnd] != "#" { queryEnd += 1 }
            query = encode(s[(rest + 1)..<queryEnd], keep: { !"\"#<>'".unicodeScalars.contains($0) })
            rest = queryEnd
        }
        if rest < s.count, s[rest] == "#" {
            fragment = encode(s[(rest + 1)...], keep: { !"\"<>`".unicodeScalars.contains($0) })
        }
        return HttpUrl(
            scheme: scheme, host: host, port: port, encodedPath: path, encodedQuery: query,
            encodedFragment: fragment, encodedUserInfo: userInfo
        )
    }

    /// 规范化后的完整地址（OkHttp 的 `toString()`、网页的 `url.href`）。
    var absoluteString: String {
        var out = scheme + "://"
        if let encodedUserInfo, !encodedUserInfo.isEmpty { out += encodedUserInfo + "@" }
        out += host.contains(":") ? "[\(host)]" : host
        if port != HttpUrl.defaultPort(scheme) { out += ":\(port)" }
        out += encodedPath
        if let encodedQuery { out += "?" + encodedQuery }
        if let encodedFragment { out += "#" + encodedFragment }
        return out
    }

    /// 解码后的路径各段（OkHttp 的 `pathSegments`）：`/` 是 `[""]`，`/a/b/` 是 `["a", "b", ""]`。
    var pathSegments: [String] {
        ChatText.percentDecodeSegments(encodedPath)
    }

    /// 第一个同名查询参数的值（已解码）；没有这个参数、或者它没有 `=` 时是 nil。
    func queryParameter(_ name: String) -> String? {
        guard let encodedQuery else { return nil }
        for part in encodedQuery.unicodeScalars.split(separator: "&", omittingEmptySubsequences: false) {
            let pieces = part.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard let first = pieces.first else { continue }
            if ChatText.percentDecode(String(first), plusIsSpace: true) != name { continue }
            return pieces.count > 1 ? ChatText.percentDecode(String(pieces[1]), plusIsSpace: true) : nil
        }
        return nil
    }

    // ---- 内部 ----

    private static func parsePort(_ digits: ArraySlice<Unicode.Scalar>, _ scheme: String) -> Int? {
        // 写了冒号没写端口（https://example.com:/）：按默认端口（WHATWG）。
        if digits.isEmpty { return defaultPort(scheme) }
        guard digits.count <= 5, digits.allSatisfy(ChatText.isASCIIDigit) else { return nil }
        var value = 0
        for digit in digits { value = value * 10 + Int(digit.value - 48) }
        return value <= 65_535 ? value : nil
    }

    private static func canonicalHost(_ raw: ArraySlice<Unicode.Scalar>) -> String? {
        var text = String(String.UnicodeScalarView(raw))
        if text.hasPrefix("[") {
            guard text.hasSuffix("]") else { return nil }
            let inner = text.dropFirst().dropLast().lowercased()
            guard !inner.isEmpty, inner.unicodeScalars.allSatisfy({ ChatText.hexValue(UInt8(truncatingIfNeeded: $0.value)) != nil && $0.isASCII || $0 == ":" || $0 == "." }) else {
                return nil
            }
            return inner
        }
        text = ChatText.percentDecode(text).lowercased()
        guard !text.isEmpty else { return nil }
        // 主机名里不能有的字符（OkHttp 的 containsInvalidHostnameAsciiCodes + WHATWG 的 forbidden host code point）。
        for scalar in text.unicodeScalars {
            if scalar.value <= 0x20 || scalar.value == 0x7F { return nil }
            if " #%/:<>?@[\\]^|".unicodeScalars.contains(scalar) { return nil }
        }
        return text
    }

    /// `\` 当成 `/`，去掉 `.` 和 `..`，不能直接出现在地址里的字符写成 `%XX`。空路径是 `/`。
    private static func canonicalPath(_ raw: ArraySlice<Unicode.Scalar>) -> String {
        var segments: [ArraySlice<Unicode.Scalar>] = []
        let parts = raw.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "\\" })
        // 第一段是开头的 / 前面的空串。
        let body = parts.dropFirst()
        for (offset, part) in body.enumerated() {
            let isLast = offset == body.count - 1
            let lowered = String(String.UnicodeScalarView(part)).lowercased()
            if lowered == "." || lowered == "%2e" {
                if isLast { segments.append([]) }
                continue
            }
            if lowered == ".." || lowered == ".%2e" || lowered == "%2e." || lowered == "%2e%2e" {
                if !segments.isEmpty { segments.removeLast() }
                if isLast { segments.append([]) }
                continue
            }
            segments.append(part)
        }
        if segments.isEmpty { return "/" }
        return segments.map { "/" + encode($0, keep: { !"\"#<>?`{}".unicodeScalars.contains($0) }) }.joined()
    }

    /// 控制字符、空格、非 ASCII 和 `keep` 不收的字符写成 `%XX`；已有的 `%` 不动。
    private static func encode(_ raw: ArraySlice<Unicode.Scalar>, keep: (Unicode.Scalar) -> Bool) -> String {
        var out = ""
        for scalar in raw {
            if scalar.value > 0x20, scalar.value < 0x7F, keep(scalar) {
                out.unicodeScalars.append(scalar)
            } else {
                ChatText.percentEncode(scalar, into: &out)
            }
        }
        return out
    }
}

extension ChatText {
    /// 路径按 `/` 分段再解码（开头的 `/` 不算一段）。
    static func percentDecodeSegments(_ encodedPath: String) -> [String] {
        let scalars = encodedPath.unicodeScalars.dropFirst()
        return scalars.split(separator: "/", omittingEmptySubsequences: false).map { percentDecode(String($0)) }
    }
}
