import ImageIO
import UIKit
import UniformTypeIdentifiers

/// 系统「分享」里的 NoteFable：从 Safari、X、照片、文件等 App 点分享选它，文字、链接、图片、文件先写进 App Group 的共享目录，
/// 尝试经官方 `extensionContext?.open` 唤起 NoteFable；iOS 限制分享扩展直接拉起主 App 时，短暂展示已保存勾标后收起，
/// 用户切回 NoteFable 时由主 App 自动按顺序取走全部待处理分享，放进新聊天的输入栏（不自动发送）。
/// 分享扩展的内存上限很低（约 120 MB），所以文件按文件拷贝、非直通图片经 ImageIO 缩图后转 JPEG；超过 20 MiB 的只记大小。
final class ShareViewController: UIViewController {
    nonisolated private static let maxFileBytes = 20 * 1024 * 1024
    /// 扩展进程内存很紧（约 120 MB）：把 HEIC / GIF 等转成 JPEG 时用 ImageIO 边解码边缩到长边 ≤ 4096，避免 48MP 原图爆内存。
    nonisolated private static let maxTranscodePixelSize = 4096

    private let spinner = UIActivityIndicatorView(style: .medium)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 247 / 255, green: 246 / 255, blue: 242 / 255, alpha: 1)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
        Task { await process() }
    }

    // MARK: - 取出分享的内容

    private func process() async {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        var title = ""
        var texts: [String] = []
        var urls: [String] = []
        var files: [SharedFileInput] = []
        let staging = FileManager.default.temporaryDirectory.appendingPathComponent("share-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: staging) }

        for item in items {
            if title.isEmpty { title = item.attributedContentText?.string ?? item.attributedTitle?.string ?? "" }
            for provider in item.attachments ?? [] {
                if let image = await loadImage(provider, into: staging) {
                    files.append(image)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier),
                          let pdf = await loadFile(provider, type: .pdf, into: staging) {
                    files.append(pdf)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.json.identifier),
                          let json = await loadFile(provider, type: .json, into: staging) {
                    files.append(json)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
                          let file = await loadFileOrURL(provider, into: staging) {
                    files.append(file)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                          let url = await loadWebURL(provider) {
                    urls.append(url)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let text = await loadText(provider) {
                    texts.append(text)
                }
            }
        }

        let text = ShareIntake.composeText(title: title, text: texts.joined(separator: "\n"), url: urls.joined(separator: "\n"))
        guard !text.isEmpty || !files.isEmpty else {
            extensionContext?.cancelRequest(withError: NSError(domain: "NoteFableShare", code: 1))
            return
        }
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ShareIntake.appGroupIdentifier),
              let payload = try? ShareInboxStore(containerURL: container).write(text: text, files: files) else {
            extensionContext?.cancelRequest(withError: NSError(domain: "NoteFableShare", code: 2))
            return
        }
        let opened = await openHostApp(ShareIntake.shareURL(id: payload.id))
        if !opened {
            // iOS 不允许分享扩展直接拉起主 App：给出明确提示“已保存，打开 NoteFable 继续”，切回后自动导入。
            showSavedConfirmation()
            try? await Task.sleep(nanoseconds: 1_100_000_000)
        }
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func openHostApp(_ url: URL) async -> Bool {
        guard let context = extensionContext else { return false }
        return await withCheckedContinuation { continuation in
            context.open(url) { success in
                continuation.resume(returning: success)
            }
        }
    }

    private func showSavedConfirmation() {
        spinner.stopAnimating()
        spinner.isHidden = true
        let config = UIImage.SymbolConfiguration(pointSize: 36, weight: .medium)
        let icon = UIImageView(image: UIImage(systemName: "checkmark.circle.fill", withConfiguration: config))
        icon.tintColor = UIColor(red: 35 / 255, green: 131 / 255, blue: 226 / 255, alpha: 1)
        let label = UILabel()
        label.text = Self.savedMessage()
        label.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        label.textColor = UIColor(red: 55 / 255, green: 53 / 255, blue: 47 / 255, alpha: 1)
        label.textAlignment = .center
        label.numberOfLines = 0
        let stack = UIStackView(arrangedSubviews: [icon, label])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
        ])
    }

    /// 17 种支持语言的“打开 NoteFable 继续”提示（分享扩展独立打包，不额外依赖主 App 的资源表）。
    nonisolated private static func savedMessage() -> String {
        for tag in Locale.preferredLanguages {
            let lower = tag.lowercased().replacingOccurrences(of: "_", with: "-")
            if lower.hasPrefix("zh-hant") || lower.hasPrefix("zh-tw") || lower.hasPrefix("zh-hk") || lower.hasPrefix("zh-mo") {
                return "已儲存，開啟 NoteFable 繼續"
            }
            if lower.hasPrefix("zh") { return "已保存，打开 NoteFable 继续" }
            if lower.hasPrefix("ja") { return "保存しました。NoteFable を開いて続けてください" }
            if lower.hasPrefix("ko") { return "저장되었습니다. NoteFable을 열어 계속하세요" }
            if lower.hasPrefix("es") { return "Guardado. Abre NoteFable para continuar" }
            if lower.hasPrefix("fr") { return "Enregistré. Ouvrez NoteFable pour continuer" }
            if lower.hasPrefix("de") { return "Gespeichert. Öffne NoteFable zum Fortfahren" }
            if lower.hasPrefix("pt") { return "Salvo. Abra o NoteFable para continuar" }
            if lower.hasPrefix("it") { return "Salvato. Apri NoteFable per continuare" }
            if lower.hasPrefix("id") || lower.hasPrefix("in") { return "Tersimpan. Buka NoteFable untuk melanjutkan" }
            if lower.hasPrefix("vi") { return "Đã lưu. Mở NoteFable để tiếp tục" }
            if lower.hasPrefix("th") { return "บันทึกแล้ว เปิด NoteFable เพื่อดำเนินการต่อ" }
            if lower.hasPrefix("hi") { return "सहेजा गया। जारी रखने के लिए NoteFable खोलें" }
            if lower.hasPrefix("ar") { return "تم الحفظ. افتح NoteFable للمتابعة" }
            if lower.hasPrefix("tr") { return "Kaydedildi. Devam etmek için NoteFable'ı açın" }
            if lower.hasPrefix("ru") { return "Сохранено. Откройте NoteFable, чтобы продолжить" }
            if lower.hasPrefix("en") { return "Saved. Open NoteFable to continue" }
        }
        return "Saved. Open NoteFable to continue"
    }

    private func loadWebURL(_ provider: NSItemProvider) async -> String? {
        guard let item = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) else { return nil }
        if let url = item as? URL { return url.isFileURL ? nil : url.absoluteString }
        if let string = item as? String { return string }
        return nil
    }

    private func loadText(_ provider: NSItemProvider) async -> String? {
        guard let item = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) else { return nil }
        if let string = item as? String { return string }
        if let attributed = item as? NSAttributedString { return attributed.string }
        if let data = item as? Data { return String(data: data, encoding: .utf8) }
        return nil
    }

    /// 优先按具体的 `.data` 类型取文件；若来源只提供 `public.file-url`，直接读取该文件地址并拷入暂存目录。
    private func loadFileOrURL(_ provider: NSItemProvider, into staging: URL) async -> SharedFileInput? {
        if let typed = Self.typedDataType(of: provider), let file = await loadFile(provider, type: typed, into: staging) {
            return file
        }
        return await loadFileURL(provider, into: staging)
    }

    private func loadFileURL(_ provider: NSItemProvider, into staging: URL) async -> SharedFileInput? {
        guard let item = try? await provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) else { return nil }
        let fileURL: URL?
        if let url = item as? URL {
            fileURL = url
        } else if let data = item as? Data {
            fileURL = URL(dataRepresentation: data, relativeTo: nil)
        } else if let string = item as? String {
            fileURL = URL(string: string)
        } else {
            fileURL = nil
        }
        guard let source = fileURL, source.isFileURL else { return nil }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let size = (try? source.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        let inferredType = UTType(filenameExtension: source.pathExtension.lowercased()) ?? .data
        let name = Self.fileName(of: provider, url: source, type: inferredType)
        let mime = inferredType.preferredMIMEType ?? "application/octet-stream"
        if size > Self.maxFileBytes {
            return SharedFileInput(name: name, mimeType: mime, size: size)
        }
        let target = staging.appendingPathComponent("\(UUID().uuidString)-\(source.lastPathComponent)")
        guard (try? FileManager.default.copyItem(at: source, to: target)) != nil else { return nil }
        return Self.input(name: name, mimeType: mime, copiedTo: target)
    }

    /// 图片：PNG / JPEG / WEBP 原样带过去；HEIC、GIF 等模型读不了的经 ImageIO 缩图后转成 JPEG。不是图片返回 nil。
    private func loadImage(_ provider: NSItemProvider, into staging: URL) async -> SharedFileInput? {
        let identifiers = provider.registeredTypeIdentifiers.filter { UTType($0)?.conforms(to: .image) == true }
        guard !identifiers.isEmpty else { return nil }
        let direct = identifiers.compactMap { UTType($0) }.first { [UTType.png, .jpeg, .webP].contains($0) }
        if let direct { return await loadFile(provider, type: direct, into: staging) }
        guard let identifier = identifiers.first else { return nil }
        return await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, _ in
                guard let url else {
                    continuation.resume(returning: nil)
                    return
                }
                let name = Self.baseName(of: provider, fallback: "image") + ".jpg"
                let sourceSize = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
                if sourceSize > Self.maxFileBytes {
                    continuation.resume(returning: SharedFileInput(name: name, mimeType: "image/jpeg", size: sourceSize))
                    return
                }
                guard let jpeg = Self.transcodeToJpeg(url: url) else {
                    continuation.resume(returning: nil)
                    return
                }
                if jpeg.count > Self.maxFileBytes {
                    continuation.resume(returning: SharedFileInput(name: name, mimeType: "image/jpeg", size: jpeg.count))
                    return
                }
                let target = staging.appendingPathComponent("\(UUID().uuidString)-image.jpg")
                guard (try? jpeg.write(to: target)) != nil else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: Self.input(name: name, mimeType: "image/jpeg", copiedTo: target))
            }
        }
    }

    nonisolated private static func transcodeToJpeg(url: URL) -> Data? {
        let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions as CFDictionary) else { return nil }
        let thumbOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxTranscodePixelSize,
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions as CFDictionary) else { return nil }
        return UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.9)
    }

    /// 文件（PDF、文本、其他）：拷到临时目录再交给共享目录。过大的不拷，只记下大小。
    private func loadFile(_ provider: NSItemProvider, type: UTType, into staging: URL) async -> SharedFileInput? {
        await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                guard let url else {
                    continuation.resume(returning: nil)
                    return
                }
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
                let name = Self.fileName(of: provider, url: url, type: type)
                let mime = type.preferredMIMEType ?? "application/octet-stream"
                if size > Self.maxFileBytes {
                    continuation.resume(returning: SharedFileInput(name: name, mimeType: mime, size: size))
                    return
                }
                let target = staging.appendingPathComponent("\(UUID().uuidString)-\(url.lastPathComponent)")
                guard (try? FileManager.default.copyItem(at: url, to: target)) != nil else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: Self.input(name: name, mimeType: mime, copiedTo: target))
            }
        }
    }

    nonisolated private static func input(name: String, mimeType: String, copiedTo target: URL) -> SharedFileInput {
        let size = (try? target.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        return SharedFileInput(name: name, mimeType: mimeType, size: size, fileURL: target)
    }

    /// 文件分享里具体的 `.data` 类型（排除地址类）。只有 `public.file-url` 时返回 nil。
    nonisolated private static func typedDataType(of provider: NSItemProvider) -> UTType? {
        provider.registeredTypeIdentifiers
            .compactMap { UTType($0) }
            .first { $0 != .fileURL && $0 != .url && $0.conforms(to: .data) }
    }

    nonisolated private static func baseName(of provider: NSItemProvider, fallback: String) -> String {
        let suggested = (provider.suggestedName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let base = (suggested as NSString).deletingPathExtension
        return base.isEmpty || base.contains("/") ? fallback : base
    }

    nonisolated private static func fileName(of provider: NSItemProvider, url: URL, type: UTType) -> String {
        let suggested = (provider.suggestedName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let ext = url.pathExtension.isEmpty ? (type.preferredFilenameExtension ?? "") : url.pathExtension
        if suggested.isEmpty || suggested.contains("/") { return url.lastPathComponent }
        if ext.isEmpty || (suggested as NSString).pathExtension.lowercased() == ext.lowercased() { return suggested }
        return "\(suggested).\(ext)"
    }
}
