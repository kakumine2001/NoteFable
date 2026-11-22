import ObjectiveC
import UIKit
import UniformTypeIdentifiers

/// 系统「分享」里的 NoteFable：从 Safari、X、照片、文件等 App 点分享选它，文字、链接、图片、文件先写进 App Group 的共享目录，
/// 再唤起 NoteFable（`notefable://share?id=…`），App 把它们放进新聊天的输入栏（不自动发送）。
/// 分享扩展的内存上限很低（约 120 MB），所以文件都按文件拷贝，不整个读进内存；超过单个文件上限（20 MiB）的只记下大小，
/// 让 App 的附件校验照常提示“太大”。没能唤起 App 时，App 下次回到前台会自己取走。
final class ShareViewController: UIViewController {
    nonisolated private static let maxFileBytes = 20 * 1024 * 1024

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 247 / 255, green: 246 / 255, blue: 242 / 255, alpha: 1)
        let spinner = UIActivityIndicatorView(style: .medium)
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
                } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
                          let file = await loadFile(provider, type: Self.fileType(of: provider), into: staging) {
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
        openHostApp(ShareIntake.shareURL(id: payload.id))
        // 给系统一点时间把打开主 App 的请求接走，再结束扩展进程。
        try? await Task.sleep(nanoseconds: 150_000_000)
        extensionContext?.completeRequest(returningItems: nil)
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

    /// 图片：PNG / JPEG / WEBP 原样带过去；HEIC、GIF 等模型读不了的转成 JPEG。不是图片返回 nil。
    private func loadImage(_ provider: NSItemProvider, into staging: URL) async -> SharedFileInput? {
        let identifiers = provider.registeredTypeIdentifiers.filter { UTType($0)?.conforms(to: .image) == true }
        guard !identifiers.isEmpty else { return nil }
        let direct = identifiers.compactMap { UTType($0) }.first { [UTType.png, .jpeg, .webP].contains($0) }
        if let direct { return await loadFile(provider, type: direct, into: staging) }
        guard let identifier = identifiers.first else { return nil }
        return await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, _ in
                guard let url, let image = UIImage(contentsOfFile: url.path), let jpeg = image.jpegData(compressionQuality: 0.9) else {
                    continuation.resume(returning: nil)
                    return
                }
                let name = Self.baseName(of: provider, fallback: "image") + ".jpg"
                let target = staging.appendingPathComponent("\(UUID().uuidString)-image.jpg")
                guard (try? jpeg.write(to: target)) != nil else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: Self.input(name: name, mimeType: "image/jpeg", copiedTo: target))
            }
        }
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

    /// 文件分享里能读到内容的那个类型（排除地址类的类型）。
    nonisolated private static func fileType(of provider: NSItemProvider) -> UTType {
        provider.registeredTypeIdentifiers
            .compactMap { UTType($0) }
            .first { $0 != .fileURL && $0 != .url && $0.conforms(to: .data) } ?? .data
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

    // MARK: - 唤起 App

    /// 分享扩展不能直接用 `UIApplication`（编译期标成扩展里不可用），但响应链的尽头就是它：沿着响应链找到能打开地址的对象，调用
    /// `openURL:options:completionHandler:`。这是分享扩展里常用的做法；没能打开也没关系，App 下次回到前台会自己取走共享目录里的内容。
    private func openHostApp(_ url: URL) {
        typealias OpenFunction = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
        let selector = sel_registerName("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        while let current = responder {
            if current.responds(to: selector) {
                let implementation = class_getMethodImplementation(type(of: current), selector)
                let open = unsafeBitCast(implementation, to: OpenFunction.self)
                open(current, selector, url as NSURL, NSDictionary(), nil)
                return
            }
            responder = current.next
        }
    }
}
