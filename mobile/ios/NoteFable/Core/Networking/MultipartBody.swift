import Foundation

/// `multipart/form-data` 的请求体（对应 OkHttp 的 MultipartBody）。`/api/chat`、`/api/images`、`/api/account/avatar`
/// 在服务端用 `request.formData()` 读，字段名与网页的 FormData 相同。
struct MultipartBody: Sendable {
    let boundary: String
    private var parts: [Part] = []

    private struct Part: Sendable {
        let name: String
        let filename: String?
        let contentType: String?
        let data: Data
    }

    init(boundary: String = "nf-" + UUID().uuidString) {
        self.boundary = boundary
    }

    /// 请求头 Content-Type 的值。
    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    /// 一个文字字段。
    mutating func addFormDataPart(_ name: String, _ value: String) {
        parts.append(Part(name: name, filename: nil, contentType: nil, data: Data(value.utf8)))
    }

    /// 一个文件字段。
    mutating func addFormDataPart(_ name: String, filename: String, contentType: String, data: Data) {
        parts.append(Part(name: name, filename: filename, contentType: contentType, data: data))
    }

    func encoded() -> Data {
        var out = Data()
        for part in parts {
            var header = "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(Self.quoted(part.name))\""
            if let filename = part.filename { header += "; filename=\"\(Self.quoted(filename))\"" }
            header += "\r\n"
            if let contentType = part.contentType { header += "Content-Type: \(contentType)\r\n" }
            header += "\r\n"
            out.append(Data(header.utf8))
            out.append(part.data)
            out.append(Data("\r\n".utf8))
        }
        out.append(Data("--\(boundary)--\r\n".utf8))
        return out
    }

    // 和浏览器、OkHttp 一样：名字里的换行和引号写成 %0A / %0D / %22。
    // 按 Unicode 标量逐个看：Swift 把 "\r\n" 当成一个字符，按字符替换会漏掉。
    private static func quoted(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\n": out.append(contentsOf: "%0A".unicodeScalars)
            case "\r": out.append(contentsOf: "%0D".unicodeScalars)
            case "\"": out.append(contentsOf: "%22".unicodeScalars)
            default: out.append(scalar)
            }
        }
        return String(out)
    }
}
