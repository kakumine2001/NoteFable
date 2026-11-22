import Foundation

// 系统「分享」交来的内容（Android 的 `data/ShareIntake.kt`、网页的 `src/lib/share-target.ts` 的同名规则：三端文字的组合方式相同）。
//
// 这个文件同时编进 App 和分享扩展（`NoteFableShareExtension`），所以只 import Foundation，也不引用 Core 里的别的文件。
// 流程：分享扩展把文字和文件写进 App Group 的共享目录（`ShareInboxStore.write`），再用 `notefable://share?id=…` 唤起 App；
// App 从共享目录取走（`consume`，取完就删），拷进自己的附件缓存，放进新聊天的输入栏。

enum ShareIntake {
    /// 主 App 和分享扩展共用的 App Group（Apple Developer 里登记，`NoteFable.entitlements` 和 `ShareExtension.entitlements` 里声明）。
    static let appGroupIdentifier = "group.com.kakumine.notefable"
    static let urlScheme = "notefable"
    static let urlHost = "share"

    /// 分享扩展唤起 App 用的地址。
    static func shareURL(id: String) -> URL {
        URL(string: "\(urlScheme)://\(urlHost)?id=\(id)") ?? URL(string: "\(urlScheme)://\(urlHost)")!
    }

    /// 认出 `notefable://share?id=…` 并取出 id；别的地址、形状不对的 id 返回 nil。
    static func parseShareURL(_ url: URL) -> String? {
        guard url.scheme?.lowercased() == urlScheme, url.host?.lowercased() == urlHost else { return nil }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let id = items.first(where: { $0.name == "id" })?.value, isSafeId(id) else { return nil }
        return id
    }

    /// id 会拼进目录名，只收 UUID 这样的字符，防止路径穿越。
    static func isSafeId(_ id: String) -> Bool {
        guard (8...64).contains(id.count) else { return false }
        return id.unicodeScalars.allSatisfy { scalar in
            (scalar.value >= 48 && scalar.value <= 57) || (scalar.value >= 65 && scalar.value <= 90)
                || (scalar.value >= 97 && scalar.value <= 122) || scalar == "-" || scalar == "_"
        }
    }

    /// 标题 + 正文 + 链接合成一段文字：同样的内容（正文里已经有链接、标题等）只留一次。
    static func composeText(title: String?, text: String?, url: String?) -> String {
        let cleanTitle = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanText = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanUrl = (url ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var parts: [String] = []
        if !cleanTitle.isEmpty, !cleanText.contains(cleanTitle), cleanTitle != cleanUrl { parts.append(cleanTitle) }
        if !cleanText.isEmpty { parts.append(cleanText) }
        if !cleanUrl.isEmpty, !cleanText.contains(cleanUrl) { parts.append(cleanUrl) }
        return parts.joined(separator: "\n")
    }

    /// 输入栏里已经有写了一半的内容时不覆盖，把分享来的文字接在后面。
    static func mergeDraft(existing: String, shared: String) -> String {
        if shared.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return existing }
        if existing.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return shared }
        return "\(existing)\n\n\(shared)"
    }
}

/// 扩展写进共享目录的一个文件。内容有两种给法：`data`（内存里的字节）或 `fileURL`（已经在磁盘上的文件，直接拷，不进内存）；
/// 两个都没有表示太大没有拷（只记下真实大小，让 App 的附件校验照常拒绝）。
struct SharedFileInput: Sendable {
    var name: String
    var mimeType: String
    var size: Int
    var data: Data?
    var fileURL: URL?

    init(name: String, mimeType: String, size: Int, data: Data? = nil, fileURL: URL? = nil) {
        self.name = name
        self.mimeType = mimeType
        self.size = size
        self.data = data
        self.fileURL = fileURL
    }
}

struct SharedFileRecord: Codable, Equatable, Sendable {
    /// 相对这次分享目录的路径；没拷贝内容的（太大的）文件是空。
    var relativePath: String
    var name: String
    var mimeType: String
    var size: Int
}

struct SharedPayload: Codable, Equatable, Sendable {
    var id: String
    var createdAt: TimeInterval
    var text: String
    var files: [SharedFileRecord]
}

/// App 取走后的文件：`uri` 是拷进附件缓存后的文件地址（太大没有拷贝的，是不能打开的占位地址，附件校验会先拒绝它）。
struct ConsumedSharedFile: Equatable, Sendable {
    var uri: String
    var name: String
    var mimeType: String
    var size: Int
}

struct ConsumedShare: Equatable, Sendable {
    var text: String
    var files: [ConsumedSharedFile]
}

/// 共享目录里的“待取”分享：`<container>/ShareInbox/<id>/payload.json` 加 `files/<序号>`。取走就删，超过 10 分钟没人取也删。
/// 生产里 `containerURL` 是 App Group 的容器；测试里是临时目录。
struct ShareInboxStore: Sendable {
    static let defaultMaxAge: TimeInterval = 10 * 60

    let containerURL: URL

    init(containerURL: URL) {
        self.containerURL = containerURL
    }

    private var inboxURL: URL { containerURL.appendingPathComponent("ShareInbox", isDirectory: true) }

    /// 写一次分享。顺手清掉过期的旧分享。目录名带写入时间戳（`<unix秒>-<UUID>`），清过期目录时不用读文件系统的时间戳 API。
    @discardableResult
    func write(text: String, files: [SharedFileInput], now: Date = Date()) throws -> SharedPayload {
        let manager = FileManager.default
        try manager.createDirectory(at: inboxURL, withIntermediateDirectories: true)
        prune(now: now)
        let id = "\(Int(now.timeIntervalSince1970))-\(UUID().uuidString)"
        let directory = inboxURL.appendingPathComponent(id, isDirectory: true)
        try manager.createDirectory(at: directory.appendingPathComponent("files", isDirectory: true), withIntermediateDirectories: true)
        var records: [SharedFileRecord] = []
        for (index, file) in files.enumerated() {
            var relative = ""
            if let data = file.data {
                relative = "files/\(index)"
                try data.write(to: directory.appendingPathComponent(relative), options: .atomic)
            } else if let fileURL = file.fileURL {
                relative = "files/\(index)"
                try manager.copyItem(at: fileURL, to: directory.appendingPathComponent(relative))
            }
            records.append(SharedFileRecord(relativePath: relative, name: file.name, mimeType: file.mimeType, size: file.size))
        }
        let payload = SharedPayload(id: id, createdAt: now.timeIntervalSince1970, text: text, files: records)
        try JSONEncoder().encode(payload).write(to: directory.appendingPathComponent("payload.json"), options: .atomic)
        return payload
    }

    /// 取走指定的分享（取完就删）：文件拷到 `destinationDir/<UUID>/<文件名>`。找不到、已过期、id 形状不对返回 nil。
    func consume(id: String, copyFilesTo destinationDir: URL, now: Date = Date()) -> ConsumedShare? {
        guard ShareIntake.isSafeId(id) else { return nil }
        let directory = inboxURL.appendingPathComponent(id, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        guard let payload = readPayload(in: directory) else { return nil }
        if now.timeIntervalSince1970 - payload.createdAt > Self.defaultMaxAge { return nil }
        return ConsumedShare(text: payload.text, files: payload.files.map { copy($0, from: directory, to: destinationDir) })
    }

    /// 只读检查共享目录里有没有待取且未过期的分享（不删文件）。在笔记工作区回到前台时，只有真的有待取分享才尝试切回聊天。
    func hasPending(id: String? = nil, maxAge: TimeInterval = ShareInboxStore.defaultMaxAge, now: Date = Date()) -> Bool {
        if let id {
            guard ShareIntake.isSafeId(id) else { return false }
            let directory = inboxURL.appendingPathComponent(id, isDirectory: true)
            guard let payload = readPayload(in: directory) else { return false }
            return now.timeIntervalSince1970 - payload.createdAt <= maxAge
        }
        return pendingDirectories().contains { directory in
            guard let payload = readPayload(in: directory) else { return false }
            return now.timeIntervalSince1970 - payload.createdAt <= maxAge
        }
    }

    /// 按分享时间先后取走共享目录里全部没过期的分享（App 启动或回到前台时用）。过期的顺手删掉。
    func consumeAllPending(copyFilesTo destinationDir: URL, maxAge: TimeInterval = ShareInboxStore.defaultMaxAge, now: Date = Date()) -> [ConsumedShare] {
        prune(now: now, maxAge: maxAge)
        let ordered = pendingDirectories()
            .compactMap { readPayload(in: $0) }
            .sorted { $0.createdAt < $1.createdAt }
        return ordered.compactMap { consume(id: $0.id, copyFilesTo: destinationDir, now: now) }
    }

    // ---- 内部 ----

    private func pendingDirectories() -> [URL] {
        let contents = (try? FileManager.default.contentsOfDirectory(at: inboxURL, includingPropertiesForKeys: nil)) ?? []
        return contents.filter { ShareIntake.isSafeId($0.lastPathComponent) }
    }

    private func readPayload(in directory: URL) -> SharedPayload? {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent("payload.json")) else { return nil }
        return try? JSONDecoder().decode(SharedPayload.self, from: data)
    }

    private func prune(now: Date, maxAge: TimeInterval = ShareInboxStore.defaultMaxAge) {
        for directory in pendingDirectories() {
            if let payload = readPayload(in: directory) {
                if now.timeIntervalSince1970 - payload.createdAt > maxAge { try? FileManager.default.removeItem(at: directory) }
                continue
            }
            // payload.json 还没有，可能是别的进程（分享扩展）正在写：从目录名开头的时间戳判断，不碰文件系统时间戳 API。
            if let started = Self.timestampFromDirectoryName(directory.lastPathComponent), now.timeIntervalSince1970 - started <= maxAge {
                continue
            }
            try? FileManager.default.removeItem(at: directory)
        }
    }

    private static func timestampFromDirectoryName(_ name: String) -> TimeInterval? {
        guard let dash = name.firstIndex(of: "-"), let seconds = TimeInterval(name[..<dash]), seconds > 0 else { return nil }
        return seconds
    }

    private func copy(_ record: SharedFileRecord, from directory: URL, to destinationDir: URL) -> ConsumedSharedFile {
        let placeholder = ConsumedSharedFile(uri: "share-oversize:\(UUID().uuidString)", name: record.name, mimeType: record.mimeType, size: record.size)
        guard !record.relativePath.isEmpty, !record.relativePath.contains("..") else { return placeholder }
        let source = directory.appendingPathComponent(record.relativePath)
        let manager = FileManager.default
        let slot = destinationDir.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let trimmed = record.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let safeName = trimmed.isEmpty || trimmed.contains("/") ? "file" : trimmed
        let target = slot.appendingPathComponent(safeName, isDirectory: false)
        do {
            try manager.createDirectory(at: slot, withIntermediateDirectories: true)
            try manager.copyItem(at: source, to: target)
        } catch {
            return placeholder
        }
        return ConsumedSharedFile(uri: target.absoluteString, name: record.name, mimeType: record.mimeType, size: record.size)
    }
}
