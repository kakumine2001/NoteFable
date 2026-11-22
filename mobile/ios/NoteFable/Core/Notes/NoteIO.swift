import Foundation

// 笔记的 Markdown 导出 / 导入（网页 src/lib/note-io.ts 和 use-note-pages.ts 的 exportPage / importMarkdown）。
// 转换都在服务端做：`GET /api/pages/:id/export` → `{ fileName, markdown }`；
// `POST /api/pages/import` `{ files: [{ name, markdown }] }` → 201 `{ pages }`。App 只管选文件、先查一遍数量和大小、把结果交给系统。

/// 一次导入最多几个文件、单个文件和总共最多多少字节（网页 MAX_IMPORT_FILES / MAX_IMPORT_FILE_BYTES / MAX_IMPORT_TOTAL_BYTES；
/// 总量留在 Vercel 4.5 MB 请求上限以内）。
let MAX_IMPORT_FILES = 20
let MAX_IMPORT_FILE_BYTES = 1024 * 1024
let MAX_IMPORT_TOTAL_BYTES = 4 * 1024 * 1024

/// 能导入的扩展名（网页 IMPORT_FILE_EXTENSIONS）。
let IMPORT_FILE_EXTENSIONS = [".md", ".markdown", ".txt"]

/// 网页 isImportableMarkdownFile：去掉首尾空白、不分大小写地看扩展名。
func isImportableMarkdownFile(_ name: String) -> Bool {
    let lower = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return IMPORT_FILE_EXTENSIONS.contains { lower.hasSuffix($0) }
}

/// 导出的一篇笔记（`GET /api/pages/:id/export`，和下载对话的 `{ fileName, markdown }` 同一个格式）。
struct ExportedNote: Encodable, Equatable, Sendable {
    var fileName: String
    var markdown: String
}

extension ExportedNote: Decodable {
    init(from decoder: Decoder) throws {
        let f = try DtoFields(decoder)
        // 网页：markdown 没有就当空串，fileName 没有就叫 note.md。
        let fileName: String = try f.or("fileName", "")
        self.init(fileName: fileName.isEmpty ? "note.md" : fileName, markdown: try f.or("markdown", ""))
    }
}

/// 发给 `POST /api/pages/import` 的一个文件：文件名和它的文字。
struct ImportMarkdownFile: Equatable, Sendable {
    var name: String
    var markdown: String
}

/// 用户选的一个文件：名字、字节数，和读出内容的办法（界面层给：按系统给的地址读，读的时候才占用访问权限）。
struct NoteImportSource: Sendable {
    var name: String
    var size: Int
    var read: @Sendable () throws -> Data

    init(name: String, size: Int, read: @escaping @Sendable () throws -> Data) {
        self.name = name
        self.size = size
        self.read = read
    }
}

/// 发请求之前在本机先查一遍（网页 importMarkdown 开头的检查，顺序相同）：
/// 文件数 → 逐个看扩展名和大小 → 总大小。没问题返回 nil。
func noteImportProblem(_ files: [(name: String, size: Int)]) -> NotesError.Kind? {
    if files.count > MAX_IMPORT_FILES { return .importTooMany }
    var total = 0
    for file in files {
        if !isImportableMarkdownFile(file.name) { return .importBadType }
        if file.size > MAX_IMPORT_FILE_BYTES { return .importFileTooLarge }
        total += file.size
    }
    if total > MAX_IMPORT_TOTAL_BYTES { return .importTooLarge }
    return nil
}

/// 文件的字节 → 文字（网页 `file.text()`）：按 UTF-8 读，坏掉的字节换成 U+FFFD，不因为编码不对而失败。
/// 开头的 BOM 和 NUL 由服务端去掉（markdownFileToNoteContent）。
func noteImportText(_ data: Data) -> String {
    String(decoding: data, as: UTF8.self)
}

/// 导出的文件名（去掉服务端带的 `.md`：系统的"存储到文件"按类型自己加扩展名）。空的话叫 note。
func noteExportBaseName(_ fileName: String) -> String {
    let base = fileName.lowercased().hasSuffix(".md") ? String(fileName.dropLast(3)) : fileName
    return ApiText.isBlank(base) ? "note" : base
}
