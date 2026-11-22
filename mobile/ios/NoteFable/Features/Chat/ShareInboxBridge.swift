import Foundation

// 系统「分享」交来的内容从 App Group 的共享目录进到 App（Android 的 `ShareIntent.kt`：外部给的临时文件要马上拷进自己的缓存）。
// 分享扩展（`ShareExtension/`）把文字和文件写进共享目录并唤起 App；这里取走、拷进附件缓存（和拍照、粘贴的图片同一个目录，
// 一天以后顺手清掉），之后的校验和上传和普通附件完全相同。拷贝在后台线程做。

enum ShareInboxBridge {
    /// `id` 给了就取那一份，没给就取最新一份没过期的。共享目录不可用（没有登记 App Group）或没有可取的返回 nil。
    static func consume(id: String?) async -> (text: String, files: [LocalFile])? {
        await Task.detached(priority: .userInitiated) { () -> (text: String, files: [LocalFile])? in
            let manager = FileManager.default
            guard let container = manager.containerURL(forSecurityApplicationGroupIdentifier: ShareIntake.appGroupIdentifier) else { return nil }
            let caches = manager.urls(for: .cachesDirectory, in: .userDomainMask).first ?? manager.temporaryDirectory
            let destination = caches.appendingPathComponent("attachments", isDirectory: true)
            try? manager.createDirectory(at: destination, withIntermediateDirectories: true)
            let store = ShareInboxStore(containerURL: container)
            let consumed = id.map { store.consume(id: $0, copyFilesTo: destination) } ?? store.consumeLatest(copyFilesTo: destination)
            guard let consumed else { return nil }
            let files = consumed.files.map { LocalFile(uri: $0.uri, name: $0.name, mimeType: $0.mimeType, size: $0.size) }
            return (consumed.text, files)
        }.value
    }
}
