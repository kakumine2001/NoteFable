import Foundation

// 与网页相同的限制和判定顺序（src/lib/upload-limits.ts、src/lib/client-files.ts）。
// 服务端会再校验一次，这里只是为了在上传前就把原因告诉用户。
let MAX_UPLOAD_FILES = 10
let MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024
let MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024

private let IMAGE_TYPES: Set<String> = ["image/jpeg", "image/png", "image/webp"]
private let SUPPORTED_EXTENSIONS: Set<String> = ["md", "markdown", "json", "csv", "tsv", "txt", "pdf"]

/// 系统文件选择器的可选类型，对应网页 `ATTACHMENT_ACCEPT`（界面层换成 UTType）。
let ATTACHMENT_PICKER_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/*", "application/json"]

/// 选好、还没发送的附件。[uri] 是这个文件在本机的标识（Android 是 content:// 地址）：
/// 上传时交给 NoteFableApi 的 openFile 换成文件地址或字节，Core 不解释它。
struct LocalFile: Equatable, Hashable, Sendable {
    var uri: String
    var name: String
    var mimeType: String
    var size: Int

    init(uri: String, name: String, mimeType: String, size: Int) {
        self.uri = uri
        self.name = name
        self.mimeType = mimeType
        self.size = size
    }

    var isImage: Bool { IMAGE_TYPES.contains(mimeType.lowercased()) }
}

/// 附件不能用的原因。文字在界面层按语言生成，和网页字典逐条对应。
indirect enum AttachError: Equatable, Sendable {
    case tooMany(max: Int, extra: Int)
    case empty(name: String)
    case nameTooLong
    case unsupported(name: String)
    case modelCannotReadImages
    case fileTooLarge(name: String, limitBytes: Int)
    case totalTooLarge(limitBytes: Int)
    case slotsFull(max: Int)
    case roomForFewer(remaining: Int, max: Int, count: Int)

    /// 新选的这一批整批没有加进去（网页："{error} No new files were added."）。
    case notAdded(cause: AttachError)
}

/// 网页的 formatUploadSize：不足 0.1 MiB 用 KiB，其余保留一位小数并去掉多余的 ".0"。
func formatUploadSize(_ bytes: Int) -> String {
    let mib = 1024.0 * 1024.0
    if bytes > 0 && Double(bytes) < 0.1 * mib {
        return "\(max(1, Int((Double(bytes) / 1024.0).rounded(.up)))) KiB"
    }
    // Kotlin 的 roundToLong：四舍五入，正好一半时向上。
    let tenths = Int((Double(bytes) / mib * 10 + 0.5).rounded(.down))
    return tenths % 10 == 0 ? "\(tenths / 10) MiB" : "\(tenths / 10).\(tenths % 10) MiB"
}

/// 网页 usage-plans.ts 的 formatStorageSize：1024 进制，单位 KB / MB / GB（不翻译）；10 以下保留一位小数，向下取整
/// （用量不会显示得比实际多）。数字的写法（小数点）按界面语言。
func formatStorageSize(_ bytes: Int, locale: Locale = Locale(identifier: "en")) -> String {
    let mib = 1024.0 * 1024.0
    let value = Double(max(0, bytes))
    let amount: Double
    let unit: String
    if value >= 1024 * mib {
        amount = value / (1024 * mib); unit = "GB"
    } else if value >= mib {
        amount = value / mib; unit = "MB"
    } else {
        amount = value / 1024; unit = "KB"
    }
    let digits = unit != "KB" && amount < 10 ? 1 : 0
    let scale = digits == 1 ? 10.0 : 1.0
    let shown = (amount * scale).rounded(.down) / scale
    let formatter = NumberFormatter()
    formatter.locale = locale
    formatter.numberStyle = .decimal
    formatter.minimumFractionDigits = 0
    formatter.maximumFractionDigits = digits
    let number = formatter.string(from: NSNumber(value: shown)) ?? String(shown)
    return "\(number) \(unit)"
}

// 网页的 SUPPORTED_EXTENSION：/\.(md|markdown|json|csv|tsv|txt|pdf)$/i
private func hasSupportedExtension(_ name: String) -> Bool {
    guard let dot = name.lastIndex(of: ".") else { return false }
    return SUPPORTED_EXTENSIONS.contains(name[name.index(after: dot)...].lowercased())
}

/// 当前这组附件能不能发送；可以时返回 nil。
func attachmentError(_ files: [LocalFile], supportsImages: Bool) -> AttachError? {
    if files.count > MAX_UPLOAD_FILES { return .tooMany(max: MAX_UPLOAD_FILES, extra: files.count - MAX_UPLOAD_FILES) }
    for file in files {
        if file.size <= 0 { return .empty(name: file.name) }
        // 长度按 UTF-16 数，和 JS 的 name.length、Kotlin 的 String.length 相同。
        if file.name.isEmpty || file.name.utf16.count > 255 { return .nameTooLong }
        let supported = file.isImage || file.mimeType.hasPrefix("text/") || file.mimeType == "application/pdf"
            || hasSupportedExtension(file.name)
        if !supported { return .unsupported(name: file.name) }
        if file.isImage && !supportsImages { return .modelCannotReadImages }
        if file.size > MAX_UPLOAD_FILE_BYTES { return .fileTooLarge(name: file.name, limitBytes: MAX_UPLOAD_FILE_BYTES) }
    }
    if files.reduce(0, { $0 + $1.size }) > MAX_UPLOAD_TOTAL_BYTES { return .totalTooLarge(limitBytes: MAX_UPLOAD_TOTAL_BYTES) }
    return nil
}

/// 往已有附件里再加一批时的判定。有问题就整批不加，不会悄悄只加一部分。
func selectionError(current: [LocalFile], incoming: [LocalFile], supportsImages: Bool) -> AttachError? {
    if current.count + incoming.count > MAX_UPLOAD_FILES {
        let remaining = max(0, MAX_UPLOAD_FILES - current.count)
        return remaining == 0
            ? .slotsFull(max: MAX_UPLOAD_FILES)
            : .roomForFewer(remaining: remaining, max: MAX_UPLOAD_FILES, count: incoming.count)
    }
    return attachmentError(current + incoming, supportsImages: supportsImages).map { .notAdded(cause: $0) }
}
