import Foundation

/// 网页做好的导出文件（幻灯片的 PDF、PNG、PPTX）分块交给 App（`fileStart` → 若干 `fileChunk`（base64）→ `fileEnd`，出错时 `fileAbort`；
/// src/lib/export-file.ts、Android NoteEmbedBridge）。块按顺序写进临时目录的文件，收齐后交给界面打开系统的“存储到文件”。
/// 顺序不对、base64 坏了、超过上限的文件放弃并删掉（不把存储写满）。
final class ExportFileAssembler {
    struct Ready: Equatable {
        /// 改成网页给的文件名之后的临时文件（“存储到文件”显示这个名字）。
        var url: URL
        var name: String
        var mime: String
    }

    /// 一个文件的上限（网页的 PDF 几十 MB 以内）。
    static let maxBytes = 200 * 1024 * 1024

    private struct Pending {
        var handle: FileHandle
        var url: URL
        var name: String
        var mime: String
        var next = 0
        var bytes = 0
    }

    private let directory: URL
    private var pending: [String: Pending] = [:]

    init(directory: URL = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)) {
        self.directory = directory
    }

    func start(id: String, name: String, mime: String) {
        abort(id: id)
        let fileManager = FileManager.default
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        // 前一次没保存完留下的（超过一天的）临时文件顺便清掉。
        if let old = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]) {
            for url in old {
                let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
                if Date().timeIntervalSince(modified) > 24 * 60 * 60 { try? fileManager.removeItem(at: url) }
            }
        }
        let url = directory.appendingPathComponent("\(UUID().uuidString).part")
        guard fileManager.createFile(atPath: url.path, contents: nil), let handle = try? FileHandle(forWritingTo: url) else { return }
        pending[id] = Pending(handle: handle, url: url, name: Self.safeName(name), mime: mime)
    }

    func append(id: String, index: Int, base64: String) {
        guard var file = pending[id] else { return }
        guard index == file.next, let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters), file.bytes + data.count <= Self.maxBytes else {
            abort(id: id)
            return
        }
        do {
            try file.handle.write(contentsOf: data)
        } catch {
            abort(id: id)
            return
        }
        file.next += 1
        file.bytes += data.count
        pending[id] = file
    }

    /// 收齐了：文件名换成网页给的名字（同名的文件夹里）后返回。没有这个 id（已放弃）时 nil。
    func finish(id: String) -> Ready? {
        guard let file = pending.removeValue(forKey: id) else { return nil }
        let folder = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let target = folder.appendingPathComponent(file.name)
        do {
            // 写不完（关闭时失败）的文件不交出去。
            try file.handle.close()
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: file.url, to: target)
        } catch {
            try? FileManager.default.removeItem(at: file.url)
            try? FileManager.default.removeItem(at: folder)
            return nil
        }
        return Ready(url: target, name: file.name, mime: file.mime)
    }

    func abort(id: String) {
        guard let file = pending.removeValue(forKey: id) else { return }
        try? file.handle.close()
        try? FileManager.default.removeItem(at: file.url)
    }

    func abortAll() {
        for id in Array(pending.keys) { abort(id: id) }
    }

    /// 去掉存储位置用不了的字符（/ : 等）。空了就叫 export。
    static func safeName(_ name: String) -> String {
        let cleaned = name.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "export" : String(cleaned.prefix(160))
    }
}
