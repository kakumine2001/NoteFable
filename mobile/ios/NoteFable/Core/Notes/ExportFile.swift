import Foundation

// 编辑器导出的文件（白板的 PNG / SVG / PDF，以后幻灯片的 PPTX）。网页经 JS 桥分块送来（src/lib/native-bridge.ts 的
// fileStart / fileChunk / fileEnd / fileAbort，src/lib/export-file.ts：每块是原来 512 KiB 以内的字节的 base64，index 从 0 起按顺序），
// 这里拼进临时文件；收齐后界面交给系统的“存储到文件”，结束后删掉（NotesViewModel 的 exportFile / finishExportFile）。

/// 能保存的类型和它们的扩展名（网页 src/lib/whiteboard/export.ts 的 MIME，加上幻灯片要用的 PPTX）。
enum ExportFileTypes {
    static let extensions: [String: String] = [
        "image/png": "png",
        "image/svg+xml": "svg",
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    ]

    /// 表里的类型（不分大小写，`; charset=…` 这样的参数不看）；不在表里是 nil。
    static func normalized(_ mime: String) -> String? {
        let essence = mime.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let value = essence.trimmingCharacters(in: .whitespaces).lowercased()
        return extensions[value] == nil ? nil : value
    }
}

/// 收齐的导出文件。[url] 是临时文件（[ExportFileAssembler.directory] 里，每个文件一个子目录），
/// [name] 是整理过的文件名（带类型对应的扩展名），[mime] 是 [ExportFileTypes] 里的类型。
struct ExportedFile: Equatable, Sendable {
    var url: URL
    var name: String
    var mime: String

    /// 类型对应的扩展名（png / svg / pdf / pptx）。
    var fileExtension: String { ExportFileTypes.extensions[mime] ?? "" }

    /// 去掉扩展名的文件名：系统的“存储到文件”按类型自己加扩展名（和 Markdown 导出的 noteExportBaseName 一样）。
    var baseName: String {
        let suffix = "." + fileExtension
        guard !fileExtension.isEmpty, name.count > suffix.count, name.hasSuffix(suffix) else { return name }
        return String(name.dropLast(suffix.count))
    }
}

/// 把分块送来的文件拼成临时文件。一次只收一个：新的 fileStart 来了，没收完的那个作废（网页中途出错、
/// 没来得及送 fileAbort 时也不会一直卡着）；别的 id 的块和结束不理。出了错（顺序不对、不是 base64、超过声明的大小或上限）
/// 删掉写了一半的文件并抛错。只在主线程用（NotesViewModel 里）。
final class ExportFileAssembler {
    /// 一个文件最多 64 MiB（大白板的 PDF 也在这以内）。
    static let MAX_BYTES = 64 * 1024 * 1024
    /// 文件名连扩展名最多这么多个字符。
    static let MAX_NAME_LENGTH = 120

    enum Failure: Error, Equatable {
        /// 不是能保存的类型（[ExportFileTypes]）。
        case unsupportedType
        /// 声明的大小超过上限，或者送来的比声明的多。
        case tooLarge
        /// 块的顺序不对（漏了、重了）。
        case outOfOrder
        /// 块不是 base64。
        case badData
        /// 结束时比声明的少。
        case incomplete
        /// 临时文件建不了、写不进去。
        case io
    }

    private struct Transfer {
        let id: String
        let file: ExportedFile
        let folder: URL
        let size: Int
        let handle: FileHandle
        var nextIndex = 0
        var written = 0
    }

    /// 临时文件放在这里，每个文件一个子目录（文件名就是给用户看的名字）。
    let directory: URL
    private let fileManager: FileManager
    private var transfer: Transfer?
    /// 这个进程里清过以前留下的临时文件没有（App 被杀、保存窗口开着时退出会留下）。
    private var leftoversSwept = false

    init(
        directory: URL = FileManager.default.temporaryDirectory.appendingPathComponent("notefable-exports", isDirectory: true),
        fileManager: FileManager = .default
    ) {
        self.directory = directory
        self.fileManager = fileManager
    }

    /// 正在收的文件的 id；没有是 nil。
    var receivingId: String? { transfer?.id }

    /// 开始收一个文件（fileStart）。类型不对、太大或建不了临时文件时抛错。
    func start(id: String, name: String, mime: String, size: Int) throws {
        cancel()
        guard let type = ExportFileTypes.normalized(mime) else { throw Failure.unsupportedType }
        guard size >= 0, size <= Self.MAX_BYTES else { throw Failure.tooLarge }
        sweepLeftovers()
        let folder = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let fileName = Self.sanitizedName(name, mime: type)
        let url = folder.appendingPathComponent(fileName, isDirectory: false)
        do {
            try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
            guard fileManager.createFile(atPath: url.path, contents: nil) else { throw Failure.io }
            let handle = try FileHandle(forWritingTo: url)
            transfer = Transfer(id: id, file: ExportedFile(url: url, name: fileName, mime: type), folder: folder, size: size, handle: handle)
        } catch {
            remove(folder)
            throw Failure.io
        }
    }

    /// 一块（fileChunk）。不是正在收的文件的块不理。顺序不对、不是 base64、比声明的大小多、写不进去：这个文件作废并抛错。
    func append(id: String, index: Int, data: String) throws {
        guard var current = transfer, current.id == id else { return }
        do {
            guard index == current.nextIndex else { throw Failure.outOfOrder }
            guard let bytes = Data(base64Encoded: data) else { throw Failure.badData }
            guard bytes.count <= current.size - current.written else { throw Failure.tooLarge }
            do {
                try current.handle.write(contentsOf: bytes)
            } catch {
                throw Failure.io
            }
            current.nextIndex += 1
            current.written += bytes.count
            transfer = current
        } catch {
            cancel()
            throw error
        }
    }

    /// 收完了（fileEnd）：返回拼好的文件。不是正在收的文件返回 nil（不理）；比声明的少时作废并抛错。
    func finish(id: String) throws -> ExportedFile? {
        guard let current = transfer, current.id == id else { return nil }
        transfer = nil
        do {
            try current.handle.close()
        } catch {
            remove(current.folder)
            throw Failure.io
        }
        guard current.written == current.size else {
            remove(current.folder)
            throw Failure.incomplete
        }
        return current.file
    }

    /// 网页放弃了这个文件（fileAbort）：删掉写了一半的。不是正在收的文件不理。
    func abort(id: String) {
        guard transfer?.id == id else { return }
        cancel()
    }

    /// 正在收的文件作废（换了编辑器、换了身份）。
    func cancel() {
        guard let current = transfer else { return }
        transfer = nil
        try? current.handle.close()
        remove(current.folder)
    }

    /// 收齐的文件用完了（存好、取消或失败）：删掉它和它的子目录。只删 [directory] 里的。
    func discard(_ file: ExportedFile) {
        let folder = file.url.deletingLastPathComponent()
        guard folder.deletingLastPathComponent().standardizedFileURL.path == directory.standardizedFileURL.path else { return }
        remove(folder)
    }

    private func remove(_ url: URL) {
        try? fileManager.removeItem(at: url)
    }

    /// 这个进程第一次开始收文件时清掉以前留下的（这时还没有这个进程收齐的文件）。
    private func sweepLeftovers() {
        guard !leftoversSwept else { return }
        leftoversSwept = true
        guard let items = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for item in items { remove(item) }
    }

    /// 导出文件的名字（存成文件、在“存储到文件”里显示）：去掉控制字符、路径分隔符（/ \ :）和改变文字方向的字符，
    /// 连续的空白并成一个空格，去掉开头的点（不变成隐藏文件）；扩展名换成类型对应的（原来的不对就加在后面）；
    /// 连扩展名最多 120 个字符、UTF-8 最多 255 字节（文件名的上限），多的从名字后面截掉。什么都不剩时叫 NoteFable。
    /// [mime] 是 [ExportFileTypes.normalized] 过的类型。
    static func sanitizedName(_ name: String, mime: String) -> String {
        let suffix = "." + (ExportFileTypes.extensions[mime] ?? "bin")
        var cleaned = ""
        var afterSpace = false
        // 网页给的名字本来就在 120 个字符左右，只看开头一段，异常长的名字不用整个扫一遍。
        for scalar in String(name.prefix(1_000)).unicodeScalars where !isDropped(scalar) {
            if scalar.properties.isWhitespace {
                if !afterSpace { cleaned.unicodeScalars.append(" ") }
                afterSpace = true
            } else {
                cleaned.unicodeScalars.append(scalar)
                afterSpace = false
            }
        }
        var base = cleaned.trimmingCharacters(in: .whitespaces)
        if base.lowercased().hasSuffix(suffix) { base = String(base.dropLast(suffix.count)) }
        while let first = base.first, first == "." || first == " " { base.removeFirst() }
        let room = MAX_NAME_LENGTH - suffix.count
        if base.count > room { base = String(base.prefix(room)) }
        while !base.isEmpty, base.utf8.count + suffix.utf8.count > 255 { base.removeLast() }
        base = base.trimmingCharacters(in: .whitespaces)
        return (base.isEmpty ? "NoteFable" : base) + suffix
    }

    /// 不能进文件名的：控制字符（C0、DEL、C1）、路径分隔符、改变文字方向的格式字符（会让名字看起来是另一个扩展名）。
    private static func isDropped(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x00...0x1F, 0x7F...0x9F: return true
        case 0x2F, 0x5C, 0x3A: return true
        case 0x061C, 0x200E, 0x200F, 0x202A...0x202E, 0x2066...0x2069: return true
        default: return false
        }
    }
}
