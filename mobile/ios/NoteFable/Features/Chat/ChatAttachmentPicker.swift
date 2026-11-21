import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// 「添加文件或照片」（Android AttachUi.kt 的 rememberFilePicker、copyPastedImage、readLocalFile）。
// Android 是一个系统选择器里既能选文件也能拍照；iOS 没有合在一起的选择器，所以先出系统的操作表（和手机 Safari 里
// 网页的文件选择框一样三项：照片图库、拍照、选取文件），再打开对应的系统界面。
// 选好的东西都先拷进 App 的缓存目录（`Caches/attachments/<UUID>/<文件名>`）：原地址的读取权限是临时的，剪贴板也会变。
// 拷贝在后台线程做，期间 `ChatViewModel.importFiles` 不让发送。

// MARK: - 缓存目录里的附件副本

enum ChatAttachmentFiles {
    private static let directoryName = "attachments"
    /// 一天以前的旧副本顺手删掉。
    private static let maxAge: TimeInterval = 24 * 60 * 60

    /// 文件选择器里能选的类型（网页 ATTACHMENT_ACCEPT：PNG / JPEG / WEBP、PDF、text/*、JSON；Markdown、CSV、TSV 都属于文本）。
    static let pickerTypes: [UTType] = [.png, .jpeg, .webP, .pdf, .text, .json]

    /// 粘贴进输入框的图片（网页粘贴的图片叫 image.png）。
    static func savePasted(_ images: [ChatPastedImage]) async -> [LocalFile] {
        await Task.detached(priority: .userInitiated) { () -> [LocalFile] in
            images.compactMap { image in
                write(image.data, name: "image.\(image.fileExtension)", mimeType: image.mimeType)
            }
        }.value
    }

    /// 相机拍的照片：存成 JPEG，文件名 IMG_日期_时间.jpg。
    static func saveCamera(_ image: UIImage) async -> [LocalFile] {
        await Task.detached(priority: .userInitiated) { () -> [LocalFile] in
            guard let data = image.jpegData(compressionQuality: 0.9) else { return [] }
            return [write(data, name: photoName(index: 0, fileExtension: "jpg"), mimeType: "image/jpeg")].compactMap { $0 }
        }.value
    }

    /// 照片图库里选的：系统给的是 JPEG / PNG 等原始字节；模型读不了的格式（HEIC、GIF…）转成 JPEG。
    static func loadPhotos(_ items: [PhotosPickerItem]) async -> [LocalFile] {
        var files: [LocalFile] = []
        for (index, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let saved = await Task.detached(priority: .userInitiated) { () -> LocalFile? in
                savePhoto(data, index: index)
            }.value
            if let saved { files.append(saved) }
        }
        return files
    }

    /// 文件选择器里选的：拷进缓存，读出文件名、类型和大小。
    static func copyPicked(_ urls: [URL]) async -> [LocalFile] {
        await Task.detached(priority: .userInitiated) { () -> [LocalFile] in
            urls.compactMap { copy($0) }
        }.value
    }

    // ---- 内部 ----

    private static func savePhoto(_ data: Data, index: Int) -> LocalFile? {
        if let known = imageType(of: data) {
            return write(data, name: photoName(index: index, fileExtension: known.fileExtension), mimeType: known.mimeType)
        }
        guard let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.9) else { return nil }
        return write(jpeg, name: photoName(index: index, fileExtension: "jpg"), mimeType: "image/jpeg")
    }

    private static func copy(_ source: URL) -> LocalFile? {
        // 文件 App 里的文件要先申请访问；iCloud 里还没下载的由 NSFileCoordinator 等它下载好。
        let scoped = source.startAccessingSecurityScopedResource()
        defer {
            if scoped { source.stopAccessingSecurityScopedResource() }
        }
        let name = source.lastPathComponent
        guard let target = try? newCacheURL(name: name) else { return nil }
        var copied = false
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { readable in
            copied = (try? FileManager.default.copyItem(at: readable, to: target)) != nil
        }
        guard copied, coordinationError == nil else { return nil }
        let size = (try? target.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        return LocalFile(uri: target.absoluteString, name: name, mimeType: mimeType(of: source), size: size)
    }

    private static func write(_ data: Data, name: String, mimeType: String) -> LocalFile? {
        guard let target = try? newCacheURL(name: name), (try? data.write(to: target, options: .atomic)) != nil else { return nil }
        return LocalFile(uri: target.absoluteString, name: name, mimeType: mimeType, size: data.count)
    }

    /// 新副本的位置。每个文件单独一层目录，文件名就能保留原名。
    private static func newCacheURL(name: String) throws -> URL {
        let manager = FileManager.default
        let caches = manager.urls(for: .cachesDirectory, in: .userDomainMask).first ?? manager.temporaryDirectory
        let root = caches.appendingPathComponent(directoryName, isDirectory: true)
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        let now = Date()
        let existing = (try? manager.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        for old in existing {
            let modified = (try? old.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if let modified, now.timeIntervalSince(modified) > maxAge { try? manager.removeItem(at: old) }
        }
        let slot = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: slot, withIntermediateDirectories: true)
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let safe = trimmed.isEmpty || trimmed.contains("/") ? "file" : trimmed
        return slot.appendingPathComponent(safe, isDirectory: false)
    }

    private static func photoName(index: Int, fileExtension: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        let suffix = index > 0 ? "_\(index + 1)" : ""
        return "IMG_\(formatter.string(from: Date()))\(suffix).\(fileExtension)"
    }

    /// 按开头的字节认出 PNG / JPEG / WEBP（附件只收这三种图片）。
    private static func imageType(of data: Data) -> (mimeType: String, fileExtension: String)? {
        let head = [UInt8](data.prefix(12))
        if head.count >= 4, Array(head[0..<4]) == [0x89, 0x50, 0x4E, 0x47] { return ("image/png", "png") }
        if head.count >= 3, Array(head[0..<3]) == [0xFF, 0xD8, 0xFF] { return ("image/jpeg", "jpg") }
        if head.count >= 12, Array(head[0..<4]) == [0x52, 0x49, 0x46, 0x46], Array(head[8..<12]) == [0x57, 0x45, 0x42, 0x50] {
            return ("image/webp", "webp")
        }
        return nil
    }

    private static func mimeType(of url: URL) -> String {
        if let type = (try? url.resourceValues(forKeys: [.contentTypeKey]))?.contentType, let mime = type.preferredMIMEType {
            return mime
        }
        if let mime = UTType(filenameExtension: url.pathExtension.lowercased())?.preferredMIMEType { return mime }
        return "application/octet-stream"
    }
}

// MARK: - 选择器

extension View {
    /// 「添加文件或照片」的几个系统界面。把 `isChoosing` 设成 true 就先问从哪里选。
    func chatAttachmentPicker(isChoosing: Binding<Bool>) -> some View {
        modifier(ChatAttachmentPickerModifier(isChoosing: isChoosing))
    }
}

private struct ChatAttachmentPickerModifier: ViewModifier {
    @Binding var isChoosing: Bool

    @Environment(AppEnvironment.self) private var app
    @State private var photosOpen = false
    @State private var filesOpen = false
    @State private var cameraOpen = false
    @State private var photoItems: [PhotosPickerItem] = []

    func body(content: Content) -> some View {
        content
            .confirmationDialog(L("attach_files"), isPresented: $isChoosing, titleVisibility: .hidden) {
                Button(sourceTitle("attach_source_photos", fallback: "Photo Library")) { presentLater { photosOpen = true } }
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button(sourceTitle("attach_source_camera", fallback: "Take Photo")) { presentLater { cameraOpen = true } }
                }
                Button(sourceTitle("attach_source_files", fallback: "Choose Files")) { presentLater { filesOpen = true } }
                Button(L("cancel"), role: .cancel) {}
            }
            // 三个系统界面各挂在自己的视图上，互不影响。
            .background {
                Color.clear.photosPicker(
                    isPresented: $photosOpen,
                    selection: $photoItems,
                    maxSelectionCount: MAX_UPLOAD_FILES,
                    matching: .images,
                    preferredItemEncoding: .compatible
                )
            }
            .background {
                Color.clear.fileImporter(
                    isPresented: $filesOpen,
                    allowedContentTypes: ChatAttachmentFiles.pickerTypes,
                    allowsMultipleSelection: true
                ) { result in
                    guard case .success(let urls) = result, !urls.isEmpty else { return }
                    app.chat.importFiles { await ChatAttachmentFiles.copyPicked(urls) }
                }
            }
            .background {
                Color.clear.fullScreenCover(isPresented: $cameraOpen) {
                    ChatCameraPicker { image in
                        cameraOpen = false
                        guard let image else { return }
                        app.chat.importFiles { await ChatAttachmentFiles.saveCamera(image) }
                    }
                    .ignoresSafeArea()
                }
            }
            .onChange(of: photoItems) { _, items in
                guard !items.isEmpty else { return }
                photoItems = []
                app.chat.importFiles { await ChatAttachmentFiles.loadPhotos(items) }
            }
    }

    /// 操作表收起后再打开下一个界面（两个系统界面不能同时在切换）。
    private func presentLater(_ present: @escaping () -> Void) {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 350_000_000)
            present()
        }
    }

    /// 这三项的文案 Android 没有（它用的是系统选择器）；字符串资源里加上之前先用英文。
    private func sourceTitle(_ key: String, fallback: String) -> String {
        let text = L(key)
        return text == key ? fallback : text
    }
}

/// 系统相机（UIImagePickerController）。拍好给出照片，取消给 nil；关掉由外面负责。
private struct ChatCameraPicker: UIViewControllerRepresentable {
    let onFinish: (UIImage?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinish: onFinish)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let onFinish: (UIImage?) -> Void

        init(onFinish: @escaping (UIImage?) -> Void) {
            self.onFinish = onFinish
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            onFinish(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onFinish(nil)
        }
    }
}
