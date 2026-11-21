import Foundation
import UIKit

/// 下载笔记里的私有文件（`/api/pages/files?key=…`；Android ui/NoteFileDownloads.kt）。文件只给它的主人，要带 App 的 Cookie，
/// 所以由 App 自己下载（`NoteFableApi.downloadNoteFile`），不交给系统浏览器（它没有这个 Cookie，只会拿到 404）。
/// 先存进临时目录，再弹系统的分享面板（“存储到文件”、用别的 App 打开；Android 是存进“下载”后弹“打开方式”），面板关掉后删掉临时文件。
/// 提示文案用网页已有的 "Downloading…" 和 App 已有的 "Request failed: …"（原因是服务端的原句，经词典翻译）。
@MainActor
enum NoteFileDownloader {
    /// `anchor` 是发起下载的视图（WebView），分享面板从它所在的窗口弹出。
    static func download(_ url: String, app: AppEnvironment, anchor: UIView?) {
        Toast.show(L("downloading"))
        let api = app.api
        Task { @MainActor [weak anchor] in
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("note-files", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                let saved = try await fetch(url, api: api, into: directory)
                share(saved, directory: directory, anchor: anchor)
            } catch {
                // 没写完的文件不留着。
                try? FileManager.default.removeItem(at: directory)
                if error is CancellationError { return }
                Toast.show(L("request_failed", reason(error, app: app)), long: true)
            }
        }
    }

    /// 下载到 `directory` 里，文件名用服务端给的（Core 已经去掉了路径分隔符）。返回存好的文件。
    private nonisolated static func fetch(_ url: String, api: NoteFableApi, into directory: URL) async throws -> URL {
        let file = try await api.downloadNoteFile(url) { (name: String, _: String) throws -> URL in
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            return directory.appendingPathComponent(name, isDirectory: false)
        }
        return directory.appendingPathComponent(file.name, isDirectory: false)
    }

    private static func reason(_ error: Error, app: AppEnvironment) -> String {
        if let api = error as? ApiException, !ApiText.isBlank(api.message) {
            return app.systemText.localize(api.message)
        }
        return error.localizedDescription
    }

    private static func share(_ file: URL, directory: URL, anchor: UIView?) {
        guard let presenter = topViewController(anchor) else {
            try? FileManager.default.removeItem(at: directory)
            return
        }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: directory)
        }
        // iPad 上分享面板是浮层，要给它一个出处。
        if let popover = sheet.popoverPresentationController, let view = presenter.view {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
    }

    /// 最上面那个能弹窗的控制器（已经弹着别的就接在它上面）。
    static func topViewController(_ anchor: UIView?) -> UIViewController? {
        var window = anchor?.window
        if window == nil {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let windows = scenes.flatMap { $0.windows }
            window = windows.first(where: { $0.isKeyWindow }) ?? windows.first
        }
        var top = window?.rootViewController
        while let next = top?.presentedViewController {
            top = next
        }
        return top
    }
}
