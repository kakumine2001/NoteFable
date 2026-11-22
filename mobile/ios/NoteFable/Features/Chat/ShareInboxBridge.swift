import Foundation

// 系统「分享」交来的内容从 App Group 的共享目录进到 App（Android 的 `ShareIntent.kt`：外部给的临时文件要马上拷进自己的缓存）。
// 分享扩展（`ShareExtension/`）把文字和文件写进共享目录；这里取走、拷进附件缓存（和拍照、粘贴的图片同一个目录，
// 一天以后顺手清掉），之后的校验和上传和普通附件完全相同。拷贝在后台线程做。

enum ShareInboxBridge {
    /// 只读检查共享目录里有没有待取且未过期的分享（不删文件）。
    static func hasPending(id: String?) async -> Bool {
        await Task.detached(priority: .userInitiated) { () -> Bool in
            guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ShareIntake.appGroupIdentifier) else {
                return false
            }
            return ShareInboxStore(containerURL: container).hasPending(id: id)
        }.value
    }

    /// `id` 给了就取那一份，没给就按时间先后取走全部没过期的分享。共享目录不可用（没有登记 App Group）或没有可取的返回空数组。
    static func consume(id: String?) async -> [(text: String, files: [LocalFile])] {
        await Task.detached(priority: .userInitiated) { () -> [(text: String, files: [LocalFile])] in
            let manager = FileManager.default
            guard let container = manager.containerURL(forSecurityApplicationGroupIdentifier: ShareIntake.appGroupIdentifier) else { return [] }
            let caches = manager.urls(for: .cachesDirectory, in: .userDomainMask).first ?? manager.temporaryDirectory
            let destination = caches.appendingPathComponent("attachments", isDirectory: true)
            try? manager.createDirectory(at: destination, withIntermediateDirectories: true)
            let store = ShareInboxStore(containerURL: container)
            let list: [ConsumedShare]
            if let id {
                list = store.consume(id: id, copyFilesTo: destination).map { [$0] } ?? []
            } else {
                list = store.consumeAllPending(copyFilesTo: destination)
            }
            return list.map { consumed in
                let files = consumed.files.map { LocalFile(uri: $0.uri, name: $0.name, mimeType: $0.mimeType, size: $0.size) }
                return (consumed.text, files)
            }
        }.value
    }
}
