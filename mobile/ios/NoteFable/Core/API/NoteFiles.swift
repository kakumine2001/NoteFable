import Foundation

/// 下载好的笔记文件：保存时用的文件名和类型。
struct NoteFileDownload: Equatable, Sendable {
    var name: String
    var mimeType: String
}

/// 笔记里的图片 / 文件块指向本站的 `/api/pages/files?key=…&name=…`（src/lib/note-file-keys.ts）。
/// 服务端只把文件给它的主人（按 Cookie 认人），所以 WebView 里点到这种链接时由 App 自己带 Cookie 下载，不交给系统浏览器。
enum NoteFileLinks {
    private static let PATH = "/api/pages/files"

    /// [target] 是不是本站的笔记文件地址。
    static func isNoteFile(_ target: String, baseUrl: String) -> Bool {
        guard let url = httpUrl(target), let base = httpUrl(baseUrl) else { return false }
        return url.scheme == base.scheme && url.host == base.host && url.port == base.port
            && url.path == PATH && !(queryParameter(url.components, "key") ?? "").isEmpty
    }

    /// 保存用的文件名：先用响应头 Content-Disposition 的 filename*，再用地址里的 name，都没有时叫 file。
    static func fileName(contentDisposition: String?, url: URL) -> String {
        let fromHeader = contentDisposition.flatMap(headerFileName)
        let fromLink = URLComponents(url: url, resolvingAgainstBaseURL: true).flatMap { queryParameter($0, "name") }
        return sanitize(fromHeader) ?? sanitize(fromLink) ?? "file"
    }

    /// 地址里的 name（还没下载、要先决定保存位置时用）。
    static func fileName(url: String) -> String {
        httpUrl(url).flatMap { sanitize(queryParameter($0.components, "name")) } ?? "file"
    }

    // MARK: - 地址

    private struct HttpUrl {
        let scheme: String
        let host: String
        let port: Int
        let path: String
        let components: URLComponents
    }

    /// 只认完整的 http / https 地址（OkHttp 的 toHttpUrlOrNull）。端口没写时按协议的默认值算。
    private static func httpUrl(_ text: String) -> HttpUrl? {
        guard let components = URLComponents(string: text), let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = components.host?.lowercased(), !host.isEmpty else { return nil }
        let path = components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath
        return HttpUrl(
            scheme: scheme, host: host, port: components.port ?? (scheme == "https" ? 443 : 80), path: path,
            components: components
        )
    }

    /// 查询串里第一个叫 [name] 的值，已解码（`+` 当空格，和 OkHttp 的 queryParameter 一样）。
    private static func queryParameter(_ components: URLComponents, _ name: String) -> String? {
        guard let item = components.percentEncodedQueryItems?.first(where: { decodeQuery($0.name) == name }) else { return nil }
        return decodeQuery(item.value ?? "")
    }

    private static func decodeQuery(_ text: String) -> String {
        let spaced = String(text.unicodeScalars.map { $0 == "+" ? " " : Character($0) })
        return spaced.removingPercentEncoding ?? spaced
    }

    // MARK: - 文件名

    /// `filename*=UTF-8''<百分号编码>`（RFC 5987），不分大小写。这里的 `+` 就是加号，不是空格。
    private static func headerFileName(_ header: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: "filename\\*\\s*=\\s*UTF-8''([^;]+)", options: [.caseInsensitive]),
              let match = regex.firstMatch(in: header, options: [], range: NSRange(header.startIndex..., in: header)),
              let range = Range(match.range(at: 1), in: header) else { return nil }
        return header[range].trimmingCharacters(in: .whitespaces).removingPercentEncoding
    }

    // 去掉路径分隔符和控制字符，避免写到保存目录以外的地方。
    private static func sanitize(_ name: String?) -> String? {
        guard let name else { return nil }
        let replaced = String(String.UnicodeScalarView(name.unicodeScalars.map { scalar in
            scalar == "\\" || scalar == "/" || scalar.value <= 0x1f ? "_" : scalar
        }))
        let trimmed = ApiText.trim(replaced)
        let withoutDots = String(trimmed.drop { $0 == "." })
        return withoutDots.isEmpty ? nil : withoutDots
    }
}
